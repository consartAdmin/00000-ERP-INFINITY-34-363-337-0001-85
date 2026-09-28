// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.ordersLogisticsItems.js — Itens da Logística (CONSART ERP) ║
// ║ Estrutura base da tabela `ordersLogisticsItems`                            ║
// ║ Amarra itens do pedido ao processo logístico e conferência cega.           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const ORDERS_LOGISTICS_ITEMS_SCHEMA = Object.freeze({
  table: 'ordersLogisticsItems',
  alias: 'oli',

  columns: {
    // 🧱 Identificação
    item_log_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do item logístico'
    },

    logistics_id: {
      type: 'INTEGER',
      notNull: true,
      references: 'ordersLogistics(logistics_id)',
      onDelete: 'CASCADE',
      comment: 'FK para o processo logístico principal'
    },

    order_item_id: {
      type: 'INTEGER',
      notNull: true,
      references: 'order_items(order_item_id)',
      onDelete: 'CASCADE',
      comment: 'Relaciona com o item original do pedido'
    },

    // 🏷️ Dados do item
    sku: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'SKU do produto'
    },

    product_name: {
      type: 'TEXT',
      notNull: true,
      comment: 'Nome do produto'
    },

    // 🔢 Quantidades (conferência cega)
    qty_ordered: {
      type: 'NUMERIC(14,3)',
      notNull: true,
      comment: 'Quantidade do pedido (não exibida ao conferente)'
    },

    qty_picked: {
      type: 'NUMERIC(14,3)',
      notNull: true,
      default: 0,
      comment: 'Quantidade separada no picking'
    },

    qty_checked: {
      type: 'NUMERIC(14,3)',
      notNull: true,
      default: 0,
      comment: 'Quantidade conferida via bipagem (conferência cega)'
    },

    discrepancy_qty: {
      type: 'NUMERIC(14,3)',
      generated: 'ALWAYS AS (qty_checked - qty_picked) STORED',
      comment: 'Diferença automática entre o separado e o conferido'
    },

    // 📍 Estoque
    location: {
      type: 'VARCHAR(120)',
      comment: 'Localização física no estoque (rua/corredor/prateleira)'
    },

    // 📝 Observações
    obs: {
      type: 'TEXT',
      comment: 'Observações gerais do item na logística'
    },

    // 🕓 Auditoria
    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Última atualização do item'
    }
  }
});
