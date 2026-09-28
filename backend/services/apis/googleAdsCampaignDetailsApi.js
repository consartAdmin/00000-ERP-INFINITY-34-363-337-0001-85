// ╔══════════════════════════════════════════════════════════════════════╗
// ║ googleAdsCampaignDetailsApi.js — Campaign Details (GAQL Reports)    ║
// ║ CONSART ERP | ESM                                                   ║
// ║ - Lista campanhas (dropdown)                                        ║
// ║ - Header + KPIs (com range)                                         ║
// ║ - Série temporal                                                   ║
// ║ - Dispositivos, Demografia, Keywords, Termos, Ads, Geo, Alterações  ║
// ║ - Heatmap Dia/Hora                                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

import gaqlFeatureGuard from '../googleAds/googleAdsCampaignDetailsgaqlFeatureGuard.js';

// ---------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------
function toYmd(d) {
  return String(d || '').slice(0, 10);
}

function escGaqlString(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function safeInt(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function microsToMoney(micros) {
  return Number(micros || 0) / 1_000_000;
}

function normDigits(v) {
  return String(v || '').replace(/[^0-9]/g, '').trim();
}

function daysBetweenYmd(aYmd, bYmd) {
  const a = new Date(`${aYmd}T00:00:00Z`).getTime();
  const b = new Date(`${bYmd}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function addDaysYmd(ymd, days) {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + Number(days || 0));
  return t.toISOString().slice(0, 10);
}

// helper: pega campo do row tanto camelCase quanto snake_case
function pick(obj, camel, snake) {
  if (!obj) return undefined;
  if (obj[camel] !== undefined) return obj[camel];
  if (snake && obj[snake] !== undefined) return obj[snake];
  return undefined;
}

function pickNested(row, camelRoot, snakeRoot) {
  return pick(row, camelRoot, snakeRoot);
}

// ---------------------------------------------------------------------
// 1) Lista campanhas com métricas do período (dropdown)
// ---------------------------------------------------------------------
export async function listCampaignStats({ customerId, from, to }) {
  const customer = getCustomer(customerId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!dateFrom || !dateTo) {
    throw new Error('listCampaignStats(): parâmetros from/to obrigatórios (YYYY-MM-DD).');
  }

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
    LIMIT 10000
  `;

  const rows = await customer.query(query);

  const map = new Map();
  for (const r of (rows || [])) {
    const campaign = pickNested(r, 'campaign', 'campaign');
    const metrics  = pickNested(r, 'metrics', 'metrics');

    const id = String(campaign?.id ?? '');
    if (!id) continue;

    const cur = map.get(id) || {
      campaignId: id,
      campaignName: String(campaign?.name ?? ''),
      status: String(campaign?.status ?? ''),
      channel: String(campaign?.advertising_channel_type ?? ''),
      impressions: 0,
      clicks: 0,
      costMicros: 0,
      conversions: 0,
      convValue: 0,
    };

    cur.impressions += Number(metrics?.impressions || 0);
    cur.clicks      += Number(metrics?.clicks || 0);
    cur.costMicros  += Number(metrics?.cost_micros || 0);
    cur.conversions += Number(metrics?.conversions || 0);
    cur.convValue   += Number(metrics?.conversions_value || 0);

    cur.campaignName = String(campaign?.name ?? cur.campaignName);
    cur.status = String(campaign?.status ?? cur.status);
    cur.channel = String(campaign?.advertising_channel_type ?? cur.channel);

    map.set(id, cur);
  }

  const out = Array.from(map.values()).map((x) => {
    const impressions = Number(x.impressions || 0);
    const clicks = Number(x.clicks || 0);
    const ctr = impressions > 0 ? (clicks / impressions) : 0;

    return {
      campaignId: x.campaignId,
      campaignName: x.campaignName,
      status: x.status,
      channel: x.channel,
      impressions,
      clicks,
      ctr,
      cost: microsToMoney(x.costMicros),
      conversions: Number(x.conversions || 0),
      convValue: Number(x.convValue || 0),
    };
  });

  out.sort((a, b) => (b.cost || 0) - (a.cost || 0));
  return out.slice(0, 300);
}

// ---------------------------------------------------------------------
// 2) Header (informações da campanha) + início/fim
// ---------------------------------------------------------------------
export async function getCampaignHeader({ customerId, campaignId }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);

  if (!Number.isFinite(id)) throw new Error('getCampaignHeader(): campaignId inválido.');

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id = ${id}
    LIMIT 1
  `;

  const rows = await customer.query(query);
  const r = rows?.[0];
  if (!r) return null;

  const campaign = pickNested(r, 'campaign', 'campaign');
  const campaignBudget = pickNested(r, 'campaignBudget', 'campaign_budget');

  const startDate = campaign?.start_date ? String(campaign.start_date) : null;
  const endDate   = campaign?.end_date ? String(campaign.end_date) : null;

  return {
    id: String(campaign.id),
    name: String(campaign.name),
    status: String(campaign.status),
    channel: String(campaign.advertising_channel_type),
    biddingStrategy: String(campaign.bidding_strategy_type || ''),
    startDate,
    endDate,
    budgetDaily: microsToMoney(campaignBudget?.amount_micros || campaignBudget?.amountMicros || 0),
  };
}

// ---------------------------------------------------------------------
// 3) KPIs agregados (cards) — ✅ USA o range selecionado (segments.date)
// ---------------------------------------------------------------------
export async function getCampaignKpis({ customerId, campaignId, from, to }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);

  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignKpis(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignKpis(): from/to obrigatórios (YYYY-MM-DD).');

  const query = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.interactions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
    LIMIT 1
  `;

  const rows = await customer.query(query);
  const r = rows?.[0];

  const metrics = pickNested(r, 'metrics', 'metrics');

  if (!metrics) {
    return {
      impressions: 0,
      clicks: 0,
      interactions: 0,
      ctr: 0,
      averageCpc: 0,
      cost: 0,
      conversions: 0,
      convValue: 0,
    };
  }

  return {
    impressions: Number(metrics.impressions || 0),
    clicks: Number(metrics.clicks || 0),
    interactions: Number(metrics.interactions || 0),
    ctr: Number(metrics.ctr || 0),
    averageCpc: microsToMoney(metrics.average_cpc || 0),
    cost: microsToMoney(metrics.cost_micros || 0),
    conversions: Number(metrics.conversions || 0),
    convValue: Number(metrics.conversions_value || 0),
  };
}

// ---------------------------------------------------------------------
// 4) Série temporal (dia a dia) — USA segments.date
// ---------------------------------------------------------------------
export async function getCampaignTimeseries({ customerId, campaignId, from, to }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);

  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignTimeseries(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignTimeseries(): from/to obrigatórios.');

  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
    ORDER BY segments.date ASC
  `;

  const rows = await customer.query(query);

  return (rows || []).map((r) => ({
    date: String(pickNested(r, 'segments', 'segments')?.date),
    impressions: Number(pickNested(r, 'metrics', 'metrics')?.impressions || 0),
    clicks: Number(pickNested(r, 'metrics', 'metrics')?.clicks || 0),
    cost: microsToMoney(pickNested(r, 'metrics', 'metrics')?.cost_micros || 0),
    conversions: Number(pickNested(r, 'metrics', 'metrics')?.conversions || 0),
    convValue: Number(pickNested(r, 'metrics', 'metrics')?.conversions_value || 0),
  }));
}

// ---------------------------------------------------------------------
// 5) Dispositivos — segments.device
// ---------------------------------------------------------------------
export async function getCampaignDevices({ customerId, campaignId, from, to }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignDevices(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignDevices(): from/to obrigatórios.');

  const query = `
    SELECT
      segments.device,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM campaign
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
  `;

  const rows = await customer.query(query);

  return (rows || []).map(r => ({
    device: String(pickNested(r, 'segments', 'segments')?.device || ''),
    impressions: Number(pickNested(r, 'metrics', 'metrics')?.impressions || 0),
    clicks: Number(pickNested(r, 'metrics', 'metrics')?.clicks || 0),
    cost: microsToMoney(pickNested(r, 'metrics', 'metrics')?.cost_micros || 0),
  }));
}

// ---------------------------------------------------------------------
// 6) Demografia — ✅ CORRETO: gender_view + age_range_view (não segments.*)
// ---------------------------------------------------------------------
export async function getCampaignDemographics({ customerId, campaignId, from, to }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignDemographics(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignDemographics(): from/to obrigatórios.');

  // Feature-guard: se a conta não suportar por algum motivo, não derruba /full
  if (!gaqlFeatureGuard.isEnabled(customerId, 'demographics')) return [];

  const qGender = `
    SELECT
      campaign.id,
      gender_view.gender_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM gender_view
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
  `;

  const qAge = `
    SELECT
      campaign.id,
      age_range_view.age_range,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM age_range_view
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
  `;

  const [genderRows, ageRows] = await Promise.all([
    gaqlFeatureGuard.query(customerId, 'demographics', customer, qGender).catch(() => []),
    gaqlFeatureGuard.query(customerId, 'demographics', customer, qAge).catch(() => []),
  ]);

  const out = [];

  for (const r of (genderRows || [])) {
    const genderView = pickNested(r, 'genderView', 'gender_view');
    const metrics = pickNested(r, 'metrics', 'metrics');
    out.push({
      dimension: 'gender',
      key: String(genderView?.gender_type || genderView?.genderType || ''),
      impressions: Number(metrics?.impressions || 0),
      clicks: Number(metrics?.clicks || 0),
      cost: microsToMoney(metrics?.cost_micros || 0),
    });
  }

  for (const r of (ageRows || [])) {
    const ageView = pickNested(r, 'ageRangeView', 'age_range_view');
    const metrics = pickNested(r, 'metrics', 'metrics');
    out.push({
      dimension: 'age_range',
      key: String(ageView?.age_range || ageView?.ageRange || ''),
      impressions: Number(metrics?.impressions || 0),
      clicks: Number(metrics?.clicks || 0),
      cost: microsToMoney(metrics?.cost_micros || 0),
    });
  }

  return out;
}

// ---------------------------------------------------------------------
// 7) Keywords — keyword_view
// ---------------------------------------------------------------------
export async function getCampaignKeywords({ customerId, campaignId, from, to, limit = 200 }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignKeywords(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignKeywords(): from/to obrigatórios.');

  const query = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros
    FROM keyword_view
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
    ORDER BY metrics.cost_micros DESC
    LIMIT ${safeInt(limit, 200)}
  `;

  const rows = await customer.query(query);

  return (rows || []).map(r => ({
    keyword: String(pickNested(r, 'adGroupCriterion', 'ad_group_criterion')?.keyword?.text || ''),
    status: String(pickNested(r, 'adGroupCriterion', 'ad_group_criterion')?.status || ''),
    impressions: Number(pickNested(r, 'metrics', 'metrics')?.impressions || 0),
    clicks: Number(pickNested(r, 'metrics', 'metrics')?.clicks || 0),
    ctr: Number(pickNested(r, 'metrics', 'metrics')?.ctr || 0),
    cost: microsToMoney(pickNested(r, 'metrics', 'metrics')?.cost_micros || 0),
  }));
}

// ---------------------------------------------------------------------
// 8) Termos de pesquisa — search_term_view
// ---------------------------------------------------------------------
export async function getCampaignSearchTerms({ customerId, campaignId, from, to, limit = 200 }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignSearchTerms(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignSearchTerms(): from/to obrigatórios.');

  const query = `
    SELECT
      search_term_view.search_term,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM search_term_view
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
    ORDER BY metrics.impressions DESC
    LIMIT ${safeInt(limit, 200)}
  `;

  const rows = await customer.query(query);

  return (rows || []).map(r => ({
    term: String(pickNested(r, 'searchTermView', 'search_term_view')?.search_term || ''),
    impressions: Number(pickNested(r, 'metrics', 'metrics')?.impressions || 0),
    clicks: Number(pickNested(r, 'metrics', 'metrics')?.clicks || 0),
    cost: microsToMoney(pickNested(r, 'metrics', 'metrics')?.cost_micros || 0),
  }));
}

// ---------------------------------------------------------------------
// 9) Anúncios — ad_group_ad
// ---------------------------------------------------------------------
export async function getCampaignAds({ customerId, campaignId, from, to, limit = 200 }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignAds(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignAds(): from/to obrigatórios.');

  const query = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.status,
      ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr
    FROM ad_group_ad
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
    ORDER BY metrics.impressions DESC
    LIMIT ${safeInt(limit, 200)}
  `;

  const rows = await customer.query(query);

  return (rows || []).map(r => ({
    adId: String(pickNested(r, 'adGroupAd', 'ad_group_ad')?.ad?.id || ''),
    status: String(pickNested(r, 'adGroupAd', 'ad_group_ad')?.status || ''),
    type: String(pickNested(r, 'adGroupAd', 'ad_group_ad')?.ad?.type || ''),
    finalUrls: (pickNested(r, 'adGroupAd', 'ad_group_ad')?.ad?.final_urls || []).map(String),
    adGroupId: String(pickNested(r, 'adGroup', 'ad_group')?.id || ''),
    adGroupName: String(pickNested(r, 'adGroup', 'ad_group')?.name || ''),
    impressions: Number(pickNested(r, 'metrics', 'metrics')?.impressions || 0),
    clicks: Number(pickNested(r, 'metrics', 'metrics')?.clicks || 0),
    ctr: Number(pickNested(r, 'metrics', 'metrics')?.ctr || 0),
  }));
}

// ---------------------------------------------------------------------
// 10) Geo — geographic_view (robusto) + campaign.id no SELECT
// ---------------------------------------------------------------------
export async function getCampaignGeo({ customerId, campaignId, from, to, limit = 200 }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignGeo(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignGeo(): from/to obrigatórios.');

  if (!gaqlFeatureGuard.isEnabled(customerId, 'geo')) return [];

  const query = `
    SELECT
      campaign.id,
      geographic_view.location_type,
      geographic_view.country_criterion_id,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM geographic_view
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
    ORDER BY metrics.impressions DESC
    LIMIT ${safeInt(limit, 200)}
  `;

  const rows = await gaqlFeatureGuard.query(customerId, 'geo', customer, query).catch(() => []);

  return (rows || []).map(r => {
    const campaign = pickNested(r, 'campaign', 'campaign');
    const geo = pickNested(r, 'geographicView', 'geographic_view');
    const metrics = pickNested(r, 'metrics', 'metrics');

    return {
      campaignId: String(campaign?.id || ''),
      locationType: String(geo?.location_type || geo?.locationType || ''),
      criterionId: String(geo?.country_criterion_id || geo?.countryCriterionId || ''),
      impressions: Number(metrics?.impressions || 0),
      clicks: Number(metrics?.clicks || 0),
      cost: microsToMoney(metrics?.cost_micros || 0),
    };
  });
}

// ---------------------------------------------------------------------
// 11) Alterações — change_event (histórico) ✅ clamp <= 30 dias e YYYY-MM-DD
// ---------------------------------------------------------------------
export async function getCampaignChanges({ customerId, campaignId, from, to, limit = 200 }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);

  if (!Number.isFinite(id)) throw new Error('getCampaignChanges(): campaignId inválido.');

  if (!gaqlFeatureGuard.isEnabled(customerId, 'changes')) return [];

  // O Google Ads limita: start não pode ser > 30 dias atrás.
  // Vamos “clamp” o from para no máximo (to - 29 dias) para evitar erro.
  const dateTo = toYmd(to);
  let dateFrom = toYmd(from);

  if (!dateFrom || !dateTo) throw new Error('getCampaignChanges(): from/to obrigatórios (YYYY-MM-DD).');

  const diff = daysBetweenYmd(dateFrom, dateTo);
  if (diff > 29) {
    dateFrom = addDaysYmd(dateTo, -29);
  }

  const cid = normDigits(customerId);
  const campaignResource = cid ? `customers/${cid}/campaigns/${id}` : null;

  // GAQL: BETWEEN para change_date_time só aceita YYYY-MM-DD (sem hora)
  // e precisa range finito.
  const where = campaignResource
    ? `WHERE change_event.campaign = '${escGaqlString(campaignResource)}'
       AND change_event.change_date_time BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'`
    : `WHERE change_event.change_resource_type = 'CAMPAIGN'
       AND change_event.change_date_time BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'`;

  const query = `
    SELECT
      change_event.change_date_time,
      change_event.user_email,
      change_event.change_resource_type,
      change_event.change_resource_name
    FROM change_event
    ${where}
    ORDER BY change_event.change_date_time DESC
    LIMIT ${safeInt(limit, 200)}
  `;

  const rows = await gaqlFeatureGuard.query(customerId, 'changes', customer, query).catch(() => []);

  return (rows || []).map(r => {
    const ce = pickNested(r, 'changeEvent', 'change_event');
    return {
      dateTime: String(ce?.change_date_time || ce?.changeDateTime || ''),
      userEmail: String(ce?.user_email || ce?.userEmail || ''),
      resourceType: String(ce?.change_resource_type || ce?.changeResourceType || ''),
      resourceName: String(ce?.change_resource_name || ce?.changeResourceName || ''),
      // útil pra debug: range efetivo usado (clamp)
      rangeApplied: { from: dateFrom, to: dateTo },
    };
  });
}

// ---------------------------------------------------------------------
// 12) Heatmap Dia/Hora — segments.day_of_week + segments.hour
// ---------------------------------------------------------------------
export async function getCampaignWeekdayHour({ customerId, campaignId, from, to }) {
  const customer = getCustomer(customerId);
  const id = safeInt(campaignId);
  const dateFrom = toYmd(from);
  const dateTo   = toYmd(to);

  if (!Number.isFinite(id)) throw new Error('getCampaignWeekdayHour(): campaignId inválido.');
  if (!dateFrom || !dateTo) throw new Error('getCampaignWeekdayHour(): from/to obrigatórios.');

  const query = `
    SELECT
      segments.day_of_week,
      segments.hour,
      metrics.impressions
    FROM campaign
    WHERE campaign.id = ${id}
      AND segments.date BETWEEN '${escGaqlString(dateFrom)}' AND '${escGaqlString(dateTo)}'
  `;

  const rows = await customer.query(query);

  return (rows || []).map(r => ({
    dayOfWeek: String(pickNested(r, 'segments', 'segments')?.day_of_week || pickNested(r, 'segments', 'segments')?.dayOfWeek || ''),
    hour: Number(pickNested(r, 'segments', 'segments')?.hour || 0),
    impressions: Number(pickNested(r, 'metrics', 'metrics')?.impressions || 0),
  }));
}

// ---------------------------------------------------------------------
// 13) FULL — resposta completa (tudo que o front precisa)
// ---------------------------------------------------------------------
export async function getCampaignFull({ customerId, campaignId, from, to }) {
  const [header, kpis, timeseries, devices, demographics, keywords, searchTerms, ads, geo, changes, weekdayHour] =
    await Promise.all([
      getCampaignHeader({ customerId, campaignId }),
      getCampaignKpis({ customerId, campaignId, from, to }),
      getCampaignTimeseries({ customerId, campaignId, from, to }),
      getCampaignDevices({ customerId, campaignId, from, to }),
      getCampaignDemographics({ customerId, campaignId, from, to }),
      getCampaignKeywords({ customerId, campaignId, from, to }),
      getCampaignSearchTerms({ customerId, campaignId, from, to }),
      getCampaignAds({ customerId, campaignId, from, to }),
      getCampaignGeo({ customerId, campaignId, from, to }),
      getCampaignChanges({ customerId, campaignId, from, to }),
      getCampaignWeekdayHour({ customerId, campaignId, from, to }),
    ]);

  return {
    header,
    kpis,
    timeseries,
    devices,
    demographics,
    keywords,
    searchTerms,
    ads,
    geo,
    changes,
    weekdayHour,
    range: { from: toYmd(from), to: toYmd(to) },
  };
}
