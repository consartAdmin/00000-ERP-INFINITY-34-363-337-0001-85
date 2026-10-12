// ╔════════════════════════════════════════════════════════════════════╗
// ║ productsMobileProduct.repository.js — busca por código de barras / SKU ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { normalizeSku10, toNumber, normalizeText } from './productsMobile.sanitizers.js';
import { buildLocation } from './productsMobile.mappers.js';

export async function findProductBaseByBarcodeOrSku(searchValue) {
  const raw = normalizeText(searchValue);
  const sku10 = normalizeSku10(raw);

  const sql = `
  SELECT
    p.product_id,
    p.product_code,
    p.description,

    p.product_imagem_id,

    p.cost_price,

    pp.sale_price,

    pb.barcode,
    pb.unit AS barcode_unit,
    pb.fator AS barcode_factor,

    ps.product_stock_id,
    ps.stock_qty,
    ps.stock_min,
    ps.stock_max,

    pl.id AS location_id,
    pl.store_id,
    pl.corredor,
    pl.prateleira,
    pl.bandeja,
    pl.box,
    pl.observacao AS location_observacao

  FROM public.products p

  LEFT JOIN public."productsBarCode" pb
    ON pb.product_code = p.product_code
   AND COALESCE(pb.is_active, true) = true

  LEFT JOIN public."productsStock" ps
    ON ps.product_stock_id = p.product_stock_id

  LEFT JOIN public."productsPrices" pp
    ON pp.product_id = p.product_id::text
   AND pp.price_id = 1

  LEFT JOIN public."productsLocations" pl
    ON pl.product_code = p.product_code
   AND COALESCE(pl.is_active, true) = true

  WHERE
      pb.barcode = $1
      OR p.product_code = $1
      OR p.product_code = $2

  ORDER BY
      CASE
          WHEN pb.barcode = $1 THEN 1
          WHEN p.product_code = $2 THEN 2
          WHEN p.product_code = $1 THEN 3
          ELSE 4
      END,
      pl.updated_at DESC NULLS LAST,
      pl.created_at DESC NULLS LAST

  LIMIT 1;
`;

  const { rows } = await pool.query(sql, [raw, sku10]);

  return rows[0] || null;
}

export async function listProductUnits(productCode) {
  const sql = `
    SELECT
      barcode_id,
      product_code,
      barcode,
      unit,
      fator,
      description,
      standard,
      is_active
    FROM public."productsBarCode"
    WHERE product_code = $1
      AND COALESCE(is_active, true) = true
    ORDER BY
      standard DESC NULLS LAST,
      fator ASC NULLS LAST,
      unit ASC;
  `;

  const { rows } = await pool.query(sql, [productCode]);

  return rows.map((row) => ({
    barcode_id: row.barcode_id,
    barcode: row.barcode,
    unit: row.unit || 'UN',
    factor: toNumber(row.fator, 1),
    description: row.description || '',
    standard: Boolean(row.standard),
  }));
}

export async function listProductLots(productStockId) {
  if (!productStockId) return [];

  const sql = `
    SELECT
      lot_id,
      lot_code,
      expires_at,
      qty_on_hand
    FROM public."productsStockLots"
    WHERE product_stock_id = $1
    ORDER BY
      expires_at NULLS LAST,
      lot_id ASC;
  `;

  const { rows } = await pool.query(sql, [productStockId]);

  return rows.map((row) => ({
    lot_id: row.lot_id,
    lot_code: row.lot_code,
    expires_at: row.expires_at,
    qty_on_hand: toNumber(row.qty_on_hand),
  }));
}

export async function getByBarcodeOrSku(searchValue) {
  const base = await findProductBaseByBarcodeOrSku(searchValue);

  if (!base) {
    return {
      found: false,
      product: null,
    };
  }

  const units = await listProductUnits(base.product_code);

  const lots = await listProductLots(base.product_stock_id);

  const stockQty = toNumber(base.stock_qty);
  const stockMin = toNumber(base.stock_min);
  const stockMax = toNumber(base.stock_max);

  let stock_status = 'NORMAL';

  if (stockQty <= 0) {
    stock_status = 'SEM_ESTOQUE';
  } else if (stockMin > 0 && stockQty <= stockMin) {
    stock_status = 'ABAIXO_MINIMO';
  }

  return {
    found: true,
    product: {
      product_id: base.product_id,
      product_code: base.product_code,
      description: base.description,

      barcode: base.barcode || null,

      stock: {
        product_stock_id: base.product_stock_id,
        quantity: stockQty,
        min: stockMin,
        max: stockMax,
        status: stock_status,
      },

      units,
      lots,
      location: {
        location_id: base.location_id || null,
        label: buildLocation(base),
        store_id: base.store_id || null,
        corredor: base.corredor || '',
        prateleira: base.prateleira || '',
        bandeja: base.bandeja || '',
        box: base.box || '',
        observacao: base.location_observacao || '',
      },

      prices: {
        cost_price: toNumber(base.cost_price),
        sale_price: toNumber(base.sale_price),
      },

      product_imagem_id: base.product_imagem_id || null,
    },
  };
}
