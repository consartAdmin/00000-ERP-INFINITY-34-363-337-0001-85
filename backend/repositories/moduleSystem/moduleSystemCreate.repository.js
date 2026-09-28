// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemCreate.repository.js — create                          ║
// ║ Tabela: public."moduleSystem"                                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { TABLE } from './moduleSystem.constants.js';
import { q } from './moduleSystem.utils.js';

/** Cria novo módulo */
export async function create({ name, path, is_active = true }) {
  const { rows } = await q(
    `
    INSERT INTO ${TABLE} (name, path, is_active)
    VALUES ($1, $2, $3)
    RETURNING id, name, path, is_active, created_at, updated_at;
  `,
    [name, path, !!is_active]
  );
  return rows[0];
}
