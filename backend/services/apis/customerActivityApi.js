/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: customerActivityApi.js                                        ║
   ║ MODULE: Customer Activity                                           ║
   ║ DESCRIPTION: DAL/API de acesso à tabela customerActivity            ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../config/db.js';

const TABLE = '"customerActivity"';

function normalizePaging(page = 1, limit = 20) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const offset = (safePage - 1) * safeLimit;
  return { safePage, safeLimit, offset };
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return null;

  const allowed = new Set(['active', 'at_risk', 'inactive', 'lost']);
  return allowed.has(value) ? value : null;
}

function normalizeFollowupType(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!value) return null;

  const allowed = new Set(['whatsapp', 'call', 'email']);
  return allowed.has(value) ? value : null;
}

function normalizeSourceModule(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toNullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* =========================================================================
 * HELPERS — CUSTOMER ID RESOLUTION
 * ========================================================================= */
async function resolveCustomerActivityCustomerId(rawCustomerId) {
  const id = toNullableInt(rawCustomerId);
  if (!id) return null;

  let res = await pool.query(
    `SELECT customer_id FROM public.customers WHERE customer_id = $1 LIMIT 1`,
    [id]
  );
  if (res.rowCount) return res.rows[0].customer_id;

  res = await pool.query(
    `SELECT customer_id FROM public.customers WHERE cliente_id = $1 LIMIT 1`,
    [id]
  );
  if (res.rowCount) return res.rows[0].customer_id;

  return null;
}

function mapOutcomeToStatus(code, outcomeType = null) {
  const normalized = String(code || '').trim().toLowerCase();
  const normalizedType = String(outcomeType || '').trim().toLowerCase();

  if (
    [
      'won_sale',
      'conversion',
      'won',
      'venda',
      'conversion_sale',
      'conversao_em_vendas',
      'conversão em vendas',
    ].includes(normalized) ||
    ['conversion', 'won'].includes(normalizedType)
  ) {
    return 'active';
  }

  if (
    [
      'sales_drop',
      'loss',
      'lost',
      'queda_de_venda',
    ].includes(normalized) ||
    ['loss', 'lost'].includes(normalizedType)
  ) {
    return 'at_risk';
  }

  if (
    [
      'lost_no_contact',
      'no_success_contact',
      'no_contact',
      'sem_contato',
    ].includes(normalized) ||
    ['no_success_contact', 'no_contact'].includes(normalizedType)
  ) {
    return 'inactive';
  }

  return null;
}

export async function listCustomerActivities({
  page = 1,
  limit = 20,
  status = '',
  search = '',
  onlyNeedsFollowup = false,
} = {}) {
  const { safePage, safeLimit, offset } = normalizePaging(page, limit);

  const where = [];
  const params = [];
  let idx = 1;

  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus) {
    where.push(`ca.status = $${idx++}`);
    params.push(normalizedStatus);
  }

  if (search?.trim()) {
    where.push(`
      (
        CAST(c.customer_id AS TEXT) ILIKE $${idx}
        OR COALESCE(c.trade_name, '') ILIKE $${idx}
        OR COALESCE(c.legal_name, '') ILIKE $${idx}
        OR COALESCE(c.tax_id, '') ILIKE $${idx}
        OR COALESCE(c.email, '') ILIKE $${idx}
        OR COALESCE(c.phone_number, '') ILIKE $${idx}
        OR COALESCE(c.mobile_number, '') ILIKE $${idx}
      )
    `);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  if (String(onlyNeedsFollowup) === 'true' || onlyNeedsFollowup === true) {
    where.push(`
      ca.status IN ('at_risk', 'inactive')
      AND (
        ca.last_followup_at IS NULL
        OR ca.last_followup_at < NOW() - INTERVAL '3 days'
      )
    `);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*)::INT AS total
    FROM ${TABLE} ca
    LEFT JOIN "customers" c ON c.customer_id = ca.customer_id
    ${whereSql};
  `;

  const dataSql = `
    SELECT
      ca.id,
      ca.customer_id,
      ca.last_purchase_date,
      ca.last_contact_date,
      ca.days_without_purchase,
      ca.status,
      ca.last_followup_type,
      ca.last_followup_at,
      ca.followup_count,
      ca.inactivity_reason,
      ca.crm_deals_outcome_id,
      ca.source_module,
      ca.source_reference_id,
      ca.created_at,
      ca.updated_at,

      c.trade_name,
      c.legal_name,
      c.tax_id,
      c.email,
      c.phone_number,
      c.mobile_number,
      c.city,
      c.state,
      c.salesperson,
      c.is_active,

      o.name AS outcome_name,
      o.code AS outcome_code,
      o.outcome_type,
      o.icon AS outcome_icon,
      o.color AS outcome_color

    FROM ${TABLE} ca
    LEFT JOIN "customers" c
      ON c.customer_id = ca.customer_id
    LEFT JOIN "crmDealsOutcomes" o
      ON o.id = ca.crm_deals_outcome_id
    ${whereSql}
    ORDER BY
      ca.days_without_purchase DESC NULLS LAST,
      ca.customer_id ASC
    LIMIT $${idx++}
    OFFSET $${idx++};
  `;

  const countRes = await pool.query(countSql, params);
  const total = countRes.rows[0]?.total || 0;

  const dataParams = [...params, safeLimit, offset];
  const dataRes = await pool.query(dataSql, dataParams);

  return {
    total,
    page: safePage,
    limit: safeLimit,
    rows: dataRes.rows,
  };
}

export async function getCustomerActivityByCustomerId(customerId) {
  const sql = `
    SELECT
      ca.*,

      c.trade_name,
      c.legal_name,
      c.tax_id,
      c.email,
      c.phone_number,
      c.mobile_number,
      c.city,
      c.state,
      c.salesperson,
      c.is_active,

      o.name AS outcome_name,
      o.code AS outcome_code,
      o.outcome_type,
      o.icon AS outcome_icon,
      o.color AS outcome_color

    FROM ${TABLE} ca
    LEFT JOIN "customers" c
      ON c.customer_id = ca.customer_id
    LEFT JOIN "crmDealsOutcomes" o
      ON o.id = ca.crm_deals_outcome_id
    WHERE ca.customer_id = $1
    LIMIT 1;
  `;

  const res = await pool.query(sql, [customerId]);
  return res.rows[0] || null;
}

export async function getCustomerActivityById(id) {
  const sql = `
    SELECT *
    FROM ${TABLE}
    WHERE id = $1
    LIMIT 1;
  `;
  const res = await pool.query(sql, [id]);
  return res.rows[0] || null;
}

export async function createCustomerActivityIfMissing(customerId) {
  const sql = `
    INSERT INTO ${TABLE} (
      customer_id,
      last_purchase_date,
      last_contact_date,
      days_without_purchase,
      status,
      last_followup_type,
      last_followup_at,
      followup_count,
      inactivity_reason,
      crm_deals_outcome_id,
      source_module,
      source_reference_id
    )
    SELECT
      $1,
      NULL,
      NULL,
      0,
      'active',
      NULL,
      NULL,
      0,
      NULL,
      NULL,
      NULL,
      NULL
    WHERE NOT EXISTS (
      SELECT 1
      FROM ${TABLE}
      WHERE customer_id = $1
    )
    RETURNING *;
  `;

  const inserted = await pool.query(sql, [customerId]);
  if (inserted.rows[0]) return inserted.rows[0];

  return getCustomerActivityByCustomerId(customerId);
}

export async function updateCustomerActivity(customerId, payload = {}) {
  const fields = [];
  const values = [];
  let idx = 1;

  const allowed = {
    last_purchase_date: payload.last_purchase_date ?? undefined,
    last_contact_date: payload.last_contact_date ?? undefined,
    days_without_purchase: payload.days_without_purchase ?? undefined,
    status: payload.status !== undefined ? normalizeStatus(payload.status) : undefined,
    last_followup_type: payload.last_followup_type !== undefined
      ? normalizeFollowupType(payload.last_followup_type)
      : undefined,
    last_followup_at: payload.last_followup_at ?? undefined,
    followup_count: payload.followup_count ?? undefined,
    inactivity_reason: payload.inactivity_reason ?? undefined,
    crm_deals_outcome_id: payload.crm_deals_outcome_id !== undefined
      ? toNullableInt(payload.crm_deals_outcome_id)
      : undefined,
    source_module: payload.source_module !== undefined
      ? normalizeSourceModule(payload.source_module)
      : undefined,
    source_reference_id: payload.source_reference_id !== undefined
      ? toNullableInt(payload.source_reference_id)
      : undefined,
  };

  for (const [key, value] of Object.entries(allowed)) {
    if (value !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  fields.push(`updated_at = CURRENT_TIMESTAMP`);

  const sql = `
    UPDATE ${TABLE}
    SET ${fields.join(', ')}
    WHERE customer_id = $${idx}
    RETURNING *;
  `;

  values.push(customerId);
  const res = await pool.query(sql, values);
  return res.rows[0] || null;
}

export async function registerCustomerFollowup(customerId, {
  followup_type,
  inactivity_reason = null,
  status = null,
  crm_deals_outcome_id = null,
  source_module = null,
  source_reference_id = null,
} = {}) {
  const normalizedType = normalizeFollowupType(followup_type);
  const normalizedStatus = status ? normalizeStatus(status) : null;
  const normalizedOutcomeId = toNullableInt(crm_deals_outcome_id);
  const normalizedSourceModule = normalizeSourceModule(source_module);
  const normalizedSourceReferenceId = toNullableInt(source_reference_id);

  if (!normalizedType) {
    throw new Error('INVALID_FOLLOWUP_TYPE');
  }

  const sql = `
    UPDATE ${TABLE}
    SET
      last_followup_type = $1,
      last_followup_at = CURRENT_TIMESTAMP,
      last_contact_date = CURRENT_TIMESTAMP,
      followup_count = COALESCE(followup_count, 0) + 1,
      inactivity_reason = COALESCE($2, inactivity_reason),
      status = COALESCE($3, status),
      crm_deals_outcome_id = COALESCE($4, crm_deals_outcome_id),
      source_module = COALESCE($5, source_module),
      source_reference_id = COALESCE($6, source_reference_id),
      updated_at = CURRENT_TIMESTAMP
    WHERE customer_id = $7
    RETURNING *;
  `;

  const res = await pool.query(sql, [
    normalizedType,
    inactivity_reason,
    normalizedStatus,
    normalizedOutcomeId,
    normalizedSourceModule,
    normalizedSourceReferenceId,
    customerId,
  ]);

  return res.rows[0] || null;
}

export async function recalculateCustomerActivityStatuses() {
  const sql = `
    UPDATE ${TABLE}
    SET
      days_without_purchase = CASE
        WHEN last_purchase_date IS NULL THEN 999
        ELSE CURRENT_DATE - last_purchase_date
      END,
      status = CASE
        WHEN source_module = 'crmDeals' AND crm_deals_outcome_id IS NOT NULL
          THEN status
        WHEN last_purchase_date IS NULL THEN 'inactive'
        WHEN CURRENT_DATE - last_purchase_date >= 90 THEN 'lost'
        WHEN CURRENT_DATE - last_purchase_date >= 60 THEN 'inactive'
        WHEN CURRENT_DATE - last_purchase_date >= 30 THEN 'at_risk'
        ELSE 'active'
      END,
      updated_at = CURRENT_TIMESTAMP
    RETURNING
      id,
      customer_id,
      status,
      days_without_purchase;
  `;

  const res = await pool.query(sql);
  return {
    affectedRows: res.rowCount,
    rows: res.rows,
  };
}

export async function getCustomerActivitySummary() {
  const sql = `
    SELECT
      status,
      COUNT(*)::INT AS total
    FROM ${TABLE}
    GROUP BY status
    ORDER BY status;
  `;
  const res = await pool.query(sql);
  return res.rows;
}

export async function applyCrmOutcomeToCustomerActivity({
  customerId,
  outcomeId,
  dealId,
}) {
  const rawCustomerId = toNullableInt(customerId);
  const normalizedOutcomeId = toNullableInt(outcomeId);
  const normalizedDealId = toNullableInt(dealId);

  if (!rawCustomerId) throw new Error('INVALID_CUSTOMER_ID');
  if (!normalizedOutcomeId) throw new Error('INVALID_OUTCOME_ID');
  if (!normalizedDealId) throw new Error('INVALID_DEAL_ID');

  const normalizedCustomerId = await resolveCustomerActivityCustomerId(rawCustomerId);
  if (!normalizedCustomerId) {
    throw new Error('CUSTOMER_NOT_FOUND_IN_CUSTOMERS');
  }

  const ensured = await createCustomerActivityIfMissing(normalizedCustomerId);
  if (!ensured && !(await getCustomerActivityByCustomerId(normalizedCustomerId))) {
    throw new Error('CUSTOMER_ACTIVITY_NOT_FOUND');
  }

  const outcomeRes = await pool.query(`
    SELECT id, code, name, outcome_type
    FROM "crmDealsOutcomes"
    WHERE id = $1
    LIMIT 1
  `, [normalizedOutcomeId]);

  const outcome = outcomeRes.rows[0];
  if (!outcome) {
    throw new Error('OUTCOME_NOT_FOUND');
  }

  const normalizedCode = String(outcome.code || '').trim().toLowerCase();
  const normalizedType = String(outcome.outcome_type || '').trim().toLowerCase();

  const newStatus = mapOutcomeToStatus(outcome.code, outcome.outcome_type);

  const isConversion =
    [
      'won_sale',
      'conversion',
      'won',
      'venda',
      'conversion_sale',
      'conversao_em_vendas',
      'conversão em vendas',
    ].includes(normalizedCode) ||
    ['conversion', 'won'].includes(normalizedType);

  const sql = `
    UPDATE ${TABLE}
    SET
      status = COALESCE($1, status),
      crm_deals_outcome_id = $2,
      source_module = 'crmDeals',
      source_reference_id = $3,
      last_contact_date = CURRENT_TIMESTAMP,
      inactivity_reason = CASE
        WHEN $4 THEN NULL
        ELSE COALESCE($5, inactivity_reason)
      END,
      last_purchase_date = CASE
        WHEN $4 THEN CURRENT_DATE
        ELSE last_purchase_date
      END,
      days_without_purchase = CASE
        WHEN $4 THEN 0
        ELSE days_without_purchase
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE customer_id = $6
    RETURNING *;
  `;

  const res = await pool.query(sql, [
    newStatus,
    outcome.id,
    normalizedDealId,
    isConversion,
    outcome.code || outcome.name || null,
    normalizedCustomerId,
  ]);

  return res.rows[0] || null;
}