// ╔══════════════════════════════════════════════════════════════════════╗
// ║ paymentFormsApi.js — Meios de Pagamento (DINHEIRO, PIX, BOLETO…)    ║
// ║ CONSART ERP | ESM + Postgres                                        ║
// ║ Tabela: public."paymentForms"                                       ║
// ║   - paymentForms_id (PK, SERIAL)                                    ║
// ║   - name            VARCHAR(50)                                     ║
// ║   - nfe_tpag        CHAR(2)   → código tPag NF-e                    ║
// ║   - active          BOOLEAN                                         ║
// ║   - created_at      TIMESTAMP                                       ║
// ║   - updated_at      TIMESTAMP                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TABLE = 'public."paymentForms"';
const PK = '"paymentForms_id"';

/* =========================================================================
 * Helpers internos
 * ========================================================================= */

function mapRow(row = {}) {
  if (!row) return null;

  return {
    paymentForms_id: row.paymentForms_id,
    name: row.name,
    nfe_tpag: row.nfe_tpag,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Normaliza tPag para sempre ter 2 dígitos (ex.: 1 → '01')
function normalizeTpag(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D+/g, '');
  if (!digits) return null;
  return digits.padStart(2, '0').slice(0, 2);
}

/* =========================================================================
 * SELECTs básicos
 * ========================================================================= */

export async function getById(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;

  const sql = `
    SELECT *
    FROM ${TABLE}
    WHERE ${PK} = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [numericId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getByTpag(nfe_tpag) {
  const tpag = normalizeTpag(nfe_tpag);
  if (!tpag) return null;

  const sql = `
    SELECT *
    FROM ${TABLE}
    WHERE nfe_tpag = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [tpag]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listAll({ activeOnly = false } = {}) {
  const params = [];
  const where = [];

  if (activeOnly) {
    params.push(true);
    where.push('active = $1');
  }

  const sql = `
    SELECT *
    FROM ${TABLE}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY name ASC;
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map(mapRow);
}

/* =========================================================================
 * INSERT / UPDATE
 * ========================================================================= */

export async function create({ name, nfe_tpag, active = true } = {}) {
  if (!name) {
    throw new Error('paymentForms.create: campo "name" é obrigatório.');
  }

  const tpag = normalizeTpag(nfe_tpag);
  if (!tpag) {
    throw new Error('paymentForms.create: campo "nfe_tpag" é obrigatório.');
  }

  const sql = `
    INSERT INTO ${TABLE} (name, nfe_tpag, active, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    RETURNING *;
  `;

  const values = [name.trim(), tpag, !!active];
  const { rows } = await pool.query(sql, values);
  return mapRow(rows[0]);
}

export async function update(id, { name, nfe_tpag, active } = {}) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new Error('paymentForms.update: id inválido.');
  }

  const sets = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(name.trim());
  }

  if (nfe_tpag !== undefined) {
    const tpag = normalizeTpag(nfe_tpag);
    if (!tpag) {
      throw new Error('paymentForms.update: nfe_tpag inválido.');
    }
    sets.push(`nfe_tpag = $${idx++}`);
    values.push(tpag);
  }

  if (active !== undefined) {
    sets.push(`active = $${idx++}`);
    values.push(!!active);
  }

  if (!sets.length) {
    // nada pra atualizar → apenas retorna o registro atual
    return getById(numericId);
  }

  sets.push(`updated_at = NOW()`);

  const sql = `
    UPDATE ${TABLE}
    SET ${sets.join(', ')}
    WHERE ${PK} = $${idx}
    RETURNING *;
  `;
  values.push(numericId);

  const { rows } = await pool.query(sql, values);
  return rows[0] ? mapRow(rows[0]) : null;
}

// "Delete" lógico (desativa o meio de pagamento)
export async function softDelete(id) {
  return update(id, { active: false });
}

/* =========================================================================
 * Export default (para import macro)
 * ========================================================================= */

const paymentFormsApi = {
  TABLE,
  getById,
  getByTpag,
  listAll,
  create,
  update,
  softDelete,
};

export default paymentFormsApi;
