// ╔══════════════════════════════════════════════════════════════════════╗
// ║ budgetSettingsApi.js — Parâmetros globais dos Orçamentos             ║
// ║ CONSART ERP | PostgreSQL | ESM                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  TABLE,
  SETTINGS_ID,
  OUT_OF_STOCK_MODES,
  MAX_DISCOUNT_PERCENT_RANGE,
  UPDATED_BY_MAX_LENGTH,
  COLUMN_NAMES,
  DEFAULTS,
} from '../../../repositories/budgetSettings/budgetSettings.catalog.js';

const VALID_MODES = new Set(OUT_OF_STOCK_MODES);
const SELECT_COLUMNS = COLUMN_NAMES.join(',\n      ');

function httpError(message, code, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function assertDb(db) {
  if (!db?.query) {
    throw new TypeError('A conexão com o banco de dados não foi informada.');
  }
}

export function normalizeMode(settings = {}) {
  const mode = String(settings.out_of_stock_mode || '')
    .trim()
    .toUpperCase();

  if (VALID_MODES.has(mode)) return mode;

  // Compatibilidade com registros antigos que ainda não tinham o modo.
  return settings.allow_out_of_stock === true ? 'PASSWORD' : DEFAULTS.out_of_stock_mode;
}

function normalizeRow(row) {
  if (!row) return null;

  const mode = normalizeMode(row);

  return {
    ...row,
    setting_id: Number(row.setting_id || SETTINGS_ID),
    out_of_stock_mode: mode,
    allow_out_of_stock: mode !== 'BLOCK',
    require_stock_lot: row.require_stock_lot === true,
    allow_manual_unit_price: row.allow_manual_unit_price !== false,
    // numeric chega do driver pg como string.
    max_discount_percent: Number(row.max_discount_percent ?? DEFAULTS.max_discount_percent),
  };
}

// Resolve o modo a gravar: valor explícito > flag legada > valor atual.
function resolveMode(settings, current) {
  const raw = settings.out_of_stock_mode;

  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const mode = String(raw).trim().toUpperCase();
    if (!VALID_MODES.has(mode)) {
      throw httpError(
        `Modo de estoque inválido. Use: ${OUT_OF_STOCK_MODES.join(', ')}.`,
        'INVALID_OUT_OF_STOCK_MODE',
      );
    }
    return mode;
  }

  if (typeof settings.allow_out_of_stock === 'boolean') {
    return normalizeMode({ allow_out_of_stock: settings.allow_out_of_stock });
  }

  return current.out_of_stock_mode;
}

function resolveMaxDiscount(settings, current) {
  const value = settings.max_discount_percent ?? current.max_discount_percent;
  const maxDiscount = Number(value);
  const { min, max } = MAX_DISCOUNT_PERCENT_RANGE;

  if (value === '' || !Number.isFinite(maxDiscount) || maxDiscount < min || maxDiscount > max) {
    throw httpError(
      `O desconto máximo deve estar entre ${min}% e ${max}%.`,
      'INVALID_MAX_DISCOUNT_PERCENT',
    );
  }

  // numeric(5,2)
  return Math.round(maxDiscount * 100) / 100;
}

function resolveBoolean(settings, current, key) {
  return typeof settings[key] === 'boolean' ? settings[key] : current[key];
}

function normalizeUpdatedBy(updatedBy) {
  if (updatedBy === undefined || updatedBy === null) return null;
  const value = String(updatedBy).trim();
  return value ? value.slice(0, UPDATED_BY_MAX_LENGTH) : null;
}

async function ensureDefaultSettings(db) {
  await db.query(`
    INSERT INTO ${TABLE.qualifiedName} (
      setting_id,
      out_of_stock_mode,
      allow_out_of_stock,
      require_stock_lot,
      allow_manual_unit_price,
      max_discount_percent
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (setting_id) DO NOTHING
  `, [
    SETTINGS_ID,
    DEFAULTS.out_of_stock_mode,
    DEFAULTS.allow_out_of_stock,
    DEFAULTS.require_stock_lot,
    DEFAULTS.allow_manual_unit_price,
    DEFAULTS.max_discount_percent,
  ]);
}

export async function getBudgetSettings(db) {
  assertDb(db);

  await ensureDefaultSettings(db);

  const { rows } = await db.query(`
    SELECT
      ${SELECT_COLUMNS}
    FROM ${TABLE.qualifiedName}
    WHERE setting_id = $1
    LIMIT 1
  `, [SETTINGS_ID]);

  return normalizeRow(rows[0]);
}

// Atualização parcial: campos não informados mantêm o valor atual.
export async function updateBudgetSettings(db, settings = {}, updatedBy = null) {
  assertDb(db);

  const current = (await getBudgetSettings(db)) ?? normalizeRow({ ...DEFAULTS });

  const mode = resolveMode(settings, current);
  const maxDiscount = resolveMaxDiscount(settings, current);

  const { rows } = await db.query(`
    INSERT INTO ${TABLE.qualifiedName} (
      setting_id,
      out_of_stock_mode,
      allow_out_of_stock,
      require_stock_lot,
      allow_manual_unit_price,
      max_discount_percent,
      updated_at,
      updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
    ON CONFLICT (setting_id) DO UPDATE SET
      out_of_stock_mode = EXCLUDED.out_of_stock_mode,
      allow_out_of_stock = EXCLUDED.allow_out_of_stock,
      require_stock_lot = EXCLUDED.require_stock_lot,
      allow_manual_unit_price = EXCLUDED.allow_manual_unit_price,
      max_discount_percent = EXCLUDED.max_discount_percent,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by
    RETURNING
      ${SELECT_COLUMNS}
  `, [
    SETTINGS_ID,
    mode,
    mode !== 'BLOCK',
    resolveBoolean(settings, current, 'require_stock_lot'),
    resolveBoolean(settings, current, 'allow_manual_unit_price'),
    maxDiscount,
    normalizeUpdatedBy(updatedBy),
  ]);

  return normalizeRow(rows[0]);
}

export default {
  normalizeMode,
  getBudgetSettings,
  updateBudgetSettings,
};
