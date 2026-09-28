// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.customersIbge.js — Localização IBGE de Clientes            ║
// ║ CONSART ERP                                                               ║
// ║ Define estrutura da tabela `customersIbge`                                 ║
// ║ Responsável por UF, cidade, código IBGE e nível de confiança               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const CUSTOMERS_IBGE_SCHEMA = Object.freeze({
  table: 'customersIbge',
  alias: 'cib',

  columns: {
    // 🧱 Identificação principal
    customer_id: {
      type: 'BIGINT',
      pk: true,
      notNull: true,
      fk: {
        table: 'customers',
        column: 'customer_id',
        onDelete: 'CASCADE'
      },
      comment: 'Identificador do cliente (FK para customers)'
    },

    // 🌎 Localização
    uf: {
      type: 'CHAR(2)',
      notNull: true,
      comment: 'Unidade federativa (UF)'
    },

    city: {
      type: 'TEXT',
      notNull: true,
      comment: 'Nome do município'
    },

    codigo_ibge: {
      type: 'CHAR(7)',
      comment: 'Código IBGE do município'
    },

    // 🧠 Origem e confiança
    source: {
      type: 'TEXT',
      default: "'manual'",
      notNull: true,
      comment: 'Origem da informação (manual, api, inference)'
    },

    confidence: {
      type: 'SMALLINT',
      default: 100,
      notNull: true,
      comment: 'Nível de confiança do dado (0–100)'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data de criação do registro'
    },

    updated_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data da última atualização'
    }
  },

  indexes: {
    idx_uf_city: {
      columns: ['uf', 'city'],
      unique: false,
      comment: 'Índice para busca por UF e cidade'
    }
  }
});
