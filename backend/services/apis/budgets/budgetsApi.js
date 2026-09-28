// ╔══════════════════════════════════════════════════════════════════════╗
// ║ budgetsApi.js — Service/API de acesso a dados de Orçamentos (ESM)   ║
// ║ CONSART ERP — PostgreSQL (pool)                                     ║
// ║ ✅ AUTO: seller_id via sellerByUser (ctx.userId)                    ║
// ║ ✅ HARDEN: resolve colunas case-sensitive / case-insensitive        ║
// ║ ✅ Itens: persiste product_code/barcode_id/grade/price/commission  ║
// ║ ✅ AUTO: resolve commission_id via public."commissions"             ║
// ║ ✅ LOTES: persiste lot_id em public."budgetsItems"                  ║
// ║ ✅ STOCK OVERRIDE: valida token HMAC assinado                       ║
// ║ ✅ NOVO: persiste desconto geral e totais do orçamento              ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../../config/db.js';
import {
  getBudgetSettings,
} from '../budgetSettings/budgetSettingsApi.js';
import {
  verifyBudgetStockOverrideToken,
} from '../../security/budgetAuthorizationToken.js';

import budgetsSchema, {
  BUDGETS_TABLE,
  BUDGETS_PRIMARY_KEY,
  BUDGETS_INSERT_COLUMNS,
  BUDGETS_UPDATE_COLUMNS,
  isBudgetColumn,
  prepareBudgetInsert,
  prepareBudgetUpdate,
} from './catalog_schema.budgets.js';

import {
  resolveProductsPricesMode,
} from '../productsPrices/productsPrices.manager.js';

import {
  resolveProductsStockMode,
} from '../productsStock/productsStock.manager.js';

// ----------------------------------------------------------------------
// Tabelas
// ----------------------------------------------------------------------
// public.budgets is controlled by catalog_schema.budgets.js.
// The other tables remain local until they receive their own catalogs.
const TB_BUDGETS = BUDGETS_TABLE;
const ALIAS_B = 'b';

const TB_BUDGET_ITEMS = 'public."budgetsItems"';
const ALIAS_BI = 'bi';

const TB_GRADES = 'public."grades"';
const ALIAS_G = 'g';

const TB_PRICES = 'public."prices"';
const ALIAS_P = 'p';

const TB_PRICE_COMISSIONS = 'public."priceCommissions"';
const ALIAS_PC = 'pc';

const TB_COMMISSIONS = 'public."commissions"';
const ALIAS_C = 'c';

const TB_SCFB = 'public."salesCommissionsFromBudgets"';

const TB_SELLERS = 'public."sellers"';
const ALIAS_S = 's';

const TB_SELLER_BY_USER = 'public."sellerByUser"';
const ALIAS_SBU = 'sbu';

const TB_PSL = 'public."productsStockLots"';
const ALIAS_PSL = 'psl';

const TB_PRODUCTS = 'public.products';
const ALIAS_PRD = 'prd';

const TB_PRODUCTS_FISCAL = 'public."productsFiscalV2"';
const ALIAS_PF = 'pf';
const TB_FISCAL_CLASSIFICATION = 'public."fiscalClassificationV2"';

const TB_BUDGETS_SHIPPING = 'public."budgetsShipping"';
const TB_PRODUCTS_BARCODE = 'public."productsBarCode"';


// ----------------------------------------------------------------------
// Helpers básicos
// ----------------------------------------------------------------------
async function normalizeExistingLotId(client, value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const lotId = Number(value);

  if (!Number.isSafeInteger(lotId) || lotId <= 0) {
    return null;
  }

  const result = await client.query(
    `
      SELECT lot_id
      FROM ${TB_PSL}
      WHERE lot_id = $1
      LIMIT 1
    `,
    [lotId],
  );

  return result.rowCount
    ? Number(result.rows[0].lot_id)
    : null;
}

const isFiniteNum = (v) => Number.isFinite(Number(v));

function boolFromAny(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return ['1', 'true', 't', 'yes', 'y', 'on'].includes(s);
}

function safeString(v, max = 2000) {
  return String(v ?? '').trim().slice(0, max);
}

function pickFrom(obj, keys = []) {
  for (const k of keys) {
    if (obj?.[k] !== undefined) return obj[k];
  }
  return undefined;
}

function coalesceName(row) {
  return row.customer_name ?? null;
}

function coalesceTaxId(row) {
  return row.customer_tax_id ?? null;
}

function normalizeMoney(v, def = 0) {
  if (v === null || v === undefined || v === '') return Number(def);
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v) : Number(def);

  let s = String(v).trim();
  if (!s) return Number(def);

  s = s.replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');

  const n = Number(s);
  return Number.isFinite(n) ? Number(n) : Number(def);
}

// ----------------------------------------------------------------------
// Information schema helpers
// ----------------------------------------------------------------------
async function getTableColumns(client, schema, table) {
  const sql = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `;
  const r = await client.query(sql, [schema, table]);
  return new Set((r.rows || []).map((x) => String(x.column_name)));
}

async function tableExists(client, schema, table) {
  const sql = `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name = $2
      LIMIT 1
    `;
  const r = await client.query(sql, [schema, table]);
  return r.rowCount > 0;
}

function pickFirstExisting(setCols, candidates = []) {
  for (const c of candidates) {
    if (setCols.has(c)) return c;
  }
  return null;
}

// ----------------------------------------------------------------------
// Normalização de header / item
// ----------------------------------------------------------------------
function normalizeHeaderIn(h) {
  const mapIn = {
    issue_date: ['issue_date', 'data', 'date', 'issueDate'],
    status: ['status'],
    operation_type_id: ['operation_type_id', 'operationTypeId'],
    customer_id: ['customer_id', 'cliente_id', 'customerId'],
    customer_name: ['customer_name', 'nome_razao_social', 'razao_social', 'name'],
    customer_tax_id: ['customer_tax_id', 'cnpj_cpf', 'cpf_cnpj', 'taxId'],
    customer_email: ['customer_email', 'email'],
    customer_phone: ['customer_phone', 'phone', 'telefone'],
    budget_shipping_id: ['budget_shipping_id', 'budgetShippingId'],
    notes: ['notes', 'observacao', 'obs'],
    freight_value: ['freight_value', 'frete', 'freightValue'],
    payment_form_id: ['payment_form_id', 'forma_pagamento_id', 'paymentFormId'],
    payment_term_id: ['payment_term_id', 'prazo_pagamento_id', 'paymentTermId'],
    seller_id: ['seller_id', 'vendedor_id', 'sellerId', 'vendedorId'],
    price_id: ['price_id', 'priceId', 'price_table_id', 'tabela_preco_id'],

    subtotal: ['subtotal'],
    items_discount_total: ['items_discount_total', 'discount_items_total', 'itens_discount_total'],
    total_discount: ['total_discount'],
    total_amount: ['total_amount', 'total', 'valor_total'],

    global_discount_type: ['global_discount_type', 'discount_type', 'globalDiscountType'],
    global_discount_value: ['global_discount_value', 'discount_value_global', 'globalDiscountValue'],
    global_discount_amount: ['global_discount_amount', 'discount_amount_global', 'globalDiscountAmount'],
  };

  const out = {
    issue_date: pickFrom(h, mapIn.issue_date) ?? new Date().toISOString().slice(0, 10),
    status: pickFrom(h, mapIn.status) ?? 'ABERTO',
    operation_type_id: (() => {
      const value = Number(pickFrom(h, mapIn.operation_type_id));
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    })(),

    customer_id: pickFrom(h, mapIn.customer_id) ?? null,
    customer_name: pickFrom(h, mapIn.customer_name) ?? null,
    customer_tax_id: pickFrom(h, mapIn.customer_tax_id) ?? null,

    customer_email: pickFrom(h, mapIn.customer_email) ?? null,
    customer_phone: pickFrom(h, mapIn.customer_phone) ?? null,
    budget_shipping_id: (() => {
      const value = Number(pickFrom(h, mapIn.budget_shipping_id));
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    })(),

    notes: pickFrom(h, mapIn.notes) ?? null,
    freight_value: normalizeMoney(pickFrom(h, mapIn.freight_value), 0),

    payment_form_id: pickFrom(h, mapIn.payment_form_id) ?? null,
    payment_term_id: pickFrom(h, mapIn.payment_term_id) ?? null,

    seller_id: pickFrom(h, mapIn.seller_id) ?? null,
    price_id: (() => {
      const value = Number(pickFrom(h, mapIn.price_id));
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    })(),

    subtotal: normalizeMoney(pickFrom(h, mapIn.subtotal), 0),
    items_discount_total: normalizeMoney(pickFrom(h, mapIn.items_discount_total), 0),
    total_discount: normalizeMoney(pickFrom(h, mapIn.total_discount), 0),
    total_amount: normalizeMoney(pickFrom(h, mapIn.total_amount), 0),

    global_discount_type: safeString(pickFrom(h, mapIn.global_discount_type) || 'value', 20) || 'value',
    global_discount_value: normalizeMoney(pickFrom(h, mapIn.global_discount_value), 0),
    global_discount_amount: normalizeMoney(pickFrom(h, mapIn.global_discount_amount), 0),
  };

  if (!['value', 'percent'].includes(out.global_discount_type)) {
    out.global_discount_type = 'value';
  }

  if (out.seller_id != null) {
    const s = String(out.seller_id).trim();
    out.seller_id = s || null;
  }

  if (!out.customer_name || !out.customer_tax_id) {
    throw new Error('Required: customer_name AND customer_tax_id');
  }

  if (!out.operation_type_id) {
    throw new Error('Required: operation_type_id');
  }

  return out;
}

function normalizeItemIn(it) {
  const mapIn = {
    product_code: ['product_code', 'productCode', 'sku', 'codigo'],
    barcode_id: ['barcode_id', 'barcodeId'],

    manufacturer_ref: [
      'manufacturer_ref',
      'manufacturerRef',
      'ref_fab',
      'refFab',
      'referencia_fabricante',
    ],

    description: ['description', 'descricao', 'desc'],
    grade_id: ['grade_id', 'gradeId'],
    product_grade_id: ['product_grade_id', 'produto_grade_id', 'productGradeId'],
    unit_code: ['unit_code', 'unitCode', 'unit', 'un', 'unidade'],
    conversion_factor: ['conversion_factor', 'conversionFactor', 'fator'],
    quantity: ['quantity', 'qtd', 'quantidade'],
    unit_price: ['unit_price', 'unitPrice', 'preco', 'valor'],
    discount_value: ['discount_value', 'discountValue', 'desconto', 'discount'],
    price_id: ['price_id', 'priceId', 'tabela_preco_id', 'price_table_id'],
    commission_id: ['commission_id', 'commissionId'],

    lot_id: ['lot_id', 'lotId', 'lote_id', 'loteId'],

    override_stock: ['override_stock', 'overrideStock'],
    override_token: ['override_token', 'overrideToken'],

    override_approved_at: ['override_approved_at', 'overrideApprovedAt'],
    override_approved_by: ['override_approved_by', 'overrideApprovedBy'],
    override_reason: ['override_reason', 'overrideReason'],
    override_qty: ['override_qty', 'overrideQty'],
    override_lot_id: ['override_lot_id', 'overrideLotId'],
  };

  const out = {
    product_code: safeString(pickFrom(it, mapIn.product_code), 80),
    barcode_id: pickFrom(it, mapIn.barcode_id) ?? null,

    manufacturer_ref:
      safeString(
        pickFrom(it, mapIn.manufacturer_ref),
        100
      ) || null,

    description: safeString(pickFrom(it, mapIn.description), 1000),

    grade_id: pickFrom(it, mapIn.grade_id) ?? null,

    product_grade_id:
      pickFrom(it, mapIn.product_grade_id) ?? null,

    unit_code: safeString(pickFrom(it, mapIn.unit_code) ?? 'UN', 50) || 'UN',
    conversion_factor: isFiniteNum(pickFrom(it, mapIn.conversion_factor))
      ? Number(pickFrom(it, mapIn.conversion_factor))
      : 1,

    quantity: isFiniteNum(pickFrom(it, mapIn.quantity))
      ? Number(pickFrom(it, mapIn.quantity))
      : 0,

    unit_price: isFiniteNum(pickFrom(it, mapIn.unit_price)) ? Number(pickFrom(it, mapIn.unit_price)) : 0,
    discount_value: isFiniteNum(pickFrom(it, mapIn.discount_value)) ? Number(pickFrom(it, mapIn.discount_value)) : 0,

    price_id: pickFrom(it, mapIn.price_id) ?? null,
    commission_id: pickFrom(it, mapIn.commission_id) ?? null,

    lot_id: pickFrom(it, mapIn.lot_id) ?? null,

    override_stock: boolFromAny(pickFrom(it, mapIn.override_stock)),
    override_token: safeString(pickFrom(it, mapIn.override_token), 4000) || null,

    override_approved_at: pickFrom(it, mapIn.override_approved_at) ?? null,
    override_approved_by: pickFrom(it, mapIn.override_approved_by) ?? null,
    override_reason: safeString(pickFrom(it, mapIn.override_reason), 2000) || null,
    override_qty: isFiniteNum(pickFrom(it, mapIn.override_qty)) ? Number(pickFrom(it, mapIn.override_qty)) : null,
    override_lot_id: pickFrom(it, mapIn.override_lot_id) ?? null,
  };

  if (!out.product_code || !out.description) {
    throw new Error('Required item fields: product_code, description');
  }

  if (out.barcode_id != null && String(out.barcode_id).trim() !== '') {
    const n = Number(out.barcode_id);
    out.barcode_id = Number.isSafeInteger(n) && n > 0 ? n : null;
  } else {
    out.barcode_id = null;
  }

  if (!(out.conversion_factor > 0)) {
    out.conversion_factor = 1;
  }

  if (out.price_id != null && String(out.price_id).trim() !== '') {
    const n = Number(out.price_id);
    out.price_id = Number.isFinite(n) ? n : null;
  } else {
    out.price_id = null;
  }

  if (out.commission_id != null && String(out.commission_id).trim() !== '') {
    const n = Number(out.commission_id);
    out.commission_id = Number.isFinite(n) ? n : null;
  } else {
    out.commission_id = null;
  }

  if (out.grade_id != null && String(out.grade_id).trim() !== '') {
    const n = Number(out.grade_id);
    out.grade_id = Number.isFinite(n) ? n : null;
  } else {
    out.grade_id = null;
  }

  if (out.product_grade_id != null && String(out.product_grade_id).trim() !== '') {
    const n = Number(out.product_grade_id);
    out.product_grade_id = Number.isFinite(n) ? n : null;
  } else {
    out.product_grade_id = null;
  }

  if (out.lot_id != null && String(out.lot_id).trim() !== '') {
    const n = Number(out.lot_id);
    out.lot_id = Number.isFinite(n) && n > 0 ? n : null;
  } else {
    out.lot_id = null;
  }

  if (out.override_qty != null && String(out.override_qty).trim?.() !== '') {
    const n = Number(out.override_qty);
    out.override_qty = Number.isFinite(n) && n >= 0 ? n : null;
  } else if (!Number.isFinite(Number(out.override_qty))) {
    out.override_qty = null;
  }

  if (out.override_lot_id != null && String(out.override_lot_id).trim() !== '') {
    const n = Number(out.override_lot_id);
    out.override_lot_id = Number.isFinite(n) && n > 0 ? n : null;
  } else {
    out.override_lot_id = null;
  }

  if (out.override_approved_by != null) {
    const s = String(out.override_approved_by).trim();
    out.override_approved_by = s || null;
  }

  return out;
}

async function validateItemBarcode(client, item) {
  if (!item?.barcode_id) return;

  const result = await client.query(
    `
      SELECT barcode_id
      FROM ${TB_PRODUCTS_BARCODE}
      WHERE barcode_id = $1
        AND product_code = $2
      LIMIT 1
    `,
    [item.barcode_id, item.product_code],
  );

  if (!result.rowCount) {
    const error = new Error(
      `O código de barras ${item.barcode_id} não pertence ao produto ${item.product_code}.`,
    );
    error.status = 400;
    error.code = 'BUDGET_ITEM_BARCODE_PRODUCT_MISMATCH';
    throw error;
  }
}

// ----------------------------------------------------------------------
// Override / Stock helpers
// ----------------------------------------------------------------------

async function resolveLotAvailableStock(client, lotId) {
  const n = Number(lotId);
  if (!Number.isFinite(n) || n <= 0) return null;

  const exists = await tableExists(client, 'public', 'productsStockLots');
  if (!exists) return null;

  const cols = await getTableColumns(client, 'public', 'productsStockLots');
  if (!cols.size) return null;

  const stockCol = pickFirstExisting(cols, [
    'qty_available',
    'qty_on_hand',
    'saldo',
    'available',
    'quantity',
    'stock_quantity',
  ]);

  if (!stockCol) return null;

  const sql = `
      SELECT COALESCE("${stockCol}", 0) AS stock
      FROM ${TB_PSL}
      WHERE lot_id = $1
      LIMIT 1
    `;
  const r = await client.query(sql, [n]);

  if (!r.rowCount) return 0;
  return Number(r.rows[0]?.stock || 0);
}

async function resolveProductAvailableStock(client, { product_id, sku }) {
  const pidRaw = safeString(product_id, 100);
  const skuRaw = safeString(sku, 100);

  const hasProducts = await tableExists(client, 'public', 'products');
  if (!hasProducts) return 0;

  const productsCols = await getTableColumns(client, 'public', 'products');
  const hasProductsStock = await tableExists(client, 'public', 'productsStock');
  const stockCols = hasProductsStock
    ? await getTableColumns(client, 'public', 'productsStock')
    : new Set();

  const productsPkCol = pickFirstExisting(productsCols, ['product_id', 'id']);
  const productsCodeCol = pickFirstExisting(productsCols, ['product_code', 'sku', 'code']);
  const productsStockFkCol = pickFirstExisting(productsCols, ['product_stock_id']);
  const stockPkCol = pickFirstExisting(stockCols, ['product_stock_id', 'id']);
  const stockValueCol = pickFirstExisting(stockCols, [
    'qty_available',
    'current_stock',
    'stock_quantity',
    'quantity',
    'saldo_atual',
    'saldo',
    'available',
    'qty_on_hand',
    'estoque_atual',
  ]);

  if (hasProductsStock && stockValueCol && productsStockFkCol && stockPkCol) {
    const where = [];
    const args = [];
    let ai = 1;

    if (pidRaw && productsPkCol) {
      where.push(`CAST(p."${productsPkCol}" AS TEXT) = $${ai}`);
      args.push(pidRaw);
      ai++;
    }

    if (skuRaw && productsCodeCol) {
      where.push(`p."${productsCodeCol}" = $${ai}`);
      args.push(skuRaw);
      ai++;
    }

    if (where.length) {
      const sql = `
          SELECT COALESCE(ps."${stockValueCol}", 0) AS stock
          FROM public."products" p
          LEFT JOIN public."productsStock" ps
            ON ps."${stockPkCol}" = p."${productsStockFkCol}"
          WHERE ${where.join(' OR ')}
          LIMIT 1
        `;
      const r = await client.query(sql, args);
      if (r.rowCount) {
        return Number(r.rows[0]?.stock || 0);
      }
    }
  }

  const directProductStockCol = pickFirstExisting(productsCols, [
    'qty_available',
    'current_stock',
    'stock_quantity',
    'quantity',
    'saldo_atual',
    'saldo',
    'available',
    'qty_on_hand',
    'estoque_atual',
  ]);

  if (directProductStockCol) {
    const where = [];
    const args = [];
    let ai = 1;

    if (pidRaw && productsPkCol) {
      where.push(`CAST("${productsPkCol}" AS TEXT) = $${ai}`);
      args.push(pidRaw);
      ai++;
    }

    if (skuRaw && productsCodeCol) {
      where.push(`"${productsCodeCol}" = $${ai}`);
      args.push(skuRaw);
      ai++;
    }

    if (where.length) {
      const sql = `
          SELECT COALESCE("${directProductStockCol}", 0) AS stock
          FROM public."products"
          WHERE ${where.join(' OR ')}
          LIMIT 1
        `;
      const r = await client.query(sql, args);
      if (r.rowCount) {
        return Number(r.rows[0]?.stock || 0);
      }
    }
  }

  return 0;
}

async function resolveAvailableStock(client, item, stockMode = null) {
  const resolvedStockMode = stockMode || await resolveBudgetStockMode();

  if (resolvedStockMode?.requireLot) {
    if (!item?.lot_id) return 0;

    const lotStock = await resolveLotAvailableStock(client, item.lot_id);
    return lotStock != null ? Number(lotStock || 0) : 0;
  }

  return await resolveProductAvailableStock(client, {
    product_id: null,
    sku: item?.product_code,
  });
}

async function validateStockOrOverride(client, item, ctx = {}) {
  const requested = Number(item?.quantity || 0);

  if (!Number.isFinite(requested) || requested <= 0) {
    const e = new Error(`Quantidade inválida para SKU ${item?.product_code || ''}`);
    e.status = 400;
    throw e;
  }

  const stockMode =
    ctx?.stockMode ||
    await resolveBudgetStockMode(ctx);

  /*
   * PRODUCT_STOCK_MODE é a fonte de verdade para lote.
   * STOCK_SIMPLE valida o saldo consolidado e remove lot_id residual.
   * STOCK_WITH_LOT exige e valida o lote selecionado.
   */
  if (stockMode?.isSimple || stockMode?.requireLot === false) {
    item.lot_id = null;
    item.override_lot_id = null;
  } else if (!item?.lot_id) {
    const e = new Error(
      `Selecione um lote para o SKU ${item?.product_code || ''}.`
    );
    e.status = 400;
    e.code = 'BUDGET_STOCK_LOT_REQUIRED';
    throw e;
  }

  const available = await resolveAvailableStock(
    client,
    item,
    stockMode
  );

  if (available >= requested) {
    return { ok: true, available, requested };
  }

  const settings = ctx?.budgetSettings || await getBudgetSettings(client);
  const mode = String(settings?.out_of_stock_mode || 'BLOCK').trim().toUpperCase();

  // ALLOW: não solicita chave e não cria/persiste token de override.
  if (mode === 'ALLOW') {
    return {
      ok: true,
      available,
      requested,
      allowed_without_token: true,
    };
  }

  // BLOCK: impede salvar, mesmo que o frontend envie override/token.
  if (mode === 'BLOCK') {
    const e = new Error(
      `Sem estoque para SKU ${item?.product_code || ''}. Disponível: ${available}. Solicitado: ${requested}. Produto bloqueado pelos parâmetros.`
    );
    e.status = 400;
    throw e;
  }

  if (!item?.override_stock) {
    const e = new Error(
      `Sem estoque para SKU ${item?.product_code || ''}. Disponível: ${available}. Solicitado: ${requested}.`
    );
    e.status = 400;
    throw e;
  }

  // PASSWORD: exige um token válido, vinculado ao usuário/item atual.
  const chk = verifyBudgetStockOverrideToken(item?.override_token, {
    userId: ctx?.userId,
    sku: item?.product_code,
    lotId: item?.lot_id ?? null,
    requestedQty: requested,
  });
  if (!chk.ok) {
    const e = new Error(`Override inválido para SKU ${item?.product_code || ''}: ${chk.error}`);
    e.status = 400;
    throw e;
  }

  const p = chk.payload || {};
  const ctxUserId = Number(ctx?.userId || 0);

  if (ctxUserId && Number(p.user_id || 0) && Number(p.user_id) !== ctxUserId) {
    const e = new Error(`Override não pertence ao usuário atual para SKU ${item?.product_code || ''}.`);
    e.status = 400;
    throw e;
  }

  if (p.sku && item?.product_code && String(p.sku).trim() !== String(item.product_code).trim()) {
    const e = new Error(`Override incompatível com o SKU ${item?.product_code || ''}.`);
    e.status = 400;
    throw e;
  }

  if (p.lot_id != null && item?.lot_id != null && Number(p.lot_id) !== Number(item.lot_id)) {
    const e = new Error(`Override incompatível com o lote do SKU ${item?.product_code || ''}.`);
    e.status = 400;
    throw e;
  }

  if (Number.isFinite(Number(p.requested_qty)) && requested > Number(p.requested_qty)) {
    const e = new Error(`Quantidade acima da autorizada no override para SKU ${item?.product_code || ''}.`);
    e.status = 400;
    throw e;
  }

  return { ok: true, available, requested, override: true, payload: p };
}

// ----------------------------------------------------------------------
// Resolve seller_id via sellerByUser
// ----------------------------------------------------------------------
async function resolveSellerIdByUserId(client, userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return null;

  try {
    const colsSql = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sellerByUser'
      `;
    const colsRes = await client.query(colsSql);
    const realCols = (colsRes.rows || []).map((r) => String(r.column_name));

    if (!realCols.length) return null;

    const colMap = new Map();
    for (const c of realCols) colMap.set(c.toLowerCase(), c);

    const pickReal = (name) => colMap.get(String(name).toLowerCase()) || null;

    const where = [];
    const args = [uid];

    const userColsCandidates = [
      'user_id', 'usuario_id', 'userid', 'userId', 'usuarioid', 'usuarioId',
    ];
    for (const c of userColsCandidates) {
      const rc = pickReal(c);
      if (rc) where.push(`"${rc}" = $1`);
    }
    if (!where.length) return null;

    const candidatesWanted = [
      'seller_id',
      'sellerId',
      'sellerid',
      'seller',
      'vendedor_id',
      'vendedorId',
      'vendedorid',
      'vendedor',
      'seller_code',
      'seller_codigo',
      'sellercode',
      'sellercodigo',
    ];

    const candidatesReal = [];
    for (const c of candidatesWanted) {
      const rc = pickReal(c);
      if (rc && !candidatesReal.includes(rc)) candidatesReal.push(rc);
    }
    if (!candidatesReal.length) return null;

    const orderParts = [];
    const updatedAt = pickReal('updated_at') ?? pickReal('updatedAt');
    const createdAt = pickReal('created_at') ?? pickReal('createdAt');
    const idCol = pickReal('id');

    if (updatedAt) orderParts.push(`"${updatedAt}" DESC NULLS LAST`);
    if (createdAt) orderParts.push(`"${createdAt}" DESC NULLS LAST`);
    if (idCol) orderParts.push(`"${idCol}" DESC NULLS LAST`);

    const orderBy = orderParts.length ? `ORDER BY ${orderParts.join(', ')}` : '';

    const sql = `
        SELECT ${candidatesReal.map((c) => `"${c}"`).join(', ')}
        FROM ${TB_SELLER_BY_USER}
        WHERE ${where.join(' OR ')}
        ${orderBy}
        LIMIT 1
      `;

    const r = await client.query(sql, args);
    const row = r.rows?.[0];
    if (!row) return null;

    let pick = null;

    for (const wanted of candidatesWanted) {
      const real = pickReal(wanted);
      if (!real) continue;

      const v = row[real];
      if (v !== null && v !== undefined && String(v).trim()) {
        pick = v;
        break;
      }
    }

    if (pick == null) {
      for (const real of candidatesReal) {
        const v = row[real];
        if (v !== null && v !== undefined && String(v).trim()) {
          pick = v;
          break;
        }
      }
    }

    const out = pick == null ? null : String(pick).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------
// Resolve commission_id automaticamente
// ----------------------------------------------------------------------
async function resolveCommissionId(client, { price_id, issue_date } = {}) {
  const priceId = Number(price_id);
  const issueDate = safeString(issue_date, 30) || new Date().toISOString().slice(0, 10);

  if (!Number.isFinite(priceId)) return null;

  const hasPriceCommissions = await tableExists(client, 'public', 'priceCommissions');
  const hasCommissions = await tableExists(client, 'public', 'commissions');

  if (!hasPriceCommissions || !hasCommissions) {
    return null;
  }

  const pcCols = await getTableColumns(client, 'public', 'priceCommissions');
  const cCols = await getTableColumns(client, 'public', 'commissions');

  const pcPriceIdCol = pickFirstExisting(pcCols, ['price_id', 'priceId']);
  const pcCommissionIdCol = pickFirstExisting(pcCols, ['commission_id', 'commissionId']);
  const pcActiveCol = pickFirstExisting(pcCols, ['is_active', 'active']);

  const cIdCol = pickFirstExisting(cCols, ['commission_id', 'id']);
  const cActiveCol = pickFirstExisting(cCols, ['is_active', 'active']);
  const cStartCol = pickFirstExisting(cCols, ['start_date', 'valid_from', 'effective_from', 'date_from']);
  const cEndCol = pickFirstExisting(cCols, ['end_date', 'valid_to', 'effective_to', 'date_to']);
  const cCreatedAtCol = pickFirstExisting(cCols, ['created_at', 'createdAt']);

  if (!pcPriceIdCol || !pcCommissionIdCol || !cIdCol) {
    return null;
  }

  const where = [`${ALIAS_PC}."${pcPriceIdCol}" = $1`];
  const args = [priceId];
  let ai = 2;

  if (pcActiveCol) {
    where.push(`COALESCE(${ALIAS_PC}."${pcActiveCol}", TRUE) = TRUE`);
  }

  if (cActiveCol) {
    where.push(`COALESCE(${ALIAS_C}."${cActiveCol}", TRUE) = TRUE`);
  }

  if (cStartCol) {
    where.push(`(${ALIAS_C}."${cStartCol}" IS NULL OR ${ALIAS_C}."${cStartCol}" <= $${ai})`);
    args.push(issueDate);
    ai++;
  }

  if (cEndCol) {
    where.push(`(${ALIAS_C}."${cEndCol}" IS NULL OR ${ALIAS_C}."${cEndCol}" >= $${ai})`);
    args.push(issueDate);
    ai++;
  }

  const orderParts = [];
  if (cStartCol) orderParts.push(`${ALIAS_C}."${cStartCol}" DESC NULLS LAST`);
  if (cCreatedAtCol) orderParts.push(`${ALIAS_C}."${cCreatedAtCol}" DESC NULLS LAST`);
  orderParts.push(`${ALIAS_C}."${cIdCol}" DESC`);

  const sql = `
      SELECT ${ALIAS_C}."${cIdCol}" AS commission_id
      FROM ${TB_PRICE_COMISSIONS} ${ALIAS_PC}
      INNER JOIN ${TB_COMMISSIONS} ${ALIAS_C}
        ON ${ALIAS_C}."${cIdCol}" = ${ALIAS_PC}."${pcCommissionIdCol}"
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderParts.join(', ')}
      LIMIT 1
    `;

  const r = await client.query(sql, args);
  if (!r.rowCount) return null;

  const cid = Number(r.rows[0]?.commission_id);
  return Number.isFinite(cid) ? cid : null;
}

// ----------------------------------------------------------------------
// Row mappers
// ----------------------------------------------------------------------
function rowToBudget(row) {
  if (!row) return null;

  return {
    budget_id: row.budget_id,
    issue_date: row.issue_date,
    status: row.status,
    operation_type_id: row.operation_type_id != null
      ? Number(row.operation_type_id)
      : null,
    operation_code: row.operation_code ?? null,
    operation_name: row.operation_name ?? null,
    nature_operation: row.nature_operation ?? null,
    operation_cfop_internal: row.operation_cfop_internal ?? null,
    operation_cfop_interstate: row.operation_cfop_interstate ?? null,

    customer_id: row.customer_id,
    customer_name: coalesceName(row),
    customer_tax_id: coalesceTaxId(row),
    customer_email: row.customer_email ?? null,
    customer_phone: row.customer_phone ?? null,
    // Compatibility aliases for the current frontend.
    email: row.customer_email ?? null,
    phone: row.customer_phone ?? null,

    notes: row.notes ?? null,
    freight_value: Number(row.freight_value || 0),
    budget_shipping_id: row.budget_shipping_id ?? null,

    payment_form_id: row.payment_form_id ?? null,
    payment_term_id: row.payment_term_id ?? null,

    seller_id: row.seller_id ?? null,
    price_id: row.price_id != null ? Number(row.price_id) : null,

    subtotal: Number(row.subtotal || 0),
    items_discount_total: Number(row.items_discount_total || 0),
    total_discount: Number(row.total_discount || 0),

    global_discount_type: row.global_discount_type || 'value',
    global_discount_value: Number(row.global_discount_value || 0),
    global_discount_amount: Number(row.global_discount_amount || 0),

    created_at: row.created_at,
    updated_at: row.updated_at,

    items_count: Number(row.items_count || 0),
    total_amount: isFiniteNum(row.total_amount) ? Number(row.total_amount) : 0,
  };
}

function rowToItem(row) {
  if (!row) return null;

  return {
    budget_item_id: row.budget_item_id,
    budget_id: row.budget_id,

    product_code: row.product_code,
    sku: row.product_code,
    barcode_id: row.barcode_id ?? null,

    manufacturer_ref:
      row.manufacturer_ref ??
      null,

    description: row.description,
    grade_id: row.grade_id ?? null,
    grade: row.grade ?? null,
    unit_code: row.unit_code,
    unit: row.unit_code,
    conversion_factor: Number(row.conversion_factor || 1),
    quantity: Number(row.quantity || 0),
    // Weight of the commercial package selected for this budget item.
    unit_weight_kg: Number(row.weight_kg || 0),
    weight_kg: Number(row.weight_kg || 0),
    gross_weight_kg: Number(row.quantity || 0) * Number(row.weight_kg || 0),
    unit_price: Number(row.unit_price || 0),
    discount_value: Number(row.discount_value || 0),

    price_id: row.price_id ?? null,
    commission_id: row.commission_id ?? null,

    products_fiscal_id: row.products_fiscal_id ?? null,
    ncm: row.ncm ?? row.ncm_code ?? null,

    lot_id: row.lot_id ?? null,
    lot_code: row.lot_code ?? null,
    lot_expiration: row.lot_expiration ?? null,

    override_stock: boolFromAny(row.override_stock),
    override_token: row.override_token ?? null,
    override_approved_at: row.override_approved_at ?? null,
    override_approved_by: row.override_approved_by ?? null,
    override_reason: row.override_reason ?? null,
    override_qty: row.override_qty != null ? Number(row.override_qty) : null,
    override_lot_id: row.override_lot_id ?? null,
  };
}

function rowToShipping(row) {
  if (!row) return null;

  return {
    budget_shipping_id: row.budget_shipping_id,
    freight_value: Number(row.freight_value || 0),
    freight_mode: Number(row.freight_mode ?? 9),

    carrier_name: row.carrier_name ?? null,
    carrier_cnpj_cpf: row.carrier_cnpj_cpf ?? null,
    carrier_ie: row.carrier_ie ?? null,

    carrier_address: row.carrier_address ?? null,
    carrier_number: row.carrier_number ?? null,
    carrier_complement: row.carrier_complement ?? null,
    carrier_district: row.carrier_district ?? null,
    carrier_city: row.carrier_city ?? null,
    carrier_state: row.carrier_state ?? null,
    carrier_zipcode: row.carrier_zipcode ?? null,

    vehicle_plate: row.vehicle_plate ?? null,
    vehicle_state: row.vehicle_state ?? null,
    vehicle_rntc: row.vehicle_rntc ?? null,

    volumes: Number(row.volumes || 0),
    volume_species: row.volume_species ?? null,
    volume_brand: row.volume_brand ?? null,
    volume_numbering: row.volume_numbering ?? null,

    gross_weight: Number(row.gross_weight || 0),
    net_weight: Number(row.net_weight || 0),

    notes: row.notes ?? null,
    is_active: boolFromAny(row.is_active),

    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ----------------------------------------------------------------------
// SQL fragments
// ----------------------------------------------------------------------
const AGG_FIELDS = `
    COUNT(i.budget_item_id) AS items_count
  `;

const BUDGET_SELECT = `
    ${budgetsSchema.selectColumns
    .map((column) => `${ALIAS_B}."${column}"`)
    .join(',\n    ')},
    (
      SELECT ot.code
      FROM public."nfeOperationTypes" ot
      WHERE ot.operation_type_id = b.operation_type_id
      LIMIT 1
    ) AS operation_code,
    (
      SELECT ot.name
      FROM public."nfeOperationTypes" ot
      WHERE ot.operation_type_id = b.operation_type_id
      LIMIT 1
    ) AS operation_name,
    (
      SELECT ot.nature_operation
      FROM public."nfeOperationTypes" ot
      WHERE ot.operation_type_id = b.operation_type_id
      LIMIT 1
    ) AS nature_operation,
    (
      SELECT ot.cfop_internal
      FROM public."nfeOperationTypes" ot
      WHERE ot.operation_type_id = b.operation_type_id
      LIMIT 1
    ) AS operation_cfop_internal,
    (
      SELECT ot.cfop_interstate
      FROM public."nfeOperationTypes" ot
      WHERE ot.operation_type_id = b.operation_type_id
      LIMIT 1
    ) AS operation_cfop_interstate,
    COALESCE((
      SELECT bs.freight_value
      FROM ${TB_BUDGETS_SHIPPING} bs
      WHERE bs.budget_shipping_id = b.budget_shipping_id
      LIMIT 1
    ), 0) AS freight_value
  `;

const BUDGET_SORT_COLUMNS = Object.freeze({
  budget_id:
    'b.budget_id',

  issue_date:
    'b.issue_date',

  customer_name:
    `LOWER(COALESCE(b.customer_name, ''))`,

  notes:
    `LOWER(
      COALESCE(
        b.notes,
        ''
      )
    )`,

  customer_tax_id:
    `COALESCE(b.customer_tax_id, '')`,

  items_count:
    'COUNT(i.budget_item_id)',

  total_amount:
    'b.total_amount',

  status:
    `LOWER(
      COALESCE(
        b.status,
        ''
      )
    )`,

  seller_id:
    'b.seller_id',
});

// ----------------------------------------------------------------------
// Ensure tables
// ----------------------------------------------------------------------
export async function ensureTables() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(DDL.budgets);
    await client.query(DDL.budget_items);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: String(err?.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Listagem & Busca
// ----------------------------------------------------------------------
export async function search({
  q = '',
  limit = 20,
  offset = 0,
  status,
  dateFrom,
  dateTo,
  orderBy = 'budget_id',
  orderDirection = 'desc',
} = {}) {

  const where = [];
  const args = [];
  let ai = 1;

  const requestedOrderBy =
    String(orderBy || 'budget_id')
      .trim();

  const sortColumn =
    BUDGET_SORT_COLUMNS[requestedOrderBy] ||
    BUDGET_SORT_COLUMNS.budget_id;

  const sortDirection =
    String(orderDirection || 'desc')
      .trim()
      .toLowerCase() === 'asc'
      ? 'ASC'
      : 'DESC';

  const orderSql = `
  ORDER BY
    ${sortColumn} ${sortDirection} NULLS LAST,
    b.budget_id DESC
`;

  if (q && String(q).trim()) {
    const raw = String(q).trim();
    const like = `%${raw.toLowerCase()}%`;

    where.push(`(
        LOWER(COALESCE(b.customer_name::text, '')) LIKE $${ai} OR
        COALESCE(b.customer_tax_id, '') LIKE $${ai + 1} OR
        LOWER(COALESCE(b.seller_id::text, '')) LIKE $${ai} OR
        CAST(b.budget_id AS TEXT) LIKE $${ai + 1}
      )`);
    args.push(like, `%${raw}%`);
    ai += 2;
  }

  if (status && String(status).trim()) {
    where.push(`b.status = $${ai}`);
    args.push(status);
    ai++;
  }

  if (dateFrom) {
    where.push(`b.issue_date >= $${ai}`);
    args.push(dateFrom);
    ai++;
  }

  if (dateTo) {
    where.push(`b.issue_date <= $${ai}`);
    args.push(dateTo);
    ai++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const base = `
      FROM ${TB_BUDGETS} b
      LEFT JOIN ${TB_BUDGET_ITEMS} i ON i.budget_id = b.budget_id
      ${whereSql}
    `;

  const sqlRows = `
    SELECT ${BUDGET_SELECT},
          ${AGG_FIELDS}
    ${base}
    GROUP BY b.budget_id
    ${orderSql}
    LIMIT $${ai} OFFSET $${ai + 1}
  `;
  args.push(Number(limit) || 20, Number(offset) || 0);

  const sqlCount = `
      SELECT COUNT(*) AS total
      FROM (
        SELECT b.budget_id
        ${base}
        GROUP BY b.budget_id
      ) x
    `;

  const client = await pool.connect();

  try {
    const [rowsRes, countRes] = await Promise.all([
      client.query(sqlRows, args),
      client.query(sqlCount, args.slice(0, ai - 1)),
    ]);

    const rows = rowsRes.rows.map(rowToBudget);
    const total = Number(countRes.rows?.[0]?.total || 0);

    return { ok: true, rows, total };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    client.release();
  }
}

export async function list({ limit = 20, offset = 0 } = {}) {
  return search({ q: '', limit, offset });
}

// ----------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------
export async function getById(budgetId) {
  const client = await pool.connect();

  try {
    const bid = Number(budgetId);
    if (!Number.isFinite(bid) || bid <= 0) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    const headSql = `
        SELECT ${BUDGET_SELECT}, ${AGG_FIELDS}
        FROM ${TB_BUDGETS} b
        LEFT JOIN ${TB_BUDGET_ITEMS} i ON i.budget_id = b.budget_id
        WHERE b.${BUDGETS_PRIMARY_KEY} = $1
        GROUP BY b.budget_id
      `;
    const head = await client.query(headSql, [bid]);

    if (!head.rowCount) {
      return { ok: false, error: 'NOT_FOUND' };
    }

    console.log('[budgetsApi.getById] loaded budget header discount', {
      budgetId: bid,
      global_discount_type: head.rows?.[0]?.global_discount_type,
      global_discount_value: head.rows?.[0]?.global_discount_value,
      global_discount_amount: head.rows?.[0]?.global_discount_amount,
      subtotal: head.rows?.[0]?.subtotal,
      total_discount: head.rows?.[0]?.total_discount,
      total_amount: head.rows?.[0]?.total_amount,
    });

    const hasLotsTable = await tableExists(client, 'public', 'productsStockLots');

    let hasLotCode = false;
    let hasExpirationDate = false;
    let hasValidityDate = false;
    let hasExpireDate = false;

    if (hasLotsTable) {
      const set = await getTableColumns(client, 'public', 'productsStockLots');
      hasLotCode = set.has('lot_code');
      hasExpirationDate = set.has('expiration_date');
      hasValidityDate = set.has('validity_date');
      hasExpireDate = set.has('expire_date');
    }

    const lotsJoin = hasLotsTable
      ? `LEFT JOIN ${TB_PSL} l ON l.lot_id = bi.lot_id`
      : ``;

    const lotCodeSelect = (hasLotsTable && hasLotCode)
      ? `l.lot_code AS lot_code`
      : `NULL::text AS lot_code`;

    const lotExpSelect = (() => {
      if (!hasLotsTable) return `NULL::date AS lot_expiration`;

      const parts = [];
      if (hasExpirationDate) parts.push('l.expiration_date');
      if (hasValidityDate) parts.push('l.validity_date');
      if (hasExpireDate) parts.push('l.expire_date');

      return parts.length
        ? `COALESCE(${parts.join(', ')}) AS lot_expiration`
        : `NULL::date AS lot_expiration`;
    })();

    const productsJoin = `
        LEFT JOIN ${TB_PRODUCTS} ${ALIAS_PRD}
          ON ${ALIAS_PRD}.product_code = bi.product_code
      `;

    const pfJoin = `
        LEFT JOIN LATERAL (
          SELECT pf.*
          FROM ${TB_PRODUCTS_FISCAL} pf
          WHERE pf.product_code = bi.product_code
            AND pf.is_current = TRUE
            AND pf.is_active = TRUE
          ORDER BY pf.version DESC, pf.products_fiscal_id DESC
          LIMIT 1
        ) ${ALIAS_PF} ON TRUE
        LEFT JOIN ${TB_FISCAL_CLASSIFICATION} fc
          ON fc.fiscal_classification_id = ${ALIAS_PF}.fiscal_classification_id
      `;

    // Use the barcode selected on the item. For legacy items without a
    // barcode_id, use the product's standard barcode as a safe fallback.
    const barcodeWeightJoin = `
        LEFT JOIN LATERAL (
          SELECT pbc.weight_kg
          FROM ${TB_PRODUCTS_BARCODE} pbc
          WHERE
            (
              bi.barcode_id IS NOT NULL
              AND pbc.barcode_id = bi.barcode_id
            )
            OR
            (
              bi.barcode_id IS NULL
              AND pbc.product_code = bi.product_code
              AND pbc.standard = TRUE
            )
          ORDER BY
            CASE WHEN pbc.barcode_id = bi.barcode_id THEN 0 ELSE 1 END,
            pbc.barcode_id ASC
          LIMIT 1
        ) pbw ON TRUE
      `;

    const itemSql = `
        SELECT
          bi.budget_item_id,
          bi.budget_id,
          bi.product_code,
          bi.barcode_id,
          bi.manufacturer_ref,
          bi.description,
          bi.grade_id,
          g.grade AS grade,
          bi.unit_code,
          bi.conversion_factor,
          bi.quantity,
          COALESCE(pbw.weight_kg, 0) AS weight_kg,
          bi.unit_price,
          bi.discount_value,
          bi.price_id,
          bi.commission_id,
          bi.lot_id,
          ${ALIAS_PF}.products_fiscal_id AS products_fiscal_id,
          fc.ncm_code AS ncm,
          ${lotCodeSelect},
          ${lotExpSelect},
          bi.override_stock,
          bi.override_token,
          bi.override_approved_at,
          bi.override_approved_by,
          bi.override_reason,
          bi.override_qty,
          bi.override_lot_id
        FROM ${TB_BUDGET_ITEMS} bi
        LEFT JOIN ${TB_GRADES} g
          ON g.grade_id = bi.grade_id
        ${productsJoin}
        ${barcodeWeightJoin}
        ${pfJoin}
        ${lotsJoin}
        WHERE bi.budget_id = $1
        ORDER BY bi.budget_item_id ASC
      `;

    // Prefer the FK stored in budgets. If an older shipping save created the
    // budgetsShipping row but did not fill budgets.budget_shipping_id, recover
    // it through budget_id. This keeps NF-e preview/issuance compatible with
    // affected budgets and also lets us repair the missing pointer below.
    const shippingSql = `
        SELECT *
        FROM ${TB_BUDGETS_SHIPPING}
        WHERE budget_shipping_id = $1
           OR ($1::bigint IS NULL AND budget_id = $2)
        ORDER BY
          CASE WHEN budget_shipping_id = $1 THEN 0 ELSE 1 END,
          budget_shipping_id DESC
        LIMIT 1
      `;

    const [items, shipping] = await Promise.all([
      client.query(itemSql, [bid]),
      client.query(shippingSql, [
        head.rows[0]?.budget_shipping_id ?? null,
        bid,
      ]),
    ]);

    const mappedItems = items.rows.map(rowToItem);
    const calculatedGrossWeight = Number(
      mappedItems
        .reduce(
          (total, item) => total + Number(item.gross_weight_kg || 0),
          0,
        )
        .toFixed(3),
    );

    const shippingRow = shipping.rows?.[0] || null;
    const recoveredShippingId = shippingRow?.budget_shipping_id ?? null;

    // Self-heal records produced by the old freight-save flow. The guard
    // prevents overwriting a link that another request may have set meanwhile.
    if (
      head.rows[0]?.budget_shipping_id == null &&
      recoveredShippingId != null
    ) {
      await client.query(
        `
          UPDATE ${TB_BUDGETS}
          SET
            budget_shipping_id = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE ${BUDGETS_PRIMARY_KEY} = $2
            AND budget_shipping_id IS NULL
        `,
        [recoveredShippingId, bid],
      );

      head.rows[0].budget_shipping_id = recoveredShippingId;
    }

    // Product/package weights are the authoritative source for NF-e gross
    // weight. Persist the total so every downstream NF-e query receives it,
    // even when it reads budgetsShipping directly.
    if (shippingRow && calculatedGrossWeight > 0) {
      const storedGrossWeight = Number(shippingRow.gross_weight || 0);

      shippingRow.gross_weight = calculatedGrossWeight;

      if (Math.abs(storedGrossWeight - calculatedGrossWeight) > 0.0005) {
        await client.query(
          `
            UPDATE ${TB_BUDGETS_SHIPPING}
            SET
              gross_weight = $1,
              updated_at = CURRENT_TIMESTAMP
            WHERE budget_shipping_id = $2
          `,
          [calculatedGrossWeight, shippingRow.budget_shipping_id],
        );
      }
    }

    return {
      ok: true,
      header: rowToBudget(head.rows[0]),
      items: mappedItems,
      shipping: rowToShipping(shippingRow),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    client.release();
  }
}

const SINGLE_PRICE_ID = 1;

async function resolveBudgetPriceMode(ctx = {}) {
  return resolveProductsPricesMode({
    scopeType:
      ctx.featureScopeType ??
      ctx.scopeType ??
      'GLOBAL',

    scopeId:
      ctx.featureScopeId ??
      ctx.scopeId ??
      1,
  });
}

async function resolveBudgetStockMode(ctx = {}) {
  return resolveProductsStockMode({
    scopeType:
      ctx.featureScopeType ??
      ctx.scopeType ??
      'GLOBAL',

    scopeId:
      ctx.featureScopeId ??
      ctx.scopeId ??
      1,
  });
}

// ----------------------------------------------------------------------
// Item preparation pipeline
// ----------------------------------------------------------------------
async function prepareItemsForPersist(
  client,
  items = [],
  issueDate,
  ctx = {}
) {
  const out = [];
  const skipStockValidation = !!ctx?.skipStockValidation;
  const budgetSettings = skipStockValidation
    ? null
    : await getBudgetSettings(client);

  /*
   * Resolve uma única vez por operação.
   * Evita consultar appFeatures para cada item do orçamento.
   */
  const [
    priceMode,
    stockMode,
  ] = await Promise.all([
    resolveBudgetPriceMode(ctx),
    resolveBudgetStockMode(ctx),
  ]);

  for (const raw of Array.isArray(items) ? items : []) {
    const it = normalizeItemIn(raw);

    await validateItemBarcode(client, it);

    /*
     * PRODUCT_STOCK_MODE
     * STOCK_SIMPLE remove lote residual.
     * STOCK_WITH_LOT exige lote nas gravações normais.
     * A cópia mantém skipStockValidation para permitir nova seleção posterior.
     */
    if (stockMode?.isSimple || stockMode?.requireLot === false) {
      it.lot_id = null;
      it.override_lot_id = null;
    } else if (!skipStockValidation && !it.lot_id) {
      const e = new Error(
        `Selecione um lote para o SKU ${it.product_code || ''}.`
      );
      e.status = 400;
      e.code = 'BUDGET_STOCK_LOT_REQUIRED';
      throw e;
    }

    /*
     * PRODUCT_PRICE_MODE
     *
     * SINGLE:
     *   força a tabela canônica price_id = 1.
     *
     * MULTIPLE:
     *   mantém a tabela selecionada no frontend.
     *
     * O unit_price nunca é recalculado aqui, preservando:
     *   - preço negociado;
     *   - preço manual autorizado;
     *   - preços históricos.
     */
    if (priceMode.isSingle) {
      it.price_id = SINGLE_PRICE_ID;
    }

    /*
     * A comissão deve ser resolvida somente depois da aplicação
     * da regra SINGLE/MULTIPLE.
     */
    if (
      (it.commission_id == null || it.commission_id === '') &&
      it.price_id
    ) {
      it.commission_id = await resolveCommissionId(client, {
        price_id: it.price_id,
        issue_date: issueDate,
      });
    }

    let overridePayload = null;

    if (!skipStockValidation) {
      const result = await validateStockOrOverride(
        client,
        it,
        {
          ...ctx,
          budgetSettings,
          stockMode,
        }
      );

      if (result?.override && result?.payload) {
        overridePayload = result.payload;
      }
    } else if (it.override_stock && it.override_token) {
      const check = verifyBudgetStockOverrideToken(
        it.override_token
      );

      if (check.ok) {
        overridePayload = check.payload || null;
      }
    }

    if (it.override_stock) {
      const approvedAt =
        it.override_approved_at ||
        new Date().toISOString();

      const approvedBy =
        it.override_approved_by ??
        (
          overridePayload?.user_id != null
            ? String(overridePayload.user_id)
            : null
        ) ??
        (
          ctx?.userId != null
            ? String(ctx.userId)
            : null
        );

      const approvedReason =
        it.override_reason ??
        overridePayload?.reason ??
        'Liberação manual de estoque';

      // ------------------------------------------------------------
      // Quantidade autorizada
      // IMPORTANTE:
      // Number(null) === 0, portanto precisamos testar null antes.
      // ------------------------------------------------------------
      let approvedQty = null;

      if (
        it.override_qty !== null &&
        it.override_qty !== undefined &&
        it.override_qty !== '' &&
        Number.isFinite(Number(it.override_qty))
      ) {
        approvedQty = Number(it.override_qty);
      } else if (
        overridePayload?.requested_qty !== null &&
        overridePayload?.requested_qty !== undefined &&
        overridePayload?.requested_qty !== '' &&
        Number.isFinite(Number(overridePayload.requested_qty))
      ) {
        approvedQty = Number(overridePayload.requested_qty);
      } else {
        approvedQty = Number(it.quantity || 0);
      }

      // ------------------------------------------------------------
      // Lote autorizado
      // NULL deve continuar sendo NULL.
      // Nunca converter null -> Number(null) -> 0.
      // ------------------------------------------------------------
      let approvedLotId = null;

      const rawApprovedLotId =
        it.override_lot_id != null && it.override_lot_id !== ''
          ? it.override_lot_id
          : overridePayload?.lot_id != null && overridePayload.lot_id !== ''
            ? overridePayload.lot_id
            : it.lot_id != null && it.lot_id !== ''
              ? it.lot_id
              : null;

      if (rawApprovedLotId !== null) {
        const parsedLotId = Number(rawApprovedLotId);

        approvedLotId =
          Number.isSafeInteger(parsedLotId) && parsedLotId > 0
            ? parsedLotId
            : null;
      }

      it.override_approved_at = approvedAt;
      it.override_approved_by = approvedBy;
      it.override_reason = approvedReason;
      it.override_qty = approvedQty;
      it.override_lot_id = approvedLotId;
    } else {
      it.override_approved_at = null;
      it.override_approved_by = null;
      it.override_reason = null;
      it.override_qty = null;
      it.override_lot_id = null;
    }

    out.push(it);
  }

  return out;
}

async function resolveBudgetItemGradeId(client, it = {}) {
  const rawProductGradeId = Number(
    it.product_grade_id ||
    it.produto_grade_id ||
    it.productGradeId ||
    0
  );

  const rawGradeId = Number(it.grade_id || 0);

  if (rawProductGradeId > 0) {
    const q = await client.query(
      `
        SELECT grade_id
        FROM public."productsGrades"
        WHERE product_grade_id = $1
        LIMIT 1
        `,
      [rawProductGradeId]
    );

    return q.rows?.[0]?.grade_id || null;
  }

  if (rawGradeId > 0) {
    const q = await client.query(
      `
        SELECT grade_id
        FROM public.grades
        WHERE grade_id = $1
        LIMIT 1
        `,
      [rawGradeId]
    );

    return q.rows?.[0]?.grade_id || null;
  }

  return null;
}

// ----------------------------------------------------------------------
// Budget catalog persistence helpers
// ----------------------------------------------------------------------
const BUDGET_HEADER_PERSIST_COLUMNS = Object.freeze(
  BUDGETS_INSERT_COLUMNS.filter((column) =>
    [
      'issue_date',
      'status',
      'operation_type_id',
      'customer_id',
      'customer_name',
      'customer_tax_id',
      'customer_email',
      'customer_phone',
      'budget_shipping_id',
      'notes',
      'payment_form_id',
      'payment_term_id',
      'seller_id',
      'price_id',
      'subtotal',
      'items_discount_total',
      'total_discount',
      'global_discount_type',
      'global_discount_value',
      'global_discount_amount',
      'total_amount',
    ].includes(column)
  )
);

function assertBudgetCatalogColumns(columns = []) {
  const invalid = columns.filter((column) => !isBudgetColumn(column));

  if (invalid.length) {
    throw new Error(
      `Coluna(s) de budgets fora do catálogo: ${invalid.join(', ')}`
    );
  }
}

assertBudgetCatalogColumns(BUDGET_HEADER_PERSIST_COLUMNS);

function buildBudgetInsertData(header = {}) {
  const prepared = prepareBudgetInsert(header);

  if (!prepared.valid) {
    const message = prepared.errors
      .map((error) => error?.message || String(error))
      .join(' | ');

    throw new Error(message || 'Payload de orçamento inválido.');
  }

  return prepared.data;
}

function buildBudgetUpdateData(header = {}) {
  const prepared = prepareBudgetUpdate(header);

  if (!prepared.valid) {
    const message = prepared.errors
      .map((error) => error?.message || String(error))
      .join(' | ');

    throw new Error(message || 'Payload de orçamento inválido.');
  }

  return prepared.data;
}

// ----------------------------------------------------------------------
// Create
// ----------------------------------------------------------------------
export async function create({ header = {}, items = [] } = {}, ctx = {}) {
  const h = normalizeHeaderIn(header);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userId = ctx?.userId ?? null;
    const autoSellerId = await resolveSellerIdByUserId(client, userId);
    if (autoSellerId) h.seller_id = autoSellerId;

    if (h.operation_type_id) {
      const operation = await client.query(
        `SELECT operation_type_id FROM public."nfeOperationTypes" WHERE operation_type_id = $1 AND active = TRUE LIMIT 1`,
        [h.operation_type_id],
      );
      if (!operation.rowCount) throw new Error('Operação fiscal inexistente ou inativa.');
    }

    const insertData = buildBudgetInsertData(h);

    const cols = BUDGET_HEADER_PERSIST_COLUMNS.filter(
      (column) =>
        BUDGETS_INSERT_COLUMNS.includes(column) &&
        Object.prototype.hasOwnProperty.call(insertData, column)
    );

    const vals = cols.map((_, i) => `$${i + 1}`);
    const args = cols.map((c) => insertData[c]);

    const sql = `
        INSERT INTO ${TB_BUDGETS} (${cols.join(',')})
        VALUES (${vals.join(',')})
        RETURNING ${BUDGETS_PRIMARY_KEY}, seller_id
      `;
    const ins = await client.query(sql, args);
    const budgetId = ins.rows[0][BUDGETS_PRIMARY_KEY];

    const issueDate = h.issue_date || new Date().toISOString().slice(0, 10);
    const preparedItems = await prepareItemsForPersist(client, items, issueDate, {
      ...ctx,
      userId,
      skipStockValidation: !!ctx?.skipStockValidation,
    });

    if (preparedItems.length) {
      const itemSql = `
    INSERT INTO ${TB_BUDGET_ITEMS}
      (
        budget_id,
        product_code,
        barcode_id,
        manufacturer_ref,
        description,
        grade_id,
        unit_code,
        conversion_factor,
        quantity,
        unit_price,
        discount_value,
        price_id,
        commission_id,
        lot_id,
        override_stock,
        override_token,
        override_approved_at,
        override_approved_by,
        override_reason,
        override_qty,
        override_lot_id
      )
  VALUES
    (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20,
      $21
    )
  `;

      for (const it of preparedItems) {
        const finalGradeId = await resolveBudgetItemGradeId(client, it);

        console.log('[budgetsApi.create][ITEM-INSERT-DEBUG]', {
          product_code: it.product_code,

          lot_id: it.lot_id,
          lot_id_type: typeof it.lot_id,

          override_stock: it.override_stock,

          override_lot_id: it.override_lot_id,
          override_lot_id_type: typeof it.override_lot_id,

          override_reason: it.override_reason,
          override_qty: it.override_qty,

          token_payload: it.override_token
            ? verifyBudgetStockOverrideToken(it.override_token)
            : null,
        });

        await client.query(itemSql, [
          budgetId,
          it.product_code,
          it.barcode_id,
          it.manufacturer_ref ?? null,
          it.description,
          finalGradeId,
          it.unit_code,
          it.conversion_factor,
          it.quantity,
          it.unit_price,
          it.discount_value,
          it.price_id,
          it.commission_id,
          it.lot_id ?? null,
          !!it.override_stock,
          it.override_token ?? null,
          it.override_approved_at ?? null,
          it.override_approved_by ?? null,
          it.override_reason ?? null,
          it.override_qty ?? null,
          it.override_lot_id ?? null,
        ]);
      }
    }

    await client.query('COMMIT');
    return { ok: true, id: budgetId, seller_id: h.seller_id ?? null };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: String(err?.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Update
// ----------------------------------------------------------------------
export async function update(budgetId, { header = {}, items } = {}, ctx = {}) {
  const client = await pool.connect();

  try {
    const bid = Number(budgetId);
    if (!Number.isFinite(bid) || bid <= 0) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    await client.query('BEGIN');

    // Preserve the current fiscal operation when older frontend payloads
    // do not send operation_type_id on Save. This prevents an existing
    // valid operation from being erased/rejected during an ordinary edit.
    const currentRes = await client.query(
      `
        SELECT
          b.operation_type_id,
          COALESCE(
            b.budget_shipping_id,
            (
              SELECT bs.budget_shipping_id
              FROM ${TB_BUDGETS_SHIPPING} bs
              WHERE bs.budget_id = b.budget_id
              ORDER BY bs.budget_shipping_id DESC
              LIMIT 1
            )
          ) AS budget_shipping_id
        FROM ${TB_BUDGETS} b
        WHERE b.${BUDGETS_PRIMARY_KEY} = $1
        LIMIT 1
      `,
      [bid],
    );

    if (!currentRes.rowCount) {
      throw new Error('NOT_FOUND');
    }

    const mergedHeader = { ...header };
    const incomingOperationTypeId =
      mergedHeader.operation_type_id ??
      mergedHeader.operationTypeId ??
      null;

    if (
      incomingOperationTypeId === null ||
      incomingOperationTypeId === undefined ||
      String(incomingOperationTypeId).trim() === ''
    ) {
      mergedHeader.operation_type_id =
        currentRes.rows[0]?.operation_type_id ?? null;
    }

    const incomingShippingId =
      mergedHeader.budget_shipping_id ??
      mergedHeader.budgetShippingId ??
      null;

    if (
      incomingShippingId === null ||
      incomingShippingId === undefined ||
      String(incomingShippingId).trim() === ''
    ) {
      mergedHeader.budget_shipping_id =
        currentRes.rows[0]?.budget_shipping_id ?? null;
    }

    const h = normalizeHeaderIn(mergedHeader);

    const userId = ctx?.userId ?? null;
    const autoSellerId = await resolveSellerIdByUserId(client, userId);
    if (autoSellerId) h.seller_id = autoSellerId;

    if (h.operation_type_id) {
      const operation = await client.query(
        `SELECT operation_type_id FROM public."nfeOperationTypes" WHERE operation_type_id = $1 AND active = TRUE LIMIT 1`,
        [h.operation_type_id],
      );
      if (!operation.rowCount) throw new Error('Operação fiscal inexistente ou inativa.');
    }

    const updateData = buildBudgetUpdateData(h);

    const setCols = BUDGET_HEADER_PERSIST_COLUMNS.filter(
      (column) =>
        BUDGETS_UPDATE_COLUMNS.includes(column) &&
        Object.prototype.hasOwnProperty.call(updateData, column)
    );

    const sets = setCols.map((c, i) => `${c} = $${i + 1}`);
    const args = setCols.map((c) => updateData[c]);
    args.push(bid);

    const upSql = `
        UPDATE ${TB_BUDGETS}
        SET ${sets.join(', ')}
        WHERE budget_id = $${args.length}
        RETURNING ${BUDGETS_PRIMARY_KEY}, seller_id
      `;
    const up = await client.query(upSql, args);

    if (!up.rowCount) {
      throw new Error('NOT_FOUND');
    }

    if (Array.isArray(items)) {
      const issueDate = h.issue_date || new Date().toISOString().slice(0, 10);
      const preparedItems = await prepareItemsForPersist(client, items, issueDate, {
        ...ctx,
        userId,
        skipStockValidation: !!ctx?.skipStockValidation,
      });

      await client.query(`DELETE FROM ${TB_BUDGET_ITEMS} WHERE budget_id = $1`, [bid]);

      if (preparedItems.length) {
        const itemSql = `
    INSERT INTO ${TB_BUDGET_ITEMS}
      (
        budget_id,
        product_code,
        barcode_id,
        manufacturer_ref,
        description,
        grade_id,
        unit_code,
        conversion_factor,
        quantity,
        unit_price,
        discount_value,
        price_id,
        commission_id,
        lot_id,
        override_stock,
        override_token,
        override_approved_at,
        override_approved_by,
        override_reason,
        override_qty,
        override_lot_id
      )
  VALUES
    (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20,
      $21
    )
      `;

        for (const it of preparedItems) {
          const finalGradeId = await resolveBudgetItemGradeId(client, it);

          console.log('[budgetsApi.create][ITEM-INSERT-DEBUG]', {
            product_code: it.product_code,

            lot_id: it.lot_id,
            lot_id_type: typeof it.lot_id,

            override_stock: it.override_stock,

            override_lot_id: it.override_lot_id,
            override_lot_id_type: typeof it.override_lot_id,

            override_reason: it.override_reason,
            override_qty: it.override_qty,

            token_payload: it.override_token
              ? verifyBudgetStockOverrideToken(it.override_token)
              : null,
          });

          await client.query(itemSql, [
            bid,
            it.product_code,
            it.barcode_id,
            it.manufacturer_ref ?? null,
            it.description,
            finalGradeId,
            it.unit_code,
            it.conversion_factor,
            it.quantity,
            it.unit_price,
            it.discount_value,
            it.price_id,
            it.commission_id,
            it.lot_id ?? null,
            !!it.override_stock,
            it.override_token ?? null,
            it.override_approved_at ?? null,
            it.override_approved_by ?? null,
            it.override_reason ?? null,
            it.override_qty ?? null,
            it.override_lot_id ?? null,
          ]);
        }
      }
    }

    await client.query('COMMIT');
    return { ok: true, id: bid, seller_id: up.rows[0].seller_id ?? null };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: String(err?.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Remove
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// Remove
// ----------------------------------------------------------------------
export async function remove(budgetId) {
  const client = await pool.connect();

  try {
    const bid = Number(budgetId);

    if (!Number.isFinite(bid) || bid <= 0) {
      return {
        ok: false,
        error: 'BAD_REQUEST'
      };
    }

    await client.query('BEGIN');


    // ================================================================
    // 1. BUSCA O ORÇAMENTO
    // ================================================================

    const budgetResult = await client.query(
      `
        SELECT
          budget_id,
          status
        FROM ${TB_BUDGETS}
        WHERE ${BUDGETS_PRIMARY_KEY} = $1
        LIMIT 1
      `,
      [bid]
    );


    if (!budgetResult.rowCount) {
      await client.query('ROLLBACK');

      return {
        ok: false,
        error: 'NOT_FOUND'
      };
    }


    const budget =
      budgetResult.rows[0];


    const budgetStatus =
      String(
        budget?.status || ''
      )
        .trim()
        .toUpperCase();


    // ================================================================
    // 2. VERIFICA PEDIDOS VINCULADOS
    // ================================================================

    const ordersTableExists =
      await tableExists(
        client,
        'public',
        'orders'
      );


    if (ordersTableExists) {

      const ordersCols =
        await getTableColumns(
          client,
          'public',
          'orders'
        );


      const hasBudgetId =
        ordersCols.has('budget_id');


      if (hasBudgetId) {

        const linkedOrders =
          await client.query(
            `
              SELECT *
              FROM public."orders"
              WHERE ${BUDGETS_PRIMARY_KEY} = $1
              ORDER BY order_id DESC
            `,
            [bid]
          );


        if (linkedOrders.rowCount > 0) {

          /*
           * ==========================================================
           * REGRA CONSART
           * ==========================================================
           *
           * CONVERTIDO:
           *
           * orçamento está atualmente transformado em pedido.
           * NÃO pode excluir.
           */
          if (
            budgetStatus === 'CONVERTIDO' ||
            budgetStatus === 'CONVERTED'
          ) {

            const linkedOrder =
              linkedOrders.rows[0];

            const orderId =
              linkedOrder?.order_id ??
              linkedOrder?.id ??
              null;


            await client.query('ROLLBACK');


            return {
              ok: false,

              error:
                'BUDGET_HAS_ACTIVE_ORDER',

              order_id:
                orderId,

              message:
                orderId
                  ? `Este orçamento está transformado no pedido #${orderId} e não pode ser excluído.`
                  : 'Este orçamento está transformado em pedido e não pode ser excluído.'
            };
          }


          /*
           * ==========================================================
           * ORÇAMENTO ABERTO NOVAMENTE
           * ==========================================================
           *
           * Se existe order.budget_id mas o orçamento voltou para
           * ABERTO, entendemos que houve:
           *
           * PEDIDO -> RETORNAR PARA ORÇAMENTO
           *
           * Portanto o vínculo antigo não deve impedir a exclusão.
           */
          if (
            budgetStatus === 'ABERTO' ||
            budgetStatus === 'OPEN'
          ) {

            console.log(
              '[budgets.remove] Orçamento retornado de pedido. Removendo vínculo antigo...',
              {
                budget_id: bid,
                linked_orders:
                  linkedOrders.rows.map(
                    (row) =>
                      row.order_id ??
                      row.id ??
                      null
                  )
              }
            );


            await client.query(
              `
                UPDATE public."orders"
                   SET budget_id = NULL
                 WHERE ${BUDGETS_PRIMARY_KEY} = $1
              `,
              [bid]
            );
          }


          /*
           * Qualquer outro status com pedido vinculado:
           *
           * por segurança, bloqueamos.
           */
          else {

            const linkedOrder =
              linkedOrders.rows[0];

            const orderId =
              linkedOrder?.order_id ??
              linkedOrder?.id ??
              null;


            await client.query('ROLLBACK');


            return {
              ok: false,

              error:
                'BUDGET_HAS_ACTIVE_ORDER',

              order_id:
                orderId,

              message:
                `O orçamento possui pedido vinculado e está com status "${budgetStatus || 'NÃO INFORMADO'}". A exclusão foi bloqueada.`
            };
          }
        }
      }
    }


    // ================================================================
    // 3. EXCLUI O ORÇAMENTO
    // ================================================================
    //
    // budgetsItems já usa:
    //
    // ON DELETE CASCADE
    //
    // portanto os itens serão removidos automaticamente.
    // ================================================================

    const result =
      await client.query(
        `
          DELETE FROM ${TB_BUDGETS}
          WHERE ${BUDGETS_PRIMARY_KEY} = $1
        `,
        [bid]
      );


    await client.query('COMMIT');


    return {
      ok: true,

      deleted:
        result.rowCount,

      budget_id:
        bid
    };


  } catch (err) {

    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }


    console.error(
      '[budgetsApi.remove]',
      err
    );


    return {
      ok: false,

      error:
        String(
          err?.message ||
          err
        )
    };


  } finally {

    client.release();

  }
}

// ----------------------------------------------------------------------
// Totals
// ----------------------------------------------------------------------
export async function getTotals(budgetId) {
  const bid = Number(budgetId);
  if (!Number.isFinite(bid) || bid <= 0) {
    return { ok: false, error: 'BAD_REQUEST' };
  }

  const sql = `
      SELECT
        b.subtotal,
        b.items_discount_total,
        b.total_discount,
        b.global_discount_type,
        b.global_discount_value,
        b.global_discount_amount,
        COALESCE(bs.freight_value, 0) AS freight_value,
        b.total_amount,
        (
          SELECT COUNT(*)
          FROM ${TB_BUDGET_ITEMS} i
          WHERE i.budget_id = b.budget_id
        ) AS items_count
      FROM ${TB_BUDGETS} b
      LEFT JOIN ${TB_BUDGETS_SHIPPING} bs
        ON bs.budget_shipping_id = b.budget_shipping_id
      WHERE b.${BUDGETS_PRIMARY_KEY} = $1
      LIMIT 1
    `;
  const r = await pool.query(sql, [bid]);
  const row = r.rows?.[0];

  if (!row) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  return {
    ok: true,
    items_count: Number(row?.items_count || 0),
    subtotal: Number(row?.subtotal || 0),
    items_discount_total: Number(row?.items_discount_total || 0),
    total_discount: Number(row?.total_discount || 0),
    global_discount_type: row?.global_discount_type || 'value',
    global_discount_value: Number(row?.global_discount_value || 0),
    global_discount_amount: Number(row?.global_discount_amount || 0),
    freight_value: Number(row?.freight_value || 0),
    total_amount: Number(row?.total_amount || 0),
  };
}

// ----------------------------------------------------------------------
// Copy
// ----------------------------------------------------------------------
export async function copyFromBudget(sourceBudgetId, ctx = {}) {
  const bid = Number(sourceBudgetId);

  if (!Number.isFinite(bid) || bid <= 0) {
    return {
      ok: false,
      error: 'BAD_REQUEST',
    };
  }

  try {
    const source = await getById(bid);

    if (!source?.ok || !source?.header) {
      return {
        ok: false,
        error: source?.error || 'NOT_FOUND',
      };
    }

    const srcHeader = source.header;
    const srcItems = Array.isArray(source.items)
      ? source.items
      : [];

    // ================================================================
    // HEADER
    // ================================================================
    const newHeader = {
      issue_date: new Date().toISOString().slice(0, 10),
      status: 'ABERTO',

      // --------------------------------------------------------------
      // Customer
      // --------------------------------------------------------------
      customer_id:
        srcHeader.customer_id ??
        null,

      customer_name:
        srcHeader.customer_name ?? null,

      customer_tax_id:
        srcHeader.customer_tax_id ?? null,

      customer_email: srcHeader.customer_email ?? srcHeader.email ?? null,
      customer_phone: srcHeader.customer_phone ?? srcHeader.phone ?? null,

      // --------------------------------------------------------------
      // Commercial / fiscal operation
      // --------------------------------------------------------------
      operation_type_id:
        srcHeader.operation_type_id ??
        null,

      payment_form_id:
        srcHeader.payment_form_id ??
        null,

      payment_term_id:
        srcHeader.payment_term_id ??
        null,

      // --------------------------------------------------------------
      // Notes. Shipping is not shared because budgets.budget_shipping_id is unique.
      // --------------------------------------------------------------
      notes:
        srcHeader.notes ??
        null,

      budget_shipping_id: null,

      // --------------------------------------------------------------
      // Totals / discounts
      // --------------------------------------------------------------
      subtotal:
        Number(srcHeader.subtotal || 0),

      items_discount_total:
        Number(srcHeader.items_discount_total || 0),

      total_discount:
        Number(srcHeader.total_discount || 0),

      global_discount_type:
        srcHeader.global_discount_type ||
        'value',

      global_discount_value:
        Number(srcHeader.global_discount_value || 0),

      global_discount_amount:
        Number(srcHeader.global_discount_amount || 0),

      total_amount:
        Number(srcHeader.total_amount || 0),

      // --------------------------------------------------------------
      // A copy should not inherit the original seller automatically
      // --------------------------------------------------------------
      seller_id: null,
    };

    // ================================================================
    // ITEMS
    // ================================================================
    const newItems = srcItems.map((it) => ({
      product_code: it.product_code ?? null,
      barcode_id: it.barcode_id ?? null,

      manufacturer_ref:
        it.manufacturer_ref ??
        null,

      description:
        it.description ??
        '',

      grade_id:
        it.grade_id ??
        null,

      unit_code: it.unit_code ?? it.unit ?? 'UN',
      conversion_factor: Number(it.conversion_factor || 1),

      quantity:
        Number(it.quantity || 0),

      unit_price:
        Number(it.unit_price || 0),

      discount_value:
        Number(it.discount_value || 0),

      price_id:
        it.price_id ??
        null,

      // Do not inherit commission from original budget
      commission_id: null,

      // Do not inherit stock allocation / lot
      lot_id: null,

      override_stock: false,
      override_token: null,
    }));

    // ================================================================
    // VALIDATION
    // ================================================================
    if (!newHeader.operation_type_id) {
      return {
        ok: false,
        error: 'SOURCE_BUDGET_WITHOUT_OPERATION_TYPE',
        message:
          `O orçamento ${bid} não possui operation_type_id definido.`,
      };
    }

    // ================================================================
    // CREATE COPY
    // ================================================================
    return await create(
      {
        header: newHeader,
        items: newItems,
      },
      {
        ...ctx,

        // Copying should not reserve/check the original stock lots.
        skipStockValidation: true,
      }
    );
  } catch (err) {
    console.error(
      `[budgetsApi.copyFromBudget] Erro ao copiar orçamento ${bid}:`,
      err
    );

    return {
      ok: false,
      error: String(err?.message || err),
    };
  }
}

// ----------------------------------------------------------------------
// Export default
// ----------------------------------------------------------------------
const budgetsApi = {
  ensureTables,
  search,
  list,
  getById,
  create,
  update,
  remove,
  getTotals,
  copyFromBudget,
};

export default budgetsApi;
