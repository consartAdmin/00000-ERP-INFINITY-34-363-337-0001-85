// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: backend/services/apis/productsNotesApi.js             ║
// ║ MODULE: Products Notes API                                  ║
// ║ CONSART ERP | ESM                                           ║
// ╚══════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

function normalizeLimit(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 500);
}

async function listByProduct(productCode, options = {}) {
  const limit = normalizeLimit(options.limit);

  const sql = `
    SELECT
      id,
      product_code,
      note_type,
      title,
      note,
      created_by,
      created_at,
      updated_at,
      is_active
    FROM public."productsNotes"
    WHERE product_code = $1
      AND is_active = TRUE
    ORDER BY created_at DESC, id DESC
    LIMIT $2;
  `;

  const { rows } = await pool.query(sql, [productCode, limit]);
  return rows;
}

async function getById(id) {
  const sql = `
    SELECT
      id,
      product_code,
      note_type,
      title,
      note,
      created_by,
      created_at,
      updated_at,
      is_active
    FROM public."productsNotes"
    WHERE id = $1;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

async function create(data) {
  const sql = `
    INSERT INTO public."productsNotes"
    (
      product_code,
      note_type,
      title,
      note,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;

  const values = [
    data.product_code,
    data.note_type || 'GENERAL',
    data.title || null,
    data.note,
    data.created_by || null,
  ];

  const { rows } = await pool.query(sql, values);
  return rows[0];
}

async function update(id, data) {
  const sql = `
    UPDATE public."productsNotes"
    SET
      note_type = COALESCE($2, note_type),
      title = COALESCE($3, title),
      note = COALESCE($4, note),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;

  const values = [
    id,
    data.note_type || null,
    data.title || null,
    data.note || null,
  ];

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function softDelete(id) {
  const sql = `
    UPDATE public."productsNotes"
    SET
      is_active = FALSE,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

export default {
  listByProduct,
  getById,
  create,
  update,
  softDelete,
};