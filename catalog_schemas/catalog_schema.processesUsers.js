// ╔════════════════════════════════════════════════════════════════════════════════╗
// ║ 🧩 catalog_schema.processesUsers.js — Schema Catalog: ProcessesUsers (CONSART) ║
// ║ Estrutura e metadados da tabela `"processesUsers"`.                            ║
/* ╚════════════════════════════════════════════════════════════════════════════════╝ */

export const PROCESSES_USERS_SCHEMA = Object.freeze({
  table: '"processesUsers"',   // precisa de aspas devido ao camelCase
  alias: 'pu',

  columns: {
    // 🧱 Identificação
    id: {
      type: 'BIGSERIAL',
      pk: true,
      comment: 'Unique identifier for process-user permission'
    },

    // 🔗 Relacionamentos
    process_id: {
      type: 'BIGINT',
      comment: 'FK → processes.id'
    },

    user_id: {
      type: 'INTEGER',
      comment: 'FK → users.id'
    },

    // 🔐 Permissões
    can_view: {
      type: 'BOOLEAN',
      default: true,
      comment: 'User can view the process'
    },

    can_edit: {
      type: 'BOOLEAN',
      default: false,
      comment: 'User can edit/operate the process'
    },

    can_approve: {
      type: 'BOOLEAN',
      default: false,
      comment: 'User can approve or finalize the process'
    },

    is_owner: {
      type: 'BOOLEAN',
      default: false,
      comment: 'User is the primary responsible (owner) of the process'
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

export default PROCESSES_USERS_SCHEMA;
