// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeXmlAntigasApi.js — API de NF-e XML Antigas (Histórico)           ║
// ║ CONSART ERP — Upload, listagem, filtros, leitura e exclusão         ║
// ║ Usa tabela: public."nfeXmlAntigas"                                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { parseNfeXmlAntigas } from '../nfeXmlAntigasParser.js';

// ╔═══════════════════════════════════════════════════════════════════╗
// ║ LISTAGEM COM FILTROS + PAGINAÇÃO                                 ║
// ╚═══════════════════════════════════════════════════════════════════╝

export async function listNfeXmlAntigas(filters, pagination) {
  const {
    q,
    accessKey,
    cnpj,
    startDate,
    endDate,
    number,
    series,
    status
  } = filters;

  const { page, pageSize } = pagination;

  const where = [];
  const params = [];
  let idx = 1;

  if (q) {
    where.push(`(
      LOWER(dest_name)   LIKE LOWER($${idx})
      OR LOWER(emitter_name) LIKE LOWER($${idx})
      OR access_key      LIKE $${idx}
    )`);
    params.push(`%${q}%`);
    idx++;
  }

  if (accessKey) {
    where.push(`access_key = $${idx}`);
    params.push(accessKey);
    idx++;
  }

  if (cnpj) {
    where.push(`dest_cnpj_cpf = $${idx}`);
    params.push(cnpj);
    idx++;
  }

  if (startDate) {
    where.push(`issue_date >= $${idx}`);
    params.push(startDate);
    idx++;
  }

  if (endDate) {
    where.push(`issue_date <= $${idx}`);
    params.push(endDate);
    idx++;
  }

  if (number) {
    where.push(`number = $${idx}`);
    params.push(number);
    idx++;
  }

  if (series) {
    where.push(`series = $${idx}`);
    params.push(series);
    idx++;
  }

  if (status) {
    where.push(`status_sefaz = $${idx}`);
    params.push(status);
    idx++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*) AS total
    FROM public."nfeXmlAntigas"
    ${whereSql}
  `;

  const offset = (page - 1) * pageSize;

  const listSql = `
    SELECT
      id,
      access_key,
      model,
      series,
      number,
      issue_date,
      emitter_name,
      emitter_cnpj,
      dest_name,
      dest_cnpj_cpf,
      total_value,
      status_sefaz,
      status_desc,
      environment
    FROM public."nfeXmlAntigas"
    ${whereSql}
    ORDER BY issue_date DESC, id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  try {
    const totalResult = await pool.query(countSql, params);
    const listResult = await pool.query(listSql, params);

    return {
      total: Number(totalResult.rows[0]?.total || 0),
      page,
      pageSize,
      data: listResult.rows
    };
  } catch (err) {
    console.error('[listNfeXmlAntigas] Erro:', err);
    throw err;
  }
}

// ╔═══════════════════════════════════════════════════════════════════╗
// ║ BUSCAR UMA NF-e POR CHAVE DE ACESSO                              ║
// ╚═══════════════════════════════════════════════════════════════════╝

export async function getNfeXmlAntigasByAccessKey(accessKey) {
  try {
    const sql = `
      SELECT *
      FROM public."nfeXmlAntigas"
      WHERE access_key = $1
      LIMIT 1
    `;
    const result = await pool.query(sql, [accessKey]);
    return result.rows[0] || null;
  } catch (err) {
    console.error('[getNfeXmlAntigasByAccessKey] Erro:', err);
    throw err;
  }
}

// ╔═══════════════════════════════════════════════════════════════════╗
// ║ DELETAR XML ANTIGA PELA CHAVE                                    ║
// ╚═══════════════════════════════════════════════════════════════════╝

export async function deleteNfeXmlAntigasByAccessKey(accessKey) {
  try {
    const sql = `
      DELETE FROM public."nfeXmlAntigas"
      WHERE access_key = $1
      RETURNING access_key
    `;
    const result = await pool.query(sql, [accessKey]);
    return !!result.rowCount;
  } catch (err) {
    console.error('[deleteNfeXmlAntigasByAccessKey] Erro:', err);
    throw err;
  }
}

// ╔═══════════════════════════════════════════════════════════════════╗
// ║ UPLOAD EM LOTE DE XML ANTIGAS                                   ║
// ╚═══════════════════════════════════════════════════════════════════╝

export async function uploadNfeXmlAntigasFiles(files) {
  const imported = [];
  const skipped = [];
  const errors = [];

  for (const file of files) {
    try {
      const xml = file.buffer.toString('utf-8');
      const parsed = await parseNfeXmlAntigas(xml);

      if (!parsed.access_key) {
        throw new Error('XML sem chave de acesso (Id da NFe).');
      }

      const sql = `
        INSERT INTO public."nfeXmlAntigas" (
          access_key,
          environment,
          model,
          series,
          number,
          issue_date,
          emitter_cnpj,
          emitter_name,
          dest_cnpj_cpf,
          dest_name,
          operation_nature,
          total_value,
          status_sefaz,
          status_desc,
          xml_original
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15
        )
        ON CONFLICT (access_key) DO NOTHING
        RETURNING id
      `;

      const params = [
        parsed.access_key,
        parsed.environment,
        parsed.model,
        parsed.series,
        parsed.number,
        parsed.issue_date,
        parsed.emitter_cnpj,
        parsed.emitter_name,
        parsed.dest_cnpj_cpf,
        parsed.dest_name,
        parsed.operation_nature,
        parsed.total_value,
        parsed.status_sefaz,
        parsed.status_desc,
        parsed.xml_original
      ];

      const result = await pool.query(sql, params);

      if (result.rowCount) {
        imported.push(parsed.access_key);
      } else {
        // Já existia (conflito na chave)
        skipped.push(parsed.access_key);
      }
    } catch (err) {
      console.error('[uploadNfeXmlAntigasFiles] Erro em arquivo:', file.originalname, err);
      errors.push({
        fileName: file.originalname,
        error: err.message
      });
    }
  }

  return {
    imported,
    skipped,
    errors,
    totalProcessed: files.length
  };
}
