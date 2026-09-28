// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsMobileApi.js                                          ║
// ║ MODULE: Products Mobile                                             ║
// ║ CONSART ERP | ESM | PostgreSQL                                      ║
// ║ ✅ Busca produto por código de barras                                ║
// ║ ✅ Busca produto por SKU                                             ║
// ║ ✅ Retorna estoque, unidades e localização                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

function normalizeSku10(value) {
  const raw = String(value || '').trim();

  if (!raw) return '';

  if (/^\d+$/.test(raw) && raw.length < 10) {
    return raw.padStart(10, '0');
  }

  return raw;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildLocation(row = {}) {
  const parts = [
    row.local,
    row.corredor,
    row.prateleira,
    row.bandeja,
    row.position,
    row.box,
  ]
    .map(normalizeText)
    .filter(Boolean);

  return parts.length
    ? parts.join(' / ')
    : 'Sem localização cadastrada';
}

async function findProductBaseByBarcodeOrSku(searchValue) {
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
    ON pp.product_price_id = p.product_price_id

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

async function listProductUnits(productCode) {
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

async function listProductLots(productStockId) {
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

async function getByBarcodeOrSku(searchValue) {
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

async function listLocationOptions() {
  const sql = `
    SELECT
      lb.id,
      lb.barcode,
      lb.barcode_type,
      lb.active,

      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      lbin.name AS bandeja,
      lp.name AS position

    FROM public."locationsBarCode" lb

    LEFT JOIN public."locationLocals" ll
      ON ll.id = lb.local_id

    LEFT JOIN public."locationCorridors" lc
      ON lc.id = lb.corridor_id

    LEFT JOIN public."locationShelves" ls
      ON ls.id = lb.shelf_id

    LEFT JOIN public."locationBins" lbin
      ON lbin.id = lb.bin_id

    LEFT JOIN public."locationPositions" lp
      ON lp.id = lb.position_id

    WHERE COALESCE(lb.active, true) = true

    ORDER BY
      ll.name ASC NULLS LAST,
      lc.name ASC NULLS LAST,
      ls.name ASC NULLS LAST,
      lbin.name ASC NULLS LAST,
      lp.name ASC NULLS LAST,
      lb.id ASC;
  `;

  const { rows } = await pool.query(sql);

  return rows.map((row) => ({
    id: row.id,
    location_barcode_id: row.id,
    barcode: row.barcode,
    barcode_type: row.barcode_type || 'CODE128',
    label: buildLocation(row),
    local: row.local || '',
    corredor: row.corredor || '',
    prateleira: row.prateleira || '',
    bandeja: row.bandeja || '',
    position: row.position || '',
  }));
}

async function updateProductLocation(productCode, locationBarcodeId) {
  const code = normalizeText(productCode);

  if (!code) {
    throw new Error('product_code obrigatório.');
  }

  if (!locationBarcodeId) {
    throw new Error('location_barcode_id obrigatório.');
  }

  const locResult = await pool.query(
    `
    SELECT
      lb.id AS location_barcode_id,
      lb.barcode,

      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      lbin.name AS bandeja,
      lp.name AS position

    FROM public."locationsBarCode" lb

    LEFT JOIN public."locationLocals" ll
      ON ll.id = lb.local_id

    LEFT JOIN public."locationCorridors" lc
      ON lc.id = lb.corridor_id

    LEFT JOIN public."locationShelves" ls
      ON ls.id = lb.shelf_id

    LEFT JOIN public."locationBins" lbin
      ON lbin.id = lb.bin_id

    LEFT JOIN public."locationPositions" lp
      ON lp.id = lb.position_id

    WHERE lb.id = $1
      AND COALESCE(lb.active, true) = true

    LIMIT 1;
    `,
    [locationBarcodeId]
  );

  const location = locResult.rows[0];

  if (!location) {
    throw new Error('Localização não encontrada.');
  }

  const currentResult = await pool.query(
    `
    SELECT id
    FROM public."productsLocations"
    WHERE product_code = $1
      AND COALESCE(is_active, true) = true
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1;
    `,
    [code]
  );

  const current = currentResult.rows[0];

  const observacao = [
    location.local,
    location.corredor,
    location.prateleira,
    location.bandeja,
    location.position,
    location.barcode,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' / ');

  if (current?.id) {
    const { rows } = await pool.query(
      `
      UPDATE public."productsLocations"
      SET
        corredor = $2,
        prateleira = $3,
        bandeja = $4,
        box = $5,
        observacao = $6,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *;
      `,
      [
        current.id,
        location.corredor,
        location.prateleira,
        location.bandeja,
        location.position,
        observacao,
      ]
    );

    return rows[0];
  }

  const { rows } = await pool.query(
    `
    INSERT INTO public."productsLocations" (
      product_code,
      corredor,
      prateleira,
      bandeja,
      box,
      observacao,
      is_active,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
    RETURNING *;
    `,
    [
      code,
      location.corredor,
      location.prateleira,
      location.bandeja,
      location.position,
      observacao,
    ]
  );

  return rows[0];
}

async function getLocationByBarcode(barcode) {
  const code = normalizeText(barcode);

  if (!code) {
    throw new Error('barcode obrigatório.');
  }

  const sql = `
    SELECT
      lb.id,
      lb.barcode,
      lb.barcode_type,
      lb.active,

      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      lbin.name AS bandeja,
      lp.name AS position

    FROM public."locationsBarCode" lb

    LEFT JOIN public."locationLocals" ll
      ON ll.id = lb.local_id

    LEFT JOIN public."locationCorridors" lc
      ON lc.id = lb.corridor_id

    LEFT JOIN public."locationShelves" ls
      ON ls.id = lb.shelf_id

    LEFT JOIN public."locationBins" lbin
      ON lbin.id = lb.bin_id

    LEFT JOIN public."locationPositions" lp
      ON lp.id = lb.position_id

    WHERE lb.barcode = $1
      AND COALESCE(lb.active, true) = true

    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [code]);
  const row = rows[0];

  if (!row) {
    throw new Error('Localização não encontrada pelo barcode.');
  }

  return {
    id: row.id,
    location_barcode_id: row.id,
    barcode: row.barcode,
    barcode_type: row.barcode_type || 'CODE128',
    label: buildLocation(row),
    local: row.local || '',
    corredor: row.corredor || '',
    prateleira: row.prateleira || '',
    bandeja: row.bandeja || '',
    position: row.position || '',
  };
}

export default {
  getByBarcodeOrSku,
  listLocationOptions,
  getLocationByBarcode,
  updateProductLocation,
};