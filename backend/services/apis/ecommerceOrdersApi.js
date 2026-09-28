// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ecommerceOrdersApi.js — Pedidos E-commerce (Cabeçalho) — CONSART ERP ║
// ║ BH3 E-commerce · CRUD + consultas para controllers                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/* --------------------------------------------------------------------- */
/* Helper: executa query com log leve                                    */
/* --------------------------------------------------------------------- */

async function q(text, params = []) {
  // console.debug('[SQL ecommerceOrders]', text, params);
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
/* WHERE dinâmico para consulta/listagem                                  */
/* --------------------------------------------------------------------- */

function buildOrdersWhere({
  date_from,
  date_to,
  billingType,
  status,      // 🔹 novo filtro opcional de status do Asaas
  qText,
}) {
  const where = [];
  const params = [];
  let i = 1;

  if (date_from) {
    where.push(`o.created_at >= $${i++}`);
    params.push(date_from);
  }
  if (date_to) {
    where.push(`o.created_at <= $${i++}`);
    params.push(date_to);
  }

  if (billingType) {
    where.push(`o.asaas_billing_type = $${i++}`);
    params.push(String(billingType));
  }

  if (status) {
    where.push(`o.asaas_status = $${i++}`);
    params.push(String(status));
  }

  if (qText) {
    where.push(`
      (
        o.asaas_payment_id ILIKE $${i}
        OR o.shipping_provider ILIKE $${i}
        OR o.shipping_service  ILIKE $${i}
        OR o.shipping_rule     ILIKE $${i}
      )
    `);
    params.push(`%${qText}%`);
    i++;
  }

  const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')} ` : '';
  return { sqlWhere, params };
}

/* =========================================================================
   DDL opcional — garante tabela em ambientes novos
============================================================================*/

export async function ensureTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS "ecommerceOrders" (
      id                    BIGSERIAL PRIMARY KEY,
      subtotal              NUMERIC(12,2),
      created_at            TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      asaas_payment_id      VARCHAR(80),
      asaas_invoice_url     TEXT,
      asaas_pix_qr_code     TEXT,
      asaas_pix_qr_code_url TEXT,
      asaas_billing_type    VARCHAR(20),
      asaas_status          VARCHAR(40),         -- 🔹 status/autorização Asaas
      shipping_value        NUMERIC(10,2) NOT NULL DEFAULT 0,
      shipping_free         BOOLEAN       NOT NULL DEFAULT FALSE,
      shipping_rule         TEXT,
      shipping_service      TEXT,
      shipping_provider     TEXT
    );
  `;
  await q(sql);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_ecom_orders_created_at
      ON "ecommerceOrders"(created_at);
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_ecom_orders_asaas_payment_id
      ON "ecommerceOrders"(asaas_payment_id);
  `);
  await q(`
    CREATE INDEX IF NOT EXISTS idx_ecom_orders_asaas_status
      ON "ecommerceOrders"(asaas_status);
  `);
}

/* =========================================================================
   LISTAGEM / BUSCA
============================================================================*/

/**
 * Lista pedidos para grid, com paginação + total
 */
export async function listOrders({
  date_from,
  date_to,
  billingType,
  status,       // 🔹 novo filtro opcional
  qText,
  limit = 50,
  offset = 0,
  orderBy = 'created_at DESC',
}) {
  const allowedOrder = ['created_at', 'subtotal', 'shipping_value', 'id'];
  const order = parseOrder(orderBy, allowedOrder);

  const { sqlWhere, params } = buildOrdersWhere({
    date_from,
    date_to,
    billingType,
    status,
    qText,
  });

  const sql = `
    SELECT
      id,
      subtotal,
      created_at,
      asaas_payment_id,
      asaas_invoice_url,
      asaas_pix_qr_code,
      asaas_pix_qr_code_url,
      asaas_billing_type,
      asaas_status,
      shipping_value,
      shipping_free,
      shipping_rule,
      shipping_service,
      shipping_provider
    FROM "ecommerceOrders" o
    ${sqlWhere}
    ${order}
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;
  const res = await q(sql, [...params, Number(limit), Number(offset)]);

  const countSql = `
    SELECT COUNT(*) AS total
    FROM "ecommerceOrders" o
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
 * Versão simplificada para controller que só quer o array
 */
export async function searchOrders(filters = {}) {
  const { items } = await listOrders(filters);
  return items;
}

/* =========================================================================
   GET POR ID
============================================================================*/

export async function getOrderById(id) {
  const sql = `
    SELECT
      id,
      subtotal,
      created_at,
      asaas_payment_id,
      asaas_invoice_url,
      asaas_pix_qr_code,
      asaas_pix_qr_code_url,
      asaas_billing_type,
      asaas_status,
      shipping_value,
      shipping_free,
      shipping_rule,
      shipping_service,
      shipping_provider
    FROM "ecommerceOrders"
    WHERE id = $1
  `;
  const res = await q(sql, [id]);
  return res.rows[0] || null;
}

/* =========================================================================
   CREATE / UPDATE / DELETE
============================================================================*/

export async function createOrder(payload = {}) {
  const cols = [
    'subtotal',
    'created_at',
    'asaas_payment_id',
    'asaas_invoice_url',
    'asaas_pix_qr_code',
    'asaas_pix_qr_code_url',
    'asaas_billing_type',
    'asaas_status',       // 🔹 novo
    'shipping_value',
    'shipping_free',
    'shipping_rule',
    'shipping_service',
    'shipping_provider',
  ];

  const insertCols = [];
  const vals = [];
  const params = [];
  let i = 1;

  for (const c of cols) {
    const v = payload[c];
    if (v === undefined) continue;

    insertCols.push(c);
    if (c === 'shipping_free') {
      vals.push(`$${i++}`);
      params.push(v === null ? null : !!v);
    } else if (c === 'created_at' && v === 'NOW()') {
      // se quiser mandar literal, mas normalmente deixamos o default
      insertCols.pop(); // não adiciona
    } else {
      vals.push(`$${i++}`);
      params.push(v);
    }
  }

  if (!insertCols.length) {
    // deixa que o banco use defaults (ex: created_at)
    insertCols.push('created_at');
    vals.push(`NOW()`);
  }

  const sql = `
    INSERT INTO "ecommerceOrders" (${insertCols.join(',')})
    VALUES (${vals.join(',')})
    RETURNING *
  `;
  const res = await q(sql, params);
  return res.rows[0];
}

export async function updateOrder(id, payload = {}) {
  const cols = [
    'subtotal',
    'asaas_payment_id',
    'asaas_invoice_url',
    'asaas_pix_qr_code',
    'asaas_pix_qr_code_url',
    'asaas_billing_type',
    'asaas_status',      // 🔹 novo
    'shipping_value',
    'shipping_free',
    'shipping_rule',
    'shipping_service',
    'shipping_provider',
  ];

  const sets = [];
  const params = [];
  let i = 1;

  for (const c of cols) {
    if (payload[c] === undefined) continue;

    sets.push(`${c} = $${i++}`);
    if (c === 'shipping_free') {
      params.push(payload[c] === null ? null : !!payload[c]);
    } else {
      params.push(payload[c]);
    }
  }

  if (!sets.length) {
    return getOrderById(id);
  }

  const sql = `
    UPDATE "ecommerceOrders"
       SET ${sets.join(', ')}
     WHERE id = $${i}
    RETURNING *
  `;
  const res = await q(sql, [...params, id]);
  return res.rows[0] || null;
}

export async function deleteOrder(id) {
  const res = await q(
    `DELETE FROM "ecommerceOrders" WHERE id = $1 RETURNING id`,
    [id]
  );
  return res.rowCount > 0;
}

/* =========================================================================
   EXPORT DEFAULT
============================================================================*/

export default {
  ensureTable,
  listOrders,
  searchOrders,
  getOrderById,
  createOrder,
  updateOrder,
  deleteOrder,
};
