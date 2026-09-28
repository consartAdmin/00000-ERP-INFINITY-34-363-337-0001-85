// fiscalProfileApi.js — DB access for public."fiscalProfile" (ESM)
import pool from '../../config/db.js';

export const TB = 'public."fiscalProfile"';
export const ALIAS = 'fp';

const nowSql = 'NOW()';
const isFiniteNum = (value) => Number.isFinite(Number(value));
const toNumOrNull = (value) =>
  value === '' || value == null
    ? null
    : (isFiniteNum(value) ? Number(value) : null);
const toStrOrNull = (value) =>
  value === '' || value == null ? null : String(value).trim();
const digitsOrNull = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || null;
};

const STRING_FIELDS = Object.freeze([
  'profile_name',
  'description',
  'icms_cst',
  'cfop_entry',
  'cfop_exit',
  'origin_code',
  'pis_cst',
  'cofins_cst',
  'benefit_code',
  'is_unit',
]);

const NUMERIC_FIELDS = Object.freeze([
  'icms_rate',
  'pis_rate',
  'cofins_rate',
  'is_rate',
  'is_specific_rate',
  'ibs_uf_rate',
  'ibs_municipal_rate',
  'cbs_rate',
  'donation_indicator',
]);

const REFORMA_CODE_FIELDS = Object.freeze({
  is_cst: { max: 3, label: 'IS CST' },
  is_classification: { max: 10, label: 'IS classification' },
  ibscbs_cst: { exact: 3, label: 'IBS/CBS CST' },
  ibscbs_classification: { exact: 6, label: 'IBS/CBS classification' },
});

function normalizeJsonObject(value, fieldName) {
  if (value == null || value === '') return {};

  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${fieldName} must contain valid JSON`);
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }

  return parsed;
}

function normalizePayload(input = {}) {
  const out = {};

  for (const field of STRING_FIELDS) {
    if (field in input) out[field] = toStrOrNull(input[field]);
  }

  for (const field of NUMERIC_FIELDS) {
    if (field in input) out[field] = toNumOrNull(input[field]);
  }

  for (const [field, rule] of Object.entries(REFORMA_CODE_FIELDS)) {
    if (!(field in input)) continue;

    const value = digitsOrNull(input[field]);
    if (value && rule.exact && value.length !== rule.exact) {
      throw new Error(`${rule.label} must have exactly ${rule.exact} digits`);
    }
    if (value && rule.max && value.length > rule.max) {
      throw new Error(`${rule.label} must have at most ${rule.max} digits`);
    }
    out[field] = value;
  }

  if ('donation_indicator' in out && ![0, 1, null].includes(out.donation_indicator)) {
    throw new Error('donation_indicator must be 0 or 1');
  }

  if ('tax_reform_details' in input) {
    out.tax_reform_details = normalizeJsonObject(
      input.tax_reform_details,
      'tax_reform_details',
    );
  }

  if ('is_active' in input) {
    const value = input.is_active;
    out.is_active = typeof value === 'string'
      ? ['true', '1', 't', 'yes', 'y'].includes(value.toLowerCase())
      : Boolean(value);
  }

  return out;
}

export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        fiscal_profile_id SERIAL PRIMARY KEY,
        profile_name VARCHAR(100) NOT NULL,
        description TEXT,
        icms_cst VARCHAR(10),
        icms_rate NUMERIC(10,2),
        cfop_entry VARCHAR(10),
        cfop_exit VARCHAR(10),
        origin_code VARCHAR(5),
        pis_cst VARCHAR(10),
        pis_rate NUMERIC(10,2),
        cofins_cst VARCHAR(10),
        cofins_rate NUMERIC(10,2),
        benefit_code VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT ${nowSql},
        updated_at TIMESTAMP DEFAULT ${nowSql}
      );
    `);

    await client.query(`
      ALTER TABLE ${TB}
        ADD COLUMN IF NOT EXISTS is_cst VARCHAR(3),
        ADD COLUMN IF NOT EXISTS is_classification VARCHAR(10),
        ADD COLUMN IF NOT EXISTS is_rate NUMERIC(9,4) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS is_specific_rate NUMERIC(15,6) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS is_unit VARCHAR(6) DEFAULT 'UN',
        ADD COLUMN IF NOT EXISTS ibscbs_cst VARCHAR(3),
        ADD COLUMN IF NOT EXISTS ibscbs_classification VARCHAR(6),
        ADD COLUMN IF NOT EXISTS ibs_uf_rate NUMERIC(9,4) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ibs_municipal_rate NUMERIC(9,4) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cbs_rate NUMERIC(9,4) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS donation_indicator SMALLINT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS tax_reform_details JSONB
          NOT NULL DEFAULT '{}'::jsonb;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscalprofile_profile_name_unique
      ON ${TB} (LOWER(profile_name));
      CREATE INDEX IF NOT EXISTS idx_fiscalprofile_ibscbs_cst
      ON ${TB} (ibscbs_cst);
      CREATE INDEX IF NOT EXISTS idx_fiscalprofile_ibscbs_classification
      ON ${TB} (ibscbs_classification);
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_timestamp()
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
          FOR EACH ROW EXECUTE FUNCTION set_timestamp();
        END IF;
      END $$;
    `);

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('${TB}', 'fiscal_profile_id'),
        COALESCE(MAX(fiscal_profile_id), 1),
        MAX(fiscal_profile_id) IS NOT NULL
      )
      FROM ${TB};
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function list({ q = '', limit = 20, offset = 0 } = {}) {
  await ensureTable();
  const safeLimit = Number.isInteger(Number(limit))
    ? Math.min(100, Math.max(1, Number(limit)))
    : 20;
  const safeOffset = Number.isInteger(Number(offset))
    ? Math.max(0, Number(offset))
    : 0;
  const params = [];
  let where = 'WHERE is_active IS TRUE';

  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    where += ` AND (
      LOWER(profile_name) LIKE $1
      OR LOWER(COALESCE(description, '')) LIKE $1
    )`;
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${TB} ${where}`,
    params,
  );
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const { rows } = await pool.query(
    `SELECT * FROM ${TB} ${where}
     ORDER BY updated_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [...params, safeLimit, safeOffset],
  );

  return {
    rows,
    total: countRes.rows[0]?.total ?? 0,
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function getById(id) {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE fiscal_profile_id = $1 LIMIT 1`,
    [Number(id)],
  );
  return rows[0] || null;
}

async function create(input = {}) {
  await ensureTable();
  const data = normalizePayload(input);
  if (!data.profile_name) throw new Error('profile_name is required');

  const cols = Object.keys(data);
  const vals = Object.values(data);
  const params = vals.map((_, index) => `$${index + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO ${TB} (${cols.join(', ')})
     VALUES (${params.join(', ')}) RETURNING *`,
    vals,
  );
  return rows[0];
}

async function update(id, input = {}) {
  await ensureTable();
  const data = normalizePayload(input);
  if (!Object.keys(data).length) return getById(id);

  const vals = [];
  const sets = Object.entries(data).map(([col, value]) => {
    vals.push(value);
    return `${col} = $${vals.length}`;
  });
  const { rows } = await pool.query(
    `UPDATE ${TB}
     SET ${sets.join(', ')}, updated_at = ${nowSql}
     WHERE fiscal_profile_id = $${vals.length + 1}
     RETURNING *`,
    [...vals, Number(id)],
  );
  return rows[0] || null;
}

async function remove(id, { hard = false } = {}) {
  await ensureTable();
  if (hard) {
    await pool.query(`DELETE FROM ${TB} WHERE fiscal_profile_id = $1`, [Number(id)]);
    return { ok: true, hard: true };
  }
  await pool.query(
    `UPDATE ${TB}
     SET is_active = FALSE, updated_at = ${nowSql}
     WHERE fiscal_profile_id = $1`,
    [Number(id)],
  );
  return { ok: true, hard: false };
}

export default { ensureTable, list, getById, create, update, remove };