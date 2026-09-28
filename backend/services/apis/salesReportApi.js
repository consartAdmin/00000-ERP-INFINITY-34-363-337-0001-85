// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesReportApi.js — Service/DAL Relatório de Vendas (ESM)          ║
// ║ CONSART ERP | PostgreSQL                                           ║
// ║ Fonte oficial do faturamento: public."invoicesIssued"              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';
import invoicesIssuedApi from '../../repositories/invoicesIssued/invoicesIssued.index.js';

const TB_INVOICES = 'public."invoicesIssued"';
const TB_ORDERS = 'public."orders"';
const TB_ORDER_ITEMS = 'public."ordersItems"';
const TB_BUDGET_ITEMS = 'public."budgetsItems"';
const TB_PRODUCTS = 'public."products"';
const TB_BUDGETS = 'public."budgets"';
const TB_SELLER_BY_BUDGETS = 'public."sellerByBudgets"';
const TB_NFE_STATUS_MAP = 'public."nfeStatusMap"';

const NFE_VALIDAS = Object.freeze([
  'CONCLUIDO', 'CONCLUÍDO', 'CONCLUIDA', 'CONCLUÍDA',
  'AUTORIZADA', 'AUTORIZADO', 'EMITIDA', 'EMITIDO',
  'APROVADA', 'APROVADO', 'FINALIZADA', 'FINALIZADO',
  'AUTHORIZED', 'APPROVED', 'ISSUED',
]);

const NFE_EXCLUIR = Object.freeze([
  'CANCELADA', 'CANCELADO', 'CANCELLED', 'CANCELED',
  'DENIED', 'DENEGADA', 'DENEGADO',
  'REJEITADA', 'REJEITADO', 'REJECTED',
]);

const UNIT_FACTOR_SQL = `
  COALESCE(NULLIF(oi.conversion_factor, 0), 1)
`;

const NFE_STATUS_SQL = `
  UPPER(TRIM(COALESCE(
    nsm.code,
    to_jsonb(ii) ->> 'nfe_status',
    to_jsonb(ii) ->> 'nfe_status_code',
    to_jsonb(ii) ->> 'status',
    ''
  )))
`;

const ISSUED_DATE_SQL = `
  COALESCE(
    NULLIF(to_jsonb(ii) ->> 'issued_date', '')::date,
    NULLIF(to_jsonb(ii) ->> 'issued_at', '')::timestamptz::date
  )
`;

function normalizeCostMode(value) {
  return value === 'saleDay' ? 'saleDay' : 'current';
}

function costUnitPerItemSql(costMode = 'current') {
  if (normalizeCostMode(costMode) === 'saleDay') {
    return `
      COALESCE(
        CASE
          WHEN COALESCE(to_jsonb(oi) ->> 'cost_price_at_sale', '')
            ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (to_jsonb(oi) ->> 'cost_price_at_sale')::numeric
          ELSE NULL
        END,
        p.cost_price * ${UNIT_FACTOR_SQL},
        0
      )
    `;
  }

  return `COALESCE(p.cost_price * ${UNIT_FACTOR_SQL}, 0)`;
}

function baseFrom() {
  return `
    FROM ${TB_INVOICES} ii
    LEFT JOIN ${TB_ORDERS} o
      ON o.order_id = ii.order_id
    LEFT JOIN ${TB_BUDGETS} b
      ON b.budget_id = COALESCE(ii.budget_id, o.budget_id)
    LEFT JOIN ${TB_NFE_STATUS_MAP} nsm
      ON nsm.nfe_status_id = ii.nfe_status_id
  `;
}

function invoiceItemsLateral(invoiceAlias = 'ii', joinType = 'JOIN') {
  return `
    ${joinType} LATERAL (
      SELECT
        oi_order.product_code,
        oi_order.description,
        oi_order.unit_code,
        oi_order.conversion_factor,
        oi_order.quantity,
        oi_order.unit_price,
        oi_order.discount_value,
        to_jsonb(oi_order) ->> 'cost_price_at_sale' AS cost_price_at_sale
      FROM ${TB_ORDER_ITEMS} oi_order
      WHERE oi_order.order_id = ${invoiceAlias}.order_id

      UNION ALL

      SELECT
        bi.product_code,
        bi.description,
        bi.unit_code,
        bi.conversion_factor,
        bi.quantity,
        bi.unit_price,
        bi.discount_value,
        to_jsonb(bi) ->> 'cost_price_at_sale' AS cost_price_at_sale
      FROM ${TB_BUDGET_ITEMS} bi
      WHERE bi.budget_id = ${invoiceAlias}.budget_id
    ) oi ON TRUE
  `;
}

function buildWhere(filters = {}) {
  const where = [
    '(ii.order_id IS NOT NULL OR ii.budget_id IS NOT NULL)',
    `${ISSUED_DATE_SQL} IS NOT NULL`,
    `NULLIF(to_jsonb(ii) ->> 'cancelled_at', '') IS NULL`,
  ];
  const params = [];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const validParam = addParam(NFE_VALIDAS);
  const excludedParam = addParam(NFE_EXCLUIR);

  // Algumas versões da invoicesIssued guardam apenas nfe_status_id.
  // Nesses casos, uma chave/protocolo presente e ausência de cancelamento
  // identificam a NF-e fiscalmente emitida sem depender do texto do status.
  where.push(`(
    COALESCE(nsm.is_authorized, false) = true
    OR ${NFE_STATUS_SQL} = ANY(${validParam}::text[])
    OR (
      ${NFE_STATUS_SQL} = ''
      AND COALESCE(
        NULLIF(to_jsonb(ii) ->> 'nfe_key', ''),
        NULLIF(to_jsonb(ii) ->> 'access_key', ''),
        NULLIF(to_jsonb(ii) ->> 'nfe_protocol', ''),
        NULLIF(to_jsonb(ii) ->> 'protocol', '')
      ) IS NOT NULL
    )
  )`);
  where.push(`${NFE_STATUS_SQL} <> ALL(${excludedParam}::text[])`);

  if (filters.dateStart) {
    where.push(`${ISSUED_DATE_SQL} >= ${addParam(filters.dateStart)}::date`);
  }

  if (filters.dateEnd) {
    where.push(`${ISSUED_DATE_SQL} <= ${addParam(filters.dateEnd)}::date`);
  }

  if (filters.customerId) {
    where.push(`COALESCE(o.customer_id, b.customer_id) = ${addParam(filters.customerId)}::int`);
  }

  if (filters.sellerId) {
    const sellerParam = addParam(filters.sellerId);
    where.push(`
      COALESCE(
        NULLIF(regexp_replace(b.seller_id::text, '[^0-9]', '', 'g'), '')::int,
        (
          SELECT NULLIF(
            regexp_replace(sb.seller_id::text, '[^0-9]', '', 'g'),
            '',
            'g'
          )::int
          FROM ${TB_SELLER_BY_BUDGETS} sb
          WHERE sb.budget_id = b.budget_id
            AND COALESCE(sb.active, true) = true
          ORDER BY sb.seller_id
          LIMIT 1
        )
      ) = ${sellerParam}::int
    `);
  }

  return {
    whereSql: `WHERE ${where.join('\n AND ')}`,
    params,
  };
}

function buildProductWhere(filters = {}, params = []) {
  if (!filters.productId) {
    return { productWhereSql: '', params };
  }

  const value = `%${String(filters.productId).trim()}%`;
  params.push(value);
  const placeholder = `$${params.length}`;

  return {
    productWhereSql: `
      AND (
        oi.product_code::text ILIKE ${placeholder}
        OR COALESCE(oi.description, p.description, '') ILIKE ${placeholder}
      )
    `,
    params,
  };
}

export async function getSalesSummary(filters = {}) {
  const { whereSql, params } = buildWhere(filters);
  const cost = costUnitPerItemSql(filters.costMode);

  const sql = `
    WITH invoice_base AS (
      SELECT
        ii.invoice_id,
        ii.order_id,
        ii.budget_id,
        COALESCE(ii.total_amount, 0) AS invoice_total
      ${baseFrom()}
      ${whereSql}
    ),
    cost_base AS (
      SELECT
        ib.invoice_id,
        COALESCE(SUM(COALESCE(oi.quantity, 0)), 0) AS total_items,
        COALESCE(SUM(COALESCE(oi.quantity, 0) * (${cost})), 0) AS total_cost
      FROM invoice_base ib
      ${invoiceItemsLateral('ib', 'LEFT JOIN')}
      LEFT JOIN ${TB_PRODUCTS} p
        ON TRIM(p.product_code::text) = TRIM(oi.product_code::text)
      GROUP BY ib.invoice_id
    )
    SELECT
      COUNT(DISTINCT ib.invoice_id) AS orders_count,
      COALESCE(SUM(cb.total_items), 0) AS total_items,
      COALESCE(SUM(ib.invoice_total), 0) AS total_amount,
      COALESCE(SUM(cb.total_cost), 0) AS total_cost,
      COALESCE(SUM(ib.invoice_total), 0) - COALESCE(SUM(cb.total_cost), 0) AS gross_profit
    FROM invoice_base ib
    LEFT JOIN cost_base cb
      ON cb.invoice_id = ib.invoice_id;
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0] || {};
}

export async function getSalesByDay(filters = {}) {
  const { whereSql, params } = buildWhere(filters);
  const sql = `
    SELECT
      ${ISSUED_DATE_SQL} AS day,
      COUNT(DISTINCT ii.invoice_id) AS orders_count,
      COALESCE(SUM((
        SELECT SUM(item_quantity)
        FROM (
          SELECT COALESCE(oi_order.quantity, 0) AS item_quantity
          FROM ${TB_ORDER_ITEMS} oi_order
          WHERE oi_order.order_id = ii.order_id
          UNION ALL
          SELECT COALESCE(bi.quantity, 0) AS item_quantity
          FROM ${TB_BUDGET_ITEMS} bi
          WHERE bi.budget_id = ii.budget_id
        ) invoice_quantities
      )), 0) AS total_items,
      COALESCE(SUM(ii.total_amount), 0) AS total_amount
    ${baseFrom()}
    ${whereSql}
    GROUP BY ${ISSUED_DATE_SQL}
    ORDER BY day ASC;
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getSalesByCustomer(filters = {}) {
  const { whereSql, params } = buildWhere(filters);
  const sql = `
    SELECT
      COALESCE(o.customer_id, b.customer_id) AS customer_id,
      COALESCE(o.customer_name, b.customer_name, ii.customer_name, '') AS customer_name,
      COUNT(DISTINCT ii.invoice_id) AS orders_count,
      COALESCE(SUM(ii.total_amount), 0) AS total_amount
    ${baseFrom()}
    ${whereSql}
    GROUP BY
      COALESCE(o.customer_id, b.customer_id),
      COALESCE(o.customer_name, b.customer_name, ii.customer_name, '')
    ORDER BY total_amount DESC, customer_name ASC;
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getSalesByProduct(filters = {}) {
  const { whereSql, params: baseParams } = buildWhere(filters);
  const { productWhereSql, params } = buildProductWhere(filters, baseParams);
  const cost = costUnitPerItemSql(filters.costMode);

  const sql = `
    SELECT
      oi.product_code AS product_sku,
      COALESCE(oi.description, p.description, '') AS product_description,
      NULLIF(UPPER(TRIM(oi.unit_code)), '') AS product_unit,
      COALESCE(SUM(oi.quantity), 0) AS total_items,
      COALESCE(SUM(
        COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)
        - COALESCE(oi.discount_value, 0)
      ), 0) AS total_amount,
      COALESCE(SUM(COALESCE(oi.quantity, 0) * (${cost})), 0) AS total_cost,
      COALESCE(SUM(
        COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)
        - COALESCE(oi.discount_value, 0)
      ), 0) - COALESCE(SUM(COALESCE(oi.quantity, 0) * (${cost})), 0) AS gross_profit,
      COALESCE(AVG(oi.unit_price), 0) AS avg_unit_price,
      CASE
        WHEN COALESCE(SUM(oi.quantity), 0) > 0
        THEN COALESCE(SUM(COALESCE(oi.quantity, 0) * (${cost})), 0) / SUM(oi.quantity)
        ELSE 0
      END AS avg_unit_cost
    ${baseFrom()}
    ${invoiceItemsLateral('ii', 'JOIN')}
    LEFT JOIN ${TB_PRODUCTS} p
      ON TRIM(p.product_code::text) = TRIM(oi.product_code::text)
    ${whereSql}
    ${productWhereSql}
    GROUP BY
      oi.product_code,
      COALESCE(oi.description, p.description, ''),
      NULLIF(UPPER(TRIM(oi.unit_code)), '')
    ORDER BY total_amount DESC, product_sku ASC;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getSalesOrders(filters = {}) {
  const { whereSql, params } = buildWhere(filters);
  const cost = costUnitPerItemSql(filters.costMode);

  const sql = `
    WITH cost_base AS (
      SELECT
        ii_cost.invoice_id,
        COALESCE(SUM(COALESCE(oi.quantity, 0)), 0) AS total_items,
        COALESCE(SUM(COALESCE(oi.quantity, 0) * (${cost})), 0) AS total_cost
      FROM ${TB_INVOICES} ii_cost
      ${invoiceItemsLateral('ii_cost', 'LEFT JOIN')}
      LEFT JOIN ${TB_PRODUCTS} p
        ON TRIM(p.product_code::text) = TRIM(oi.product_code::text)
      GROUP BY ii_cost.invoice_id
    )
    SELECT
      ii.invoice_id,
      COALESCE(ii.order_id, ii.budget_id) AS order_id,
      ii.order_id AS original_order_id,
      ii.budget_id,
      COALESCE(
        ii.source_type,
        CASE WHEN ii.budget_id IS NOT NULL THEN 'BUDGET' ELSE 'ORDER' END
      ) AS source_type,
      ii.nfe_number,
      ii.nfe_key,
      ${NFE_STATUS_SQL} AS nfe_status,
      ${ISSUED_DATE_SQL} AS issued_date,
      COALESCE(ii.total_amount, 0) AS total_amount,
      COALESCE(ii.order_id, ii.budget_id)::text AS order_number,
      COALESCE(o.customer_name, b.customer_name, ii.customer_name, '') AS customer_name,
      COALESCE(o.customer_tax_id, b.customer_tax_id, ii.customer_tax_id) AS customer_tax_id,
      COALESCE(cb.total_items, 0) AS total_items,
      COALESCE(cb.total_cost, 0) AS total_cost,
      COALESCE(ii.total_amount, 0) - COALESCE(cb.total_cost, 0) AS gross_profit
    ${baseFrom()}
    LEFT JOIN cost_base cb
      ON cb.invoice_id = ii.invoice_id
    ${whereSql}
    ORDER BY ${ISSUED_DATE_SQL} ASC, ii.invoice_id ASC;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getSalesOrderItems(orderId, filters = {}) {
  const parsedOrderId = Number.parseInt(orderId, 10);
  if (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0) {
    throw new TypeError('orderId inválido.');
  }

  const cost = costUnitPerItemSql(filters.costMode);
  const sql = `
    WITH invoice_items AS (
      SELECT
        oi_order.order_item_id::text AS item_id,
        oi_order.order_id,
        NULL::bigint AS budget_id,
        oi_order.product_code,
        oi_order.description,
        oi_order.unit_code,
        oi_order.conversion_factor,
        oi_order.quantity,
        oi_order.unit_price,
        oi_order.discount_value,
        to_jsonb(oi_order) ->> 'cost_price_at_sale' AS cost_price_at_sale
      FROM ${TB_ORDER_ITEMS} oi_order
      WHERE oi_order.order_id = $1

      UNION ALL

      SELECT
        bi.budget_item_id::text AS item_id,
        NULL::bigint AS order_id,
        bi.budget_id,
        bi.product_code,
        bi.description,
        bi.unit_code,
        bi.conversion_factor,
        bi.quantity,
        bi.unit_price,
        bi.discount_value,
        to_jsonb(bi) ->> 'cost_price_at_sale' AS cost_price_at_sale
      FROM ${TB_BUDGET_ITEMS} bi
      WHERE bi.budget_id = $1
    )
    SELECT
      oi.item_id AS order_item_id,
      COALESCE(oi.order_id, oi.budget_id) AS order_id,
      oi.budget_id,
      oi.product_code AS sku,
      COALESCE(oi.description, p.description, '') AS description,
      oi.unit_code AS unit,
      COALESCE(oi.quantity, 0) AS quantity,
      COALESCE(oi.unit_price, 0) AS unit_price,
      COALESCE(oi.discount_value, 0) AS discount_value,
      (${cost}) AS unit_cost,
      COALESCE(oi.quantity, 0) * (${cost}) AS total_cost,
      COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)
        - COALESCE(oi.discount_value, 0) AS total_amount,
      COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)
        - COALESCE(oi.discount_value, 0)
        - COALESCE(oi.quantity, 0) * (${cost}) AS gross_profit
    FROM invoice_items oi
    LEFT JOIN ${TB_PRODUCTS} p
      ON TRIM(p.product_code::text) = TRIM(oi.product_code::text)
    ORDER BY oi.item_id ASC;
  `;

  const { rows } = await pool.query(sql, [parsedOrderId]);
  return rows;
}

export async function getFullSalesReport(filters = {}) {
  await invoicesIssuedApi.ensureTable();

  const [summary, byDay, byCustomer, byProduct, orders] = await Promise.all([
    getSalesSummary(filters),
    getSalesByDay(filters),
    getSalesByCustomer(filters),
    getSalesByProduct(filters),
    getSalesOrders(filters),
  ]);

  return { summary, byDay, byCustomer, byProduct, orders };
}

export default {
  getSalesSummary,
  getSalesByDay,
  getSalesByCustomer,
  getSalesByProduct,
  getSalesOrders,
  getSalesOrderItems,
  getFullSalesReport,
};
