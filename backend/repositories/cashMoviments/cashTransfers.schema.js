// ╔════════════════════════════════════════════════════════════════════╗
// ║ cashTransfers.schema.js — Transferências entre contas do Caixa     ║
// ║ Uma transferência = SAIDA na origem + ENTRADA no destino           ║
// ║ Tabela: "cashTransfers"                                            ║
// ║ Coluna: "cashMoviments".transfer_id (as duas pontas)               ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

let schemaReady = null;

export function ensureTransfersSchema() {
  schemaReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS "cashTransfers" (
      id BIGSERIAL PRIMARY KEY,
      transfer_date TIMESTAMP NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      from_bank_account_id BIGINT NULL,
      from_account VARCHAR(50) NOT NULL,
      to_bank_account_id BIGINT NULL,
      to_account VARCHAR(50) NOT NULL,
      notes TEXT NULL,
      fee_movement_id BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE "cashMoviments"
      ADD COLUMN IF NOT EXISTS transfer_id BIGINT NULL
        REFERENCES "cashTransfers"(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS "cashMoviments_transfer_idx"
      ON "cashMoviments" (transfer_id);
  `).catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}
