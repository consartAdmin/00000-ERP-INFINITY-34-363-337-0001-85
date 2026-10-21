// ╔════════════════════════════════════════════════════════════════════╗
// ║ proposalsConsart.schema.js — Propostas comerciais da Consart ERP   ║
// ║ Tabelas:                                                          ║
// ║   public."proposalsConsart"      → cabeçalho da proposta           ║
// ║   public."proposalsConsartItems" → itens (produto ou serviço)      ║
// ║ • Número = ano/sequência do ano (ex.: 2026/0012).                  ║
// ║ • Cliente vem de customersConsart; vendedor de sellersConsart.     ║
// ║ • Roda uma vez por boot (primeira chamada do repositório).         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."proposalsConsart"';
export const TB_ITEMS = 'public."proposalsConsartItems"';

let ready = null;

export function ensureProposalsConsartTables() {
  if (!ready) {
    ready = createTables().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB} (
      id               BIGSERIAL PRIMARY KEY,
      number_year      INTEGER NOT NULL,
      number_seq       INTEGER NOT NULL,
      issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
      valid_days       INTEGER NOT NULL DEFAULT 15,
      valid_until      DATE,
      status           VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
      title            VARCHAR(200) NOT NULL,
      customer_id      BIGINT,
      customer_name    VARCHAR(255),
      customer_tax_id  VARCHAR(32),
      contact_name     VARCHAR(200),
      seller_id        BIGINT,
      seller_name      VARCHAR(150),
      payment_method   VARCHAR(100),
      payment_terms    VARCHAR(255),
      delivery_time    VARCHAR(100),
      freight          VARCHAR(60),
      scope            TEXT,
      notes            TEXT,
      subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0,
      discount_total   NUMERIC(14,2) NOT NULL DEFAULT 0,
      total            NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_by       INTEGER,
      created_by_name  VARCHAR(150),
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "proposalsConsart_number_uk" UNIQUE (number_year, number_seq)
    );

    CREATE TABLE IF NOT EXISTS ${TB_ITEMS} (
      id               BIGSERIAL PRIMARY KEY,
      proposal_id      BIGINT NOT NULL REFERENCES ${TB}(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL DEFAULT 1,
      product_id       BIGINT,
      product_code     VARCHAR(60),
      description      TEXT NOT NULL,
      unit             VARCHAR(10),
      quantity         NUMERIC(14,4) NOT NULL DEFAULT 1,
      unit_price       NUMERIC(14,4) NOT NULL DEFAULT 0,
      discount_percent NUMERIC(7,4) NOT NULL DEFAULT 0,
      total            NUMERIC(14,2) NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS "proposalsConsart_customer_idx" ON ${TB} (customer_id);
    CREATE INDEX IF NOT EXISTS "proposalsConsart_issue_date_idx" ON ${TB} (issue_date);
    CREATE INDEX IF NOT EXISTS "proposalsConsartItems_proposal_idx" ON ${TB_ITEMS} (proposal_id);
  `);
}
