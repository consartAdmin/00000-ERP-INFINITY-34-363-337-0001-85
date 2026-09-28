// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.labelParameters.js — Parameters for Label Printing (ESM) ║
// ║ CONSART ERP — Defines structure of `labelParameters` table              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const LABEL_PARAMETERS_SCHEMA = Object.freeze({
  table: 'labelParameters',
  alias: 'lp',

  columns: {
    // 🧱 Identification
    id: {
      type: 'SERIAL',
      pk: true,
      notNull: true,
      comment: 'Primary key of label parameters',
    },

    user_id: {
      type: 'INTEGER',
      comment: 'Owner user ID (nullable)',
    },

    // 🏷️ General Info
    name: {
      type: 'VARCHAR(80)',
      notNull: true,
      default: `'default'`,
      comment: 'Label parameter name',
    },

    // 📄 Page Dimensions (millimeters)
    page_width_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 210,
      comment: 'Page width in millimeters',
    },
    page_height_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 297,
      comment: 'Page height in millimeters',
    },

    // 🖨️ Label Dimensions (millimeters)
    label_width_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      comment: 'Single label width in mm',
    },
    label_height_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      comment: 'Single label height in mm',
    },

    // 🗒️ Layout Grid
    cols_per_page: {
      type: 'INTEGER',
      notNull: true,
      default: 1,
      comment: 'How many columns of labels per page',
    },
    rows_per_page: {
      type: 'INTEGER',
      notNull: true,
      default: 1,
      comment: 'How many rows of labels per page',
    },

    // ➖ Margins
    margin_left_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 0,
    },
    margin_top_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 0,
    },
    margin_right_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 0,
    },
    margin_bottom_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 0,
    },

    // ↔ Spacing
    spacing_x_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 0,
    },
    spacing_y_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 0,
    },

    // 🔤 Font Sizes
    font_size_title: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 12,
    },
    font_size_code: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 10,
    },
    font_size_price: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 12,
    },
    font_size_barcode_label: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 10,
    },

    // 🧾 Barcode
    barcode_width_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 40,
    },
    barcode_height_mm: {
      type: 'NUMERIC(10,2)',
      notNull: true,
      default: 20,
    },
    barcode_format: {
      type: 'VARCHAR(30)',
      notNull: true,
      default: `'EAN13'`,
    },

    // 💲 Price Visibility
    show_price: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
    },
    currency_symbol: {
      type: 'VARCHAR(5)',
      notNull: true,
      default: `'R$'`,
    },

    // ⚙️ Status
    active: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
    },

    // 🕓 Audit
    created_at: {
      type: 'TIMESTAMP',
      default: 'now()',
    },
    updated_at: {
      type: 'TIMESTAMP',
      default: 'now()',
    },
  },
});
