// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.customerStatus.js — Customer Status (ERP)                  ║
// ║ Tabela: `customerStatus` — Status atual de cada cliente                   ║
// ║ Relaciona clientes → tipos de status                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const CUSTOMER_STATUS_SCHEMA = Object.freeze({
  table: 'customerStatus',
  alias: 'cs',

  columns: {
    // 🧱 Identificador único
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Primary key of customerStatus'
    },

    // 👤 Cliente vinculado
    customer_id: {
      type: 'INTEGER',
      notNull: true,
      references: 'customers(id)',
      onDelete: 'CASCADE',
      comment: 'FK → customers.id'
    },

    // 🔗 Tipo de status atual do cliente
    status_type_id: {
      type: 'INTEGER',
      notNull: true,
      references: 'customerStatusTypes(id)',
      comment: 'FK → customerStatusTypes.id'
    },

    // 📝 Observações (motivo, comentário da equipe comercial, etc.)
    note: {
      type: 'TEXT',
      comment: 'Optional annotation explaining the status'
    },

    // 🕓 Auditoria
    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Last update timestamp'
    },

    updated_by: {
      type: 'INTEGER',
      references: 'system_users(id)',
      comment: 'User who updated the status (optional FK)'
    }
  }
});
