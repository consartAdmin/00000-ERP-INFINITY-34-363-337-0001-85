// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.customerSubSegments.js — Catalog Schema (ESM)            ║
// ║ Estrutura lógica da tabela `customerSubSegments`                        ║
// ║ CONSART ERP — Sub-segmentos de clientes                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const CUSTOMER_SUBSEGMENTS_TABLE = 'public."customerSubSegments"';

export const CUSTOMER_SUBSEGMENTS_SCHEMA = Object.freeze({
  table: CUSTOMER_SUBSEGMENTS_TABLE,
  alias: 'css',
  pk: 'subsegment_id',

  columns: {
    // 🧱 Primary Key
    subsegment_id: {
      type: 'BIGSERIAL',
      notNull: true,
      pk: true,
      comment: 'Primary key for customer subsegment'
    },

    // 🔗 FK → customerSegments.segment_id
    segment_id: {
      type: 'BIGINT',
      notNull: true,
      fk: {
        table: 'public."customerSegments"',
        column: 'segment_id',
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      comment: 'Parent customer segment reference'
    },

    // 🔑 Código curto
    subsegment_code: {
      type: 'VARCHAR(40)',
      notNull: true,
      unique: true,
      comment: 'Unique short code for subsegment'
    },

    // 🏷 Nome do subsegmento
    subsegment_name: {
      type: 'VARCHAR(150)',
      notNull: true,
      comment: 'Human readable subsegment name'
    },

    // 📝 Descrição opcional
    description: {
      type: 'TEXT',
      notNull: false,
      comment: 'Optional description for the subsegment'
    },

    // ✅ Ativado?
    is_active: {
      type: 'BOOLEAN',
      notNull: true,
      default: 'TRUE',
      comment: 'Indicates if subsegment is active'
    },

    // 🕒 Timestamps
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: 'NOW()',
      comment: 'Row creation timestamp'
    },

    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: 'NOW()',
      comment: 'Row last update timestamp'
    }
  }
});
