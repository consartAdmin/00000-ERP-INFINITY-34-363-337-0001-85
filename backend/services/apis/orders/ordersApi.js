// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ordersApi.js — Service/API de Pedidos (ESM) — CONSART ERP           ║
// ║ Integração com budgets / budgetItens / productsGrades / grades      ║
// ║ ✅ FIX: resolve IBGE mesmo quando orders.customer_id é NULL         ║
// ║ ✅ FIX: garante customer_id ao criar pedido a partir do orçamento   ║
// ║ ✅ NEW: leitura real de budgetsPayments para NF-e / DANFE           ║
// ║ ✅ NEW: persiste subtotal / descontos / total do orçamento          ║
// ║ ✅ FIX: não recalcula total ignorando desconto geral                ║
// ║ ✅ NEW: SQL de orders / ordersItems derivado dos catalog_schemas    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../../config/db.js';
import * as sellerByOrdersApi from '../../../repositories/sellerByOrders/sellerByOrders.index.js';
import { ORDER_STATUS } from '../../shared/constants/orderStatus.js';
import { NFE_STATUS } from '../../shared/constants/nfeStatus.js';

import { createAuditLog } from '../../../repositories/auditLogs/auditLogs.index.js';

import { queueErrorEmail } from '../../../errorEmailReporter.js';

import {
  ordersSchema,
  ORDERS_TABLE,
  ORDERS_PRIMARY_KEY,
  ORDER_COLUMNS,
  ORDER_INSERT_COLUMNS,
  ORDER_UPDATE_COLUMNS,
  ORDER_MONEY_COLUMNS,
  ORDER_REQUIRED_COLUMNS,
  ORDER_DEFAULTS,
} from './catalog_schema.orders.js';

import {
  ordersItemsSchema,
  ORDERS_ITEMS_TABLE,
  ORDERS_ITEMS_PRIMARY_KEY,
  ORDER_ITEM_COLUMNS,
  ORDER_ITEM_INSERT_COLUMNS,
  ORDER_ITEM_NUMERIC_COLUMNS,
  ORDER_ITEM_REQUIRED_COLUMNS,
  ORDER_ITEM_DEFAULTS,
} from './catalog_schema.ordersItems.js';

function reportOrdersError(...args) {
  console.error(...args);
  const caught = args.find((value) => value instanceof Error);
  const label = typeof args[0] === 'string' ? args[0] : 'Erro na API de pedidos';
  queueErrorEmail('ORDERS_API_ERROR', {
    module: 'services/apis/ordersApi.js',
    message: caught?.message || label,
    context: label,
    err: caught ? { name: caught.name, message: caught.message, code: caught.code, stack: caught.stack } : undefined,
    details: args,
  });
}

// Tabelas vindas dos catálogos
const TB_ORDERS = ORDERS_TABLE;
const TB_ORDER_ITEMS = ORDERS_ITEMS_TABLE;
const TB_BUDGETS = ordersSchema.relations.budget.table;
const TB_ORDER_SHIPPING = ordersSchema.relations.shipping.table;
const TB_ORDERS_PAYMENTS = ordersSchema.children.payments.table;
const TB_GRADES = ordersItemsSchema.relations.grade.table;
const TB_PRODUCTS = ordersItemsSchema.relations.product.table;

// Tabelas ainda sem catálogo
const TB_BUDGET_ITEMS = 'public."budgetsItems"';
const TB_INVOICES_ISSUED = 'public."invoicesIssued"';
const TB_PRODUCTS_GRADES = 'public."productsGrades"';

// 🔹 Tabelas fiscal V2
const TB_PRODUCTS_FISCAL = 'public."productsFiscalV2"';
const TB_FISCAL_CLASSIFICATION = 'public."fiscalClassificationV2"';
const TB_FISCAL_PROFILE = 'public."fiscalProfileV2"';

// 🔹 Tabelas de cliente (IBGE)
const TB_CUSTOMERS = 'public."customers"';
const TB_CUSTOMERS_IBGE = 'public."customersIbge"';

const TB_SELLER_BY_USER = 'public."sellerByUser"';

// 🔹 Tabelas de pagamento do orçamento
const TB_BUDGET_PAYMENTS = 'public."budgetsPayments"';
const TB_PAYMENT_METHODS = 'public."paymentMethods"';
const TB_BUDGET_PAYMENT_INSTALLMENTS = 'public."budgetsPaymentInstallments"';

const TB_ORDERS_PAYMENT_INSTALLMENTS = 'public."ordersPaymentInstallments"';

const TB_BUDGET_SHIPPING = 'public."budgetsShipping"';

// ----------------------------------------------------------------------
// Validação dos catálogos (falha no import se algo estiver inconsistente)
// ----------------------------------------------------------------------
const ORDER_COLUMN_SET = new Set(ORDER_COLUMNS);
const ORDER_MONEY_COLUMN_SET = new Set(ORDER_MONEY_COLUMNS);
const ORDER_ITEM_COLUMN_SET = new Set(ORDER_ITEM_COLUMNS);

function assertCatalogColumns(columns, catalog, context) {
  const invalid = columns.filter((column) => !catalog.has(column));
  if (invalid.length) {
    throw new Error(
      `[ordersApi] ${context}: coluna(s) ausente(s) no catálogo: ${invalid.join(', ')}`,
    );
  }
}

// Consistência interna: toda lista derivada precisa existir em *_COLUMNS
assertCatalogColumns([ORDERS_PRIMARY_KEY], ORDER_COLUMN_SET, 'ORDERS_PRIMARY_KEY');
assertCatalogColumns(ORDER_INSERT_COLUMNS, ORDER_COLUMN_SET, 'ORDER_INSERT_COLUMNS');
assertCatalogColumns(ORDER_UPDATE_COLUMNS, ORDER_COLUMN_SET, 'ORDER_UPDATE_COLUMNS');
assertCatalogColumns(ORDER_MONEY_COLUMNS, ORDER_COLUMN_SET, 'ORDER_MONEY_COLUMNS');
assertCatalogColumns(ORDER_REQUIRED_COLUMNS, ORDER_COLUMN_SET, 'ORDER_REQUIRED_COLUMNS');
assertCatalogColumns(Object.keys(ORDER_DEFAULTS), ORDER_COLUMN_SET, 'ORDER_DEFAULTS');

assertCatalogColumns([ORDERS_ITEMS_PRIMARY_KEY], ORDER_ITEM_COLUMN_SET, 'ORDERS_ITEMS_PRIMARY_KEY');
assertCatalogColumns(ORDER_ITEM_INSERT_COLUMNS, ORDER_ITEM_COLUMN_SET, 'ORDER_ITEM_INSERT_COLUMNS');
assertCatalogColumns(ORDER_ITEM_NUMERIC_COLUMNS, ORDER_ITEM_COLUMN_SET, 'ORDER_ITEM_NUMERIC_COLUMNS');
assertCatalogColumns(ORDER_ITEM_REQUIRED_COLUMNS, ORDER_ITEM_COLUMN_SET, 'ORDER_ITEM_REQUIRED_COLUMNS');
assertCatalogColumns(Object.keys(ORDER_ITEM_DEFAULTS), ORDER_ITEM_COLUMN_SET, 'ORDER_ITEM_DEFAULTS');

// Colunas referenciadas em SQL escrito à mão neste arquivo
assertCatalogColumns([
  'order_id', 'budget_id', 'issue_date', 'status', 'customer_id',
  'customer_name', 'customer_tax_id', 'customer_email', 'order_shipping_id',
  'subtotal', 'items_discount_total', 'global_discount_amount',
  'total_discount', 'total_amount', 'updated_at',
], ORDER_COLUMN_SET, 'SQL manual public.orders');

assertCatalogColumns([
  'order_id', 'product_code', 'grade_id', 'quantity',
], ORDER_ITEM_COLUMN_SET, 'SQL manual public.ordersItems');

if (ordersSchema.children.items.table !== ORDERS_ITEMS_TABLE) {
  throw new Error(
    `[ordersApi] ordersSchema.children.items (${ordersSchema.children.items.table}) ` +
    `diverge de ORDERS_ITEMS_TABLE (${ORDERS_ITEMS_TABLE}).`,
  );
}

// ----------------------------------------------------------------------
// SQL builders dirigidos pelo catálogo
// ----------------------------------------------------------------------
const qi = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

function selectColumns(alias, columns) {
  return columns.map((column) => `${alias}.${qi(column)}`).join(',\n  ');
}

function buildInsertSql(table, allowedColumns, record, returning = null) {
  assertCatalogColumns(Object.keys(record), new Set(allowedColumns), `INSERT ${table}`);

  // Colunas com valor undefined ficam de fora → default do banco.
  const columns = allowedColumns.filter((column) => record[column] !== undefined);
  const placeholders = columns.map((_, index) => `$${index + 1}`);

  return {
    sql: `
      INSERT INTO ${table} (${columns.map(qi).join(', ')})
      VALUES (${placeholders.join(', ')})
      ${returning ? `RETURNING ${qi(returning)}` : ''}
    `,
    values: columns.map((column) => record[column]),
  };
}

function buildUpdateSql(table, primaryKey, allowedColumns, record, id) {
  assertCatalogColumns(Object.keys(record), new Set(allowedColumns), `UPDATE ${table}`);

  const columns = Object.keys(record);
  const sets = columns.map((column, index) => `${qi(column)} = $${index + 1}`);

  return {
    sql: `
      UPDATE ${table}
      SET ${sets.join(', ')}, "updated_at" = NOW()
      WHERE ${qi(primaryKey)} = $${columns.length + 1}
      RETURNING ${qi(primaryKey)}
    `,
    values: [...columns.map((column) => record[column]), id],
  };
}

function resolveCatalogDefault(value) {
  // ORDER_DEFAULTS.issue_date é uma expressão SQL; resolvida no Node.
  if (value === 'CURRENT_DATE') return toPgDate(new Date());
  return value;
}

function applyDefaults(record, defaults) {
  const out = { ...record };
  for (const [column, value] of Object.entries(defaults)) {
    if (out[column] === undefined || out[column] === null) {
      out[column] = resolveCatalogDefault(value);
    }
  }
  return out;
}

function assertRequired(record, requiredColumns, context) {
  const missing = requiredColumns.filter(
    (column) => record[column] == null || String(record[column]).trim() === '',
  );
  if (missing.length) {
    const error = new Error(`${context}: campo(s) obrigatório(s) ausente(s): ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
}

// ----------------------------------------------------------------------
// DDL / Infra
// ----------------------------------------------------------------------
const DDL = {
  // Core commercial tables (orders / ordersItems / ordersShipping)
  // are managed by SQL migrations. This API must not recreate legacy schemas.

  orders_payments: `
    CREATE TABLE IF NOT EXISTS ${TB_ORDERS_PAYMENTS} (
      order_payment_id BIGSERIAL PRIMARY KEY,

      order_id BIGINT NOT NULL
        REFERENCES ${TB_ORDERS}(${qi(ORDERS_PRIMARY_KEY)})
        ON DELETE CASCADE,

      payment_method_id BIGINT,
      payment_method_name VARCHAR(120),

      amount NUMERIC(14,2) NOT NULL,

      installments INTEGER,
      gap_one INTEGER,
      gap_two INTEGER,
      gap_three INTEGER,
      gap_four INTEGER,

      manual_due_date DATE,

      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE ${TB_ORDERS_PAYMENTS}
      ADD COLUMN IF NOT EXISTS manual_due_date DATE;

    CREATE INDEX IF NOT EXISTS idx_orders_payments_order_id
      ON ${TB_ORDERS_PAYMENTS}(order_id);
  `,

  orders_payment_installments: `
    CREATE TABLE IF NOT EXISTS ${TB_ORDERS_PAYMENT_INSTALLMENTS} (
      order_payment_installment_id BIGSERIAL PRIMARY KEY,

      order_payment_id BIGINT NOT NULL
        REFERENCES ${TB_ORDERS_PAYMENTS}(order_payment_id)
        ON DELETE CASCADE,

      installment_number INTEGER,
      due_date DATE,
      amount NUMERIC(14,2)
    );
  `,
};

export async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL.orders_payments);
    await client.query(DDL.orders_payment_installments);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// AuditLogs
// ----------------------------------------------------------------------
async function safeCreateOrderAuditLog({
  tabela = ordersSchema.tableName,
  register_id,
  operation,
  user_id = null,
  before = null,
  after = null,
}) {
  try {
    await createAuditLog({
      tabela,
      register_id: register_id != null ? String(register_id) : null,
      operation,
      user_id: user_id != null ? String(user_id) : null,
      before,
      after,
    });
  } catch (err) {
    console.warn('[ordersApi.auditLog] WARN:', err?.message || err);
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
function isValidDateObj(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseFlexibleDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    return isValidDateObj(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isValidDateObj(d) ? d : null;
  }

  m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`);
    return isValidDateObj(d) ? d : null;
  }

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return isValidDateObj(d) ? d : null;
  }

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, yyyy, mm, dd, hh = '00', mi = '00', ss = '00'] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`);
    return isValidDateObj(d) ? d : null;
  }

  const d = new Date(raw);
  return isValidDateObj(d) ? d : null;
}

function toPgDate(value) {
  const d = parseFlexibleDate(value);
  if (!d) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

function toPgTimestamp(value) {
  const d = parseFlexibleDate(value);
  if (!d) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

const isFiniteNum = (v) => Number.isFinite(Number(v));

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
const normUf = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  const uf = s.slice(0, 2);
  return uf ? uf : null;
};

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function formatMoneyBR(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(round2(value));
}

function safeText(value, fallback = null) {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function formatDateBR(value) {
  const d = parseFlexibleDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR');
}

function coalesceName(row) {
  return row.customer_name ?? row.nome_razao_social ?? null;
}

function coalesceTaxId(row) {
  return row.customer_tax_id ?? row.cnpj_cpf ?? null;
}

// Retorna null quando o valor não é um número válido.
function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  let s = String(value).trim();
  if (!s) return null;

  s = s.replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');

  const n = Number(s);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normalizeMoney(value, def = 0) {
  return parseMoney(value) ?? Number(def);
}

function toNumberOr(value, def) {
  if (value === null || value === undefined || value === '') return def;
  const n = Number(value);
  return Number.isFinite(n) ? n : def;
}

function normDiscountType(value) {
  return String(value ?? ORDER_DEFAULTS.global_discount_type).trim().toLowerCase() === 'percent'
    ? 'percent'
    : 'value';
}

function orderMoneyFields(row) {
  return Object.fromEntries(
    ORDER_MONEY_COLUMNS.map((column) => [column, Number(row[column] || 0)]),
  );
}

function orderItemNumericFields(row) {
  return Object.fromEntries(
    ORDER_ITEM_NUMERIC_COLUMNS.map((column) => [
      column,
      toNumberOr(row[column], ORDER_ITEM_DEFAULTS[column] ?? null),
    ]),
  );
}

function rowToOrder(row) {
  if (!row) return null;

  const orderId = Number(row[ORDERS_PRIMARY_KEY]);
  const freightValue = Number(row.freight_value || 0);
  const money = orderMoneyFields(row);

  return {
    order_id: orderId,
    // Backward-compatible alias for screens that still display "number".
    number: orderId,
    budget_id: row.budget_id,
    issue_date: row.issue_date,
    status: row.status,

    customer_id: row.customer_id,
    customer_name: row.customer_name ?? null,
    customer_tax_id: row.customer_tax_id ?? null,
    customer_email: row.customer_email ?? null,
    customer_phone: row.customer_phone ?? null,
    // Legacy aliases kept only in the API payload.
    email: row.customer_email ?? null,
    phone: row.customer_phone ?? null,

    seller_id: row.seller_id ?? null,
    price_id: row.price_id ?? null,
    operation_type_id: row.operation_type_id,
    payment_form_id: row.payment_form_id ?? null,
    payment_term_id: row.payment_term_id ?? null,
    order_shipping_id: row.order_shipping_id ?? null,

    notes: row.notes,

    ...money,
    global_discount_type: row.global_discount_type || ORDER_DEFAULTS.global_discount_type,

    freight_value: freightValue,
    freight_mode: row.freight_mode != null ? Number(row.freight_mode) : null,

    // Fiscal information now comes from invoicesIssued, not orders.
    invoice_id: row.invoice_id ?? null,
    nfe_status: row.nfe_status ?? null,
    nfe_key: row.nfe_key ?? null,
    nfe_number: row.nfe_number ?? null,
    nfe_protocol: row.nfe_protocol ?? null,
    nfe_xml_url: row.nfe_xml_url ?? null,
    nfe_danfe_url: row.nfe_danfe_url ?? null,
    nfe_environment: row.nfe_environment ?? null,
    nfe_plugnotas_id: row.nfe_provider_id ?? null,
    nfe_issue_datetime: row.nfe_issue_datetime ?? null,
    nfe_issue_date: row.nfe_issue_date ?? null,

    customer_codigo_ibge: row.customer_codigo_ibge ?? null,
    customer_uf: row.customer_uf ?? null,
    customer_city: row.customer_city ?? null,

    created_at: row.created_at,
    updated_at: row.updated_at,

    items_count: Number(row.items_count || 0),
    subtotal_amount: isFiniteNum(row.subtotal_amount)
      ? Number(row.subtotal_amount)
      : money.subtotal,
    total_discount_amount: isFiniteNum(row.total_discount_amount)
      ? Number(row.total_discount_amount)
      : money.total_discount,
    freight_amount: isFiniteNum(row.freight_amount)
      ? Number(row.freight_amount)
      : freightValue,
    total_amount_agg: isFiniteNum(row.total_amount_agg)
      ? Number(row.total_amount_agg)
      : money.total_amount,
  };
}

function rowToItem(row) {
  if (!row) return null;

  const ncm = row.ncm ?? row.ncm_code ?? null;
  const cest = row.cest ?? row.cest_code ?? null;

  const profileName = row.fiscal_profile ?? row.profile_name ?? null;
  const className = row.fiscal_classification ?? row.classification_name ?? null;

  return {
    order_item_id: row[ORDERS_ITEMS_PRIMARY_KEY],
    order_id: row.order_id,

    product_code: row.product_code,
    // Legacy alias kept for frontend/NF-e compatibility.
    sku: row.product_code,
    barcode_id: row.barcode_id ?? null,
    description: row.description,
    manufacturer_ref: row.manufacturer_ref ?? null,
    grade_id: row.grade_id ?? null,
    grade: row.grade ?? null,

    unit_code: row.unit_code,
    unit: row.unit_code,

    // conversion_factor, quantity, unit_price, discount_value, override_qty
    ...orderItemNumericFields(row),

    price_id: row.price_id ?? null,
    commission_id: row.commission_id ?? null,
    lot_id: row.lot_id ?? null,

    override_stock: Boolean(row.override_stock ?? ORDER_ITEM_DEFAULTS.override_stock),
    override_token: row.override_token ?? null,
    override_approved_at: row.override_approved_at ?? null,
    override_approved_by: row.override_approved_by ?? null,
    override_reason: row.override_reason ?? null,
    override_lot_id: row.override_lot_id ?? null,

    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,

    products_fiscal_id: row.products_fiscal_id ?? null,
    fiscal_classification_id: row.fiscal_classification_id ?? null,
    fiscal_profile_id: row.fiscal_profile_id ?? null,
    fiscal_profile: profileName,
    tax_profile_name: profileName,
    fiscal_classification: className,
    profile_name: profileName,
    classification_name: className,

    ncm,
    ncm_code: ncm,
    ncm_description: row.ncm_description ?? null,
    cest,
    cest_code: cest,
    cest_description: row.cest_description ?? null,
    ex_tipi: row.ex_tipi ?? null,

    cfop: row.cfop_exit ?? null,
    cfop_entry: row.cfop_entry ?? null,
    cfop_exit: row.cfop_exit ?? null,
    origin_code: row.origin_code ?? null,
    origem_mercadoria: row.origin_code ?? null,

    icms_cst: row.icms_cst ?? null,
    cst_icms: row.icms_cst ?? null,
    icms_rate: Number(row.icms_rate ?? 0),
    aliquota_icms: Number(row.icms_rate ?? 0),

    pis_cst: row.pis_cst ?? null,
    pis_rate: Number(row.pis_rate ?? 0),
    pis_aliquota: Number(row.pis_rate ?? 0),
    cofins_cst: row.cofins_cst ?? null,
    cofins_rate: Number(row.cofins_rate ?? 0),
    cofins_aliquota: Number(row.cofins_rate ?? 0),
    benefit_code: row.benefit_code ?? null,

    is_cst: row.is_cst ?? null,
    is_classification: row.is_classification ?? null,
    is_rate: Number(row.is_rate ?? 0),
    is_specific_rate: Number(row.is_specific_rate ?? 0),
    is_unit: row.is_unit ?? 'UN',
    ibscbs_cst: row.ibscbs_cst ?? null,
    ibscbs_classification: row.ibscbs_classification ?? null,
    ibs_uf_rate: Number(row.ibs_uf_rate ?? 0),
    ibs_municipal_rate: Number(row.ibs_municipal_rate ?? 0),
    cbs_rate: Number(row.cbs_rate ?? 0),
    donation_indicator: row.donation_indicator ?? 1,
    tax_reform_details: row.tax_reform_details ?? {},
  };
}

// ----------------------------------------------------------------------
// Budget → registros de orders / ordersItems (validados pelo catálogo)
// ----------------------------------------------------------------------
function budgetToOrderRecord(budgetId, h, { customerId, sellerId }) {
  const record = applyDefaults({
    budget_id: budgetId,
    issue_date: h.issue_date ?? null,
    status: ORDER_STATUS.CONVERTED,
    customer_id: customerId ?? null,
    customer_name: coalesceName(h),
    customer_tax_id: coalesceTaxId(h),
    customer_email: h.customer_email ?? null,
    customer_phone: h.customer_phone ?? null,
    seller_id: sellerId ?? null,
    price_id: h.price_id ?? null,
    operation_type_id: h.operation_type_id ?? null,
    payment_form_id: h.payment_form_id ?? null,
    payment_term_id: h.payment_term_id ?? null,
    // order_shipping_id é definido depois por syncShippingFromBudgetToOrder.
    subtotal: h.subtotal,
    items_discount_total: h.items_discount_total,
    global_discount_type: normDiscountType(h.global_discount_type),
    global_discount_value: h.global_discount_value,
    global_discount_amount: h.global_discount_amount,
    total_discount: h.total_discount,
    total_amount: h.total_amount,
    notes: h.notes ?? null,
  }, ORDER_DEFAULTS);

  for (const column of ORDER_MONEY_COLUMNS) {
    record[column] = normalizeMoney(record[column], ORDER_DEFAULTS[column] ?? 0);
  }

  assertRequired(record, ORDER_REQUIRED_COLUMNS, `Orçamento ${budgetId}`);
  return record;
}

function budgetItemToOrderItemRecord(orderId, budgetId, it) {
  const lotId = Number(it.lot_id) > 0 ? Number(it.lot_id) : null;

  const record = applyDefaults({
    order_id: orderId,
    product_code: safeText(it.product_code ?? it.sku),
    barcode_id: it.barcode_id ?? null,
    description: safeText(it.description),
    manufacturer_ref: it.manufacturer_ref ?? null,
    grade_id: it.grade_id ?? null,
    unit_code: safeText(it.unit_code ?? it.unit, 'UN'),
    conversion_factor: Number(it.conversion_factor) || ORDER_ITEM_DEFAULTS.conversion_factor,
    quantity: it.quantity,
    unit_price: it.unit_price,
    discount_value: it.discount_value,
    price_id: it.price_id ?? null,
    commission_id: it.commission_id ?? null,
    lot_id: lotId,
    override_stock: it.override_stock != null ? Boolean(it.override_stock) : null,
    override_token: it.override_token ?? null,
    override_approved_at: it.override_approved_at ?? null,
    override_approved_by: it.override_approved_by != null ? String(it.override_approved_by) : null,
    override_reason: it.override_reason ?? null,
    override_qty: it.override_qty,
    override_lot_id: it.override_lot_id ?? null,
  }, ORDER_ITEM_DEFAULTS);

  Object.assign(record, orderItemNumericFields(record));

  assertRequired(
    record,
    ORDER_ITEM_REQUIRED_COLUMNS,
    `Item ${it.budget_item_id ?? '?'} do orçamento ${budgetId}`,
  );
  return record;
}

// Aliases legados aceitos no patch de update()
const ORDER_UPDATE_ALIASES = Object.freeze({
  customer_email: ['email'],
  customer_phone: ['phone'],
});

function patchToOrderUpdateRecord(patch = {}) {
  const record = {};

  for (const column of ORDER_UPDATE_COLUMNS) {
    let value = patch[column];

    if (value == null) {
      for (const alias of ORDER_UPDATE_ALIASES[column] || []) {
        if (patch[alias] != null) {
          value = patch[alias];
          break;
        }
      }
    }

    if (value == null) continue;

    if (column === 'global_discount_type') {
      value = normDiscountType(value);
    } else if (ORDER_MONEY_COLUMN_SET.has(column)) {
      value = parseMoney(value);
      if (value == null) continue;
    }

    record[column] = value;
  }

  return record;
}

function rowToBudgetPayment(row) {
  return {
    budget_payment_id: Number(row.budget_payment_id),
    budget_id: Number(row.budget_id),

    payment_method_id: row.payment_method_id != null ? Number(row.payment_method_id) : null,
    payment_method_name: row.payment_method_name || null,
    payment_method_type: row.payment_method_type || null,

    amount: round2(row.amount),

    installments: row.installments != null ? Number(row.installments) : null,
    gap_one: row.gap_one != null ? Number(row.gap_one) : null,
    gap_two: row.gap_two != null ? Number(row.gap_two) : null,
    gap_three: row.gap_three != null ? Number(row.gap_three) : null,
    gap_four: row.gap_four != null ? Number(row.gap_four) : null,

    manual_due_date: row.manual_due_date ?? null,

    notes: row.notes ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function rowToBudgetPaymentInstallment(row) {
  return {
    budget_payment_installment_id: Number(row.budget_payment_installment_id),
    budget_payment_id: Number(row.budget_payment_id),
    installment_number: row.installment_number != null ? Number(row.installment_number) : null,
    due_date: row.due_date ?? null,
    amount: round2(row.amount),
  };
}

function buildPaymentLines(payments = []) {
  return payments.map((payment) => {
    const method = safeText(payment.payment_method_name, 'FORMA NÃO INFORMADA');
    return `${method}: ${formatMoneyBR(payment.amount)}`;
  });
}

function buildDuplicatasLines(payments = [], installments = []) {
  if (Array.isArray(installments) && installments.length) {
    return installments.map((item) => ({
      numero: String(item.installment_number ?? 1).padStart(3, '0'),
      vencimento: formatDateBR(item.due_date),
      valor: round2(item.amount),
    }));
  }

  return payments.map((payment, index) => ({
    numero: String(index + 1).padStart(3, '0'),
    vencimento: '—',
    valor: round2(payment.amount),
    descricao: safeText(payment.payment_method_name, 'FORMA NÃO INFORMADA'),
  }));
}

function buildPaymentObservationText(payments = [], installments = []) {
  const paymentLines = buildPaymentLines(payments);

  if (!paymentLines.length) return '';

  if (installments.length) {
    const instText = installments
      .map((item) => {
        const parcela = String(item.installment_number ?? 1).padStart(3, '0');
        return `PARCELA ${parcela}: ${formatDateBR(item.due_date)} - ${formatMoneyBR(item.amount)}`;
      })
      .join(' | ');

    return `PAGAMENTO: ${paymentLines.join(' | ')}. DUPLICATAS: ${instText}`;
  }

  return `PAGAMENTO: ${paymentLines.join(' | ')}`;
}

// Agregado padrão
const AGG_FIELDS = `
  (
    SELECT COUNT(*)
    FROM ${TB_ORDER_ITEMS} oi_count
    WHERE oi_count.order_id = o.order_id
  ) AS items_count,
  COALESCE(o.subtotal, 0) AS subtotal_amount,
  COALESCE(o.total_discount, 0) AS total_discount_amount,
  COALESCE(os.freight_value, 0) AS freight_amount,
  COALESCE(o.total_amount, 0) AS total_amount_agg
`;

// Projeção padrão do cabeçalho: todas as colunas de ORDER_COLUMNS + joins
const ORDER_SELECT = `
  ${selectColumns('o', ORDER_COLUMNS)},
  o.${qi(ORDERS_PRIMARY_KEY)} AS number,

  os.freight_mode,
  os.freight_value,

  ii.invoice_id,
  ii.nfe_status,
  ii.nfe_key,
  ii.nfe_number,
  ii.nfe_protocol,
  ii.nfe_environment,
  ii.nfe_provider_id,
  ii.xml_url AS nfe_xml_url,
  ii.danfe_url AS nfe_danfe_url,
  ii.issued_at AS nfe_issue_datetime,
  ii.issued_date AS nfe_issue_date,

  cib.codigo_ibge AS customer_codigo_ibge,
  cib.uf          AS customer_uf,
  cib.city        AS customer_city
`;

// Projeção padrão dos itens: todas as colunas de ORDER_ITEM_COLUMNS
const ORDER_ITEM_SELECT = selectColumns('oi', ORDER_ITEM_COLUMNS);

// ----------------------------------------------------------------------
// ✅ Rule: "Return Order" only if NF-e was NOT generated
// ----------------------------------------------------------------------
function hasNfeGenerated(o) {
  const key = String(o?.nfe_key || '').trim();
  const st = String(o?.nfe_status || '').trim().toUpperCase();

  const isSemNfe =
    !st ||
    st === NFE_STATUS.NONE ||
    st === 'SEM NF-E' ||
    st === 'SEM NFE';

  return (
    !!key ||
    o?.nfe_number != null ||
    !isSemNfe ||
    String(o?.nfe_plugnotas_id || '').trim() !== '' ||
    String(o?.nfe_protocol || '').trim() !== '' ||
    String(o?.nfe_xml_url || '').trim() !== '' ||
    String(o?.nfe_danfe_url || '').trim() !== ''
  );
}

// ----------------------------------------------------------------------
// 🔄 Return Order -> Cancel order + reopen budget + restore stock
// ONLY if NF-e NOT generated
// ----------------------------------------------------------------------
export async function returnToBudget(orderId) {
  await ensureTables();

  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'ID inválido' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ordRes = await client.query(
      `
      SELECT
        ${selectColumns('o', ORDER_COLUMNS)},
        ii.nfe_status,
        ii.nfe_key,
        ii.nfe_number,
        ii.nfe_protocol,
        ii.nfe_environment,
        ii.nfe_provider_id AS nfe_plugnotas_id,
        ii.xml_url AS nfe_xml_url,
        ii.danfe_url AS nfe_danfe_url
      FROM ${TB_ORDERS} o
      LEFT JOIN LATERAL (
        SELECT i.*
        FROM ${TB_INVOICES_ISSUED} i
        WHERE i.order_id = o.order_id
        ORDER BY i.issued_at DESC NULLS LAST, i.invoice_id DESC
        LIMIT 1
      ) ii ON TRUE
      WHERE o.order_id = $1
      FOR UPDATE OF o
      `,
      [id]
    );
    if (!ordRes.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'NOT_FOUND' };
    }

    const order = ordRes.rows[0];

    if (hasNfeGenerated(order)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Ação bloqueada: este pedido já possui NF-e gerada.' };
    }

    const budgetId = Number(order.budget_id || 0);
    if (!Number.isFinite(budgetId) || budgetId <= 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Este pedido não possui budget_id vinculado para retornar.' };
    }

    const st = String(order.status || '').toUpperCase();
    if (st === ORDER_STATUS.CANCELLED || st === 'CANCELLED') {
      await client.query(
        `UPDATE ${TB_BUDGETS} SET status = '${ORDER_STATUS.OPEN}', updated_at = NOW() WHERE budget_id = $1`,
        [budgetId]
      );
      await client.query('COMMIT');
      return { ok: true, order_id: id, budget_id: budgetId, message: 'Pedido já estava cancelado; orçamento reaberto.' };
    }

    const itemsRes = await client.query(
      `SELECT product_code, grade_id, quantity FROM ${TB_ORDER_ITEMS} WHERE order_id = $1`,
      [id]
    );

    for (const it of itemsRes.rows) {
      const qty = Number(it.quantity || 0);
      const gradeId = it.grade_id ?? null;
      if (qty > 0 && gradeId != null) {
        await client.query(
          `
          UPDATE ${TB_PRODUCTS_GRADES}
          SET stock = stock + $1
          WHERE product_id = $2
            AND grade_id  = $3
          `,
          [qty, String(it.product_code), gradeId]
        );
      }
    }

    await client.query(
      `UPDATE ${TB_ORDERS} SET status = '${ORDER_STATUS.RETURNED_TO_BUDGET}', updated_at = NOW() WHERE order_id = $1`,
      [id]
    );

    await client.query(
      `UPDATE ${TB_BUDGETS} SET status = '${ORDER_STATUS.OPEN}', updated_at = NOW() WHERE budget_id = $1`,
      [budgetId]
    );

    await client.query('COMMIT');

    const afterOrder = await getById(id);

    await safeCreateOrderAuditLog({
      register_id: id,
      operation: 'RETURN_TO_BUDGET',
      user_id: null,
      before: {
        order,
        items: itemsRes.rows,
      },
      after: afterOrder?.ok ? afterOrder : {
        order_id: id,
        budget_id: budgetId,
        status: ORDER_STATUS.RETURNED_TO_BUDGET,
      },
    });

    return { ok: true, order_id: id, budget_id: budgetId };
  } catch (err) {
    await client.query('ROLLBACK');
    reportOrdersError('[ordersApi.returnToBudget] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// ✅ JOIN base: resolve customer_id se o pedido estiver sem customer_id
// ----------------------------------------------------------------------
function buildBaseFromWhere(whereSql = '') {
  return `
    FROM ${TB_ORDERS} o

    LEFT JOIN ${TB_CUSTOMERS_IBGE} cib
      ON cib.customer_id = o.customer_id

    LEFT JOIN ${TB_ORDER_SHIPPING} os
      ON os.order_shipping_id = o.order_shipping_id

    LEFT JOIN LATERAL (
      SELECT i.*
      FROM ${TB_INVOICES_ISSUED} i
      WHERE i.order_id = o.order_id
      ORDER BY
        i.issued_at DESC NULLS LAST,
        i.invoice_id DESC
      LIMIT 1
    ) ii ON TRUE

    ${whereSql}
  `;
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
  nfeStatus,
  environment,
  onlyWithNfe = false,
} = {}) {
  await ensureTables();

  const where = [];
  const args = [];
  let ai = 1;

  // Hide orders already returned to their original budget.
  where.push(`COALESCE(o.status, '') <> '${ORDER_STATUS.RETURNED_TO_BUDGET}'`);

  if (q && String(q).trim()) {
    const val = `%${String(q).toLowerCase().trim()}%`;
    where.push(`(
      LOWER(COALESCE(o.customer_name, ''))     LIKE $${ai} OR
      LOWER(COALESCE(o.customer_tax_id, ''))   LIKE $${ai} OR
      LOWER(COALESCE(o.customer_email, ''))    LIKE $${ai} OR
      CAST(o.order_id AS TEXT)                 LIKE $${ai} OR
      CAST(ii.nfe_number AS TEXT)              LIKE $${ai} OR
      LOWER(COALESCE(ii.nfe_key, ''))          LIKE $${ai}
    )`);
    args.push(val);
    ai++;
  }

  if (status && String(status).trim()) {
    const norm = String(status).trim();
    if (norm.toUpperCase() !== 'TODOS') {
      where.push(`o.status = $${ai}`);
      args.push(norm);
      ai++;
    }
  }

  if (dateFrom) {
    where.push(`o.issue_date >= $${ai}`);
    args.push(dateFrom);
    ai++;
  }

  if (dateTo) {
    where.push(`o.issue_date <= $${ai}`);
    args.push(dateTo);
    ai++;
  }

  if (nfeStatus && String(nfeStatus).trim()) {
    const norm = String(nfeStatus).trim();
    if (norm.toUpperCase() !== 'TODOS') {
      where.push(`ii.nfe_status = $${ai}`);
      args.push(norm);
      ai++;
    }
  }

  if (environment && String(environment).trim()) {
    const norm = String(environment).trim();
    if (norm.toUpperCase() !== 'TODOS') {
      where.push(`ii.nfe_environment = $${ai}`);
      args.push(norm);
      ai++;
    }
  }

  if (onlyWithNfe) {
    where.push(`ii.invoice_id IS NOT NULL`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = buildBaseFromWhere(whereSql);

  const sqlRows = `
    SELECT ${ORDER_SELECT},
           ${AGG_FIELDS}
    ${base}
    ORDER BY o.issue_date DESC, o.order_id DESC
    LIMIT $${ai} OFFSET $${ai + 1}
  `;

  const countArgs = [...args];
  args.push(Number(limit) || 20, Number(offset) || 0);

  const sqlCount = `
    SELECT COUNT(*) AS total
    ${base}
  `;

  const client = await pool.connect();
  try {
    const [rowsRes, countRes] = await Promise.all([
      client.query(sqlRows, args),
      client.query(sqlCount, countArgs),
    ]);

    const rows = rowsRes.rows.map(rowToOrder);
    const total = Number(countRes.rows?.[0]?.total || 0);
    return { ok: true, rows, total };
  } catch (err) {
    reportOrdersError('[ordersApi.search] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

export async function list({
  limit = 20,
  offset = 0,
  status,
  nfeStatus,
  environment,
  onlyWithNfe = false,
  dateFrom,
  dateTo,
} = {}) {
  return search({
    q: '',
    limit,
    offset,
    status,
    nfeStatus,
    environment,
    onlyWithNfe,
    dateFrom,
    dateTo,
  });
}

// ----------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------
export async function getById(orderId) {
  await ensureTables();

  const client = await pool.connect();

  try {
    const headSql = `
      SELECT ${ORDER_SELECT}, ${AGG_FIELDS}
      ${buildBaseFromWhere(`WHERE o.${qi(ORDERS_PRIMARY_KEY)} = $1`)}
    `;

    const head = await client.query(headSql, [orderId]);

    if (!head.rowCount) {
      return { ok: false, error: 'NOT_FOUND' };
    }

    const itemSql = `
      SELECT
        ${ORDER_ITEM_SELECT},
        g.grade AS grade,

        pf.products_fiscal_id,
        pf.fiscal_classification_id,

        fc.classification_name,
        fc.ncm_code             AS ncm,
        fc.ncm_description,
        fc.ex_tipi,
        fc.cest_code            AS cest,
        fc.cest_description,

        fp.fiscal_profile_id,
        fp.profile_name,
        fp.description          AS profile_description,
        fp.icms_cst,
        fp.icms_rate,
        fp.cfop_entry,
        fp.cfop_exit,
        fp.origin_code,
        fp.pis_cst,
        fp.pis_rate,
        fp.cofins_cst,
        fp.cofins_rate,
        fp.benefit_code,

        fc.is_cst,
        fc.is_classification,
        fc.is_rate,
        fc.is_specific_rate,
        fc.is_unit,
        fc.ibscbs_cst,
        fc.ibscbs_classification,
        fc.ibs_uf_rate,
        fc.ibs_municipal_rate,
        fc.cbs_rate,
        fc.donation_indicator,
        fc.tax_reform_details

      FROM ${TB_ORDER_ITEMS} oi

      LEFT JOIN ${TB_GRADES} g
        ON g.grade_id = oi.grade_id

      LEFT JOIN ${TB_PRODUCTS} p
        ON p.product_code = oi.product_code

      LEFT JOIN ${TB_PRODUCTS_FISCAL} pf
        ON pf.product_code = oi.product_code
       AND pf.is_current = TRUE
       AND pf.is_active  = TRUE

      LEFT JOIN ${TB_FISCAL_CLASSIFICATION} fc
        ON fc.fiscal_classification_id = pf.fiscal_classification_id
       AND fc.is_active = TRUE

      LEFT JOIN ${TB_FISCAL_PROFILE} fp
        ON fp.fiscal_profile_id = fc.fiscal_profile_id
       AND fp.is_active = TRUE

      WHERE oi.order_id = $1
      ORDER BY oi.${qi(ORDERS_ITEMS_PRIMARY_KEY)} ASC
    `;

    const items = await client.query(itemSql, [orderId]);

    const paymentsRes = await client.query(
      `
      SELECT *
      FROM ${TB_ORDERS_PAYMENTS}
      WHERE order_id = $1
      ORDER BY order_payment_id
      `,
      [orderId]
    );

    const installmentsRes = await client.query(
      `
      SELECT opi.*
      FROM ${TB_ORDERS_PAYMENT_INSTALLMENTS} opi
      JOIN ${TB_ORDERS_PAYMENTS} op
        ON op.order_payment_id = opi.order_payment_id
      WHERE op.order_id = $1
      ORDER BY opi.installment_number
      `,
      [orderId]
    );

    // ------------------------------------------------------------------
    // Shipping
    // ------------------------------------------------------------------

    const shippingRes = await client.query(
      `
      SELECT os.*
      FROM ${TB_ORDERS} o
      LEFT JOIN ${TB_ORDER_SHIPPING} os
        ON os.order_shipping_id = o.order_shipping_id
      WHERE o.order_id = $1
      LIMIT 1
      `,
      [orderId]
    );

    const shipping = shippingRes.rows?.[0] || null;

    console.log('[ordersApi.getById] shipping:', shipping);

    // ------------------------------------------------------------------

    const payments = paymentsRes.rows || [];
    const installments = installmentsRes.rows || [];

    const payment_lines = buildPaymentLines(payments);
    const duplicatas = buildDuplicatasLines(payments, installments);
    const payment_observation = buildPaymentObservationText(
      payments,
      installments
    );

    const header = rowToOrder(head.rows[0]);

    return {
      ok: true,

      header: {
        ...header,
        shipping,
      },

      shipping,

      items: items.rows.map(rowToItem),

      payments,
      installments,

      payment_lines,
      duplicatas,
      payment_observation,
    };
  } catch (err) {
    reportOrdersError('[ordersApi.getById] ERR:', err);

    return {
      ok: false,
      error: String(err.message || err),
    };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Budget loader
// ----------------------------------------------------------------------
async function loadBudgetFull(budgetId) {
  const client = await pool.connect();

  try {
    const headSql = `
      SELECT *
      FROM ${TB_BUDGETS}
      WHERE budget_id = $1
    `;

    const headRes = await client.query(headSql, [budgetId]);

    if (!headRes.rowCount) {
      return null;
    }

    const itemsSql = `
      SELECT
        bi.budget_item_id,
        bi.budget_id,

        bi.product_code AS sku,
        bi.product_code,

        bi.barcode_id,
        bi.description,
        bi.manufacturer_ref,
        bi.grade_id,

        bi.unit_code AS unit,
        bi.unit_code,
        bi.conversion_factor,

        bi.quantity,
        bi.unit_price,
        bi.discount_value,

        bi.price_id,
        bi.commission_id,

        bi.lot_id,

        bi.override_stock,
        bi.override_token,
        bi.override_approved_at,
        bi.override_approved_by,
        bi.override_reason,
        bi.override_qty,
        bi.override_lot_id,

        bi.created_at,
        bi.updated_at

      FROM ${TB_BUDGET_ITEMS} bi

      WHERE bi.budget_id = $1

      ORDER BY bi.budget_item_id ASC
    `;

    const itemsRes = await client.query(itemsSql, [budgetId]);

    return {
      header: headRes.rows[0],
      items: itemsRes.rows,
    };
  } finally {
    client.release();
  }
}

async function resolveCustomerIdByDoc(client, doc) {
  const d = onlyDigits(doc);
  if (!d) return null;

  const r = await client.query(
    `
    SELECT customer_id
    FROM ${TB_CUSTOMERS}
    WHERE REGEXP_REPLACE(COALESCE(tax_id, cnpj_cpf, ''), '\\D', '', 'g') = $1
    LIMIT 1
    `,
    [d],
  );

  return r.rows?.[0]?.customer_id ?? null;
}

async function upsertCustomersIbgeFromCustomers(client, customerId) {
  if (!customerId) return;

  const exists = await client.query(
    `SELECT 1 FROM ${TB_CUSTOMERS_IBGE} WHERE customer_id = $1 LIMIT 1`,
    [customerId]
  );

  if (exists.rowCount) {
    await client.query(
      `
      UPDATE ${TB_CUSTOMERS_IBGE}
      SET source = 'orders-sync'::TEXT,
          confidence = 90::SMALLINT,
          updated_at = NOW()
      WHERE customer_id = $1
      `,
      [customerId]
    );
    return;
  }

  return;
}

// ----------------------------------------------------------------------
// NEW: payments bridge order -> budget
// ----------------------------------------------------------------------
async function listBudgetPaymentsByBudgetId(budgetId, client = pool) {
  const safeBudgetId = Number(budgetId);
  if (!Number.isFinite(safeBudgetId) || safeBudgetId <= 0) {
    return [];
  }

  const sql = `
  SELECT
    bp.budget_payment_id,
    bp.budget_id,
    bp.payment_method_id,
    bp.amount,
    bp.manual_due_date,
    bp.notes,
    bp.created_at,
    bp.updated_at,

    pm.name         AS payment_method_name,
    pm.type         AS payment_method_type,
    pm.installments AS installments,
    pm.gap_one      AS gap_one,
    pm.gap_two      AS gap_two,
    pm.gap_three    AS gap_three,
    pm.gap_four     AS gap_four

  FROM ${TB_BUDGET_PAYMENTS} bp
  LEFT JOIN ${TB_PAYMENT_METHODS} pm
    ON pm."paymentMethods_id" = bp.payment_method_id
  WHERE bp.budget_id = $1
  ORDER BY bp.budget_payment_id ASC
`;

  const { rows } = await client.query(sql, [safeBudgetId]);
  return rows.map(rowToBudgetPayment);
}

async function listBudgetPaymentInstallmentsByBudgetId(budgetId, client = pool) {
  const safeBudgetId = Number(budgetId);
  if (!Number.isFinite(safeBudgetId) || safeBudgetId <= 0) {
    return [];
  }

  const sql = `
    SELECT
      bpi.budget_payment_installment_id,
      bpi.budget_payment_id,
      bpi.installment_number,
      bpi.due_date,
      bpi.amount
    FROM ${TB_BUDGET_PAYMENT_INSTALLMENTS} bpi
    INNER JOIN ${TB_BUDGET_PAYMENTS} bp
      ON bp.budget_payment_id = bpi.budget_payment_id
    WHERE bp.budget_id = $1
    ORDER BY bp.budget_payment_id ASC, bpi.installment_number ASC
  `;

  const { rows } = await client.query(sql, [safeBudgetId]);
  return rows.map(rowToBudgetPaymentInstallment);
}

function addDaysToPgDate(baseDate, days = 0) {
  const d = parseFlexibleDate(baseDate);
  if (!d) return null;

  d.setDate(d.getDate() + Number(days || 0));

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

export async function resyncPaymentDueDatesFromNfeDate(orderId, clientArg = pool) {
  const safeOrderId = Number(orderId);
  if (!Number.isFinite(safeOrderId) || safeOrderId <= 0) {
    return { ok: false, error: 'order_id inválido' };
  }

  const { rows } = await clientArg.query(
    `
    SELECT
      o.order_id,
      o.issue_date,
      ii.issued_date AS nfe_issue_date,
      ii.issued_at   AS nfe_issue_datetime
    FROM ${TB_ORDERS} o
    LEFT JOIN LATERAL (
      SELECT i.issued_date, i.issued_at
      FROM ${TB_INVOICES_ISSUED} i
      WHERE i.order_id = o.order_id
      ORDER BY i.issued_at DESC NULLS LAST, i.invoice_id DESC
      LIMIT 1
    ) ii ON TRUE
    WHERE o.order_id = $1
    LIMIT 1
    `,
    [safeOrderId]
  );

  const order = rows?.[0];
  if (!order) return { ok: false, error: 'Pedido não encontrado' };

  const baseDate =
    order.nfe_issue_date ||
    order.nfe_issue_datetime ||
    order.issue_date;

  if (!baseDate) {
    return { ok: false, error: 'Pedido sem data base para vencimento' };
  }

  const paymentsRes = await clientArg.query(
    `
    SELECT
      order_payment_id,
      gap_one,
      gap_two,
      gap_three,
      gap_four
    FROM ${TB_ORDERS_PAYMENTS}
    WHERE order_id = $1
    ORDER BY order_payment_id ASC
    `,
    [safeOrderId]
  );

  let updated = 0;

  for (const payment of paymentsRes.rows || []) {
    const gaps = [
      payment.gap_one,
      payment.gap_two,
      payment.gap_three,
      payment.gap_four,
    ].map((v) => Number(v || 0));

    const instRes = await clientArg.query(
      `
      SELECT
        order_payment_installment_id,
        installment_number
      FROM ${TB_ORDERS_PAYMENT_INSTALLMENTS}
      WHERE order_payment_id = $1
      ORDER BY installment_number ASC
      `,
      [payment.order_payment_id]
    );

    for (const inst of instRes.rows || []) {
      const index = Math.max(Number(inst.installment_number || 1) - 1, 0);
      const gapDays = gaps[index] ?? gaps[0] ?? 0;
      const dueDate = addDaysToPgDate(baseDate, gapDays);

      if (!dueDate) continue;

      await clientArg.query(
        `
        UPDATE ${TB_ORDERS_PAYMENT_INSTALLMENTS}
        SET due_date = $1
        WHERE order_payment_installment_id = $2
        `,
        [dueDate, inst.order_payment_installment_id]
      );

      updated++;
    }
  }

  return {
    ok: true,
    order_id: safeOrderId,
    base_date: toPgDate(baseDate),
    updated,
  };
}

export async function getPaymentsByOrder(orderId) {
  await ensureTables();

  const client = await pool.connect();
  try {
    const paymentsRes = await client.query(`
      SELECT
        op.*,
        pm.name AS payment_method_name_join,
        pm.type AS payment_method_type,
        pm.installments AS payment_method_installments,
        pm.gap_one AS payment_method_gap_one,
        pm.gap_two AS payment_method_gap_two,
        pm.gap_three AS payment_method_gap_three,
        pm.gap_four AS payment_method_gap_four
      FROM ${TB_ORDERS_PAYMENTS} op
      LEFT JOIN ${TB_PAYMENT_METHODS} pm
        ON pm."paymentMethods_id" = op.payment_method_id
      WHERE op.order_id = $1
      ORDER BY op.order_payment_id
    `, [orderId]);

    const installmentsRes = await client.query(`
      SELECT opi.*
      FROM ${TB_ORDERS_PAYMENT_INSTALLMENTS} opi
      JOIN ${TB_ORDERS_PAYMENTS} op
        ON op.order_payment_id = opi.order_payment_id
      WHERE op.order_id = $1
      ORDER BY opi.installment_number
    `, [orderId]);

    const payments = (paymentsRes.rows || []).map((row) => ({
      ...row,
      payment_method_name:
        row.payment_method_name ||
        row.payment_method_name_join ||
        null,
      payment_method_type:
        row.payment_method_type || null,
      installments:
        row.installments ?? row.payment_method_installments ?? null,
      gap_one:
        row.gap_one ?? row.payment_method_gap_one ?? null,
      gap_two:
        row.gap_two ?? row.payment_method_gap_two ?? null,
      gap_three:
        row.gap_three ?? row.payment_method_gap_three ?? null,
      gap_four:
        row.gap_four ?? row.payment_method_gap_four ?? null,
    }));

    return {
      ok: true,
      order_id: Number(orderId),
      payments,
      installments: installmentsRes.rows,
    };
  } catch (err) {
    reportOrdersError('[ordersApi.getPaymentsByOrder] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

export async function getNfePaymentPayload(orderId) {
  await ensureTables();

  const base = await getPaymentsByOrder(orderId);
  if (!base?.ok) return base;

  const payments = Array.isArray(base.payments) ? base.payments : [];
  const installments = Array.isArray(base.installments) ? base.installments : [];

  const payment_lines = buildPaymentLines(payments);
  const duplicatas = buildDuplicatasLines(payments, installments);
  const payment_observation = buildPaymentObservationText(payments, installments);

  const mainPayment = payments[0] || null;

  const paymentForm = mainPayment
    ? {
      payment_method_id: mainPayment.payment_method_id ?? null,
      payment_method_name: mainPayment.payment_method_name ?? null,
      payment_method_type: mainPayment.payment_method_type ?? null,
      amount: round2(mainPayment.amount),
      installments: mainPayment.installments != null ? Number(mainPayment.installments) : null,
      gap_one: mainPayment.gap_one != null ? Number(mainPayment.gap_one) : null,
      gap_two: mainPayment.gap_two != null ? Number(mainPayment.gap_two) : null,
      gap_three: mainPayment.gap_three != null ? Number(mainPayment.gap_three) : null,
      gap_four: mainPayment.gap_four != null ? Number(mainPayment.gap_four) : null,
      manual_due_date: mainPayment.manual_due_date ?? null,
    }
    : null;

  return {
    ok: true,
    order_id: base.order_id,

    paymentForm,

    payments,
    installments,

    payment_lines,
    duplicatas,
    payment_observation,
  };
}

async function syncShippingFromBudgetToOrder({
  client,
  budgetId,
  orderId,
}) {
  const { rows } = await client.query(
    `
    SELECT bs.*
    FROM ${TB_BUDGETS} b

    INNER JOIN ${TB_BUDGET_SHIPPING} bs
      ON bs.budget_shipping_id = b.budget_shipping_id

    WHERE b.budget_id = $1
    LIMIT 1
    `,
    [budgetId],
  );

  const shipping = rows[0];

  if (!shipping) {
    console.warn('[Shipping] Nenhum frete encontrado para o orçamento:', budgetId);
    return null;
  }

  const carrierAddress = [
    shipping.carrier_address,
    shipping.carrier_number,
    shipping.carrier_complement,
    shipping.carrier_district,
    shipping.carrier_zipcode,
  ]
    .filter(Boolean)
    .join(', ');

  const values = [
    Number(shipping.freight_mode ?? 9),
    normalizeMoney(shipping.freight_value, 0),
    shipping.carrier_name ?? null,
    shipping.carrier_cnpj_cpf ?? null,
    shipping.carrier_ie ?? null,
    carrierAddress || null,
    shipping.carrier_city ?? null,
    normUf(shipping.carrier_state ?? shipping.carrier_uf),
    shipping.vehicle_rntc ?? shipping.antt_code ?? null,
    shipping.vehicle_plate ?? null,
    normUf(shipping.vehicle_state ?? shipping.vehicle_uf),
    Number(shipping.volumes ?? shipping.volume_quantity ?? 0),
    shipping.volume_species ?? null,
    shipping.volume_brand ?? null,
    shipping.volume_numbering ?? null,
    Number(shipping.gross_weight ?? 0),
    Number(shipping.net_weight ?? 0),
  ];

  const currentRes = await client.query(
    `SELECT order_shipping_id FROM ${TB_ORDERS} WHERE order_id = $1 FOR UPDATE`,
    [orderId],
  );

  const currentShippingId = currentRes.rows?.[0]?.order_shipping_id ?? null;

  let shippingRes;

  if (currentShippingId) {
    shippingRes = await client.query(
      `
      UPDATE ${TB_ORDER_SHIPPING}
      SET
        freight_mode     = $1,
        freight_value    = $2,
        carrier_name     = $3,
        carrier_cnpj_cpf = $4,
        carrier_ie       = $5,
        carrier_address  = $6,
        carrier_city     = $7,
        carrier_uf       = $8,
        antt_code        = $9,
        vehicle_plate    = $10,
        vehicle_uf       = $11,
        volume_quantity  = $12,
        volume_species   = $13,
        volume_brand     = $14,
        volume_numbering = $15,
        gross_weight     = $16,
        net_weight       = $17,
        updated_at       = NOW()
      WHERE order_shipping_id = $18
      RETURNING *
      `,
      [...values, currentShippingId],
    );
  } else {
    shippingRes = await client.query(
      `
      INSERT INTO ${TB_ORDER_SHIPPING} (
        freight_mode,
        freight_value,
        carrier_name,
        carrier_cnpj_cpf,
        carrier_ie,
        carrier_address,
        carrier_city,
        carrier_uf,
        antt_code,
        vehicle_plate,
        vehicle_uf,
        volume_quantity,
        volume_species,
        volume_brand,
        volume_numbering,
        gross_weight,
        net_weight
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17
      )
      RETURNING *
      `,
      values,
    );

    const newShippingId = shippingRes.rows[0].order_shipping_id;

    const link = buildUpdateSql(
      TB_ORDERS,
      ORDERS_PRIMARY_KEY,
      ORDER_UPDATE_COLUMNS,
      { order_shipping_id: newShippingId },
      orderId,
    );
    await client.query(link.sql, link.values);
  }

  return shippingRes.rows?.[0] ?? null;
}

// ----------------------------------------------------------------------
// Create pedido a partir de orçamento + baixa estoque + converte orçamento
// ✅ + sellerByOrders (auto vincula vendedor)
// ✅ + lot_id: preserva o lote escolhido no orçamento
// ✅ + INSERTs montados a partir de ORDER_INSERT_COLUMNS / ORDER_ITEM_INSERT_COLUMNS
// ----------------------------------------------------------------------
export async function createFromBudget(budgetId, meta = {}) {
  await ensureTables();

  const id = Number(budgetId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: 'budgetId inválido' };
  }

  const budget = await loadBudgetFull(id);
  if (!budget) return { ok: false, error: 'NOT_FOUND' };

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const h = budget.header;

    console.log('[ordersApi.createFromBudget] budget financial debug:', {
      budget_id: id,
      subtotal: h.subtotal,
      items_discount_total: h.items_discount_total,
      global_discount_type: h.global_discount_type,
      global_discount_value: h.global_discount_value,
      global_discount_amount: h.global_discount_amount,
      total_discount: h.total_discount,
      total_amount: h.total_amount,
      budget_shipping_id: h.budget_shipping_id,
    });

    let customerId = h.customer_id ?? null;

    if (!customerId) {
      customerId = await resolveCustomerIdByDoc(client, coalesceTaxId(h) ?? '');
    }

    const sellerId = safeText(meta?.seller_id ?? h.seller_id, null);

    const orderRecord = budgetToOrderRecord(id, h, { customerId, sellerId });

    const orderInsert = buildInsertSql(
      TB_ORDERS,
      ORDER_INSERT_COLUMNS,
      orderRecord,
      ORDERS_PRIMARY_KEY,
    );
    const insOrderRes = await client.query(orderInsert.sql, orderInsert.values);

    const orderId = Number(insOrderRes.rows[0][ORDERS_PRIMARY_KEY]);
    // The new schema no longer stores a duplicate order number.
    // Keep the public API compatible by using order_id as order_number.
    const orderNumber = orderId;

    if (customerId) {
      await upsertCustomersIbgeFromCustomers(client, customerId);
    }

    for (const it of budget.items) {
      const itemRecord = budgetItemToOrderItemRecord(orderId, id, it);

      console.log('[ORDER][LOT]', {
        product_code: itemRecord.product_code,
        lot_id: it.lot_id,
        quantity: itemRecord.quantity,
      });

      const itemInsert = buildInsertSql(
        TB_ORDER_ITEMS,
        ORDER_ITEM_INSERT_COLUMNS,
        itemRecord,
      );
      await client.query(itemInsert.sql, itemInsert.values);

      if (itemRecord.grade_id != null && itemRecord.quantity > 0) {
        await client.query(
          `
          UPDATE ${TB_PRODUCTS_GRADES}
          SET stock = stock - $1
          WHERE product_id = $2
            AND grade_id  = $3
          `,
          [itemRecord.quantity, itemRecord.product_code, itemRecord.grade_id],
        );
      }
    }

    await client.query(
      `
      UPDATE ${TB_BUDGETS}
      SET status = '${ORDER_STATUS.CONVERTED}',
          updated_at = NOW()
      WHERE budget_id = $1
      `,
      [id],
    );

    await syncPaymentsFromBudgetToOrder({
      client,
      budgetId: id,
      orderId,
    });

    await syncShippingFromBudgetToOrder({
      client,
      budgetId: id,
      orderId,
    });

    try {
      await sellerByOrdersApi.ensureTables();

      let relationSellerId = meta?.seller_id != null ? Number(meta.seller_id) : null;

      if (!relationSellerId && meta?.user_id != null) {
        const userId = Number(meta.user_id);

        if (Number.isFinite(userId) && userId > 0) {
          const sbu = await client.query(
            `
            SELECT seller_id
            FROM ${TB_SELLER_BY_USER}
            WHERE user_id = $1
              AND active = TRUE
            ORDER BY is_primary DESC, id ASC
            LIMIT 1
            `,
            [userId],
          );

          relationSellerId = sbu.rows?.[0]?.seller_id
            ? Number(sbu.rows[0].seller_id)
            : null;
        }
      }

      // total_amount já normalizado a partir do orçamento
      const orderTotal = orderRecord.total_amount;

      if (relationSellerId && Number.isFinite(relationSellerId) && relationSellerId > 0) {
        const existing = await client.query(
          `
          SELECT 1
          FROM public."sellerByOrders"
          WHERE order_id = $1
            AND is_primary = TRUE
          LIMIT 1
          `,
          [orderId],
        );

        if (!existing.rowCount) {
          await sellerByOrdersApi.create({
            order_id: orderId,
            seller_id: relationSellerId,
            user_id: meta?.user_id ?? null,
            role: 'PRIMARY',
            is_primary: true,
            order_total: orderTotal,
            active: true,
            locked: false,
          });
        }
      }
    } catch (e) {
      console.warn(
        '[ordersApi.createFromBudget] sellerByOrders WARN:',
        e?.message || e,
      );
    }

    await client.query('COMMIT');

    const createdOrder = await getById(orderId);

    await safeCreateOrderAuditLog({
      register_id: orderId,
      operation: 'CREATE_FROM_BUDGET',
      user_id: meta?.user_id ?? null,
      before: {
        budget_id: id,
        budget_header: h,
        budget_items: budget.items,
      },
      after: createdOrder?.ok
        ? createdOrder
        : {
          order_id: orderId,
          order_number: orderNumber,
          budget_id: id,
        },
    });

    return {
      ok: true,
      order_id: orderId,
      order_number: orderNumber,
      budget_id: id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    reportOrdersError('[ordersApi.createFromBudget] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------
// Update / Delete / Totais
// ----------------------------------------------------------------------
export async function update(orderId, patch = {}) {
  await ensureTables();

  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: 'ID inválido' };
  }

  const beforeOrder = await getById(id);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Somente colunas de ORDER_UPDATE_COLUMNS presentes no patch.
    const orderPatch = patchToOrderUpdateRecord(patch);

    if (Object.keys(orderPatch).length) {
      const { sql, values } = buildUpdateSql(
        TB_ORDERS,
        ORDERS_PRIMARY_KEY,
        ORDER_UPDATE_COLUMNS,
        orderPatch,
        id,
      );

      const r = await client.query(sql, values);
      if (!r.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'NOT_FOUND' };
      }
    } else {
      const exists = await client.query(
        `SELECT 1 FROM ${TB_ORDERS} WHERE ${qi(ORDERS_PRIMARY_KEY)} = $1`,
        [id],
      );
      if (!exists.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'NOT_FOUND' };
      }
    }

    // freight_value now belongs to ordersShipping.
    if (patch.freight_value != null && isFiniteNum(patch.freight_value)) {
      const freightValue = Number(patch.freight_value);
      const shippingRef = await client.query(
        `SELECT order_shipping_id FROM ${TB_ORDERS} WHERE order_id = $1 FOR UPDATE`,
        [id],
      );
      const shippingId = shippingRef.rows?.[0]?.order_shipping_id ?? null;

      if (shippingId) {
        await client.query(
          `
          UPDATE ${TB_ORDER_SHIPPING}
          SET freight_value = $1,
              updated_at = NOW()
          WHERE order_shipping_id = $2
          `,
          [freightValue, shippingId],
        );
      } else {
        const shippingInsert = await client.query(
          `
          INSERT INTO ${TB_ORDER_SHIPPING} (freight_mode, freight_value)
          VALUES (9, $1)
          RETURNING order_shipping_id
          `,
          [freightValue],
        );

        const link = buildUpdateSql(
          TB_ORDERS,
          ORDERS_PRIMARY_KEY,
          ORDER_UPDATE_COLUMNS,
          { order_shipping_id: shippingInsert.rows[0].order_shipping_id },
          id,
        );
        await client.query(link.sql, link.values);
      }
    }

    // Backward compatibility: old callers may still send NF-e fields through
    // ordersApi.update(). They are persisted in invoicesIssued now.
    const nfePatch = {
      nfe_status: patch.nfe_status,
      nfe_key: patch.nfe_key,
      nfe_number: patch.nfe_number,
      nfe_protocol: patch.nfe_protocol,
      nfe_environment: patch.nfe_environment,
      nfe_provider_id: patch.nfe_provider_id ?? patch.nfe_plugnotas_id,
      xml_url: patch.xml_url ?? patch.nfe_xml_url,
      danfe_url: patch.danfe_url ?? patch.nfe_danfe_url,
      issued_at: patch.issued_at ?? patch.nfe_issue_datetime,
      issued_date: patch.issued_date ?? patch.nfe_issue_date,
    };

    const nfeEntries = Object.entries(nfePatch)
      .filter(([, value]) => value !== undefined && value !== null);

    if (nfeEntries.length) {
      const latest = await client.query(
        `
        SELECT invoice_id
        FROM ${TB_INVOICES_ISSUED}
        WHERE order_id = $1
        ORDER BY issued_at DESC NULLS LAST, invoice_id DESC
        LIMIT 1
        FOR UPDATE
        `,
        [id],
      );

      if (!latest.rowCount) {
        throw new Error(
          'Não existe registro em invoicesIssued para atualizar os campos de NF-e deste pedido.',
        );
      }

      const nfeSets = [];
      const nfeArgs = [];
      let ni = 1;

      for (const [column, rawValue] of nfeEntries) {
        let value = rawValue;

        if (column === 'nfe_number') {
          if (!isFiniteNum(value)) continue;
          value = Number(value);
        } else if (column === 'issued_date') {
          value = toPgDate(value);
          if (!value) throw new Error('issued_date / nfe_issue_date inválido.');
        } else if (column === 'issued_at') {
          value = toPgTimestamp(value);
          if (!value) throw new Error('issued_at / nfe_issue_datetime inválido.');
        }

        nfeSets.push(`${column} = $${ni++}`);
        nfeArgs.push(value);
      }

      if (nfeSets.length) {
        nfeArgs.push(latest.rows[0].invoice_id);
        await client.query(
          `
          UPDATE ${TB_INVOICES_ISSUED}
          SET ${nfeSets.join(', ')},
              updated_at = NOW()
          WHERE invoice_id = $${ni}
          `,
          nfeArgs,
        );
      }
    }

    await client.query('COMMIT');

    const afterOrder = await getById(id);

    await safeCreateOrderAuditLog({
      register_id: id,
      operation: 'UPDATE',
      user_id: patch.user_id ?? patch.updated_by ?? null,
      before: beforeOrder?.ok ? beforeOrder : null,
      after: afterOrder?.ok ? afterOrder : { order_id: id },
    });

    return { ok: true, id, number: id };
  } catch (err) {
    await client.query('ROLLBACK');
    reportOrdersError('[ordersApi.update] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

export async function remove(orderId, meta = {}) {
  await ensureTables();

  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'ID inválido' };

  const beforeOrder = await getById(id);

  try {
    const r = await pool.query(
      `DELETE FROM ${TB_ORDERS} WHERE ${qi(ORDERS_PRIMARY_KEY)} = $1`,
      [id],
    );

    if (r.rowCount > 0) {
      await safeCreateOrderAuditLog({
        register_id: id,
        operation: 'DELETE',
        user_id: meta?.user_id ?? null,
        before: beforeOrder?.ok ? beforeOrder : null,
        after: null,
      });
    }

    return { ok: true, deleted: r.rowCount };
  } catch (err) {
    reportOrdersError('[ordersApi.remove] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  }
}

export async function getTotals(orderId) {
  await ensureTables();

  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: 'ID inválido' };
  }

  const sql = `
    SELECT
      (
        SELECT COUNT(*)
        FROM ${TB_ORDER_ITEMS} oi
        WHERE oi.order_id = o.order_id
      ) AS items_count,
      COALESCE(o.subtotal, 0) AS subtotal_amount,
      COALESCE(o.items_discount_total, 0) AS items_discount_total,
      COALESCE(o.global_discount_amount, 0) AS global_discount_amount,
      COALESCE(o.total_discount, 0) AS total_discount,
      COALESCE(os.freight_value, 0) AS freight_amount,
      COALESCE(o.total_amount, 0) AS total_amount
    FROM ${TB_ORDERS} o
    LEFT JOIN ${TB_ORDER_SHIPPING} os
      ON os.order_shipping_id = o.order_shipping_id
    WHERE o.${qi(ORDERS_PRIMARY_KEY)} = $1
  `;

  const r = await pool.query(sql, [id]);
  const row = r.rows?.[0];

  if (!row) return { ok: false, error: 'NOT_FOUND' };

  return {
    ok: true,
    items_count: Number(row.items_count || 0),
    subtotal_amount: Number(row.subtotal_amount || 0),
    items_discount_total: Number(row.items_discount_total || 0),
    global_discount_amount: Number(row.global_discount_amount || 0),
    total_discount: Number(row.total_discount || 0),
    freight_amount: Number(row.freight_amount || 0),
    total_amount: Number(row.total_amount || 0),
  };
}

// ----------------------------------------------------------------------
// Pedidos pendentes de NF-e → nfe_status IS NULL
// ----------------------------------------------------------------------
export async function listPendingNfe() {
  await ensureTables();

  const whereSql = `WHERE ii.invoice_id IS NULL`;
  const sql = `
    SELECT ${ORDER_SELECT}, ${AGG_FIELDS}
    ${buildBaseFromWhere(whereSql)}
    ORDER BY o.issue_date DESC, o.order_id DESC
  `;

  const client = await pool.connect();
  try {
    const res = await client.query(sql);
    const rows = res.rows.map(rowToOrder);
    const count = rows.length;
    const totalAmount = rows.reduce((acc, r) => acc + Number(r.total_amount || 0), 0);
    return { ok: true, count, totalAmount, pending: rows };
  } catch (err) {
    reportOrdersError('[ordersApi.listPendingNfe] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

async function syncPaymentsFromBudgetToOrder({
  client,
  budgetId,
  orderId,
}) {
  await client.query(
    `DELETE FROM ${TB_ORDERS_PAYMENTS} WHERE order_id = $1`,
    [orderId]
  );

  const payments = await listBudgetPaymentsByBudgetId(budgetId, client);
  const installments = await listBudgetPaymentInstallmentsByBudgetId(budgetId, client);

  for (const payment of payments) {
    const insertPayment = await client.query(`
      INSERT INTO ${TB_ORDERS_PAYMENTS} (
      order_id,
      payment_method_id,
      payment_method_name,
      amount,
      manual_due_date,
      installments,
      gap_one, gap_two, gap_three, gap_four
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING order_payment_id
    `,
      [
        orderId,
        payment.payment_method_id,
        payment.payment_method_name,
        payment.amount,
        payment.manual_due_date,
        payment.installments,
        payment.gap_one,
        payment.gap_two,
        payment.gap_three,
        payment.gap_four,
      ]
    );

    const orderPaymentId = insertPayment.rows[0].order_payment_id;

    const relatedInstallments = installments.filter(
      (i) => i.budget_payment_id === payment.budget_payment_id
    );

    for (const inst of relatedInstallments) {
      await client.query(`
        INSERT INTO ${TB_ORDERS_PAYMENT_INSTALLMENTS} (
          order_payment_id,
          installment_number,
          due_date,
          amount
        )
        VALUES ($1,$2,$3,$4)
      `, [
        orderPaymentId,
        inst.installment_number,
        inst.due_date,
        inst.amount,
      ]);
    }
  }
}

// ----------------------------------------------------------------------
// Export default
// ----------------------------------------------------------------------
const ordersApi = {
  ensureTables,
  search,
  list,
  getById,
  createFromBudget,
  returnToBudget,
  update,
  remove,
  getTotals,
  listPendingNfe,
  getPaymentsByOrder,
  getNfePaymentPayload,
  resyncPaymentDueDatesFromNfeDate,
};

export default ordersApi;
