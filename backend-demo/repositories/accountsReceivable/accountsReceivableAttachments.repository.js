// ╔════════════════════════════════════════════════════════════════════╗
// ║ accountsReceivableAttachments.repository.js — Anexos do título     ║
// ║ Arquivos no bucket do projeto (GCS_BUCKET), pasta                  ║
// ║ accountsReceivable/account-{id}/ ; metadados em                    ║
// ║ public."accountsReceivableAttachments"                             ║
// ╚════════════════════════════════════════════════════════════════════╝

import { Storage } from '@google-cloud/storage';
import pool from '../../config/db.js';
import { TB, TB_ATTACH } from './accountsReceivable.constants.js';

// Mesmo bucket dos anexos do Caixa (uploadBucketsCashMoviments.js)
const BUCKET_NAME = String(process.env.GCS_BUCKET || 'erp-infinity-00000').trim();
const BASE_PREFIX = 'accountsReceivable';
const SIGNED_URL_TTL = 900;

const PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const storage = new Storage(PROJECT_ID ? { projectId: PROJECT_ID } : undefined);

// -------------------------------------------------------------------
// DDL (criada na primeira chamada)
// -------------------------------------------------------------------
const DDL = `
CREATE TABLE IF NOT EXISTS ${TB_ATTACH} (
  id                     BIGSERIAL PRIMARY KEY,
  account_receivable_id  BIGINT NOT NULL REFERENCES ${TB}(id) ON DELETE CASCADE,
  file_name              TEXT NOT NULL,
  mime_type              TEXT,
  file_size              BIGINT,
  gcs_bucket             TEXT NOT NULL,
  gcs_path               TEXT NOT NULL,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_attachments_account
  ON ${TB_ATTACH}(account_receivable_id);
`;

let ddlPromise = null;

function ensureTable() {
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

function buildObjectPath(accountId, originalName) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ts = Math.floor(Date.now() / 1000);

  return `${BASE_PREFIX}/account-${accountId}/${year}/${month}/${ts}-${slugifyName(originalName)}`;
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

async function assertAccountExists(accountId) {
  const { rows } = await pool.query(`SELECT id FROM ${TB} WHERE id = $1`, [accountId]);
  if (!rows[0]) throw validationError('Conta a receber não encontrada', 'NOT_FOUND');
}

// -------------------------------------------------------------------
// API
// -------------------------------------------------------------------
export async function listAttachments(accountReceivableId) {
  const accountId = toId(accountReceivableId, 'ID da conta');
  await ensureTable();

  const { rows } = await pool.query(
    `
    SELECT id, account_receivable_id, file_name, mime_type, file_size, created_at
    FROM ${TB_ATTACH}
    WHERE account_receivable_id = $1 AND is_active = true
    ORDER BY id ASC
    `,
    [accountId]
  );

  return rows;
}

export async function addAttachment(accountReceivableId, file) {
  const accountId = toId(accountReceivableId, 'ID da conta');
  if (!file?.buffer?.length) throw validationError('Arquivo não enviado');

  await ensureTable();
  await assertAccountExists(accountId);

  const fileName = originalName(file);
  const mimeType = file.mimetype || 'application/octet-stream';
  const gcsPath = buildObjectPath(accountId, fileName);

  await storage.bucket(BUCKET_NAME).file(gcsPath).save(file.buffer, {
    resumable: false,
    contentType: mimeType,
    metadata: { metadata: { account_receivable_id: String(accountId) } },
  });

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB_ATTACH}
      (account_receivable_id, file_name, mime_type, file_size, gcs_bucket, gcs_path)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, account_receivable_id, file_name, mime_type, file_size, created_at
    `,
    [accountId, fileName, mimeType, file.size || file.buffer.length, BUCKET_NAME, gcsPath]
  );

  return rows[0];
}

async function getAttachment(accountReceivableId, attachmentId) {
  const accountId = toId(accountReceivableId, 'ID da conta');
  const id = toId(attachmentId, 'ID do anexo');
  await ensureTable();

  const { rows } = await pool.query(
    `
    SELECT *
    FROM ${TB_ATTACH}
    WHERE id = $1 AND account_receivable_id = $2 AND is_active = true
    `,
    [id, accountId]
  );

  if (!rows[0]) throw validationError('Anexo não encontrado', 'NOT_FOUND');
  return rows[0];
}

export async function signAttachmentDownload(accountReceivableId, attachmentId) {
  const attachment = await getAttachment(accountReceivableId, attachmentId);

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
export async function deactivateAttachment(accountReceivableId, attachmentId) {
  const attachment = await getAttachment(accountReceivableId, attachmentId);

  await pool.query(
    `UPDATE ${TB_ATTACH} SET is_active = false WHERE id = $1`,
    [attachment.id]
  );

  return true;
}
