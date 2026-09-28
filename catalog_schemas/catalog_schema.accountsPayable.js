// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.accountsPayable.js — Catalog Schema Definition        ║
// ║ CONSART ERP — Accounts Payable Catalog Schema                        ║
// ║                                                                      ║
// ║ Tabela: public."accountsPayable"                                     ║
// ║ Descrição: Manage supplier payables and due invoices                 ║
// ╚══════════════════════════════════════════════════════════════════════╝
export const CATALOG_ACCOUNTS_PAYABLE = 'public."accountsPayable"';

export const CATALOG_ACCOUNTS_PAYABLE = {
  table: 'accountsPayable',
  schema: 'public',
  primaryKey: 'id',
  description: 'Manage supplier payables and due invoices',

  columns: {
    id: {
      type: 'integer',
      primaryKey: true,
      autoIncrement: true,
      description: 'Primary key of accounts payable record'
    },

    supplier_id: {
      type: 'integer',
      notNull: true,
      foreignKey: { table: 'suppliers', column: 'supplier_id' },
      description: 'Supplier foreign key (vendor reference)'
    },

    invoice_number: {
      type: 'varchar(50)',
      description: 'Invoice or bill number'
    },

    issue_date: {
      type: 'date',
      notNull: true,
      description: 'Date when the payable was issued'
    },

    due_date: {
      type: 'date',
      notNull: true,
      description: 'Date when the payment is due'
    },

    payment_date: {
      type: 'date',
      description: 'Date when payment was made (if any)'
    },

    payment_method_id: {
      type: 'integer',
      foreignKey: { table: 'paymentMethods', column: 'paymentMethods_id' },
      description: 'Payment method reference (cash, boleto, card, etc.)'
    },

    description: {
      type: 'text',
      description: 'Optional text description of the payable'
    },

    category_id: {
      type: 'integer',
      foreignKey: { table: 'expensesCategories', column: 'id' },
      description: 'Main expense category (e.g., Payroll, Utilities)'
    },

    subcategory_id: {
      type: 'integer',
      foreignKey: { table: 'expensesSubcategories', column: 'id' },
      description: 'Detailed expense subcategory (e.g., Electricity, Internet)'
    },

    document_number: {
      type: 'varchar(50)',
      description: 'Document number or fiscal reference'
    },

    total_value: {
      type: 'numeric(14,2)',
      notNull: true,
      default: 0.0,
      description: 'Total payable amount'
    },

    amount_paid: {
      type: 'numeric(14,2)',
      default: 0.0,
      description: 'Amount already paid'
    },

    balance: {
      type: 'numeric(14,2)',
      generated: 'ALWAYS AS (total_value - COALESCE(amount_paid, 0)) STORED',
      description: 'Remaining balance automatically calculated'
    },

    status: {
      type: 'varchar(20)',
      default: 'PENDING',
      enum: ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'],
      description: 'Payment status'
    },

    notes: {
      type: 'text',
      description: 'Internal notes about the payable'
    },

    attachment_url: {
      type: 'text',
      description: 'URL or path to the attached document (PDF, image, etc.)'
    },

    created_at: {
      type: 'timestamp',
      default: 'CURRENT_TIMESTAMP',
      description: 'Record creation date/time'
    },

    updated_at: {
      type: 'timestamp',
      default: 'CURRENT_TIMESTAMP',
      description: 'Record last update date/time'
    }
  },

  indexes: [
    { columns: ['supplier_id'], name: 'idx_accountsPayable_supplier' },
    { columns: ['due_date'], name: 'idx_accountsPayable_dueDate' },
    { columns: ['status'], name: 'idx_accountsPayable_status' }
  ],

  aliases: {
    id: 'ID',
    supplier_id: 'Supplier',
    invoice_number: 'Invoice No.',
    issue_date: 'Issue Date',
    due_date: 'Due Date',
    payment_date: 'Payment Date',
    payment_method_id: 'Payment Method',
    description: 'Description',
    category_id: 'Category',
    subcategory_id: 'Subcategory',
    document_number: 'Document No.',
    total_value: 'Total',
    amount_paid: 'Paid',
    balance: 'Balance',
    status: 'Status',
    notes: 'Notes',
    attachment_url: 'Attachment',
    created_at: 'Created At',
    updated_at: 'Updated At'
  }
};
