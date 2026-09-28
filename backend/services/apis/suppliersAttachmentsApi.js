// ╔══════════════════════════════════════════════════════════════════════╗
// ║ suppliersAttachmentsApi.js                                          ║
// ║ Data access + GCS upload — Suppliers Attachments                    ║
// ║ CONSART ERP | PostgreSQL | Google Cloud Storage | ESM               ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import path from 'node:path';
import { Storage } from '@google-cloud/storage';
import pool from '../../config/db.js';

const SUPPLIERS_TABLE = 'public."suppliers"';
const ATTACHMENTS_TABLE = 'public."suppliersAttachments"';

const BUCKET_NAME =
  process.env.GCS_BUCKET ||
  process.env.GOOGLE_CLOUD_BUCKET ||
  process.env.STORAGE_BUCKET ||
  'erp-infinity-00000';

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

function slugify(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
    .toUpperCase();
}

function sanitizeFileName(fileName = 'attachment') {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);

  const cleanBase = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

  const cleanExt = ext
    .replace(/[^a-zA-Z0-9.]/g, '')
    .slice(0, 20);

  return `${cleanBase || 'attachment'}${cleanExt}`;
}

function validateSupplierId(id) {
  const supplierId = Number(id);

  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    throw new Error('Invalid supplier ID.');
  }

  return supplierId;
}

function validateAttachmentId(id) {
  const attachmentId = Number(id);

  if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
    throw new Error('Invalid attachment ID.');
  }

  return attachmentId;
}

async function getSupplierFolderName(supplierId) {
  const { rows } = await pool.query(
    `
      SELECT
        supplier_id,
        name
      FROM ${SUPPLIERS_TABLE}
      WHERE supplier_id = $1
      LIMIT 1
    `,
    [supplierId]
  );

  const supplier = rows[0];

  if (!supplier) {
    throw new Error('Supplier not found.');
  }

  return slugify(supplier.name || `SUPPLIER-${supplier.supplier_id}`);
}

async function makeStoragePath(supplierId, originalName) {
  const folderName = await getSupplierFolderName(supplierId);
  const safeName = sanitizeFileName(originalName);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  return `suppliers/${folderName}/attachments/${stamp}_${safeName}`;
}

async function ensureSupplierExists(supplierId) {
  const { rows } = await pool.query(
    `
      SELECT supplier_id
      FROM ${SUPPLIERS_TABLE}
      WHERE supplier_id = $1
      LIMIT 1
    `,
    [supplierId]
  );

  if (!rows[0]) {
    throw new Error('Supplier not found.');
  }
}

async function getSignedUrl(filePath) {
  if (!filePath) return null;

  const [url] = await bucket.file(filePath).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000
  });

  return url;
}

async function list(supplierIdParam) {
  const supplierId = validateSupplierId(supplierIdParam);
  await ensureSupplierExists(supplierId);

  const { rows } = await pool.query(
    `
      SELECT
        attachment_id,
        supplier_id,
        file_name,
        file_path,
        file_url,
        mime_type,
        size_bytes,
        created_at,
        is_active
      FROM ${ATTACHMENTS_TABLE}
      WHERE supplier_id = $1
        AND COALESCE(is_active, true) = true
      ORDER BY created_at DESC, attachment_id DESC
    `,
    [supplierId]
  );

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      signed_url: await getSignedUrl(row.file_path).catch(() => null)
    }))
  );
}

async function upload(supplierIdParam, file) {
  const supplierId = validateSupplierId(supplierIdParam);
  await ensureSupplierExists(supplierId);

  if (!file || !file.buffer) {
    throw new Error('No file received.');
  }

  const originalName = file.originalname || 'attachment';
  const filePath = await makeStoragePath(supplierId, originalName);
  const gcsFile = bucket.file(filePath);

  await gcsFile.save(file.buffer, {
    resumable: false,
    metadata: {
      contentType: file.mimetype || 'application/octet-stream',
      metadata: {
        supplier_id: String(supplierId),
        original_name: originalName
      }
    }
  });

  const signedUrl = await getSignedUrl(filePath).catch(() => null);

  const { rows } = await pool.query(
    `
      INSERT INTO ${ATTACHMENTS_TABLE}
      (
        supplier_id,
        file_name,
        file_path,
        file_url,
        mime_type,
        size_bytes,
        is_active
      )
      VALUES
      (
        $1, $2, $3, $4, $5, $6, true
      )
      RETURNING
        attachment_id,
        supplier_id,
        file_name,
        file_path,
        file_url,
        mime_type,
        size_bytes,
        created_at,
        is_active
    `,
    [
      supplierId,
      originalName,
      filePath,
      signedUrl,
      file.mimetype || null,
      file.size || file.buffer.length || null
    ]
  );

  return {
    ...rows[0],
    signed_url: signedUrl
  };
}

async function remove(supplierIdParam, attachmentIdParam) {
  const supplierId = validateSupplierId(supplierIdParam);
  const attachmentId = validateAttachmentId(attachmentIdParam);

  const { rows } = await pool.query(
    `
      SELECT
        attachment_id,
        file_path
      FROM ${ATTACHMENTS_TABLE}
      WHERE attachment_id = $1
        AND supplier_id = $2
        AND COALESCE(is_active, true) = true
      LIMIT 1
    `,
    [attachmentId, supplierId]
  );

  const attachment = rows[0];

  if (!attachment) {
    return false;
  }

  if (attachment.file_path) {
    await bucket.file(attachment.file_path).delete({
      ignoreNotFound: true
    });
  }

  const { rowCount } = await pool.query(
    `
      UPDATE ${ATTACHMENTS_TABLE}
      SET is_active = false
      WHERE attachment_id = $1
        AND supplier_id = $2
    `,
    [attachmentId, supplierId]
  );

  return rowCount > 0;
}

export default {
  list,
  upload,
  remove
};