// ╔══════════════════════════════════════════════════════════════════════╗
// ║ googleAdsCampaignDetailsautoConversionDispatcher.js                  ║
// ║ Auto Conversion Dispatcher (Tracking → Google Ads)                  ║
// ║ CONSART ERP | ESM                                                   ║
// ║                                                                  ║
// ║ 🎯 Responsabilidade:                                              ║
// ║ - Ler eventos de conversão do tracking_events                     ║
// ║ - Normalizar para padrão Google Ads                               ║
// ║ - Despachar conversões automaticamente                            ║
// ║ - Evitar duplicidade (idempotência)                               ║
// ║                                                                  ║
// ║ 🔒 Compatível com GAQL Version Guard                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import googleAdsConversionApi from './googleAdsConversionApi.js';

/* ------------------------------------------------------------------ */
/* CONFIGURAÇÃO                                                       */
/* ------------------------------------------------------------------ */

// Mapeamento EVENTO → CONVERSÃO GOOGLE ADS
const EVENT_CONVERSION_MAP = Object.freeze({
  purchase: {
    conversionAction: 'Purchase',
    requiredValue: true,
  },
  begin_checkout: {
    conversionAction: 'Begin Checkout',
    requiredValue: false,
  },
  add_to_cart: {
    conversionAction: 'Add To Cart',
    requiredValue: false,
  },
});

// Evita reenviar conversões já despachadas
const DISPATCH_SOURCE = 'AUTO-GADS';

/* ------------------------------------------------------------------ */
/* UTILS                                                              */
/* ------------------------------------------------------------------ */

function normalizeCurrency(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nowAsGoogleDateTime() {
  // Google Ads exige formato: YYYY-MM-DD HH:MM:SS+00:00
  return new Date().toISOString().replace('T', ' ').replace('Z', '+00:00');
}

/* ------------------------------------------------------------------ */
/* QUERY BASE                                                         */
/* ------------------------------------------------------------------ */

async function fetchPendingConversionEvents({ limit = 50 }) {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      created_at,
      event,
      value,
      currency,
      campaign_id,
      session_id,
      user_agent,
      ip_address
    FROM public.tracking_events
    WHERE event = ANY($1)
      AND source = 'ERP'
      AND id NOT IN (
        SELECT tracking_event_id
        FROM public.tracking_conversions_dispatch_log
      )
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [Object.keys(EVENT_CONVERSION_MAP), limit]
  );

  return rows || [];
}

/* ------------------------------------------------------------------ */
/* DISPATCH LOG                                                       */
/* ------------------------------------------------------------------ */

async function markAsDispatched({
  trackingEventId,
  conversionAction,
  googleClickId,
}) {
  await pool.query(
    `
    INSERT INTO public.tracking_conversions_dispatch_log
      (tracking_event_id, conversion_action, gclid, source)
    VALUES ($1, $2, $3, $4)
    `,
    [trackingEventId, conversionAction, googleClickId, DISPATCH_SOURCE]
  );
}

/* ------------------------------------------------------------------ */
/* DISPATCHER PRINCIPAL                                               */
/* ------------------------------------------------------------------ */

export async function dispatchAutoConversions({
  customerId,
  conversionActionsMap,
  limit = 25,
}) {
  const events = await fetchPendingConversionEvents({ limit });

  if (!events.length) {
    return { dispatched: 0, skipped: 0 };
  }

  let dispatched = 0;
  let skipped = 0;

  for (const ev of events) {
    const rule = EVENT_CONVERSION_MAP[ev.event];
    if (!rule) {
      skipped++;
      continue;
    }

    if (rule.requiredValue && !ev.value) {
      skipped++;
      continue;
    }

    const conversionActionId = conversionActionsMap?.[rule.conversionAction];
    if (!conversionActionId) {
      skipped++;
      continue;
    }

    try {
      const payload = {
        customerId,
        conversionActionId,
        conversionDateTime: nowAsGoogleDateTime(),
        conversionValue: normalizeCurrency(ev.value),
        currencyCode: ev.currency || 'BRL',
        campaignId: ev.campaign_id || undefined,
        gclid: ev.session_id || undefined,
      };

      await googleAdsConversionApi.uploadConversion(payload);

      await markAsDispatched({
        trackingEventId: ev.id,
        conversionAction: rule.conversionAction,
        googleClickId: ev.session_id || null,
      });

      dispatched++;
    } catch (err) {
      console.error(
        '[AutoConversionDispatcher] Failed:',
        ev.id,
        err?.message || err
      );
      skipped++;
    }
  }

  return { dispatched, skipped };
}

/* ------------------------------------------------------------------ */
/* EXPORT DEFAULT (CRON / JOB)                                         */
/* ------------------------------------------------------------------ */

export default {
  dispatchAutoConversions,
};
