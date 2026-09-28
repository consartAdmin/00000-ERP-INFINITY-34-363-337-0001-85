/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: chartOfAccountsApi.js                                         ║
   ║ MODULE: Chart Of Accounts                                           ║
   ║ DESCRIPTION: DAL/API for public."chartOfAccounts"                   ║
   ║ SCHEMA: catalog_schema.chartOfAccounts.js                           ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../../config/db.js';
import catalog from '../../../repositories/chartOfAccounts/chartOfAccounts.catalog.js';

/* ─────────────────────────── Catalog ─────────────────────────── */

const {
  schema: SCHEMA,
  table: TABLE_NAME,
  columns: COLUMNS,
  indexes: INDEXES,
  checks: CHECKS,
  foreignKeys: FOREIGN_KEYS,
  triggers: TRIGGERS,
} = catalog;

/** Quotes a SQL identifier (the table and some constraint names are case-sensitive) */
const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;

const TABLE = `${SCHEMA}.${qi(TABLE_NAME)}`;
const PK = catalog.primaryKey;

/** All columns, in catalog order */
const ALL_COLS = Object.keys(COLUMNS);

/** Columns written by create/update (excludes id, created_at, updated_at) */
const WRITABLE_COLS = ALL_COLS.filter((c) => !COLUMNS[c].readOnly);

/** Lighter column sets for search and posting-account lookups */
const TIMESTAMP_COLS = ['created_at', 'updated_at'];
const SEARCH_COLS = ALL_COLS.filter((c) => !TIMESTAMP_COLS.includes(c));
const POSTING_COLS = SEARCH_COLS.filter((c) => c !== 'notes');

/** Sortable columns (everything except free text) */
const SORT_MAP = Object.fromEntries(
  ALL_COLS.filter((c) => COLUMNS[c].type !== 'text').map((c) => [c, `coa.${c}`])
);

/** Full SELECT list with the parent account's code/description joined in */
const FULL_SELECT = ALL_COLS.flatMap((c) =>
  c === 'parent_account_id'
    ? [`coa.${c}`, 'parent.code AS parent_code', 'parent.description AS parent_description']
    : [`coa.${c}`]
).join(',\n        ');

/* ─────────────────────────── Helpers ─────────────────────────── */

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Translates PostgreSQL constraint errors into the API's error codes, using the catalog */
function mapDbError(err) {
  if (err?.code === '23505') {
    const idx = INDEXES.find((i) => i.name === err.constraint);
    if (idx) return httpError(`${idx.columns.join('_').toUpperCase()}_ALREADY_EXISTS`, 409);
  }
  if (err?.code === '23514') {
    const chk = CHECKS.find((c) => c.name === err.constraint);
    if (chk) return httpError(`INVALID_${chk.column.toUpperCase()}`, 400);
  }
  if (err?.code === '23503') {
    const fk = FOREIGN_KEYS.find((f) => f.constraint === err.constraint);
    if (fk) return httpError(`${fk.column.replace(/_id$/, '').toUpperCase()}_NOT_FOUND`, 404);
  }
  return err;
}

function normalizePaging(page = 1, limit = 20) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 500);
  const offset = (safePage - 1) * safeLimit;
  return { safePage, safeLimit, offset };
}

function normalizeBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return fallback;
}

function normalizeNullableText(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v || null;
}

/** Required text; enforces the varchar length from the catalog */
function normalizeRequiredText(value, fieldName) {
  const v = String(value || '').trim();
  if (!v) throw httpError(`${fieldName.toUpperCase()}_REQUIRED`, 400);

  const maxLength = COLUMNS[fieldName]?.length;
  if (maxLength && v.length > maxLength) {
    throw httpError(`${fieldName.toUpperCase()}_TOO_LONG`, 400);
  }
  return v;
}

/** Uppercases and checks the value against the column's enum in the catalog */
function normalizeEnum(value, column, errorCode) {
  const v = String(value || '').trim().toUpperCase();
  if (!COLUMNS[column].enum.includes(v)) throw httpError(errorCode, 400);
  return v;
}

function normalizeType(value) {
  return normalizeEnum(value, 'account_type', 'INVALID_ACCOUNT_TYPE');
}

function normalizeNature(value) {
  return normalizeEnum(value, 'nature', 'INVALID_NATURE');
}

/** Empty → fallback; otherwise must be an integer >= catalog min (chk_chartofaccounts_level) */
function normalizeLevel(value, fallback = COLUMNS.level.default) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < COLUMNS.level.min) throw httpError('INVALID_LEVEL', 400);
  return n;
}

function inferLevelFromCode(code) {
  const safe = String(code || '').trim();
  if (!safe) return 1;
  return safe.split('.').filter(Boolean).length || 1;
}

function normalizeId(value, fieldName = 'id', { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === '')) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw httpError(`INVALID_${String(fieldName).toUpperCase()}`, 400);
  }
  return n;
}

async function query(text, params = []) {
  return pool.query(text, params);
}

/* ───────────────────────── ensureTable() ───────────────────────── */

/** Converts a catalog default to SQL (strings are already SQL expressions) */
function sqlDefault(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

function columnDDL(name, col) {
  const type = col.length ? `${col.type}(${col.length})` : col.type;
  const parts = [`${qi(name)} ${type}`];
  const def = sqlDefault(col.default);
  if (def !== null) parts.push(`DEFAULT ${def}`);
  if (!col.nullable) parts.push('NOT NULL');
  return parts.join(' ');
}

function tableDDL() {
  const columnDefs = ALL_COLS.map((c) => columnDDL(c, COLUMNS[c]));

  const keyDefs = INDEXES
    .filter((i) => i.constraint)
    .map((i) =>
      `CONSTRAINT ${qi(i.name)} ${i.primary ? 'PRIMARY KEY' : 'UNIQUE'} (${i.columns.map(qi).join(', ')})`
    );

  const checkDefs = CHECKS.map((c) => `CONSTRAINT ${qi(c.name)} CHECK (${c.expression})`);

  const fkDefs = FOREIGN_KEYS.map(
    (f) =>
      `CONSTRAINT ${qi(f.constraint)} FOREIGN KEY (${qi(f.column)}) ` +
      `REFERENCES ${SCHEMA}.${qi(f.references.table)} (${qi(f.references.column)}) ` +
      `ON UPDATE ${f.onUpdate} ON DELETE ${f.onDelete}`
  );

  return `
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      ${[...columnDefs, ...keyDefs, ...checkDefs, ...fkDefs].join(',\n      ')}
    );
  `;
}

// The catalog describes the trigger; its function body lives here
const UPDATED_AT_TRIGGER = TRIGGERS[0];

async function createSchema() {
  const sequences = ALL_COLS.map((c) => COLUMNS[c].sequence).filter(Boolean);
  for (const seq of sequences) {
    await query(`CREATE SEQUENCE IF NOT EXISTS ${SCHEMA}.${qi(seq)};`);
  }

  await query(tableDDL());

  for (const idx of INDEXES.filter((i) => !i.constraint)) {
    await query(
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${qi(idx.name)} ` +
      `ON ${TABLE} USING ${idx.type} (${idx.columns.map(qi).join(', ')});`
    );
  }

  await query(`
    CREATE OR REPLACE FUNCTION ${SCHEMA}.${qi(UPDATED_AT_TRIGGER.function)}()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Creates the trigger only if missing (no DROP → no exclusive lock on every startup)
  await query(`
    DO $do$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = '${UPDATED_AT_TRIGGER.name}'
          AND tgrelid = '${TABLE}'::regclass
      ) THEN
        CREATE TRIGGER ${qi(UPDATED_AT_TRIGGER.name)}
        ${UPDATED_AT_TRIGGER.timing} ${UPDATED_AT_TRIGGER.events.join(' OR ')} ON ${TABLE}
        FOR EACH ${UPDATED_AT_TRIGGER.forEach}
        EXECUTE FUNCTION ${SCHEMA}.${qi(UPDATED_AT_TRIGGER.function)}();
      END IF;
    END
    $do$;
  `);
}

let ensurePromise = null;

/** Creates the table/indexes/trigger once per process; retries on the next call if it fails */
function ensureTable() {
  if (!ensurePromise) {
    ensurePromise = createSchema().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

/* ───────────────────────────── API ───────────────────────────── */

async function getById(id) {
  await ensureTable();

  const safeId = normalizeId(id, 'id');

  const { rows } = await query(
    `
      SELECT
        ${FULL_SELECT}
      FROM ${TABLE} coa
      LEFT JOIN ${TABLE} parent
        ON parent.${PK} = coa.parent_account_id
      WHERE coa.${PK} = $1
      LIMIT 1
    `,
    [safeId]
  );

  return rows[0] || null;
}

async function getByCode(code) {
  await ensureTable();

  const safeCode = normalizeRequiredText(code, 'code');

  const { rows } = await query(
    `
      SELECT
        ${FULL_SELECT}
      FROM ${TABLE} coa
      LEFT JOIN ${TABLE} parent
        ON parent.${PK} = coa.parent_account_id
      WHERE coa.code = $1
      LIMIT 1
    `,
    [safeCode]
  );

  return rows[0] || null;
}

async function existsByCode(code, excludeId = null) {
  const params = [code];
  let sql = `SELECT 1 FROM ${TABLE} WHERE code = $1`;

  if (excludeId) {
    params.push(excludeId);
    sql += ` AND ${PK} <> $2`;
  }

  sql += ` LIMIT 1`;

  const { rowCount } = await query(sql, params);
  return rowCount > 0;
}

async function validateParent(parentAccountId, currentId = null) {
  if (parentAccountId === null) return null;

  const parent = await getById(parentAccountId);
  if (!parent) throw httpError('PARENT_ACCOUNT_NOT_FOUND', 404);

  if (currentId && Number(parent[PK]) === Number(currentId)) {
    throw httpError('ACCOUNT_CANNOT_BE_ITS_OWN_PARENT', 400);
  }

  if (currentId) {
    const descendantIds = await getDescendantIds(currentId);
    if (descendantIds.includes(Number(parentAccountId))) {
      throw httpError('CIRCULAR_HIERARCHY_NOT_ALLOWED', 400);
    }
  }

  return parent;
}

async function getDescendantIds(accountId) {
  await ensureTable();

  const safeId = normalizeId(accountId, 'account_id');

  const { rows } = await query(
    `
      WITH RECURSIVE descendants AS (
        SELECT ${PK}, parent_account_id
        FROM ${TABLE}
        WHERE parent_account_id = $1

        UNION ALL

        SELECT child.${PK}, child.parent_account_id
        FROM ${TABLE} child
        INNER JOIN descendants d
          ON d.${PK} = child.parent_account_id
      )
      SELECT ${PK}
      FROM descendants
    `,
    [safeId]
  );

  return rows.map((r) => Number(r[PK]));
}

async function list(filters = {}) {
  await ensureTable();

  const {
    page = 1,
    limit = 20,
    search = '',
    account_type = '',
    nature = '',
    parent_account_id = '',
    allows_posting = '',
    is_active = '',
    only_posting = '',
    sort_by = 'code',
    sort_order = 'asc',
  } = filters || {};

  const { safePage, safeLimit, offset } = normalizePaging(page, limit);

  const where = [];
  const params = [];
  let i = 1;

  const safeSearch = String(search || '').trim();
  if (safeSearch) {
    where.push(`(
      coa.code ILIKE $${i}
      OR coa.description ILIKE $${i}
      OR COALESCE(coa.notes, '') ILIKE $${i}
    )`);
    params.push(`%${safeSearch}%`);
    i++;
  }

  if (String(account_type || '').trim()) {
    where.push(`coa.account_type = $${i}`);
    params.push(normalizeType(account_type));
    i++;
  }

  if (String(nature || '').trim()) {
    where.push(`coa.nature = $${i}`);
    params.push(normalizeNature(nature));
    i++;
  }

  if (parent_account_id !== '' && parent_account_id !== undefined && parent_account_id !== null) {
    if (String(parent_account_id).trim().toLowerCase() === 'null') {
      where.push(`coa.parent_account_id IS NULL`);
    } else {
      where.push(`coa.parent_account_id = $${i}`);
      params.push(normalizeId(parent_account_id, 'parent_account_id'));
      i++;
    }
  }

  const safeAllowsPosting = normalizeBoolean(allows_posting, null);
  if (safeAllowsPosting !== null) {
    where.push(`coa.allows_posting = $${i}`);
    params.push(safeAllowsPosting);
    i++;
  }

  const safeOnlyPosting = normalizeBoolean(only_posting, null);
  if (safeOnlyPosting === true) {
    where.push(`coa.allows_posting = TRUE`);
  }

  const safeIsActive = normalizeBoolean(is_active, null);
  if (safeIsActive !== null) {
    where.push(`coa.is_active = $${i}`);
    params.push(safeIsActive);
    i++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const orderBy = SORT_MAP[String(sort_by || '').trim()] || 'coa.code';
  const orderDir = String(sort_order || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const countResult = await query(
    `
      SELECT COUNT(*)::INT AS total
      FROM ${TABLE} coa
      ${whereSql}
    `,
    params
  );

  const total = countResult.rows[0]?.total || 0;

  params.push(safeLimit, offset);

  const { rows } = await query(
    `
      SELECT
        ${FULL_SELECT}
      FROM ${TABLE} coa
      LEFT JOIN ${TABLE} parent
        ON parent.${PK} = coa.parent_account_id
      ${whereSql}
      ORDER BY ${orderBy} ${orderDir}, coa.${PK} ASC
      LIMIT $${i} OFFSET $${i + 1}
    `,
    params
  );

  return {
    data: rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(Math.ceil(total / safeLimit), 1),
    },
  };
}

async function search(queryText, limit = 20) {
  await ensureTable();

  const q = String(queryText || '').trim();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const { rows } = await query(
    `
      SELECT
        ${SEARCH_COLS.map((c) => `coa.${c}`).join(',\n        ')}
      FROM ${TABLE} coa
      WHERE (
        $1 = ''
        OR coa.code ILIKE $2
        OR coa.description ILIKE $2
        OR COALESCE(coa.notes, '') ILIKE $2
      )
      ORDER BY coa.code ASC
      LIMIT $3
    `,
    [q, `%${q}%`, safeLimit]
  );

  return rows;
}

async function create(payload = {}) {
  await ensureTable();

  const code = normalizeRequiredText(payload.code, 'code');

  const values = {
    code,
    description: normalizeRequiredText(payload.description, 'description'),
    account_type: normalizeType(payload.account_type),
    nature: normalizeNature(payload.nature),
    level: normalizeLevel(payload.level, inferLevelFromCode(code)),
    parent_account_id: normalizeId(payload.parent_account_id, 'parent_account_id', { allowNull: true }),
    allows_posting: normalizeBoolean(payload.allows_posting, COLUMNS.allows_posting.default),
    is_active: normalizeBoolean(payload.is_active, COLUMNS.is_active.default),
    notes: normalizeNullableText(payload.notes),
  };

  if (await existsByCode(code)) throw httpError('CODE_ALREADY_EXISTS', 409);

  await validateParent(values.parent_account_id);

  const placeholders = WRITABLE_COLS.map((_, idx) => `$${idx + 1}`).join(',');

  try {
    const { rows } = await query(
      `
        INSERT INTO ${TABLE} (
          ${WRITABLE_COLS.join(',\n          ')}
        )
        VALUES (${placeholders})
        RETURNING *
      `,
      WRITABLE_COLS.map((c) => values[c])
    );

    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
}

async function update(id, payload = {}) {
  await ensureTable();

  const safeId = normalizeId(id, 'id');
  const current = await getById(safeId);

  if (!current) throw httpError('ACCOUNT_NOT_FOUND', 404);

  const code = payload.code !== undefined
    ? normalizeRequiredText(payload.code, 'code')
    : current.code;

  const values = {
    code,

    description: payload.description !== undefined
      ? normalizeRequiredText(payload.description, 'description')
      : current.description,

    account_type: payload.account_type !== undefined
      ? normalizeType(payload.account_type)
      : current.account_type,

    nature: payload.nature !== undefined
      ? normalizeNature(payload.nature)
      : current.nature,

    level: payload.level !== undefined
      ? normalizeLevel(payload.level, inferLevelFromCode(code))
      : (current.level || inferLevelFromCode(code)),

    parent_account_id: payload.parent_account_id !== undefined
      ? normalizeId(payload.parent_account_id, 'parent_account_id', { allowNull: true })
      : current.parent_account_id,

    allows_posting: payload.allows_posting !== undefined
      ? normalizeBoolean(payload.allows_posting, true)
      : current.allows_posting,

    is_active: payload.is_active !== undefined
      ? normalizeBoolean(payload.is_active, true)
      : current.is_active,

    notes: payload.notes !== undefined
      ? normalizeNullableText(payload.notes)
      : current.notes,
  };

  if (await existsByCode(code, safeId)) throw httpError('CODE_ALREADY_EXISTS', 409);

  await validateParent(values.parent_account_id, safeId);

  const sets = WRITABLE_COLS.map((c, idx) => `${c} = $${idx + 1}`);

  try {
    const { rows } = await query(
      `
        UPDATE ${TABLE}
        SET
          ${sets.join(',\n          ')},
          updated_at = NOW()
        WHERE ${PK} = $${WRITABLE_COLS.length + 1}
        RETURNING *
      `,
      [...WRITABLE_COLS.map((c) => values[c]), safeId]
    );

    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
}

async function hasChildren(id) {
  await ensureTable();

  const safeId = normalizeId(id, 'id');

  const { rowCount } = await query(
    `SELECT 1 FROM ${TABLE} WHERE parent_account_id = $1 LIMIT 1`,
    [safeId]
  );

  return rowCount > 0;
}

/**
 * Soft delete by default (is_active = FALSE).
 * Hard delete note: per the catalog, every table referencing chartOfAccounts
 * (accountsReceivable, cashMoviments, suppliers) uses ON DELETE SET NULL,
 * so their chart_account_id is silently cleared.
 */
async function remove(id, { hardDelete = false } = {}) {
  await ensureTable();

  const safeId = normalizeId(id, 'id');
  const current = await getById(safeId);

  if (!current) throw httpError('ACCOUNT_NOT_FOUND', 404);

  const childExists = await hasChildren(safeId);
  if (childExists) throw httpError('ACCOUNT_HAS_CHILDREN', 409);

  if (hardDelete === true) {
    const { rowCount } = await query(`DELETE FROM ${TABLE} WHERE ${PK} = $1`, [safeId]);
    return { deleted: rowCount > 0, mode: 'hard' };
  }

  const { rowCount } = await query(
    `
      UPDATE ${TABLE}
      SET is_active = FALSE, updated_at = NOW()
      WHERE ${PK} = $1
    `,
    [safeId]
  );

  return { deleted: rowCount > 0, mode: 'soft' };
}

async function setActive(id, isActive) {
  await ensureTable();

  const safeId = normalizeId(id, 'id');
  const current = await getById(safeId);

  if (!current) throw httpError('ACCOUNT_NOT_FOUND', 404);

  const safeActive = normalizeBoolean(isActive, null);
  if (safeActive === null) throw httpError('INVALID_IS_ACTIVE', 400);

  const { rows } = await query(
    `
      UPDATE ${TABLE}
      SET is_active = $1, updated_at = NOW()
      WHERE ${PK} = $2
      RETURNING *
    `,
    [safeActive, safeId]
  );

  return rows[0];
}

async function listPostingAccounts({ is_active = true, search = '', limit = 100 } = {}) {
  await ensureTable();

  const safeActive = normalizeBoolean(is_active, true);
  const safeSearch = String(search || '').trim();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const { rows } = await query(
    `
      SELECT
        ${POSTING_COLS.join(',\n        ')}
      FROM ${TABLE}
      WHERE allows_posting = TRUE
        AND ($1::BOOLEAN IS NULL OR is_active = $1)
        AND (
          $2 = ''
          OR code ILIKE $3
          OR description ILIKE $3
        )
      ORDER BY code ASC
      LIMIT $4
    `,
    [safeActive, safeSearch, `%${safeSearch}%`, safeLimit]
  );

  return rows;
}

async function getTree({ is_active = null } = {}) {
  await ensureTable();

  const safeIsActive = normalizeBoolean(is_active, null);

  const params = [];
  let whereSql = '';

  if (safeIsActive !== null) {
    params.push(safeIsActive);
    whereSql = `WHERE coa.is_active = $1`;
  }

  const { rows } = await query(
    `
      SELECT
        ${ALL_COLS.map((c) => `coa.${c}`).join(',\n        ')}
      FROM ${TABLE} coa
      ${whereSql}
      ORDER BY coa.code ASC, coa.${PK} ASC
    `,
    params
  );

  const byId = new Map();
  const roots = [];

  for (const row of rows) {
    byId.set(row[PK], { ...row, children: [] });
  }

  for (const row of rows) {
    const node = byId.get(row[PK]);
    if (row.parent_account_id && byId.has(row.parent_account_id)) {
      byId.get(row.parent_account_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function getFlatHierarchy({ is_active = null } = {}) {
  const tree = await getTree({ is_active });
  const result = [];

  function walk(nodes, depth = 0) {
    for (const node of nodes) {
      result.push({
        ...node,
        depth,
        label: `${'— '.repeat(depth)}${node.code} - ${node.description}`,
      });
      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(tree, 0);
  return result;
}

const chartOfAccountsApi = {
  ensureTable,
  list,
  search,
  getById,
  getByCode,
  create,
  update,
  remove,
  setActive,
  hasChildren,
  getTree,
  getFlatHierarchy,
  getDescendantIds,
  listPostingAccounts,
};

export default chartOfAccountsApi;
