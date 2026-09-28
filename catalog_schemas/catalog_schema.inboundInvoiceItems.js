// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.inboundInvoiceItems.js — Itens da NF de Entrada (CONSART ERP)║
// ║ Define estrutura base da tabela `inboundInvoiceItems`                      ║
// ║ Produtos / itens vinculados à NF de entrada                                ║
// ╚════════════════════════════════════════════════════════════════════════════╝

export const INBOUND_INVOICE_ITEMS_SCHEMA = Object.freeze({
  table: '"inboundInvoiceItems"', // ⚠️ nome real no Postgres
  alias: 'iii',

  columns: {
    id: {
      type: 'INTEGER',
      pk: true,
      identity: true,
      comment: 'Identificador único do item da NF de entrada'
    },

    invoice_id: {
      type: 'INTEGER',
      notNull: true,
      fk: {
        table: '"inboundInvoices"',
        column: 'id',
        onDelete: 'CASCADE'
      },
      comment: 'FK para inboundInvoices(id)'
    },

    product_code: {
      type: 'VARCHAR(50)',
      comment: 'Código do produto no XML (cProd)'
    },

    description: {
      type: 'TEXT',
      comment: 'Descrição do item no XML (xProd)'
    },

    ncm: {
      type: 'VARCHAR(20)',
      comment: 'NCM do produto'
    },

    cfop: {
      type: 'VARCHAR(10)',
      comment: 'CFOP do item'
    },

    unit: {
      type: 'VARCHAR(10)',
      comment: 'Unidade comercial do item (uCom)'
    },

    quantity: {
      type: 'NUMERIC(12,4)',
      notNull: true,
      comment: 'Quantidade do item (qCom)'
    },

    unit_price: {
      type: 'NUMERIC(12,4)',
      notNull: true,
      comment: 'Valor unitário (vUnCom)'
    },

    total_price: {
      type: 'NUMERIC(12,2)',
      notNull: true,
      comment: 'Valor total do item (vProd)'
    },

    ipi: {
      type: 'NUMERIC(12,2)',
      notNull: true,
      default: '0',
      comment: 'Valor IPI do item'
    },

    icms: {
      type: 'NUMERIC(12,2)',
      notNull: true,
      default: '0',
      comment: 'Valor ICMS do item'
    },

    product_id: {
      type: 'INTEGER',
      comment: 'FK opcional para products(product_id). Pode ser preenchido após match SKU/EAN.'
    }
  },

  indexes: [
    { name: 'inbound_invoice_items_pkey', columns: ['id'], unique: true },
    { name: 'idx_inbound_invoice_items_invoice', columns: ['invoice_id'] },
    { name: 'idx_inbound_invoice_items_product', columns: ['product_id'] },
  ],
});
