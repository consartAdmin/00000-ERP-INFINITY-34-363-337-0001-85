// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ pricesApi.js — API Service: Price Tables (CONSART ERP | PostgreSQL | ESM) ║
// ║ Tabela: public."prices"                                                  ║
// ║ - ensureTable                                                            ║
// ║ - listSimple (p/ dropdown)                                                ║
// ║ - list (q/paginação)                                                      ║
// ║ - getById / create / update / softDelete / restore                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_PRICES = 'public."prices"';

export async function ensurePricesTable() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS ${TB_PRICES} (
      price_id    SERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL,
      description TEXT,
      active      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP WITHOUT TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_prices_name ON ${TB_PRICES}(name);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'prices_name_unique'
      ) THEN
        ALTER TABLE ${TB_PRICES}
          ADD CONSTRAINT prices_name_unique UNIQUE (name);
      END IF;
    END$$;
  `;

  await pool.query(ddl);
}

/** dropdown: GET /api/prices -> { ok:true, rows:[{price_id,name}] } */
export async function listSimple({ onlyActive = true } = {}) {
  await ensurePricesTable();
  const rs = await pool.query(
    `
      SELECT price_id, name
      FROM ${TB_PRICES}
      WHERE ($1::bool = false OR active = true)
      ORDER BY name ASC
    `,
    [!!onlyActive]
  );
  return rs.rows;
}

export async function list({ q = '', page = 1, limit = 50, sort = 'name', dir = 'asc', onlyActive = false } = {}) {
  await ensurePricesTable();

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const offset = (safePage - 1) * safeLimit;

  const sortWhitelist = new Set(['name', 'created_at', 'updated_at', 'price_id']);
  const dirWhitelist = new Set(['asc', 'desc']);
  const safeSort = sortWhitelist.has(String(sort)) ? String(sort) : 'name';
  const safeDir = dirWhitelist.has(String(dir).toLowerCase()) ? String(dir).toLowerCase() : 'asc';

  const where = [];
  const params = [];
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(name ILIKE $${params.length} OR COALESCE(description,'') ILIKE $${params.length})`);
  }
  if (onlyActive === true) {
    params.push(true);
    where.push(`active = $${params.length}`);
  }
  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const dataSql = `
    SELECT price_id, name, description, active, created_at, updated_at
    FROM ${TB_PRICES}
    ${whereSQL}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM ${TB_PRICES}
    ${whereSQL}
  `;

  const [dataRs, countRs] = await Promise.all([
    pool.query(dataSql, [...params, safeLimit, offset]),
    pool.query(countSql, params),
  ]);

  return {
    rows: dataRs.rows,
    total: countRs.rows?.[0]?.total ?? 0,
    page: safePage,
    limit: safeLimit,
  };
}

export async function getById(id) {
  await ensurePricesTable();
  const rs = await pool.query(
    `SELECT price_id, name, description, active, created_at, updated_at
     FROM ${TB_PRICES}
     WHERE price_id = $1`,
    [id]
  );
  return rs.rows?.[0] || null;
}

export async function create({ name, description = null, active = true }) {
  await ensurePricesTable();
  const rs = await pool.query(
    `
      INSERT INTO ${TB_PRICES}(name, description, active, created_at, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING price_id, name, description, active, created_at, updated_at
    `,
    [String(name).trim(), description, !!active]
  );
  return rs.rows[0];
}

export async function update(id, { name = null, description = null, active = null }) {
  await ensurePricesTable();
  const rs = await pool.query(
    `
      UPDATE ${TB_PRICES}
      SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        active      = COALESCE($3, active),
        updated_at  = CURRENT_TIMESTAMP
      WHERE price_id = $4
      RETURNING price_id, name, description, active, created_at, updated_at
    `,
    [
      name !== null && name !== undefined ? String(name).trim() : null,
      description !== undefined ? description : null,
      active !== undefined ? !!active : null,
      id
    ]
  );
  return rs.rows?.[0] || null;
}

export async function softDelete(id) {
  await ensurePricesTable();
  const rs = await pool.query(
    `
      UPDATE ${TB_PRICES}
      SET active = false, updated_at = CURRENT_TIMESTAMP
      WHERE price_id = $1
      RETURNING price_id, name, description, active, created_at, updated_at
    `,
    [id]
  );
  return rs.rows?.[0] || null;
}

export async function restore(id) {
  await ensurePricesTable();
  const rs = await pool.query(
    `
      UPDATE ${TB_PRICES}
      SET active = true, updated_at = CURRENT_TIMESTAMP
      WHERE price_id = $1
      RETURNING price_id, name, description, active, created_at, updated_at
    `,
    [id]
  );
  return rs.rows?.[0] || null;
}


export async function permanentDelete(id) {
  await ensurePricesTable();

  const rs = await pool.query(
    `
      DELETE FROM ${TB_PRICES}
      WHERE price_id = $1
      RETURNING
        price_id,
        name,
        description,
        active,
        created_at,
        updated_at
    `,
    [id],
  );

  return rs.rows?.[0] || null;
}