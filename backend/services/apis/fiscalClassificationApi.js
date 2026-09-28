// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ fiscalClassificationApi.js — Classificação Fiscal (CONSART ERP, ESM)      ║
// ║ Alinhado ao catalog_schema.fiscalClassification.js                         ║
// ║ Tabelas: public."fiscalProfile" e public."fiscalClassification"            ║
// ╚════════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/* ──────────────────────────────────────────────────────────────
   Tabelas / Aliases (export p/ testes e outros módulos)
────────────────────────────────────────────────────────────── */
export const TB_PROFILE = 'public."fiscalProfile"';
export const ALIAS_PROFILE = 'fp';

export const TB = 'public."fiscalClassification"';
export const ALIAS = 'fc';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) => (isFiniteNum(v) ? Number(v) : null);
const toBool = (v) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null);

const normalizeRow = (r = {}) => ({
  fiscal_classification_id: r.fiscal_classification_id,
  classification_name: r.classification_name ?? null,
  description: r.description ?? null,

  // atuais
  ncm_code: r.ncm_code ?? null,
  cest_code: r.cest_code ?? null,
  ncm_description: r.ncm_description ?? null,
  cest_description: r.cest_description ?? null,
  fiscal_profile_id: r.fiscal_profile_id ?? null,
  fiscal_profile_name: r.fiscal_profile_name ?? r.profile_name ?? null,

  is_active: r.is_active ?? true,
  created_at: r.created_at ?? null,
  updated_at: r.updated_at ?? null,

  // 🔁 aliases p/ frontend legado
  ncm: r.ncm_code ?? null,
  cest: r.cest_code ?? null,
  profile_id: r.fiscal_profile_id ?? null,
  profile_name: r.fiscal_profile_name ?? r.profile_name ?? null
});

/* ──────────────────────────────────────────────────────────────
   DDL — garante estrutura idempotente
────────────────────────────────────────────────────────────── */
export async function ensureTable() {
  const client = await pool.connect();
  try {
    console.log('🧪 ensureTable() — fiscalProfile & fiscalClassification');
    await client.query('BEGIN');

    // 1) Tabela de Perfil Fiscal (mestre)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB_PROFILE} (
        fiscal_profile_id  SERIAL PRIMARY KEY,
        profile_name       TEXT NOT NULL,
        description        TEXT,
        is_active          BOOLEAN DEFAULT TRUE,
        created_at         TIMESTAMP DEFAULT NOW(),
        updated_at         TIMESTAMP DEFAULT NOW()
      );
    `);

    // Índice único case-insensitive no nome do perfil
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_fiscalprofile_profile_name_unique'
        ) THEN
          CREATE UNIQUE INDEX idx_fiscalprofile_profile_name_unique
            ON ${TB_PROFILE} (LOWER(profile_name));
        END IF;
      END$$;
    `);

    // 2) Tabela de Classificação Fiscal (detalhe) — colunas conforme seu schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        fiscal_classification_id  SERIAL PRIMARY KEY,

        -- 🏷️ Descritivo
        classification_name       VARCHAR(150) NOT NULL,
        description               TEXT,

        -- 🧮 Códigos fiscais
        ncm_code                  VARCHAR(10),
        cest_code                 VARCHAR(10),

        -- 📜 Descrições
        ncm_description           TEXT,
        cest_description          TEXT,

        -- ⚙️ Perfil fiscal vinculado
        fiscal_profile_id         INTEGER REFERENCES ${TB_PROFILE}(fiscal_profile_id) ON UPDATE CASCADE ON DELETE SET NULL,

        -- ⚖️ Status e Auditoria
        is_active                 BOOLEAN DEFAULT TRUE,
        created_at                TIMESTAMP DEFAULT NOW(),
        updated_at                TIMESTAMP DEFAULT NOW()
      );
    `);

    // Índices conforme seu schema
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_fiscalclassification_ncm'
        ) THEN
          CREATE INDEX idx_fiscalclassification_ncm ON ${TB} (ncm_code);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_fiscalclassification_cest'
        ) THEN
          CREATE INDEX idx_fiscalclassification_cest ON ${TB} (cest_code);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'idx_fiscalclassification_name_ci'
        ) THEN
          CREATE INDEX idx_fiscalclassification_name_ci ON ${TB} (LOWER(classification_name));
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   CRUD
────────────────────────────────────────────────────────────── */
export async function create(payload = {}) {
  const {
    classification_name,
    description,
    ncm_code,
    cest_code,
    ncm_description,
    cest_description,
    fiscal_profile_id,
    is_active
  } = payload;

  const sql = `
    INSERT INTO ${TB} (
      classification_name, description,
      ncm_code, cest_code,
      ncm_description, cest_description,
      fiscal_profile_id, is_active
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *;
  `;

  const values = [
    classification_name,
    description ?? null,
    ncm_code ?? null,
    cest_code ?? null,
    ncm_description ?? null,
    cest_description ?? null,
    toNumOrNull(fiscal_profile_id),
    is_active ?? true
  ];

  const { rows } = await pool.query(sql, values);
  return normalizeRow(rows[0]);
}

export async function update(id, payload = {}) {
  const sets = [];
  const vals = [];
  let i = 1;

  const add = (col, v) => {
    sets.push(`${col} = $${i++}`);
    vals.push(v);
  };

  if (payload.classification_name !== undefined) add('classification_name', payload.classification_name);
  if (payload.description !== undefined)        add('description', payload.description ?? null);
  if (payload.ncm_code !== undefined)           add('ncm_code', payload.ncm_code ?? null);
  if (payload.cest_code !== undefined)          add('cest_code', payload.cest_code ?? null);
  if (payload.ncm_description !== undefined)    add('ncm_description', payload.ncm_description ?? null);
  if (payload.cest_description !== undefined)   add('cest_description', payload.cest_description ?? null);
  if (payload.fiscal_profile_id !== undefined)  add('fiscal_profile_id', toNumOrNull(payload.fiscal_profile_id));
  if (payload.is_active !== undefined)          add('is_active', toBool(payload.is_active));

  add('updated_at', new Date());

  const sql = `
    UPDATE ${TB}
    SET ${sets.join(', ')}
    WHERE fiscal_classification_id = $${i}
    RETURNING *;
  `;
  vals.push(Number(id));

  const { rows } = await pool.query(sql, vals);
  return rows[0] ? normalizeRow(rows[0]) : null;
}

export async function getById(id) {
  const sql = `
    SELECT
      ${ALIAS}.*,
      ${ALIAS_PROFILE}.profile_name AS fiscal_profile_name
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PROFILE} ${ALIAS_PROFILE}
      ON ${ALIAS}.fiscal_profile_id = ${ALIAS_PROFILE}.fiscal_profile_id
    WHERE ${ALIAS}.fiscal_classification_id = $1;
  `;
  const { rows } = await pool.query(sql, [Number(id)]);
  return rows[0] ? normalizeRow(rows[0]) : null;
}

export async function list(params = {}) {
  const {
    q,
    limit = 20,
    offset = 0,
    orderBy = 'classification_name ASC'
  } = params;

  const where = [];
  const vals = [];
  let i = 1;

  if (q) {
    where.push(`(
      LOWER(${ALIAS}.classification_name) LIKE $${i}
      OR LOWER(${ALIAS}.ncm_code) LIKE $${i}
      OR LOWER(${ALIAS}.cest_code) LIKE $${i}
      OR LOWER(${ALIAS}.ncm_description) LIKE $${i}
      OR LOWER(${ALIAS}.cest_description) LIKE $${i}
      OR LOWER(${ALIAS_PROFILE}.profile_name) LIKE $${i}
    )`);
    vals.push(`%${String(q).toLowerCase()}%`);
    i++;
  }

  const sql = `
    SELECT
      ${ALIAS}.*,
      ${ALIAS_PROFILE}.profile_name AS fiscal_profile_name
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PROFILE} ${ALIAS_PROFILE}
      ON ${ALIAS}.fiscal_profile_id = ${ALIAS_PROFILE}.fiscal_profile_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderBy}
    LIMIT $${i++} OFFSET $${i};
  `;
  vals.push(Number(limit), Number(offset));

  const { rows } = await pool.query(sql, vals);

  const { rows: totalRows } = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PROFILE} ${ALIAS_PROFILE}
      ON ${ALIAS}.fiscal_profile_id = ${ALIAS_PROFILE}.fiscal_profile_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `, where.length ? [vals[0]] : []);

  return {
    rows: rows.map(normalizeRow),
    total: totalRows[0]?.total ?? 0,
    limit: Number(limit),
    offset: Number(offset)
  };
}

/** "Exclusão" simples — marca como inativo por padrão (soft delete). */
export async function remove(id, { hard = false } = {}) {
  if (hard) {
    await pool.query(`DELETE FROM ${TB} WHERE fiscal_classification_id = $1;`, [Number(id)]);
    return { ok: true, hard: true };
  }
  const { rowCount } = await pool.query(`
    UPDATE ${TB}
    SET is_active = FALSE, updated_at = NOW()
    WHERE fiscal_classification_id = $1
  `, [Number(id)]);
  return { ok: rowCount > 0, hard: false };
}
