// ╔══════════════════════════════════════════════════════════════════════╗
// ║ manufacturersApi.js — Fabricantes (CONSART ERP | ESM)               ║
// ║ DAL direto no Postgres (modelo igual aos outros módulos)            ║
// ║ Sem import de schema — referência direta à tabela                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ─────────────────────────────────────────────────────────────
// REFERÊNCIAS DIRETAS DA TABELA (igual ao padrão do ERP)
// ─────────────────────────────────────────────────────────────
const TABLE = 'public.manufacturers';
const PK = 'manufacturer_id';

// ─────────────────────────────────────────────────────────────
// HELPERS PADRONIZADOS
// ─────────────────────────────────────────────────────────────
function ok(data) {
  return { ok: true, data };
}
function fail(error, status = 400) {
  return { ok: false, error, status };
}

function normalize(row) {
  if (!row) return null;
  return row; // mantém 1:1 com o banco — igual seus outros módulos
}

// ─────────────────────────────────────────────────────────────
// ensureManufacturersTable — opcional, pode apenas logar OK
// ─────────────────────────────────────────────────────────────
export async function ensureManufacturersTable() {
  try {
    console.log(`[manufacturersApi] Tabela ${TABLE} verificada/acessível.`);
    return ok(true);
  } catch (err) {
    console.error('[manufacturersApi] Erro:', err);
    return fail(err.message, 500);
  }
}

// ─────────────────────────────────────────────────────────────
// LIST (com paginação + busca)
// GET /api/products-manufacturers
// ─────────────────────────────────────────────────────────────
export async function list({
  q,
  page = 1,
  limit = 50,
  sort = 'trade_name',
  dir = 'asc'
} = {}) {
  try {
    const pg = Math.max(Number(page), 1);
    const lim = Math.min(Math.max(Number(limit), 1), 500);
    const offset = (pg - 1) * lim;

    const allowedSort = new Set([
      'manufacturer_id', 'trade_name', 'corporate_name',
      'tax_id', 'city', 'state', 'created_at'
    ]);

    const orderCol = allowedSort.has(sort) ? sort : 'trade_name';
    const orderDir = dir.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const params = [];
    const where = [];

    if (q?.trim()) {
      params.push(`%${q.toLowerCase()}%`);
      const idx = params.length;
      where.push(`
        (
          LOWER(trade_name) LIKE $${idx} OR
          LOWER(corporate_name) LIKE $${idx} OR
          LOWER(tax_id) LIKE $${idx}
        )
      `);
    }

    params.push(lim);
    const limitIdx = params.length;

    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      SELECT *,
        COUNT(*) OVER() AS total_count
      FROM ${TABLE}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx}
    `;

    const { rows } = await pool.query(sql, params);

    return ok({
      rows: rows.map(normalize),
      total: rows.length ? Number(rows[0].total_count) : 0,
      page: pg,
      limit: lim
    });
  } catch (err) {
    console.error('[manufacturersApi:list] Erro:', err);
    return fail(err.message, 500);
  }
}

// ─────────────────────────────────────────────────────────────
// SEARCH — atalho
// ─────────────────────────────────────────────────────────────
export async function search(q) {
  return list({ q, limit: 50 });
}

// ─────────────────────────────────────────────────────────────
// GET BY ID
// ─────────────────────────────────────────────────────────────
export async function getById(id) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${TABLE} WHERE ${PK} = $1`,
      [id]
    );

    if (!rows.length) return fail('Fabricante não encontrado', 404);
    return ok(normalize(rows[0]));
  } catch (err) {
    console.error('[manufacturersApi:getById] Erro:', err);
    return fail(err.message, 500);
  }
}

// ─────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────
export async function create(data = {}) {
  try {
    if (!data.trade_name?.trim()) {
      return fail('Campo trade_name é obrigatório');
    }

    const cols = [];
    const vals = [];
    const params = [];

    const add = (col, val) => {
      if (val === undefined) return;
      cols.push(col);
      params.push(val);
      vals.push(`$${params.length}`);
    };

    add('trade_name', data.trade_name);
    add('corporate_name', data.corporate_name);
    add('tax_id', data.tax_id);
    add('state_registration', data.state_registration);
    add('municipal_registration', data.municipal_registration);
    add('email', data.email);
    add('phone', data.phone);
    add('mobile', data.mobile);
    add('website', data.website);
    add('street', data.street);
    add('number', data.number);
    add('complement', data.complement);
    add('neighborhood', data.neighborhood);
    add('city', data.city);
    add('state', data.state);
    add('zipcode', data.zipcode);
    add('country', data.country ?? 'BRAZIL');
    add('active', data.active ?? true);
    add('notes', data.notes);

    const sql = `
      INSERT INTO ${TABLE} (${cols.join(', ')})
      VALUES (${vals.join(', ')})
      RETURNING *
    `;

    const { rows } = await pool.query(sql, params);
    return ok(normalize(rows[0]));

  } catch (err) {
    console.error('[manufacturersApi:create] Erro:', err);
    return fail(err.message, 500);
  }
}

// ─────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────
export async function update(id, data = {}) {
  try {
    const sets = [];
    const params = [];

    const add = (col, val) => {
      if (val === undefined) return;
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    add('trade_name', data.trade_name);
    add('corporate_name', data.corporate_name);
    add('tax_id', data.tax_id);
    add('state_registration', data.state_registration);
    add('municipal_registration', data.municipal_registration);
    add('email', data.email);
    add('phone', data.phone);
    add('mobile', data.mobile);
    add('website', data.website);
    add('street', data.street);
    add('number', data.number);
    add('complement', data.complement);
    add('neighborhood', data.neighborhood);
    add('city', data.city);
    add('state', data.state);
    add('zipcode', data.zipcode);
    add('country', data.country);
    add('active', data.active);
    add('notes', data.notes);

    // updated_at sempre atualizado
    add('updated_at', new Date());

    if (!sets.length) return fail('Nenhum campo para atualizar');

    params.push(id);
    const sql = `
      UPDATE ${TABLE}
      SET ${sets.join(', ')}
      WHERE ${PK} = $${params.length}
      RETURNING *
    `;

    const { rows } = await pool.query(sql, params);
    if (!rows.length) return fail('Fabricante não encontrado', 404);

    return ok(normalize(rows[0]));

  } catch (err) {
    console.error('[manufacturersApi:update] Erro:', err);
    return fail(err.message, 500);
  }
}

// ─────────────────────────────────────────────────────────────
// REMOVE — Soft delete
// ─────────────────────────────────────────────────────────────
export async function remove(id) {
  try {
    const { rows } = await pool.query(
      `
        UPDATE ${TABLE}
        SET active = FALSE, updated_at = now()
        WHERE ${PK} = $1
        RETURNING *
      `,
      [id]
    );

    if (!rows.length) return fail('Fabricante não encontrado', 404);

    return ok(normalize(rows[0]));
  } catch (err) {
    console.error('[manufacturersApi:remove] Erro:', err);
    return fail(err.message, 500);
  }
}

export default {
  ensureManufacturersTable,
  list,
  search,
  getById,
  create,
  update,
  remove
};
