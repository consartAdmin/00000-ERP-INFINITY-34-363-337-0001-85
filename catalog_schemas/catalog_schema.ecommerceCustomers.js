// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.ecommerceCustomers.js                                     ║
// ║ DDL — Define and ensures the table: public."ecommerceCustomers"          ║
// ║ CONSART ERP | BH3 SUPPLY — E-commerce Module                             ║
// ║                                                                          ║
// ║ - Cria a tabela caso não exista                                          ║
// ║ - Cria índices necessários                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../config/db.js';

export async function ensureEcommerceCustomersTable(client = pool) {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS public."ecommerceCustomers" (
      id                  BIGSERIAL PRIMARY KEY,

      -- Basic info
      full_name           VARCHAR(255) NOT NULL,
      email               VARCHAR(255) NOT NULL UNIQUE,
      phone               VARCHAR(30),

      -- Document / legal
      document_number     VARCHAR(20),
      person_type         VARCHAR(10),
      state_registration  VARCHAR(30),

      -- Address
      address_zip         VARCHAR(15),
      address_street      VARCHAR(255),
      address_number      VARCHAR(30),
      address_complement  VARCHAR(120),
      address_district    VARCHAR(120),
      address_city        VARCHAR(120),
      address_state       VARCHAR(2),

      -- Authentication
      password_hash       TEXT NOT NULL,
      last_login_at       TIMESTAMP,

      -- Status
      is_active           BOOLEAN DEFAULT TRUE,

      created_at          TIMESTAMP DEFAULT NOW(),
      updated_at          TIMESTAMP DEFAULT NOW()
    );
  `;

  const createIndexSQL = `
    CREATE INDEX IF NOT EXISTS idx_ecommerceCustomers_email
    ON public."ecommerceCustomers" (LOWER(email));
  `;

  await client.query(createTableSQL);
  await client.query(createIndexSQL);

  console.log('[catalog_schema.ecommerceCustomers] ensured.');
}

export default {
  ensureEcommerceCustomersTable,
};
