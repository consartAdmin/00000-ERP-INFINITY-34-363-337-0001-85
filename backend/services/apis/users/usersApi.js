// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 🧩 usersApi.js — Data Access Layer (DAL) para Users (ESM)               ║
// ║ Tabela: public.users (definida em catalog_schema.users.js)              ║
// ║ Funções: ensureTable, list, search, getById, create, update, remove    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../../config/db.js';
import catalog from './catalog_schema.users.js';

/* ─────────────────────────── Catálogo ─────────────────────────── */

const { schema: SCHEMA, table: TABLE, columns: COLUMNS, indexes: INDEXES } = catalog;

const TB = `${SCHEMA}."${TABLE}"`;
const ALIAS = 'u';
const PK = catalog.primaryKey; // user_id

/** Todas as colunas, na ordem do catálogo */
const ALL_COLS = Object.keys(COLUMNS);

/** Colunas que a API pode gravar (exclui user_id e created_at) */
const WRITABLE_COLS = ALL_COLS.filter((c) => !COLUMNS[c].readOnly);

/** Colunas permitidas para ordenação (exclui colunas sensíveis) */
const SORT_COLS = new Set(ALL_COLS.filter((c) => !COLUMNS[c].sensitive));

/** Defaults aplicados pela aplicação no create (o banco não tem default para access_level) */
const APP_DEFAULTS = {
  access_level: 'User',
  is_active: true,
};

const SELECT_COLS = ALL_COLS.map((c) => `${ALIAS}.${c}`).join(',\n        ');
const RETURNING_COLS = ALL_COLS.join(', ');

/* ───────────────────────────── Helpers ───────────────────────────── */

const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNum = (v) => (isFiniteNum(v) ? Number(v) : null);

/** Mapeia a linha crua do banco para o objeto de domínio (colunas do catálogo) */
function mapRow(r = {}) {
  const out = {};
  for (const c of ALL_COLS) out[c] = r[c];
  return out;
}

/**
 * Valida os dados contra o catálogo (NOT NULL e tamanho de varchar).
 * Com partial=true (update), só valida os campos enviados.
 * Retorna a mensagem de erro, ou null se estiver tudo certo.
 */
function validate(data = {}, { partial = false } = {}) {
  for (const c of WRITABLE_COLS) {
    const col = COLUMNS[c];
    const v = data[c];

    if (v === undefined) {
      if (!partial && !col.nullable && col.default == null) return `${c} is required.`;
      continue;
    }
    if (v === null) {
      if (!col.nullable) return `${c} cannot be null.`;
      continue;
    }
    if (col.length && String(v).length > col.length) {
      return `${c} must be at most ${col.length} characters.`;
    }
  }
  return null;
}

/** Converte violação de UNIQUE (23505) em mensagem amigável */
function uniqueViolationMessage(err) {
  if (err?.code !== '23505') return null;
  const idx = INDEXES.find((i) => i.name === err.constraint);
  if (!idx) return 'Duplicate value.';
  return `${idx.columns.join(', ')} already in use.`;
}

/**
 * Monta WHERE + params dinamicamente
 * Filtros suportados:
 *   - q: busca em name/email
 *   - is_active: true/false
 *   - access_level: string
 */
function buildWhereAndParams({ q, is_active, access_level } = {}) {
  const where = [];
  const params = [];

  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    const p = `$${params.length}`;
    where.push(
      `(${ALIAS}.name ILIKE ${p} OR ${ALIAS}.email ILIKE ${p})`
    );
  }

  if (typeof is_active === 'boolean') {
    params.push(is_active);
    const p = `$${params.length}`;
    where.push(`${ALIAS}.is_active = ${p}`);
  }

  if (access_level && String(access_level).trim()) {
    params.push(String(access_level).trim());
    const p = `$${params.length}`;
    where.push(`${ALIAS}.access_level = ${p}`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { clause, params };
}

/* ─────────────────────── ensureTable() ──────────────────────────── */

/** Converte o default do catálogo em SQL (strings já são expressões SQL) */
function sqlDefault(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}

/** Gera a definição SQL de uma coluna a partir do catálogo */
function columnDDL(name, col) {
  const type = col.length ? `${col.type}(${col.length})` : col.type;
  const parts = [`${name} ${type}`];
  const def = sqlDefault(col.default);
  if (def !== null) parts.push(`DEFAULT ${def}`);
  if (!col.nullable) parts.push('NOT NULL');
  return parts.join(' ');
}

/**
 * Garante a existência da tabela public."users", conforme catalog_schema.users.js.
 * Não derruba nada existente, só cria se não existir.
 *
 * IMPORTANTE:
 * - Se sua tabela já existe com outra estrutura, essa criação será ignorada.
 * - Se quiser evoluir colunas, use migrações/ALTER TABLE separado.
 */
export async function ensureTable() {
  const sequences = ALL_COLS
    .map((c) => COLUMNS[c].sequence)
    .filter(Boolean)
    .map((seq) => `CREATE SEQUENCE IF NOT EXISTS ${SCHEMA}.${seq};`);

  const columnDefs = ALL_COLS.map((c) => columnDDL(c, COLUMNS[c]));

  const constraintDefs = INDEXES
    .filter((i) => i.constraint && i.unique)
    .map((i) => `CONSTRAINT ${i.name} UNIQUE (${i.columns.join(', ')})`);

  const indexDefs = INDEXES
    .filter((i) => !i.constraint)
    .map(
      (i) =>
        `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${i.name} ` +
        `ON ${TB} USING ${i.type} (${i.columns.join(', ')});`
    );

  const sql = `
    ${sequences.join('\n    ')}

    CREATE TABLE IF NOT EXISTS ${TB} (
      ${[...columnDefs, ...constraintDefs].join(',\n      ')}
    );

    ${indexDefs.join('\n    ')}
  `;
  await pool.query(sql);
}

/* ───────────────────────────── API ───────────────────────────── */

/**
 * Lista usuários com paginação, ordenação e filtros.
 *
 * @param {Object} opts
 * @param {number} opts.page  - página (1-based)
 * @param {number} opts.limit - registros por página
 * @param {string} opts.sort  - coluna de ordenação (user_id, name, email, access_level, created_at, is_active)
 * @param {string} opts.dir   - direção (asc|desc)
 * @param {string} opts.q     - busca textual em name/email
 * @param {boolean} opts.is_active - filtra por ativo/inativo
 * @param {string} opts.access_level - filtra por nível de acesso
 */
export async function list({
  page = 1,
  limit = 20,
  sort = PK,
  dir = 'asc',
  q = '',
  is_active,
  access_level,
} = {}) {
  const _page = Math.max(1, Number(page) || 1);
  const _limit = Math.min(200, Math.max(1, Number(limit) || 20));
  const offset = (_page - 1) * _limit;

  const _sort = SORT_COLS.has(String(sort)) ? String(sort) : PK;
  const _dir = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { clause, params } = buildWhereAndParams({ q, is_active, access_level });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        ${SELECT_COLS}
      FROM ${TB} ${ALIAS}
      ${clause}
      ORDER BY ${ALIAS}.${_sort} ${_dir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, _limit, offset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ${TB} ${ALIAS} ${clause}`,
      params
    );

    const mapped = rows.map(mapRow);

    return {
      ok: true,
      data: {
        rows: mapped,
        total: countRes.rows[0]?.total ?? 0,
        page: _page,
        limit: _limit,
      },
    };
  } catch (err) {
    console.error('[usersApi:list] error:', err);
    return { ok: false, error: 'Failed to list users.' };
  }
}

/** Atalho para busca: delega para list() com q */
export async function search(q, { page = 1, limit = 20, is_active, access_level } = {}) {
  return list({ page, limit, q, is_active, access_level });
}

/** Busca usuário por ID (user_id) */
export async function getById(id) {
  const uid = toNum(id);
  if (!uid) return { ok: false, error: 'user_id is required.' };

  try {
    const { rows } = await pool.query(
      `
      SELECT
        ${SELECT_COLS}
      FROM ${TB} ${ALIAS}
      WHERE ${ALIAS}.${PK} = $1
      `,
      [uid]
    );

    if (!rows.length) return { ok: false, error: 'User not found.' };
    return { ok: true, data: mapRow(rows[0]) };
  } catch (err) {
    console.error('[usersApi:getById] error:', err);
    return { ok: false, error: 'Failed to get user.' };
  }
}

/**
 * Cria um novo usuário.
 * Espera que o controller já envie `password_hash` pronto (bcrypt).
 * Campos não enviados ficam com o default da aplicação ou do banco.
 */
export async function create(data = {}) {
  const payload = {};
  for (const k of WRITABLE_COLS) {
    if (data[k] !== undefined) payload[k] = data[k];
    else if (APP_DEFAULTS[k] !== undefined) payload[k] = APP_DEFAULTS[k];
  }

  const invalid = validate(payload);
  if (invalid) return { ok: false, error: invalid };

  const fields = Object.keys(payload);
  const vals = fields.map((k) => payload[k]);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(',');

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO ${TB}
        (${fields.join(',')})
      VALUES (${placeholders})
      RETURNING ${RETURNING_COLS}
      `,
      vals
    );

    return { ok: true, data: mapRow(rows[0]) };
  } catch (err) {
    const dup = uniqueViolationMessage(err);
    if (dup) return { ok: false, error: dup };
    console.error('[usersApi:create] error:', err);
    return { ok: false, error: 'Failed to create user.' };
  }
}

/**
 * Atualiza parcialmente um usuário.
 * Patch pode conter qualquer subset dos campos graváveis do catálogo:
 *   name, email, password_hash, access_level, is_active
 */
export async function update(id, patch = {}) {
  const uid = toNum(id);
  if (!uid) return { ok: false, error: 'user_id is required.' };

  const invalid = validate(patch, { partial: true });
  if (invalid) return { ok: false, error: invalid };

  const sets = [];
  const params = [];

  WRITABLE_COLS.forEach((k) => {
    if (patch[k] !== undefined) {
      params.push(patch[k]);
      sets.push(`${k} = $${params.length}`);
    }
  });

  if (!sets.length) return { ok: false, error: 'Nothing to update.' };

  params.push(uid);

  try {
    const { rows } = await pool.query(
      `
      UPDATE ${TB}
      SET ${sets.join(', ')}
      WHERE ${PK} = $${params.length}
      RETURNING ${RETURNING_COLS}
      `,
      params
    );

    if (!rows.length) return { ok: false, error: 'User not found.' };
    return { ok: true, data: mapRow(rows[0]) };
  } catch (err) {
    const dup = uniqueViolationMessage(err);
    if (dup) return { ok: false, error: dup };
    console.error('[usersApi:update] error:', err);
    return { ok: false, error: 'Failed to update user.' };
  }
}

/**
 * Hard delete — remove o usuário definitivamente.
 * Atenção: pelo catálogo, apaga em cascata processesUsers e userEmailAccounts,
 * e falha se o usuário for referenciado em inventories (created_by/finalized_by).
 */
export async function remove(id) {
  const uid = toNum(id);
  if (!uid) return { ok: false, error: 'user_id is required.' };

  try {
    const { rows } = await pool.query(
      `
      DELETE FROM ${TB}
      WHERE ${PK} = $1
      RETURNING ${PK}, name
      `,
      [uid]
    );

    if (!rows.length) return { ok: false, error: 'User not found.' };
    return { ok: true, data: { user_id: rows[0][PK], name: rows[0].name } };
  } catch (err) {
    if (err?.code === '23503') {
      return { ok: false, error: 'User is referenced by other records and cannot be deleted.' };
    }
    console.error('[usersApi:remove] error:', err);
    return { ok: false, error: 'Failed to delete user.' };
  }
}

export default { ensureTable, list, search, getById, create, update, remove };
