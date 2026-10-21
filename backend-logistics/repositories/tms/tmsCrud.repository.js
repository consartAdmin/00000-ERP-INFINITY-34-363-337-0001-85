// ╔════════════════════════════════════════════════════════════════════╗
// ║ tmsCrud.repository.js — CRUD genérico dos cadastros do TMS         ║
// ║ Cada recurso é descrito em tms.resources.js (tabela, campos,       ║
// ║ filtros, filhos e ganchos). Aqui ficam list / get / create /       ║
// ║ update / remove, sempre com SQL parametrizado.                     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import {
  httpError, toInt, cleanText, toDate, convertField, isoDate, mapTmsError,
} from './tms.helpers.js';
import { RESOURCES } from './tms.resources.js';

const q = (name) => `"${name}"`;

export function getResource(key) {
  const res = RESOURCES[key];
  if (!res) throw httpError('RESOURCE_NOT_FOUND', 404);
  return res;
}

/**
 * Colunas NOT NULL com default literal (0, true, 'ABERTO'...) por tabela.
 * Campo vazio no formulário vira o default em vez de violar o NOT NULL.
 */
const notNullDefaults = new Map();

async function fillDefaults(client, table, row) {
  if (!notNullDefaults.has(table)) {
    const { rows } = await client.query(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND is_nullable = 'NO' AND column_default IS NOT NULL`,
      [table]
    );
    const map = {};
    for (const r of rows) {
      const m = /^'?(-?[\w.]+)'?(?:::[\w ]+)?$/.exec(r.column_default.trim());
      if (!m || /nextval|now|current/i.test(r.column_default)) continue;
      const v = m[1];
      map[r.column_name] = v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    }
    notNullDefaults.set(table, map);
  }
  const map = notNullDefaults.get(table);
  for (const k of Object.keys(row)) if (row[k] == null && k in map) row[k] = map[k];
  return row;
}

function sourceOf(res) {
  return res.source || `public.${q(res.table)} t`;
}

/** Normaliza o payload pelas definições de campo */
export function pickFields(fields, data = {}, { partial = false } = {}) {
  const out = {};
  for (const [name, def] of Object.entries(fields)) {
    if (def.readonly) continue;
    if (!(name in data)) {
      if (!partial && def.required) throw httpError(`${name.toUpperCase()}_REQUIRED`, 400);
      continue;
    }
    const v = convertField(name, def, data[name]);
    if ((v === null || v === '') && def.required) throw httpError(`${name.toUpperCase()}_REQUIRED`, 400);
    out[name] = v;
  }
  return out;
}

/** DATE do pg → 'yyyy-mm-dd' (só nos campos declarados como date) */
function normalizeRow(fields, row) {
  if (!row) return row;
  for (const [name, def] of Object.entries(fields)) {
    if (def.type === 'date' && row[name] instanceof Date) row[name] = isoDate(row[name]);
  }
  return row;
}

function buildWhere(res, query) {
  const where = [];
  const params = [];
  const term = cleanText(query.q);
  if (term && res.search?.length) {
    params.push(`%${term}%`);
    where.push(`(${res.search.map((c) => `${c}::text ILIKE $${params.length}`).join(' OR ')})`);
  }
  for (const [param, expr] of Object.entries(res.filters || {})) {
    const v = cleanText(query[param]);
    if (v === null) continue;
    params.push(v);
    where.push(`${expr}::text = $${params.length}`);
  }
  if (res.dateField) {
    const from = toDate(query.date_from);
    const to = toDate(query.date_to);
    if (from) { params.push(from); where.push(`${res.dateField} >= $${params.length}::date`); }
    if (to) { params.push(to); where.push(`${res.dateField} <= $${params.length}::date`); }
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function selectSql(res) {
  const extra = res.select ? `, ${res.select}` : '';
  return `SELECT t.*${extra} FROM ${sourceOf(res)} ${res.joins || ''}`;
}

export async function list(key, query = {}) {
  const res = getResource(key);
  const limit = Math.min(Math.max(toInt(query.limit, 30), 1), 500);
  const page = Math.max(toInt(query.page, 1), 1);
  const { where, params } = buildWhere(res, query);
  const base = `${selectSql(res)} ${where}`;
  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    pool.query(
      `${base} ORDER BY ${res.order || `t.${res.pk} DESC`} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM ${sourceOf(res)} ${res.joins || ''} ${where}`, params),
  ]);
  return { rows: rows.map((r) => normalizeRow(res.fields, r)), total: cnt.total, page, limit };
}

async function loadChildren(run, res, id) {
  const out = {};
  for (const [name, child] of Object.entries(res.children || {})) {
    const extra = child.select ? `, ${child.select}` : '';
    const { rows } = await run(
      `SELECT c.*${extra} FROM public.${q(child.table)} c ${child.joins || ''}
        WHERE c.${child.fk} = $1 ORDER BY ${child.order || `c.${child.pk}`}`,
      [id]
    );
    out[name] = rows.map((r) => normalizeRow(child.fields, r));
  }
  return out;
}

export async function get(key, id, run = (t, p) => pool.query(t, p)) {
  const res = getResource(key);
  const { rows: [row] } = await run(`${selectSql(res)} WHERE t.${res.pk} = $1`, [toInt(id)]);
  if (!row) throw httpError('NOT_FOUND', 404);
  return { ...normalizeRow(res.fields, row), ...(await loadChildren(run, res, toInt(id))) };
}

function pickChildren(res, data) {
  const out = {};
  for (const [name, child] of Object.entries(res.children || {})) {
    if (!Array.isArray(data[name])) continue;
    out[name] = data[name].map((item) => pickFields(child.fields, item));
  }
  return out;
}

async function writeChildren(client, res, id, children) {
  for (const [name, items] of Object.entries(children)) {
    const child = res.children[name];
    await client.query(`DELETE FROM public.${q(child.table)} WHERE ${child.fk} = $1`, [id]);
    for (const item of items) {
      await fillDefaults(client, child.table, item);
      const cols = [child.fk, ...Object.keys(item)];
      await client.query(
        `INSERT INTO public.${q(child.table)} (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        [id, ...Object.keys(item).map((c) => item[c])]
      );
    }
  }
}

/** Abre transação e roda fn(client) */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapTmsError(err);
  } finally {
    client.release();
  }
}

async function currentRow(client, res, id) {
  const { rows: [row] } = await client.query(
    `SELECT * FROM public.${q(res.table)} WHERE ${res.pk} = $1 FOR UPDATE`,
    [id]
  );
  if (!row) throw httpError('NOT_FOUND', 404);
  return normalizeRow(res.fields, row);
}

export async function create(key, data = {}, user = null) {
  const res = getResource(key);
  const p = pickFields(res.fields, data);
  const children = pickChildren(res, data);
  if (res.createdBy && user?.user_id) p.created_by = toInt(user.user_id);
  return withTx(async (client) => {
    const ctx = { client, user, id: null, current: null, isNew: true };
    if (res.beforeSave) await res.beforeSave(p, children, ctx);
    await fillDefaults(client, res.table, p);
    const cols = Object.keys(p);
    const { rows: [row] } = cols.length
      ? await client.query(
        `INSERT INTO public.${q(res.table)} (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${res.pk}`,
        cols.map((c) => p[c])
      )
      : await client.query(`INSERT INTO public.${q(res.table)} DEFAULT VALUES RETURNING ${res.pk}`);
    const id = row[res.pk];
    await writeChildren(client, res, id, children);
    if (res.afterSave) await res.afterSave(id, { ...ctx, id });
    return get(key, id, (t, prm) => client.query(t, prm));
  });
}

export async function update(key, id, data = {}, user = null) {
  const res = getResource(key);
  const rid = toInt(id);
  const p = pickFields(res.fields, data, { partial: true });
  const children = pickChildren(res, data);
  return withTx(async (client) => {
    const current = await currentRow(client, res, rid);
    if (res.canEdit) res.canEdit(current, p);
    const ctx = { client, user, id: rid, current, isNew: false };
    if (res.beforeSave) await res.beforeSave(p, children, ctx);
    await fillDefaults(client, res.table, p);
    const cols = Object.keys(p);
    if (cols.length) {
      await client.query(
        `UPDATE public.${q(res.table)} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}
          WHERE ${res.pk} = $1`,
        [rid, ...cols.map((c) => p[c])]
      );
    }
    await writeChildren(client, res, rid, children);
    if (res.afterSave) await res.afterSave(rid, ctx);
    return get(key, rid, (t, prm) => client.query(t, prm));
  });
}

export async function remove(key, id) {
  const res = getResource(key);
  const rid = toInt(id);
  return withTx(async (client) => {
    const current = await currentRow(client, res, rid);
    if (res.canDelete) res.canDelete(current);
    await client.query(`DELETE FROM public.${q(res.table)} WHERE ${res.pk} = $1`, [rid]);
    if (res.afterDelete) await res.afterDelete(current, { client });
    return { [res.pk]: rid };
  });
}
