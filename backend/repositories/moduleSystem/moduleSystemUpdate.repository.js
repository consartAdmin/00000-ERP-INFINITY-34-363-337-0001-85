// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemUpdate.repository.js — update                          ║
// ║ Tabela: public."moduleSystem"                                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { TABLE } from './moduleSystem.constants.js';
import { q } from './moduleSystem.utils.js';
import { findById } from './moduleSystemQuery.repository.js';

/** Atualiza módulo por ID */
export async function update(id, { name, path, is_active }) {
  const fields = [];
  const params = [];
  let idx = 1;

  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    params.push(name);
  }
  if (path !== undefined) {
    fields.push(`path = $${idx++}`);
    params.push(path);
  }
  if (is_active !== undefined) {
    fields.push(`is_active = $${idx++}`);
    params.push(!!is_active);
  }

  if (!fields.length) {
    // nada para atualizar
    return findById(id);
  }

  params.push(Number(id));

  const sql = `
    UPDATE ${TABLE}
    SET ${fields.join(', ')},
        updated_at = now()
    WHERE id = $${params.length}
    RETURNING id, name, path, is_active, created_at, updated_at;
  `;

  const { rows } = await q(sql, params);
  return rows[0] || null;
}
