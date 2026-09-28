// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ productsGradesApi.js — Service (ESM)                                   ║
// ║ CONSART ERP                                                            ║
// ║ Tabela: public."productsGrades"                                        ║
// ║ ✅ Grades por SKU                                                      ║
// ║ ✅ Support product_grade_id                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."productsGrades"';
const TB_GRADES = 'public."grades"';
const TB_PRODUCTS = 'public.products';

const nowSql = 'NOW()';

const toNumOrNull = (v) =>
(v === '' || v == null || Number.isNaN(Number(v))
  ? null
  : Number(v));

const toStr = (v) => (v == null ? '' : String(v).trim());

export async function ensureTable() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB}(
        product_grade_id SERIAL PRIMARY KEY,
        product_id TEXT NOT NULL,
        grade_id INTEGER NOT NULL REFERENCES ${TB_GRADES}(grade_id) ON DELETE RESTRICT,
        stock INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT ${nowSql},
        updated_at TIMESTAMP DEFAULT ${nowSql}
      );
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE indexname = 'uq_productsgrades_product_grade'
        ) THEN
          CREATE UNIQUE INDEX uq_productsgrades_product_grade
          ON ${TB}(product_id, grade_id);
        END IF;
      END$$;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_timestamp_products_grades()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_products_grades_set_timestamp'
        ) THEN
          CREATE TRIGGER trg_products_grades_set_timestamp
          BEFORE UPDATE ON ${TB}
          FOR EACH ROW
          EXECUTE FUNCTION set_timestamp_products_grades();
        END IF;
      END$$;
    `);

    await client.query('COMMIT');

    return { ok: true };

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   LIST BY PRODUCT ID
────────────────────────────────────────────────────────────── */
export async function listByProduct(
  productId,
  { limit = 500, offset = 0 } = {}
) {
  await ensureTable();

  const pid = toStr(productId);

  const { rows } = await pool.query(
    `
      SELECT
        pg.product_grade_id,
        pg.product_id,
        pg.grade_id,
        g.grade,
        g.description,
        pg.stock,
        pg.is_active,
        pg.created_at,
        pg.updated_at
      FROM ${TB} pg
      JOIN ${TB_GRADES} g
        ON g.grade_id = pg.grade_id
      WHERE pg.product_id = $1
      ORDER BY pg.is_active DESC, g.grade ASC
      LIMIT $2 OFFSET $3
    `,
    [pid, limit, offset]
  );

  const totalRes = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM ${TB}
      WHERE product_id = $1
    `,
    [pid]
  );

  return {
    rows,
    total: totalRes.rows?.[0]?.total ?? rows.length,
    limit,
    offset,
  };
}

/* ──────────────────────────────────────────────────────────────
   GET BY SKU
────────────────────────────────────────────────────────────── */
export async function getBySku(product_code) {
  await ensureTable();

  const raw = String(product_code || '').trim();

  if (!raw) return [];

  const numeric = String(Number(raw) || '').trim();

  const padded6 =
    /^\d+$/.test(raw)
      ? raw.padStart(6, '0')
      : raw;

  const padded10 =
    /^\d+$/.test(raw)
      ? raw.padStart(10, '0')
      : raw;

  const sql = `
    SELECT
      pg.product_grade_id,
      pg.product_id,
      pg.grade_id,
      g.grade,
      g.description,
      pg.stock,
      pg.is_active,

      p.product_id AS erp_product_id,
      p.product_code,
      p.description AS product_description

    FROM ${TB} pg

    INNER JOIN ${TB_GRADES} g
      ON g.grade_id = pg.grade_id

    LEFT JOIN ${TB_PRODUCTS} p
      ON (
           TRIM(p.product_code) = TRIM(pg.product_id)
        OR TRIM(p.product_id::text) = TRIM(pg.product_id)
      )

    WHERE
         TRIM(pg.product_id) = TRIM($1)
      OR TRIM(pg.product_id) = TRIM($2)
      OR TRIM(pg.product_id) = TRIM($3)
      OR TRIM(pg.product_id) = TRIM($4)

    AND COALESCE(pg.is_active, TRUE) = TRUE

    ORDER BY
      g.grade ASC NULLS LAST,
      pg.product_grade_id ASC
  `;

  const { rows } = await pool.query(
    sql,
    [
      raw,
      numeric,
      padded6,
      padded10,
    ]
  );

  return rows;
}

/* ──────────────────────────────────────────────────────────────
   UPSERT
────────────────────────────────────────────────────────────── */
export async function createUpsert(input = {}) {
  await ensureTable();

  const product_id = toStr(input.product_id);
  const grade_id = toNumOrNull(input.grade_id);

  if (!product_id) {
    throw new Error('product_id é obrigatório.');
  }

  if (!grade_id) {
    throw new Error('grade_id é obrigatório.');
  }

  const stock = toNumOrNull(input.stock) ?? 0;

  const isActive =
    typeof input.is_active === 'string'
      ? ['true', '1', 't', 'yes', 'y']
        .includes(input.is_active.toLowerCase())
      : (input.is_active ?? true);

  const sql = `
    INSERT INTO ${TB}
    (
      product_id,
      grade_id,
      stock,
      is_active
    )
    VALUES ($1, $2, $3, $4)

    ON CONFLICT (product_id, grade_id)
    DO UPDATE
      SET stock = EXCLUDED.stock,
          is_active = EXCLUDED.is_active,
          updated_at = ${nowSql}

    RETURNING *
  `;

  const { rows } = await pool.query(
    sql,
    [product_id, grade_id, stock, isActive]
  );

  return rows[0];
}

/* ──────────────────────────────────────────────────────────────
   UPDATE
────────────────────────────────────────────────────────────── */
export async function update(id, patch = {}) {
  await ensureTable();

  const sets = [];
  const vals = [];

  if ('stock' in patch) {
    vals.push(toNumOrNull(patch.stock) ?? 0);
    sets.push(`stock = $${vals.length}`);
  }

  if ('is_active' in patch) {
    const v = patch.is_active;

    const b =
      typeof v === 'string'
        ? ['true', '1', 't', 'yes', 'y']
          .includes(v.toLowerCase())
        : !!v;

    vals.push(b);
    sets.push(`is_active = $${vals.length}`);
  }

  if (!sets.length) {
    const { rows } = await pool.query(
      `SELECT * FROM ${TB} WHERE product_grade_id = $1`,
      [Number(id)]
    );

    return rows[0] || null;
  }

  const sql = `
    UPDATE ${TB}
       SET ${sets.join(', ')},
           updated_at = ${nowSql}
     WHERE product_grade_id = $${vals.length + 1}
     RETURNING *
  `;

  const { rows } = await pool.query(
    sql,
    [...vals, Number(id)]
  );

  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   REMOVE
────────────────────────────────────────────────────────────── */
export async function remove(id) {
  await ensureTable();

  await pool.query(
    `DELETE FROM ${TB} WHERE product_grade_id = $1`,
    [Number(id)]
  );

  return { ok: true };
}

export default {
  ensureTable,
  listByProduct,
  getBySku,
  createUpsert,
  update,
  remove,
};