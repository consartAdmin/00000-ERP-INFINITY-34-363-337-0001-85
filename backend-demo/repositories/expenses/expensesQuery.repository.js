// ╔════════════════════════════════════════════════════════════════════╗
// ║ expensesQuery.repository.js — listExpenses / countExpenses /       ║
// ║ getExpenseById · Tabela: public."Expenses"                         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB } from './expenses.constants.js';
import { toInt } from './expenses.utils.js';
import { safeOrderBy, buildWhere } from './expenses.sql.js';
import { ensureCashCategoryColumns } from '../cashCategories/cashCategoryLink.repository.js';

// Categoria/Subcategoria do Caixa (IDs + nome da subcategoria).
// Se as colunas ainda não existirem no banco, devolve NULL (a tela não quebra).
function cashColumnsSql({ columns, subcategories } = {}) {
  if (!columns) {
    return `
      NULL::integer AS "cash_category_id",
      NULL::integer AS "cash_subcategory_id",
      NULL::text AS "cash_subcategory_name",`;
  }
  const subName = subcategories
    // a coluna do nome é "name" no banco (alguns ambientes antigos usam "nome")
    ? `(SELECT COALESCE(to_jsonb(s)->>'name', to_jsonb(s)->>'nome')
          FROM "cashSubcategories" s WHERE s.id = ${TB}."cash_subcategory_id")`
    : 'NULL::text';
  return `
      "cash_category_id",
      "cash_subcategory_id",
      ${subName} AS "cash_subcategory_name",`;
}

export async function listExpenses(query = {}) {
  const cashColumns = cashColumnsSql(await ensureCashCategoryColumns(TB));
  const limit  = Math.min(Math.max(toInt(query.limit, 20), 1), 200);
  const offset = Math.max(toInt(query.offset, 0), 0);
  const orderBy = safeOrderBy(query.order_by, query.sort, query.dir);

  const { sql: whereSql, params } = buildWhere(query);

  // 1) Rows (paginado)
  const qRows = `
    SELECT
      "id",
      "expense_id",
      "name",
      "description",
      "value",
      "due_date",
      "competence_month",
      "competence_year",
      "category",
      ${cashColumns}
      "cost_center",
      "vendor",
      "recurrence_type",
      "status",
      "paid_date",
      "payment_method",
      "account_payable_id",
      "payload",
      "is_active",
      "created_at",
      "updated_at"
    FROM ${TB}
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2};
  `;

  // 2) Total (COUNT)
  const qCount = `
    SELECT COUNT(*)::bigint AS total
    FROM ${TB}
    ${whereSql};
  `;

  // 3) Total Value (SUM)
  const qSum = `
    SELECT COALESCE(SUM("value"), 0)::numeric AS total_value
    FROM ${TB}
    ${whereSql};
  `;

  // Executa em paralelo (mais rápido)
  const [rRows, rCount, rSum] = await Promise.all([
    pool.query(qRows, [...params, limit, offset]),
    pool.query(qCount, params),
    pool.query(qSum, params),
  ]);

  return {
    rows: rRows.rows || [],
    total: Number(rCount.rows?.[0]?.total || 0),
    total_value: rSum.rows?.[0]?.total_value ?? '0',
    limit,
    offset,
  };
}

export async function countExpenses(query = {}) {
  const { sql: whereSql, params } = buildWhere(query);

  const q = `
    SELECT COUNT(*)::bigint AS total
    FROM ${TB}
    ${whereSql};
  `;

  const { rows } = await pool.query(q, params);
  return Number(rows?.[0]?.total || 0);
}

export async function getExpenseById(id) {
  const cashColumns = cashColumnsSql(await ensureCashCategoryColumns(TB));
  const q = `
    SELECT
      "id",
      "expense_id",
      "name",
      "description",
      "value",
      "due_date",
      "competence_month",
      "competence_year",
      "category",
      ${cashColumns}
      "cost_center",
      "vendor",
      "recurrence_type",
      "status",
      "paid_date",
      "payment_method",
      "account_payable_id",
      "payload",
      "is_active",
      "created_at",
      "updated_at"
    FROM ${TB}
    WHERE "id" = $1;
  `;
  const { rows } = await pool.query(q, [id]);
  return rows[0] || null;
}

/**
 * Lista para exportação (Excel): mesmos filtros e ordem da tela, sem
 * paginação, com limite de segurança.
 */
export async function listExpensesForExport(query = {}, maxRows = 5000) {
  const cashColumns = cashColumnsSql(await ensureCashCategoryColumns(TB));
  const orderBy = safeOrderBy(query.order_by, query.sort, query.dir);
  const { sql: whereSql, params } = buildWhere(query);

  const q = `
    SELECT
      "id",
      "expense_id",
      "name",
      "description",
      "value",
      "due_date",
      "competence_month",
      "competence_year",
      "category",
      ${cashColumns}
      "cost_center",
      "vendor",
      "recurrence_type",
      "status",
      "paid_date",
      "payment_method",
      "created_at",
      "updated_at"
    FROM ${TB}
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${params.length + 1};
  `;

  const { rows } = await pool.query(q, [...params, maxRows]);
  return rows || [];
}
