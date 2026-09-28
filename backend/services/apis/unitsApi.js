// ╔══════════════════════════════════════════════════════════════════════╗
// ║ unitsApi.js — DAL Postgres para `public.units` (CONSART ERP | ESM)    ║
// ║ USO: import * as Units from '../services/apis/unitsApi.js'            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public.units';

const notEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const toInt = (v, def = null) => (v === undefined || v === null || v === '' ? def : parseInt(v, 10));
const toNum = (v, def = null) => (v === undefined || v === null || v === '' ? def : Number(v));

export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        unit_id     SERIAL PRIMARY KEY,
        unit        VARCHAR(50) NOT NULL UNIQUE,
        description VARCHAR(100),
        fator       NUMERIC(10,3) DEFAULT 1,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION public.trg_set_timestamp_units()
      RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_units') THEN
          CREATE TRIGGER set_timestamp_units
          BEFORE UPDATE ON ${TB}
          FOR EACH ROW
          EXECUTE PROCEDURE public.trg_set_timestamp_units();
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function list({ q, limit = 50, offset = 0, onlyActive } = {}) {
  const where = [];
  const values = [];
  let i = 1;

  if (notEmpty(q)) {
    where.push(`(LOWER(unit) LIKE LOWER($${i}) OR LOWER(COALESCE(description,'')) LIKE LOWER($${i}))`);
    values.push(`%${q.trim()}%`);
    i++;
  }

  if (onlyActive === true || onlyActive === 'true' || onlyActive === 1 || onlyActive === '1') {
    where.push(`is_active IS TRUE`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const lim = toInt(limit, 50) ?? 50;
  const off = toInt(offset, 0) ?? 0;

  const sql = `
    SELECT unit_id, unit, description, fator, is_active, created_at, updated_at
      FROM ${TB}
      ${whereSql}
     ORDER BY unit ASC
     LIMIT $${i++} OFFSET $${i++};
  `;
  values.push(lim, off);

  const countSql = `
    SELECT COUNT(*)::INT AS total
      FROM ${TB}
      ${whereSql};
  `;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, values),
    pool.query(countSql, values.slice(0, values.length - 2)),
  ]);

  return {
    rows: rowsRes.rows,
    total: countRes.rows[0]?.total ?? 0,
    limit: lim,
    offset: off,
  };
}

export async function getById(id) {
  const { rows } = await pool.query(
    `SELECT unit_id, unit, description, fator, is_active, created_at, updated_at
       FROM ${TB}
      WHERE unit_id = $1
      LIMIT 1;`,
    [Number(id)]
  );
  return rows[0] || null;
}

export async function create({ unit, description = null, fator = 1, is_active = true } = {}) {
  if (!notEmpty(unit)) throw new Error('Campo "unit" é obrigatório.');
  const u = unit.trim().toUpperCase();
  const f = toNum(fator, 1);
  if (!Number.isFinite(f) || f <= 0) throw new Error('Campo "fator" deve ser numérico > 0.');

  const { rows } = await pool.query(
    `INSERT INTO ${TB} (unit, description, fator, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING *;`,
    [u, description, f, !!is_active]
  );
  return rows[0];
}

export async function upsertByUnit({ unit, description = null, fator = 1, is_active = true } = {}) {
  if (!notEmpty(unit)) throw new Error('Campo "unit" é obrigatório.');
  const u = unit.trim().toUpperCase();
  const f = toNum(fator, 1);
  if (!Number.isFinite(f) || f <= 0) throw new Error('Campo "fator" deve ser numérico > 0.');

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB} (unit, description, fator, is_active)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (unit)
    DO UPDATE SET
      description = EXCLUDED.description,
      fator = EXCLUDED.fator,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *;
    `,
    [u, description, f, !!is_active]
  );
  return rows[0];
}

export async function update(id, patch = {}) {
  const sets = [];
  const values = [];
  let i = 1;

  if (patch.unit !== undefined) {
    if (!notEmpty(patch.unit)) throw new Error('Campo "unit" inválido.');
    sets.push(`unit = $${i++}`);
    values.push(String(patch.unit).trim().toUpperCase());
  }

  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(patch.description ?? null);
  }

  if (patch.fator !== undefined) {
    const f = toNum(patch.fator, null);
    if (f !== null && (!Number.isFinite(f) || f <= 0)) throw new Error('Campo "fator" deve ser numérico > 0.');
    sets.push(`fator = $${i++}`);
    values.push(f ?? 1);
  }

  if (patch.is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    values.push(!!patch.is_active);
  }

  if (!sets.length) throw new Error('Nada para atualizar.');

  const sql = `
    UPDATE ${TB}
       SET ${sets.join(', ')}, updated_at = NOW()
     WHERE unit_id = $${i}
     RETURNING *;
  `;
  values.push(Number(id));

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

export async function deactivate(id) {
  const { rows } = await pool.query(
    `UPDATE ${TB}
        SET is_active = FALSE, updated_at = NOW()
      WHERE unit_id = $1
      RETURNING *;`,
    [Number(id)]
  );
  return rows[0] || null;
}

export async function remove(id) {
  const res = await pool.query(`DELETE FROM ${TB} WHERE unit_id = $1`, [Number(id)]);
  return res.rowCount > 0;
}
