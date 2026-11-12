// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemUpdate.repository.js — update                          ║
// ║ Tabela: public."moduleSystem"                                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { TABLE, COLUMNS } from './moduleSystem.constants.js';
import { q } from './moduleSystem.utils.js';
import { findById } from './moduleSystemQuery.repository.js';

// Campos que podem ser atualizados (os booleanos são convertidos com !!)
const UPDATABLE = Object.freeze([
  'name', 'path', 'is_active', 'menu_type', 'parent_id', 'sort_order',
  'html_id', 'css_class', 'feature', 'is_external', 'is_public', 'company',
]);
const BOOLEANS = new Set(['is_active', 'is_external', 'is_public']);

/** Campos que a alteração em lote pode mudar */
const BATCH_UPDATABLE = Object.freeze(['is_active', 'company']);

/**
 * Atualiza vários módulos de uma vez (alteração em lote da tela).
 * Só mexe em is_active e company; devolve as linhas alteradas.
 */
export async function updateMany(ids, payload = {}) {
  const fields = [];
  const params = [];

  BATCH_UPDATABLE.forEach((column) => {
    if (payload[column] === undefined) return;
    params.push(BOOLEANS.has(column) ? !!payload[column] : payload[column]);
    fields.push(`${column} = $${params.length}`);
  });
  if (!fields.length || !ids.length) return [];

  params.push(ids.map(Number));
  const { rows } = await q(
    `
    UPDATE ${TABLE}
    SET ${fields.join(', ')},
        updated_at = now()
    WHERE id = ANY($${params.length}::bigint[])
    RETURNING ${COLUMNS};
  `,
    params
  );
  return rows;
}

/** Atualiza módulo por ID (só os campos presentes no payload) */
export async function update(id, payload = {}) {
  const fields = [];
  const params = [];

  UPDATABLE.forEach((column) => {
    if (payload[column] === undefined) return;
    params.push(BOOLEANS.has(column) ? !!payload[column] : payload[column]);
    fields.push(`${column} = $${params.length}`);
  });

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
    RETURNING ${COLUMNS};
  `;

  const { rows } = await q(sql, params);
  return rows[0] || null;
}
