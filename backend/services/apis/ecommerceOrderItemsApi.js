// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ecommerceOrderItemsApi.js — Itens Pedido E-commerce — CONSART ERP   ║
// ║ BH3 E-commerce · CRUD + consultas p/ itens por pedido               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/* --------------------------------------------------------------------- */
/* Helper: executa query com log leve                                    */
/* --------------------------------------------------------------------- */

async function q(text, params = []) {
  // console.debug('[SQL ecommerceOrderItems]', text, params);
  const res = await pool.query(text, params);
  return res;
}

/* --------------------------------------------------------------------- */
/* Normaliza ordenação segura                                             */
/* --------------------------------------------------------------------- */

function parseOrder(orderBy, allowed = []) {
  if (!orderBy) return '';
  const [col, dirRaw] = String(orderBy).trim().split(/\s+/);
  const colSafe = allowed.includes(col) ? col : null;
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'ASC';
  return colSafe ? ` ORDER BY ${colSafe} ${dir} ` : '';
}

/* --------------------------------------------------------------------- */
/* WHERE dinâmico (para caso você queira filtros adicionais no futuro)    */
/* --------------------------------------------------------------------- */

function buildItemsWhere({ order_id, product_code, search }) {
  const where = [];
  const params = [];
  let i = 1;

  if (order_id) {
    where.push(`i.order_id = $${i++}`);
    params.push(order_id);
  }

  if (product_code) {
    where.push(`i.product_code::text = $${i++}::text`);
    params.push(String(product_code));
  }

  if (search) {
    where.push(`
      (
        i.product_code ILIKE $${i}
        OR i.name      ILIKE $${i}
      )
    `);
    params.push(`%${search}%`);
    i++;
  }

  const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')} ` : '';
  return { sqlWhere, params };
}

/* =========================================================================
   DDL opcional — garante tabela em ambientes novos (não obrigatório)
============================================================================*/

export async function ensureTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS "ecommerceOrderItems" (
      id           BIGSERIAL PRIMARY KEY,
      order_id     BIGINT REFERENCES "ecommerceOrders"(id) ON DELETE CASCADE,
      product_id   BIGINT,
      product_code VARCHAR(50),
      name         TEXT,
      unit         VARCHAR(20),
      qty          NUMERIC(12,2),
      price        NUMERIC(12,2),
      total        NUMERIC(12,2)
    );
  `;
  await q(sql);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_ecom_order_items_order
      ON "ecommerceOrderItems"(order_id);
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_ecom_order_items_product
      ON "ecommerceOrderItems"(product_id);
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_ecom_order_items_code
      ON "ecommerceOrderItems"(product_code);
  `);
}

/* =========================================================================
   LISTAGEM / BUSCA
============================================================================*/

export async function listItems({
  order_id,
  product_code,
  search,
  limit = 200,
  offset = 0,
  orderBy = 'id ASC',
}) {
  const allowedOrder = ['id', 'order_id', 'product_code', 'name'];
  const order = parseOrder(orderBy, allowedOrder);

  const { sqlWhere, params } = buildItemsWhere({
    order_id,
    product_code,
    search,
  });

  const sql = `
    SELECT
      id,
      order_id,
      product_id,
      product_code,
      name,
      unit,
      qty,
      price,
      total
    FROM "ecommerceOrderItems" i
    ${sqlWhere}
    ${order}
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;
  const res = await q(sql, [...params, Number(limit), Number(offset)]);

  const countSql = `
    SELECT COUNT(*) AS total
    FROM "ecommerceOrderItems" i
    ${sqlWhere}
  `;
  const countRes = await q(countSql, params);

  return {
    items: res.rows,
    total: Number(countRes.rows?.[0]?.total || 0),
    limit: Number(limit),
    offset: Number(offset),
  };
}

/**
 * Compat com controller: retorna apenas os itens do pedido (array)
 */
export async function getItemsByOrderId(order_id) {
  const { items } = await listItems({ order_id, limit: 1000, offset: 0, orderBy: 'id ASC' });
  return items;
}

/* =========================================================================
   CREATE / BULK INSERT / DELETE POR PEDIDO
============================================================================*/

export async function createItem(payload = {}) {
  const cols = [
    'order_id',
    'product_id',
    'product_code',
    'name',
    'unit',
    'qty',
    'price',
    'total',
  ];

  const insertCols = [];
  const vals = [];
  const params = [];
  let i = 1;

  for (const c of cols) {
    const v = payload[c];
    if (v === undefined) continue;
    insertCols.push(c);
    vals.push(`$${i++}`);
    params.push(v);
  }

  if (!insertCols.length) {
    throw new Error('ecommerceOrderItemsApi.createItem: payload vazio');
  }

  const sql = `
    INSERT INTO "ecommerceOrderItems" (${insertCols.join(',')})
    VALUES (${vals.join(',')})
    RETURNING *
  `;
  const res = await q(sql, params);
  return res.rows[0];
}

/**
 * Insere vários itens de uma vez para um order_id
 * items: [{ product_id, product_code, name, unit, qty, price, total }, ...]
 */
export async function bulkInsert(order_id, items = []) {
  if (!order_id) {
    throw new Error('bulkInsert: order_id é obrigatório');
  }
  if (!Array.isArray(items) || !items.length) {
    return [];
  }

  const inserted = [];
  for (const it of items) {
    const payload = {
      ...it,
      order_id,
    };
    const row = await createItem(payload);
    inserted.push(row);
  }
  return inserted;
}

export async function deleteItemsByOrder(order_id) {
  const res = await q(
    `DELETE FROM "ecommerceOrderItems" WHERE order_id = $1`,
    [order_id]
  );
  return res.rowCount > 0;
}

/* =========================================================================
   EXPORT DEFAULT
============================================================================*/

export default {
  ensureTable,
  listItems,
  getItemsByOrderId,
  createItem,
  bulkInsert,
  deleteItemsByOrder,
};
