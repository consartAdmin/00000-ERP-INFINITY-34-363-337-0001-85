// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ mobilizedApi.js — DB Access (ESM)                                         ║
// ║ Path: backend/services/apis/mobilizedApi.js                               ║
// ║ Tabelas: public.mobilized / public."mobilizedItems"                       ║
// ║                                                                            ║
// ║ ✅ ATUALIZADO                                                             ║
// ║  - listMobilized retorna: items_count + items_total (SUM total_value)     ║
// ║  - mobilizedItems: inclui model, serial_number, nfe_ref                   ║
// ║  - total_value gerado no DB                                               ║
// ║  - (opcional) image_url por item (requer ALTER TABLE)                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB_M = 'public.mobilized';
const TB_I = 'public."mobilizedItems"';
const TB_A = 'public."mobilizedAttachments"';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const now = () => new Date();

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * numeric safe: não usa Number() para evitar perda de precisão.
 * Aceita number|string. Retorna string numérica normalizada ou null.
 */
function asNumericStr(v, { allowNull = true } = {}) {
  if (v === null || v === undefined || v === '') return allowNull ? null : '0';

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return String(v);
  }

  const s = String(v).trim().replace(',', '.');
  if (!s) return allowNull ? null : '0';

  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

function safeStr(v, max = 255) {
  return String(v ?? '').trim().slice(0, max);
}

function parseLimit(v, d = 50, max = 200) {
  const n = asInt(v);
  if (!n || n <= 0) return d;
  return Math.min(n, max);
}

function parseOffset(v, d = 0) {
  const n = asInt(v);
  if (n === null || n < 0) return d;
  return n;
}

function parseOrder(orderBy) {
  const allowed = new Map([
    ['mobilized_id', 'm.mobilized_id'],
    ['title', 'm.title'],
    ['status', 'm.status'],
    ['acquired_at', 'm.acquired_at'],
    ['created_at', 'm.created_at'],
    ['updated_at', 'm.updated_at'],
  ]);

  if (!orderBy) return ' ORDER BY m.mobilized_id DESC ';
  const [colRaw, dirRaw] = String(orderBy).trim().split(/\s+/);
  const col = allowed.get(colRaw);
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'DESC';
  return col ? ` ORDER BY ${col} ${dir} ` : ' ORDER BY m.mobilized_id DESC ';
}

async function q(text, params = []) {
  return pool.query(text, params);
}

/* ──────────────────────────────────────────────────────────────
   Mobilized (CRUD)
────────────────────────────────────────────────────────────── */
export async function createMobilized(data = {}) {
  const title = safeStr(data.title, 180);
  if (!title) throw new Error('title is required');

  const external_ref = safeStr(data.external_ref, 80) || null;
  const source_system = safeStr(data.source_system, 60) || null;
  const acquired_at = data.acquired_at ? new Date(data.acquired_at) : now();
  const notes = data.notes != null ? String(data.notes) : null;
  const status = safeStr(data.status || 'ACTIVE', 20);

  const pdf_storage = safeStr(data.pdf_storage || 'local', 30);
  const pdf_path = data.pdf_path != null ? String(data.pdf_path) : null;
  const pdf_filename = safeStr(data.pdf_filename, 255) || null;
  const pdf_mime = safeStr(data.pdf_mime || 'application/pdf', 80);

  // schema: pdf_size_bytes é bigint; passamos como string/number
  const pdf_size_bytes = data.pdf_size_bytes === undefined ? null : asNumericStr(data.pdf_size_bytes);
  const pdf_sha256 = safeStr(data.pdf_sha256, 64) || null; // schema: character(64)
  const pdf_uploaded_at = data.pdf_uploaded_at ? new Date(data.pdf_uploaded_at) : null;
  const pdf_version = asInt(data.pdf_version) || 1;

  const sql = `
    INSERT INTO ${TB_M} (
      external_ref, source_system, acquired_at,
      title, notes, status,
      pdf_storage, pdf_path, pdf_filename, pdf_mime, pdf_size_bytes, pdf_sha256, pdf_uploaded_at, pdf_version,
      created_at, updated_at
    ) VALUES (
      $1,$2,$3,
      $4,$5,$6,
      $7,$8,$9,$10,$11,$12,$13,$14,
      NOW(), NOW()
    )
    RETURNING *;
  `;

  const params = [
    external_ref, source_system, acquired_at,
    title, notes, status,
    pdf_storage, pdf_path, pdf_filename, pdf_mime,
    pdf_size_bytes, pdf_sha256, pdf_uploaded_at, pdf_version,
  ];

  const res = await q(sql, params);
  return res.rows[0];
}

export async function getMobilizedById(mobilized_id) {
  const id = asInt(mobilized_id);
  if (!id) throw new Error('invalid mobilized_id');

  const res = await q(`SELECT * FROM ${TB_M} WHERE mobilized_id = $1`, [id]);
  return res.rows[0] || null;
}

export async function listMobilized(filters = {}) {
  const where = [];
  const params = [];

  if (filters.status) {
    params.push(safeStr(filters.status, 20));
    where.push(`m.status = $${params.length}`);
  }
  if (filters.source_system) {
    params.push(safeStr(filters.source_system, 60));
    where.push(`m.source_system = $${params.length}`);
  }
  if (filters.external_ref) {
    params.push(safeStr(filters.external_ref, 80));
    where.push(`m.external_ref = $${params.length}`);
  }
  if (filters.q) {
    const qtxt = safeStr(filters.q, 200);
    if (qtxt) {
      params.push(`%${qtxt}%`);
      where.push(`(m.title ILIKE $${params.length} OR m.notes ILIKE $${params.length} OR m.external_ref ILIKE $${params.length})`);
    }
  }
  if (filters.from) {
    const d = new Date(filters.from);
    if (!isNaN(d)) {
      params.push(d);
      where.push(`m.acquired_at >= $${params.length}`);
    }
  }
  if (filters.to) {
    const d = new Date(filters.to);
    if (!isNaN(d)) {
      params.push(d);
      where.push(`m.acquired_at <= $${params.length}`);
    }
  }

  const limit = parseLimit(filters.limit, 50, 200);
  const offset = parseOffset(filters.offset, 0);
  const orderSql = parseOrder(filters.orderBy);

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')} ` : '';

  // ✅ items_total: soma do total_value (gerado no DB)
  const sql = `
    SELECT m.*,
      (SELECT COUNT(*) FROM ${TB_I} i WHERE i.mobilized_id = m.mobilized_id) AS items_count,
      (SELECT COALESCE(SUM(i.total_value), 0)::numeric(15,2)
         FROM ${TB_I} i
        WHERE i.mobilized_id = m.mobilized_id
      ) AS items_total
    FROM ${TB_M} m
    ${whereSql}
    ${orderSql}
    LIMIT ${limit} OFFSET ${offset};
  `;

  const countSql = `SELECT COUNT(*)::int AS total FROM ${TB_M} m ${whereSql};`;

  const [rowsRes, countRes] = await Promise.all([q(sql, params), q(countSql, params)]);
  return { rows: rowsRes.rows, total: countRes.rows[0]?.total ?? 0, limit, offset };
}

export async function updateMobilized(mobilized_id, data = {}) {
  const id = asInt(mobilized_id);
  if (!id) throw new Error('invalid mobilized_id');

  const set = [];
  const params = [];

  function add(col, val) {
    params.push(val);
    set.push(`${col} = $${params.length}`);
  }

  if (data.external_ref !== undefined) add('external_ref', safeStr(data.external_ref, 80) || null);
  if (data.source_system !== undefined) add('source_system', safeStr(data.source_system, 60) || null);
  if (data.acquired_at !== undefined) add('acquired_at', data.acquired_at ? new Date(data.acquired_at) : null);

  if (data.title !== undefined) {
    const t = safeStr(data.title, 180);
    if (!t) throw new Error('title cannot be empty');
    add('title', t);
  }
  if (data.notes !== undefined) add('notes', data.notes != null ? String(data.notes) : null);
  if (data.status !== undefined) add('status', safeStr(data.status, 20));

  // PDF metadata
  if (data.pdf_storage !== undefined) add('pdf_storage', safeStr(data.pdf_storage, 30));
  if (data.pdf_path !== undefined) add('pdf_path', data.pdf_path != null ? String(data.pdf_path) : null);
  if (data.pdf_filename !== undefined) add('pdf_filename', safeStr(data.pdf_filename, 255) || null);
  if (data.pdf_mime !== undefined) add('pdf_mime', safeStr(data.pdf_mime, 80) || 'application/pdf');
  if (data.pdf_size_bytes !== undefined) add('pdf_size_bytes', data.pdf_size_bytes === null ? null : asNumericStr(data.pdf_size_bytes));
  if (data.pdf_sha256 !== undefined) add('pdf_sha256', safeStr(data.pdf_sha256, 64) || null);
  if (data.pdf_uploaded_at !== undefined) add('pdf_uploaded_at', data.pdf_uploaded_at ? new Date(data.pdf_uploaded_at) : null);
  if (data.pdf_version !== undefined) add('pdf_version', asInt(data.pdf_version) || 1);

  if (!set.length) return await getMobilizedById(id);

  const sql = `
    UPDATE ${TB_M}
    SET ${set.join(', ')}, updated_at = NOW()
    WHERE mobilized_id = $${params.length + 1}
    RETURNING *;
  `;
  params.push(id);

  const res = await q(sql, params);
  return res.rows[0] || null;
}

export async function deleteMobilized(mobilized_id) {
  const id = asInt(mobilized_id);
  if (!id) throw new Error('invalid mobilized_id');
  const res = await q(`DELETE FROM ${TB_M} WHERE mobilized_id = $1 RETURNING mobilized_id`, [id]);
  return res.rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   Mobilized Items
────────────────────────────────────────────────────────────── */
export async function listMobilizedItems(mobilized_id) {
  const id = asInt(mobilized_id);
  if (!id) throw new Error('invalid mobilized_id');

  // ✅ SELECT * já traz model/serial_number/nfe_ref se existir no DB
  const res = await q(
    `SELECT * FROM ${TB_I} WHERE mobilized_id = $1 ORDER BY mobilized_item_id ASC`,
    [id]
  );
  return res.rows;
}

export async function getMobilizedItemById(mobilized_item_id) {
  const id = asInt(mobilized_item_id);
  if (!id) throw new Error('invalid mobilized_item_id');

  const res = await q(`SELECT * FROM ${TB_I} WHERE mobilized_item_id = $1`, [id]);
  return res.rows[0] || null;
}

export async function addMobilizedItem(mobilized_id, item = {}) {
  const id = asInt(mobilized_id);
  if (!id) throw new Error('invalid mobilized_id');

  const description = safeStr(item.description, 500);
  if (!description) throw new Error('description is required');

  const qtyStr = asNumericStr(item.quantity, { allowNull: false });
  if (qtyStr === null) throw new Error('invalid quantity');
  if (Number(qtyStr) < 0) throw new Error('quantity must be >= 0');

  const unitPriceStr = asNumericStr(item.unit_price);
  if (unitPriceStr !== null && Number(unitPriceStr) < 0) throw new Error('unit_price must be >= 0');

  // ✅ NOVOS CAMPOS
  const model = safeStr(item.model, 120) || null;
  const serial_number = safeStr(item.serial_number, 120) || null;
  const nfe_ref = safeStr(item.nfe_ref, 120) || null;

  // ✅ (opcional) image_url: requer coluna no DB
  const hasImageUrl = Object.prototype.hasOwnProperty.call(item, 'image_url');

  const sql = hasImageUrl
    ? `
      INSERT INTO ${TB_I} (
        mobilized_id,
        sku, description,
        model, serial_number, nfe_ref,
        quantity, unit, unit_price,
        notes, image_url,
        created_at
      ) VALUES (
        $1,
        $2,$3,
        $4,$5,$6,
        $7,$8,$9,
        $10,$11,
        NOW()
      )
      RETURNING *;
    `
    : `
      INSERT INTO ${TB_I} (
        mobilized_id,
        sku, description,
        model, serial_number, nfe_ref,
        quantity, unit, unit_price,
        notes,
        created_at
      ) VALUES (
        $1,
        $2,$3,
        $4,$5,$6,
        $7,$8,$9,
        $10,
        NOW()
      )
      RETURNING *;
    `;

  const params = hasImageUrl
    ? [
        id,
        safeStr(item.sku, 60) || null,
        description,

        model,
        serial_number,
        nfe_ref,

        qtyStr,
        safeStr(item.unit, 10) || null,
        unitPriceStr,

        item.notes != null ? String(item.notes) : null,
        safeStr(item.image_url, 800) || null,
      ]
    : [
        id,
        safeStr(item.sku, 60) || null,
        description,

        model,
        serial_number,
        nfe_ref,

        qtyStr,
        safeStr(item.unit, 10) || null,
        unitPriceStr,

        item.notes != null ? String(item.notes) : null,
      ];

  const res = await q(sql, params);
  return res.rows[0];
}

export async function updateMobilizedItem(mobilized_item_id, patch = {}) {
  const id = asInt(mobilized_item_id);
  if (!id) throw new Error('invalid mobilized_item_id');

  const set = [];
  const params = [];

  function add(col, val) {
    params.push(val);
    set.push(`${col} = $${params.length}`);
  }

  if (patch.sku !== undefined) add('sku', safeStr(patch.sku, 60) || null);

  if (patch.description !== undefined) {
    const d = safeStr(patch.description, 500);
    if (!d) throw new Error('description cannot be empty');
    add('description', d);
  }

  // ✅ NOVOS CAMPOS
  if (patch.model !== undefined) add('model', safeStr(patch.model, 120) || null);
  if (patch.serial_number !== undefined) add('serial_number', safeStr(patch.serial_number, 120) || null);
  if (patch.nfe_ref !== undefined) add('nfe_ref', safeStr(patch.nfe_ref, 120) || null);

  if (patch.quantity !== undefined) {
    const qtyStr = asNumericStr(patch.quantity, { allowNull: false });
    if (qtyStr === null) throw new Error('invalid quantity');
    if (Number(qtyStr) < 0) throw new Error('quantity must be >= 0');
    add('quantity', qtyStr);
  }

  if (patch.unit !== undefined) add('unit', safeStr(patch.unit, 10) || null);

  if (patch.unit_price !== undefined) {
    const unitPriceStr = asNumericStr(patch.unit_price);
    if (unitPriceStr !== null && Number(unitPriceStr) < 0) throw new Error('unit_price must be >= 0');
    add('unit_price', unitPriceStr);
  }

  if (patch.notes !== undefined) add('notes', patch.notes != null ? String(patch.notes) : null);

  // ✅ (opcional) image_url (requer coluna no DB)
  if (patch.image_url !== undefined) add('image_url', safeStr(patch.image_url, 800) || null);

  if (!set.length) return await getMobilizedItemById(id);

  const sql = `
    UPDATE ${TB_I}
    SET ${set.join(', ')}
    WHERE mobilized_item_id = $${params.length + 1}
    RETURNING *;
  `;
  params.push(id);

  const res = await q(sql, params);
  return res.rows[0] || null;
}

export async function deleteMobilizedItem(mobilized_item_id) {
  const id = asInt(mobilized_item_id);
  if (!id) throw new Error('invalid mobilized_item_id');

  const res = await q(
    `DELETE FROM ${TB_I} WHERE mobilized_item_id = $1 RETURNING mobilized_item_id`,
    [id]
  );
  return res.rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   Mobilized Attachments
────────────────────────────────────────────────────────────── */
export async function listMobilizedAttachments(mobilized_id) {
  const id = asInt(mobilized_id);
  if (!id) throw new Error('invalid mobilized_id');

  const res = await q(
    `SELECT *
       FROM ${TB_A}
      WHERE mobilized_id = $1
        AND status <> 'DELETED'
      ORDER BY is_primary DESC, mobilized_attachment_id ASC`,
    [id]
  );
  return res.rows;
}

export async function getMobilizedAttachmentById(mobilized_attachment_id) {
  const id = asInt(mobilized_attachment_id);
  if (!id) throw new Error('invalid mobilized_attachment_id');

  const res = await q(
    `SELECT * FROM ${TB_A} WHERE mobilized_attachment_id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

export async function createMobilizedAttachment(data = {}) {
  const mobilizedId = asInt(data.mobilized_id);
  if (!mobilizedId) throw new Error('invalid mobilized_id');

  const itemId = data.mobilized_item_id == null
    ? null
    : asInt(data.mobilized_item_id);
  if (data.mobilized_item_id != null && !itemId) {
    throw new Error('invalid mobilized_item_id');
  }

  const originalFilename = safeStr(data.original_filename, 255);
  if (!originalFilename) throw new Error('original_filename is required');

  const res = await q(
    `INSERT INTO ${TB_A} (
       mobilized_id, mobilized_item_id, attachment_type,
       original_filename, storage_filename,
       storage_provider, bucket_name, object_path, public_url,
       mime_type, size_bytes, sha256, is_primary, status,
       created_at, updated_at
     ) VALUES (
       $1,$2,$3,
       $4,$5,
       $6,$7,$8,$9,
       $10,$11,$12,$13,$14,
       NOW(),NOW()
     )
     RETURNING *`,
    [
      mobilizedId,
      itemId,
      safeStr(data.attachment_type || 'FILE', 30).toUpperCase(),
      originalFilename,
      safeStr(data.storage_filename || originalFilename, 255),
      safeStr(data.storage_provider || 'gcs', 30),
      safeStr(data.bucket_name, 255),
      String(data.object_path || ''),
      data.public_url ? String(data.public_url) : null,
      safeStr(data.mime_type || 'application/octet-stream', 120),
      data.size_bytes == null ? null : asNumericStr(data.size_bytes),
      safeStr(data.sha256, 64) || null,
      Boolean(data.is_primary),
      safeStr(data.status || 'UPLOADING', 20).toUpperCase(),
    ]
  );
  return res.rows[0];
}

export async function updateMobilizedAttachment(mobilized_attachment_id, patch = {}) {
  const id = asInt(mobilized_attachment_id);
  if (!id) throw new Error('invalid mobilized_attachment_id');

  const set = [];
  const params = [];
  const add = (column, value) => {
    params.push(value);
    set.push(`${column} = $${params.length}`);
  };

  if (patch.storage_filename !== undefined) add('storage_filename', safeStr(patch.storage_filename, 255));
  if (patch.bucket_name !== undefined) add('bucket_name', safeStr(patch.bucket_name, 255));
  if (patch.object_path !== undefined) add('object_path', String(patch.object_path || ''));
  if (patch.public_url !== undefined) add('public_url', patch.public_url ? String(patch.public_url) : null);
  if (patch.mime_type !== undefined) add('mime_type', safeStr(patch.mime_type, 120));
  if (patch.size_bytes !== undefined) add('size_bytes', patch.size_bytes == null ? null : asNumericStr(patch.size_bytes));
  if (patch.sha256 !== undefined) add('sha256', safeStr(patch.sha256, 64) || null);
  if (patch.status !== undefined) add('status', safeStr(patch.status, 20).toUpperCase());

  if (!set.length) return getMobilizedAttachmentById(id);
  params.push(id);

  const res = await q(
    `UPDATE ${TB_A}
        SET ${set.join(', ')}, updated_at = NOW()
      WHERE mobilized_attachment_id = $${params.length}
      RETURNING *`,
    params
  );
  return res.rows[0] || null;
}

export async function setPrimaryMobilizedAttachment(mobilized_id, attachment_id) {
  const mobilizedId = asInt(mobilized_id);
  const attachmentId = asInt(attachment_id);
  if (!mobilizedId) throw new Error('invalid mobilized_id');
  if (!attachmentId) throw new Error('invalid mobilized_attachment_id');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT * FROM ${TB_A}
        WHERE mobilized_attachment_id = $1
          AND mobilized_id = $2
          AND status = 'ACTIVE'
        FOR UPDATE`,
      [attachmentId, mobilizedId]
    );
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const itemId = target.rows[0].mobilized_item_id;
    await client.query(
      `UPDATE ${TB_A}
          SET is_primary = false, updated_at = NOW()
        WHERE mobilized_id = $1
          AND mobilized_item_id IS NOT DISTINCT FROM $2
          AND is_primary = true`,
      [mobilizedId, itemId]
    );
    const updated = await client.query(
      `UPDATE ${TB_A}
          SET is_primary = true, updated_at = NOW()
        WHERE mobilized_attachment_id = $1
        RETURNING *`,
      [attachmentId]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteMobilizedAttachment(mobilized_id, attachment_id) {
  const mobilizedId = asInt(mobilized_id);
  const attachmentId = asInt(attachment_id);
  if (!mobilizedId) throw new Error('invalid mobilized_id');
  if (!attachmentId) throw new Error('invalid mobilized_attachment_id');

  const res = await q(
    `DELETE FROM ${TB_A}
      WHERE mobilized_attachment_id = $1
        AND mobilized_id = $2
      RETURNING *`,
    [attachmentId, mobilizedId]
  );
  return res.rows[0] || null;
}
