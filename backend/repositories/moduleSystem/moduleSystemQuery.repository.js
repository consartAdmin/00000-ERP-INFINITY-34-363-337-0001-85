// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemQuery.repository.js — list / findById                  ║
// ║ Tabela: public."moduleSystem"                                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import { TABLE } from './moduleSystem.constants.js';
import { q } from './moduleSystem.utils.js';

/**
 * Lista módulos.
 * Filtros:
 *  - onlyActive: true → só módulos ativos
 *  - search: termo do nome ou path
 */
export async function list({ onlyActive = false, search } = {}) {
  const where = [];
  const params = [];

  if (onlyActive) {
    where.push('is_active = true');
  }

  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length - 1} OR path ILIKE $${params.length})`);
  }

  const sql = `
    SELECT id, name, path, is_active, created_at, updated_at
    FROM ${TABLE}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id ASC;
  `;

  const { rows } = await q(sql, params);
  return rows;
}

/** Busca módulo por ID */
export async function findById(id) {
  const { rows } = await q(
    `
    SELECT id, name, path, is_active, created_at, updated_at
    FROM ${TABLE}
    WHERE id = $1;
  `,
    [Number(id)]
  );
  return rows[0] || null;
}
