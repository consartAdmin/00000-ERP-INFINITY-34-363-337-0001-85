// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ customerSubSegmentsApi.js — Service (DB Access, ESM)                     ║
// ║ Tabela: public."customerSubSegments"                                     ║
// ║ subsegment_code gerado automaticamente: SUB-{subsegment_id}              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."customerSubSegments"';
export const ALIAS = 'csubseg';
const nowSql = 'NOW()';

const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) =>
  v === '' || v == null ? null : isFiniteNum(v) ? Number(v) : null;
const toStrOrNull = (v) =>
  v === '' || v == null ? null : String(v);
const toBool = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['true', '1', 't', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'f', 'no', 'n'].includes(s)) return false;
  return null;
};

/**
 * Normaliza payload.
 * subsegment_code NÃO é aceito para evitar edição manual.
 */
function normalizePayload(input = {}) {
  const out = {};

  if ('segment_id' in input) out.segment_id = toNumOrNull(input.segment_id);
  if ('subsegment_name' in input) out.subsegment_name = toStrOrNull(input.subsegment_name);
  if ('description' in input) out.description = toStrOrNull(input.description);

  if ('is_active' in input) {
    const b = toBool(input.is_active);
    if (b !== null) out.is_active = b;
  }

  if ('version' in input) out.version = toNumOrNull(input.version);
  if ('source_system' in input) out.source_system = toStrOrNull(input.source_system);
  if ('source_hash' in input) out.source_hash = toStrOrNull(input.source_hash);

  return out;
}

/* ──────────────────────────────────────────────────────────────
   ensureTable()
────────────────────────────────────────────────────────────── */
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        subsegment_id   SERIAL PRIMARY KEY,
        segment_id      INTEGER      NOT NULL,
        subsegment_name VARCHAR(160) NOT NULL,
        subsegment_code VARCHAR(40)  UNIQUE,
        description     TEXT,
        is_active       BOOLEAN      DEFAULT TRUE,
        created_at      TIMESTAMP    DEFAULT ${nowSql},
        updated_at      TIMESTAMP    DEFAULT ${nowSql},
        version         INTEGER      DEFAULT 1,
        source_system   VARCHAR(50),
        source_hash     VARCHAR(120)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customersubsegments_name
      ON ${TB} (LOWER(subsegment_name));
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customersubsegments_segment
      ON ${TB} (segment_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customersubsegments_active
      ON ${TB} (is_active);
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_timestamp_customersubsegments()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_${ALIAS}_set_timestamp'
        ) THEN
          CREATE TRIGGER trg_${ALIAS}_set_timestamp
          BEFORE UPDATE ON ${TB}
          FOR EACH ROW
          EXECUTE FUNCTION set_timestamp_customersubsegments();
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ensureTable(customerSubSegments) error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   list()
────────────────────────────────────────────────────────────── */
export async function list({
  q = '',
  segment_id,
  active,
  limit = 20,
  offset = 0
} = {}) {
  await ensureTable();
  const params = [];
  const whereParts = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    whereParts.push(`(LOWER(subsegment_name) LIKE $${params.length}
                     OR LOWER(COALESCE(description,'')) LIKE $${params.length})`);
  }

  if (segment_id) {
    params.push(Number(segment_id));
    whereParts.push(`segment_id = $${params.length}`);
  }

  const bActive = toBool(active);
  if (bActive !== null) {
    params.push(bActive);
    whereParts.push(`is_active = $${params.length}`);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${TB} ${whereSql};`,
    params
  );
  const total = countRes.rows?.[0]?.total || 0;

  const { rows } = await pool.query(
    `
      SELECT *
      FROM ${TB}
      ${whereSql}
      ORDER BY subsegment_name ASC
      LIMIT ${limit} OFFSET ${offset};
    `,
    params
  );

  return { rows, total, limit, offset };
}

/* ──────────────────────────────────────────────────────────────
   getById()
────────────────────────────────────────────────────────────── */
export async function getById(id) {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE subsegment_id = $1 LIMIT 1;`,
    [Number(id)]
  );
  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   create() — gera subsegment_code = SUB-{id}
────────────────────────────────────────────────────────────── */
export async function create(input = {}) {
  await ensureTable();
  const data = normalizePayload(input);

  if (!data.segment_id) {
    throw new Error('segment_id is required.');
  }
  if (!data.subsegment_name) {
    throw new Error('subsegment_name is required.');
  }

  const cols = Object.keys(data);
  const vals = Object.values(data);
  const params = vals.map((_, i) => `$${i + 1}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertSql = `
      INSERT INTO ${TB} (${cols.join(', ')})
      VALUES (${params.join(', ')})
      RETURNING *;
    `;
    const insertRes = await client.query(insertSql, vals);
    const base = insertRes.rows[0];

    const code = `SUB-${String(base.subsegment_id).padStart(6, '0')}`;

    const updateRes = await client.query(
      `
        UPDATE ${TB}
        SET subsegment_code = $1, updated_at = ${nowSql}
        WHERE subsegment_id = $2
        RETURNING *;
      `,
      [code, base.subsegment_id]
    );

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ create(customerSubSegments) error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   update() — não altera subsegment_code
────────────────────────────────────────────────────────────── */
export async function update(id, input = {}) {
  await ensureTable();
  const data = normalizePayload(input);
  if (!Object.keys(data).length) return getById(id);

  const sets = [];
  const vals = [];

  Object.entries(data).forEach(([col, val]) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  });

  const sql = `
    UPDATE ${TB}
    SET ${sets.join(', ')}, updated_at = ${nowSql}
    WHERE subsegment_id = $${vals.length + 1}
    RETURNING *;
  `;
  const { rows } = await pool.query(sql, [...vals, Number(id)]);
  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   remove()
────────────────────────────────────────────────────────────── */
export async function remove(id, { hard = false } = {}) {
  await ensureTable();
  if (hard) {
    await pool.query(`DELETE FROM ${TB} WHERE subsegment_id = $1;`, [Number(id)]);
    return { ok: true, hard: true };
  }
  await pool.query(
    `UPDATE ${TB} SET is_active = FALSE, updated_at = ${nowSql} WHERE subsegment_id = $1;`,
    [Number(id)]
  );
  return { ok: true, hard: false };
}

export default {
  ensureTable,
  list,
  getById,
  create,
  update,
  remove
};
