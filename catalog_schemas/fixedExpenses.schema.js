// ╔══════════════════════════════════════════════════════════════════════╗
// ║ fixedExpenses.schema.js — Estrutura da tabela de Despesas Fixas     ║
// ║ CONSART ERP — Modelo ESM p/ controllers e migrações                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const FIXED_EXPENSES_SCHEMA = Object.freeze({
  table: 'fixed_expenses',

  /** Campos e tipos */
  columns: {
    id: {
      type: 'serial',
      pk: true,
      comment: 'Identificador único da despesa fixa',
    },
    customer_id: {
      type: 'integer',
      fk: 'clientes.id',
      comment: 'Relaciona a despesa fixa ao cliente correspondente',
    },
    report_name: {
      type: 'varchar(255)',
      notNull: true,
      comment: 'Nome do relatório ou categoria da despesa fixa',
    },
    payload: {
      type: 'jsonb',
      comment: 'Dados completos do relatório (JSON estruturado com valores e descrições)',
    },
    created_at: {
      type: 'timestamp with time zone',
      default: 'CURRENT_TIMESTAMP',
      comment: 'Data/hora de criação do registro',
    },
    updated_at: {
      type: 'timestamp with time zone',
      default: 'CURRENT_TIMESTAMP',
      comment: 'Data/hora da última atualização',
    },
  },

  /** Alias padrão p/ uso em controllers */
  alias: {
    id: 'id',
    customer_id: 'clienteId',
    report_name: 'nomeRelatorio',
    payload: 'dadosRelatorio',
    created_at: 'criadoEm',
    updated_at: 'atualizadoEm',
  },

  /** SQL DDL de referência */
  ddl: `
    CREATE TABLE IF NOT EXISTS fixed_expenses (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      report_name VARCHAR(255) NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `,
});

export default FIXED_EXPENSES_SCHEMA;
