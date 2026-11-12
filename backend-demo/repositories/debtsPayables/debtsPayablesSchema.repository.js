// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtsPayablesSchema.repository.js — vínculo título ↔ parcela       ║
// ║ "accountsPayable".debt_id + debt_installment_number (único)        ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_DEBTS, TB_PAYABLE } from './debtsPayables.constants.js';

let ready = null;

export function ensureDebtPayableColumns() {
  ready ??= (async () => {
    await pool.query(`
      ALTER TABLE ${TB_PAYABLE}
        ADD COLUMN IF NOT EXISTS debt_id integer,
        ADD COLUMN IF NOT EXISTS debt_installment_number integer
    `);
    // Compromisso excluído → títulos dele saem junto
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_accountspayable_debt'
        ) THEN
          ALTER TABLE ${TB_PAYABLE}
            ADD CONSTRAINT fk_accountspayable_debt
            FOREIGN KEY (debt_id) REFERENCES ${TB_DEBTS}(id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_accountspayable_debt_installment
        ON ${TB_PAYABLE} (debt_id, debt_installment_number)
        WHERE debt_id IS NOT NULL
    `);
  })().catch((error) => {
    ready = null;
    throw error;
  });

  return ready;
}
