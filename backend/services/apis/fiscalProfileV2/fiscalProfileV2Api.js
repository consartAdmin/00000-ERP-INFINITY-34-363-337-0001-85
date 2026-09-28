// ╔══════════════════════════════════════════════════════════════════════╗
// ║ fiscalProfileV2Api.js — API de perfis fiscais V2                   ║
// ║ CONSART ERP | ESM                                                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import db from '../../../config/db.js';
import {
  FISCAL_PROFILE_V2_TABLE as TABLE,
  FISCAL_PROFILE_V2_PRIMARY_KEY as PRIMARY_KEY,
  FISCAL_PROFILE_V2_SELECT_COLUMNS,
  FISCAL_PROFILE_V2_SELECT_SQL,
  prepareFiscalProfileInsert,
  prepareFiscalProfileUpdate,
} from './catalog_schema.fiscalProfileV2.js';

const RETURNING = FISCAL_PROFILE_V2_SELECT_COLUMNS
  .map((column) => `"${column}"`)
  .join(', ');

const SELECT = `SELECT ${FISCAL_PROFILE_V2_SELECT_SQL} FROM ${TABLE} fp`;

function badRequest(message, errors = []) {
  return Object.assign(new Error(message), { status: 400, errors });
}

function parseBoolean(value, fieldName) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw badRequest(`${fieldName} must be a boolean`);
}

function normalizePagination(limit, offset) {
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedOffset = Number.parseInt(offset, 10);

  return {
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 500)
      : 100,
    offset: Number.isFinite(parsedOffset)
      ? Math.max(parsedOffset, 0)
      : 0,
  };
}

function writableEntries(prepared) {
  if (!prepared.valid) {
    throw badRequest('Invalid fiscal profile payload', prepared.errors);
  }

  const entries = Object.entries(prepared.data);
  if (!entries.length) throw badRequest('No valid fields supplied');
  return entries;
}

export async function list({ active, search, limit = 100, offset = 0 } = {}) {
  const values = [];
  const where = [];
  const pagination = normalizePagination(limit, offset);

  if (active !== undefined && active !== null && active !== '') {
    values.push(parseBoolean(active, 'active'));
    where.push(`fp.is_active = $${values.length}`);
  }

  const normalizedSearch = String(search ?? '').trim();
  if (normalizedSearch) {
    values.push(`%${normalizedSearch}%`);
    where.push(
      `(fp.profile_name ILIKE $${values.length} OR fp.description ILIKE $${values.length})`,
    );
  }

  values.push(pagination.limit, pagination.offset);

  const sql = `
    ${SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY fp.profile_name
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
  `;

  return (await db.query(sql, values)).rows;
}

export async function getById(id) {
  return (
    await db.query(`${SELECT} WHERE fp.${PRIMARY_KEY} = $1`, [id])
  ).rows[0] ?? null;
}

export async function create(payload = {}) {
  const entries = writableEntries(prepareFiscalProfileInsert(payload));
  const names = entries.map(([key]) => `"${key}"`);
  const values = entries.map(([, value]) => value);
  const placeholders = entries.map((_, index) => `$${index + 1}`);

  const sql = `
    INSERT INTO ${TABLE} (${names.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING ${RETURNING}
  `;

  return (await db.query(sql, values)).rows[0];
}

// updated_at is maintained by the fiscal_profile_v2_updated_at trigger.
export async function update(id, payload = {}) {
  const entries = writableEntries(prepareFiscalProfileUpdate(payload));
  const set = entries
    .map(([key], index) => `"${key}" = $${index + 1}`)
    .join(', ');
  const values = entries.map(([, value]) => value);

  const sql = `
    UPDATE ${TABLE}
    SET ${set}
    WHERE ${PRIMARY_KEY} = $${values.length + 1}
    RETURNING ${RETURNING}
  `;

  return (await db.query(sql, [...values, id])).rows[0] ?? null;
}

export async function setActive(id, isActive) {
  const active = parseBoolean(isActive, 'isActive');

  const sql = `
    UPDATE ${TABLE}
    SET is_active = $1
    WHERE ${PRIMARY_KEY} = $2
    RETURNING ${RETURNING}
  `;

  return (await db.query(sql, [active, id])).rows[0] ?? null;
}

export default {
  list,
  getById,
  create,
  update,
  setActive,
};
