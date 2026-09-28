// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.customerStatusTypes.js — Customer Status Types (ERP)       ║
// ║ Tabela catálogo: `customerStatusTypes`                                    ║
// ║ Define os tipos de status (em português) aplicáveis aos clientes.         ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const CUSTOMER_STATUS_TYPES_SCHEMA = Object.freeze({
  table: 'customerStatusTypes',
  alias: 'cst',

  columns: {
    // 🧱 Identificador único
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Primary key of customer status type'
    },

    // 🔤 Nome em português (ex.: Ativo, Potencial, Inadimplente)
    name_pt: {
      type: 'VARCHAR(80)',
      notNull: true,
      comment: 'Portuguese display name of the status'
    },

    // 🔠 Código interno usado pelo backend (ex.: ACTIVE, DELINQUENT)
    internal_code: {
      type: 'VARCHAR(40)',
      notNull: true,
      unique: true,
      comment: 'Internal status code in English (no spaces)'
    },

    // 📝 Descrição detalhada (em inglês)
    description_en: {
      type: 'TEXT',
      comment: 'English description of the status type'
    },

    // 🎨 Cor associada (UI)
    color_hex: {
      type: 'VARCHAR(7)',
      comment: 'Hex color used to represent the status visually'
    },

    // 🔢 Ordem de exibição
    sort_order: {
      type: 'SMALLINT',
      default: 0,
      comment: 'Controls ordering of status types in UI'
    },

    // 🟢 Ativo / Inativo
    is_active: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Indicates if this status type is currently active'
    }
  }
});
