//╔════════════════════════════════════════════════════════════════════════════╗
//║ 🔑 productsKeyApi.js — Service/API: ProductsKey (CONSART ERP | ESM)       ║
//║ - CRUD + Search + Resolve (matching)                                     ║
//║ - Tabela: public."productsKey"                                           ║
//║   products_key_id (PK) | product_code (FK) | word_keys | word_keys_norm   ║
//║   created_at | updated_at                                                ║
//╚════════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."productsKey"';
const TB_PRODUCTS = 'public."products"';

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export function normalizeKeyText(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';

  // remove accents
  const noAccents = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // keep letters/numbers/spaces, convert separators to space
  const cleaned = noAccents
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

function clampInt(n, def, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

async function hasFunctionSetTimestamp(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_proc WHERE proname = 'set_timestamp' LIMIT 1`
  );
  return rows.length > 0;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Ensure table + indexes                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        products_key_id  BIGSERIAL PRIMARY KEY,
        product_code     VARCHAR(50) NOT NULL,
        word_keys        TEXT NOT NULL,
        word_keys_norm   TEXT NOT NULL,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_productsKey_product_code
          FOREIGN KEY (product_code)
          REFERENCES ${TB_PRODUCTS}(product_code)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      );
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_productsKey_word_keys_norm
      ON ${TB}(word_keys_norm);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_productsKey_product_code
      ON ${TB}(product_code);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_productsKey_product_word_norm
      ON ${TB}(product_code, word_keys_norm);
    `);

    // Trigger updated_at (optional)
    const okFn = await hasFunctionSetTimestamp(client);
    if (okFn) {
      await client.query(`
        DROP TRIGGER IF EXISTS trg_productsKey_set_timestamp ON ${TB};
      `);
      await client.query(`
        CREATE TRIGGER trg_productsKey_set_timestamp
        BEFORE UPDATE ON ${TB}
        FOR EACH ROW
        EXECUTE FUNCTION set_timestamp();
      `);
    }

    await client.query('COMMIT');
    return { ok: true, table: 'productsKey' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CRUD                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export async function create({
  product_code,
  word_keys,
  word_keys_norm,
} = {}) {
  if (!product_code) throw new Error('product_code é obrigatório.');
  if (!word_keys) throw new Error('word_keys é obrigatório.');

  const norm = (word_keys_norm && String(word_keys_norm).trim())
    ? String(word_keys_norm).trim()
    : normalizeKeyText(word_keys);

  if (!norm) throw new Error('word_keys_norm ficou vazio após normalização.');

  const { rows } = await pool.query(
    `
      INSERT INTO ${TB} (product_code, word_keys, word_keys_norm)
      VALUES ($1, $2, $3)
      RETURNING products_key_id, product_code, word_keys, word_keys_norm, created_at, updated_at
    `,
    [String(product_code).trim(), String(word_keys).trim(), norm]
  );

  return rows[0];
}

/**
 * Upsert lógico: mesma combinação (product_code + word_keys_norm) não duplica.
 * Se existir, atualiza word_keys e updated_at.
 */
export async function upsert({
  product_code,
  word_keys,
  word_keys_norm,
} = {}) {
  if (!product_code) throw new Error('product_code é obrigatório.');
  if (!word_keys) throw new Error('word_keys é obrigatório.');

  const norm = (word_keys_norm && String(word_keys_norm).trim())
    ? String(word_keys_norm).trim()
    : normalizeKeyText(word_keys);

  if (!norm) throw new Error('word_keys_norm ficou vazio após normalização.');

  const { rows } = await pool.query(
    `
      INSERT INTO ${TB} (product_code, word_keys, word_keys_norm)
      VALUES ($1, $2, $3)
      ON CONFLICT (product_code, word_keys_norm)
      DO UPDATE SET
        word_keys = EXCLUDED.word_keys,
        updated_at = NOW()
      RETURNING products_key_id, product_code, word_keys, word_keys_norm, created_at, updated_at
    `,
    [String(product_code).trim(), String(word_keys).trim(), norm]
  );

  return rows[0];
}

export async function getById(id) {
  const keyId = Number(id);
  if (!Number.isFinite(keyId)) throw new Error('ID inválido.');

  const { rows } = await pool.query(
    `
      SELECT products_key_id, product_code, word_keys, word_keys_norm, created_at, updated_at
      FROM ${TB}
      WHERE products_key_id = $1
      LIMIT 1
    `,
    [keyId]
  );

  return rows[0] || null;
}

export async function remove(id) {
  const keyId = Number(id);
  if (!Number.isFinite(keyId)) throw new Error('ID inválido.');

  const { rows } = await pool.query(
    `
      DELETE FROM ${TB}
      WHERE products_key_id = $1
      RETURNING products_key_id
    `,
    [keyId]
  );

  return { ok: rows.length > 0, deletedId: rows[0]?.products_key_id ?? null };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* List / Search                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export async function list({
  q,
  product_code,
  limit = 50,
  offset = 0,
  orderBy = 'products_key_id',
  order = 'DESC',
} = {}) {
  const L = clampInt(limit, 50, 1, 200);
  const O = clampInt(offset, 0, 0, 1_000_000);

  const allowedOrderBy = new Set([
    'products_key_id',
    'product_code',
    'word_keys_norm',
    'created_at',
    'updated_at',
  ]);
  const ob = allowedOrderBy.has(orderBy) ? orderBy : 'products_key_id';
  const od = String(order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const where = [];
  const params = [];

  if (product_code) {
    params.push(String(product_code).trim());
    where.push(`product_code = $${params.length}`);
  }

  if (q) {
    const nq = normalizeKeyText(q);
    // busca por norm e por texto original
    params.push(`%${nq}%`);
    params.push(`%${String(q).trim()}%`);
    where.push(`(word_keys_norm ILIKE $${params.length - 1} OR word_keys ILIKE $${params.length})`);
  }

  const sql = `
    SELECT products_key_id, product_code, word_keys, word_keys_norm, created_at, updated_at
    FROM ${TB}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${ob} ${od}
    LIMIT ${L} OFFSET ${O}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Resolve (matching)                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Resolve por texto do cliente:
 * 1) normaliza
 * 2) tenta match exato (word_keys_norm)
 * 3) fallback: contém (ILIKE) com ranking simples
 *
 * Retorna:
 * { normalized, exact: [...], candidates: [...] }
 */
export async function resolve({
  text,
  limit = 10,
  product_code, // opcional: força resolver dentro de um produto específico
} = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('text é obrigatório.');

  const normalized = normalizeKeyText(raw);
  const L = clampInt(limit, 10, 1, 50);

  const paramsExact = [];
  const whereExact = [];

  paramsExact.push(normalized);
  whereExact.push(`word_keys_norm = $${paramsExact.length}`);

  if (product_code) {
    paramsExact.push(String(product_code).trim());
    whereExact.push(`product_code = $${paramsExact.length}`);
  }

  const exactSql = `
    SELECT products_key_id, product_code, word_keys, word_keys_norm
    FROM ${TB}
    WHERE ${whereExact.join(' AND ')}
    LIMIT ${L}
  `;

  const exact = (await pool.query(exactSql, paramsExact)).rows;

  // fallback candidates
  const paramsCand = [];
  const whereCand = [];

  paramsCand.push(`%${normalized}%`);
  whereCand.push(`word_keys_norm ILIKE $${paramsCand.length}`);

  if (product_code) {
    paramsCand.push(String(product_code).trim());
    whereCand.push(`product_code = $${paramsCand.length}`);
  }

  // ranking simples: mais curto e mais próximo primeiro
  const candSql = `
    SELECT
      products_key_id,
      product_code,
      word_keys,
      word_keys_norm,
      LENGTH(word_keys_norm) AS len
    FROM ${TB}
    WHERE ${whereCand.join(' AND ')}
    ORDER BY len ASC, products_key_id DESC
    LIMIT ${L}
  `;

  const candidates = (await pool.query(candSql, paramsCand)).rows;

  return { normalized, exact, candidates };
}

export default {
  ensureTable,
  normalizeKeyText,
  create,
  upsert,
  getById,
  remove,
  list,
  resolve,
};
