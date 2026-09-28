// ╔══════════════════════════════════════════════════════════════════════╗
// ║ accountsPayableApi.js — DAL / Data Access Layer                      ║
// ║ CONSART ERP — CRUD + anexos + geração via NF-e                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();

const SCHEMA = 'public';
const TB_NAME = '"accountsPayable"';
const TB_FULL = `${SCHEMA}.${TB_NAME}`;
const TB_ATTACH = `${SCHEMA}."accountsPayableAttachments"`;

/* ──────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────── */

async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAttachmentType(value) {
  return String(value || 'OUTRO').trim().toUpperCase();
}

function toStrOrNull(value) {
  if (value === '' || value == null) return null;
  return String(value).trim() || null;
}

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function safeFileName(value) {
  const original = String(value || 'arquivo').trim();
  const base = original.split('/').pop().split('\\').pop();

  return base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._() -]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'arquivo';
}

function safeSlug(value) {
  return String(value || 'DOCUMENTO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'DOCUMENTO';
}

function ensureAccountsPayableBucket() {
  const bucketName =
    toStrOrNull(process.env.ACCOUNTS_PAYABLE_GCS_BUCKET) ||
    toStrOrNull(process.env.GCS_ACCOUNTS_PAYABLE_BUCKET);

  if (!bucketName) {
    const error = new Error('ACCOUNTS_PAYABLE_GCS_BUCKET is required');
    error.code = 'VALIDATION';
    throw error;
  }

  return bucketName;
}

function getAccountsPayablePrefix() {
  return (
    toStrOrNull(process.env.ACCOUNTS_PAYABLE_GCS_PREFIX) ||
    'accountsPayable'
  ).replace(/^\/+|\/+$/g, '');
}

function getSignedUrlTtl() {
  const value = Number(process.env.ACCOUNTS_PAYABLE_GCS_SIGNED_URL_TTL || 900);
  return Number.isFinite(value) && value > 0 ? value : 900;
}

function assertAccountsPayableObjectPath(value) {
  const prefix = getAccountsPayablePrefix();
  const objectPath = String(value || '').replace(/^\/+/, '');

  if (!objectPath.startsWith(`${prefix}/`)) {
    const error = new Error(`gcs_path inválido: deve começar com "${prefix}/"`);
    error.code = 'VALIDATION';
    throw error;
  }

  if (objectPath.includes('..')) {
    const error = new Error('gcs_path inválido');
    error.code = 'VALIDATION';
    throw error;
  }

  return objectPath;
}

function buildAccountsPayableObjectPath({ account_payable_id, file_type, file_name }) {
  const accountId = Number(account_payable_id);

  if (!Number.isInteger(accountId) || accountId <= 0) {
    const error = new Error('account_payable_id is required');
    error.code = 'VALIDATION';
    throw error;
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const timestamp = now.toISOString().replace(/[:.]/g, '-');

  return joinPath(
    getAccountsPayablePrefix(),
    `account-${accountId}`,
    year,
    month,
    safeSlug(file_type),
    `${timestamp}_${safeFileName(file_name)}`
  );
}

function parseOrder(orderBy) {
  if (!orderBy) return 'ORDER BY ap.due_date ASC, ap.id DESC';

  const allowedCols = new Set([
    'id',
    'issue_date',
    'due_date',
    'payment_date',
    'status',
    'total_value',
    'amount_paid',
    'balance',
    'created_at',
    'updated_at',
    'invoice_number',
    'document_number'
  ]);

  const [colRaw, dirRaw] = String(orderBy).trim().split(/\s+/);
  const col = allowedCols.has(colRaw) ? colRaw : 'due_date';
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'ASC';

  return `ORDER BY ap.${col} ${dir}, ap.id DESC`;
}

/* ──────────────────────────────────────────────────────────────
 * Bootstrap
 * ────────────────────────────────────────────────────────────── */

export async function ensureTable() {
  await q('SELECT 1');

  await q(`
    CREATE TABLE IF NOT EXISTS ${TB_ATTACH} (
      id bigserial PRIMARY KEY,
      account_payable_id integer NOT NULL
        REFERENCES ${TB_FULL}(id)
        ON DELETE CASCADE,
      file_type varchar(20) NOT NULL,
      file_name text,
      file_url text,
      mime_type text,
      file_size bigint NOT NULL DEFAULT 0,
      gcs_bucket text,
      gcs_path text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await q(`
    ALTER TABLE ${TB_ATTACH}
      ADD COLUMN IF NOT EXISTS mime_type text,
      ADD COLUMN IF NOT EXISTS file_size bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gcs_bucket text,
      ADD COLUMN IF NOT EXISTS gcs_path text,
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
  `);

  await q(`ALTER TABLE ${TB_ATTACH} ALTER COLUMN file_url DROP NOT NULL`);

  // Categoria/subcategoria agora vêm do Caixa ("cashCategories"/"cashSubcategories").
  // As FKs antigas apontavam para "expensesCategories"/"expensesSubcategories" (legado, vazias).
  await q(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'accountsPayable_category_id_fkey'
          AND confrelid IS DISTINCT FROM to_regclass('${SCHEMA}."cashCategories"')
      ) THEN
        ALTER TABLE ${TB_FULL} DROP CONSTRAINT "accountsPayable_category_id_fkey";
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accountsPayable_category_id_fkey'
      ) THEN
        ALTER TABLE ${TB_FULL}
          ADD CONSTRAINT "accountsPayable_category_id_fkey"
          FOREIGN KEY (category_id) REFERENCES ${SCHEMA}."cashCategories"(id)
          ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'accountsPayable_subcategory_id_fkey'
          AND confrelid IS DISTINCT FROM to_regclass('${SCHEMA}."cashSubcategories"')
      ) THEN
        ALTER TABLE ${TB_FULL} DROP CONSTRAINT "accountsPayable_subcategory_id_fkey";
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accountsPayable_subcategory_id_fkey'
      ) THEN
        ALTER TABLE ${TB_FULL}
          ADD CONSTRAINT "accountsPayable_subcategory_id_fkey"
          FOREIGN KEY (subcategory_id) REFERENCES ${SCHEMA}."cashSubcategories"(id)
          ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_accounts_payable_attachments_account
      ON ${TB_ATTACH}(account_payable_id)
  `);

  await q(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_payable_attachments_unique
      ON ${TB_ATTACH}(account_payable_id, file_type, file_url)
  `);

  await q(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_payable_attachments_gcs_object
      ON ${TB_ATTACH}(gcs_bucket, gcs_path)
      WHERE gcs_bucket IS NOT NULL AND gcs_path IS NOT NULL
  `);
}

/* ──────────────────────────────────────────────────────────────
 * Read / List
 * ────────────────────────────────────────────────────────────── */

export async function list({
  page = 1,
  pageSize = 20,
  search,
  status,
  supplierId,
  fromDueDate,
  toDueDate,
  month,
  year,
  orderBy
} = {}) {
  const limit = Math.max(1, Math.min(Number(pageSize) || 20, 200));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const where = [];
  const params = [];
  let idx = 1;

  if (search) {
    where.push(`(
      ap.invoice_number     ILIKE $${idx}
      OR ap.description     ILIKE $${idx}
      OR s.name             ILIKE $${idx}
      OR ap.document_number ILIKE $${idx}
      OR ap.notes           ILIKE $${idx}
    )`);
    params.push(`%${String(search).trim()}%`);
    idx++;
  }

  if (status) {
    where.push(`ap.status = $${idx}`);
    params.push(String(status).trim());
    idx++;
  }

  if (supplierId != null && supplierId !== '') {
    where.push(`ap.supplier_id = $${idx}`);
    params.push(Number(supplierId));
    idx++;
  }

  if (fromDueDate) {
    where.push(`ap.due_date >= $${idx}`);
    params.push(fromDueDate);
    idx++;
  }

  if (toDueDate) {
    where.push(`ap.due_date <= $${idx}`);
    params.push(toDueDate);
    idx++;
  }

  if (month != null && month !== '') {
    where.push(`EXTRACT(MONTH FROM ap.due_date)::int = $${idx}`);
    params.push(Number(month));
    idx++;
  }

  if (year != null && year !== '') {
    where.push(`EXTRACT(YEAR FROM ap.due_date)::int = $${idx}`);
    params.push(Number(year));
    idx++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = parseOrder(orderBy);

  const baseFrom = `
    FROM ${TB_FULL} ap
    LEFT JOIN ${SCHEMA}.suppliers s
      ON s.supplier_id = ap.supplier_id
    LEFT JOIN ${SCHEMA}."paymentMethods" pm
      ON pm."paymentMethods_id" = ap.payment_method_id
    LEFT JOIN ${SCHEMA}."cashCategories" ec
      ON ec.id = ap.category_id
    LEFT JOIN ${SCHEMA}."cashSubcategories" esc
      ON esc.id = ap.subcategory_id
  `;

  const countSql = `
    SELECT COUNT(*) AS total
    ${baseFrom}
    ${whereSql}
  `;

  const dataSql = `
    SELECT
      ap.*,
      s.name   AS supplier_name,
      pm.name  AS payment_method_name,
      ec.name  AS category_name,
      esc.name AS subcategory_name,
      COALESCE(att.attachments_count, 0) AS attachments_count
    ${baseFrom}
    LEFT JOIN (
      SELECT account_payable_id, COUNT(*)::integer AS attachments_count
      FROM ${TB_ATTACH}
      WHERE is_active = TRUE
      GROUP BY account_payable_id
    ) att
      ON att.account_payable_id = ap.id
    ${whereSql}
    ${orderSql}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countRes, dataRes] = await Promise.all([
    q(countSql, params),
    q(dataSql, params)
  ]);

  const total = Number(countRes.rows[0]?.total || 0);

  return {
    ok: true,
    total,
    page: currentPage,
    pageSize: limit,
    rows: dataRes.rows
  };
}

export async function getById(id) {
  const sql = `
    SELECT
      ap.*,
      s.name   AS supplier_name,
      pm.name  AS payment_method_name,
      ec.name  AS category_name,
      esc.name AS subcategory_name,
      COALESCE(att.attachments_count, 0) AS attachments_count
    FROM ${TB_FULL} ap
    LEFT JOIN ${SCHEMA}.suppliers s
      ON s.supplier_id = ap.supplier_id
    LEFT JOIN ${SCHEMA}."paymentMethods" pm
      ON pm."paymentMethods_id" = ap.payment_method_id
    LEFT JOIN ${SCHEMA}."cashCategories" ec
      ON ec.id = ap.category_id
    LEFT JOIN ${SCHEMA}."cashSubcategories" esc
      ON esc.id = ap.subcategory_id
    LEFT JOIN (
      SELECT account_payable_id, COUNT(*)::integer AS attachments_count
      FROM ${TB_ATTACH}
      WHERE is_active = TRUE
      GROUP BY account_payable_id
    ) att
      ON att.account_payable_id = ap.id
    WHERE ap.id = $1
  `;

  const res = await q(sql, [id]);
  if (!res.rowCount) return null;
  return res.rows[0];
}

export async function getBySource(source_type, source_id) {
  const sql = `
    SELECT *
    FROM ${TB_FULL}
    WHERE source_type = $1
      AND source_id = $2
    LIMIT 1
  `;

  const res = await q(sql, [source_type, source_id]);
  return res.rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
 * Create / Update / Delete
 * ────────────────────────────────────────────────────────────── */

export async function create(payload) {
  const {
    supplier_id,
    invoice_number,
    issue_date,
    due_date,
    payment_date,
    payment_method_id,
    description,
    category_id,
    subcategory_id,
    document_number,
    total_value,
    amount_paid,
    status,
    notes,
    attachment_url,
    source_type,
    source_id
  } = payload || {};

  const sql = `
    INSERT INTO ${TB_FULL} (
      supplier_id,
      invoice_number,
      issue_date,
      due_date,
      payment_date,
      payment_method_id,
      description,
      category_id,
      subcategory_id,
      document_number,
      total_value,
      amount_paid,
      status,
      notes,
      attachment_url,
      source_type,
      source_id,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17,
      NOW(), NOW()
    )
    RETURNING *
  `;

  const params = [
    supplier_id,
    invoice_number || null,
    issue_date,
    due_date,
    payment_date || null,
    payment_method_id || null,
    description || null,
    category_id || null,
    subcategory_id || null,
    document_number || null,
    toNumber(total_value, 0),
    toNumber(amount_paid, 0),
    status || 'PENDING',
    notes || null,
    attachment_url || null,
    source_type || null,
    source_id ?? null
  ];

  const res = await q(sql, params);
  return res.rows[0];
}

export async function update(id, payload) {
  const {
    supplier_id,
    invoice_number,
    issue_date,
    due_date,
    payment_date,
    payment_method_id,
    description,
    category_id,
    subcategory_id,
    document_number,
    total_value,
    amount_paid,
    status,
    notes,
    attachment_url
  } = payload || {};

  const sql = `
    UPDATE ${TB_FULL}
    SET
      supplier_id       = $1,
      invoice_number    = $2,
      issue_date        = $3,
      due_date          = $4,
      payment_date      = $5,
      payment_method_id = $6,
      description       = $7,
      category_id       = $8,
      subcategory_id    = $9,
      document_number   = $10,
      total_value       = $11,
      amount_paid       = $12,
      status            = $13,
      notes             = $14,
      attachment_url    = $15,
      updated_at        = NOW()
    WHERE id = $16
    RETURNING *
  `;

  const params = [
    supplier_id,
    invoice_number || null,
    issue_date,
    due_date,
    payment_date || null,
    payment_method_id || null,
    description || null,
    category_id || null,
    subcategory_id || null,
    document_number || null,
    toNumber(total_value, 0),
    toNumber(amount_paid, 0),
    status || 'PENDING',
    notes || null,
    attachment_url || null,
    id
  ];

  const res = await q(sql, params);
  if (!res.rowCount) return null;
  return res.rows[0];
}

export async function remove(id) {
  const sql = `DELETE FROM ${TB_FULL} WHERE id = $1`;
  const res = await q(sql, [id]);
  return res.rowCount > 0;
}

/* ──────────────────────────────────────────────────────────────
 * Payment
 * ────────────────────────────────────────────────────────────── */

export async function pay(id, {
  payment_date,
  paid_increment,
  multa = 0,
  juros = 0,
  encargos = 0,
  observacao = ''
} = {}) {
  const current = await getById(id);
  if (!current) return null;

  const totalValue = toNumber(current.total_value, 0);
  const alreadyPaid = toNumber(current.amount_paid, 0);

  const inc = toNumber(paid_increment, 0);
  const m = toNumber(multa, 0);
  const j = toNumber(juros, 0);
  const e = toNumber(encargos, 0);

  const paidTotal = inc + m + j + e;
  const newPaid = alreadyPaid + paidTotal;
  const newBalance = Math.max(0, totalValue - newPaid);

  const newStatus = newBalance <= 0.009
    ? 'PAID'
    : String(current.status || 'PENDING').toUpperCase();

  const sql = `
    UPDATE ${TB_FULL}
    SET
      payment_date = $1,
      amount_paid  = $2,
      status       = $3,
      notes        = CASE
                      WHEN $4::text IS NULL OR $4::text = '' THEN notes
                      WHEN notes IS NULL OR notes = '' THEN $4::text
                      ELSE (notes || E'\\n' || $4::text)
                    END,
      updated_at   = NOW()
    WHERE id = $5
    RETURNING *
  `;

  const noteLine = observacao ? `Pagamento confirmado: ${observacao}` : '';

  const params = [
    payment_date || null,
    newPaid,
    newStatus,
    noteLine,
    id
  ];

  const res = await q(sql, params);
  if (!res.rowCount) return null;
  return res.rows[0];
}

/* ──────────────────────────────────────────────────────────────
 * Attachments
 * ────────────────────────────────────────────────────────────── */

export async function listAttachments(accountPayableId) {
  const sql = `
    SELECT
      id,
      account_payable_id,
      file_type,
      file_name,
      file_url,
      mime_type,
      file_size,
      gcs_bucket,
      gcs_path,
      is_active,
      created_at,
      updated_at
    FROM ${TB_ATTACH}
    WHERE account_payable_id = $1
      AND is_active = TRUE
    ORDER BY id ASC
  `;

  const res = await q(sql, [accountPayableId]);
  return res.rows;
}

export async function getAttachmentById(attachmentId) {
  const sql = `
    SELECT
      id,
      account_payable_id,
      file_type,
      file_name,
      file_url,
      mime_type,
      file_size,
      gcs_bucket,
      gcs_path,
      is_active,
      created_at,
      updated_at
    FROM ${TB_ATTACH}
    WHERE id = $1
    LIMIT 1
  `;

  const res = await q(sql, [attachmentId]);
  return res.rows[0] || null;
}

export async function signAttachmentUpload(input = {}) {
  const accountPayableId = Number(input.account_payable_id);
  const fileName = safeFileName(input.file_name);
  const fileType = normalizeAttachmentType(input.file_type);
  const mimeType = toStrOrNull(input.mime_type) || 'application/octet-stream';

  if (!Number.isInteger(accountPayableId) || accountPayableId <= 0) {
    const error = new Error('account_payable_id is required');
    error.code = 'VALIDATION';
    throw error;
  }

  const payable = await getById(accountPayableId);
  if (!payable) {
    const error = new Error('Conta a pagar não encontrada');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const gcsBucket = ensureAccountsPayableBucket();
  const gcsPath = buildAccountsPayableObjectPath({
    account_payable_id: accountPayableId,
    file_type: fileType,
    file_name: fileName
  });

  const expiresInSec = getSignedUrlTtl();
  const file = storage.bucket(gcsBucket).file(gcsPath);
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInSec * 1000,
    contentType: mimeType
  });

  return {
    ok: true,
    signedUrl,
    method: 'PUT',
    expiresInSec,
    headers: { 'Content-Type': mimeType },
    meta: {
      account_payable_id: accountPayableId,
      file_type: fileType,
      file_name: fileName,
      mime_type: mimeType,
      file_size: Math.max(0, toNumber(input.file_size, 0)),
      gcs_bucket: gcsBucket,
      gcs_path: gcsPath
    }
  };
}

export async function signAttachmentDownload(
  attachmentId,
  { expiresInSec = getSignedUrlTtl() } = {}
) {
  const attachment = await getAttachmentById(attachmentId);

  if (!attachment || attachment.is_active === false) {
    const error = new Error('Anexo não encontrado');
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (!attachment.gcs_bucket || !attachment.gcs_path) {
    if (!attachment.file_url) {
      const error = new Error('Anexo sem localização válida');
      error.code = 'NOT_FOUND';
      throw error;
    }

    return {
      ok: true,
      signedUrl: attachment.file_url,
      method: 'GET',
      expiresInSec: null,
      legacy: true
    };
  }

  const expectedBucket = ensureAccountsPayableBucket();
  if (attachment.gcs_bucket !== expectedBucket) {
    const error = new Error('Bucket do anexo inválido');
    error.code = 'VALIDATION';
    throw error;
  }

  const gcsPath = assertAccountsPayableObjectPath(attachment.gcs_path);
  const ttl = Number(expiresInSec) > 0 ? Number(expiresInSec) : getSignedUrlTtl();
  const file = storage.bucket(expectedBucket).file(gcsPath);
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + ttl * 1000,
    responseDisposition: `inline; filename="${safeFileName(attachment.file_name)}"`
  });

  return { ok: true, signedUrl, method: 'GET', expiresInSec: ttl, legacy: false };
}

export async function addAttachment(accountPayableId, input = {}, client = null) {
  const accountId = Number(accountPayableId);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error('accountPayableId is required');
  }

  const fileUrl = toStrOrNull(input.file_url);
  const hasGcsObject = !!(input.gcs_bucket || input.gcs_path);
  let gcsBucket = null;
  let gcsPath = null;

  if (hasGcsObject) {
    gcsBucket = ensureAccountsPayableBucket();
    if (toStrOrNull(input.gcs_bucket) !== gcsBucket) {
      const error = new Error('gcs_bucket inválido');
      error.code = 'VALIDATION';
      throw error;
    }

    gcsPath = assertAccountsPayableObjectPath(input.gcs_path);
    const gcsFile = storage.bucket(gcsBucket).file(gcsPath);
    const [exists] = await gcsFile.exists();
    if (!exists) {
      const error = new Error('O arquivo ainda não existe no Cloud Storage');
      error.code = 'NOT_FOUND';
      throw error;
    }
  } else if (!fileUrl) {
    throw new Error('gcs_path or file_url is required');
  }

  const db = client || pool;

  if (!hasGcsObject) {
    const legacySql = `
      INSERT INTO ${TB_ATTACH} (
        account_payable_id,
        file_type,
        file_name,
        file_url,
        mime_type,
        file_size,
        is_active,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
      ON CONFLICT (account_payable_id, file_type, file_url)
      DO UPDATE SET
        file_name = EXCLUDED.file_name,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        is_active = TRUE,
        updated_at = NOW()
      RETURNING *
    `;

    const legacyRes = await db.query(legacySql, [
      accountId,
      normalizeAttachmentType(input.file_type),
      toStrOrNull(input.file_name),
      fileUrl,
      toStrOrNull(input.mime_type),
      Math.max(0, toNumber(input.file_size, 0))
    ]);

    return legacyRes.rows[0] || null;
  }

  const sql = `
    INSERT INTO ${TB_ATTACH} (
      account_payable_id,
      file_type,
      file_name,
      file_url,
      mime_type,
      file_size,
      gcs_bucket,
      gcs_path,
      is_active,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, TRUE, NOW(), NOW())
    ON CONFLICT (gcs_bucket, gcs_path)
      WHERE gcs_bucket IS NOT NULL AND gcs_path IS NOT NULL
    DO UPDATE SET
      account_payable_id = EXCLUDED.account_payable_id,
      file_type = EXCLUDED.file_type,
      file_name = EXCLUDED.file_name,
      mime_type = EXCLUDED.mime_type,
      file_size = EXCLUDED.file_size,
      is_active = TRUE,
      updated_at = NOW()
    RETURNING *
  `;

  const res = await db.query(sql, [
    accountId,
    normalizeAttachmentType(input.file_type),
    safeFileName(input.file_name),
    toStrOrNull(input.mime_type) || 'application/octet-stream',
    Math.max(0, toNumber(input.file_size, 0)),
    gcsBucket,
    gcsPath
  ]);

  return res.rows[0] || null;
}

export async function addAttachments(accountPayableId, attachments = [], client = null) {
  const out = [];

  for (const att of attachments) {
    if (!att?.file_url && !att?.gcs_path) continue;
    const row = await addAttachment(accountPayableId, att, client);
    if (row) out.push(row);
  }

  return out;
}

export async function removeAttachment(attachmentId) {
  const sql = `
    UPDATE ${TB_ATTACH}
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = $1
  `;
  const res = await q(sql, [attachmentId]);
  return res.rowCount > 0;
}

/* ──────────────────────────────────────────────────────────────
 * Source-based create
 * ────────────────────────────────────────────────────────────── */

export async function createFromSource({
  supplier_id,
  invoice_number,
  issue_date,
  due_date,
  payment_method_id = null,
  description = null,
  category_id = null,
  subcategory_id = null,
  document_number = null,
  total_value = 0,
  amount_paid = 0,
  status = 'PENDING',
  notes = null,
  source_type,
  source_id,
  attachment_url = null,
  attachments = []
} = {}) {
  if (!source_type || source_id == null) {
    throw new Error('source_type and source_id are required');
  }

  const existing = await getBySource(source_type, source_id);
  if (existing) {
    const existingAttachments = await listAttachments(existing.id);
    return {
      created: false,
      payable: existing,
      attachments: existingAttachments
    };
  }

  return withTransaction(async (client) => {
    const insertSql = `
      INSERT INTO ${TB_FULL} (
        supplier_id,
        invoice_number,
        issue_date,
        due_date,
        payment_date,
        payment_method_id,
        description,
        category_id,
        subcategory_id,
        document_number,
        total_value,
        amount_paid,
        status,
        notes,
        attachment_url,
        source_type,
        source_id,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, NULL,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16,
        NOW(), NOW()
      )
      RETURNING *
    `;

    const insertParams = [
      supplier_id,
      invoice_number || null,
      issue_date,
      due_date,
      payment_method_id,
      description,
      category_id,
      subcategory_id,
      document_number,
      toNumber(total_value, 0),
      toNumber(amount_paid, 0),
      status || 'PENDING',
      notes || null,
      attachment_url || null,
      source_type,
      source_id
    ];

    const inserted = await client.query(insertSql, insertParams);
    const payable = inserted.rows[0];

    const insertedAttachments = await addAttachments(
      payable.id,
      attachments,
      client
    );

    return {
      created: true,
      payable,
      attachments: insertedAttachments
    };
  });
}

export default {
  ensureTable,
  list,
  getById,
  getBySource,
  create,
  update,
  remove,
  pay,
  listAttachments,
  getAttachmentById,
  addAttachment,
  addAttachments,
  removeAttachment,
  signAttachmentUpload,
  signAttachmentDownload,
  createFromSource
};
