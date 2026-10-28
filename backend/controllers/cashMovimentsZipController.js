// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ cashMovimentsZipController.js — ZIP de anexos do Caixa por período        ║
// ║ CONSART ERP — ESM                                                         ║
// ║ Dep.: archiver, @google-cloud/storage, pg (pool)                          ║
// ║ ✅ Usa "cashMoviments" + "cashMovimentsAttachments"                       ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import archiver from 'archiver';
import { Storage } from '@google-cloud/storage';
import pool from '../config/db.js';
import { ensureFiscalDocumentsSchema } from '../repositories/cashFiscalDocuments/cashFiscalDocuments.schema.js';

const TABLE_MOVS = '"cashMoviments"';
const TABLE_ANEXOS = '"cashMovimentsAttachments"';
const TABLE_NOTAS = '"cashFiscalDocuments"';
const TABLE_ANEXOS_NOTAS = '"cashFiscalDocumentsAttachments"';

const storage = new Storage();
const DEFAULT_BUCKET = process.env.GCS_BUCKET || 'erp-infinity-00000';

function buildPeriodoLabel(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return 'todos';

  const norm = (s) => (s || '').substring(0, 10);

  if (dateFrom && dateTo && norm(dateFrom) === norm(dateTo)) {
    return norm(dateFrom);
  }

  return `${norm(dateFrom) || 'inicio'}_a_${norm(dateTo) || 'fim'}`;
}

function buildWhereFromQuery(q) {
  const {
    date_from,
    date_to,
    tipo,
    conta,
    categoria,
    categoria_id,
    category,
    category_id,
    subcategoria,
    subcategoria_id,
    subcategory,
    subcategory_id,
    q: searchQ,
    search,
  } = q || {};

  const where = [];
  const params = [];

  if (date_from) {
    params.push(date_from);
    where.push(`m.movement_date >= $${params.length}`);
  }

  if (date_to) {
    params.push(date_to);
    where.push(`m.movement_date <= $${params.length}`);
  }

  if (tipo) {
    params.push(String(tipo).toUpperCase());
    where.push(`UPPER(m.movement_type) = $${params.length}`);
  }

  if (conta) {
    params.push(conta);
    where.push(`m.cash_account = $${params.length}`);
  }

  const finalCategory = category_id ?? category ?? categoria_id ?? categoria;

  if (finalCategory) {
    params.push(finalCategory);
    where.push(`m.category::text = $${params.length}::text`);
  }

  const finalSubcategory = subcategory_id ?? subcategory ?? subcategoria_id ?? subcategoria;

  if (finalSubcategory) {
    params.push(finalSubcategory);
    where.push(`m.subcategory::text = $${params.length}::text`);
  }

  const finalSearch = search ?? searchQ;

  if (finalSearch) {
    params.push(`%${finalSearch}%`);
    where.push(`
      (
        m.supplier_name ILIKE $${params.length}
        OR m.document_number ILIKE $${params.length}
        OR m.notes ILIKE $${params.length}
      )
    `);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, where, params };
}

function buildNomeArquivoParaZip(row, idx) {
  const dt = row.data_hora ? new Date(row.data_hora) : null;
  const pad = (n) => String(n).padStart(2, '0');

  const dtLabel = dt
    ? `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
    : 'sem-data';

  const doc = row.nota_id
    ? `${row.nota_tipo || 'nota'}-${row.numero_documento || row.nota_id}`
    : row.numero_documento || `mov${row.mov_id || ''}`;
  const base = row.filename || `anexo_${idx + 1}`;
  const ext = base.includes('.') ? base.substring(base.lastIndexOf('.')) : '';

  return `${dtLabel}__${doc}__anexo-${String(idx + 1).padStart(2, '0')}${ext}`;
}

export async function headZipPeriodo(req, res, _next) {
  try {
    const labelPeriodo = buildPeriodoLabel(req.query.date_from, req.query.date_to);
    const filename = `caixa-anexos-${labelPeriodo}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.status(200).end();
  } catch (err) {
    console.error('[ZIP][HEAD] erro inesperado:', err);
    return res.status(200).end();
  }
}

export async function downloadZipPeriodo(req, res, next) {
  try {
    const { whereSql, where, params } = buildWhereFromQuery(req.query);

    await ensureFiscalDocumentsSchema();

    // Anexos das movimentações + anexos das notas fiscais (NF-e/NFS-e)
    // vinculadas a alguma movimentação do filtro. A nota entra uma vez só,
    // mesmo cobrindo vários pagamentos.
    const sql = `
      SELECT * FROM (
        SELECT
          a.id,
          a.cash_movement_id AS mov_id,
          NULL::bigint AS nota_id,
          NULL::varchar AS nota_tipo,
          a.file_name AS filename,
          a.mime_type,
          a.file_size_bytes AS size_bytes,
          a.storage_bucket AS bucket,
          a.storage_path AS gcs_path,

          m.movement_date AS data_hora,
          m.document_number AS numero_documento,
          m.supplier_name AS fornecedor
        FROM ${TABLE_ANEXOS} a
        JOIN ${TABLE_MOVS} m
          ON m.id = a.cash_movement_id
        ${whereSql}

        UNION ALL

        SELECT
          fa.id,
          NULL::bigint AS mov_id,
          fd.id AS nota_id,
          fd.document_type AS nota_tipo,
          fa.file_name AS filename,
          fa.mime_type,
          fa.file_size_bytes AS size_bytes,
          fa.storage_bucket AS bucket,
          fa.storage_path AS gcs_path,

          (
            SELECT MIN(m.movement_date)
            FROM ${TABLE_MOVS} m
            WHERE m.fiscal_document_id = fd.id
          ) AS data_hora,
          fd.document_number AS numero_documento,
          fd.issuer_name AS fornecedor
        FROM ${TABLE_ANEXOS_NOTAS} fa
        JOIN ${TABLE_NOTAS} fd
          ON fd.id = fa.fiscal_document_id
        WHERE EXISTS (
          SELECT 1
          FROM ${TABLE_MOVS} m
          WHERE m.fiscal_document_id = fd.id
          ${where.length ? `AND ${where.join(' AND ')}` : ''}
        )
      ) anexos
      ORDER BY data_hora ASC, nota_id ASC NULLS FIRST, id ASC
    `;

    const { rows } = await pool.query(sql, params);

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'Nenhum anexo encontrado no período.',
      });
    }

    const labelPeriodo = buildPeriodoLabel(req.query.date_from, req.query.date_to);
    const filename = `caixa-anexos-${labelPeriodo}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('[ZIP] Erro no archive:', err);

      if (!res.headersSent) {
        return res.status(500).json({
          ok: false,
          error: 'Erro ao gerar ZIP.',
        });
      }

      res.destroy(err);
    });

    archive.pipe(res);

    let anexosIncluidos = 0;
    let anexosIgnorados = 0;

    for (const [idx, row] of rows.entries()) {
      const bucketName = row.bucket || DEFAULT_BUCKET;
      const objectName = row.gcs_path;

      if (!objectName) {
        anexosIgnorados++;
        continue;
      }

      const file = storage.bucket(bucketName).file(objectName);

      const [exists] = await file.exists();

      if (!exists) {
        anexosIgnorados++;
        console.warn('[ZIP] Anexo não encontrado no GCS:', {
          id: row.id,
          mov_id: row.mov_id,
          bucket: bucketName,
          path: objectName,
        });
        continue;
      }

      const nameInZip = buildNomeArquivoParaZip(row, idx);
      const folderName = row.nota_id
        ? `NOTA_${String(row.nota_tipo || 'NF').replace(/[^\w-]+/g, '')}_${String(row.numero_documento || row.nota_id).replace(/[^\w-]+/g, '')}`
        : `ID_${row.mov_id}`;
      const fullPathInZip = `${folderName}/${nameInZip}`;

      const fileStream = file.createReadStream();

      fileStream.on('error', (err) => {
        anexosIgnorados++;
        console.warn('[ZIP] Erro ao ler arquivo GCS:', {
          id: row.id,
          mov_id: row.mov_id,
          bucket: bucketName,
          path: objectName,
          error: err.message,
        });
      });

      archive.append(fileStream, { name: fullPathInZip });
      anexosIncluidos++;
    }

    archive.append(
      `Resumo do ZIP\n\nAnexos incluídos: ${anexosIncluidos}\nAnexos ignorados: ${anexosIgnorados}\n`,
      { name: '_resumo.txt' }
    );

    return archive.finalize();
  } catch (err) {
    console.error('[ZIP][GET] erro:', err);
    return next(err);
  }
}