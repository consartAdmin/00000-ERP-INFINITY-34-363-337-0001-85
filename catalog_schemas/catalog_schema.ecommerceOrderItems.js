// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.ecommerceOrderItems.js — Itens de Pedido E-commerce   ║
// ║ CONSART ERP / BH3 E-commerce                                         ║
/* ╚══════════════════════════════════════════════════════════════════════╝ */

export const ECOMMERCE_ORDER_ITEMS_TABLE = 'public."ecommerceOrderItems"';

export const ECOMMERCE_ORDER_ITEMS_SCHEMA = {
  table: ECOMMERCE_ORDER_ITEMS_TABLE,
  comment: 'Itens dos pedidos do e-commerce — vínculo com produtos e cabeçalho',

  columns: [
    // PK
    { name: 'id',           type: 'BIGSERIAL', pk: true, notNull: true, comment: 'PK do item' },

    // FK para cabeçalho
    { name: 'order_id',     type: 'BIGINT', comment: 'FK para ecommerceOrders.id (ON DELETE CASCADE)' },

    // FK/espelho de produto
    { name: 'product_id',   type: 'BIGINT',          comment: 'FK opcional para products.product_id' },
    { name: 'product_code', type: 'VARCHAR(50)',     comment: 'Código interno / SKU do produto no ERP' },
    { name: 'name',         type: 'TEXT',            comment: 'Nome/descrição do produto (snapshot)' },
    { name: 'unit',         type: 'VARCHAR(20)',     comment: 'Unidade de venda (UN, CX, KG, etc.)' },

    // Quantidade / preço
    { name: 'qty',          type: 'NUMERIC(12,2)',   comment: 'Quantidade vendida' },
    { name: 'price',        type: 'NUMERIC(12,2)',   comment: 'Preço unitário aplicado' },
    { name: 'total',        type: 'NUMERIC(12,2)',   comment: 'Total do item (qty * price)' },
  ],

  indexes: [
    { name: 'idx_ecom_order_items_order',   on: ['order_id'] },
    { name: 'idx_ecom_order_items_product', on: ['product_id'] },
    { name: 'idx_ecom_order_items_code',    on: ['product_code'] },
  ],

  search: {
    textFields: [
      { expr: 'LOWER(product_code)', weight: 2 },
      { expr: 'LOWER(name)',         weight: 1 },
    ],
    dateFields: [],    // não há data no item
    statusField: null, // não há status no item
  },

  selectProjection: `
    id,
    order_id,
    product_id,
    product_code,
    name,
    unit,
    qty,
    price,
    total
  `,

  apiPayloadMap: {
    in: {
      order_id:     ['order_id'],
      product_id:   ['product_id'],
      product_code: ['product_code', 'sku', 'codigo'],
      name:         ['name', 'product_name', 'descricao'],
      unit:         ['unit', 'unidade'],

      qty:          ['qty', 'quantidade'],
      price:        ['price', 'preco', 'preco_unitario', 'unit_price'],
      total:        ['total', 'valor_total'],
    },
    out: {
      // Também não precisamos de aliases complexos; row sai direto.
    },
  },

  // Required mínimos que fazem sentido pro negócio
  required: [
    'order_id',
    'product_code',
    'name',
    'qty',
    'price',
  ],

  upsertColumns: [
    'order_id',
    'product_id',
    'product_code',
    'name',
    'unit',
    'qty',
    'price',
    'total',
  ],
};

export default ECOMMERCE_ORDER_ITEMS_SCHEMA;
