// ╔══════════════════════════════════════════════════════════════════════╗
// ║ sellerForCustomerApi.js — Link Sellers ↔ Customers (Postgres CRUD)  ║
// ║ CONSART ERP — ESM                                                   ║
// ║ ✅ Tabela real: public."SellerForCustomer"                           ║
// ║ ✅ Joins corretos: public.sellers + public."customers"               ║
// ║ ✅ Suporte a BULK por customer_ids                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."SellerForCustomer"';

async function q(text, params = []) {
  return pool.query(text, params);
}

function parseOrder(orderBy, allowed = []) {
  if (!orderBy) return 'ORDER BY sfc.created_at DESC';
  const [col, dirRaw] = String(orderBy).trim().split(/\s+/);
  const colSafe = allowed.includes(col) ? col : null;
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'ASC';
  return colSafe ? `ORDER BY sfc.${colSafe} ${dir}` : 'ORDER BY sfc.created_at DESC';
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['1', 'true', 't', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'f', 'no', 'n'].includes(s)) return false;
  return undefined;
}

/* =========================================================================
   LIST (com filtros + paginação)
   ========================================================================= */

export async function listSellerForCustomer({
  seller_id,
  customer_id,
  active,
  limit = 50,
  offset = 0,
  orderBy,
} = {}) {
  const where = [];
  const params = [];
  let i = 1;

  const sid = toInt(seller_id);
  const cid = toInt(customer_id);
  const act = toBool(active);

  if (sid != null) {
    where.push(`sfc.seller_id = $${i++}`);
    params.push(sid);
  }
  if (cid != null) {
    where.push(`sfc.customer_id = $${i++}`);
    params.push(cid);
  }
  if (act !== undefined) {
    where.push(`sfc.active = $${i++}`);
    params.push(act);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const allowedOrder = ['id', 'seller_id', 'customer_id', 'active', 'created_at', 'updated_at'];
  const orderSql = parseOrder(orderBy, allowedOrder);

  params.push(Number(limit) || 50);
  const limIdx = i++;
  params.push(Number(offset) || 0);
  const offIdx = i++;

  const sql = `
    SELECT
      sfc.id,
      sfc.seller_id,
      sfc.customer_id,
      sfc.active,
      sfc.created_at,
      sfc.updated_at,
      COALESCE(s.nickname, s.name)        AS seller_name,
      COALESCE(c.trade_name, c.legal_name) AS customer_name
    FROM ${TB} sfc
    LEFT JOIN public.sellers s
      ON s.id = sfc.seller_id
    LEFT JOIN public."customers" c
      ON c.customer_id = sfc.customer_id
    ${whereSql}
    ${orderSql}
    LIMIT $${limIdx}
    OFFSET $${offIdx};
  `;

  const countSql = `
    SELECT COUNT(*)::INT AS total
    FROM ${TB} sfc
    ${whereSql};
  `;

  const [rowsRes, countRes] = await Promise.all([
    q(sql, params),
    q(countSql, params.slice(0, params.length - 2)),
  ]);

  return {
    items: rowsRes.rows,
    total: countRes.rows?.[0]?.total ?? 0,
    limit: Number(limit) || 50,
    offset: Number(offset) || 0,
  };
}

/* =========================================================================
   BULK: retorna links por lista de customer_ids (para a tela de clientes)
   ========================================================================= */

export async function listByCustomerIds(customerIds = []) {
  const ids = (Array.isArray(customerIds) ? customerIds : [])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  if (!ids.length) return [];

  const sql = `
    SELECT
      sfc.id,
      sfc.seller_id,
      sfc.customer_id,
      sfc.active,
      sfc.created_at,
      sfc.updated_at,
      COALESCE(s.nickname, s.name)         AS seller_name,
      COALESCE(c.trade_name, c.legal_name) AS customer_name
    FROM ${TB} sfc
    LEFT JOIN public.sellers s
      ON s.id = sfc.seller_id
    LEFT JOIN public."customers" c
      ON c.customer_id = sfc.customer_id
    WHERE sfc.customer_id = ANY($1::INT[])
      AND (sfc.active IS NULL OR sfc.active = TRUE)
    ORDER BY sfc.created_at DESC;
  `;

  const res = await q(sql, [ids]);
  return res.rows || [];
}

/* =========================================================================
   GET BY ID
   ========================================================================= */

export async function getSellerForCustomerById(id) {
  const iid = toInt(id);
  if (!iid) return null;

  const sql = `
    SELECT
      sfc.id,
      sfc.seller_id,
      sfc.customer_id,
      sfc.active,
      sfc.created_at,
      sfc.updated_at,
      COALESCE(s.nickname, s.name)         AS seller_name,
      COALESCE(c.trade_name, c.legal_name) AS customer_name
    FROM ${TB} sfc
    LEFT JOIN public.sellers s
      ON s.id = sfc.seller_id
    LEFT JOIN public."customers" c
      ON c.customer_id = sfc.customer_id
    WHERE sfc.id = $1
    LIMIT 1;
  `;

  const res = await q(sql, [iid]);
  return res.rows[0] || null;
}

/* =========================================================================
   CREATE
   ========================================================================= */

export async function createSellerForCustomer(payload = {}) {
  const sid = toInt(payload.seller_id);
  const cid = toInt(payload.customer_id);

  if (!sid || !cid) throw new Error('seller_id and customer_id are required');

  const active = payload.active === undefined || payload.active === null ? true : !!payload.active;

  const sql = `
    INSERT INTO ${TB} (seller_id, customer_id, active)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;

  try {
    const res = await q(sql, [sid, cid, active]);
    return res.rows[0];
  } catch (err) {
    if (err?.code === '23505') {
      const e = new Error('This seller is already linked to this customer.');
      e.code = 'DUPLICATE_RELATION';
      throw e;
    }
    throw err;
  }
}

/* =========================================================================
   UPDATE
   ========================================================================= */

export async function updateSellerForCustomer(id, payload = {}) {
  const iid = toInt(id);
  if (!iid) throw new Error('invalid id');

  const sets = [];
  const params = [];
  let i = 1;

  if (payload.seller_id !== undefined) {
    const sid = payload.seller_id === null ? null : toInt(payload.seller_id);
    sets.push(`seller_id = $${i++}`);
    params.push(sid);
  }

  if (payload.customer_id !== undefined) {
    const cid = payload.customer_id === null ? null : toInt(payload.customer_id);
    sets.push(`customer_id = $${i++}`);
    params.push(cid);
  }

  if (payload.active !== undefined) {
    sets.push(`active = $${i++}`);
    params.push(payload.active === null ? null : !!payload.active);
  }

  if (!sets.length) return getSellerForCustomerById(iid);

  sets.push(`updated_at = NOW()`);

  const sql = `
    UPDATE ${TB}
       SET ${sets.join(', ')}
     WHERE id = $${i}
     RETURNING *;
  `;

  try {
    const res = await q(sql, [...params, iid]);
    return res.rows[0] || null;
  } catch (err) {
    if (err?.code === '23505') {
      const e = new Error('This seller is already linked to this customer.');
      e.code = 'DUPLICATE_RELATION';
      throw e;
    }
    throw err;
  }
}

/* =========================================================================
   DELETE
   ========================================================================= */

export async function deleteSellerForCustomer(id) {
  const iid = toInt(id);
  if (!iid) return false;

  const res = await q(`DELETE FROM ${TB} WHERE id = $1 RETURNING id`, [iid]);
  return res.rowCount > 0;
}

/* =========================================================================
   HELPERS
   ========================================================================= */

export async function listCustomersBySeller(seller_id) {
  const sid = toInt(seller_id);
  if (!sid) return [];

  const sql = `
    SELECT
      c.*,
      sfc.id         AS link_id,
      sfc.active     AS link_active,
      sfc.created_at AS link_created_at,
      sfc.updated_at AS link_updated_at
    FROM ${TB} sfc
    INNER JOIN public."customers" c
      ON c.customer_id = sfc.customer_id
    WHERE sfc.seller_id = $1
    ORDER BY COALESCE(c.trade_name, c.legal_name) ASC;
  `;
  const res = await q(sql, [sid]);
  return res.rows || [];
}

export async function listSellersByCustomer(customer_id) {
  const cid = toInt(customer_id);
  if (!cid) return [];

  const sql = `
    SELECT
      s.*,
      sfc.id         AS link_id,
      sfc.active     AS link_active,
      sfc.created_at AS link_created_at,
      sfc.updated_at AS link_updated_at
    FROM ${TB} sfc
    INNER JOIN public.sellers s
      ON s.id = sfc.seller_id
    WHERE sfc.customer_id = $1
    ORDER BY COALESCE(s.nickname, s.name) ASC;
  `;
  const res = await q(sql, [cid]);
  return res.rows || [];
}

export async function ping() {
  const r = await q('SELECT 1 AS ok');
  return r.rows?.[0]?.ok === 1;
}

export default {
  listSellerForCustomer,
  listByCustomerIds,
  getSellerForCustomerById,
  createSellerForCustomer,
  updateSellerForCustomer,
  deleteSellerForCustomer,
  listCustomersBySeller,
  listSellersByCustomer,
  ping,
};
