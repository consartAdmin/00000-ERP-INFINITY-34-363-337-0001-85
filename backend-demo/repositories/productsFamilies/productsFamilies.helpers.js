// ╔════════════════════════════════════════════════════════════════════╗
// ║ productsFamilies.helpers.js — validação, mapeamento e erros        ║
// ╚════════════════════════════════════════════════════════════════════╝

import { COLS, ORDERABLE } from './productsFamilies.constants.js';

export const toBool = (v) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null);
export const notEmptyStr = (s) => typeof s === 'string' && s.trim().length > 0;
export const uniqueViolation = (err) => err && err.code === '23505';

export function toIdOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function sanitizeOrder(orderBy = COLS.name, dir = 'ASC') {
  const safeCol = ORDERABLE.has(orderBy) ? orderBy : COLS.name;
  const safeDir = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return { orderBy: safeCol, dir: safeDir };
}

export function mapRow(r) {
  if (!r) return null;
  return {
    product_family_id: r.product_family_id,
    name: r.name,
    subgroup_id: r.subgroup_id,
    subgroup_name: r.subgroup_name ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    is_active: r.is_active,
  };
}

export function httpError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}
