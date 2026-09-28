// customersCreditApi.js — PostgreSQL data access (ESM)

import pool from '../../config/db.js';

const TB_CREDIT = 'public."customersCredit"';
const VW_POSITION = 'public."customersCreditPosition"';

const toCustomerId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('invalid customer_id');
  return id;
};

const toMoney = (value, field) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${field} must be a number greater than or equal to zero`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const toBool = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (['1', 'true', 't', 'yes', 'y'].includes(String(value).toLowerCase())) return true;
  if (['0', 'false', 'f', 'no', 'n'].includes(String(value).toLowerCase())) return false;
  throw new Error('allow_credit must be boolean');
};

const mapPosition = (row) => row && ({
  customer_id: row.customer_id,
  trade_name: row.trade_name ?? null,
  customer_credit_id: row.customer_credit_id ?? null,
  credit_limit: Number(row.credit_limit ?? 0),
  credit_used: Number(row.amount_to_pay ?? row.credit_used ?? 0),
  credit_available: Number(row.credit_available ?? 0),
  credit_exceeded: Number(row.credit_exceeded ?? 0),
  overdue_amount: Number(row.overdue_amount ?? 0),
  open_titles: Number(row.open_titles ?? 0),
  allow_credit: row.allow_credit ?? false,
  can_buy_on_credit: row.can_buy_on_credit ?? false,
});

export async function getByCustomerId(customerId) {
  const id = toCustomerId(customerId);
  const { rows } = await pool.query(
    `SELECT * FROM ${VW_POSITION} WHERE customer_id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ? mapPosition(rows[0]) : null;
}

export async function list({ limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const [{ rows }, countResult] = await Promise.all([
    pool.query(
      `SELECT * FROM ${VW_POSITION}
       ORDER BY trade_name NULLS LAST, customer_id
       LIMIT $1 OFFSET $2`,
      [safeLimit, safeOffset]
    ),
    pool.query(`SELECT COUNT(*)::INTEGER AS total FROM ${VW_POSITION}`),
  ]);
  return {
    rows: rows.map(mapPosition),
    total: countResult.rows[0]?.total ?? 0,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function upsertByCustomerId(customerId, payload = {}) {
  const id = toCustomerId(customerId);
  if (payload.credit_limit === undefined) throw new Error('credit_limit is required');

  const creditLimit = toMoney(payload.credit_limit, 'credit_limit');
  const allowCredit = toBool(payload.allow_credit, true);
  const notes = String(payload.notes ?? '').trim() || null;

  const customerResult = await pool.query(
    'SELECT customer_id FROM public.customers WHERE customer_id = $1',
    [id]
  );
  if (!customerResult.rowCount) return null;

  await pool.query(
    `INSERT INTO ${TB_CREDIT}
       (customer_id, credit_limit, allow_credit, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (customer_id)
     DO UPDATE SET
       credit_limit = EXCLUDED.credit_limit,
       allow_credit = EXCLUDED.allow_credit,
       notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [id, creditLimit, allowCredit, notes]
  );

  return getByCustomerId(id);
}

export async function removeByCustomerId(customerId) {
  const id = toCustomerId(customerId);
  const result = await pool.query(
    `DELETE FROM ${TB_CREDIT} WHERE customer_id = $1`,
    [id]
  );
  return { ok: result.rowCount > 0 };
}

export default { getByCustomerId, list, upsertByCustomerId, removeByCustomerId };