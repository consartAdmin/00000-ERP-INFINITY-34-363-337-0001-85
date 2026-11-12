// ╔════════════════════════════════════════════════════════════════════╗
// ║ cashFiscalDocuments.repository.js — NF-e/NFS-e x pagamentos        ║
// ║ Cadastro da nota, vínculo de N movimentações e anexos da nota      ║
// ║ Tabelas: "cashFiscalDocuments", "cashFiscalDocumentsAttachments"   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { ensureFiscalDocumentsSchema } from './cashFiscalDocuments.schema.js';

async function q(text, params = [], client = pool) {
  await ensureFiscalDocumentsSchema();
  return client.query(text, params);
}

const ATTACHMENT_FIELDS = `
  id,
  fiscal_document_id,
  file_name,
  file_name AS filename,
  mime_type,
  file_size_bytes,
  storage_bucket,
  storage_path,
  ('https://storage.googleapis.com/' || storage_bucket || '/' || storage_path) AS url,
  created_at
`;

// Valor do pagamento comparado com a nota: só o principal (multa, juros
// e encargos não entram na nota fiscal).
const DOCUMENT_FIELDS = `
  fd.id,
  fd.document_type,
  fd.document_number,
  TO_CHAR(fd.issue_date, 'YYYY-MM-DD') AS issue_date,
  fd.issuer_name,
  fd.issuer_tax_id,
  fd.total_amount,
  fd.notes,
  fd.created_at,
  fd.updated_at,
  (
    SELECT COUNT(*)::int
    FROM "cashMoviments" m
    WHERE m.fiscal_document_id = fd.id
  ) AS pagamentos_count,
  (
    SELECT COALESCE(SUM(m.amount), 0)
    FROM "cashMoviments" m
    WHERE m.fiscal_document_id = fd.id
  ) AS pagamentos_soma,
  (
    SELECT COUNT(*)::int
    FROM "cashFiscalDocumentsAttachments" fa
    WHERE fa.fiscal_document_id = fd.id
  ) AS anexos_count
`;

const PAYMENT_FIELDS = `
  m.id,
  m.movement_date AS data_hora,
  m.movement_type AS tipo_movimentacao,
  m.supplier_name AS fornecedor,
  m.document_number AS numero_documento,
  m.notes AS observacao,
  m.amount AS valor,
  (
    m.amount
    + COALESCE(m.penalty_amount, 0)
    + COALESCE(m.interest_amount, 0)
    + COALESCE(m.fee_amount, 0)
  ) AS total,
  m.fiscal_document_id,
  fd.document_type AS nota_tipo,
  fd.document_number AS nota_numero
`;

function cleanText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function cleanAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function cleanDate(value) {
  const text = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function cleanIds(ids) {
  const list = Array.isArray(ids) ? ids : String(ids ?? '').split(',');
  return [...new Set(
    list.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
  )];
}

export function sanitizeDocument(payload = {}) {
  return {
    document_type: cleanText(payload.document_type ?? payload.tipo, 40) || 'NFS-e',
    document_number: cleanText(payload.document_number ?? payload.numero, 60),
    issue_date: cleanDate(payload.issue_date ?? payload.emissao),
    issuer_name: cleanText(payload.issuer_name ?? payload.emitente, 255),
    issuer_tax_id: cleanText(
      String(payload.issuer_tax_id ?? payload.cnpj ?? '').replace(/\D/g, ''),
      20
    ),
    total_amount: cleanAmount(payload.total_amount ?? payload.valor),
    notes: cleanText(payload.notes ?? payload.observacao, 2000),
  };
}

/* =========================================================================
   NOTAS
============================================================================*/

export async function listFiscalDocuments({ search = '', limit = 30 } = {}) {
  const params = [];
  let where = '';

  const term = String(search || '').trim();
  if (term) {
    params.push(`%${term}%`);
    where = `
      WHERE fd.document_number ILIKE $1
        OR fd.issuer_name ILIKE $1
        OR fd.issuer_tax_id ILIKE $1
        OR fd.document_type ILIKE $1
    `;
  }

  params.push(Math.min(Math.max(Number(limit) || 30, 1), 100));

  const res = await q(
    `
    SELECT ${DOCUMENT_FIELDS}
    FROM "cashFiscalDocuments" fd
    ${where}
    ORDER BY fd.issue_date DESC NULLS LAST, fd.id DESC
    LIMIT $${params.length}
    `,
    params
  );

  return res.rows;
}

export async function getFiscalDocument(id) {
  const docId = Number(id);
  const doc = await q(
    `SELECT ${DOCUMENT_FIELDS} FROM "cashFiscalDocuments" fd WHERE fd.id = $1`,
    [docId]
  );

  if (!doc.rows.length) return null;

  const [anexos, pagamentos] = await Promise.all([
    listFiscalDocumentAttachments(docId),
    q(
      `
      SELECT ${PAYMENT_FIELDS}
      FROM "cashMoviments" m
      LEFT JOIN "cashFiscalDocuments" fd ON fd.id = m.fiscal_document_id
      WHERE m.fiscal_document_id = $1
      ORDER BY m.movement_date ASC, m.id ASC
      `,
      [docId]
    ),
  ]);

  return { ...doc.rows[0], anexos, pagamentos: pagamentos.rows };
}

/** Pagamentos escolhidos na tela (para o modal mostrar antes de vincular). */
export async function listPaymentsByIds(ids) {
  const list = cleanIds(ids);
  if (!list.length) return [];

  const res = await q(
    `
    SELECT ${PAYMENT_FIELDS}
    FROM "cashMoviments" m
    LEFT JOIN "cashFiscalDocuments" fd ON fd.id = m.fiscal_document_id
    WHERE m.id = ANY($1::bigint[])
    ORDER BY m.movement_date ASC, m.id ASC
    `,
    [list]
  );

  return res.rows;
}

async function linkPayments(client, docId, ids) {
  const list = cleanIds(ids);
  if (!list.length) return 0;

  const res = await client.query(
    `
    UPDATE "cashMoviments"
    SET fiscal_document_id = $1,
        updated_at = NOW()
    WHERE id = ANY($2::bigint[])
    `,
    [docId, list]
  );

  return res.rowCount;
}

export async function createFiscalDocument(payload = {}) {
  const data = sanitizeDocument(payload);
  if (!data.document_number) {
    const err = new Error('Informe o número da nota.');
    err.status = 400;
    throw err;
  }

  await ensureFiscalDocumentsSchema();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const res = await client.query(
      `
      INSERT INTO "cashFiscalDocuments"
        (document_type, document_number, issue_date, issuer_name,
         issuer_tax_id, total_amount, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        data.document_type,
        data.document_number,
        data.issue_date,
        data.issuer_name,
        data.issuer_tax_id,
        data.total_amount,
        data.notes,
      ]
    );

    const docId = res.rows[0].id;
    await linkPayments(client, docId, payload.movement_ids ?? payload.ids);

    await client.query('COMMIT');
    return getFiscalDocument(docId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updateFiscalDocument(id, payload = {}) {
  const docId = Number(id);
  const data = sanitizeDocument(payload);
  if (!data.document_number) {
    const err = new Error('Informe o número da nota.');
    err.status = 400;
    throw err;
  }

  await ensureFiscalDocumentsSchema();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const res = await client.query(
      `
      UPDATE "cashFiscalDocuments"
      SET document_type = $2,
          document_number = $3,
          issue_date = $4,
          issuer_name = $5,
          issuer_tax_id = $6,
          total_amount = $7,
          notes = $8,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        docId,
        data.document_type,
        data.document_number,
        data.issue_date,
        data.issuer_name,
        data.issuer_tax_id,
        data.total_amount,
        data.notes,
      ]
    );

    if (!res.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }

    await linkPayments(client, docId, payload.movement_ids ?? payload.ids);

    await client.query('COMMIT');
    return getFiscalDocument(docId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function linkPaymentsToDocument(id, ids) {
  const docId = Number(id);
  await ensureFiscalDocumentsSchema();

  const exists = await pool.query('SELECT 1 FROM "cashFiscalDocuments" WHERE id = $1', [docId]);
  if (!exists.rowCount) return null;

  const linked = await linkPayments(pool, docId, ids);
  return { linked, nota: await getFiscalDocument(docId) };
}

export async function unlinkPayments(ids) {
  const list = cleanIds(ids);
  if (!list.length) return 0;

  const res = await q(
    `
    UPDATE "cashMoviments"
    SET fiscal_document_id = NULL,
        updated_at = NOW()
    WHERE id = ANY($1::bigint[])
      AND fiscal_document_id IS NOT NULL
    `,
    [list]
  );

  return res.rowCount;
}

/**
 * Exclui a nota. Os pagamentos ficam sem nota (ON DELETE SET NULL) e os
 * registros de anexo saem junto (CASCADE). Devolve os anexos para o
 * controller apagar os arquivos no bucket.
 */
export async function deleteFiscalDocument(id) {
  const docId = Number(id);
  const anexos = await listFiscalDocumentAttachments(docId);
  const res = await q('DELETE FROM "cashFiscalDocuments" WHERE id = $1', [docId]);
  return res.rowCount ? { deleted: true, anexos } : null;
}

/* =========================================================================
   ANEXOS DA NOTA
============================================================================*/

export async function listFiscalDocumentAttachments(id) {
  const res = await q(
    `
    SELECT ${ATTACHMENT_FIELDS}
    FROM "cashFiscalDocumentsAttachments"
    WHERE fiscal_document_id = $1
    ORDER BY id ASC
    `,
    [Number(id)]
  );

  return res.rows;
}

export async function addFiscalDocumentAttachment({
  fiscal_document_id,
  file_name,
  mime_type,
  file_size_bytes,
  storage_bucket,
  storage_path,
}) {
  const res = await q(
    `
    INSERT INTO "cashFiscalDocumentsAttachments"
      (fiscal_document_id, file_name, mime_type, file_size_bytes,
       storage_bucket, storage_path)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING ${ATTACHMENT_FIELDS}
    `,
    [
      Number(fiscal_document_id),
      String(file_name || 'arquivo').slice(0, 255),
      mime_type || 'application/octet-stream',
      Number(file_size_bytes || 0),
      storage_bucket,
      storage_path,
    ]
  );

  return res.rows[0];
}

export async function deleteFiscalDocumentAttachment(id, anexoId) {
  const res = await q(
    `
    DELETE FROM "cashFiscalDocumentsAttachments"
    WHERE id = $1
      AND fiscal_document_id = $2
    RETURNING storage_bucket, storage_path
    `,
    [Number(anexoId), Number(id)]
  );

  return res.rows[0] || null;
}

export async function fiscalDocumentExists(id) {
  const res = await q('SELECT 1 FROM "cashFiscalDocuments" WHERE id = $1', [Number(id)]);
  return res.rowCount > 0;
}
