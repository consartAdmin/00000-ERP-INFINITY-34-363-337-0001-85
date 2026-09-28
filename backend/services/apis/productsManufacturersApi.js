// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ productsManufacturersApi.js — API de Fabricantes (CONSART ERP | ESM)     ║
// ║ - Tabela: public."productsManufactures" (alias: pmf)                      ║
// ║ - Campos: product_manufacturer_id, name, created_at, updated_at, is_active║
// ║ - Endpoints esperados:                                                    ║
// ║   GET    /api/products-manufacturers                                      ║
// ║   GET    /api/products-manufacturers/:id                                  ║
/* ║   POST   /api/products-manufacturers           { name, is_active? }
   ║   PUT    /api/products-manufacturers/:id       { name?, is_active? }
   ║   DELETE /api/products-manufacturers/:id       (hard delete)
   ║   UPSERT /api/products-manufacturers/upsert    { name, is_active? }      */
// ╚═══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB    = '"productsManufactures"';
const ALIAS = 'pmf';

const COLS = Object.freeze({
  id:         'product_manufacturer_id',
  name:       'name',
  created_at: 'created_at',
  updated_at: 'updated_at',
  is_active:  'is_active',
});

const ORDERABLE = new Set([COLS.name, COLS.created_at, COLS.updated_at, COLS.is_active]);

const toBool = (v) =>
  typeof v === 'boolean'
    ? v
    : v === 'true'
    ? true
    : v === 'false'
    ? false
    : null;

const notEmptyStr = (s) => typeof s === 'string' && s.trim().length > 0;
const uniqueViolation = (err) => err && err.code === '23505';

function sanitizeOrder(orderBy = COLS.name, dir = 'ASC') {
  const safeCol = ORDERABLE.has(orderBy) ? orderBy : COLS.name;
  const safeDir = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return { orderBy: safeCol, dir: safeDir };
}

function mapRow(r) {
  if (!r) return null;
  return {
    product_manufacturer_id: r.product_manufacturer_id,
    name: r.name,
    created_at: r.created_at,
    updated_at: r.updated_at,
    is_active: r.is_active,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Ensure tabela + índices + trigger
// ──────────────────────────────────────────────────────────────────────────────
export async function ensureProductsManufacturersTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${TB} (
        ${COLS.id} SERIAL PRIMARY KEY,
        ${COLS.name} VARCHAR(150) NOT NULL UNIQUE,
        ${COLS.created_at} TIMESTAMP DEFAULT NOW(),
        ${COLS.updated_at} TIMESTAMP DEFAULT NOW(),
        ${COLS.is_active}  BOOLEAN   DEFAULT TRUE
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_${ALIAS}_name_ci
        ON public.${TB} (LOWER(${COLS.name}));
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION trg_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.${COLS.updated_at} = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_${ALIAS}'
        ) THEN
          CREATE TRIGGER set_timestamp_${ALIAS}
          BEFORE UPDATE ON public.${TB}
          FOR EACH ROW
          EXECUTE PROCEDURE trg_set_timestamp();
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Listagem
// ──────────────────────────────────────────────────────────────────────────────
export async function listProductsManufacturers(params = {}) {
  const {
    q,
    is_active,
    limit = 50,
    offset = 0,
    orderBy = COLS.name,
    dir = 'ASC',
  } = params;

  const { orderBy: ob, dir: od } = sanitizeOrder(orderBy, dir);

  const where = [];
  const values = [];
  let i = 1;

  if (notEmptyStr(q)) {
    where.push(`LOWER(${COLS.name}) LIKE LOWER($${i++})`);
    values.push(`%${q.trim()}%`);
  }

  const activeBool = toBool(is_active);
  if (activeBool !== null) {
    where.push(`${COLS.is_active} = $${i++}`);
    values.push(activeBool);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT ${COLS.id}, ${COLS.name}, ${COLS.created_at}, ${COLS.updated_at}, ${COLS.is_active}
    FROM public.${TB} ${ALIAS}
    ${whereSql}
    ORDER BY ${ob} ${od}
    LIMIT $${i++} OFFSET $${i++};
  `;
  values.push(Number(limit) || 50, Number(offset) || 0);

  const countSql = `
    SELECT COUNT(*)::INT AS total
    FROM public.${TB} ${ALIAS}
    ${whereSql};
  `;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, values),
    pool.query(countSql, values.slice(0, values.length - 2)),
  ]);

  return {
    rows: rowsRes.rows.map(mapRow),
    total: countRes.rows[0]?.total ?? 0,
    limit: Number(limit) || 50,
    offset: Number(offset) || 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Get by ID
// ──────────────────────────────────────────────────────────────────────────────
export async function getProductsManufacturerById(id) {
  const res = await pool.query(
    `
      SELECT ${COLS.id}, ${COLS.name}, ${COLS.created_at}, ${COLS.updated_at}, ${COLS.is_active}
      FROM public.${TB}
      WHERE ${COLS.id} = $1
      LIMIT 1;
    `,
    [id]
  );
  return mapRow(res.rows[0]);
}

// ──────────────────────────────────────────────────────────────────────────────
// Create
// ──────────────────────────────────────────────────────────────────────────────
export async function createProductsManufacturer(payload = {}) {
  const errors = [];
  if (!notEmptyStr(payload.name)) {
    errors.push('O campo "name" é obrigatório.');
  } else if (payload.name.trim().length > 150) {
    errors.push('O campo "name" deve ter no máximo 150 caracteres.');
  }
  if (errors.length) {
    const e = new Error('ValidationError');
    e.details = errors;
    e.status = 400;
    throw e;
  }

  try {
    const res = await pool.query(
      `
        INSERT INTO public.${TB} (${COLS.name}, ${COLS.is_active})
        VALUES ($1, COALESCE($2, TRUE))
        RETURNING ${COLS.id}, ${COLS.name}, ${COLS.created_at}, ${COLS.updated_at}, ${COLS.is_active};
      `,
      [payload.name.trim(), payload.is_active ?? true]
    );
    return mapRow(res.rows[0]);
  } catch (err) {
    if (uniqueViolation(err)) {
      const e = new Error(`Já existe um fabricante com o nome "${payload.name.trim()}".`);
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Upsert by name
// ──────────────────────────────────────────────────────────────────────────────
export async function upsertProductsManufacturerByName({ name, is_active = true }) {
  if (!notEmptyStr(name)) {
    const e = new Error('O campo "name" é obrigatório.');
    e.status = 400;
    throw e;
  }
  const res = await pool.query(
    `
      INSERT INTO public.${TB} (${COLS.name}, ${COLS.is_active})
      VALUES ($1, $2)
      ON CONFLICT (${COLS.name})
      DO UPDATE SET
        ${COLS.is_active} = EXCLUDED.${COLS.is_active},
        ${COLS.updated_at} = NOW()
      RETURNING ${COLS.id}, ${COLS.name}, ${COLS.created_at}, ${COLS.updated_at}, ${COLS.is_active};
    `,
    [name.trim(), !!is_active]
  );
  return mapRow(res.rows[0]);
}

// ──────────────────────────────────────────────────────────────────────────────
// Update
// ──────────────────────────────────────────────────────────────────────────────
export async function updateProductsManufacturer(id, patch = {}) {
  const sets = [];
  const values = [];
  let i = 1;

  if (patch.name !== undefined) {
    if (!notEmptyStr(patch.name)) {
      const e = new Error('O campo "name" não pode ser vazio.');
      e.status = 400;
      throw e;
    }
    if (patch.name.trim().length > 150) {
      const e = new Error('O campo "name" deve ter no máximo 150 caracteres.');
      e.status = 400;
      throw e;
    }
    sets.push(`${COLS.name} = $${i++}`);
    values.push(patch.name.trim());
  }

  if (patch.is_active !== undefined) {
    sets.push(`${COLS.is_active} = $${i++}`);
    values.push(!!patch.is_active);
  }

  if (!sets.length) {
    const e = new Error('Nada para atualizar.');
    e.status = 400;
    throw e;
  }

  const sql = `
    UPDATE public.${TB}
       SET ${sets.join(', ')}, ${COLS.updated_at} = NOW()
     WHERE ${COLS.id} = $${i}
    RETURNING ${COLS.id}, ${COLS.name}, ${COLS.created_at}, ${COLS.updated_at}, ${COLS.is_active};
  `;
  values.push(id);

  try {
    const res = await pool.query(sql, values);
    return mapRow(res.rows[0]);
  } catch (err) {
    if (uniqueViolation(err)) {
      const e = new Error(`Já existe um fabricante com o nome "${patch.name?.trim()}".`);
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Deactivate (soft)
// ──────────────────────────────────────────────────────────────────────────────
export async function deactivateProductsManufacturer(id) {
  const res = await pool.query(
    `
      UPDATE public.${TB}
         SET ${COLS.is_active} = FALSE, ${COLS.updated_at} = NOW()
       WHERE ${COLS.id} = $1
      RETURNING ${COLS.id}, ${COLS.name}, ${COLS.created_at}, ${COLS.updated_at}, ${COLS.is_active};
    `,
    [id]
  );
  return mapRow(res.rows[0]);
}

// ──────────────────────────────────────────────────────────────────────────────
// Delete (hard)
// ──────────────────────────────────────────────────────────────────────────────
export async function deleteProductsManufacturer(id) {
  const res = await pool.query(
    `
      DELETE FROM public.${TB}
      WHERE ${COLS.id} = $1
      RETURNING ${COLS.id};
    `,
    [id]
  );
  return res.rowCount > 0;
}

const ProductsManufacturersAPI = Object.freeze({
  ensureProductsManufacturersTable,
  list: listProductsManufacturers,
  getById: getProductsManufacturerById,
  create: createProductsManufacturer,
  upsertByName: upsertProductsManufacturerByName,
  update: updateProductsManufacturer,
  deactivate: deactivateProductsManufacturer,
  remove: deleteProductsManufacturer,
});

export default ProductsManufacturersAPI;
