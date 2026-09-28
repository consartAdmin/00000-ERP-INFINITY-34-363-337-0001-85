// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: googleAdsApi.js                                               ║
// ║ MODULE: Google Ads Manual Input                                     ║
// ║ CONSART ERP                                                         ║
// ║ Descrição: camada de acesso a dados para CRUD manual do módulo      ║
// ║ Google Ads, sem integração externa com a API do Google Ads.         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/* ============================================================================
 * CONFIG DAS TABELAS
 * ========================================================================== */

const TABLES = {
  googleAdsAccounts: {
    table: '"googleAdsAccounts"',
    pk: 'id',
    defaultOrder: 'id DESC',
    searchable: ['customer_id', 'account_name', 'descriptive_name', 'status'],
    allowedFields: [
      'customer_id',
      'account_name',
      'currency_code',
      'time_zone',
      'descriptive_name',
      'status',
      'is_manager',
    ],
  },

  googleAdsCampaigns: {
    table: '"googleAdsCampaigns"',
    pk: 'id',
    defaultOrder: 'id DESC',
    searchable: [
      'campaign_google_id',
      'campaign_name',
      'status',
      'advertising_channel_type',
      'advertising_channel_subtype',
      'bidding_strategy_type',
    ],
    allowedFields: [
      'account_id',
      'campaign_google_id',
      'campaign_name',
      'status',
      'advertising_channel_type',
      'advertising_channel_subtype',
      'bidding_strategy_type',
      'budget_amount_micros',
      'start_date',
      'end_date',
    ],
  },

  googleAdsAdGroups: {
    table: '"googleAdsAdGroups"',
    pk: 'id',
    defaultOrder: 'id DESC',
    searchable: ['ad_group_google_id', 'ad_group_name', 'status', 'type'],
    allowedFields: [
      'campaign_id',
      'ad_group_google_id',
      'ad_group_name',
      'status',
      'type',
      'cpc_bid_micros',
    ],
  },

  googleAdsAds: {
    table: '"googleAdsAds"',
    pk: 'id',
    defaultOrder: 'id DESC',
    searchable: [
      'ad_google_id',
      'ad_name',
      'ad_type',
      'status',
      'headline_1',
      'headline_2',
      'headline_3',
      'description_1',
      'description_2',
    ],
    allowedFields: [
      'ad_group_id',
      'ad_google_id',
      'ad_name',
      'ad_type',
      'status',
      'final_url',
      'display_url',
      'headline_1',
      'headline_2',
      'headline_3',
      'description_1',
      'description_2',
    ],
  },

  googleAdsKeywords: {
    table: '"googleAdsKeywords"',
    pk: 'id',
    defaultOrder: 'id DESC',
    searchable: [
      'criterion_google_id',
      'keyword_text',
      'match_type',
      'status',
    ],
    allowedFields: [
      'ad_group_id',
      'criterion_google_id',
      'keyword_text',
      'match_type',
      'status',
      'is_negative',
      'quality_score',
      'cpc_bid_micros',
    ],
  },

  googleAdsConversionActions: {
    table: '"googleAdsConversionActions"',
    pk: 'id',
    defaultOrder: 'id DESC',
    searchable: [
      'conversion_action_google_id',
      'conversion_name',
      'category',
      'type',
      'status',
    ],
    allowedFields: [
      'account_id',
      'conversion_action_google_id',
      'conversion_name',
      'category',
      'type',
      'status',
      'primary_for_goal',
      'include_in_conversions_metric',
    ],
  },

  googleAdsMetricsAdGroupDaily: {
    table: '"googleAdsMetricsAdGroupDaily"',
    pk: 'id',
    defaultOrder: 'report_date DESC, id DESC',
    searchable: ['report_date'],
    allowedFields: [
      'campaign_id',
      'ad_group_id',
      'report_date',
      'impressions',
      'clicks',
      'cost_micros',
      'ctr',
      'average_cpc',
      'conversions',
      'conversions_value',
    ],
  },

  googleAdsMetricsKeywordDaily: {
    table: '"googleAdsMetricsKeywordDaily"',
    pk: 'id',
    defaultOrder: 'report_date DESC, id DESC',
    searchable: ['report_date'],
    allowedFields: [
      'campaign_id',
      'ad_group_id',
      'keyword_id',
      'report_date',
      'impressions',
      'clicks',
      'cost_micros',
      'ctr',
      'average_cpc',
      'conversions',
      'conversions_value',
    ],
  },

  googleAdsMetricsAdDaily: {
    table: '"googleAdsMetricsAdDaily"',
    pk: 'id',
    defaultOrder: 'report_date DESC, id DESC',
    searchable: ['report_date'],
    allowedFields: [
      'campaign_id',
      'ad_group_id',
      'ad_id',
      'report_date',
      'impressions',
      'clicks',
      'cost_micros',
      'ctr',
      'conversions',
      'conversions_value',
    ],
  },

  googleAdsMetricsDeviceDaily: {
    table: '"googleAdsMetricsDeviceDaily"',
    pk: 'id',
    defaultOrder: 'report_date DESC, id DESC',
    searchable: ['report_date', 'device_type'],
    allowedFields: [
      'campaign_id',
      'ad_group_id',
      'report_date',
      'device_type',
      'impressions',
      'clicks',
      'cost_micros',
      'conversions',
      'conversions_value',
    ],
  },

  googleAdsMetricsGeoDaily: {
    table: '"googleAdsMetricsGeoDaily"',
    pk: 'id',
    defaultOrder: 'report_date DESC, id DESC',
    searchable: ['report_date', 'country_code', 'state_name', 'city_name'],
    allowedFields: [
      'campaign_id',
      'report_date',
      'country_code',
      'state_name',
      'city_name',
      'impressions',
      'clicks',
      'cost_micros',
      'conversions',
      'conversions_value',
    ],
  },

  googleAdsMetricsTimeDaily: {
    table: '"googleAdsMetricsTimeDaily"',
    pk: 'id',
    defaultOrder: 'report_date DESC, hour_of_day ASC, id DESC',
    searchable: ['report_date', 'day_of_week'],
    allowedFields: [
      'campaign_id',
      'report_date',
      'day_of_week',
      'hour_of_day',
      'impressions',
      'clicks',
      'cost_micros',
      'conversions',
      'conversions_value',
    ],
  },

  googleAdsOauthTokens: {
    table: '"googleAdsOauthTokens"',
    pk: 'id',
    defaultOrder: 'id DESC',
    searchable: ['google_user_email', 'login_customer_id'],
    allowedFields: [
      'account_id',
      'google_user_email',
      'refresh_token',
      'access_token',
      'token_expiry',
      'developer_token',
      'login_customer_id',
    ],
  },

  googleAdsSyncLogs: {
    table: '"googleAdsSyncLogs"',
    pk: 'id',
    defaultOrder: 'started_at DESC, id DESC',
    searchable: ['sync_type', 'status', 'error_message'],
    allowedFields: [
      'account_id',
      'sync_type',
      'status',
      'started_at',
      'finished_at',
      'reference_date_start',
      'reference_date_end',
      'rows_processed',
      'error_message',
    ],
  },

  googleAdsClickTracking: {
    table: '"googleAdsClickTracking"',
    pk: 'id',
    defaultOrder: 'click_date DESC NULLS LAST, id DESC',
    searchable: [
      'gclid',
      'campaign_google_id',
      'ad_group_google_id',
      'ad_google_id',
      'keyword_text',
      'customer_name',
      'customer_phone',
      'customer_email',
    ],
    allowedFields: [
      'gclid',
      'campaign_google_id',
      'ad_group_google_id',
      'ad_google_id',
      'keyword_text',
      'click_date',
      'landing_page',
      'customer_name',
      'customer_phone',
      'customer_email',
      'order_id',
      'budget_id',
    ],
  },

  googleAdsErpAttribution: {
    table: '"googleAdsErpAttribution"',
    pk: 'id',
    defaultOrder: 'attribution_date DESC NULLS LAST, id DESC',
    searchable: ['gclid'],
    allowedFields: [
      'gclid',
      'campaign_id',
      'ad_group_id',
      'customer_id',
      'order_id',
      'budget_id',
      'revenue_value',
      'cost_of_goods',
      'gross_profit',
      'ads_cost_allocated',
      'real_roi',
      'real_roas',
      'attribution_date',
    ],
  },
};

function getConfig(resource) {
  const config = TABLES[resource];
  if (!config) {
    const err = new Error(`Recurso inválido: ${resource}`);
    err.statusCode = 400;
    throw err;
  }
  return config;
}

function sanitizeFields(resource, payload = {}) {
  const { allowedFields } = getConfig(resource);
  const clean = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      clean[field] = payload[field];
    }
  }

  return clean;
}

function buildWhereClause(resource, query = {}) {
  const { searchable } = getConfig(resource);
  const conditions = [];
  const values = [];
  let idx = 1;

  if (query.q && searchable.length) {
    const likeParts = searchable.map((field) => {
      values.push(`%${query.q}%`);
      return `CAST(${field} AS TEXT) ILIKE $${idx++}`;
    });
    conditions.push(`(${likeParts.join(' OR ')})`);
  }

  for (const [key, value] of Object.entries(query)) {
    if (
      ['q', 'page', 'limit', 'orderBy', 'orderDir'].includes(key) ||
      value === undefined ||
      value === null ||
      value === ''
    ) {
      continue;
    }

    const { allowedFields, pk } = getConfig(resource);
    if (!allowedFields.includes(key) && key !== pk) continue;

    values.push(value);
    conditions.push(`${key} = $${idx++}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, values };
}

function buildOrderClause(resource, orderBy, orderDir) {
  const { allowedFields, pk, defaultOrder } = getConfig(resource);
  if (!orderBy) return `ORDER BY ${defaultOrder}`;

  const allowedOrderFields = new Set([pk, ...allowedFields, 'created_at', 'updated_at']);
  if (!allowedOrderFields.has(orderBy)) return `ORDER BY ${defaultOrder}`;

  const dir = String(orderDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return `ORDER BY ${orderBy} ${dir}`;
}

/* ============================================================================
 * CRUD GENÉRICO
 * ========================================================================== */

export async function list(resource, query = {}) {
  const { table, pk } = getConfig(resource);
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.max(Math.min(Number(query.limit || 20), 200), 1);
  const offset = (page - 1) * limit;

  const { where, values } = buildWhereClause(resource, query);
  const order = buildOrderClause(resource, query.orderBy, query.orderDir);

  const sql = `
    SELECT *
      FROM ${table}
      ${where}
      ${order}
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
  `;

  const countSql = `
    SELECT COUNT(*)::INT AS total
      FROM ${table}
      ${where}
  `;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(sql, [...values, limit, offset]),
    pool.query(countSql, values),
  ]);

  return {
    rows: rowsResult.rows,
    total: countResult.rows[0]?.total || 0,
    page,
    limit,
    sort: {
      orderBy: query.orderBy || pk,
      orderDir: query.orderDir || 'DESC',
    },
  };
}

export async function getById(resource, id) {
  const { table, pk } = getConfig(resource);

  const sql = `
    SELECT *
      FROM ${table}
     WHERE ${pk} = $1
     LIMIT 1
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

export async function create(resource, payload) {
  const { table, pk } = getConfig(resource);
  const data = sanitizeFields(resource, payload);

  const fields = Object.keys(data);
  if (!fields.length) {
    const err = new Error('Nenhum campo válido foi informado para criação.');
    err.statusCode = 400;
    throw err;
  }

  const values = Object.values(data);
  const placeholders = values.map((_, i) => `$${i + 1}`);

  const sql = `
    INSERT INTO ${table} (${fields.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

export async function update(resource, id, payload) {
  const { table, pk } = getConfig(resource);
  const data = sanitizeFields(resource, payload);

  const fields = Object.keys(data);
  if (!fields.length) {
    const err = new Error('Nenhum campo válido foi informado para atualização.');
    err.statusCode = 400;
    throw err;
  }

  const setClause = fields
    .map((field, i) => `${field} = $${i + 1}`)
    .join(', ');

  const values = [...fields.map((f) => data[f]), id];

  const hasUpdatedAt = true;

  const sql = `
    UPDATE ${table}
       SET ${setClause}${hasUpdatedAt ? ', updated_at = NOW()' : ''}
     WHERE ${pk} = $${values.length}
     RETURNING *
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

export async function remove(resource, id) {
  const { table, pk } = getConfig(resource);

  const sql = `
    DELETE FROM ${table}
     WHERE ${pk} = $1
     RETURNING *
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

/* ============================================================================
 * DASHBOARD / RESUMOS
 * ========================================================================== */

export async function getDashboardSummary(filters = {}) {
  const values = [];
  const conditions = [];
  let idx = 1;

  if (filters.campaign_id) {
    values.push(filters.campaign_id);
    conditions.push(`campaign_id = $${idx++}`);
  }

  if (filters.ad_group_id) {
    values.push(filters.ad_group_id);
    conditions.push(`ad_group_id = $${idx++}`);
  }

  if (filters.date_from) {
    values.push(filters.date_from);
    conditions.push(`report_date >= $${idx++}`);
  }

  if (filters.date_to) {
    values.push(filters.date_to);
    conditions.push(`report_date <= $${idx++}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      COALESCE(SUM(impressions), 0)::BIGINT      AS impressions,
      COALESCE(SUM(clicks), 0)::BIGINT           AS clicks,
      COALESCE(SUM(cost_micros), 0)::BIGINT      AS cost_micros,
      COALESCE(SUM(conversions), 0)::NUMERIC     AS conversions,
      COALESCE(SUM(conversions_value), 0)::NUMERIC AS conversions_value
    FROM "googleAdsMetricsAdGroupDaily"
    ${where}
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || {
    impressions: 0,
    clicks: 0,
    cost_micros: 0,
    conversions: 0,
    conversions_value: 0,
  };
}

export async function getCampaignPerformance(filters = {}) {
  const values = [];
  const conditions = [];
  let idx = 1;

  if (filters.date_from) {
    values.push(filters.date_from);
    conditions.push(`m.report_date >= $${idx++}`);
  }

  if (filters.date_to) {
    values.push(filters.date_to);
    conditions.push(`m.report_date <= $${idx++}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      c.id,
      c.campaign_name,
      c.campaign_google_id,
      c.status,
      COALESCE(SUM(m.impressions), 0)::BIGINT AS impressions,
      COALESCE(SUM(m.clicks), 0)::BIGINT AS clicks,
      COALESCE(SUM(m.cost_micros), 0)::BIGINT AS cost_micros,
      COALESCE(SUM(m.conversions), 0)::NUMERIC AS conversions,
      COALESCE(SUM(m.conversions_value), 0)::NUMERIC AS conversions_value
    FROM "googleAdsCampaigns" c
    LEFT JOIN "googleAdsMetricsAdGroupDaily" m
      ON m.campaign_id = c.id
    ${where}
    GROUP BY c.id, c.campaign_name, c.campaign_google_id, c.status
    ORDER BY c.campaign_name ASC
  `;

  const { rows } = await pool.query(sql, values);
  return rows;
}

export async function getDailySeries(filters = {}) {
  const values = [];
  const conditions = [];
  let idx = 1;

  if (filters.campaign_id) {
    values.push(filters.campaign_id);
    conditions.push(`campaign_id = $${idx++}`);
  }

  if (filters.ad_group_id) {
    values.push(filters.ad_group_id);
    conditions.push(`ad_group_id = $${idx++}`);
  }

  if (filters.date_from) {
    values.push(filters.date_from);
    conditions.push(`report_date >= $${idx++}`);
  }

  if (filters.date_to) {
    values.push(filters.date_to);
    conditions.push(`report_date <= $${idx++}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      report_date,
      COALESCE(SUM(impressions), 0)::BIGINT AS impressions,
      COALESCE(SUM(clicks), 0)::BIGINT AS clicks,
      COALESCE(SUM(cost_micros), 0)::BIGINT AS cost_micros,
      COALESCE(SUM(conversions), 0)::NUMERIC AS conversions,
      COALESCE(SUM(conversions_value), 0)::NUMERIC AS conversions_value
    FROM "googleAdsMetricsAdGroupDaily"
    ${where}
    GROUP BY report_date
    ORDER BY report_date ASC
  `;

  const { rows } = await pool.query(sql, values);
  return rows;
}