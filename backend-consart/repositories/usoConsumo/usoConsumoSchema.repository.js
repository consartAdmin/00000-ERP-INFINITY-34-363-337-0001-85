// ╔════════════════════════════════════════════════════════════════════╗
// ║ usoConsumoSchema.repository.js — Ajustes de schema (lazy)          ║
// ║ Uso e Consumo sem orçamento: rascunho, data, lote e fator da U.M   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_USO, TB_USO_ITEMS } from './usoConsumo.constants.js';

let ensured = null;

async function dropStatusChecks(client) {
  // Um CHECK antigo em status (ex.: só FINALIZADO) bloquearia o RASCUNHO.
  const { rows } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public."usoConsumo"'::regclass
      AND contype = 'c'
  `);

  for (const row of rows) {
    const def = String(row.def || '');
    if (/status/i.test(def) && !/RASCUNHO/i.test(def)) {
      await client.query(`ALTER TABLE ${TB_USO} DROP CONSTRAINT "${row.conname.replace(/"/g, '""')}"`);
    }
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE ${TB_USO} ALTER COLUMN budget_id DROP NOT NULL`);
    await client.query(`
      ALTER TABLE ${TB_USO}
        ADD COLUMN IF NOT EXISTS movement_date DATE,
        ADD COLUMN IF NOT EXISTS employee_department_id BIGINT,
        ADD COLUMN IF NOT EXISTS employee_id BIGINT,
        ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'ORCAMENTO',
        ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);
    await client.query(`ALTER TABLE ${TB_USO_ITEMS} ALTER COLUMN budget_item_id DROP NOT NULL`);
    await client.query(`
      ALTER TABLE ${TB_USO_ITEMS}
        ADD COLUMN IF NOT EXISTS lot_id BIGINT,
        ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(14,4) DEFAULT 1,
        ADD COLUMN IF NOT EXISTS expires_at DATE
    `);
    await dropStatusChecks(client);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "usoConsumo_budget_id_idx"
        ON ${TB_USO} (budget_id)
    `);
  } finally {
    client.release();
  }
}

export function ensureUsoConsumoSchema() {
  if (!ensured) {
    ensured = run().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
}
