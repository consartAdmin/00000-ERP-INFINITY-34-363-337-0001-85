// ╔════════════════════════════════════════════════════════════════════╗
// ║ customerStatusTypesApi.js — DAL Customer Status Types (Postgres)  ║
// ║ Tabela: public."customerStatusTypes"                              ║
// ║ Endpoints: ensureTable, CRUD, list, search                        ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."customerStatusTypes"';
const ALIAS = 'cst';

// Utils
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) => (isFiniteNum(v) ? Number(v) : null);
const trimOrNull = (v) => (v ?? '').toString().trim() || null;

// Normaliza linha completa
const mapRow = (r) => ({
  id: r.id,
  name_pt: r.name_pt,
  internal_code: r.internal_code,
  description_en: r.description_en,
  color_hex: r.color_hex,
  sort_order: r.sort_order,
  is_active: r.is_active,
});

// Projeção leve para dropdowns/combos
const mapSearchRow = (r) => ({
  id: r.id,
  name_pt: r.name_pt,
  internal_code: r.internal_code,
  color_hex: r.color_hex,
});

// Campos válidos para insert/update
const FIELDS = [
  'name_pt',
  'internal_code',
  'description_en',
  'color_hex',
  'sort_order',
  'is_active',
];

/* ──────────────────────────────────────────────────────────
   Sanitização para CREATE e UPDATE
────────────────────────────────────────────────────────── */

function sanitizeCreate(input = {}) {
  const out = {};

  for (const k of FIELDS) {
    let v = input[k];

    if (['name_pt', 'internal_code', 'description_en', 'color_hex'].includes(k)) {
      v = trimOrNull(v);
    }

    if (k === 'sort_order') {
      v = toNumOrNull(v);
    }

    if (k === 'is_active') {
      if (typeof v === 'boolean') {
        // ok
      } else if (v === 'true') {
        v = true;
      } else if (v === 'false') {
        v = false;
      } else {
        v = null;
      }
    }

    out[k] = v ?? null;
  }

  if (!out.is_active && out.is_active !== false) out.is_active = true;
  if (!out.sort_order && out.sort_order !== 0) out.sort_order = 0;

  return out;
}

function sanitizeUpdate(input = {}) {
  const out = {};

  for (const k of Object.keys(input)) {
    if (!FIELDS.includes(k)) continue;
    let v = input[k];

    if (['name_pt', 'internal_code', 'description_en', 'color_hex'].includes(k)) {
      v = trimOrNull(v);
    }

    if (k === 'sort_order') {
      v = toNumOrNull(v);
    }

    if (k === 'is_active') {
      if (typeof v === 'boolean') {
        // ok
      } else if (v === 'true') {
        v = true;
      } else if (v === 'false') {
        v = false;
      } else {
        v = null;
      }
    }

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
      CREATE TABLE IF NOT EXISTS public."customerStatusTypes" (
        id              SERIAL       PRIMARY KEY,
        name_pt         VARCHAR(80)  NOT NULL,
        internal_code   VARCHAR(40)  NOT NULL UNIQUE,
        description_en  TEXT,
        color_hex       VARCHAR(7),
        sort_order      SMALLINT     NOT NULL DEFAULT 0,
        is_active       BOOLEAN      NOT NULL DEFAULT TRUE
      );
    `);

    // ✅ Index idempotente de verdade (sem DO $$ e sem erro 42P07)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customerStatusTypes_sort_order
      ON public."customerStatusTypes" (sort_order);
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[customerStatusTypesApi.ensureTable] error:', err);
    throw err;
  } finally {
    client.release();
  }
}

/** CREATE */
export async function create(payload) {
  const data = sanitizeCreate(payload);

  if (!data.name_pt) throw new Error('name_pt is required');
  if (!data.internal_code) throw new Error('internal_code is required');

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
  return mapRow(rows[0]);
}

/** UPDATE BY ID */
export async function updateById(id, payload) {
  const sid = toNumOrNull(id);
  if (!sid) throw new Error('invalid status type id');

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
  if (!sid) throw new Error('invalid status type id');

  const { rows } = await pool.query(`SELECT * FROM ${TB} WHERE id = $1`, [sid]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** DELETE — soft por padrão (is_active = false) */
export async function removeById(id, { hard = false } = {}) {
  const sid = toNumOrNull(id);
  if (!sid) throw new Error('invalid status type id');

  if (hard) {
    const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE id = $1`, [sid]);
    return { ok: rowCount > 0, hard: true };
  }

  const { rowCount } = await pool.query(
    `UPDATE ${TB} SET is_active = FALSE WHERE id = $1`,
    [sid],
  );
  return { ok: rowCount > 0, hard: false };
}

/** LIST — p/ grids e administração */
export async function list({
  q,
  is_active,
  limit = 50,
  offset = 0,
  orderBy = 'sort_order',
  order = 'asc',
} = {}) {
  const params = [];
  const where = [];

  const orderSafe = ['name_pt', 'internal_code', 'sort_order'].includes(orderBy)
    ? orderBy
    : 'sort_order';
  const dir = String(order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  if (typeof is_active === 'boolean') {
    params.push(is_active);
    where.push(`${ALIAS}.is_active = $${params.length}`);
  }

  if (q && String(q).trim()) {
    const norm = `%${String(q).toLowerCase().trim()}%`;
    params.push(norm, norm);
    where.push(`(
      LOWER(${ALIAS}.name_pt) LIKE $${params.length - 1}
      OR LOWER(${ALIAS}.internal_code) LIKE $${params.length}
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(toNumOrNull(limit) ?? 50);
  params.push(toNumOrNull(offset) ?? 0);

  const sql = `
    SELECT * 
    FROM ${TB} ${ALIAS}
    ${whereSql}
    ORDER BY ${ALIAS}."${orderSafe}" ${dir}
    LIMIT $${params.length - 1}
    OFFSET $${params.length};
  `;

  const countSql = `
    SELECT COUNT(*)::INT AS total
    FROM ${TB} ${ALIAS}
    ${whereSql};
  `;

  const [rowsRes, totalRes] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, params.slice(0, params.length - 2)),
  ]);

  return {
    rows: rowsRes.rows.map(mapRow),
    total: totalRes.rows[0]?.total ?? 0,
    limit: toNumOrNull(limit) ?? 50,
    offset: toNumOrNull(offset) ?? 0,
  };
}

/** SEARCH — leve, ideal para dropdowns / selects */
export async function search({ q, is_active = true, limit = 20, offset = 0 } = {}) {
  const params = [];
  const where = [];

  params.push(!!is_active);
  where.push(`${ALIAS}.is_active = $${params.length}`);

  if (q && String(q).trim()) {
    const norm = `%${String(q).toLowerCase().trim()}%`;
    params.push(norm, norm);
    where.push(`(
      LOWER(${ALIAS}.name_pt) LIKE $${params.length - 1}
      OR LOWER(${ALIAS}.internal_code) LIKE $${params.length}
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(toNumOrNull(limit) ?? 20);
  const limIdx = params.length;
  params.push(toNumOrNull(offset) ?? 0);
  const offIdx = params.length;

  const sql = `
    SELECT
      ${ALIAS}.id,
      ${ALIAS}.name_pt,
      ${ALIAS}.internal_code,
      ${ALIAS}.color_hex
    FROM ${TB} ${ALIAS}
    ${whereSql}
    ORDER BY ${ALIAS}."sort_order" ASC, LOWER(${ALIAS}.name_pt) ASC
    LIMIT $${limIdx}
    OFFSET $${offIdx};
  `;

  const { rows } = await pool.query(sql, params);
  return {
    rows: rows.map(mapSearchRow),
    limit: toNumOrNull(limit) ?? 20,
    offset: toNumOrNull(offset) ?? 0,
  };
}

export default {
  ensureTable,
  create,
  updateById,
  getById,
  removeById,
  list,
  search,
};
