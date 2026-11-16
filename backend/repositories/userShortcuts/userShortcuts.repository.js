// ╔════════════════════════════════════════════════════════════════════╗
// ║ userShortcuts.repository.js — atalhos de teclado de cada usuário   ║
// ║ Tabela: public."userShortcuts" (criada na primeira chamada)        ║
// ║ - Cada usuário tem os seus atalhos (Ctrl + letra) usados na Home   ║
// ║ - Exclusão é lógica (is_deleted) para os padrões não voltarem      ║
// ║ - Na primeira vez que o usuário abre, recebe os atalhos padrão     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TABLE = 'public."userShortcuts"';

// Ações que a Home sabe executar
export const SHORTCUT_ACTIONS = Object.freeze({
  open_module: 'Abrir módulo',
  product_search: 'Buscar produto',
  customer_search: 'Buscar cliente',
});

// Teclas que não podem ser usadas:
// N, T, W → o navegador não deixa a página interceptar
// K → busca do menu (global) · A, X, V → selecionar/recortar/colar
// R → recarregar · P → imprimir · S → salvar · L → barra de endereço · F → localizar
export const BLOCKED_KEYS = Object.freeze(['A', 'F', 'K', 'L', 'N', 'P', 'R', 'S', 'T', 'V', 'W', 'X']);

export const ALLOWED_KEYS = Object.freeze(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((k) => !BLOCKED_KEYS.includes(k))
);

// Atalhos que já existiam na Home (viram os registros iniciais de cada usuário)
const DEFAULT_SHORTCUTS = [
  { key: 'Z', action: 'product_search', href: null, path: null, label: 'Buscar produto' },
  { key: 'C', action: 'customer_search', href: null, path: null, label: 'Buscar cliente' },
  { key: 'B', action: 'open_module', href: '/public/budgets/budgets.html', path: 'Orçamentos', label: 'Abrir Orçamentos' },
  { key: 'I', action: 'open_module', href: '/public/inventory/inventory.html', path: 'Inventário de Produtos', label: 'Abrir Inventário' },
];

const COLUMNS = `
  id, user_id, key_char, action, module_href, module_path, label, is_active, created_at, updated_at
`;

let ensured = null;

export function ensureUserShortcutsTable() {
  if (!ensured) {
    ensured = pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER      NOT NULL,
        key_char    CHAR(1)      NOT NULL,
        action      VARCHAR(30)  NOT NULL,
        module_href TEXT,
        module_path TEXT,
        label       VARCHAR(60)  NOT NULL,
        is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
        is_deleted  BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_userShortcuts_user_id ON ${TABLE} (user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_userShortcuts_user_key
        ON ${TABLE} (user_id, key_char) WHERE is_deleted = FALSE;
    `).catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

// Primeira vez do usuário (nenhuma linha, nem excluída): grava os padrões
async function seedDefaultsIfNew(userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM ${TABLE} WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (rows.length) return;

  for (const d of DEFAULT_SHORTCUTS) {
    await pool.query(
      `
        INSERT INTO ${TABLE} (user_id, key_char, action, module_href, module_path, label)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `,
      [userId, d.key, d.action, d.href, d.path, d.label]
    );
  }
}

export async function listUserShortcuts(userId, { onlyActive = false } = {}) {
  await ensureUserShortcutsTable();
  await seedDefaultsIfNew(userId);

  const { rows } = await pool.query(
    `
      SELECT ${COLUMNS}
      FROM ${TABLE}
      WHERE user_id = $1
        AND is_deleted = FALSE
        ${onlyActive ? 'AND is_active = TRUE' : ''}
      ORDER BY key_char ASC
    `,
    [userId]
  );
  return rows;
}

export async function findActiveByKey(userId, keyChar, exceptId = null) {
  const { rows } = await pool.query(
    `
      SELECT ${COLUMNS}
      FROM ${TABLE}
      WHERE user_id = $1
        AND key_char = $2
        AND is_deleted = FALSE
        AND ($3::int IS NULL OR id <> $3::int)
      LIMIT 1
    `,
    [userId, keyChar, exceptId]
  );
  return rows[0] || null;
}

export async function insertUserShortcut(userId, data) {
  await ensureUserShortcutsTable();
  const { rows } = await pool.query(
    `
      INSERT INTO ${TABLE} (user_id, key_char, action, module_href, module_path, label, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING ${COLUMNS}
    `,
    [userId, data.key_char, data.action, data.module_href, data.module_path, data.label, data.is_active]
  );
  return rows[0];
}

export async function updateUserShortcut(userId, id, data) {
  await ensureUserShortcutsTable();
  const { rows } = await pool.query(
    `
      UPDATE ${TABLE}
      SET key_char = $3, action = $4, module_href = $5, module_path = $6,
          label = $7, is_active = $8, updated_at = NOW()
      WHERE id = $2 AND user_id = $1 AND is_deleted = FALSE
      RETURNING ${COLUMNS}
    `,
    [userId, id, data.key_char, data.action, data.module_href, data.module_path, data.label, data.is_active]
  );
  return rows[0] || null;
}

export async function setUserShortcutActive(userId, id, isActive) {
  await ensureUserShortcutsTable();
  const { rows } = await pool.query(
    `
      UPDATE ${TABLE}
      SET is_active = $3, updated_at = NOW()
      WHERE id = $2 AND user_id = $1 AND is_deleted = FALSE
      RETURNING ${COLUMNS}
    `,
    [userId, id, isActive]
  );
  return rows[0] || null;
}

export async function deleteUserShortcut(userId, id) {
  await ensureUserShortcutsTable();
  const result = await pool.query(
    `
      UPDATE ${TABLE}
      SET is_deleted = TRUE, is_active = FALSE, updated_at = NOW()
      WHERE id = $2 AND user_id = $1 AND is_deleted = FALSE
    `,
    [userId, id]
  );
  return result.rowCount > 0;
}
