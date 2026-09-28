// ╔════════════════════════════════════════════════════════════════════╗
// ║ analyticsGa4Api.js — Consulta GA4 (Realtime / Summary)              ║
// ║ CONSART ERP | Server-side (ESM)                                     ║
// ║                                                                    ║
// ║ Realtime: activeUsers (estável)                                     ║
// ║ Summary (7 dias): sessions, totalUsers, eventCount, conversions,    ║
// ║                 screenPageViews                                     ║
// ╚════════════════════════════════════════════════════════════════════╝

import { BetaAnalyticsDataClient } from '@google-analytics/data';

// ---------------------------------------------------------------------
// ENV guards
// ---------------------------------------------------------------------
const GA4_PROPERTY_ID  = process.env.GA4_PROPERTY_ID;
const GA4_CLIENT_EMAIL = process.env.GA4_CLIENT_EMAIL;
const GA4_PRIVATE_KEY  = process.env.GA4_PRIVATE_KEY;

if (!GA4_PROPERTY_ID)  console.warn('[GA4] ⚠ GA4_PROPERTY_ID não definido no .env');
if (!GA4_CLIENT_EMAIL) console.warn('[GA4] ⚠ GA4_CLIENT_EMAIL não definido no .env');
if (!GA4_PRIVATE_KEY)  console.warn('[GA4] ⚠ GA4_PRIVATE_KEY não definido no .env');

const client = new BetaAnalyticsDataClient({
  credentials: {
    client_email: GA4_CLIENT_EMAIL,
    private_key: (GA4_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
});

const property = `properties/${GA4_PROPERTY_ID}`;

// ---------------------------------------------------------------------
// 🔴 Realtime — estável (recomendado)
// ---------------------------------------------------------------------
export async function getRealtime() {
  const [response] = await client.runRealtimeReport({
    property,
    metrics: [{ name: 'activeUsers' }],
  });

  return response;
}

// ---------------------------------------------------------------------
// 📊 Summary — últimos 7 dias (agregado)
// ---------------------------------------------------------------------
export async function getSummary() {
  const [response] = await client.runReport({
    property,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'eventCount' },
      { name: 'conversions' },
      { name: 'screenPageViews' }, // ✅ Pageviews REAL
    ],
  });

  return response;
}
