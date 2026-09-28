// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsLocationsRemove.repository.js — remove (DELETE físico)       ║
// ║ Tabela: public."productsLocations"                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB } from './productsLocations.constants.js';
import { normalizeRow } from './productsLocations.mappers.js';

export async function remove(id) {
  // aqui não precisa join
  const { rows } = await pool.query(
    `DELETE FROM ${TB}
      WHERE id = $1
      RETURNING *;`,
    [id]
  );
  return rows[0] ? normalizeRow(rows[0]) : null;
}
