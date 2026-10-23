// ╔════════════════════════════════════════════════════════════════════╗
// ║ accountsPayableQuery.repository.js — list / getById / getBySource  ║
// ║ Tabela: public."accountsPayable"                                   ║
// ╚════════════════════════════════════════════════════════════════════╝

import { SCHEMA, TB_FULL, TB_ATTACH } from './accountsPayable.constants.js';
import { q } from './accountsPayable.utils.js';
import { parseOrder } from './accountsPayable.sql.js';
import { payableGroupSql, parseGroups } from './accountsPayable.groups.js';

const GROUP_SQL = payableGroupSql();

const BASE_JOINS = `
    LEFT JOIN ${SCHEMA}.suppliers s
      ON s.supplier_id = ap.supplier_id
    LEFT JOIN ${SCHEMA}."paymentMethods" pm
      ON pm."paymentMethods_id" = ap.payment_method_id
    LEFT JOIN ${SCHEMA}."cashCategories" ec
      ON ec.id = ap.category_id
    LEFT JOIN ${SCHEMA}."cashSubcategories" esc
      ON esc.id = ap.subcategory_id
    LEFT JOIN ${SCHEMA}."cashCategories" sc
      ON sc.id = s.cash_category_id
`;

export async function list({
  page = 1,
  pageSize = 20,
  search,
  status,
  supplierId,
  fromDueDate,
  toDueDate,
  month,
  year,
  groups,
  orderBy
} = {}) {
  const limit = Math.max(1, Math.min(Number(pageSize) || 20, 200));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const where = [];
  const params = [];
  let idx = 1;

  if (search) {
    where.push(`(
      ap.invoice_number     ILIKE $${idx}
      OR ap.description     ILIKE $${idx}
      OR s.name             ILIKE $${idx}
      OR ap.document_number ILIKE $${idx}
      OR ap.notes           ILIKE $${idx}
    )`);
    params.push(`%${String(search).trim()}%`);
    idx++;
  }

  if (status) {
    where.push(`ap.status = $${idx}`);
    params.push(String(status).trim());
    idx++;
  }

  if (supplierId != null && supplierId !== '') {
    where.push(`ap.supplier_id = $${idx}`);
    params.push(Number(supplierId));
    idx++;
  }

  if (fromDueDate) {
    where.push(`ap.due_date >= $${idx}`);
    params.push(fromDueDate);
    idx++;
  }

  if (toDueDate) {
    where.push(`ap.due_date <= $${idx}`);
    params.push(toDueDate);
    idx++;
  }

  if (month != null && month !== '') {
    where.push(`EXTRACT(MONTH FROM ap.due_date)::int = $${idx}`);
    params.push(Number(month));
    idx++;
  }

  if (year != null && year !== '') {
    where.push(`EXTRACT(YEAR FROM ap.due_date)::int = $${idx}`);
    params.push(Number(year));
    idx++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = parseOrder(orderBy);

  // Grupo resolvido numa subconsulta para o filtro e a contagem por grupo
  const baseFrom = `
    FROM (
      SELECT ap.*, ${GROUP_SQL} AS payable_group,
             s.name   AS supplier_name,
             pm.name  AS payment_method_name,
             ec.name  AS category_name,
             esc.name AS subcategory_name
      FROM ${TB_FULL} ap
      ${BASE_JOINS}
      ${whereSql}
    ) ap
  `;

  const groupList = parseGroups(groups);
  const groupWhere = groupList.length ? `WHERE ap.payable_group = ANY($${idx}::text[])` : '';
  const listParams = groupList.length ? [...params, groupList] : params;

  const countSql = `
    SELECT COUNT(*) AS total
    ${baseFrom}
    ${groupWhere}
  `;

  const groupCountSql = `
    SELECT ap.payable_group, COUNT(*)::integer AS total
    ${baseFrom}
    GROUP BY ap.payable_group
  `;

  const dataSql = `
    SELECT
      ap.*,
      COALESCE(att.attachments_count, 0) AS attachments_count
    ${baseFrom}
    LEFT JOIN (
      SELECT account_payable_id, COUNT(*)::integer AS attachments_count
      FROM ${TB_ATTACH}
      WHERE is_active = TRUE
      GROUP BY account_payable_id
    ) att
      ON att.account_payable_id = ap.id
    ${groupWhere}
    ${orderSql}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countRes, dataRes, groupRes] = await Promise.all([
    q(countSql, listParams),
    q(dataSql, listParams),
    q(groupCountSql, params)
  ]);

  const groupCounts = {};
  for (const r of groupRes.rows) groupCounts[r.payable_group] = r.total;

  const total = Number(countRes.rows[0]?.total || 0);

  return {
    ok: true,
    total,
    page: currentPage,
    pageSize: limit,
    groupCounts,
    rows: dataRes.rows
  };
}

export async function getById(id) {
  const sql = `
    SELECT
      ap.*,
      s.name   AS supplier_name,
      pm.name  AS payment_method_name,
      ec.name  AS category_name,
      esc.name AS subcategory_name,
      ${GROUP_SQL} AS payable_group,
      COALESCE(att.attachments_count, 0) AS attachments_count
    FROM ${TB_FULL} ap
    ${BASE_JOINS}
    LEFT JOIN (
      SELECT account_payable_id, COUNT(*)::integer AS attachments_count
      FROM ${TB_ATTACH}
      WHERE is_active = TRUE
      GROUP BY account_payable_id
    ) att
      ON att.account_payable_id = ap.id
    WHERE ap.id = $1
  `;

  const res = await q(sql, [id]);
  if (!res.rowCount) return null;
  return res.rows[0];
}

export async function getBySource(source_type, source_id) {
  const sql = `
    SELECT *
    FROM ${TB_FULL}
    WHERE source_type = $1
      AND source_id = $2
    LIMIT 1
  `;

  const res = await q(sql, [source_type, source_id]);
  return res.rows[0] || null;
}
