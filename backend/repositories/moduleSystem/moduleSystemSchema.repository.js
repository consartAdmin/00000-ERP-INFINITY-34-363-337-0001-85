// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemSchema.repository.js — ensureTable (idempotente)       ║
// ║ Tabela: public."moduleSystem"                                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { TABLE } from './moduleSystem.constants.js';
import { q } from './moduleSystem.utils.js';

/** Garante que a tabela exista e esteja com colunas atualizadas (idempotente) */
export async function ensureTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id         BIGSERIAL     PRIMARY KEY,
      name       VARCHAR(100)  NOT NULL,
      path       VARCHAR(200)  NOT NULL,
      is_active  BOOLEAN       NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
    );
  `);

  // Ajustes de compatibilidade (caso venha de versões antigas)
  await q(`
    ALTER TABLE ${TABLE}
      ADD COLUMN IF NOT EXISTS name       VARCHAR(100),
      ADD COLUMN IF NOT EXISTS path       VARCHAR(200),
      ADD COLUMN IF NOT EXISTS is_active  BOOLEAN       NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ   NOT NULL DEFAULT now();
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_moduleSystem_name
      ON ${TABLE}(name);
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS idx_moduleSystem_is_active
      ON ${TABLE}(is_active);
  `);
}
