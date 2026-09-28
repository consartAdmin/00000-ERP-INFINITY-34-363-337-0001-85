// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.budgetItens.js — Schema de Itens do Orçamento — ESM   ║
// ║ CONSART ERP                                                          ║
// ║ ✅ Alinhado com public."budgetItens" (conforme \d)                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const BUDGET_ITENS_TABLE = 'public."budgetItens"';

export const BUDGET_ITENS_SCHEMA = {
  table: BUDGET_ITENS_TABLE,

  comment:
    'Itens do orçamento — snapshot do produto (sku/descrição/unidade) + vínculo com budget_id, price_id e commission_id',

  columns: [
    { name: 'budget_item_id', type: 'BIGSERIAL', pk: true, notNull: true, comment: 'PK' },

    // FK orçamento
    { name: 'budget_id', type: 'BIGINT', notNull: true, comment: 'FK budgets(budget_id)' },

    // Snapshot produto
    { name: 'sku',         type: 'VARCHAR(80)',  notNull: true, comment: 'SKU / código do produto (snapshot)' },
    { name: 'description', type: 'VARCHAR(240)', notNull: true, comment: 'Descrição do produto (snapshot)' },

    // Grade (FK opcional)
    { name: 'grade_id', type: 'INTEGER', comment: 'FK grades(grade_id) (opcional)' },

    // Unidade
    { name: 'unit', type: 'VARCHAR(10)', notNull: true, comment: 'Unidade de venda (snapshot)' },

    // Quantidades / valores
    { name: 'quantity',       type: 'NUMERIC(14,3)', notNull: true, default: '0', comment: 'Quantidade' },
    { name: 'unit_price',     type: 'NUMERIC(14,4)', notNull: true, default: '0', comment: 'Preço unitário' },
    { name: 'discount_value', type: 'NUMERIC(14,4)', notNull: true, default: '0', comment: 'Desconto (valor)' },

    // Timestamps (na tabela: timestamp without time zone)
    { name: 'created_at', type: 'TIMESTAMP', default: 'NOW()', comment: 'Criado em' },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'NOW()', comment: 'Atualizado em' },

    // Campos “ponte” (usados no seu sync de preços/comissões)
    { name: 'product_id',    type: 'VARCHAR(20)', comment: 'Identificador do produto (compat/ponte)' },
    { name: 'price_id',      type: 'INTEGER',     comment: 'FK prices(price_id) (opcional)' },
    { name: 'commission_id', type: 'BIGINT',      comment: 'FK priceCommissions(commission_id) (opcional)' },
  ],

  // Índices (alinhados com o \d)
  // Obs.: você tem 2 índices em budget_id (idx_budget_items_budget e idx_budgetitens_budget_id).
  // Mantemos ambos, mas se seu ensureIndex não for idempotente, você pode remover um deles.
  indexes: [
    { name: 'idx_budget_items_budget',   on: ['budget_id'] },
    { name: 'idx_budgetitens_budget_id', on: ['budget_id'] },

    { name: 'idx_budget_items_sku',      on: ['sku'] },
    { name: 'idx_budget_items_grade',    on: ['grade_id'] },

    { name: 'idx_budgetitens_price_id',  on: ['price_id'] },
    { name: 'idx_budgetitens_product_id',on: ['product_id'] },
  ],

  // Busca (para modal / autocomplete / filtros)
  search: {
    textFields: [
      { expr: 'LOWER(sku::text)',         weight: 3 },
      { expr: 'LOWER(description::text)', weight: 2 },
      { expr: 'LOWER(COALESCE(unit::text, \'\'))', weight: 1 },
      { expr: 'CAST(budget_id AS TEXT)',  weight: 2 },
      { expr: 'CAST(budget_item_id AS TEXT)', weight: 1 },
    ],
    numberFields: ['quantity', 'unit_price', 'discount_value'],
  },

  // Projeção padrão
  selectProjection: `
    budget_item_id,
    budget_id,
    sku,
    description,
    grade_id,
    unit,
    quantity,
    unit_price,
    discount_value,
    created_at,
    updated_at,
    product_id,
    price_id,
    commission_id
  `,

  // Aliases de payload (entrada do front / importadores)
  apiPayloadMap: {
    in: {
      budget_item_id:   ['budget_item_id', 'id', 'item_id'],
      budget_id:        ['budget_id'],

      sku:              ['sku', 'product_code', 'codigo'],
      description:      ['description', 'desc', 'descricao'],

      grade_id:         ['grade_id', 'product_grade_id', 'grade', 'gradeId'],

      unit:             ['unit', 'un', 'u_m', 'um', 'unidade'],

      quantity:         ['quantity', 'qty', 'qtd', 'quantidade'],
      unit_price:       ['unit_price', 'price', 'valor_unitario', 'preco_unitario'],
      discount_value:   ['discount_value', 'discount', 'desconto', 'valor_desconto'],

      product_id:       ['product_id'],
      price_id:         ['price_id', 'tabela_preco_id'],
      commission_id:    ['commission_id'],
    },

    out: {
      sku:            (row) => row.sku ?? null,
      description:    (row) => row.description ?? null,
      unit:           (row) => row.unit ?? null,
      price_id:       (row) => row.price_id ?? null,
      commission_id:  (row) => row.commission_id ?? null,
      product_id:     (row) => row.product_id ?? null,
    },
  },

  // Validações mínimas (conforme NOT NULL do \d)
  required: ['budget_id', 'sku', 'description', 'unit'],

  // Colunas permitidas para INSERT/UPDATE
  upsertColumns: [
    'budget_id',

    'sku',
    'description',
    'grade_id',
    'unit',

    'quantity',
    'unit_price',
    'discount_value',

    'product_id',
    'price_id',
    'commission_id',

    // created_at/updated_at ficam por DEFAULT/trigger/rotina de update
  ],
};

export default BUDGET_ITENS_SCHEMA;
