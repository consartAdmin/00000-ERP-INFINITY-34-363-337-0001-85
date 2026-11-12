// ╔════════════════════════════════════════════════════════════════════╗
// ║ servicesConsart.repository.js — Cadastro de serviços (CONSART ERP) ║
// ║ Tabela: public."servicesConsart" (criada no primeiro uso)          ║
// ║ • Usado pelas Propostas de Serviços (modal "Buscar Serviço").      ║
// ║ • Código único; sem código informado, gera S0001, S0002...         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."servicesConsart"';

let ready = null;

export function ensureServicesConsartTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        id            BIGSERIAL PRIMARY KEY,
        code          VARCHAR(30) NOT NULL,
        description   VARCHAR(500) NOT NULL,
        unit          VARCHAR(10) NOT NULL DEFAULT 'SV',
        price         NUMERIC(14,4) NOT NULL DEFAULT 0,
        service_code  VARCHAR(20),
        category      VARCHAR(100),
        details       TEXT,
        active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "servicesConsart_code_uk" UNIQUE (code)
      );
      CREATE INDEX IF NOT EXISTS "servicesConsart_description_idx" ON ${TB} (lower(description));
    `).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function text(value, max) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  let s = String(value).trim().replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function bool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !['false', '0', 'nao', 'não', 'n', 'inativo'].includes(String(value).trim().toLowerCase());
}

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function prepare(body = {}) {
  const description = text(body.description, 500);
  if (!description) throw validationError('Informe a descrição do serviço.');

  const price = num(body.price, 0);
  if (price < 0) throw validationError('O preço não pode ser negativo.');

  return {
    code: text(body.code, 30)?.toUpperCase() || null,
    description,
    unit: (text(body.unit, 10) || 'SV').toUpperCase(),
    price,
    service_code: text(body.service_code, 20),
    category: text(body.category, 100),
    details: text(body.details),
    active: bool(body.active, true),
  };
}

function translateDbError(error) {
  if (error?.code === '23505') return validationError('Já existe um serviço com esse código.', 409);
  return error;
}

// ─────────────────────────────────────────────────────────────────────
// Consultas
// ─────────────────────────────────────────────────────────────────────

// Colunas que a tela pode ordenar (nome no front → expressão SQL)
const SORT_COLUMNS = Object.freeze({
  code: 's.code',
  description: 'lower(s.description)',
  unit: 's.unit',
  service_code: 's.service_code',
  category: 'lower(s.category)',
  price: 's.price',
  active: 's.active',
});

export async function list({ q, active, category, sort, dir, page = 1, limit = 50 } = {}) {
  await ensureServicesConsartTable();

  const params = [];
  const where = [];

  const search = text(q);
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(s.code ILIKE $${i} OR s.description ILIKE $${i} OR s.service_code ILIKE $${i}
                 OR s.category ILIKE $${i} OR s.details ILIKE $${i})`);
  }

  const act = String(active ?? '').trim().toLowerCase();
  if (act === 'true' || act === 'false') {
    params.push(act === 'true');
    where.push(`s.active = $${params.length}`);
  }

  const cat = text(category);
  if (cat) {
    params.push(cat);
    where.push(`s.category = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${TB} s ${whereSql}`,
    params
  );

  const pageSize = Math.min(Math.max(Math.trunc(num(limit, 50)), 1), 500);
  const pageNumber = Math.max(Math.trunc(num(page, 1)), 1);

  const sortExpr = SORT_COLUMNS[String(sort || '').trim()];
  const direction = String(dir || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const orderSql = sortExpr
    ? `${sortExpr} ${direction} NULLS LAST, s.id ASC`
    : 's.active DESC, s.description ASC, s.id ASC';

  const { rows } = await pool.query(
    `SELECT s.* FROM ${TB} s ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${pageSize} OFFSET ${(pageNumber - 1) * pageSize}`,
    params
  );

  return { rows, count, page: pageNumber, pages: Math.max(1, Math.ceil(count / pageSize)) };
}

export async function listCategories() {
  await ensureServicesConsartTable();
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM ${TB} WHERE category IS NOT NULL AND category <> '' ORDER BY category`
  );
  return rows.map((r) => r.category);
}

export async function getById(id) {
  await ensureServicesConsartTable();
  const serviceId = positiveId(id);
  if (!serviceId) return null;
  const { rows: [row] } = await pool.query(`SELECT * FROM ${TB} WHERE id = $1`, [serviceId]);
  return row || null;
}

// ─────────────────────────────────────────────────────────────────────
// Escrita
// ─────────────────────────────────────────────────────────────────────

export async function create(body = {}) {
  await ensureServicesConsartTable();
  const data = prepare(body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let { code } = data;
    if (!code) {
      // Próximo S0001, S0002... sem repetir com dois cadastros ao mesmo tempo
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('servicesConsart.code'))`);
      const { rows: [{ next }] } = await client.query(
        `SELECT COALESCE(MAX(substring(code FROM '^S(\\d+)$')::int), 0) + 1 AS next FROM ${TB}`
      );
      code = `S${String(next).padStart(4, '0')}`;
    }

    const { rows: [row] } = await client.query(
      `INSERT INTO ${TB} (code, description, unit, price, service_code, category, details, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [code, data.description, data.unit, data.price, data.service_code, data.category, data.details, data.active]
    );

    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw translateDbError(error);
  } finally {
    client.release();
  }
}

export async function update(id, body = {}) {
  await ensureServicesConsartTable();
  const serviceId = positiveId(id);
  if (!serviceId) return null;

  const data = prepare(body);
  try {
    const { rows: [row] } = await pool.query(
      `UPDATE ${TB} SET
          code         = COALESCE($2, code),
          description  = $3,
          unit         = $4,
          price        = $5,
          service_code = $6,
          category     = $7,
          details      = $8,
          active       = $9,
          updated_at   = NOW()
        WHERE id = $1
        RETURNING *`,
      [serviceId, data.code, data.description, data.unit, data.price, data.service_code,
        data.category, data.details, data.active]
    );
    return row || null;
  } catch (error) {
    throw translateDbError(error);
  }
}

/** Exclui de vez. As propostas guardam cópia do código/descrição, então não quebram. */
export async function remove(id) {
  await ensureServicesConsartTable();
  const serviceId = positiveId(id);
  if (!serviceId) return false;
  const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE id = $1`, [serviceId]);
  return rowCount > 0;
}
