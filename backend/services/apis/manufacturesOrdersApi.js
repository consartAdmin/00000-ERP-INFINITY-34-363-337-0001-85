// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: manufacturesOrdersApi.js                                      ║
// ║ MODULE: Manufactures Orders                                         ║
// ║ DESCRIPTION: Pedido para fabricantes usando productsStockApi.js     ║
// ║ CONSART ERP | PostgreSQL | ESM                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import productsStockApi from './productsStock/productsStock.manager.js';

const TB_ORDERS = 'public."manufacturesOrders"';
const TB_ITEMS = 'public."manufacturesOrderItems"';

function toNumber(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

async function generateOrderNumber(client) {
  const year = new Date().getFullYear();

  const { rows } = await client.query(`
    SELECT COUNT(*)::int + 1 AS next_number
    FROM ${TB_ORDERS}
    WHERE EXTRACT(YEAR FROM created_at) = $1
  `, [year]);

  const seq = String(rows[0]?.next_number || 1).padStart(5, '0');
  return `MF-${year}-${seq}`;
}

async function recalcTotal(client, manufactureOrderId) {
  const { rows } = await client.query(`
    UPDATE ${TB_ORDERS} o
       SET total_cost = COALESCE((
         SELECT ROUND(SUM(i.quantity * i.cost_price)::numeric, 2)
         FROM ${TB_ITEMS} i
         WHERE i.manufacture_order_id = o.manufacture_order_id
       ), 0),
       updated_at = NOW()
     WHERE o.manufacture_order_id = $1
     RETURNING *
  `, [manufactureOrderId]);

  return rows[0];
}

async function resolveProductFromStock(productStockId) {
  if (!productStockId) return null;

  if (typeof productsStockApi.getById === 'function') {
    const row = await productsStockApi.getById(productStockId);
    return row?.data || row || null;
  }

  const { rows } = await pool.query(`
    SELECT 
      ps.product_stock_id,
      ps.product_code,
      p.sku,
      p.description,
      p.name,
      p.unit,
      p.cost_price
    FROM public."productsStock" ps
    LEFT JOIN public.products p 
      ON p.product_code::text = ps.product_code::text
    WHERE ps.product_stock_id = $1
    LIMIT 1
  `, [productStockId]);

  return rows[0] || null;
}

export async function list(params = {}) {
  const page = Math.max(toNumber(params.page, 1), 1);
  const pageSize = Math.min(Math.max(toNumber(params.pageSize, 100), 1), 500);
  const offset = (page - 1) * pageSize;

  const search = safeText(params.search, '');
  const status = safeText(params.status, '');

  const where = [];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    where.push(`(
      o.order_number ILIKE $${values.length}
      OR o.manufacturer_name ILIKE $${values.length}
      OR o.notes ILIKE $${values.length}
    )`);
  }

  if (status) {
    values.push(status);
    where.push(`o.status = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT
      o.*,
      COALESCE(ic.items_count, 0)::int AS items_count
    FROM ${TB_ORDERS} o
    LEFT JOIN (
      SELECT
        manufacture_order_id,
        COUNT(*)::int AS items_count
      FROM ${TB_ITEMS}
      GROUP BY manufacture_order_id
    ) ic ON ic.manufacture_order_id = o.manufacture_order_id
    ${whereSql}
    ORDER BY o.manufacture_order_id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `, [...values, pageSize, offset]);

  const count = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM ${TB_ORDERS} o
    ${whereSql}
  `, values);

  console.log('[manufacturesOrdersApi.list]', {
    total: count.rows[0]?.total || 0,
    rows_count: rows.length,
    ids: rows.map(r => r.manufacture_order_id),
  });

  return {
    rows,
    total: count.rows[0]?.total || 0,
    page,
    pageSize,
  };
}

export async function getById(id) {

  /* ╔══════════════════════════════════════════════════════════════╗
     ║ ORDER                                                       ║
     ╚══════════════════════════════════════════════════════════════╝ */

  const { rows } = await pool.query(`
    SELECT *
    FROM ${TB_ORDERS}
    WHERE manufacture_order_id = $1
    LIMIT 1
  `, [id]);

  const order = rows[0];

  if (!order) {
    return null;
  }

  /* ╔══════════════════════════════════════════════════════════════╗
     ║ ITEMS + STOCK                                                ║
     ╚══════════════════════════════════════════════════════════════╝ */

  const itemsResult = await pool.query(`
    SELECT
      i.*,

      /* PRODUCT */
      p.product_id,
      p.product_stock_id,

      /* STOCK */
      COALESCE(ps.stock_qty, 0)  AS stock_qty,
      COALESCE(ps.stock_min, 0)  AS stock_min,
      COALESCE(ps.stock_max, 0)  AS stock_max

    FROM ${TB_ITEMS} i

    LEFT JOIN public.products p
      ON p.product_code::text = i.product_code::text

    LEFT JOIN public."productsStock" ps
      ON ps.product_stock_id = p.product_stock_id

    WHERE i.manufacture_order_id = $1

    ORDER BY i.manufacture_order_item_id ASC
  `, [id]);

  return {
    ...order,
    items: itemsResult.rows,
  };
}

export async function create(payload = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderNumber = safeText(payload.order_number) || await generateOrderNumber(client);

    const { rows } = await client.query(`
      INSERT INTO ${TB_ORDERS} (
        order_number,
        manufacturer_id,
        manufacturer_name,
        status,
        notes
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      orderNumber,
      payload.manufacturer_id || null,
      safeText(payload.manufacturer_name),
      safeText(payload.status, 'OPEN'),
      safeText(payload.notes),
    ]);

    const order = rows[0];

    const items = Array.isArray(payload.items) ? payload.items : [];

    for (const item of items) {
      await addItemTx(client, order.manufacture_order_id, item);
    }

    const updated = await recalcTotal(client, order.manufacture_order_id);

    await client.query('COMMIT');

    return getById(updated.manufacture_order_id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function addItemTx(client, manufactureOrderId, item = {}) {
  const productStockId = item.product_stock_id || null;
  const product = productStockId ? await resolveProductFromStock(productStockId) : null;

  const productCode =
    safeText(item.product_code) ||
    safeText(product?.product_code);

  const sku =
    safeText(item.sku) ||
    safeText(product?.sku) ||
    productCode;

  const description =
    safeText(item.description) ||
    safeText(product?.description) ||
    safeText(product?.name) ||
    '-';

  const unit =
    safeText(item.unit) ||
    safeText(product?.unit) ||
    'UN';

  const quantity = toNumber(item.quantity, 0);
  const costPrice = toNumber(
    item.cost_price ?? product?.cost_price,
    0
  );

  if (!quantity || quantity <= 0) {
    throw new Error('Quantidade inválida no item do pedido.');
  }

  await client.query(`
    INSERT INTO ${TB_ITEMS} (
      manufacture_order_id,
      product_stock_id,
      product_code,
      sku,
      description,
      unit,
      quantity,
      cost_price
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [
    manufactureOrderId,
    productStockId,
    productCode,
    sku,
    description,
    unit,
    quantity,
    costPrice,
  ]);
}

export async function addItem(manufactureOrderId, item = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await addItemTx(client, manufactureOrderId, item);
    await recalcTotal(client, manufactureOrderId);

    await client.query('COMMIT');

    return getById(manufactureOrderId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function update(id, payload = {}) {
  const { rows } = await pool.query(`
    UPDATE ${TB_ORDERS}
       SET manufacturer_id = COALESCE($2, manufacturer_id),
           manufacturer_name = COALESCE($3, manufacturer_name),
           status = COALESCE($4, status),
           notes = COALESCE($5, notes),
           updated_at = NOW()
     WHERE manufacture_order_id = $1
     RETURNING *
  `, [
    id,
    payload.manufacturer_id || null,
    safeText(payload.manufacturer_name),
    safeText(payload.status),
    safeText(payload.notes),
  ]);

  return rows[0] || null;
}

export async function updateItem(itemId, payload = {}) {
  const quantity = payload.quantity !== undefined ? toNumber(payload.quantity) : null;
  const costPrice = payload.cost_price !== undefined ? toNumber(payload.cost_price) : null;

  const { rows } = await pool.query(`
    UPDATE ${TB_ITEMS}
       SET quantity = COALESCE($2, quantity),
           cost_price = COALESCE($3, cost_price),
           unit = COALESCE($4, unit),
           description = COALESCE($5, description)
     WHERE manufacture_order_item_id = $1
     RETURNING *
  `, [
    itemId,
    quantity,
    costPrice,
    safeText(payload.unit),
    safeText(payload.description),
  ]);

  const item = rows[0];
  if (item) await recalcTotal(pool, item.manufacture_order_id);

  return item || null;
}

export async function removeItem(itemId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      DELETE FROM ${TB_ITEMS}
      WHERE manufacture_order_item_id = $1
      RETURNING manufacture_order_id
    `, [itemId]);

    const orderId = rows[0]?.manufacture_order_id;

    if (orderId) await recalcTotal(client, orderId);

    await client.query('COMMIT');

    return { removed: !!orderId, manufacture_order_id: orderId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function remove(id) {
  const { rowCount } = await pool.query(`
    DELETE FROM ${TB_ORDERS}
    WHERE manufacture_order_id = $1
  `, [id]);

  return { removed: rowCount > 0 };
}

export async function listWithItems(params = {}) {
  const result = await list({
    ...params,
    pageSize: params.pageSize || 1000,
  });

  const rows = [];

  for (const order of result.rows || []) {
    const id = order.manufacture_order_id || order.id || order.order_id;
    const fullOrder = await getById(id);

    if (fullOrder) {
      rows.push(fullOrder);
    }
  }

  return {
    ...result,
    rows,
  };
}

export default {
  list,
  listWithItems,
  getById,
  create,
  update,
  addItem,
  updateItem,
  removeItem,
  remove,
};