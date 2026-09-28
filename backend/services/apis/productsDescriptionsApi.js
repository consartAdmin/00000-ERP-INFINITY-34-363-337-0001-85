// ╔══════════════════════════════════════════════════════════════╗
// ║ productsDescriptionsApi.js — CONSART ERP (ESM)              ║
// ║ Tabela: public."productsDescriptions"                       ║
// ║ CRUD + filtros (q/product_code/is_active) + paginação       ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TABLE = 'public."productsDescriptions"';

/**
 * list({ q, product_code, is_active, limit, offset })
 * - q: busca em product_code e description (ILIKE)
 * - product_code: filtro exato
 * - is_active: true/false
 * - limit/offset: paginação simples
 */
export async function list(params = {}) {
  const {
    q,
    product_code,
    is_active,
    limit = 200,
    offset = 0,
  } = params;

  const where = [];
  const values = [];
  let i = 1;

  if (q && String(q).trim()) {
    values.push(`%${String(q).trim()}%`);
    where.push(`(product_code ILIKE $${i} OR description ILIKE $${i})`);
    i++;
  }

  if (product_code && String(product_code).trim()) {
    values.push(String(product_code).trim());
    where.push(`product_code = $${i++}`);
  }

  if (is_active !== undefined && is_active !== null && is_active !== '') {
    const v = (is_active === true || is_active === 'true' || is_active === 1 || is_active === '1');
    values.push(v);
    where.push(`is_active = $${i++}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const safeOffset = Math.max(0, Number(offset) || 0);

  values.push(safeLimit);
  const limitPos = i++;

  values.push(safeOffset);
  const offsetPos = i++;

  const sql = `
    SELECT
      product_description_id,
      product_code,
      description,
      is_active,
      created_at,
      updated_at
    FROM ${TABLE}
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${limitPos} OFFSET $${offsetPos};
  `;

  const { rows } = await pool.query(sql, values);
  return rows;
}

export async function getById(id) {
  const { rows } = await pool.query(
    `
    SELECT
      product_description_id,
      product_code,
      description,
      is_active,
      created_at,
      updated_at
    FROM ${TABLE}
    WHERE product_description_id = $1
    LIMIT 1;
    `,
    [id]
  );
  return rows[0] || null;
}

export async function create(data = {}) {
  const product_code = String(data.product_code || '').trim();
  const description  = String(data.description || '').trim();
  const is_active    = (data.is_active === undefined) ? true : !!data.is_active;

  if (!product_code) throw Object.assign(new Error('product_code is required'), { status: 400 });
  if (!description)  throw Object.assign(new Error('description is required'),  { status: 400 });

  const { rows } = await pool.query(
    `
    INSERT INTO ${TABLE} (product_code, description, is_active)
    VALUES ($1, $2, $3)
    RETURNING
      product_description_id, product_code, description, is_active, created_at, updated_at;
    `,
    [product_code, description, is_active]
  );
  return rows[0];
}

export async function update(id, data = {}) {
  const description = String(data.description || '').trim();
  const is_active   = (data.is_active === undefined) ? null : !!data.is_active;

  if (!id) throw Object.assign(new Error('id is required'), { status: 400 });
  if (!description) throw Object.assign(new Error('description is required'), { status: 400 });
  if (is_active === null) throw Object.assign(new Error('is_active is required'), { status: 400 });

  const { rows } = await pool.query(
    `
    UPDATE ${TABLE}
    SET description = $1,
        is_active   = $2,
        updated_at  = NOW()
    WHERE product_description_id = $3
    RETURNING
      product_description_id, product_code, description, is_active, created_at, updated_at;
    `,
    [description, is_active, id]
  );
  return rows[0] || null;
}

/**
 * ✅ Soft delete padrão (recomendado no ERP)
 */
export async function deactivate(id) {
  const { rows } = await pool.query(
    `
    UPDATE ${TABLE}
    SET is_active = FALSE,
        updated_at = NOW()
    WHERE product_description_id = $1
    RETURNING
      product_description_id, product_code, description, is_active, created_at, updated_at;
    `,
    [id]
  );
  return rows[0] || null;
}

/**
 * DELETE físico (caso precise)
 */
export async function remove(id) {
  await pool.query(`DELETE FROM ${TABLE} WHERE product_description_id = $1;`, [id]);
  return true;
}
