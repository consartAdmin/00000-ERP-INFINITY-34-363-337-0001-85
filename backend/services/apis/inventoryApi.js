// ╔════════════════════════════════════════════════════════════════════════╗
// ║ inventoryApi.js — Service/API de Inventories (PostgreSQL) — CONSART   ║
// ║ ✅ FIX CRÍTICO 2026-02-28: JOIN de localização 100% seguro            ║
// ║ ✅ FIX CRÍTICO 2026-03-01: Inventário ajusta LOTE (productsStockLots)  ║
// ║ ✅ FIX CRÍTICO 2026-03-01: Schema-safe (colunas opcionais não quebram) ║
// ║ ✅ FIX CRÍTICO 2026-03-01: LOGA ERRO RAIZ (query wrapper com label)   ║
// ║ ✅ FIX CRÍTICO 2026-03-28: Finalização robusta por unidade/fator       ║
// ║ ✅ Compatível: lot_id só é usado se existir em inventoryItems          ║
// ╚════════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

import {
  registerProductMovement,
  MOVEMENT_TYPES,
} from '../products/productMovementsService.js';

// ──────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────
const TB_INV = 'public.inventories';
const TB_ITEMS = 'public."inventoryItems"';
const TB_LOGS = 'public."inventoryLogs"';
const TB_LOTS = 'public."productsStockLots"';

const INVENTORY_DEBUG = String(process.env.CONSART_INVENTORY_DEBUG ?? 'true').toLowerCase() !== 'false';

function invDebug(scope, message, data = {}) {
  if (!INVENTORY_DEBUG) return;
  console.log(`[inventoryApi][${scope}] ${message}`, data);
}

function invWarn(scope, message, data = {}) {
  console.warn(`[inventoryApi][${scope}] ${message}`, data);
}

function invError(scope, message, err, data = {}) {
  console.error(`[inventoryApi][${scope}] ${message}`, {
    ...data,
    error: {
      code: err?.code,
      message: err?.message,
      detail: err?.detail,
      where: err?.where,
      table: err?.table,
      column: err?.column,
      constraint: err?.constraint,
      stack: err?.stack,
    },
  });
}

function qtyDebug(rawQty, factor) {
  const raw = Number(rawQty ?? 0);
  const f = Number(factor ?? 1);
  const safeFactor = Number.isFinite(f) && f > 0 ? f : 1;

  return {
    counted_qty_input: rawQty,
    counted_qty_raw: Number.isFinite(raw) ? raw : null,
    unit_factor: safeFactor,
    counted_qty_base: Number.isFinite(raw) ? raw * safeFactor : null,
  };
}

// ──────────────────────────────────────────────────────────────
// Helpers numéricos / safe parse
// ──────────────────────────────────────────────────────────────
const isFiniteNum = (v) => {
  if (v === '' || v == null) return false;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n);
};

const toNumOrNull = (v) => (isFiniteNum(v) ? Number(String(v).replace(',', '.')) : null);

function toIntOrNull(v) {
  if (v === '' || v == null) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toBaseQty(countedQty, fator = 1) {
  const qty = Number(countedQty ?? 0);
  const factor = Number(fator ?? 1);
  if (!Number.isFinite(qty)) return null;
  if (!Number.isFinite(factor) || factor <= 0) return qty;
  return qty * factor;
}

function addToMapNumber(map, key, value) {
  const current = Number(map.get(key) ?? 0);
  const next = current + Number(value ?? 0);
  map.set(key, next);
  return next;
}

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// ✅ Query wrapper (LOGA ERRO RAIZ)
// ──────────────────────────────────────────────────────────────
async function q(clientOrPool, label, sql, params = []) {
  try {
    return await clientOrPool.query(sql, params);
  } catch (err) {
    console.error('[inventoryApi] QUERY FAILED:', {
      label,
      code: err?.code,
      message: err?.message,
      detail: err?.detail,
      where: err?.where,
      schema: err?.schema,
      table: err?.table,
      column: err?.column,
      constraint: err?.constraint,
    });

    console.error('[inventoryApi] SQL:', sql);
    console.error('[inventoryApi] PARAMS:', params);

    throw err;
  }
}

// ──────────────────────────────────────────────────────────────
// ✅ Schema-safe helpers (tabela/coluna existe?)
// ──────────────────────────────────────────────────────────────
const __COLS_CACHE = new Map();

async function getTableCols(schema, table, clientOrPool = pool) {
  const key = `${schema}.${table}`;
  if (__COLS_CACHE.has(key)) return __COLS_CACHE.get(key);

  const { rows } = await q(
    clientOrPool,
    `cols:${schema}.${table}`,
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name   = $2
    `,
    [schema, table],
  );

  const set = new Set(rows.map((r) => r.column_name));
  __COLS_CACHE.set(key, set);
  return set;
}

async function hasCol(schema, table, col, clientOrPool = pool) {
  const cols = await getTableCols(schema, table, clientOrPool);
  return cols.has(col);
}

async function hasTable(schema, table, clientOrPool = pool) {
  const { rows } = await q(
    clientOrPool,
    `hasTable:${schema}.${table}`,
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_name   = $2
    LIMIT 1
    `,
    [schema, table],
  );
  return !!rows?.length;
}

// ──────────────────────────────────────────────────────────────
// ✅ productsLocations: JOIN seguro + idCol dinâmico
// ──────────────────────────────────────────────────────────────
let __PL_COLS_CACHE = null;
let __PL_ID_COL_CACHE = null;

function qIdent(col) {
  return `"${String(col).replaceAll('"', '""')}"`;
}

async function getProductsLocationsCols(clientOrPool = pool) {
  if (__PL_COLS_CACHE) return __PL_COLS_CACHE;

  const { rows } = await q(
    clientOrPool,
    'cols:productsLocations',
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'productsLocations'
    `,
    [],
  );

  __PL_COLS_CACHE = new Set(rows.map((r) => r.column_name));
  return __PL_COLS_CACHE;
}

async function getProductsLocationsIdCol(clientOrPool = pool) {
  if (__PL_ID_COL_CACHE) return __PL_ID_COL_CACHE;

  const cols = await getProductsLocationsCols(clientOrPool);
  const candidates = ['id', 'product_location_id', 'location_id'];
  const found = candidates.find((c) => cols.has(c));

  if (!found) {
    throw new Error(
      `productsLocations: não encontrei coluna identificadora (tentado: ${candidates.join(', ')}). ` +
      `Colunas atuais: ${[...cols].join(', ')}`,
    );
  }

  __PL_ID_COL_CACHE = found;
  return found;
}

async function getProductsLocationsDefaultCol(clientOrPool = pool) {
  const cols = await getProductsLocationsCols(clientOrPool);
  const candidates = ['is_default', 'default', 'principal', 'is_principal'];
  return candidates.find((c) => cols.has(c)) || null;
}

async function joinProductsLocationsSql(clientOrPool = pool, itAlias = 'it') {
  const idCol = await getProductsLocationsIdCol(clientOrPool);
  return `
    LEFT JOIN public."productsLocations" pl
      ON pl.${qIdent(idCol)} = ${itAlias}.product_location_id::bigint
  `;
}

// ──────────────────────────────────────────────────────────────
// ✅ inventoryItems: detectar coluna lot_id
// ──────────────────────────────────────────────────────────────
let __IT_COLS_CACHE = null;
async function getInventoryItemsCols(clientOrPool = pool) {
  if (__IT_COLS_CACHE) return __IT_COLS_CACHE;

  const { rows } = await q(
    clientOrPool,
    'cols:inventoryItems',
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'inventoryItems'
    `,
    [],
  );

  __IT_COLS_CACHE = new Set(rows.map((r) => r.column_name));
  return __IT_COLS_CACHE;
}

async function inventoryItemsHasLot(clientOrPool = pool) {
  const cols = await getInventoryItemsCols(clientOrPool);
  return cols.has('lot_id');
}

// ──────────────────────────────────────────────────────────────
// Mappers
// ──────────────────────────────────────────────────────────────
const rowToInventory = (r) => ({
  inventory_id: r.inventory_id,
  code: r.code,
  description: r.description,
  type: r.type,
  status: r.status,
  reference_date: r.reference_date,
  notes: r.notes,
  created_by: r.created_by,
  finalized_by: r.finalized_by,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const rowToItem = (r) => ({
  inventory_item_id: r.inventory_item_id,
  inventory_id: r.inventory_id,
  product_code: r.product_code,
  product_id: r.product_id ?? null,
  product_name: r.product_name,
  product_unit_id: r.product_unit_id,
  product_location_id: r.product_location_id,

  barcode: r.barcode ?? null,
  fator: r.fator != null ? Number(r.fator) : null,
  standard: r.standard ?? null,

  lot_id: r.lot_id ?? null,
  lot_code: r.lot_code ?? null,
  lot_expires_at: r.lot_expires_at ?? null,

  unit: r.unit || null,
  location_name: r.location_name || null,
  system_stock_qty: Number(r.system_stock_qty ?? 0),
  counted_qty: r.counted_qty != null ? Number(r.counted_qty) : null,
  difference_qty: r.difference_qty != null ? Number(r.difference_qty) : null,
  status: r.status,
  notes: r.notes,
  created_at: r.created_at,
  updated_at: r.updated_at,

  total_qty: r.total_qty != null
    ? Number(r.total_qty)
    : null,

});

const rowToLog = (r) => ({
  log_id: r.log_id,
  inventory_id: r.inventory_id,
  inventory_item_id: r.inventory_item_id,
  user_id: r.user_id,
  user_name: r.user_name_resolved || r.user_name || null,
  action: r.action,
  product_code: r.product_code,
  product_name: r.product_name,
  unit: r.unit,
  system_qty_before: r.system_qty_before != null ? Number(r.system_qty_before) : null,
  counted_qty: r.counted_qty != null ? Number(r.counted_qty) : null,
  system_qty_after: r.system_qty_after != null ? Number(r.system_qty_after) : null,
  created_at: r.created_at,
});

function normalizeUserCtx(userCtx = {}) {
  const id = userCtx.id ?? userCtx.user_id ?? (typeof userCtx === 'number' ? userCtx : null);
  const name = userCtx.name ?? userCtx.user_name ?? userCtx.full_name ?? null;
  return { user_id: id ?? null, user_name: name ?? null };
}

async function insertLog(
  client,
  {
    inventory_id,
    inventory_item_id = null,
    action,
    product_code = null,
    product_name = null,
    unit = null,
    system_qty_before = null,
    counted_qty = null,
    system_qty_after = null,
    userCtx = {},
  },
) {
  const { user_id, user_name } = normalizeUserCtx(userCtx);

  await q(
    client,
    'insertLog',
    `
    INSERT INTO ${TB_LOGS}
      (inventory_id,
       inventory_item_id,
       user_id,
       user_name,
       action,
       product_code,
       product_name,
       unit,
       system_qty_before,
       counted_qty,
       system_qty_after)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
    `,
    [
      inventory_id,
      inventory_item_id,
      user_id,
      user_name,
      action,
      product_code,
      product_name,
      unit,
      system_qty_before,
      counted_qty,
      system_qty_after,
    ],
  );
}

// ──────────────────────────────────────────────────────────────
// INVENTORIES
// ──────────────────────────────────────────────────────────────
export async function list({ search, status, limit = 50, offset = 0 }) {
  const params = [];
  const where = [];

  if (search) {
    const like = `%${search}%`;
    params.push(like);
    const idx = params.length;
    where.push(`(inv.code ILIKE $${idx} OR inv.description ILIKE $${idx})`);
  }

  if (status) {
    params.push(status);
    const idx = params.length;
    where.push(`inv.status = $${idx}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const sql = `
    SELECT
      inv.inventory_id,
      inv.code,
      inv.description,
      inv.type,
      inv.status,
      inv.reference_date,
      inv.notes,
      inv.created_by,
      inv.finalized_by,
      inv.created_at,
      inv.updated_at
    FROM ${TB_INV} inv
    ${whereSql}
    ORDER BY inv.created_at DESC
    LIMIT $${limitIdx}
    OFFSET $${offsetIdx};
  `;

  params.push(limit, offset);
  const { rows } = await q(pool, 'inventory.list', sql, params);
  return { rows };
}

export async function getById(inventory_id) {
  const { rows } = await q(
    pool,
    'inventory.getById',
    `SELECT * FROM ${TB_INV} WHERE inventory_id = $1;`,
    [inventory_id],
  );
  return rows[0] ? rowToInventory(rows[0]) : null;
}

export async function create(payload = {}) {
  const {
    code,
    description = null,
    type = 'GENERAL',
    status = 'OPEN',
    reference_date,
    notes = null,
    created_by = null,
  } = payload;

  if (!code) throw new Error('Code is required');
  if (!reference_date) throw new Error('Reference date is required');

  const { rows } = await q(
    pool,
    'inventory.create',
    `
    INSERT INTO ${TB_INV}
      (code, description, type, status, reference_date, notes, created_by)
    VALUES ($1, $2, UPPER($3), UPPER($4), $5, $6, $7)
    RETURNING *;
    `,
    [code.trim(), description, type, status, reference_date, notes, created_by],
  );

  return rowToInventory(rows[0]);
}

export async function update(inventory_id, payload = {}) {
  const fields = [];
  const params = [];
  let idx = 1;

  const map = {
    code: payload.code?.trim(),
    description: payload.description ?? null,
    type: payload.type ? payload.type.toUpperCase() : undefined,
    status: payload.status ? payload.status.toUpperCase() : undefined,
    reference_date: payload.reference_date ?? null,
    notes: payload.notes ?? null,
    finalized_by: payload.finalized_by ?? undefined,
  };

  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      fields.push(`${col} = $${idx++}`);
      params.push(val);
    }
  }

  if (!fields.length) return getById(inventory_id);

  params.push(inventory_id);

  const sql = `
    UPDATE ${TB_INV}
       SET ${fields.join(', ')},
           updated_at = NOW()
     WHERE inventory_id = $${idx}
     RETURNING *;
  `;

  const { rows } = await q(pool, 'inventory.update', sql, params);
  return rows[0] ? rowToInventory(rows[0]) : null;
}

export async function remove(inventory_id) {
  const { rows } = await q(
    pool,
    'inventory.remove',
    `DELETE FROM ${TB_INV} WHERE inventory_id = $1 RETURNING *;`,
    [inventory_id],
  );
  return rows[0] ? rowToInventory(rows[0]) : null;
}

// ──────────────────────────────────────────────────────────────
// ITEMS
// ──────────────────────────────────────────────────────────────
export async function listItems(inventory_id) {
  const joinPL = await joinProductsLocationsSql(pool, 'it');
  const hasLot = await inventoryItemsHasLot(pool);
  const joinLot = hasLot ? `LEFT JOIN ${TB_LOTS} lot ON lot.lot_id = it.lot_id` : '';

  const sql = `
  SELECT
      it.*,
      pu.unit,
      pu.barcode,
      pu.fator,

     (
      COALESCE(it.counted_qty,0)
      *
      COALESCE(pu.fator,1)
     ) AS total_qty,
      pu.standard,
      ${hasLot ? `lot.lot_code, lot.expires_at AS lot_expires_at,` : ''}
      CONCAT_WS(' / ', pl.corredor, pl.prateleira, pl.bandeja, pl.box) AS location_name
      FROM ${TB_ITEMS} it

     LEFT JOIN public."productsBarCode" pu
      ON pu.product_unit_id = it.product_unit_id
      AND pu.product_code = it.product_code
      AND COALESCE(pu.is_active, TRUE) IS TRUE

      ${joinPL}
    ${joinLot}
   WHERE it.inventory_id = $1
   ORDER BY it.inventory_item_id;
  `;

  const { rows } = await q(pool, 'items.listItems', sql, [inventory_id]);
  return rows.map(rowToItem);
}

export async function getItemById(inventory_item_id) {
  const joinPL = await joinProductsLocationsSql(pool, 'it');
  const hasLot = await inventoryItemsHasLot(pool);
  const joinLot = hasLot ? `LEFT JOIN ${TB_LOTS} lot ON lot.lot_id = it.lot_id` : '';

  const sql = `
    SELECT
    it.*,
    pu.unit,
    
    (
    COALESCE(it.counted_qty,0)
    *
    COALESCE(pu.fator,1)
  ) AS total_qty,
      ${hasLot ? `lot.lot_code, lot.expires_at AS lot_expires_at,` : ''}
      CONCAT_WS(' / ', pl.corredor, pl.prateleira, pl.bandeja, pl.box) AS location_name
    FROM ${TB_ITEMS} it
    LEFT JOIN public."productsUnits" pu
           ON pu.product_unit_id = it.product_unit_id
    ${joinPL}
    ${joinLot}
   WHERE it.inventory_item_id = $1;
  `;

  const { rows } = await q(pool, 'items.getItemById', sql, [inventory_item_id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function addItem(inventory_id, payload = {}, userCtx = {}) {
  const client = await pool.connect();
  try {
    await q(client, 'tx.BEGIN', 'BEGIN', []);

    const { rows: invRows } = await q(
      client,
      'inv.FOR_UPDATE',
      `SELECT * FROM ${TB_INV} WHERE inventory_id = $1 FOR UPDATE;`,
      [inventory_id],
    );
    const inv = invRows[0];
    if (!inv) throw new Error('Inventory not found');
    if (['FINALIZED', 'CANCELLED'].includes((inv.status || '').toUpperCase())) {
      throw new Error('Inventory is already finalized/cancelled');
    }

    const productCode = String(payload.product_code || '').trim();
    if (!productCode) throw new Error('product_code is required');

    const { rows: prodRows } = await q(
      client,
      'product.by_code',
      `
      SELECT product_id, product_code, description, product_stock_id
      FROM public."products"
      WHERE product_code = $1
      LIMIT 1;
      `,
      [productCode],
    );
    const prod = prodRows[0];
    if (!prod) throw new Error(`Product not found for code "${productCode}"`);

    if (!prod.product_stock_id) {
      const ins = await q(
        client,
        'productsStock.insert',
        `INSERT INTO public."productsStock"(stock_qty) VALUES (0) RETURNING product_stock_id;`,
        [],
      );
      const newStockId = ins.rows[0]?.product_stock_id;
      if (!newStockId) throw new Error('Failed to create productsStock row');

      await q(
        client,
        'products.update_stock_id',
        `
        UPDATE public."products"
           SET product_stock_id = $1,
               updated_at = NOW()
         WHERE product_code = $2
           AND product_stock_id IS NULL;
        `,
        [newStockId, prod.product_code],
      );

      prod.product_stock_id = newStockId;
    }

    let stockQty = 0;
    {
      const stockRes = await q(
        client,
        'productsStock.get_qty',
        `SELECT stock_qty FROM public."productsStock" WHERE product_stock_id = $1`,
        [prod.product_stock_id],
      );
      stockQty = stockRes.rows[0]?.stock_qty ?? 0;
    }

    const countedQtyRaw = toNumOrNull(payload.counted_qty);
    if (countedQtyRaw == null) throw new Error('counted_qty is required');

    let unitFactor = Number(payload.fator ?? payload.factor ?? 1);
    if (!Number.isFinite(unitFactor) || unitFactor <= 0) unitFactor = 1;

    // ✅ SALVA A QTD DIGITADA, SEM MULTIPLICAR
    const countedQty = countedQtyRaw;

    invDebug('addItem.qty', 'Quantidade recebida para inclusão', {
      inventory_id,
      product_code: productCode,
      payload_product_unit_id: payload.product_unit_id,
      payload_unit: payload.unit,
      ...qtyDebug(countedQtyRaw, unitFactor),
      note: 'counted_qty salvo RAW; conversão para base ocorre só na finalização.',
    });
    let productUnitId = toIntOrNull(payload.product_unit_id);
    let productLocationId = toIntOrNull(payload.product_location_id);

    if (productLocationId) {
      const plIdCol = await getProductsLocationsIdCol(client);
      const plHasActive = await hasCol('public', 'productsLocations', 'is_active', client);

      const { rows: validLocRows } = await q(
        client,
        'productsLocations.validate_selected',
        `
    SELECT ${qIdent(plIdCol)} AS loc_id
    FROM public."productsLocations"
    WHERE ${qIdent(plIdCol)} = $1
      AND product_code = $2
      ${plHasActive ? 'AND COALESCE(is_active, TRUE) IS TRUE' : ''}
    LIMIT 1;
    `,
        [productLocationId, prod.product_code],
      );

      if (!validLocRows.length) {
        productLocationId = null;
      }
    }

    const unitText = payload.unit ? String(payload.unit).trim().toUpperCase() : null;
    const locationText = payload.location ? String(payload.location).trim() : null;

    if (!productUnitId && unitText) {
      const puHasActive = await hasCol('public', 'productsBarCode', 'is_active', client);

      const { rows: uRows } = await q(
        client,
        'productsUnits.find',
        `
        SELECT product_unit_id
          FROM public."productsBarCode"
         WHERE product_code = $1
           AND LOWER(unit) = LOWER($2)
           ${puHasActive ? 'AND COALESCE(is_active, TRUE) IS TRUE' : ''}
         LIMIT 1;
        `,
        [prod.product_code, unitText],
      );
      productUnitId = uRows[0]?.product_unit_id ?? null;

      if (!productUnitId) {
        const hasUnits = await hasTable('public', 'units', client);
        if (hasUnits) {
          const unitsHasActive = await hasCol('public', 'units', 'is_active', client);
          const unitsHasFator = await hasCol('public', 'units', 'fator', client);
          const unitsHasUnitId = await hasCol('public', 'units', 'unit_id', client);

          const { rows: gRows } = await q(
            client,
            'units.find',
            `
            SELECT
              unit,
              description
              ${unitsHasFator ? ', fator' : ''}
              ${unitsHasUnitId ? ', unit_id' : ''}
            FROM public.units
            WHERE LOWER(unit) = LOWER($1)
              ${unitsHasActive ? 'AND COALESCE(is_active, TRUE) IS TRUE' : ''}
            LIMIT 1;
            `,
            [unitText],
          );
          const g = gRows[0];

          if (g?.unit) {
            const puCols = await getTableCols('public', 'productsUnits', client);

            const cols = ['product_code', 'unit', 'description', 'created_at', 'updated_at'];
            const vals = [prod.product_code, g.unit, g.description ?? null];
            const ph = ['$1', '$2', '$3', 'NOW()', 'NOW()'];
            let p = 4;

            if (puCols.has('fator')) {
              cols.push('fator');
              vals.push(g.fator ?? 1);
              ph.push(`$${p++}`);
            }
            if (puCols.has('standard')) {
              cols.push('standard');
              vals.push(false);
              ph.push(`$${p++}`);
            }
            if (puCols.has('unit_id') && unitsHasUnitId) {
              cols.push('unit_id');
              vals.push(g.unit_id ?? null);
              ph.push(`$${p++}`);
            }
            if (puCols.has('is_active')) {
              cols.push('is_active');
              vals.push(true);
              ph.push(`$${p++}`);
            }

            const insPu = await q(
              client,
              'productsUnits.insert',
              `
              INSERT INTO public."productsUnits" (${cols.join(', ')})
              VALUES (${ph.join(', ')})
              RETURNING product_unit_id;
              `,
              vals,
            );

            productUnitId = insPu.rows[0]?.product_unit_id ?? null;
          }
        }
      }
    }

    if (!productLocationId) {
      const plIdCol = await getProductsLocationsIdCol(client);
      const plDefaultCol = await getProductsLocationsDefaultCol(client);
      const plHasActive = await hasCol('public', 'productsLocations', 'is_active', client);

      const orderBy =
        plDefaultCol
          ? `ORDER BY COALESCE(${qIdent(plDefaultCol)}, FALSE) DESC, COALESCE(is_active, TRUE) DESC, ${qIdent(plIdCol)} DESC`
          : `ORDER BY COALESCE(is_active, TRUE) DESC, ${qIdent(plIdCol)} DESC`;

      const { rows: locRows } = await q(
        client,
        'productsLocations.list',
        `
        SELECT
          ${qIdent(plIdCol)} AS loc_id,
          corredor, prateleira, bandeja, box, observacao
          ${plDefaultCol ? `, ${qIdent(plDefaultCol)} AS is_default` : ''}
        FROM public."productsLocations"
        WHERE product_code = $1
          ${plHasActive ? 'AND COALESCE(is_active, TRUE) IS TRUE' : ''}
        ${orderBy};
        `,
        [prod.product_code],
      );

      console.log('\n================ LOCATIONS FOUND ================');
      console.log('PRODUCT:', prod.product_code);
      console.table(
        locRows.map(r => ({
          loc_id: r.loc_id,
          corredor: r.corredor,
          prateleira: r.prateleira,
          bandeja: r.bandeja,
          is_default: r.is_default,
        }))
      );
      console.log('================================================\n');

      if (!locRows.length) {
        throw new Error(`Product "${prod.product_code}" has no registered location.`);
      }

      if (locRows.length === 1) {
        productLocationId = toIntOrNull(locRows[0]?.loc_id) ?? null;
      } else {
        if (locationText) {
          const like = `%${locationText}%`;
          const { rows: matchRows } = await q(
            client,
            'productsLocations.match',
            `
            SELECT ${qIdent(plIdCol)} AS loc_id
            FROM public."productsLocations"
            WHERE product_code = $1
              ${plHasActive ? 'AND COALESCE(is_active, TRUE) IS TRUE' : ''}
              AND (
                corredor   ILIKE $2 OR
                prateleira ILIKE $2 OR
                bandeja    ILIKE $2 OR
                box        ILIKE $2 OR
                observacao ILIKE $2
              )
            ORDER BY ${qIdent(plIdCol)} DESC
            LIMIT 1;
            `,
            [prod.product_code, like],
          );
          productLocationId = toIntOrNull(matchRows[0]?.loc_id) ?? null;
        }

        if (!productLocationId && plDefaultCol) {
          const def = locRows.find((r) => r.is_default === true);
          if (def) productLocationId = toIntOrNull(def.loc_id) ?? null;
        }

        console.log('[INVENTORY] productLocationId before fallback:', productLocationId);
        console.log('[INVENTORY] first location:', locRows[0]);

        if (!productLocationId) {
          productLocationId = toIntOrNull(locRows[0]?.loc_id) ?? null;
        }

        if (!productLocationId) {
          throw new Error(`Product "${prod.product_code}" has multiple locations. Please select one.`);
        }
      }
    }

    const hasLot = await inventoryItemsHasLot(client);
    const lotId = hasLot ? toIntOrNull(payload.lot_id) : null;

    if (hasLot && lotId) {
      const { rows: lotRows } = await q(
        client,
        'lots.get',
        `
        SELECT lot_id, product_stock_id, lot_code, expires_at, qty_on_hand
        FROM ${TB_LOTS}
        WHERE lot_id = $1
        LIMIT 1;
        `,
        [lotId],
      );
      const lot = lotRows[0];
      if (!lot) throw new Error(`Lot not found (lot_id=${lotId}).`);
      if (String(lot.product_stock_id) !== String(prod.product_stock_id)) {
        throw new Error(`Lot (lot_id=${lotId}) does not belong to product_stock_id (${prod.product_stock_id}).`);
      }
      stockQty = lot.qty_on_hand ?? 0;
    }

    const notes = payload.notes ?? null;

    const baseCols = [
      'inventory_id',
      'product_code',
      'product_name',
      'product_unit_id',
      'product_location_id',
      ...(hasLot ? ['lot_id'] : []),
      'system_stock_qty',
      'counted_qty',
      'status',
      'notes',
    ];

    const baseVals = [
      inventory_id,
      prod.product_code,
      prod.description ?? null,
      productUnitId,
      productLocationId,
      ...(hasLot ? [lotId] : []),
      stockQty,
      countedQty,
      'PENDING',
      notes,
    ];

    const colsSql = baseCols.join(', ');
    const phSql = baseVals.map((_, i) => `$${i + 1}`).join(', ');

    const conflictWithLot = hasLot
      ? '(inventory_id, product_code, product_unit_id, product_location_id, lot_id)'
      : '(inventory_id, product_code, product_unit_id, product_location_id)';

    const conflictNoLot = '(inventory_id, product_code, product_unit_id, product_location_id)';

    const doUpdate = `
  DO UPDATE SET
    counted_qty       = COALESCE(${TB_ITEMS}.counted_qty, 0) + COALESCE(EXCLUDED.counted_qty, 0),
    notes            = EXCLUDED.notes,
    system_stock_qty = EXCLUDED.system_stock_qty,
    ${hasLot ? 'lot_id = EXCLUDED.lot_id,' : ''}
    updated_at       = NOW()
`;

    let newId = null;
    try {
      const { rows } = await q(
        client,
        'items.upsert',
        `
        INSERT INTO ${TB_ITEMS} (${colsSql})
        VALUES (${phSql})
        ON CONFLICT ${conflictWithLot}
        ${doUpdate}
        RETURNING inventory_item_id;
        `,
        baseVals,
      );
      newId = rows[0]?.inventory_item_id ?? null;
    } catch (err) {
      if (hasLot && err?.code === '42P10') {
        const { rows } = await q(
          client,
          'items.upsert.fallback_no_lot',
          `
          INSERT INTO ${TB_ITEMS} (${colsSql})
          VALUES (${phSql})
          ON CONFLICT ${conflictNoLot}
          ${doUpdate}
          RETURNING inventory_item_id;
          `,
          baseVals,
        );
        newId = rows[0]?.inventory_item_id ?? null;
      } else {
        throw err;
      }
    }

    let unitForLog = unitText;
    if (!unitForLog && productUnitId) {
      const { rows: puRows } = await q(
        client,
        'productsUnits.get_unit',
        `SELECT unit
        FROM public."productsBarCode"
        WHERE product_unit_id = $1
        AND COALESCE(is_active, TRUE) IS TRUE
        ORDER BY standard DESC, fator ASC
        LIMIT 1;`,
        [productUnitId],
      );
      unitForLog = puRows[0]?.unit ?? null;
    }

    await insertLog(client, {
      inventory_id,
      inventory_item_id: newId,
      action: 'ITEM_ADDED',
      product_code: prod.product_code,
      product_name: prod.description,
      unit: unitForLog,
      system_qty_before: stockQty,
      counted_qty: countedQty,
      system_qty_after: null,
      userCtx,
    });

    const joinPL = await joinProductsLocationsSql(client, 'it');
    const joinLot = hasLot ? `LEFT JOIN ${TB_LOTS} lot ON lot.lot_id = it.lot_id` : '';

    const { rows: fullRows } = await q(
      client,
      'items.select_full',
      `
      SELECT
        it.*,
        pu.unit,
        ${hasLot ? `lot.lot_code, lot.expires_at AS lot_expires_at,` : ''}
        CONCAT_WS(' / ', pl.corredor, pl.prateleira, pl.bandeja, pl.box) AS location_name
      FROM ${TB_ITEMS} it
      LEFT JOIN public."productsBarCode" pu
             ON pu.product_unit_id = it.product_unit_id
      ${joinPL}
      ${joinLot}
      WHERE it.inventory_item_id = $1;
      `,
      [newId],
    );

    await q(client, 'tx.COMMIT', 'COMMIT', []);
    return fullRows[0] ? rowToItem(fullRows[0]) : null;
  } catch (err) {
    try { await q(client, 'tx.ROLLBACK', 'ROLLBACK', []); } catch (_) { }
    throw err;
  } finally {
    client.release();
  }
}

export async function removeItemFromInventory(inventory_id, inventory_item_id) {
  const { rows } = await q(
    pool,
    'items.removeFromInventory',
    `DELETE FROM ${TB_ITEMS}
      WHERE inventory_id = $1 AND inventory_item_id = $2
      RETURNING *;`,
    [inventory_id, inventory_item_id],
  );
  return rows[0] ? rowToItem(rows[0]) : null;
}

// ──────────────────────────────────────────────────────────────
// Helpers de estoque finalização/reabertura
// ──────────────────────────────────────────────────────────────
async function ensureProductsStockRows(client, productStockIds = []) {
  const ids = [...new Set(productStockIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];
  if (!ids.length) return;

  const psHasUpdatedAt = await hasCol('public', 'productsStock', 'updated_at', client);

  for (const stockId of ids) {
    const exists = await q(
      client,
      'productsStock.ensure.exists',
      `SELECT product_stock_id FROM public."productsStock" WHERE product_stock_id = $1 LIMIT 1;`,
      [stockId],
    );
    if (!exists.rows.length) {
      await q(
        client,
        'productsStock.ensure.insert',
        `
        INSERT INTO public."productsStock" (product_stock_id, stock_qty${psHasUpdatedAt ? ', updated_at' : ''})
        VALUES ($1, 0${psHasUpdatedAt ? ', NOW()' : ''});
        `,
        [stockId],
      );
    }
  }
}

async function getLotSumsByStockIds(client, stockIds = []) {
  const ids = [...new Set(stockIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];
  const out = new Map();
  if (!ids.length) return out;

  for (const chunk of chunkArray(ids, 500)) {
    const { rows } = await q(
      client,
      'lots.sum.by.stockIds',
      `
      SELECT
        product_stock_id,
        SUM(COALESCE(qty_on_hand, 0)) AS sum_qty
      FROM ${TB_LOTS}
      WHERE product_stock_id = ANY($1::bigint[])
      GROUP BY product_stock_id;
      `,
      [chunk],
    );

    for (const row of rows) {
      out.set(Number(row.product_stock_id), Number(row.sum_qty ?? 0));
    }
  }

  return out;
}

async function updateProductsStockQty(client, totalsMap = new Map()) {
  const entries = [...totalsMap.entries()]
    .map(([product_stock_id, stock_qty]) => ({
      product_stock_id: Number(product_stock_id),
      stock_qty: Number(stock_qty ?? 0),
    }))
    .filter((r) => Number.isInteger(r.product_stock_id) && r.product_stock_id > 0);

  if (!entries.length) return;

  await ensureProductsStockRows(client, entries.map((r) => r.product_stock_id));

  const psHasUpdatedAt = await hasCol('public', 'productsStock', 'updated_at', client);

  for (const row of entries) {
    await q(
      client,
      'productsStock.update.qty',
      `
      UPDATE public."productsStock"
         SET stock_qty = $2
             ${psHasUpdatedAt ? ', updated_at = NOW()' : ''}
       WHERE product_stock_id = $1;
      `,
      [row.product_stock_id, row.stock_qty],
    );
  }
}

// ──────────────────────────────────────────────────────────────
// FINALIZE (robusta por unidade/fator/lote)
// ──────────────────────────────────────────────────────────────
export async function finalizeInventory(inventory_id, { applyAdjust = true, userCtx = {} } = {}) {
  const client = await pool.connect();

  try {
    await q(client, 'tx.BEGIN.finalize', 'BEGIN', []);

    const { rows: invRows } = await q(
      client,
      'finalize.inv.lock',
      `SELECT * FROM ${TB_INV} WHERE inventory_id = $1 FOR UPDATE;`,
      [inventory_id],
    );

    const inv = invRows[0];
    if (!inv) throw new Error('Inventory not found');

    const invStatus = String(inv.status || '').toUpperCase();

    if (['FINALIZED', 'CANCELLED'].includes(invStatus)) {
      throw new Error('Inventory already finalized/cancelled');
    }

    const hasLot = await inventoryItemsHasLot(client);
    const puHasFator = await hasCol('public', 'productsBarCode', 'fator', client);
    const lotsHasUpdatedAt = await hasCol('public', 'productsStockLots', 'updated_at', client);
    const stockHasUpdatedAt = await hasCol('public', 'productsStock', 'updated_at', client);

    const { rows: itemRows } = await q(
      client,
      'finalize.items.load',
      `
      SELECT
        it.inventory_item_id,
        it.inventory_id,
        it.product_code,
        it.product_name,
        it.product_unit_id,
        it.product_location_id,
        it.system_stock_qty,
        it.counted_qty,
        it.status,
        ${hasLot ? 'it.lot_id,' : ''}
        p.product_id,
        p.product_stock_id,
        p.description AS product_name_resolved,
        pu.unit,
        ${puHasFator ? 'COALESCE(pu.fator, 1) AS unit_factor' : '1::numeric AS unit_factor'}
      FROM ${TB_ITEMS} it
      JOIN public."products" p
        ON p.product_code = it.product_code
      LEFT JOIN public."productsBarCode" pu
        ON pu.product_unit_id = it.product_unit_id
       AND pu.product_code = it.product_code
       AND COALESCE(pu.is_active, TRUE) IS TRUE
      WHERE it.inventory_id = $1
      ORDER BY it.inventory_item_id;
      `,
      [inventory_id],
    );

    if (applyAdjust && itemRows.length) {
      const lotTotals = new Map();
      const stockTotals = new Map();

      for (const it of itemRows) {
        const stockId = Number(it.product_stock_id ?? 0);
        if (!Number.isInteger(stockId) || stockId <= 0) continue;

        const factor = Number(it.unit_factor ?? 1) || 1;

        // ✅ REGRA CORRETA:
        // counted_qty = quantidade contada na unidade escolhida
        // countedFinal = quantidade final em unidade base
        const countedFinal =
          it.counted_qty != null ? Number(it.counted_qty) * factor : null;

        invDebug('finalize.calc', 'Cálculo de quantidade final do item', {
          inventory_item_id: it.inventory_item_id,
          product_code: it.product_code,
          unit: it.unit,
          counted_qty_saved: it.counted_qty,
          unit_factor: factor,
          counted_final_qty: countedFinal,
          note: 'Multiplica contado pelo fator da unidade. Ex: CX.12 x 6 = 72.',
        });

        if (countedFinal == null || !Number.isFinite(countedFinal)) continue;

        if (hasLot && it.lot_id != null) {
          const lotId = Number(it.lot_id);
          const prevLot = Number(lotTotals.get(lotId) ?? 0);
          lotTotals.set(lotId, prevLot + countedFinal);
        }

        const prevStock = Number(stockTotals.get(stockId) ?? 0);
        stockTotals.set(stockId, prevStock + countedFinal);
      }

      if (hasLot && lotTotals.size) {
        for (const [lotId, qty] of lotTotals.entries()) {
          await q(
            client,
            'finalize.lot.grouped.update',
            `
            UPDATE ${TB_LOTS}
               SET qty_on_hand = $2
                   ${lotsHasUpdatedAt ? ', updated_at = NOW()' : ''}
             WHERE lot_id = $1;
            `,
            [lotId, qty],
          );
        }
      }

      if (stockTotals.size) {
        for (const [stockId, qty] of stockTotals.entries()) {
          await q(
            client,
            'finalize.stock.grouped.update',
            `
            UPDATE public."productsStock"
               SET stock_qty = $2
                   ${stockHasUpdatedAt ? ', updated_at = NOW()' : ''}
             WHERE product_stock_id = $1;
            `,
            [stockId, qty],
          );
        }
      }
    }

    for (const it of itemRows) {
      const factor = Number(it.unit_factor ?? 1) || 1;
      const before = Number(it.system_stock_qty ?? 0);

      const countedFinal =
        it.counted_qty != null ? Number(it.counted_qty) * factor : null;

      const after = applyAdjust
        ? (countedFinal != null && Number.isFinite(countedFinal) ? countedFinal : before)
        : before;

      const difference = Number(after || 0) - Number(before || 0);

      invDebug('finalize.movement', 'Movimento de estoque por finalização', {
        inventory_item_id: it.inventory_item_id,
        product_code: it.product_code,
        unit: it.unit,
        system_qty_before: before,
        counted_qty_saved: it.counted_qty,
        unit_factor: factor,
        system_qty_after: after,
        difference,
      });

      await insertLog(client, {
        inventory_id,
        inventory_item_id: it.inventory_item_id,
        action: 'FINALIZE_ADJUST',
        product_code: it.product_code,
        product_name: it.product_name_resolved || it.product_name,
        unit: it.unit,
        system_qty_before: before,
        counted_qty: countedFinal,
        system_qty_after: after,
        userCtx,
      });

      await registerProductMovement({
        client,
        product_code: it.product_code,
        movement_type: MOVEMENT_TYPES.INVENTARIO,
        origin_module: 'inventory',
        origin_table: 'inventoryItems',
        origin_id: it.inventory_item_id,
        quantity: difference,
        previous_stock: before,
        new_stock: after,
        unit: it.unit,
        lot_code: null,
        notes: 'Ajuste por finalização de inventário',
        user_id: userCtx?.id || null,
        metadata: {
          inventory_id,
          inventory_code: inv.code,
          inventory_type: inv.type,
          applyAdjust,
          product_id: it.product_id,
          product_stock_id: it.product_stock_id,
          product_unit_id: it.product_unit_id,
          product_location_id: it.product_location_id,
          counted_qty: it.counted_qty,
          counted_final_qty: countedFinal,
          unit_factor: factor,
          lot_id: hasLot ? it.lot_id ?? null : null,
          rule: 'counted_qty x unit_factor is applied on finalize',
        },
      });
    }

    await q(
      client,
      'finalize.items.status',
      `
      UPDATE ${TB_ITEMS} it
         SET status =
           CASE
             WHEN it.counted_qty IS NULL THEN it.status
             WHEN (
               it.counted_qty * COALESCE(
                 (
                   SELECT pu.fator
                   FROM public."productsBarCode" pu
                   WHERE COALESCE(pu.is_active, TRUE) IS TRUE
                     AND pu.product_unit_id = it.product_unit_id
                     AND pu.product_code = it.product_code
                   LIMIT 1
                 ),
                 1
               )
             ) = COALESCE(it.system_stock_qty, 0)
             THEN 'COUNTED'
             ELSE 'ADJUSTED'
           END,
           updated_at = NOW()
       WHERE it.inventory_id = $1;
      `,
      [inventory_id],
    );

    const { rows: updatedInv } = await q(
      client,
      'finalize.inv.status',
      `
      UPDATE ${TB_INV}
         SET status = 'FINALIZED',
             finalized_by = $2,
             updated_at = NOW()
       WHERE inventory_id = $1
       RETURNING *;
      `,
      [inventory_id, userCtx?.id ?? null],
    );

    await q(client, 'tx.COMMIT.finalize', 'COMMIT', []);

    return rowToInventory(updatedInv[0]);
  } catch (err) {
    try {
      await q(client, 'tx.ROLLBACK.finalize', 'ROLLBACK', []);
    } catch (_) { }

    invError('finalizeInventory', 'Erro ao finalizar inventário', err, {
      inventory_id,
      applyAdjust,
    });

    throw err;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────────────────────
// LOGS
// ──────────────────────────────────────────────────────────────
export async function listLogs({ inventory_id, dateFrom, dateTo, userName, productCode } = {}) {
  if (!inventory_id) throw new Error('inventory_id is required to list logs');

  const params = [inventory_id];
  const where = ['log.inventory_id = $1'];

  if (dateFrom) {
    params.push(dateFrom);
    where.push(`log.created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(`${dateTo} 23:59:59`);
    where.push(`log.created_at <= $${params.length}`);
  }
  if (userName) {
    params.push(`%${userName}%`);
    where.push(`(log.user_name ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
  }
  if (productCode) {
    params.push(`%${productCode}%`);
    where.push(`log.product_code ILIKE $${params.length}`);
  }

  const sql = `
    SELECT
      log.*,
      COALESCE(log.user_name, u.name) AS user_name_resolved
    FROM ${TB_LOGS} log
    LEFT JOIN public.users u
           ON u.id = log.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY log.created_at DESC, log.log_id DESC;
  `;

  const { rows } = await q(pool, 'logs.list', sql, params);
  return rows.map(rowToLog);
}

// ──────────────────────────────────────────────────────────────
// REOPEN / ESTORNO (sem tabela nova)
// - restaura lotes/estoque usando inventoryItems.system_stock_qty
// - reabre inventário e marca itens como PENDING
// ──────────────────────────────────────────────────────────────
export async function reopenInventory(inventory_id, { userCtx = {} } = {}) {
  const client = await pool.connect();
  try {
    await q(client, 'tx.BEGIN.reopen', 'BEGIN', []);

    const { rows: invRows } = await q(
      client,
      'reopen.inv.lock',
      `SELECT * FROM ${TB_INV} WHERE inventory_id = $1 FOR UPDATE;`,
      [inventory_id],
    );
    const inv = invRows[0];
    if (!inv) return null;

    const status = String(inv.status || '').toUpperCase();
    if (status !== 'FINALIZED') {
      throw new Error(`Inventory must be FINALIZED to reopen (current=${status}).`);
    }

    const hasLot = await inventoryItemsHasLot(client);
    const puHasFator = await hasCol('public', 'productsUnits', 'fator', client);

    const { rows: itemRows } = await q(
      client,
      'reopen.items.load',
      `
      SELECT
        it.inventory_item_id,
        it.inventory_id,
        it.product_code,
        it.product_name,
        it.product_unit_id,
        it.system_stock_qty,
        it.counted_qty,
        ${hasLot ? 'it.lot_id,' : ''}
        p.product_stock_id,
        ${puHasFator ? 'COALESCE(pu.fator, 1) AS unit_factor' : '1::numeric AS unit_factor'}
      FROM ${TB_ITEMS} it
      JOIN public."products" p
        ON p.product_code = it.product_code
      LEFT JOIN public."productsBarCode" pu
        ON pu.product_unit_id = it.product_unit_id
      WHERE it.inventory_id = $1
      ORDER BY it.inventory_item_id;
      `,
      [inventory_id],
    );

    const nonLotTotals = new Map();
    const lotAffectedStockIds = new Set();
    const allTouchedStockIds = new Set();

    for (const it of itemRows) {
      const stockId = Number(it.product_stock_id ?? 0);
      if (!Number.isInteger(stockId) || stockId <= 0) continue;

      allTouchedStockIds.add(stockId);

      const beforeBase = Number(it.system_stock_qty ?? 0);

      if (hasLot && it.lot_id != null) {
        const lotsHasUpdatedAt = await hasCol('public', 'productsStockLots', 'updated_at', client);

        await q(
          client,
          'reopen.restore.lot.single',
          `
          UPDATE ${TB_LOTS}
             SET qty_on_hand = $2
                 ${lotsHasUpdatedAt ? ', updated_at = NOW()' : ''}
           WHERE lot_id = $1;
          `,
          [it.lot_id, beforeBase],
        );

        lotAffectedStockIds.add(stockId);
      } else {
        addToMapNumber(nonLotTotals, stockId, beforeBase);
      }
    }

    const lotSums = await getLotSumsByStockIds(client, [...lotAffectedStockIds]);
    const finalTotals = new Map();

    for (const stockId of allTouchedStockIds) {
      const lotQty = Number(lotSums.get(stockId) ?? 0);
      const nonLotQty = Number(nonLotTotals.get(stockId) ?? 0);
      finalTotals.set(stockId, lotQty + nonLotQty);
    }

    await updateProductsStockQty(client, finalTotals);

    await q(
      client,
      'reopen.items.status',
      `
      UPDATE ${TB_ITEMS}
         SET status = 'PENDING',
             updated_at = NOW()
       WHERE inventory_id = $1;
      `,
      [inventory_id],
    );

    const { rows: updatedInv } = await q(
      client,
      'reopen.inv.status',
      `
      UPDATE ${TB_INV}
         SET status = 'OPEN',
             finalized_by = NULL,
             updated_at = NOW()
       WHERE inventory_id = $1
       RETURNING *;
      `,
      [inventory_id],
    );

    await insertLog(client, {
      inventory_id,
      inventory_item_id: null,
      action: 'REOPEN_RESTORE_FROM_ITEMS',
      userCtx,
    });

    await q(client, 'tx.COMMIT.reopen', 'COMMIT', []);
    return updatedInv[0] ? rowToInventory(updatedInv[0]) : null;
  } catch (err) {
    try { await q(client, 'tx.ROLLBACK.reopen', 'ROLLBACK', []); } catch (_) { }
    throw err;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────────────────────
// BARCODE RESOLUTION
// ──────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────
// BARCODE RESOLUTION
// ──────────────────────────────────────────────────────────────
export async function resolveProductByBarcode(barcode, clientOrPool = pool) {
  const cleanBarcode = String(barcode || '').trim();
  if (!cleanBarcode) return null;

  const onlyNums = cleanBarcode.replace(/\D+/g, '');
  if (!onlyNums) return null;

  const { rows } = await q(
    clientOrPool,
    'barcode.resolve.productsBarCode',
    `
    SELECT
      pbc.barcode_id,
      pbc.barcode,
      pbc.product_code,
      pbc.product_unit_id,
      pbc.unit,
      pbc.fator,
      pbc.description AS unit_description,
      pbc.standard,
      pbc.is_active,
      pbc.unit_id,
      p.product_id,
      p.description AS product_name,
      p.product_stock_id
    FROM public."productsBarCode" pbc
    JOIN public."products" p
      ON p.product_code = pbc.product_code
    WHERE REGEXP_REPLACE(COALESCE(pbc.barcode, ''), '\\D', '', 'g') = $1
    ORDER BY
      COALESCE(pbc.is_active, FALSE) DESC,
      COALESCE(pbc.standard, FALSE) DESC,
      pbc.barcode_id DESC
    LIMIT 1;
    `,
    [onlyNums],
  );

  return rows[0] || null;
}

export async function resolveInventoryPayloadFromBarcode(
  barcode,
  partialPayload = {},
  clientOrPool = pool,
) {
  const resolved = await resolveProductByBarcode(barcode, clientOrPool);
  if (!resolved) return null;

  const productCode = String(resolved.product_code || '').trim();
  if (!productCode) return null;

  let productUnitId =
    toIntOrNull(partialPayload.product_unit_id) ??
    toIntOrNull(resolved.product_unit_id);

  let productLocationId = toIntOrNull(partialPayload.product_location_id);
  let lotId = toIntOrNull(partialPayload.lot_id);

  if (!productLocationId) {
    const plIdCol = await getProductsLocationsIdCol(clientOrPool);
    const plDefaultCol = await getProductsLocationsDefaultCol(clientOrPool);
    const plHasActive = await hasCol('public', 'productsLocations', 'is_active', clientOrPool);

    const { rows: locRows } = await q(
      clientOrPool,
      'barcode.resolve.default_location',
      `
      SELECT ${qIdent(plIdCol)} AS loc_id
      FROM public."productsLocations"
      WHERE product_code = $1
        ${plHasActive ? 'AND COALESCE(is_active, TRUE) IS TRUE' : ''}
      ORDER BY
        ${plDefaultCol ? `COALESCE(${qIdent(plDefaultCol)}, FALSE) DESC,` : ''}
        ${qIdent(plIdCol)} ASC
      LIMIT 1;
      `,
      [productCode],
    );

    productLocationId = toIntOrNull(locRows[0]?.loc_id);
  }

  if (!lotId && resolved.product_stock_id) {
    const { rows: lotRows } = await q(
      clientOrPool,
      'barcode.resolve.single_lot',
      `
      SELECT lot_id
      FROM ${TB_LOTS}
      WHERE product_stock_id = $1
      ORDER BY expires_at NULLS LAST, lot_id ASC;
      `,
      [resolved.product_stock_id],
    );

    if (lotRows.length === 1) {
      lotId = toIntOrNull(lotRows[0]?.lot_id);
    }
  }

  return {
    product_code: productCode,
    product_unit_id: productUnitId,
    product_location_id: productLocationId,
    lot_id: lotId,

    // qtd digitada/lida na planilha
    counted_qty: partialPayload.counted_qty,

    // fator da unidade vinda do productsBarCode
    fator: Number(resolved.fator ?? 1) || 1,
    unit: resolved.unit || null,

    notes: partialPayload.notes ?? null,
  };
}

export default {
  list,
  getById,
  create,
  update,
  remove,
  listItems,
  getItemById,
  addItem,
  finalizeInventory,
  listLogs,
  removeItemFromInventory,
  reopenInventory,
  resolveProductByBarcode,
  resolveInventoryPayloadFromBarcode,
};