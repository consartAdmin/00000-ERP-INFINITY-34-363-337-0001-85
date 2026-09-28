// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ customerSegmentsApi.js — Service (DB Access, ESM)                        ║
// ║ Tabela: public."customerSegments"                                        ║
// ║ ✅ segment_code gerado automaticamente: SEG-000001                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."customerSegments"';
export const ALIAS = 'cseg';
const nowSql = 'NOW()';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const toStrOrNull = (v) =>
  v === '' || v == null ? null : String(v);

const toBool = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'boolean') return v;

  const s = String(v).toLowerCase();

  if (['true', '1', 't', 'yes', 'y', 'sim', 's'].includes(s)) return true;
  if (['false', '0', 'f', 'no', 'n', 'nao', 'não'].includes(s)) return false;

  return null;
};

/**
 * Normaliza o payload externo.
 * IMPORTANTE:
 * - NÃO aceita segment_code no create/update.
 * - Código agora é controlado somente pelo backend.
 */
function normalizePayload(input = {}) {
  const out = {};

  if ('segment_name' in input) out.segment_name = toStrOrNull(input.segment_name);
  if ('description' in input) out.description = toStrOrNull(input.description);

  if ('is_active' in input) {
    const b = toBool(input.is_active);
    if (b !== null) out.is_active = b;
  }

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
        segment_id    BIGSERIAL PRIMARY KEY,
        segment_code  VARCHAR(30) UNIQUE,
        segment_name  VARCHAR(120) NOT NULL,
        description   TEXT,
        is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT ${nowSql},
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT ${nowSql}
      );
    `);

    // ✅ Para tabelas antigas que já tinham NOT NULL em segment_code
    await client.query(`
      ALTER TABLE ${TB}
      ALTER COLUMN segment_code DROP NOT NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customersegments_name
      ON ${TB} (LOWER(segment_name));
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_customersegments_active
      ON ${TB} (is_active);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customersegments_code_unique
      ON ${TB} (LOWER(segment_code))
      WHERE segment_code IS NOT NULL;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_timestamp_customersegments()
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
          EXECUTE FUNCTION set_timestamp_customersegments();
        END IF;
      END$$;
    `);

    await client.query(`
      DO $$
      DECLARE
        seq_name text;
        max_id   bigint;
      BEGIN
        SELECT pg_get_serial_sequence('${TB}', 'segment_id') INTO seq_name;

        IF seq_name IS NOT NULL THEN
          EXECUTE format('SELECT COALESCE(MAX(segment_id),0) FROM ${TB}')
          INTO max_id;

          EXECUTE format(
            'SELECT setval(%L, GREATEST(%s,1), true)',
            seq_name,
            max_id
          );
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ensureTable(customerSegments) error:', err.message);
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
  active,
  limit = 20,
  offset = 0
} = {}) {
  await ensureTable();

  const params = [];
  const whereParts = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    whereParts.push(`(
      LOWER(segment_name) LIKE $${params.length}
      OR LOWER(COALESCE(description,'')) LIKE $${params.length}
      OR LOWER(COALESCE(segment_code,'')) LIKE $${params.length}
    )`);
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
      ORDER BY segment_name ASC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)};
    `,
    params
  );

  return { rows, total, limit: Number(limit), offset: Number(offset) };
}

/* ──────────────────────────────────────────────────────────────
   getById()
────────────────────────────────────────────────────────────── */
export async function getById(id) {
  await ensureTable();

  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE segment_id = $1 LIMIT 1;`,
    [Number(id)]
  );

  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   create() — gera segment_code = SEG-000001
────────────────────────────────────────────────────────────── */
export async function create(input = {}) {
  await ensureTable();

  const data = normalizePayload(input);

  if (!data.segment_name) {
    throw new Error('segment_name is required.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const insertRes = await client.query(
      `
        INSERT INTO ${TB}
          (segment_code, segment_name, description, is_active)
        VALUES
          (NULL, $1, $2, COALESCE($3, TRUE))
        RETURNING *;
      `,
      [
        data.segment_name,
        data.description ?? null,
        data.is_active
      ]
    );

    const base = insertRes.rows[0];
    const code = `SEG-${String(base.segment_id).padStart(6, '0')}`;

    const updateRes = await client.query(
      `
        UPDATE ${TB}
        SET segment_code = $1, updated_at = ${nowSql}
        WHERE segment_id = $2
        RETURNING *;
      `,
      [code, base.segment_id]
    );

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ create(customerSegments) error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   update() — não altera segment_code
────────────────────────────────────────────────────────────── */
export async function update(id, input = {}) {
  await ensureTable();

  const data = normalizePayload(input);

  if (!Object.keys(data).length) {
    return getById(id);
  }

  const sets = [];
  const vals = [];

  Object.entries(data).forEach(([col, val]) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  });

  const sql = `
    UPDATE ${TB}
    SET ${sets.join(', ')}, updated_at = ${nowSql}
    WHERE segment_id = $${vals.length + 1}
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
    await pool.query(`DELETE FROM ${TB} WHERE segment_id = $1;`, [Number(id)]);
    return { ok: true, hard: true };
  }

  await pool.query(
    `
      UPDATE ${TB}
      SET is_active = FALSE, updated_at = ${nowSql}
      WHERE segment_id = $1;
    `,
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