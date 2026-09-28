// ╔══════════════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.inboundInvoiceInstallments.js — Parcelas NF Entrada (CONSART ERP) ║
// ║ Define estrutura base da tabela `inboundInvoiceInstallments`                     ║
// ║ Duplicatas/parcelas vinculadas à NF de entrada                                   ║
// ╚══════════════════════════════════════════════════════════════════════════════════╝

export const INBOUND_INVOICE_INSTALLMENTS_SCHEMA = Object.freeze({
  table: '"inboundInvoiceInstallments"', // ⚠️ nome real no Postgres
  alias: 'iip',

  columns: {
    id: {
      type: 'INTEGER',
      pk: true,
      identity: true,
      comment: 'Identificador único da parcela'
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

    installment_code: {
      type: 'VARCHAR(20)',
      notNull: true,
      comment: 'Código/identificador da parcela (nDup ou índice)'
    },

    due_date: {
      type: 'DATE',
      notNull: true,
      comment: 'Data de vencimento da parcela'
    },

    amount: {
      type: 'NUMERIC(12,2)',
      notNull: true,
      comment: 'Valor da parcela'
    },

    is_paid: {
      type: 'BOOLEAN',
      notNull: true,
      default: false,
      comment: 'Indica se a parcela foi paga'
    },
  },

  indexes: [
    { name: 'inbound_invoice_installments_pkey', columns: ['id'], unique: true },
    { name: 'idx_inbound_invoice_installments_invoice', columns: ['invoice_id'] },
    { name: 'idx_inbound_invoice_installments_due_date', columns: ['due_date'] },
  ],
});
