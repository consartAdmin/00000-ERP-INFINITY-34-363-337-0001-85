import db from '../../../config/db.js';
import {
  FISCAL_CLASSIFICATION_V2_TABLE as TABLE,
  FISCAL_CLASSIFICATION_V2_PRIMARY_KEY as PRIMARY_KEY,
  FISCAL_CLASSIFICATION_V2_SELECT_COLUMNS,
  FISCAL_CLASSIFICATION_V2_SELECT_SQL,
  prepareFiscalClassificationInsert,
  prepareFiscalClassificationUpdate,
} from '../../../repositories/fiscalClassificationV2/fiscalClassificationV2.catalog.js';
import { FISCAL_PROFILE_V2_TABLE } from '../../../repositories/fiscalProfileV2/fiscalProfileV2.catalog.js';

const RETURNING = FISCAL_CLASSIFICATION_V2_SELECT_COLUMNS
  .map((column) => `"${column}"`)
  .join(', ');

const SELECT = `
  SELECT ${FISCAL_CLASSIFICATION_V2_SELECT_SQL},
         fp.profile_name,
         fp.description AS profile_description
  FROM ${TABLE} fc
  LEFT JOIN ${FISCAL_PROFILE_V2_TABLE} fp
    ON fp.fiscal_profile_id = fc.fiscal_profile_id
`;

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
    limit: Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100,
    offset: Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0,
  };
}

function normalizeDigits(value, expectedLength, fieldName) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length !== expectedLength) {
    throw badRequest(`${fieldName} must contain ${expectedLength} digits`);
  }
  return digits;
}

function writableEntries(prepared) {
  if (!prepared.valid) {
    throw badRequest('Invalid fiscal classification payload', prepared.errors);
  }
  const entries = Object.entries(prepared.data);
  if (!entries.length) throw badRequest('No valid fields supplied');
  return entries;
}

export async function list({ active, search, ncm, cest, limit = 100, offset = 0 } = {}) {
  const values = [];
  const where = [];
  const pagination = normalizePagination(limit, offset);
  const add = (clause, value) => {
    values.push(value);
    where.push(clause.replace('?', `$${values.length}`));
  };

  if (active !== undefined && active !== null && active !== '') {
    add('fc.is_active = ?', parseBoolean(active, 'active'));
  }

  const normalizedSearch = String(search ?? '').trim();
  if (normalizedSearch) {
    values.push(`%${normalizedSearch}%`);
    where.push(`(
      fc.classification_name ILIKE $${values.length}
      OR fc.description ILIKE $${values.length}
      OR fc.ncm_description ILIKE $${values.length}
      OR fc.cest_description ILIKE $${values.length}
      OR fp.profile_name ILIKE $${values.length}
    )`);
  }

  if (ncm !== undefined && ncm !== null && ncm !== '') {
    add("regexp_replace(fc.ncm_code, '[^0-9]', '', 'g') = ?", normalizeDigits(ncm, 8, 'ncm'));
  }
  if (cest !== undefined && cest !== null && cest !== '') {
    add("regexp_replace(fc.cest_code, '[^0-9]', '', 'g') = ?", normalizeDigits(cest, 7, 'cest'));
  }

  values.push(pagination.limit, pagination.offset);
  const sql = `
    ${SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY fc.classification_name
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
  `;
  return (await db.query(sql, values)).rows;
}

export async function getById(id) {
  return (await db.query(`${SELECT} WHERE fc.${PRIMARY_KEY} = $1`, [id])).rows[0] ?? null;
}

export async function create(payload = {}) {
  const entries = writableEntries(prepareFiscalClassificationInsert(payload));
  const names = entries.map(([key]) => `"${key}"`);
  const values = entries.map(([, value]) => value);
  const params = entries.map((_, index) => `$${index + 1}`);
  const sql = `
    INSERT INTO ${TABLE} (${names.join(', ')})
    VALUES (${params.join(', ')})
    RETURNING ${RETURNING}
  `;
  return (await db.query(sql, values)).rows[0];
}

// updated_at is maintained by fiscal_classification_v2_updated_at.
export async function update(id, payload = {}) {
  const entries = writableEntries(prepareFiscalClassificationUpdate(payload));
  const set = entries.map(([key], index) => `"${key}" = $${index + 1}`).join(', ');
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
  return (await db.query(
    `UPDATE ${TABLE}
     SET is_active = $1
     WHERE ${PRIMARY_KEY} = $2
     RETURNING ${RETURNING}`,
    [active, id],
  )).rows[0] ?? null;
}

export default { list, getById, create, update, setActive };
