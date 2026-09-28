// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.budgets.js — Schema de Budgets (Cabeçalho) — ESM      ║
// ║ CONSART ERP                                                       ║
// ║ Alinhado com public.budgets — 24 colunas                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

// Este catálogo não cria nem altera tabelas.
// O frete pertence a public."budgetsShipping".
// created_at usa DEFAULT; updated_at usa DEFAULT e trigger.

// ----------------------------------------------------------------------
// Tabela e chave primária
// ----------------------------------------------------------------------
export const BUDGETS_TABLE = 'public."budgets"';
export const BUDGETS_PRIMARY_KEY = 'budget_id';

// ----------------------------------------------------------------------
// Colunas na mesma ordem da tabela PostgreSQL
// ----------------------------------------------------------------------
const columns = [
  { name: 'budget_id', type: 'BIGINT', identity: 'BY DEFAULT', pk: true, notNull: true },
  { name: 'issue_date', type: 'DATE', notNull: true, default: 'CURRENT_DATE' },
  { name: 'status', type: 'VARCHAR(40)', notNull: true, default: "'ABERTO'" },
  { name: 'customer_id', type: 'BIGINT' },
  { name: 'customer_name', type: 'VARCHAR(200)', notNull: true },
  { name: 'customer_tax_id', type: 'VARCHAR(32)', notNull: true },
  { name: 'customer_email', type: 'VARCHAR(180)' },
  { name: 'customer_phone', type: 'VARCHAR(30)' },
  { name: 'seller_id', type: 'VARCHAR' },
  { name: 'price_id', type: 'INTEGER' },
  { name: 'operation_type_id', type: 'BIGINT' },
  { name: 'payment_form_id', type: 'BIGINT' },
  { name: 'payment_term_id', type: 'BIGINT' },
  { name: 'budget_shipping_id', type: 'INTEGER' },
  { name: 'subtotal', type: 'NUMERIC(14,2)', notNull: true, default: '0' },
  { name: 'items_discount_total', type: 'NUMERIC(14,2)', notNull: true, default: '0' },
  { name: 'global_discount_type', type: 'VARCHAR(20)', notNull: true, default: "'value'" },
  { name: 'global_discount_value', type: 'NUMERIC(14,2)', notNull: true, default: '0' },
  { name: 'global_discount_amount', type: 'NUMERIC(14,2)', notNull: true, default: '0' },
  { name: 'total_discount', type: 'NUMERIC(14,2)', notNull: true, default: '0' },
  { name: 'total_amount', type: 'NUMERIC(14,2)', notNull: true, default: '0' },
  { name: 'notes', type: 'TEXT' },
  { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
  { name: 'updated_at', type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()' },
];
// ----------------------------------------------------------------------
// Colunas permitidas em INSERT e UPDATE
// ----------------------------------------------------------------------
export const BUDGETS_INSERT_COLUMNS = Object.freeze([
  'issue_date',
  'status',
  'customer_id',
  'customer_name',
  'customer_tax_id',
  'customer_email',
  'customer_phone',
  'seller_id',
  'price_id',
  'operation_type_id',
  'payment_form_id',
  'payment_term_id',
  'budget_shipping_id',
  'subtotal',
  'items_discount_total',
  'global_discount_type',
  'global_discount_value',
  'global_discount_amount',
  'total_discount',
  'total_amount',
  'notes',
]);
export const BUDGETS_UPDATE_COLUMNS = BUDGETS_INSERT_COLUMNS;
const columnNames = new Set(columns.map(({ name }) => name));
export function isBudgetColumn(name) {
  return columnNames.has(name);
}

// Aliases de entrada não são colunas SQL.
const inputMap = Object.fromEntries(BUDGETS_INSERT_COLUMNS.map((name) => [name, [name]]));
Object.assign(inputMap, {
  issue_date: ['issue_date', 'dt_emissao', 'data_emissao'],
  customer_name: ['customer_name', 'nome_razao_social'],
  customer_tax_id: ['customer_tax_id', 'cnpj_cpf'],
  customer_email: ['customer_email', 'email'],
  customer_phone: ['customer_phone', 'phone', 'telefone'],
  budget_shipping_id: ['budget_shipping_id', 'budgetShippingId'],
  notes: ['notes', 'obs', 'observacao'],
  payment_form_id: ['payment_form_id', 'payment_method_id', 'paymentMethods_id', 'forma_pagamento_id'],
  payment_term_id: ['payment_term_id', 'condicao_pagamento_id'],
  seller_id: ['seller_id', 'seller', 'vendedor', 'vendedor_id'],
});

// ----------------------------------------------------------------------
// Catálogo do cabeçalho
// ----------------------------------------------------------------------
export const BUDGETS_SCHEMA = {
  table: BUDGETS_TABLE,
  primaryKey: BUDGETS_PRIMARY_KEY,
  comment: 'Orçamentos: cliente, parâmetros comerciais, descontos e totais. Frete em budgetsShipping.',
  columns,
  selectColumns: columns.map(({ name }) => name),
  selectProjection: columns.map(({ name }) => name).join(',\n    '),
  indexes: [
    { name: 'idx_budgets_customer_email', onRaw: ['LOWER(customer_email::text)'], where: 'customer_email IS NOT NULL' },
    { name: 'idx_budgets_customer_id', on: ['customer_id'], where: 'customer_id IS NOT NULL' },
    { name: 'idx_budgets_customer_name', onRaw: ['LOWER(customer_name::text)'] },
    { name: 'idx_budgets_customer_tax', on: ['customer_tax_id'] },
    { name: 'idx_budgets_customer_tax_id', on: ['customer_tax_id'] },
    { name: 'idx_budgets_issue_date', on: ['issue_date'] },
    ...['operation_type_id', 'payment_form_id', 'payment_term_id', 'price_id', 'seller_id'].map((name) => ({
      name: `idx_budgets_${name}`, on: [name], where: `${name} IS NOT NULL`,
    })),
    { name: 'idx_budgets_status', on: ['status'] },
    { name: 'uq_budgets_shipping', on: ['budget_shipping_id'], unique: true, where: 'budget_shipping_id IS NOT NULL' },
  ],
  foreignKeys: [
    { name: 'fk_budgets_operation_type', columns: ['operation_type_id'], references: 'public."nfeOperationTypes"', referenceColumns: ['operation_type_id'], onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    { name: 'fk_budgets_price', columns: ['price_id'], references: 'public.prices', referenceColumns: ['price_id'], onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    { name: 'fk_budgets_shipping', columns: ['budget_shipping_id'], references: 'public."budgetsShipping"', referenceColumns: ['budget_shipping_id'], onUpdate: 'CASCADE', onDelete: 'SET NULL' },
  ],
  search: {
    textFields: [
      { expr: 'LOWER(customer_name::text)', weight: 2 },
      { expr: 'customer_tax_id', weight: 2 },
      { expr: "LOWER(COALESCE(seller_id::text, ''))", weight: 1 },
      { expr: 'CAST(budget_id AS TEXT)', weight: 3 },
    ],
    dateFields: ['issue_date'], statusField: 'status',
  },
  apiPayloadMap: {
    in: { budget_id: ['budget_id', 'id'], ...inputMap },
    out: Object.fromEntries(['customer_name', 'customer_tax_id', 'customer_email', 'customer_phone', 'seller_id', 'budget_shipping_id']
      .map((name) => [name, (row) => row[name] ?? null])),
  },
  required: ['customer_name', 'customer_tax_id', 'issue_date', 'status'],
  upsertColumns: BUDGETS_INSERT_COLUMNS,
};

// ----------------------------------------------------------------------
// Preparação e validação de payload
// ----------------------------------------------------------------------
function prepare(payload, insert) {
  const data = {};
  const errors = [];
  for (const name of BUDGETS_INSERT_COLUMNS) {
    for (const alias of inputMap[name]) {
      if (Object.prototype.hasOwnProperty.call(payload ?? {}, alias) && payload[alias] !== undefined) {
        data[name] = payload[alias];
        break;
      }
    }
  }
  for (const name of BUDGETS_SCHEMA.required) {
    const present = Object.prototype.hasOwnProperty.call(data, name);
    // Datas/status omitidos em INSERT usam os defaults do PostgreSQL.
    const requiredOnInsert = ['customer_name', 'customer_tax_id'].includes(name);
    if ((present || (insert && requiredOnInsert)) &&
        (data[name] == null || String(data[name]).trim() === '')) {
      errors.push({ field: name, message: `Campo obrigatório: ${name}` });
    }
  }
  if (data.global_discount_type !== undefined && !['value', 'percent'].includes(data.global_discount_type)) {
    errors.push({ field: 'global_discount_type', message: 'global_discount_type deve ser value ou percent' });
  }
  for (const { name, type } of columns) {
    if (type !== 'NUMERIC(14,2)' || !Object.prototype.hasOwnProperty.call(data, name)) continue;
    const value = data[name];
    if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      errors.push({ field: name, message: `${name} deve ser um número não negativo` });
    }
  }
  return { valid: errors.length === 0, data, errors };
}
export function prepareBudgetInsert(payload = {}) {
  return prepare(payload, true);
}

export function prepareBudgetUpdate(payload = {}) {
  return prepare(payload, false);
}

export default BUDGETS_SCHEMA;
