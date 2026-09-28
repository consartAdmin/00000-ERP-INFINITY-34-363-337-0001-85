// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.inboundInvoices.js — Tabela Inbound Invoices (CONSART ERP) ║
// ║ Define estrutura base da tabela `inboundInvoices`                         ║
// ║ Cabeçalho da Nota Fiscal de Entrada (NF-e)                                ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const INBOUND_INVOICES_SCHEMA = Object.freeze({
  table: '"inboundInvoices"', // ⚠️ nome real no Postgres (CamelCase + aspas)
  alias: 'ii',

  columns: {
    id: {
      type: 'INTEGER',
      pk: true,
      identity: true,
      comment: 'Identificador único da NF de entrada'
    },

    access_key: {
      type: 'CHAR(44)',
      notNull: true,
      unique: true,
      comment: 'Chave de acesso da NF-e (44 dígitos)'
    },

    invoice_number: {
      type: 'VARCHAR(20)',
      notNull: true,
      comment: 'Número da NF-e'
    },

    series: {
      type: 'VARCHAR(5)',
      notNull: true,
      comment: 'Série da NF-e'
    },

    issuer: {
      type: 'VARCHAR(18)',
      notNull: true,
      comment: 'CNPJ/CPF do emitente (somente dígitos recomendado)'
    },

    recipient: {
      type: 'VARCHAR(18)',
      notNull: true,
      comment: 'CNPJ/CPF do destinatário (somente dígitos recomendado)'
    },

    total_amount: {
      type: 'NUMERIC(12,2)',
      notNull: true,
      comment: 'Valor total da NF-e'
    },

    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      notNull: true,
      comment: 'Data de criação do registro'
    },

    // ✅ Campos recomendados para o fluxo POST INVOICE (opcional / futuro)
    // status: { type: 'VARCHAR(20)', default: "'DRAFT'", comment: 'DRAFT | POSTED | CANCELED' },
    // stock_applied: { type: 'BOOLEAN', default: false, comment: 'Indica se estoque já foi aplicado' },
    // stock_applied_at: { type: 'TIMESTAMPTZ', comment: 'Data/hora de aplicação do estoque' },
  },

  checks: [
    {
      name: 'inbound_invoices_access_key_len_ck',
      expression: 'char_length(access_key::text) = 44',
      comment: 'Garante chave de acesso com 44 caracteres'
    }
  ],

  indexes: [
    { name: 'inbound_invoices_pkey', columns: ['id'], unique: true },
    { name: 'inbound_invoices_access_key_uk', columns: ['access_key'], unique: true },
  ],
});
