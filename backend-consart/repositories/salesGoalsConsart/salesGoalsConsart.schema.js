// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesGoalsConsart.schema.js — Metas de vendas (CONSART ERP)        ║
// ║ Tabelas:                                                           ║
// ║   public."salesGoalsConsart"       → meta por vendedor/mês         ║
// ║   public."salesGoalsStatesConsart" → plano por estado (UF)/mês     ║
// ║ • Vendedor (sellersConsart): valor vendido, propostas aprovadas,   ║
// ║   propostas enviadas, leads contatados, conversões no CRM e        ║
// ║   mensalidade de contratos assinados.                              ║
// ║ • Estado: leads contatados, conversões e valor vendido.            ║
// ║ • Roda uma vez por boot (primeira chamada do repositório).         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."salesGoalsConsart"';
export const TB_STATES = 'public."salesGoalsStatesConsart"';

let ready = null;

export function ensureSalesGoalsConsartTable() {
  if (!ready) {
    ready = createTable().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function createTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB} (
      id               BIGSERIAL PRIMARY KEY,
      goal_year        INTEGER NOT NULL,
      goal_month       INTEGER NOT NULL CHECK (goal_month BETWEEN 1 AND 12),
      seller_id        BIGINT NOT NULL,
      goal_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
      goal_count       INTEGER NOT NULL DEFAULT 0,
      goal_leads       INTEGER NOT NULL DEFAULT 0,
      notes            VARCHAR(255),
      created_by       INTEGER,
      created_by_name  VARCHAR(150),
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "salesGoalsConsart_period_seller_uk" UNIQUE (goal_year, goal_month, seller_id)
    );

    ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS goal_leads       INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS goal_sent        INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS goal_conversions INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS goal_recurring   NUMERIC(14,2) NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS ${TB_STATES} (
      id               BIGSERIAL PRIMARY KEY,
      goal_year        INTEGER NOT NULL,
      goal_month       INTEGER NOT NULL CHECK (goal_month BETWEEN 1 AND 12),
      state            VARCHAR(2) NOT NULL,
      goal_leads       INTEGER NOT NULL DEFAULT 0,
      goal_conversions INTEGER NOT NULL DEFAULT 0,
      goal_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes            VARCHAR(255),
      created_by       INTEGER,
      created_by_name  VARCHAR(150),
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "salesGoalsStatesConsart_period_state_uk" UNIQUE (goal_year, goal_month, state)
    );
  `);
}
