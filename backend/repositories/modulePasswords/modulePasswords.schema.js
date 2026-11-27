// ╔════════════════════════════════════════════════════════════════════╗
// ║ modulePasswords.schema.js — DDL de public."modulePasswords"        ║
// ║ Idempotente.                                                       ║
// ╚════════════════════════════════════════════════════════════════════╝

import bcrypt from 'bcryptjs';
import { TB, BCRYPT_ROUNDS } from './modulePasswords.constants.js';
import { MODULE_PASSWORDS_CATALOG } from './modulePasswords.catalog.js';

/**
 * Cria tabela, índices e as linhas do catálogo.
 * Recebe um `client` já dentro de uma transação.
 */
export async function ensureModulePasswordsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TB} (
      module_password_id  SERIAL        PRIMARY KEY,
      module_code         VARCHAR(60)   NOT NULL,
      action_code         VARCHAR(60)   NOT NULL,
      description         VARCHAR(255),
      password_hash       TEXT,
      is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
      updated_by          INTEGER,
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_modulePasswords_module_action
      ON ${TB} (module_code, action_code);
  `);

  // Linhas do catálogo (sem senha → usa o fallback do .env até ser definida).
  // Itens com `seed_from_env` nascem com a senha atual do .env, para não
  // mudar o comportamento de quem já usava a chave fixa.
  for (const item of MODULE_PASSWORDS_CATALOG) {
    const { rows } = await client.query(
      `SELECT 1 FROM ${TB} WHERE module_code = $1 AND action_code = $2`,
      [item.module_code, item.action_code]
    );
    if (rows.length) continue;

    let passwordHash = null;
    let isActive = true;
    if (item.seed_from_env) {
      const envValue = String(process.env[item.seed_from_env] ?? '').trim();
      if (envValue) passwordHash = await bcrypt.hash(envValue, BCRYPT_ROUNDS);
    }
    if (item.seed_enabled_env) {
      isActive = String(process.env[item.seed_enabled_env] ?? 'true').trim().toLowerCase() !== 'false';
    }

    await client.query(
      `INSERT INTO ${TB} (module_code, action_code, description, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (module_code, action_code) DO NOTHING`,
      [item.module_code, item.action_code, item.description, passwordHash, isActive]
    );
  }
}
