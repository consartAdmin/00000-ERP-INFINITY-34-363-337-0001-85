// ╔════════════════════════════════════════════════════════════════════╗
// ║ expensesAttachments.repository.js — Contratos e documentos da      ║
// ║ despesa. Arquivos no bucket do projeto (GCS_BUCKET), pasta         ║
// ║ expenses/expense-{id}/ ; metadados em                              ║
// ║ public."expensesAttachments"                                       ║
// ╚════════════════════════════════════════════════════════════════════╝

import { Storage } from '@google-cloud/storage';
import pool from '../../config/db.js';
import { TB } from './expenses.constants.js';

export const TB_ATTACH = 'public."expensesAttachments"';

// Mesmo bucket dos anexos do Caixa (uploadBucketsCashMoviments.js)
const BUCKET_NAME = String(process.env.GCS_BUCKET || 'erp-infinity-00000').trim();
const BASE_PREFIX = 'expenses';
const SIGNED_URL_TTL = 900;

const PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const storage = new Storage(PROJECT_ID ? { projectId: PROJECT_ID } : undefined);

// -------------------------------------------------------------------
// DDL (criada na primeira chamada)
// -------------------------------------------------------------------
const DDL = `
CREATE TABLE IF NOT EXISTS ${TB_ATTACH} (
  id                     BIGSERIAL PRIMARY KEY,
  expense_id             INTEGER NOT NULL REFERENCES ${TB}(id) ON DELETE CASCADE,
  file_name              TEXT NOT NULL,
  mime_type              TEXT,
  file_size              BIGINT,
  gcs_bucket             TEXT NOT NULL,
  gcs_path               TEXT NOT NULL,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_attachments_expense
  ON ${TB_ATTACH}(expense_id);
`;

let ddlPromise = null;

export function ensureAttachmentsTable() {
  if (!ddlPromise) {
    ddlPromise = pool.query(DDL).catch((error) => {
      ddlPromise = null;
      throw error;
    });
  }
  return ddlPromise;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function validationError(message, code = 'VALIDATION') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw validationError(`${label} inválido`);
  return id;
}

function slugifyName(name) {
  return String(name || 'anexo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function buildObjectPath(expenseKey, originalName) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ts = Math.floor(Date.now() / 1000);

  return `${BASE_PREFIX}/expense-${expenseKey}/${year}/${month}/${ts}-${slugifyName(originalName)}`;
}

// multer entrega o nome em latin1; volta para UTF-8 (acentos)
function originalName(file) {
  const raw = String(file?.originalname || 'anexo');
  try {
    return Buffer.from(raw, 'latin1').toString('utf8');
  } catch {
    return raw;
  }
}

async function assertExpenseExists(expenseKey) {
  const { rows } = await pool.query(`SELECT id FROM ${TB} WHERE id = $1`, [expenseKey]);
  if (!rows[0]) throw validationError('Despesa não encontrada', 'NOT_FOUND');
}

// -------------------------------------------------------------------
// API
// -------------------------------------------------------------------
export async function listAttachments(expenseId) {
  const expenseKey = toId(expenseId, 'ID da despesa');
  await ensureAttachmentsTable();

  const { rows } = await pool.query(
    `
    SELECT id, expense_id, file_name, mime_type, file_size, created_at
    FROM ${TB_ATTACH}
    WHERE expense_id = $1 AND is_active = true
    ORDER BY id ASC
    `,
    [expenseKey]
  );

  return rows;
}

export async function addAttachment(expenseId, file) {
  const expenseKey = toId(expenseId, 'ID da despesa');
  if (!file?.buffer?.length) throw validationError('Arquivo não enviado');

  await ensureAttachmentsTable();
  await assertExpenseExists(expenseKey);

  const fileName = originalName(file);
  const mimeType = file.mimetype || 'application/octet-stream';
  const gcsPath = buildObjectPath(expenseKey, fileName);

  await storage.bucket(BUCKET_NAME).file(gcsPath).save(file.buffer, {
    resumable: false,
    contentType: mimeType,
    metadata: { metadata: { expense_id: String(expenseKey) } },
  });

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB_ATTACH}
      (expense_id, file_name, mime_type, file_size, gcs_bucket, gcs_path)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, expense_id, file_name, mime_type, file_size, created_at
    `,
    [expenseKey, fileName, mimeType, file.size || file.buffer.length, BUCKET_NAME, gcsPath]
  );

  return rows[0];
}

async function getAttachment(expenseId, attachmentId) {
  const expenseKey = toId(expenseId, 'ID da despesa');
  const id = toId(attachmentId, 'ID do anexo');
  await ensureAttachmentsTable();

  const { rows } = await pool.query(
    `
    SELECT *
    FROM ${TB_ATTACH}
    WHERE id = $1 AND expense_id = $2 AND is_active = true
    `,
    [id, expenseKey]
  );

  if (!rows[0]) throw validationError('Anexo não encontrado', 'NOT_FOUND');
  return rows[0];
}

export async function signAttachmentDownload(expenseId, attachmentId) {
  const attachment = await getAttachment(expenseId, attachmentId);

  const safeName = String(attachment.file_name || 'anexo').replace(/["\\\r\n]+/g, '-');
  const [signedUrl] = await storage
    .bucket(attachment.gcs_bucket)
    .file(attachment.gcs_path)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL * 1000,
      responseDisposition: `inline; filename="${safeName}"`,
    });

  return signedUrl;
}

// Exclusão lógica: o arquivo continua no bucket
export async function deactivateAttachment(expenseId, attachmentId) {
  const attachment = await getAttachment(expenseId, attachmentId);

  await pool.query(
    `UPDATE ${TB_ATTACH} SET is_active = false WHERE id = $1`,
    [attachment.id]
  );

  return true;
}

/**
 * Quantidade de anexos ativos por despesa (para o 📎 da lista).
 * Nunca derruba a lista: se a tabela não puder ser criada, devolve {}.
 */
export async function countAttachmentsByExpense(ids = []) {
  const list = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return {};
  try {
    await ensureAttachmentsTable();
    const { rows } = await pool.query(
      `SELECT expense_id, COUNT(*)::int AS total
         FROM ${TB_ATTACH}
        WHERE is_active = true AND expense_id = ANY($1::int[])
        GROUP BY expense_id`,
      [list]
    );
    return Object.fromEntries(rows.map((r) => [Number(r.expense_id), r.total]));
  } catch (error) {
    console.error('[expensesAttachments] count', error?.message || error);
    return {};
  }
}
