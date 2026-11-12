// ╔════════════════════════════════════════════════════════════════════╗
// ║ productsFamiliesWrite.repository.js — criar / atualizar / excluir  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, COLS, SELECT_COLS } from './productsFamilies.constants.js';
import { notEmptyStr, uniqueViolation, toIdOrNull, mapRow, httpError } from './productsFamilies.helpers.js';

function duplicateError(name) {
  return httpError(`Já existe uma família "${name}" neste subgrupo.`, 409);
}

export async function createProductsFamily(payload = {}) {
  const name = notEmptyStr(payload.name) ? payload.name.trim() : '';
  const subgroupId = toIdOrNull(payload.subgroup_id ?? payload.product_subgroup_id);
  if (!name) throw httpError('O campo "name" é obrigatório.');
  if (!subgroupId) throw httpError('Selecione o subgrupo da família.');

  try {
    const res = await pool.query(
      `INSERT INTO public.${TB} (${COLS.name}, ${COLS.subgroup_id}, ${COLS.is_active})
       VALUES ($1, $2, COALESCE($3, TRUE))
       RETURNING ${SELECT_COLS};`,
      [name, subgroupId, payload.is_active ?? true],
    );
    return mapRow(res.rows[0]);
  } catch (err) {
    if (uniqueViolation(err)) throw duplicateError(name);
    throw err;
  }
}

export async function updateProductsFamily(id, patch = {}) {
  const sets = [];
  const values = [];
  let i = 1;

  if (patch.name !== undefined) {
    if (!notEmptyStr(patch.name)) throw httpError('O campo "name" não pode ser vazio.');
    sets.push(`${COLS.name} = $${i++}`); values.push(patch.name.trim());
  }
  const rawSub = patch.subgroup_id ?? patch.product_subgroup_id;
  if (rawSub !== undefined) {
    const sid = toIdOrNull(rawSub);
    if (!sid) throw httpError('Selecione o subgrupo da família.');
    sets.push(`${COLS.subgroup_id} = $${i++}`); values.push(sid);
  }
  if (patch.is_active !== undefined) {
    sets.push(`${COLS.is_active} = $${i++}`); values.push(!!patch.is_active);
  }
  if (!sets.length) throw httpError('Nada para atualizar.');

  values.push(id);
  try {
    const res = await pool.query(
      `UPDATE public.${TB}
          SET ${sets.join(', ')}, ${COLS.updated_at} = NOW()
        WHERE ${COLS.id} = $${i}
      RETURNING ${SELECT_COLS};`,
      values,
    );
    return mapRow(res.rows[0]);
  } catch (err) {
    if (uniqueViolation(err)) throw duplicateError(String(patch.name ?? '').trim());
    throw err;
  }
}

/** Exclui a família e solta o vínculo dos produtos que a usavam. */
export async function deleteProductsFamily(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE public."products" SET product_family_id = NULL WHERE product_family_id = $1;', [id]);
    const res = await client.query(`DELETE FROM public.${TB} WHERE ${COLS.id} = $1 RETURNING ${COLS.id};`, [id]);
    await client.query('COMMIT');
    return res.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
