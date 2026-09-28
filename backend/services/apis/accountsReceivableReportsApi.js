'use strict';

import pool from '../../config/db.js';

const TB_ORDERS = 'public."orders"';
const TB_RECEIVABLE = 'public."accountsReceivable"';
const TB_INVOICES = 'public."invoicesIssued"';
const TB_CUSTOMERS = 'public."customers"';

const ORDER_COLUMNS = {
  order_id: 's.order_id',
  issue_date: 's.issue_date',
  customer_name: 's.customer_name',
  total_amount: 's.sale_total',
  receivable_value: 's.receivable_value',
  received_value: 's.received_value',
  balance: 's.balance',
  due_date: 's.due_date',
  status: 's.reconciliation_status',
};

function positiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function filtersSql(filters = {}, startIndex = 1) {
  const clauses = [];
  const params = [];
  let index = startIndex;

  if (filters.fromDate) {
    clauses.push(`o.issue_date >= $${index++}`);
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    clauses.push(`o.issue_date <= $${index++}`);
    params.push(filters.toDate);
  }
  if (filters.customerId) {
    clauses.push(`o.customer_id = $${index++}`);
    params.push(filters.customerId);
  }
  if (filters.search) {
    clauses.push(`(
      o.customer_name ILIKE $${index}
      OR o.customer_tax_id ILIKE $${index}
      OR o.number::text ILIKE $${index}
      OR inv.nfe_number::text ILIKE $${index}
      OR ar.invoice_number ILIKE $${index}
      OR ar.document_number ILIKE $${index}
    )`);
    params.push(`%${filters.search}%`);
    index += 1;
  }
  if (filters.receivableStatus) {
    clauses.push(`UPPER(COALESCE(ar.status, 'SEM_CONTA')) = $${index++}`);
    params.push(String(filters.receivableStatus).toUpperCase());
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    nextIndex: index,
  };
}

function baseCte(whereSql, onlyDivergences = false) {
  return `
    WITH sales AS (
      SELECT
        o.order_id,
        o.number AS order_number,
        o.budget_id,
        o.issue_date,
        o.status AS order_status,
        o.customer_id,
        COALESCE(c.trade_name, o.customer_name) AS customer_name,
        o.customer_tax_id,
        COALESCE(o.total_amount, 0)::numeric AS sale_total,
        o.accounts_receivable_id,
        ar.invoice_number,
        ar.document_number,
        ar.issue_date AS receivable_issue_date,
        ar.due_date,
        ar.payment_date,
        ar.status AS receivable_status,
        COALESCE(ar.value, 0)::numeric AS receivable_value,
        COALESCE(ar.amount_paid, 0)::numeric AS received_value,
        GREATEST(COALESCE(ar.value, 0) - COALESCE(ar.amount_paid, 0), 0)::numeric AS balance,
        inv.invoice_id,
        inv.nfe_number,
        inv.nfe_key,
        inv.nfe_status,
        CASE
          WHEN o.accounts_receivable_id IS NULL OR ar.id IS NULL THEN 'SEM_CONTA'
          WHEN ABS(COALESCE(o.total_amount, 0) - COALESCE(ar.value, 0)) > 0.01 THEN 'DIVERGENTE'
          WHEN UPPER(COALESCE(ar.status, '')) = 'CANCELLED' THEN 'CANCELADA'
          WHEN COALESCE(ar.amount_paid, 0) >= COALESCE(ar.value, 0) AND COALESCE(ar.value, 0) > 0 THEN 'RECEBIDA'
          WHEN ar.due_date < CURRENT_DATE THEN 'VENCIDA'
          ELSE 'A_RECEBER'
        END AS reconciliation_status,
        (COALESCE(o.total_amount, 0) - COALESCE(ar.value, 0))::numeric AS difference
      FROM ${TB_ORDERS} o
      LEFT JOIN ${TB_RECEIVABLE} ar ON ar.id = o.accounts_receivable_id
      LEFT JOIN ${TB_CUSTOMERS} c ON c.customer_id = o.customer_id
      LEFT JOIN LATERAL (
        SELECT ii.*
        FROM ${TB_INVOICES} ii
        WHERE ii.order_id = o.order_id
           OR (ii.order_id IS NULL AND ii.budget_id = o.budget_id)
        ORDER BY ii.issued_at DESC NULLS LAST, ii.invoice_id DESC
        LIMIT 1
      ) inv ON TRUE
      ${whereSql}
    ), filtered AS (
      SELECT * FROM sales s
      ${onlyDivergences ? "WHERE s.reconciliation_status IN ('SEM_CONTA', 'DIVERGENTE')" : ''}
    )`;
}

export async function getSummary(filters = {}) {
  const filter = filtersSql(filters);
  const { rows } = await pool.query(`
    ${baseCte(filter.sql, filters.onlyDivergences)}
    SELECT
      COUNT(*)::integer AS sales_count,
      COUNT(*) FILTER (WHERE reconciliation_status = 'SEM_CONTA')::integer AS without_receivable_count,
      COUNT(*) FILTER (WHERE reconciliation_status = 'DIVERGENTE')::integer AS divergent_count,
      COALESCE(SUM(sale_total), 0)::numeric AS sales_total,
      COALESCE(SUM(receivable_value), 0)::numeric AS receivable_total,
      COALESCE(SUM(received_value), 0)::numeric AS received_total,
      COALESCE(SUM(balance), 0)::numeric AS outstanding_total,
      COALESCE(SUM(balance) FILTER (WHERE reconciliation_status = 'VENCIDA'), 0)::numeric AS overdue_total,
      COALESCE(SUM(difference), 0)::numeric AS difference_total
    FROM filtered;
  `, filter.params);
  return rows[0];
}

export async function listSales(filters = {}) {
  const page = positiveInt(filters.page, 1);
  const pageSize = positiveInt(filters.pageSize, 20, 200);
  const direction = String(filters.orderDirection).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderColumn = ORDER_COLUMNS[filters.orderBy] || ORDER_COLUMNS.issue_date;
  const filter = filtersSql(filters);
  const cte = baseCte(filter.sql, filters.onlyDivergences);
  const offset = (page - 1) * pageSize;

  const [dataResult, countResult] = await Promise.all([
    pool.query(`
      ${cte}
      SELECT * FROM filtered s
      ORDER BY ${orderColumn} ${direction}, s.order_id DESC
      LIMIT $${filter.nextIndex} OFFSET $${filter.nextIndex + 1};
    `, [...filter.params, pageSize, offset]),
    pool.query(`${cte} SELECT COUNT(*)::integer AS total FROM filtered;`, filter.params),
  ]);

  const total = Number(countResult.rows[0]?.total || 0);
  return { data: dataResult.rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listAllSales(filters = {}) {
  const filter = filtersSql(filters);
  const { rows } = await pool.query(`
    ${baseCte(filter.sql, filters.onlyDivergences)}
    SELECT * FROM filtered s ORDER BY s.issue_date DESC, s.order_id DESC;
  `, filter.params);
  return rows;
}
