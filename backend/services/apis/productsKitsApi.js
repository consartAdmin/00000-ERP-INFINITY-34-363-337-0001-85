// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsKitsApi.js                                            ║
// ║ MODULE: Products Kits API / Service                                 ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_KITS = 'public."productsKits"';
const TB_ITEMS = 'public."productsKitsItens"';

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function calculateTotals(items = []) {
  let totalCost = 0;
  let totalSale = 0;

  for (const item of items) {
    const quantity = toNum(item.quantity, 1);
    const factor = toNum(item.unit_factor || item.fator || item.factor, 1);
    const cost = toNum(item.cost_unit, 0);
    const sale = toNum(item.sale_price_unit, 0);

    totalCost += quantity * factor * cost;
    totalSale += quantity * factor * sale;
  }

  return {
    totalCost: Number(totalCost.toFixed(2)),
    totalSale: Number(totalSale.toFixed(2)),
  };
}

async function getProductByCode(client, productCode) {
  const code = String(productCode || '').trim();
  if (!code) return null;

  const result = await client.query(`
    SELECT *
    FROM public.products
    WHERE product_code = $1
    LIMIT 1
  `, [code]);

  return result.rows[0] || null;
}

async function getFirstItemProductData(client, items = []) {
  const first = items.find((item) => item?.product_sku);
  if (!first) return null;

  return await getProductByCode(client, first.product_sku);
}

async function syncProductPrice(client, productId, salePrice) {
  const price = toNum(salePrice, 0);

  if (!productId) return;

  try {
    await client.query('SAVEPOINT sp_products_kits_price');

    const tableExists = await client.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'productsPrices'
      LIMIT 1
    `);

    if (!tableExists.rowCount) {
      await client.query('RELEASE SAVEPOINT sp_products_kits_price');
      return;
    }

    const result = await client.query(`
      SELECT id
      FROM public."productsPrices"
      WHERE product_id = $1
        AND price_id = 1
      LIMIT 1
    `, [productId]);

    if (result.rows.length) {
      await client.query(`
        UPDATE public."productsPrices"
        SET sale_price = $1
        WHERE id = $2
      `, [price, result.rows[0].id]);
    } else {
      await client.query(`
        INSERT INTO public."productsPrices"
          (product_id, price_id, sale_price)
        VALUES
          ($1, 1, $2)
      `, [productId, price]);
    }

    await client.query('RELEASE SAVEPOINT sp_products_kits_price');
  } catch (error) {
    try {
      await client.query('ROLLBACK TO SAVEPOINT sp_products_kits_price');
      await client.query('RELEASE SAVEPOINT sp_products_kits_price');
    } catch {}

    console.warn('[productsKitsApi.syncProductPrice] ignored:', error.message);
  }
}

export async function ensureProductsKitsTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_KITS} (
      id BIGSERIAL PRIMARY KEY,
      kit_sku VARCHAR(60) NOT NULL,
      kit_description TEXT NOT NULL,
      price_mode VARCHAR(20) DEFAULT 'MANUAL',
      sale_price NUMERIC(14,2) DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_ITEMS} (
      id BIGSERIAL PRIMARY KEY,
      kit_id BIGINT NOT NULL REFERENCES ${TB_KITS}(id) ON DELETE CASCADE,
      product_sku VARCHAR(60) NOT NULL,
      description TEXT,
      unit VARCHAR(20),
      unit_factor NUMERIC(14,6) NOT NULL DEFAULT 1,
      quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
      cost_unit NUMERIC(14,4) DEFAULT 0,
      sale_price_unit NUMERIC(14,4) DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE ${TB_ITEMS}
    ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(14,6) NOT NULL DEFAULT 1;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_kits_sku
    ON ${TB_KITS} (kit_sku);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_kits_items_kit_id
    ON ${TB_ITEMS} (kit_id);
  `);
}

export async function listProductsKits({ q = '', active = true } = {}) {
  await ensureProductsKitsTables();

  const params = [];
  let where = 'WHERE 1=1';

  if (active !== 'all') {
    params.push(normalizeBool(active));
    where += ` AND k.active = $${params.length}`;
  }

  if (q) {
    params.push(`%${q}%`);
    where += ` AND (
      k.kit_sku ILIKE $${params.length}
      OR k.kit_description ILIKE $${params.length}
    )`;
  }

  const result = await pool.query(`
    SELECT
      k.*,
      p.product_id,
      p.product_code,
      p.description AS product_description,
      p.product_unit_id,
      p.product_grade_id,
      p.product_price_id,
      p.product_stock_id,
      p.products_fiscal_id,
      COALESCE(COUNT(i.id), 0)::INT AS total_items,
      COALESCE(SUM(i.quantity * COALESCE(i.unit_factor, 1) * i.cost_unit), 0)::NUMERIC(14,2) AS total_cost,
      COALESCE(SUM(i.quantity * COALESCE(i.unit_factor, 1) * i.sale_price_unit), 0)::NUMERIC(14,2) AS total_sale_items
    FROM ${TB_KITS} k
    LEFT JOIN public.products p
      ON p.product_code = k.kit_sku
    LEFT JOIN ${TB_ITEMS} i
      ON i.kit_id = k.id
      AND i.active = TRUE
    ${where}
    GROUP BY
      k.id,
      p.product_id,
      p.product_code,
      p.description,
      p.product_unit_id,
      p.product_grade_id,
      p.product_price_id,
      p.product_stock_id,
      p.products_fiscal_id
    ORDER BY k.id DESC
  `, params);

  return result.rows;
}

export async function getProductsKitById(id) {
  await ensureProductsKitsTables();

  const kitResult = await pool.query(`
    SELECT
      k.*,
      p.product_id,
      p.product_code,
      p.description AS product_description,
      p.product_unit_id,
      p.product_grade_id,
      p.product_price_id,
      p.product_stock_id,
      p.products_fiscal_id
    FROM ${TB_KITS} k
    LEFT JOIN public.products p
      ON p.product_code = k.kit_sku
    WHERE k.id = $1
  `, [id]);

  if (!kitResult.rows.length) return null;

  const itemsResult = await pool.query(`
    SELECT *
    FROM ${TB_ITEMS}
    WHERE kit_id = $1
    ORDER BY id ASC
  `, [id]);

  return {
    ...kitResult.rows[0],
    items: itemsResult.rows,
  };
}

export async function createProductsKit(data) {
  await ensureProductsKitsTables();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      kit_description,
      price_mode = 'MANUAL',
      sale_price = 0,
      active = true,
      items = [],
    } = data;

    if (!kit_description) throw new Error('kit_description is required');
    if (!items.length) throw new Error('At least one kit item is required');

    const { totalCost, totalSale } = calculateTotals(items);
    const finalSalePrice = price_mode === 'SUM_ITEMS'
      ? totalSale
      : toNum(sale_price, totalSale);

    const firstProduct = await getFirstItemProductData(client, items);
    const productUnitId = firstProduct?.product_unit_id || null;

    const productResult = await client.query(`
      INSERT INTO public.products
        (
          description,
          cost_price,
          product_unit_id,
          product_grade_id,
          product_price_id,
          product_stock_id,
          products_fiscal_id,
          supplier_id,
          manufacturer_id,
          is_active
        )
      VALUES
        ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9)
      RETURNING
        product_id,
        product_code,
        description,
        product_unit_id,
        product_grade_id,
        product_price_id,
        product_stock_id,
        products_fiscal_id
    `, [
      kit_description,
      totalCost,
      productUnitId,
      firstProduct?.product_grade_id || null,
      firstProduct?.product_price_id || null,
      firstProduct?.products_fiscal_id || null,
      firstProduct?.supplier_id || null,
      firstProduct?.manufacturer_id || null,
      normalizeBool(active),
    ]);

    const product = productResult.rows[0];

    await syncProductPrice(client, product.product_id, finalSalePrice);

    const kitResult = await client.query(`
      INSERT INTO ${TB_KITS}
        (kit_sku, kit_description, price_mode, sale_price, active)
      VALUES
        ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      product.product_code,
      kit_description,
      price_mode,
      finalSalePrice,
      normalizeBool(active),
    ]);

    const kit = kitResult.rows[0];

    for (const item of items) {
      await client.query(`
        INSERT INTO ${TB_ITEMS}
          (
            kit_id,
            product_sku,
            description,
            unit,
            unit_factor,
            quantity,
            cost_unit,
            sale_price_unit,
            active
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
      `, [
        kit.id,
        item.product_sku,
        item.description || '',
        item.unit || '',
        toNum(item.unit_factor || item.fator || item.factor, 1),
        toNum(item.quantity, 1),
        toNum(item.cost_unit, 0),
        toNum(item.sale_price_unit, 0),
      ]);
    }

    await client.query('COMMIT');

    return await getProductsKitById(kit.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateProductsKit(id, data) {
  await ensureProductsKitsTables();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      kit_sku,
      kit_description,
      price_mode = 'MANUAL',
      sale_price = 0,
      active = true,
      items = [],
    } = data;

    if (!kit_description) throw new Error('kit_description is required');

    const { totalCost, totalSale } = calculateTotals(items);
    const finalSalePrice = price_mode === 'SUM_ITEMS'
      ? totalSale
      : toNum(sale_price, totalSale);

    const currentKit = await client.query(`
      SELECT *
      FROM ${TB_KITS}
      WHERE id = $1
      LIMIT 1
    `, [id]);

    if (!currentKit.rows.length) throw new Error('Products kit not found');

    const currentSku = currentKit.rows[0].kit_sku;
    const finalKitSku = kit_sku || currentSku;

    const firstProduct = await getFirstItemProductData(client, items);
    const productUnitId = firstProduct?.product_unit_id || null;

    const productResult = await client.query(`
      UPDATE public.products
      SET
        description = $1,
        cost_price = $2,
        product_unit_id = $3,
        product_grade_id = COALESCE($4, product_grade_id),
        product_price_id = COALESCE($5, product_price_id),
        products_fiscal_id = COALESCE($6, products_fiscal_id),
        supplier_id = COALESCE($7, supplier_id),
        manufacturer_id = COALESCE($8, manufacturer_id),
        is_active = $9,
        updated_at = NOW()
      WHERE product_code = $10
      RETURNING product_id, product_code
    `, [
      kit_description,
      totalCost,
      productUnitId,
      firstProduct?.product_grade_id || null,
      firstProduct?.product_price_id || null,
      firstProduct?.products_fiscal_id || null,
      firstProduct?.supplier_id || null,
      firstProduct?.manufacturer_id || null,
      normalizeBool(active),
      finalKitSku,
    ]);

    if (productResult.rows[0]?.product_id) {
      await syncProductPrice(client, productResult.rows[0].product_id, finalSalePrice);
    }

    await client.query(`
      UPDATE ${TB_KITS}
      SET
        kit_sku = $1,
        kit_description = $2,
        price_mode = $3,
        sale_price = $4,
        active = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
    `, [
      finalKitSku,
      kit_description,
      price_mode,
      finalSalePrice,
      normalizeBool(active),
      id,
    ]);

    await client.query(`
      DELETE FROM ${TB_ITEMS}
      WHERE kit_id = $1
    `, [id]);

    for (const item of items) {
      await client.query(`
        INSERT INTO ${TB_ITEMS}
          (
            kit_id,
            product_sku,
            description,
            unit,
            unit_factor,
            quantity,
            cost_unit,
            sale_price_unit,
            active
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        id,
        item.product_sku,
        item.description || '',
        item.unit || '',
        toNum(item.unit_factor || item.fator || item.factor, 1),
        toNum(item.quantity, 1),
        toNum(item.cost_unit, 0),
        toNum(item.sale_price_unit, 0),
        item.active !== false,
      ]);
    }

    await client.query('COMMIT');

    return await getProductsKitById(id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteProductsKit(id) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const kitResult = await client.query(`
      UPDATE ${TB_KITS}
      SET active = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);

    const kit = kitResult.rows[0] || null;

    if (kit?.kit_sku) {
      await client.query(`
        UPDATE public.products
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE product_code = $1
      `, [kit.kit_sku]);
    }

    await client.query('COMMIT');

    return kit;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function hardDeleteProductsKit(id) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const kitResult = await client.query(`
      SELECT *
      FROM ${TB_KITS}
      WHERE id = $1
      LIMIT 1
    `, [id]);

    const kit = kitResult.rows[0] || null;

    const result = await client.query(`
      DELETE FROM ${TB_KITS}
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (kit?.kit_sku) {
      await client.query(`
        DELETE FROM public.products
        WHERE product_code = $1
      `, [kit.kit_sku]);
    }

    await client.query('COMMIT');

    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}