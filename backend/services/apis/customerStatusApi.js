// ╔════════════════════════════════════════════════════════════════════╗
// ║ customerStatusApi.js — DAL Customer Status (Postgres - ESM)       ║
// ║ Tabela: public."customerStatus"                                   ║
// ║ Regras: 1 linha por cliente (status atual)                        ║
// ║ ✅ UPSERT por customer_id (setStatusForCustomer)                  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."customerStatus"';
const ALIAS = 'cs';

const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) => (isFiniteNum(v) ? Number(v) : null);
const trimOrNull = (v) => (v ?? '').toString().trim() || null;

// Normaliza linha
const mapRow = (r) => ({
  id: r.id,
  customer_id: r.customer_id,
  status_type_id: r.status_type_id,
  note: r.note,
  updated_at: r.updated_at,
  updated_by: r.updated_by,
});

const mapRowWithStatus = (r) => ({
  id: r.id,
  customer_id: r.customer_id,
  status_type_id: r.status_type_id,
  status_name_pt: r.status_name_pt,
  status_code: r.status_code,
  status_color_hex: r.status_color_hex,
  note: r.note,
  updated_at: r.updated_at,
  updated_by: r.updated_by,
});

const FIELDS = ['customer_id', 'status_type_id', 'note', 'updated_by'];

function sanitizeCreate(input = {}) {
  return {
    customer_id: toNumOrNull(input.customer_id),
    status_type_id: toNumOrNull(input.status_type_id),
    note: trimOrNull(input.note),
    updated_by: toNumOrNull(input.updated_by),
  };
}

function sanitizeUpdate(input = {}) {
  const out = {};
  for (const k of Object.keys(input || {})) {
    if (!FIELDS.includes(k)) continue;

    let v = input[k];
    if (k === 'customer_id' || k === 'status_type_id' || k === 'updated_by') {
      v = toNumOrNull(v);
    }
    if (k === 'note') v = trimOrNull(v);

    out[k] = v;
  }
  return out;
}

/** Cria tabela e índices (idempotente) */
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public."customerStatus" (
        id              SERIAL      PRIMARY KEY,
        customer_id     BIGINT      NOT NULL REFERENCES public."customers"(customer_id) ON DELETE CASCADE,
        status_type_id  INTEGER     NOT NULL REFERENCES public."customerStatusTypes"(id),
        note            TEXT,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by      INTEGER     REFERENCES public."system_users"(id)
      );
    `);

    // 1 linha por cliente
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_customerStatus_customer_id
      ON public."customerStatus"(customer_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customerStatus_status_type_id
      ON public."customerStatus"(status_type_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customerStatus_updated_at
      ON public."customerStatus"(updated_at DESC);
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** CREATE simples (use setStatusForCustomer para garantir 1 por cliente) */
export async function create(payload) {
  const data = sanitizeCreate(payload);

  if (!data.customer_id) throw new Error('customer_id is required');
  if (!data.status_type_id) throw new Error('status_type_id is required');

  const cols = [];
  const vals = [];
  const params = [];

  for (const k of FIELDS) {
    if (data[k] !== undefined) {
      cols.push(`"${k}"`);
      params.push(data[k]);
      vals.push(`$${params.length}`);
    }
  }

  const sql = `
    INSERT INTO ${TB} (${cols.join(', ')})
    VALUES (${vals.join(', ')})
    RETURNING *;
  `;
  const { rows } = await pool.query(sql, params);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** UPDATE BY ID */
export async function updateById(id, payload) {
  const sid = toNumOrNull(id);
  if (!sid) throw new Error('invalid customerStatus id');

  const data = sanitizeUpdate(payload);
  const sets = [];
  const params = [];

  for (const [k, v] of Object.entries(data)) {
    params.push(v);
    sets.push(`"${k}" = $${params.length}`);
  }

  if (!sets.length) {
    const { rows } = await pool.query(`SELECT * FROM ${TB} WHERE id = $1`, [sid]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  params.push(new Date());
  sets.push(`"updated_at" = $${params.length}`);

  params.push(sid);
  const sql = `
    UPDATE ${TB}
       SET ${sets.join(', ')}
     WHERE id = $${params.length}
     RETURNING *;
  `;
  const { rows } = await pool.query(sql, params);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** GET BY ID */
export async function getById(id) {
  const sid = toNumOrNull(id);
  if (!sid) throw new Error('invalid customerStatus id');

  const { rows } = await pool.query(`SELECT * FROM ${TB} WHERE id = $1`, [sid]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** GET BY customer_id — com JOIN em customerStatusTypes */
export async function getByCustomerId(customerId) {
  const cid = toNumOrNull(customerId);
  if (!cid) throw new Error('invalid customer_id');

  const sql = `
    SELECT
      ${ALIAS}.id,
      ${ALIAS}.customer_id,
      ${ALIAS}.status_type_id,
      ${ALIAS}.note,
      ${ALIAS}.updated_at,
      ${ALIAS}.updated_by,
      cst.name_pt       AS status_name_pt,
      cst.internal_code AS status_code,
      cst.color_hex     AS status_color_hex
    FROM ${TB} ${ALIAS}
    JOIN public."customerStatusTypes" cst
      ON cst.id = ${ALIAS}.status_type_id
    WHERE ${ALIAS}.customer_id = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [cid]);
  return rows[0] ? mapRowWithStatus(rows[0]) : null;
}

/**
 * setStatusForCustomer — UPSERT por customer_id
 * Garante 1 linha por cliente.
 * ✅ não sobrescreve note/updated_by com null se vier vazio
 */
export async function setStatusForCustomer(customerId, statusTypeId, { note, updated_by } = {}) {
  const cid = toNumOrNull(customerId);
  const stid = toNumOrNull(statusTypeId);

  if (!cid) throw new Error('invalid customer_id');
  if (!stid) throw new Error('invalid status_type_id');

  const noteClean = trimOrNull(note);
  const byClean = toNumOrNull(updated_by);

  const sql = `
    INSERT INTO ${TB} (customer_id, status_type_id, note, updated_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (customer_id)
    DO UPDATE SET
      status_type_id = EXCLUDED.status_type_id,
      note           = COALESCE(EXCLUDED.note, ${TB}.note),
      updated_by     = COALESCE(EXCLUDED.updated_by, ${TB}.updated_by),
      updated_at     = NOW()
    RETURNING *;
  `;

  const { rows } = await pool.query(sql, [cid, stid, noteClean, byClean]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** DELETE por customer_id */
export async function removeByCustomerId(customerId) {
  const cid = toNumOrNull(customerId);
  if (!cid) throw new Error('invalid customer_id');

  const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE customer_id = $1`, [cid]);
  return { ok: rowCount > 0 };
}

/** LIST — com total, para grids */
export async function list({
  status_type_id,
  limit = 50,
  offset = 0,
  orderBy = 'updated_at',
  order = 'desc',
} = {}) {
  const params = [];
  const where = [];

  const orderSafe = ['updated_at', 'customer_id', 'status_type_id'].includes(orderBy)
    ? orderBy
    : 'updated_at';
  const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  if (status_type_id != null && Number.isFinite(Number(status_type_id))) {
    params.push(toNumOrNull(status_type_id));
    where.push(`${ALIAS}.status_type_id = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const lim = toNumOrNull(limit) ?? 50;
  const off = toNumOrNull(offset) ?? 0;

  params.push(lim);
  const limIdx = params.length;
  params.push(off);
  const offIdx = params.length;

  const sql = `
    SELECT
      ${ALIAS}.id,
      ${ALIAS}.customer_id,
      ${ALIAS}.status_type_id,
      ${ALIAS}.note,
      ${ALIAS}.updated_at,
      ${ALIAS}.updated_by,
      cst.name_pt       AS status_name_pt,
      cst.internal_code AS status_code,
      cst.color_hex     AS status_color_hex
    FROM ${TB} ${ALIAS}
    JOIN public."customerStatusTypes" cst
      ON cst.id = ${ALIAS}.status_type_id
    ${whereSql}
    ORDER BY ${ALIAS}."${orderSafe}" ${dir}
    LIMIT $${limIdx}
    OFFSET $${offIdx};
  `;

  const countSql = `
    SELECT COUNT(*)::INT AS total
    FROM ${TB} ${ALIAS}
    ${whereSql};
  `;

  const countParams = params.slice(0, params.length - 2);

  const [rowsRes, totalRes] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, countParams),
  ]);

  return {
    rows: rowsRes.rows.map(mapRowWithStatus),
    total: totalRes.rows[0]?.total ?? 0,
    limit: lim,
    offset: off,
  };
}

export default {
  ensureTable,
  create,
  updateById,
  getById,
  getByCustomerId,
  setStatusForCustomer,
  removeByCustomerId,
  list,
};
