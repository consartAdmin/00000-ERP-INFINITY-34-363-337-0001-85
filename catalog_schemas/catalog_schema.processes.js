// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 🧩 catalog_schema.processes.js — Schema Catalog: Processes (CONSART ERP) ║
// ║ Estrutura e metadados da tabela `processes`.                              ║
/* ╚══════════════════════════════════════════════════════════════════════════╝ */

export const PROCESSES_SCHEMA = Object.freeze({
  table: 'processes',
  alias: 'pr',

  columns: {
    // 🧱 Identificação
    id: {
      type: 'BIGSERIAL',
      pk: true,
      comment: 'Unique process identifier'
    },

    codigo: {
      type: 'VARCHAR(50)',
      comment: 'Internal code for identifying the process'
    },

    nome: {
      type: 'VARCHAR(200)',
      comment: 'Process name'
    },

    descricao: {
      type: 'TEXT',
      comment: 'Process description'
    },

    status: {
      type: 'VARCHAR(20)',
      default: "'ativo'",
      comment: 'Process status (ativo / inativo)'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Creation timestamp'
    },

    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Last update timestamp'
    },

    deleted_at: {
      type: 'TIMESTAMP',
      comment: 'Soft deletion timestamp'
    }
  }
});

export default PROCESSES_SCHEMA;
