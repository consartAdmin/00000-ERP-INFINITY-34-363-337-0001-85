// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.ibgeLocations.js — Catálogo: IBGE Locations           ║
// ║ CONSART ERP | ESM                                                    ║
// ║                                                                      ║
// ║ Table: "ibgeLocations"                                               ║
// ║ Purpose: States + Cities (IBGE official data)                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const IBGE_LOCATIONS_SCHEMA = Object.freeze({
  table: 'ibgeLocations',
  alias: 'il',

  columns: {
    // 🧱 Primary key
    ibge_location_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Primary key of IBGE location (state + city)',
    },

    // 🌎 Location data
    state: {
      type: 'CHAR(2)',
      notNull: true,
      comment: 'State abbreviation (MG, SP, RJ...)',
    },

    city: {
      type: 'TEXT',
      notNull: true,
      comment: 'City name',
    },

    ibge_code: {
      type: 'INTEGER',
      notNull: true,
      unique: true,
      comment: 'Official IBGE city code',
    },

    // 🔄 Status
    status: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Active / inactive record',
    },

    // 🕒 Audit
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: 'now()',
      comment: 'Creation timestamp',
    },

    updated_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: 'now()',
      comment: 'Last update timestamp',
    },
  },

  constraints: {
    unique: [
      ['state', 'city'],
      ['ibge_code'],
    ],
  },

  indexes: [
    ['state'],
    ['city'],
    ['status'],
  ],
});
