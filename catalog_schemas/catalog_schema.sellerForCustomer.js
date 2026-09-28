// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.sellerForCustomer.js — Seller ↔ Customer Link (CONSART ERP)║
// ║ Defines base structure for table "SellerForCustomer"                      ║
// ║ Many-to-many link between sellers and customers                           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const SELLER_FOR_CUSTOMER_SCHEMA = Object.freeze({
  table: 'SellerForCustomer',
  alias: 'sfc',

  columns: {
    // 🧱 Primary Identification
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Unique identifier for this relation'
    },

    // 🔗 Foreign Keys
    seller_id: {
      type: 'INTEGER',
      notNull: true,
      references: {
        table: 'sellers',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      comment: 'Reference to the seller (sellers.id)'
    },

    customer_id: {
      type: 'INTEGER',
      notNull: true,
      references: {
        table: 'customers',
        column: 'id',
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      comment: 'Reference to the customer (customers.id)'
    },

    // 🔘 Active/Inactive
    active: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Defines whether the relationship is active'
    },

    // 🕓 Audit Columns
    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Timestamp of creation'
    },

    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Timestamp of last update'
    }
  },

  // 🔐 Unique constraints for business logic
  uniqueKeys: [
    ['seller_id', 'customer_id']  // Prevent duplicate seller ↔ customer records
  ]
});
