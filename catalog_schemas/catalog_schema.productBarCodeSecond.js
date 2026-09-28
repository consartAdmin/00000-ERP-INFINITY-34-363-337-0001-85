// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.productBarCodeSecond.js — Second Barcode (CONSART ERP)   ║
// ║ - productBarCodeSecond → second_bar_code vinculado a product_code       ║
// ║                                     + product_unit_id                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/* ------------------------------------------------------------------------- */
/* productBarCodeSecond — Second barcode by product_code + product_unit_id   */
/* ------------------------------------------------------------------------- */

export const PRODUCT_BARCODE_SECOND_SCHEMA = Object.freeze({
  table: 'productBarCodeSecond',
  alias: 'pbs',

  columns: {
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do segundo código de barras',
    },

    // 🔗 Produto
    product_code: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Código do produto (FK para products.product_code)',
      references: {
        table: 'products',
        column: 'product_code',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    },

    // 🔗 Unidade vinculada a productUnits
    product_unit_id: {
      type: 'INTEGER',
      notNull: true,
      comment: 'Unidade do produto (FK para productUnits.id)',
      references: {
        table: 'productUnits',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
    },

    // 🔁 Segundo código de barras
    second_bar_code: {
      type: 'VARCHAR(100)',
      notNull: true,
      comment: 'Segundo código de barras para esta unidade do produto',
    },

    // 🔎 Tipo de código (EAN-13, DUN-14, etc.)
    code_type: {
      type: 'VARCHAR(50)',
      default: `'EAN-13'`,
      comment: 'Tipo do código de barras (ex: EAN-13, DUN-14, INTERNO)',
    },

    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação',
    },
    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Atualizado automaticamente pelo trigger set_timestamp()',
    },
  },

  indexes: {
    // Busca rápida
    idx_product_barcode_second_code: {
      columns: ['second_bar_code'],
      unique: false,
      comment: 'Busca rápida pelo segundo código de barras',
    },

    // Evita duplicidade por unidade
    idx_product_barcode_second_unique: {
      columns: ['product_code', 'product_unit_id', 'second_bar_code'],
      unique: true,
      comment:
        'Evita duplicidade do mesmo código de barras para o mesmo produto e unidade',
    },
  },
});

/* ------------------------------------------------------------------------- */
/* Export bundle                                                             */
/* ------------------------------------------------------------------------- */

const PRODUCT_BARCODE_SECOND_SCHEMAS = Object.freeze({
  PRODUCT_BARCODE_SECOND_SCHEMA,
});

export default PRODUCT_BARCODE_SECOND_SCHEMAS;
