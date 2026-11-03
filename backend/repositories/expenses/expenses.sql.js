// ╔════════════════════════════════════════════════════════════════════╗
// ║ expenses.sql.js — ORDER BY seguro e WHERE dinâmico                 ║
// ╚════════════════════════════════════════════════════════════════════╝

import { normalizeBool } from './expenses.utils.js';

/**
 * Colunas que o cabeçalho da tabela (sortableTable) pode ordenar.
 * Chave = valor de ?sort=, valor = coluna SQL.
 */
const SORT_COLUMNS = new Map([
  ['id', '"id"'],
  ['name', '"name"'],
  ['category', '"category"'],
  ['vendor', '"vendor"'],
  ['value', '"value"'],
  ['due_date', '"due_date"'],
  ['status', '"status"'],
  ['created_at', '"created_at"'],
  ['updated_at', '"updated_at"'],
]);

/**
 * ORDER BY a partir de ?sort=&dir= (whitelist). Retorna null se a coluna
 * não for permitida, para cair no order_by antigo.
 */
export function sortOrderBy(sort, dir) {
  const column = SORT_COLUMNS.get(String(sort || '').trim().toLowerCase());
  if (!column) return null;
  const direction = String(dir || '').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${column} ${direction} NULLS LAST, "id" ${direction}`;
}

/** Permite apenas ORDER BY seguro (sort/dir tem prioridade sobre order_by) */
export function safeOrderBy(input, sort, dir) {
  const bySort = sortOrderBy(sort, dir);
  if (bySort) return bySort;

  const allowed = new Map([
    ['created_at_desc', '"created_at" DESC'],
    ['created_at_asc', '"created_at" ASC'],
    ['due_date_desc', '"due_date" DESC'],
    ['due_date_asc', '"due_date" ASC'],
    ['updated_at_desc', '"updated_at" DESC'],
    ['updated_at_asc', '"updated_at" ASC'],
    ['value_desc', '"value" DESC'],
    ['value_asc', '"value" ASC'],
    ['name_asc', '"name" ASC'],
    ['name_desc', '"name" DESC'],
  ]);
  return allowed.get(String(input || '').toLowerCase()) || '"created_at" DESC';
}

/** Monta WHERE dinâmico com parâmetros */
export function buildWhere(filters = {}) {
  const where = [];
  const params = [];
  let i = 1;

  // Busca geral (name/description/expense_id/vendor/category)
  if (filters.q) {
    params.push(`%${String(filters.q).trim()}%`);
    where.push(`(
      "name" ILIKE $${i}
      OR COALESCE("description",'') ILIKE $${i}
      OR COALESCE("expense_id",'') ILIKE $${i}
      OR COALESCE("vendor",'') ILIKE $${i}
      OR COALESCE("category",'') ILIKE $${i}
    )`);
    i++;
  }

  if (filters.name) {
    params.push(`%${String(filters.name).trim()}%`);
    where.push(`"name" ILIKE $${i++}`);
  }

  if (filters.status) {
    params.push(String(filters.status).trim().toUpperCase());
    where.push(`"status" = $${i++}`);
  }

  if (filters.category) {
    params.push(String(filters.category).trim());
    where.push(`"category" = $${i++}`);
  }

  if (filters.vendor) {
    params.push(String(filters.vendor).trim());
    where.push(`"vendor" = $${i++}`);
  }

  const isActive = normalizeBool(filters.is_active);
  if (isActive !== undefined) {
    params.push(isActive);
    where.push(`"is_active" = $${i++}`);
  }

  if (filters.date_from) {
    params.push(filters.date_from);
    where.push(`"due_date" >= $${i++}::date`);
  }

  if (filters.date_to) {
    params.push(filters.date_to);
    where.push(`"due_date" <= $${i++}::date`);
  }

  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { sql, params };
}
