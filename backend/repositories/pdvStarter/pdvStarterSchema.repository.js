// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarterSchema.repository.js — ensureSchema                       ║
// ║ pdvSales / pdvSalesItems já existem no banco da BH3: só criamos se  ║
// ║ faltarem e acrescentamos as colunas novas (ADD COLUMN IF NOT EXISTS)║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import {
  TB_SALES,
  TB_SALES_ITEMS,
  TB_CASH_SESSIONS,
  TB_CASH_MOVEMENTS,
} from './pdvStarter.constants.js';

const SALES_COLUMNS = [
  ['created_at', 'TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()'],
  ['customer_name', 'TEXT'],
  ['recebido', 'NUMERIC(14,2)'],
  ['troco', 'NUMERIC(14,2)'],
  ['status', 'VARCHAR(20)'],
  ['id_integracao', 'TEXT'],
  ['nfce_id', 'TEXT'],
  ['nfce_key', 'TEXT'],
  ['nfce_number', 'TEXT'],
  ['nfce_protocol', 'TEXT'],
  ['nfce_status', 'TEXT'],
  ['nfce_pdf_url', 'TEXT'],
  ['nfce_xml_url', 'TEXT'],
  // Colunas novas do Consart Starter
  ['pdv_uuid', 'VARCHAR(64)'],
  ['pdv_origin', 'VARCHAR(30)'],
  ['session_id', 'INTEGER'],
  ['terminal', 'VARCHAR(40)'],
  ['operator_id', 'INTEGER'],
  ['operator_name', 'VARCHAR(120)'],
  ['customer_doc', 'VARCHAR(20)'],
  ['subtotal', 'NUMERIC(14,2)'],
  ['discount', 'NUMERIC(14,2)'],
  ['total', 'NUMERIC(14,2)'],
  ['payments', 'JSONB'],
  ['sold_at', 'TIMESTAMP WITHOUT TIME ZONE'],
  ['synced_at', 'TIMESTAMP WITHOUT TIME ZONE'],
  ['stock_status', 'VARCHAR(20)'],
  ['stock_details', 'JSONB'],
  ['canceled_at', 'TIMESTAMP WITHOUT TIME ZONE'],
  ['cancel_reason', 'TEXT'],
];

const ITEMS_COLUMNS = [
  ['sale_id', 'BIGINT'],
  ['quantity', 'NUMERIC(14,3)'],
  ['product_code', 'VARCHAR(50)'],
  ['description', 'TEXT'],
  ['barcode', 'VARCHAR(100)'],
  ['unit', 'VARCHAR(10)'],
  ['unit_factor', 'NUMERIC(14,3)'],
  ['unit_price', 'NUMERIC(14,2)'],
  ['discount', 'NUMERIC(14,2)'],
  ['total', 'NUMERIC(14,2)'],
  ['item_number', 'INTEGER'],
];

async function addColumns(table, columns) {
  for (const [name, type] of columns) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "${name}" ${type}`);
  }
}

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_SALES} (
      sale_id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
  await addColumns(TB_SALES, SALES_COLUMNS);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pdvsales_pdv_uuid
      ON ${TB_SALES} (pdv_uuid) WHERE pdv_uuid IS NOT NULL
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pdvsales_session ON ${TB_SALES} (session_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_SALES_ITEMS} (
      item_id BIGSERIAL PRIMARY KEY,
      sale_id BIGINT
    )
  `);
  await addColumns(TB_SALES_ITEMS, ITEMS_COLUMNS);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pdvsalesitems_sale ON ${TB_SALES_ITEMS} (sale_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_CASH_SESSIONS} (
      session_id SERIAL PRIMARY KEY,
      terminal VARCHAR(40) NOT NULL,
      operator_id INTEGER,
      operator_name VARCHAR(120),
      opened_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      opening_amount NUMERIC(14,2) DEFAULT 0,
      opening_notes TEXT,
      status VARCHAR(10) DEFAULT 'ABERTO',
      closed_at TIMESTAMP WITHOUT TIME ZONE,
      closed_by_id INTEGER,
      closed_by_name VARCHAR(120),
      expected JSONB,
      counted JSONB,
      difference NUMERIC(14,2),
      closing_notes TEXT
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pdvcash_terminal_open
      ON ${TB_CASH_SESSIONS} (terminal) WHERE status = 'ABERTO'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_CASH_MOVEMENTS} (
      movement_id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES ${TB_CASH_SESSIONS} (session_id),
      movement_type VARCHAR(12) NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      reason TEXT,
      operator_id INTEGER,
      operator_name VARCHAR(120),
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
}

/*
 * A coluna sale_id pode ter vindo de outro programa (sem DEFAULT ou com
 * outro tipo). Descobre como gerar o id uma única vez por processo.
 */
let saleIdStrategy = null;

export async function resolveSaleIdStrategy() {
  if (saleIdStrategy) return saleIdStrategy;

  const { rows } = await pool.query(`
    SELECT data_type, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pdvSales' AND column_name = 'sale_id'
  `);
  const col = rows[0] || {};
  const numeric = ['integer', 'bigint', 'numeric', 'smallint'].includes(col.data_type);

  if (col.column_default) saleIdStrategy = 'DEFAULT';
  else if (numeric) saleIdStrategy = 'MAX_PLUS_ONE';
  else saleIdStrategy = 'UUID';

  return saleIdStrategy;
}
