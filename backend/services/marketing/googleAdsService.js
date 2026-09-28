// ╔══════════════════════════════════════════════════════════════════════╗
// ║ googleAdsService.js — Integração Google Ads (REST)                  ║
// ║ CONSART ERP | ESM                                                    ║
// ║                                                                      ║
// ║ - Camada de serviço para consultar a Google Ads API via REST        ║
// ║ - Usa Google Ads Query Language (GAQL)                               ║
// ║ - Exemplo: performance de campanhas (impressões, cliques, custo)    ║
// ║                                                                      ║
// ║ ⚠ Importante                                                         ║
// ║ - Node.js 18+ (fetch nativo) OU node-fetch instalado                 ║
// ║ - OAuth2 (access token) gerenciado em módulo separado                ║
// ║ - Variáveis de ambiente:                                            ║
// ║     GOOGLE_ADS_DEVELOPER_TOKEN                                       ║
// ║     GOOGLE_ADS_MANAGER_ID        (login-customer-id, opcional)      ║
// ║     GOOGLE_ADS_CUSTOMER_ID       (ID da conta cliente)              ║
// ║     GOOGLE_ADS_API_VERSION       (ex: 22)                            ║
// ║     GOOGLE_ADS_ACCESS_TOKEN      (Bearer token válido)              ║
// ╚══════════════════════════════════════════════════════════════════════╝

/* eslint-disable no-console */

// Se você estiver em Node 18+, já existe fetch global.
// Caso esteja em Node <18, descomente a linha abaixo e instale:
//   npm i node-fetch
// import fetch from 'node-fetch';

// ---------------------------------------------------------------------
// Configuração base (lê do .env)
// ---------------------------------------------------------------------
const GOOGLE_ADS_DEVELOPER_TOKEN =
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';

const GOOGLE_ADS_MANAGER_ID =
  process.env.GOOGLE_ADS_MANAGER_ID || ''; // opcional (login-customer-id)

const GOOGLE_ADS_CUSTOMER_ID =
  process.env.GOOGLE_ADS_CUSTOMER_ID || '';

const GOOGLE_ADS_API_VERSION =
  process.env.GOOGLE_ADS_API_VERSION || '22';

const GOOGLE_ADS_ACCESS_TOKEN =
  process.env.GOOGLE_ADS_ACCESS_TOKEN || '';

const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/v${GOOGLE_ADS_API_VERSION}`;

// ---------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------

function ensureBasicConfig() {
  const missing = [];

  if (!GOOGLE_ADS_DEVELOPER_TOKEN) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!GOOGLE_ADS_CUSTOMER_ID) missing.push('GOOGLE_ADS_CUSTOMER_ID');
  if (!GOOGLE_ADS_ACCESS_TOKEN) missing.push('GOOGLE_ADS_ACCESS_TOKEN');

  if (missing.length > 0) {
    throw new Error(
      `Configuração Google Ads incompleta. Verifique as variáveis de ambiente: ${missing.join(
        ', ',
      )}`,
    );
  }
}

/**
 * Monta headers padrão para chamadas REST do Google Ads API.
 * Docs REST: https://googleads.googleapis.com/v22/customers/CUSTOMER_ID/googleAds:search
 */
function buildDefaultHeaders() {
  ensureBasicConfig();

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
    'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
  };

  // login-customer-id é opcional, mas recomendado quando você usa MCC
  if (GOOGLE_ADS_MANAGER_ID) {
    headers['login-customer-id'] = GOOGLE_ADS_MANAGER_ID;
  }

  return headers;
}

// ---------------------------------------------------------------------
// Builders de GAQL (Google Ads Query Language)
// ---------------------------------------------------------------------

/**
 * Builder simples de query GAQL para performance de campanhas.
 *
 * @param {Object} options
 * @param {string} [options.dateRange='LAST_30_DAYS'] - Ex: 'LAST_7_DAYS', 'LAST_30_DAYS', 'YESTERDAY'
 * @returns {string} GAQL query
 */
export function buildCampaignPerformanceQuery({
  dateRange = 'LAST_30_DAYS',
} = {}) {
  // Exemplo baseado na doc oficial: campanha + métricas básicas
  // https://developers.google.com/google-ads/api/docs/reporting/example :contentReference[oaicite:0]{index=0}
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date DURING ${dateRange}
      AND campaign.status != 'REMOVED'
  `;
}

// ---------------------------------------------------------------------
// Chamada genérica: Search (paginado)
// ---------------------------------------------------------------------

/**
 * Executa uma consulta GAQL usando o método Search (paginado).
 * - Page size padrão do Google Ads é 10.000 linhas.
 *
 * @param {Object} params
 * @param {string} params.query - GAQL query (obrigatório)
 * @param {string} [params.pageToken] - token de próxima página (opcional)
 * @returns {Promise<{results: any[], nextPageToken?: string, fieldMask?: string}>}
 */
export async function googleAdsSearch({ query, pageToken } = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('googleAdsSearch: "query" (GAQL) é obrigatório.');
  }

  const url = `${GOOGLE_ADS_BASE_URL}/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;

  const body = {
    query,
  };

  if (pageToken) {
    body.pageToken = pageToken;
  }

  const headers = buildDefaultHeaders();

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Erro Google Ads Search:', res.status, text);
    throw new Error(
      `Google Ads Search falhou. HTTP ${res.status} - ${res.statusText}`,
    );
  }

  const data = await res.json();

  return {
    results: Array.isArray(data.results) ? data.results : [],
    nextPageToken: data.nextPageToken || null,
    fieldMask: data.fieldMask || null,
  };
}

// ---------------------------------------------------------------------
// Chamada genérica: SearchStream (stream de resultados)
// ---------------------------------------------------------------------

/**
 * Executa uma consulta GAQL usando o método SearchStream
 * e retorna todos os resultados combinados em um único array.
 *
 * A resposta oficial é um array de "chunks" com `results` dentro. :contentReference[oaicite:1]{index=1}
 *
 * @param {Object} params
 * @param {string} params.query - GAQL query (obrigatório)
 * @returns {Promise<{results: any[], raw: any[]}>}
 */
export async function googleAdsSearchStream({ query } = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('googleAdsSearchStream: "query" (GAQL) é obrigatório.');
  }

  const url = `${GOOGLE_ADS_BASE_URL}/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:searchStream`;

  const headers = buildDefaultHeaders();

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Erro Google Ads SearchStream:', res.status, text);
    throw new Error(
      `Google Ads SearchStream falhou. HTTP ${res.status} - ${res.statusText}`,
    );
  }

  // A resposta do SearchStream é uma lista de objetos com "results"
  const chunks = await res.json();

  const allRows = [];
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (Array.isArray(chunk.results)) {
        allRows.push(...chunk.results);
      }
    }
  }

  return {
    results: allRows,
    raw: chunks,
  };
}

// ---------------------------------------------------------------------
// Funções de "alto nível" (para usar nos controllers)
// ---------------------------------------------------------------------

/**
 * Exemplo pronto: performance de campanhas nos últimos 30 dias.
 * - Ideal para primeiro dashboard de marketing dentro do ERP.
 */
export async function getCampaignPerformanceLast30Days() {
  const query = buildCampaignPerformanceQuery({ dateRange: 'LAST_30_DAYS' });

  // Aqui usamos SearchStream para puxar tudo de uma vez.
  const { results } = await googleAdsSearchStream({ query });

  // Normaliza os campos mais importantes para o ERP
  return results.map((row) => {
    const campaign = row.campaign || {};
    const metrics = row.metrics || {};
    const segments = row.segments || {};

    // cost_micros → converte para reais (assumindo BRL) dividindo por 1.000.000
    const costMicros = Number(metrics.costMicros || metrics.cost_micros || 0);
    const cost = costMicros / 1_000_000;

    return {
      campaignId: campaign.id || null,
      campaignName: campaign.name || '',
      status: campaign.status || '',
      channelType: campaign.advertisingChannelType || campaign.advertising_channel_type || '',
      date: segments.date || null,
      impressions: Number(metrics.impressions || 0),
      clicks: Number(metrics.clicks || 0),
      ctr: Number(metrics.ctr || 0),
      averageCpcMicros: Number(metrics.averageCpc || metrics.average_cpc || 0),
      costMicros,
      cost,
      conversions: Number(metrics.conversions || 0),
      conversionsValue: Number(metrics.conversionsValue || metrics.conversions_value || 0),
    };
  });
}

// ---------------------------------------------------------------------
// Export default (se quiser importar tudo de uma vez)
// ---------------------------------------------------------------------
export default {
  buildCampaignPerformanceQuery,
  googleAdsSearch,
  googleAdsSearchStream,
  getCampaignPerformanceLast30Days,
};
