// ╔══════════════════════════════════════════════════════════════════════╗
// ║ googleAdsService.js — Serviços Google Ads (CONSART ERP)             ║
// ║ ✅ FIX: normaliza level + logs detalhados + validações               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { getCustomer } from '../repositories/googleAds/googleAds.index.js';

function nowIso() { return new Date().toISOString(); }

function safeErr(err) {
  return {
    message: err?.message,
    name: err?.name,
    stack: err?.stack,
    code: err?.code,
    status: err?.status,
  };
}

/**
 * Sanitiza data YYYY-MM-DD
 */
function sanitizeDate(str) {
  if (!str) return undefined;
  const cleaned = String(str).trim().replace(/[^0-9-]/g, '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return undefined;
  return cleaned;
}

function normalizeLevel(level) {
  const v = String(level || 'campaign').toLowerCase().trim();
  if (v === 'keyword' || v === 'keywords') return 'keyword';
  if (v === 'ad' || v === 'ads') return 'ad';
  return 'campaign';
}

/* --------------------------------------------------------------------- */
/* Lista campanhas                                                       */
/* --------------------------------------------------------------------- */
export async function listCampaigns(customerId) {
  const customer = getCustomer(customerId);

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.serving_status,
      campaign.start_date,
      campaign.end_date
    FROM campaign
    WHERE campaign.status != REMOVED
    ORDER BY campaign.name
  `;

  const rows = await customer.query(query);

  return rows.map((r) => ({
    id: r.campaign.id,
    name: r.campaign.name,
    status: r.campaign.status,
    channelType: r.campaign.advertising_channel_type,
    servingStatus: r.campaign.serving_status,
    startDate: r.campaign.start_date,
    endDate: r.campaign.end_date,
  }));
}

/* --------------------------------------------------------------------- */
/* Métricas                                                              */
/* --------------------------------------------------------------------- */
export async function getCampaignStats({
  customerId,
  campaignId,
  startDate,
  endDate,
  level = 'campaign',
  requestId = '',
}) {
  const t0 = Date.now();
  const lvl = normalizeLevel(level);

  const customer = getCustomer(customerId);

  const sDate = sanitizeDate(startDate);
  const eDate = sanitizeDate(endDate);

  const where = [];

  // Período
  if (sDate && eDate) where.push(`segments.date BETWEEN '${sDate}' AND '${eDate}'`);
  else if (sDate)     where.push(`segments.date >= '${sDate}'`);
  else if (eDate)     where.push(`segments.date <= '${eDate}'`);

  // Sempre ignorar removidas
  where.push(`campaign.status != REMOVED`);

  // Campanha específica
  if (campaignId) {
    const numericId = String(campaignId).replace(/[^0-9]/g, '');
    if (numericId) where.push(`campaign.id = ${numericId}`);
  }

  // Nível
  if (lvl === 'keyword') where.push(`ad_group_criterion.status != REMOVED`);
  if (lvl === 'ad')      where.push(`ad_group_ad.status != REMOVED`);

  let query;

  if (lvl === 'keyword') {
    query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,

        ad_group.id,
        ad_group.name,

        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,

        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,

        segments.date
      FROM keyword_view
    `;
  } else if (lvl === 'ad') {
    query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,

        ad_group.id,
        ad_group.name,

        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status,

        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,

        segments.date
      FROM ad_group_ad
    `;
  } else {
    query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,

        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,

        segments.date
      FROM campaign
    `;
  }

  if (where.length) query += ` WHERE ${where.join(' AND ')} `;
  query += ` ORDER BY segments.date ASC, campaign.id`;

  console.log('[GoogleAds][getCampaignStats] start', {
    ts: nowIso(),
    requestId,
    lvl,
    customerId: customerId || '(default)',
    campaignId: campaignId || '',
    startDate: sDate || null,
    endDate: eDate || null,
    hasDateFilter: !!(sDate || eDate),
  });

  // ⚠️ Log do GAQL (muito útil pra bater o olho)
  console.log('[GoogleAds][getCampaignStats] GAQL\n' + query);

  try {
    const rows = await customer.query(query);

    // debug rápido: somatório
    let sumImp = 0, sumClk = 0, sumCostMicros = 0;
    for (const r of rows || []) {
      const m = r.metrics || {};
      sumImp += Number(m.impressions || 0);
      sumClk += Number(m.clicks || 0);
      sumCostMicros += Number(m.cost_micros || 0);
    }

    console.log('[GoogleAds][getCampaignStats] ok', {
      ts: nowIso(),
      requestId,
      ms: Date.now() - t0,
      rows: rows?.length || 0,
      sumImp,
      sumClk,
      sumCost: sumCostMicros / 1_000_000,
    });

    return rows;
  } catch (err) {
    console.error('[GoogleAds][getCampaignStats] ERROR', {
      ts: nowIso(),
      requestId,
      ms: Date.now() - t0,
      err: safeErr(err),
    });
    throw err;
  }
}

/* --------------------------------------------------------------------- */
/* Offline conversion (stub)                                             */
/* --------------------------------------------------------------------- */
export async function uploadOfflineClickConversion({
  customerId,
  conversionActionResourceName,
  gclid,
  conversionDateTime,
  value,
  currencyCode = 'BRL',
  requestId = '',
}) {
  void getCustomer(customerId);

  console.warn('[GoogleAds][uploadOfflineClickConversion] STUB', {
    ts: nowIso(),
    requestId,
    customerId: customerId || '(default)',
    conversionActionResourceName,
    hasGclid: !!gclid,
    conversionDateTime,
    value,
    currencyCode,
  });

  return {
    customerId: customerId || 'default(GADS_CUSTOMER_ID)',
    conversionActionResourceName,
    gclid,
    conversionDateTime,
    value,
    currencyCode,
    note: 'stub implementation (sem upload real para Google Ads ainda)',
  };
}
