// ╔════════════════════════════════════════════════════════════════════╗
// ║ contractsConsart.schema.js — Contratos de Serviços (CONSART ERP)   ║
// ║ Tabelas:                                                           ║
// ║   public."contractsConsart"        → cabeçalho                     ║
// ║   public."contractsConsartItems"   → serviços contratados          ║
// ║   public."contractsConsartClauses" → cláusulas (editáveis)         ║
// ║ • Número = ano/sequência do ano (ex.: 2026/0003), próprio.         ║
// ║ • Pode nascer de uma Proposta de Serviços aprovada (proposal_id).  ║
// ║ • Cliente vem de customersConsart; vendedor de sellersConsart.     ║
// ║ • Itens RECORRENTE (mensalidade) ou UNICA (implantação): totais    ║
// ║   separados em recurring_total / one_time_total.                   ║
// ║ • Roda uma vez por boot (primeira chamada do repositório).         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."contractsConsart"';
export const TB_ITEMS = 'public."contractsConsartItems"';
export const TB_CLAUSES = 'public."contractsConsartClauses"';

let ready = null;

export function ensureContractsConsartTables() {
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
      id                  BIGSERIAL PRIMARY KEY,
      number_year         INTEGER NOT NULL,
      number_seq          INTEGER NOT NULL,
      issue_date          DATE NOT NULL DEFAULT CURRENT_DATE,
      status              VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
      title               VARCHAR(200) NOT NULL,
      proposal_id         BIGINT,
      proposal_number     VARCHAR(20),
      customer_id         BIGINT,
      customer_name       VARCHAR(255),
      customer_tax_id     VARCHAR(32),
      contact_name        VARCHAR(200),
      seller_id           BIGINT,
      seller_name         VARCHAR(150),
      start_date          DATE,
      term_months         INTEGER NOT NULL DEFAULT 12,
      end_date            DATE,
      auto_renew          BOOLEAN NOT NULL DEFAULT FALSE,
      billing_type        VARCHAR(20) NOT NULL DEFAULT 'MENSAL',
      payment_method      VARCHAR(100),
      payment_terms       VARCHAR(255),
      due_day             INTEGER,
      readjustment_index  VARCHAR(60),
      execution_place     VARCHAR(255),
      delivery_time       VARCHAR(100),
      forum_city          VARCHAR(120),
      signing_city        VARCHAR(120),
      signing_date        DATE,
      object              TEXT,
      notes               TEXT,
      subtotal            NUMERIC(14,2) NOT NULL DEFAULT 0,
      discount_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
      total               NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_by          INTEGER,
      created_by_name     VARCHAR(150),
      created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "contractsConsart_number_uk" UNIQUE (number_year, number_seq)
    );

    CREATE TABLE IF NOT EXISTS ${TB_ITEMS} (
      id               BIGSERIAL PRIMARY KEY,
      contract_id      BIGINT NOT NULL REFERENCES ${TB}(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL DEFAULT 1,
      service_id       BIGINT,
      service_code     VARCHAR(60),
      description      TEXT NOT NULL,
      unit             VARCHAR(10),
      quantity         NUMERIC(14,4) NOT NULL DEFAULT 1,
      unit_price       NUMERIC(14,4) NOT NULL DEFAULT 0,
      discount_percent NUMERIC(7,4) NOT NULL DEFAULT 0,
      total            NUMERIC(14,2) NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${TB_CLAUSES} (
      id           BIGSERIAL PRIMARY KEY,
      contract_id  BIGINT NOT NULL REFERENCES ${TB}(id) ON DELETE CASCADE,
      position     INTEGER NOT NULL DEFAULT 1,
      title        VARCHAR(200) NOT NULL,
      body         TEXT NOT NULL DEFAULT ''
    );

    -- Cobrança por item: RECORRENTE (segue a cobrança do contrato) ou UNICA (implantação/setup)
    ALTER TABLE ${TB_ITEMS} ADD COLUMN IF NOT EXISTS charge_type VARCHAR(12) NOT NULL DEFAULT 'RECORRENTE';
    ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS recurring_total NUMERIC(14,2);
    ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS one_time_total NUMERIC(14,2) NOT NULL DEFAULT 0;
    UPDATE ${TB} SET recurring_total = total WHERE recurring_total IS NULL;

    CREATE INDEX IF NOT EXISTS "contractsConsart_customer_idx" ON ${TB} (customer_id);
    CREATE INDEX IF NOT EXISTS "contractsConsart_proposal_idx" ON ${TB} (proposal_id);
    CREATE INDEX IF NOT EXISTS "contractsConsart_issue_date_idx" ON ${TB} (issue_date);
    CREATE INDEX IF NOT EXISTS "contractsConsartItems_contract_idx" ON ${TB_ITEMS} (contract_id);
    CREATE INDEX IF NOT EXISTS "contractsConsartClauses_contract_idx" ON ${TB_CLAUSES} (contract_id);
  `);
}
