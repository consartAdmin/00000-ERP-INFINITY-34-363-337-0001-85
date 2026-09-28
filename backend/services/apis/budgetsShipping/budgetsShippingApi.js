// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: services/apis/budgetsShipping/budgetsShippingApi.js          ║
// ║ MODULE: Budgets Shipping API                                       ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../../config/db.js';
import budgetsShippingSchema from './catalog_schema.budgetsShipping.js';

const {
  qualifiedName: TABLE,
  lookupKey: LOOKUP_KEY,
  columns: COLUMNS,
  selectColumns: SELECT_COLUMNS,
  writeColumns: WRITE_COLUMNS,
  api: API,
} = budgetsShippingSchema;

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;

  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;

  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = true) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const text = String(value).trim().toLowerCase();

  if (['true', 't', '1', 'yes', 'y', 'sim', 's', 'on'].includes(text)) return true;
  if (['false', 'f', '0', 'no', 'n', 'nao', 'não', 'off'].includes(text)) return false;

  return fallback;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  return text || null;
}

function onlyDigits(value) {
  const text = cleanText(value);
  if (!text) return null;

  return text.replace(/\D+/g, '') || null;
}

const NORMALIZERS = { toNumber, toInt, toBool, cleanText, onlyDigits };

// Columns filled from the request body (budget_id comes from the route param).
const BODY_COLUMNS = WRITE_COLUMNS.filter((column) => COLUMNS[column].source !== 'param');

for (const column of BODY_COLUMNS) {
  const { normalize } = COLUMNS[column];

  if (!NORMALIZERS[normalize]) {
    throw new Error(`[budgetsShippingApi] Unknown normalizer "${normalize}" for column "${column}".`);
  }
}

function pickValue(body, column) {
  const keys = [column, ...(COLUMNS[column].aliases || [])];

  for (const key of keys) {
    if (body[key] !== null && body[key] !== undefined) return body[key];
  }

  return undefined;
}

function normalizePayload(body = {}) {
  const data = {};

  for (const column of BODY_COLUMNS) {
    const { normalize, fallback = null } = COLUMNS[column];
    data[column] = NORMALIZERS[normalize](pickValue(body, column), fallback);
  }

  return data;
}

// ── SQL (built once from the catalog schema) ─────────────────────────

const SELECT_SQL = `
  SELECT
    ${SELECT_COLUMNS.join(',\n    ')}
  FROM ${TABLE}
  WHERE ${LOOKUP_KEY} = $1
  LIMIT 1
`;

const CONFLICT_TARGET = API.upsert.conflictTarget;

const UPDATE_ASSIGNMENTS = [
  ...WRITE_COLUMNS
    .filter((column) => !CONFLICT_TARGET.includes(column))
    .map((column) => `${column} = EXCLUDED.${column}`),
  ...Object.entries(API.upsert.touch || {}).map(([column, expr]) => `${column} = ${expr}`),
];

const UPSERT_SQL = `
  INSERT INTO ${TABLE} (
    ${WRITE_COLUMNS.join(',\n    ')}
  )
  VALUES (
    ${WRITE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}
  )
  ON CONFLICT (${CONFLICT_TARGET.join(', ')})
  DO UPDATE SET
    ${UPDATE_ASSIGNMENTS.join(',\n    ')}
  RETURNING ${API.upsert.returning || '*'}
`;

const DELETE_SQL = `
  DELETE FROM ${TABLE}
  WHERE ${LOOKUP_KEY} = $1
`;

// ── API ──────────────────────────────────────────────────────────────

export async function getByBudgetId(budgetId) {
  const { rows } = await pool.query(SELECT_SQL, [budgetId]);

  return rows[0] || null;
}

export async function upsert(budgetId, body = {}) {
  const data = normalizePayload(body);

  const params = WRITE_COLUMNS.map((column) =>
    column === LOOKUP_KEY ? budgetId : data[column]
  );

  const { rows } = await pool.query(UPSERT_SQL, params);

  return rows[0];
}

export async function remove(budgetId) {
  await pool.query(DELETE_SQL, [budgetId]);

  return true;
}
