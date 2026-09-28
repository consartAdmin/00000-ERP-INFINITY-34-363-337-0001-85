// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ordersPaymentsApi.js — Service/DAL de Pagamentos de Pedidos         ║
// ║ CONSART ERP | PostgreSQL | ESM                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_ORDERS_PAYMENTS = 'public."ordersPayments"';

function normalizeMoney(value, def = 0) {
  const n = Number(value ?? def);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : def;
}

function normalizeInt(value, def = null) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function normalizeText(value, def = null) {
  if (value === undefined || value === null) return def;
  const s = String(value).trim();
  return s || def;
}

function normalizeDate(value, def = null) {
  if (!value) return def;
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : def;
}

function rowToPayment(row) {
  if (!row) return null;

  return {
    order_payment_id: row.order_payment_id,
    order_id: row.order_id,
    payment_method_id: row.payment_method_id,
    payment_method_name: row.payment_method_name,
    amount: Number(row.amount || 0),
    installments: row.installments,
    gap_one: row.gap_one,
    gap_two: row.gap_two,
    gap_three: row.gap_three,
    gap_four: row.gap_four,
    manual_due_date: row.manual_due_date,
    created_at: row.created_at,
  };
}

export async function listOrdersPayments({ order_id = null, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];

  if (order_id) {
    params.push(order_id);
    where.push(`op.order_id = $${params.length}`);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;

  params.push(offset);
  const offsetParam = `$${params.length}`;

  const sql = `
    SELECT op.*
      FROM ${TB_ORDERS_PAYMENTS} op
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY op.order_payment_id DESC
     LIMIT ${limitParam}
    OFFSET ${offsetParam}
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map(rowToPayment);
}

export async function getOrderPaymentById(order_payment_id) {
  const sql = `
    SELECT *
      FROM ${TB_ORDERS_PAYMENTS}
     WHERE order_payment_id = $1
     LIMIT 1
  `;

  const { rows } = await pool.query(sql, [order_payment_id]);
  return rowToPayment(rows[0]);
}

export async function createOrderPayment(payload = {}) {
  const data = {
    order_id: normalizeInt(payload.order_id),
    payment_method_id: normalizeInt(payload.payment_method_id),
    payment_method_name: normalizeText(payload.payment_method_name),
    amount: normalizeMoney(payload.amount),
    installments: normalizeInt(payload.installments),
    gap_one: normalizeInt(payload.gap_one),
    gap_two: normalizeInt(payload.gap_two),
    gap_three: normalizeInt(payload.gap_three),
    gap_four: normalizeInt(payload.gap_four),
    manual_due_date: normalizeDate(payload.manual_due_date),
  };

  if (!data.order_id) {
    throw new Error('order_id é obrigatório.');
  }

  if (data.amount <= 0) {
    throw new Error('amount deve ser maior que zero.');
  }

  const sql = `
    INSERT INTO ${TB_ORDERS_PAYMENTS} (
      order_id,
      payment_method_id,
      payment_method_name,
      amount,
      installments,
      gap_one,
      gap_two,
      gap_three,
      gap_four,
      manual_due_date
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `;

  const params = [
    data.order_id,
    data.payment_method_id,
    data.payment_method_name,
    data.amount,
    data.installments,
    data.gap_one,
    data.gap_two,
    data.gap_three,
    data.gap_four,
    data.manual_due_date,
  ];

  const { rows } = await pool.query(sql, params);
  return rowToPayment(rows[0]);
}

export async function updateOrderPayment(order_payment_id, payload = {}) {
  const data = {
    payment_method_id: normalizeInt(payload.payment_method_id),
    payment_method_name: normalizeText(payload.payment_method_name),
    amount: normalizeMoney(payload.amount),
    installments: normalizeInt(payload.installments),
    gap_one: normalizeInt(payload.gap_one),
    gap_two: normalizeInt(payload.gap_two),
    gap_three: normalizeInt(payload.gap_three),
    gap_four: normalizeInt(payload.gap_four),
    manual_due_date: normalizeDate(payload.manual_due_date),
  };

  if (data.amount <= 0) {
    throw new Error('amount deve ser maior que zero.');
  }

  const sql = `
    UPDATE ${TB_ORDERS_PAYMENTS}
       SET payment_method_id = $2,
           payment_method_name = $3,
           amount = $4,
           installments = $5,
           gap_one = $6,
           gap_two = $7,
           gap_three = $8,
           gap_four = $9,
           manual_due_date = $10
     WHERE order_payment_id = $1
     RETURNING *
  `;

  const params = [
    order_payment_id,
    data.payment_method_id,
    data.payment_method_name,
    data.amount,
    data.installments,
    data.gap_one,
    data.gap_two,
    data.gap_three,
    data.gap_four,
    data.manual_due_date,
  ];

  const { rows } = await pool.query(sql, params);
  return rowToPayment(rows[0]);
}

export async function deleteOrderPayment(order_payment_id) {
  const sql = `
    DELETE FROM ${TB_ORDERS_PAYMENTS}
     WHERE order_payment_id = $1
     RETURNING *
  `;

  const { rows } = await pool.query(sql, [order_payment_id]);
  return rowToPayment(rows[0]);
}

export default {
  listOrdersPayments,
  getOrderPaymentById,
  createOrderPayment,
  updateOrderPayment,
  deleteOrderPayment,
};