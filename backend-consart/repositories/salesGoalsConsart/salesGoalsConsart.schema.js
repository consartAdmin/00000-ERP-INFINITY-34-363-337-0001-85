// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesGoalsConsart.schema.js — Metas de vendas (CONSART ERP)        ║
// ║ Tabela: public."salesGoalsConsart"                                 ║
// ║ • Uma linha por vendedor (sellersConsart) por mês/ano.             ║
// ║ • Duas metas: valor vendido (R$) e quantidade de propostas.        ║
// ║ • Roda uma vez por boot (primeira chamada do repositório).         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."salesGoalsConsart"';

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
      notes            VARCHAR(255),
      created_by       INTEGER,
      created_by_name  VARCHAR(150),
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "salesGoalsConsart_period_seller_uk" UNIQUE (goal_year, goal_month, seller_id)
    );
  `);
}
