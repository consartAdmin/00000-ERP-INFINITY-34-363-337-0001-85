// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.customerSegments.js — Catalog: CustomerSegments (CONSART)║
// ║ Logical schema for table `customerSegments`.                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const CUSTOMER_SEGMENTS_TABLE = 'public."customerSegments"';

export const CUSTOMER_SEGMENTS_SCHEMA = Object.freeze({
  table: CUSTOMER_SEGMENTS_TABLE,
  alias: 'cs',
  pk: 'segment_id',

  columns: {
    // 🧱 Primary key
    segment_id: {
      type: 'BIGSERIAL',
      pk: true,
      notNull: true,
      comment: 'Primary key for customer segment'
    },

    // 🔑 Unique short code (RETAIL, WHOLESALE, VIP, DEFAULT)
    segment_code: {
      type: 'VARCHAR(30)',
      notNull: true,
      unique: true,
      comment: 'Unique short code for customer segment'
    },

    // 🏷 Human readable name
    segment_name: {
      type: 'VARCHAR(120)',
      notNull: true,
      comment: 'Human-readable customer segment name'
    },

    // 📝 Optional description
    description: {
      type: 'TEXT',
      notNull: false,
      comment: 'Optional description for the customer segment'
    },

    // ✅ Active flag
    is_active: {
      type: 'BOOLEAN',
      notNull: true,
      default: 'TRUE',
      comment: 'Indicates if segment is active'
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
