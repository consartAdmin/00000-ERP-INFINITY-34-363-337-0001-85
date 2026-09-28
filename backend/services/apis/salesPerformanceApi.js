// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: salesPerformanceApi.js                                        ║
// ║ MODULE: Sales Performance                                           ║
// ║ CONSART ERP                                                         ║
// ║ SOURCE: crmDealsReativationActions + crmDeals                       ║
// ║ STATUS CARDS: customerStatusTypes                                   ║
// ║ SELLERS FILTER: public.sellers                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

/* ======================================================================
   TABLES
   ====================================================================== */

const TB_ACTIONS = 'public."crmDealsReativationActions"';
const TB_DEALS = 'public."crmDeals"';
const TB_OUTCOMES = 'public."crmDealsOutcomes"';
const TB_STATUS_TYPES = 'public."customerStatusTypes"';
const TB_SELLERS = 'public."sellers"';

/* ======================================================================
   HELPERS
   ====================================================================== */

function isValidDateString(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
}

function normalizeDateRange(inicio, fim) {
  return {
    inicio: isValidDateString(inicio) ? `${inicio} 00:00:00` : null,
    fim: isValidDateString(fim) ? `${fim} 23:59:59.999` : null
  };
}

function splitResponsaveis(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : raw != null && raw !== ''
      ? [raw]
      : [];

  const values = arr
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);

  const ids = [];
  const nomes = [];

  for (const item of values) {
    if (/^\d+$/.test(item)) ids.push(Number(item));
    else nomes.push(item.toUpperCase());
  }

  return { ids, nomes };
}

function pushDateFilters(whereParts, params, inicio, fim, columnName = 'a.created_at') {
  const range = normalizeDateRange(inicio, fim);

  if (range.inicio) {
    params.push(range.inicio);
    whereParts.push(`${columnName} >= $${params.length}`);
  }

  if (range.fim) {
    params.push(range.fim);
    whereParts.push(`${columnName} <= $${params.length}`);
  }
}

function pushSellerFilters(whereParts, params, responsaveis, alias = 'a') {
  const { ids, nomes } = splitResponsaveis(responsaveis);
  const local = [];

  if (ids.length) {
    params.push(ids);
    local.push(`${alias}.seller_id = ANY($${params.length}::bigint[])`);
  }

  if (nomes.length) {
    params.push(nomes);
    local.push(`UPPER(TRIM(COALESCE(${alias}.seller_name, ''))) = ANY($${params.length}::text[])`);
  }

  if (local.length) {
    whereParts.push(`(${local.join(' OR ')})`);
  }
}

function buildWhere(whereParts) {
  return whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
}

function buildActionJoinFilters({ params, inicio, fim, responsaveis, alias = 'a' }) {
  const joinParts = [];

  pushDateFilters(joinParts, params, inicio, fim, `${alias}.created_at`);
  pushSellerFilters(joinParts, params, responsaveis, alias);

  return joinParts.length ? ` AND ${joinParts.join(' AND ')}` : '';
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/* ======================================================================
   SELLERS
   ====================================================================== */

export async function listSalesPerformanceSellers() {
  const sql = `
    SELECT
      s.id,
      s.name AS nome
    FROM ${TB_SELLERS} s
    WHERE COALESCE(s.active, true) = true
    ORDER BY s.name ASC
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

/* ======================================================================
   STATUS TYPES
   ====================================================================== */

export async function listSalesPerformanceStatusTypes() {
  const sql = `
    SELECT
      st.id,
      st.name_pt,
      st.internal_code,
      st.description_en,
      st.color_hex,
      st.sort_order,
      st.is_active
    FROM ${TB_STATUS_TYPES} st
    WHERE st.is_active = true
    ORDER BY st.sort_order ASC, st.name_pt ASC
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

/* ======================================================================
   MOVEMENTS
   ====================================================================== */

export async function listSalesPerformanceMovements({ inicio, fim, responsaveis = [] }) {
  const params = [];
  const whereParts = [];

  pushDateFilters(whereParts, params, inicio, fim, 'a.created_at');
  pushSellerFilters(whereParts, params, responsaveis, 'a');

  const whereSql = buildWhere(whereParts);

  const sql = `
    SELECT
      a.created_at AS datahora,
      COALESCE(NULLIF(TRIM(a.seller_name), ''), '—') AS vendedor,
      COALESCE(NULLIF(TRIM(a.customer_name), ''), '—') AS cliente,
      COALESCE(NULLIF(TRIM(a.action_type), ''), 'Movimentação') AS tipo,

      a.deal_id,
      a.stage_id,
      a.stage_code,
      a.from_stage_id,
      a.to_stage_id,

      COALESCE(a.value_at_moment, a.estimated_value, 0)::numeric(18,2) AS valor,
      a.estimated_value,
      a.value_at_moment,

      COALESCE(
        NULLIF(TRIM(d.loss_notes), ''),
        NULLIF(TRIM(o.name), ''),
        NULLIF(TRIM(d.outcome), '')
      ) AS motivo_perda,

      d.loss_reason_id,
      d.outcome_id,
      o.name AS outcome_name,
      o.code AS outcome_code,
      o.outcome_type

    FROM ${TB_ACTIONS} a

    LEFT JOIN ${TB_DEALS} d
      ON d.id = a.deal_id

    LEFT JOIN ${TB_OUTCOMES} o
      ON o.id = d.outcome_id

    ${whereSql}
    ORDER BY a.created_at DESC, a.id DESC
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/* ======================================================================
   STATUS SUMMARY (CARDS)
   ====================================================================== */

export async function listSalesPerformanceByStatus({ inicio, fim, responsaveis = [] }) {
  const params = [];
  const actionJoinFilters = buildActionJoinFilters({
    params,
    inicio,
    fim,
    responsaveis,
    alias: 'a'
  });

  const sql = `
    SELECT
      st.id,
      st.name_pt,
      st.internal_code,
      st.description_en,
      st.color_hex,
      st.sort_order,
      COUNT(DISTINCT a.deal_id)::int AS total
    FROM ${TB_STATUS_TYPES} st
    LEFT JOIN ${TB_DEALS} d
      ON d.status_type_id = st.id
    LEFT JOIN ${TB_ACTIONS} a
      ON a.deal_id = d.id
      ${actionJoinFilters}
    WHERE st.is_active = true
    GROUP BY
      st.id,
      st.name_pt,
      st.internal_code,
      st.description_en,
      st.color_hex,
      st.sort_order
    ORDER BY st.sort_order ASC, st.name_pt ASC
  `;

  const { rows } = await pool.query(sql, params);

  return rows.map((row) => ({
    ...row,
    total: toInt(row.total, 0)
  }));
}

/* ======================================================================
   DASHBOARD - LEADS ATTENDED
   ====================================================================== */

export async function getLeadsAttendedDashboard({ inicio, fim, responsaveis = [] }) {
  const params = [];
  const whereParts = [];

  pushDateFilters(whereParts, params, inicio, fim, 'a.created_at');
  pushSellerFilters(whereParts, params, responsaveis, 'a');

  const whereSql = buildWhere(whereParts);

  const sql = `
    SELECT
      a.seller_id AS "vendedorId",
      COALESCE(NULLIF(TRIM(a.seller_name), ''), 'Sem Vendedor') AS vendedor,
      COUNT(DISTINCT a.deal_id)::int AS qtd
    FROM ${TB_ACTIONS} a
    ${whereSql}
    GROUP BY
      a.seller_id,
      COALESCE(NULLIF(TRIM(a.seller_name), ''), 'Sem Vendedor')
    ORDER BY qtd DESC, vendedor ASC
  `;

  const { rows } = await pool.query(sql, params);

  const porVendedor = rows.map((row) => ({
    vendedorId: row.vendedorId != null ? Number(row.vendedorId) : null,
    vendedor: row.vendedor,
    qtd: toInt(row.qtd, 0)
  }));

  const total = porVendedor.reduce((acc, row) => acc + row.qtd, 0);

  return {
    total,
    porVendedor
  };
}

/* ======================================================================
   OPTIONAL KPI - TOTAL ACTIONS
   ====================================================================== */

export async function getSalesPerformanceTotalActions({ inicio, fim, responsaveis = [] }) {
  const params = [];
  const whereParts = [];

  pushDateFilters(whereParts, params, inicio, fim, 'a.created_at');
  pushSellerFilters(whereParts, params, responsaveis, 'a');

  const whereSql = buildWhere(whereParts);

  const sql = `
    SELECT COUNT(*)::int AS total
    FROM ${TB_ACTIONS} a
    ${whereSql}
  `;

  const { rows } = await pool.query(sql, params);

  return {
    total: toInt(rows?.[0]?.total, 0)
  };
}