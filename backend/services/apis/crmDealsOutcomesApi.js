/* ╔══════════════════════════════════════════════════════════════════════╗
 * ║ crmDealsOutcomesApi.js                                              ║
 * ║ CONSART ERP — API de catálogo de resultados de negociações CRM      ║
 * ║                                                                      ║
 * ║ Responsabilidades:                                                  ║
 * ║ • Listar outcomes                                                   ║
 * ║ • Buscar por id / code                                              ║
 * ║ • Criar / atualizar / remover                                       ║
 * ║ • Listar operações concluídas por outcome                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import pool from '../../config/db.js';

/* =======================================================================
 * CONFIG
 * ======================================================================= */

const TABLE = '"crmDealsOutcomes"';
const DEALS_TABLE = '"crmDeals"';
const STAGES_TABLE = '"crmDealsStages"';

const FIELDS = [
  'name',
  'icon',
  'color',
  'sort_order',
  'is_active',
  'code',
  'outcome_type'
];

const SEARCH_FIELDS = ['name', 'code', 'outcome_type'];
const DEFAULT_ORDER = 'sort_order ASC, name ASC';

/* =======================================================================
 * HELPERS
 * ======================================================================= */

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;

  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;

  return fallback;
}

function normalizeInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const v = String(value).trim();
  return v ? v : fallback;
}

function buildSearchClause(q, startIndex = 1) {
  const term = normalizeText(q, '');
  if (!term) return { clause: '', values: [] };

  const values = [];
  const parts = [];

  SEARCH_FIELDS.forEach((field, idx) => {
    values.push(`%${term}%`);
    parts.push(`${field} ILIKE $${startIndex + idx}`);
  });

  return {
    clause: `(${parts.join(' OR ')})`,
    values
  };
}

function mapOutcomePayload(payload = {}) {
  return {
    name: normalizeText(payload.name, ''),
    icon: normalizeText(payload.icon, null),
    color: normalizeText(payload.color, '#7ED321'),
    sort_order: normalizeInteger(payload.sort_order, 0),
    is_active: normalizeBoolean(payload.is_active, true),
    code: normalizeText(payload.code, null),
    outcome_type: normalizeText(payload.outcome_type, null)
  };
}

function validateOutcomePayload(data, { partial = false } = {}) {
  const errors = [];

  if (!partial || Object.prototype.hasOwnProperty.call(data, 'name')) {
    if (!normalizeText(data.name, '')) {
      errors.push('O campo "name" é obrigatório.');
    }
  }

  return errors;
}

/* =======================================================================
 * CRUD
 * ======================================================================= */

export async function listCrmDealsOutcomes({
  q = '',
  is_active,
  limit = 100,
  offset = 0
} = {}) {
  const where = [];
  const values = [];

  if (is_active !== undefined && is_active !== null && is_active !== '') {
    values.push(normalizeBoolean(is_active, true));
    where.push(`is_active = $${values.length}`);
  }

  const search = buildSearchClause(q, values.length + 1);
  if (search.clause) {
    values.push(...search.values);
    where.push(search.clause);
  }

  values.push(normalizeInteger(limit, 100));
  const limitIndex = values.length;

  values.push(normalizeInteger(offset, 0));
  const offsetIndex = values.length;

  const sql = `
    SELECT
      id,
      name,
      icon,
      color,
      sort_order,
      is_active,
      created_at,
      code,
      outcome_type
    FROM ${TABLE}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${DEFAULT_ORDER}
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM ${TABLE}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `;

  const countValues = values.slice(0, values.length - 2);

  const [rowsResult, countResult] = await Promise.all([
    pool.query(sql, values),
    pool.query(countSql, countValues)
  ]);

  return {
    items: rowsResult.rows,
    total: countResult.rows[0]?.total || 0,
    limit: normalizeInteger(limit, 100),
    offset: normalizeInteger(offset, 0)
  };
}

export async function getCrmDealsOutcomeById(id) {
  const sql = `
    SELECT
      id,
      name,
      icon,
      color,
      sort_order,
      is_active,
      created_at,
      code,
      outcome_type
    FROM ${TABLE}
    WHERE id = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [normalizeInteger(id, 0)]);
  return rows[0] || null;
}

export async function getCrmDealsOutcomeByCode(code) {
  const sql = `
    SELECT
      id,
      name,
      icon,
      color,
      sort_order,
      is_active,
      created_at,
      code,
      outcome_type
    FROM ${TABLE}
    WHERE code = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [normalizeText(code, '')]);
  return rows[0] || null;
}

export async function createCrmDealsOutcome(payload = {}) {
  const data = mapOutcomePayload(payload);
  const errors = validateOutcomePayload(data);

  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.statusCode = 400;
    throw err;
  }

  const sql = `
    INSERT INTO ${TABLE} (
      name,
      icon,
      color,
      sort_order,
      is_active,
      code,
      outcome_type
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING
      id,
      name,
      icon,
      color,
      sort_order,
      is_active,
      created_at,
      code,
      outcome_type
  `;

  const values = [
    data.name,
    data.icon,
    data.color,
    data.sort_order,
    data.is_active,
    data.code,
    data.outcome_type
  ];

  const { rows } = await pool.query(sql, values);
  return rows[0];
}

export async function updateCrmDealsOutcome(id, payload = {}) {
  const current = await getCrmDealsOutcomeById(id);

  if (!current) {
    const err = new Error('Outcome não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  const merged = {
    ...current,
    ...payload
  };

  const data = mapOutcomePayload(merged);
  const errors = validateOutcomePayload(data, { partial: false });

  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.statusCode = 400;
    throw err;
  }

  const sql = `
    UPDATE ${TABLE}
    SET
      name = $1,
      icon = $2,
      color = $3,
      sort_order = $4,
      is_active = $5,
      code = $6,
      outcome_type = $7
    WHERE id = $8
    RETURNING
      id,
      name,
      icon,
      color,
      sort_order,
      is_active,
      created_at,
      code,
      outcome_type
  `;

  const values = [
    data.name,
    data.icon,
    data.color,
    data.sort_order,
    data.is_active,
    data.code,
    data.outcome_type,
    normalizeInteger(id, 0)
  ];

  const { rows } = await pool.query(sql, values);
  return rows[0];
}

export async function deleteCrmDealsOutcome(id) {
  const sql = `
    DELETE FROM ${TABLE}
    WHERE id = $1
    RETURNING id, name, code
  `;

  const { rows } = await pool.query(sql, [normalizeInteger(id, 0)]);
  return rows[0] || null;
}

/* =======================================================================
 * SUMMARY
 * ======================================================================= */

export async function listCrmDealsOutcomesSummary() {
  const sql = `
    SELECT
      o.id,
      o.name,
      o.icon,
      o.color,
      o.sort_order,
      o.is_active,
      o.created_at,
      o.code,
      o.outcome_type,
      COUNT(d.id)::int AS deals_count,
      COALESCE(SUM(COALESCE(d.value, 0)), 0)::numeric AS total_value
    FROM ${TABLE} o
    LEFT JOIN ${DEALS_TABLE} d
      ON d.outcome_id = o.id
     AND COALESCE(d.is_closed, false) = true
    WHERE o.is_active = true
    GROUP BY
      o.id, o.name, o.icon, o.color, o.sort_order,
      o.is_active, o.created_at, o.code, o.outcome_type
    ORDER BY o.sort_order ASC, o.name ASC
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

/* =======================================================================
 * OPERATIONS BY OUTCOME
 * ======================================================================= */

export async function listOperationsByOutcomeCode(code) {
  const outcome = await getCrmDealsOutcomeByCode(code);

  if (!outcome) {
    const err = new Error('Conclusão não encontrada.');
    err.statusCode = 404;
    throw err;
  }

  const sql = `
    SELECT
      d.id,

      COALESCE(
        NULLIF(TRIM(d.tag), ''),
        NULLIF(TRIM(d.next_step), ''),
        CONCAT('Negociação #', d.id::text)
      ) AS title,

      d.customer_id,
      d.seller_id,
      d.stage_id,
      d.outcome_id,

      COALESCE(d.estimated_value, 0)::numeric AS value,

      d.outcome_at AS closed_at,
      d.updated_at,
      d.created_at,

      COALESCE(
        NULLIF(TRIM(d.customer_name), ''),
        'Sem cliente'
      ) AS customer_name,

      COALESCE(
        NULLIF(TRIM(d.seller_name), ''),
        'Sem vendedor'
      ) AS seller_name,

      COALESCE(
        NULLIF(TRIM(s.stage_name), ''),
        NULLIF(TRIM(s.code), ''),
        'Sem etapa'
      ) AS stage_name,

      o.name AS outcome_name,
      o.code AS outcome_code,

      d.loss_reason_id,
      d.loss_notes AS note
    FROM ${DEALS_TABLE} d
    INNER JOIN ${TABLE} o
      ON o.id = d.outcome_id
    LEFT JOIN ${STAGES_TABLE} s
      ON s.id = d.stage_id
    WHERE o.code = $1
      AND COALESCE(d.is_closed, false) = true
    ORDER BY d.outcome_at DESC NULLS LAST, d.id DESC
  `;

  const { rows } = await pool.query(sql, [code]);

  const totalValue = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);

  return {
    outcome,
    total: rows.length,
    totalValue,
    rows
  };
}

export async function listOperationsByOutcomeId(outcomeId) {
  const outcome = await getCrmDealsOutcomeById(outcomeId);

  if (!outcome) {
    const err = new Error('Conclusão não encontrada.');
    err.statusCode = 404;
    throw err;
  }

  const sql = `
    SELECT
      d.id,

      COALESCE(
        NULLIF(TRIM(d.tag), ''),
        NULLIF(TRIM(d.next_step), ''),
        CONCAT('Negociação #', d.id::text)
      ) AS title,

      d.customer_id,
      d.seller_id,
      d.stage_id,
      d.outcome_id,

      COALESCE(d.estimated_value, 0)::numeric AS value,

      d.outcome_at AS closed_at,
      d.updated_at,
      d.created_at,

      COALESCE(
        NULLIF(TRIM(d.customer_name), ''),
        'Sem cliente'
      ) AS customer_name,

      COALESCE(
        NULLIF(TRIM(d.seller_name), ''),
        'Sem vendedor'
      ) AS seller_name,

      COALESCE(
        NULLIF(TRIM(s.stage_name), ''),
        NULLIF(TRIM(s.code), ''),
        'Sem etapa'
      ) AS stage_name,

      o.name AS outcome_name,
      o.code AS outcome_code,

      d.loss_reason_id,
      d.loss_notes AS note
    FROM ${DEALS_TABLE} d
    INNER JOIN ${TABLE} o
      ON o.id = d.outcome_id
    LEFT JOIN ${STAGES_TABLE} s
      ON s.id = d.stage_id
    WHERE o.id = $1
      AND COALESCE(d.is_closed, false) = true
    ORDER BY d.outcome_at DESC NULLS LAST, d.id DESC
  `;

  const { rows } = await pool.query(sql, [normalizeInteger(outcomeId, 0)]);

  const totalValue = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);

  return {
    outcome,
    total: rows.length,
    totalValue,
    rows
  };
}