// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.ordersDelivery.js — Entrega / Frete do Pedido             ║
// ║ CONSART ERP                                                              ║
// ║ Define estrutura da tabela `ordersDelivery`                              ║
// ║ Relacionamento 1:1 com orders (order_id UNIQUE)                           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const ORDER_DELIVERY_SCHEMA = Object.freeze({
  table: 'ordersDelivery',
  alias: 'od',

  columns: {
    id: { type: 'BIGSERIAL', pk: true },

    order_id: {
      type: 'BIGINT',
      notNull: true,
      unique: true,
      fk: { table: 'orders', column: 'order_id', onDelete: 'CASCADE' },
    },

    freight_mode: {
      type: 'SMALLINT',
      notNull: true,
      default: 9,
      check: 'freight_mode IN (0,1,2,9)',
    },

    freight_value: { type: 'NUMERIC(12,2)', notNull: true, default: '0' },

    carrier_name: { type: 'TEXT' },
    carrier_cnpj_cpf: { type: 'VARCHAR(14)', check: "carrier_cnpj_cpf ~ '^[0-9]{11}$|^[0-9]{14}$'" },
    carrier_ie: { type: 'VARCHAR(20)' },
    carrier_address: { type: 'TEXT' },
    carrier_city: { type: 'TEXT' },
    carrier_uf: { type: 'CHAR(2)', check: "carrier_uf ~ '^[A-Z]{2}$'" },

    antt_code: { type: 'VARCHAR(20)' },
    vehicle_plate: { type: 'VARCHAR(8)' },
    vehicle_uf: { type: 'CHAR(2)', check: "vehicle_uf ~ '^[A-Z]{2}$'" },

    volume_quantity: { type: 'INTEGER' },
    volume_species: { type: 'TEXT' },
    volume_brand: { type: 'TEXT' },
    volume_numbering: { type: 'TEXT' },

    gross_weight: { type: 'NUMERIC(12,3)' },
    net_weight: { type: 'NUMERIC(12,3)' },

    created_at: { type: 'TIMESTAMPTZ', default: 'NOW()', notNull: true },
    updated_at: { type: 'TIMESTAMPTZ', default: 'NOW()', notNull: true },
  },

  indexes: [{ name: 'idx_orderdelivery_order_id', columns: ['order_id'] }],

  triggers: [{ name: 'trg_orderdelivery_set_timestamp', timing: 'BEFORE UPDATE', function: 'set_timestamp' }],
});
