// ╔════════════════════════════════════════════════════════════════════╗
// ║ productsFamiliesQuery.repository.js — listagem / buscar por ID     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, ALIAS, COLS } from './productsFamilies.constants.js';
import { toBool, notEmptyStr, sanitizeOrder, toIdOrNull, mapRow } from './productsFamilies.helpers.js';

const SELECT = `
  SELECT ${ALIAS}.${COLS.id}, ${ALIAS}.${COLS.name}, ${ALIAS}.${COLS.subgroup_id},
         ${ALIAS}.${COLS.created_at}, ${ALIAS}.${COLS.updated_at}, ${ALIAS}.${COLS.is_active},
         psg.name AS subgroup_name
    FROM public.${TB} ${ALIAS}
    LEFT JOIN public."productsSubgroups" psg ON psg.product_subgroup_id = ${ALIAS}.${COLS.subgroup_id}`;

export async function listProductsFamilies(params = {}) {
  const { q, subgroup_id, group_id, is_active, limit = 500, offset = 0, orderBy = COLS.name, dir = 'ASC' } = params;
  const { orderBy: ob, dir: od } = sanitizeOrder(orderBy, dir);
  const where = [];
  const values = [];
  let i = 1;

  if (notEmptyStr(q)) {
    where.push(`LOWER(${ALIAS}.${COLS.name}) LIKE LOWER($${i++})`);
    values.push(`%${q.trim()}%`);
  }
  const sid = toIdOrNull(subgroup_id);
  if (sid) {
    where.push(`${ALIAS}.${COLS.subgroup_id} = $${i++}`);
    values.push(sid);
  }
  const gid = toIdOrNull(group_id);
  if (gid) {
    where.push(`psg.group_id = $${i++}`);
    values.push(gid);
  }
  const activeBool = toBool(is_active);
  if (activeBool !== null) {
    where.push(`${ALIAS}.${COLS.is_active} = $${i++}`);
    values.push(activeBool);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const off = Math.max(Number(offset) || 0, 0);

  const [rowsRes, countRes] = await Promise.all([
    pool.query(`${SELECT} ${whereSql} ORDER BY ${ALIAS}.${ob} ${od} LIMIT $${i} OFFSET $${i + 1};`, [...values, lim, off]),
    pool.query(`SELECT COUNT(*)::INT AS total FROM public.${TB} ${ALIAS}
      LEFT JOIN public."productsSubgroups" psg ON psg.product_subgroup_id = ${ALIAS}.${COLS.subgroup_id} ${whereSql};`, values),
  ]);

  return { rows: rowsRes.rows.map(mapRow), total: countRes.rows[0]?.total ?? 0, limit: lim, offset: off };
}

export async function getProductsFamilyById(id) {
  const res = await pool.query(`${SELECT} WHERE ${ALIAS}.${COLS.id} = $1 LIMIT 1;`, [id]);
  return mapRow(res.rows[0]);
}
