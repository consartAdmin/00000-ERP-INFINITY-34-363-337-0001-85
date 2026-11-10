// ╔════════════════════════════════════════════════════════════════════╗
// ║ betterDateToBuyQuery.repository.js — Melhor Data de Compra          ║
// ║ Tabela: "betterDateToBuy" (+ customers)                            ║
// ║ Histórico de compras: public."invoicesIssued" + orders (NF-e de    ║
// ║ saída, sem canceladas/rejeitadas), igual ao Relatório de Vendas.   ║
// ║                                                                    ║
// ║ Situação de cada alerta (calculada no fuso America/Sao_Paulo):     ║
// ║  - paused    → status <> 'active'                                  ║
// ║  - contacted → já marcado como contatado neste mês                 ║
// ║  - due       → dia do alerta já chegou neste mês (pendente)        ║
// ║  - upcoming  → dia do alerta ainda vai chegar neste mês            ║
// ║ Dia 29–31 em meses mais curtos vira o último dia do mês.           ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// NF-e que não contam como venda (mesma regra do salesAnalytics)
const NFE_EXCLUDED_STATUSES = [
  'CANCELADO', 'CANCELADA', 'CANCELLED', 'DENIED',
  'REJEITADO', 'REJEITADA', 'REJECTED',
];

// Avisar alguns dias antes do dia em que o cliente costuma comprar
export const SUGGESTION_LEAD_DAYS = 3;

const TODAY_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

// Campos calculados da situação do alerta (b = "betterDateToBuy")
const SITUATION_SQL = `
  t.today,
  LEAST(b.alert_day, t.month_last_day)::int AS effective_day,
  CASE
    WHEN COALESCE(b.status, 'active') <> 'active' THEN 'paused'
    WHEN b.last_alert_sent IS NOT NULL
         AND DATE_TRUNC('month', b.last_alert_sent) = DATE_TRUNC('month', t.today)
      THEN 'contacted'
    WHEN LEAST(b.alert_day, t.month_last_day) <= EXTRACT(DAY FROM t.today)::int THEN 'due'
    ELSE 'upcoming'
  END AS situation,
  (LEAST(b.alert_day, t.month_last_day) - EXTRACT(DAY FROM t.today)::int) AS days_until
`;

const TODAY_CTE = `
  t AS (
    SELECT
      ${TODAY_SQL} AS today,
      EXTRACT(DAY FROM (DATE_TRUNC('month', ${TODAY_SQL}) + INTERVAL '1 month - 1 day'))::int
        AS month_last_day
  )
`;

const BASE_SELECT = `
  WITH ${TODAY_CTE}
  SELECT
    b.better_date_to_buy_id,
    b.customer_id,
    b.alert_day,
    b.notes,
    COALESCE(b.status, 'active') AS status,
    b.last_alert_sent,
    b.created_at,
    b.updated_at,
    c.trade_name,
    c.legal_name,
    c.mobile_number,
    c.phone_number,
    ${SITUATION_SQL}
  FROM "betterDateToBuy" b
  CROSS JOIN t
  LEFT JOIN customers c
    ON c.customer_id = b.customer_id
`;


// ──────────────────────────────────────────────────────────────────────
// HISTÓRICO DE COMPRAS (por cliente)
//
// Para cada cliente devolve:
//   last_purchase_date / last_nfe_number / last_purchase_total
//   purchases_12m / total_12m        → NF-e dos últimos 12 meses
//   avg_interval_days                → intervalo médio entre compras (12m)
//   usual_day                        → dia do mês em que costuma comprar
//   suggested_day                    → usual_day − SUGGESTION_LEAD_DAYS
//   next_expected_date               → última compra + intervalo médio
//
// Se a tabela de NF-e não existir no banco (ex.: ambiente sem fiscal),
// devolve um Map vazio: a tela continua funcionando sem o histórico.
// ──────────────────────────────────────────────────────────────────────
export async function getPurchaseStats(customerIds = null) {
  const ids = Array.isArray(customerIds)
    ? customerIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : null;

  if (ids && !ids.length) return new Map();

  const sql = `
    WITH inv AS (
      SELECT
        o.customer_id,
        ii.invoice_id,
        ii.nfe_number,
        ii.issued_date::date AS d,
        COALESCE(ii.total_amount, 0)::numeric AS total
      FROM public."invoicesIssued" ii
      JOIN public."orders" o
        ON o.order_id = ii.order_id
      WHERE ii.issued_date IS NOT NULL
        AND ii.cancelled_at IS NULL
        AND UPPER(COALESCE(ii.nfe_status, '')) <> ALL($1::text[])
        AND o.customer_id IS NOT NULL
        AND ($2::int[] IS NULL OR o.customer_id = ANY($2::int[]))
    ),
    last_inv AS (
      SELECT DISTINCT ON (customer_id)
        customer_id,
        d AS last_purchase_date,
        nfe_number AS last_nfe_number,
        total AS last_purchase_total
      FROM inv
      ORDER BY customer_id, d DESC, invoice_id DESC
    ),
    year_inv AS (
      SELECT
        customer_id,
        COUNT(*)::int AS purchases_12m,
        SUM(total)::numeric AS total_12m,
        COUNT(DISTINCT d)::int AS distinct_days,
        MIN(d) AS first_d,
        MAX(d) AS last_d,
        ARRAY_AGG(EXTRACT(DAY FROM d)::int) AS days_12m
      FROM inv
      WHERE d >= (${TODAY_SQL} - INTERVAL '12 months')
      GROUP BY customer_id
    )
    SELECT
      l.customer_id,
      l.last_purchase_date,
      l.last_nfe_number,
      l.last_purchase_total,
      COALESCE(y.purchases_12m, 0) AS purchases_12m,
      COALESCE(y.total_12m, 0) AS total_12m,
      CASE WHEN y.distinct_days >= 2
        THEN ROUND((y.last_d - y.first_d)::numeric / (y.distinct_days - 1))::int
      END AS avg_interval_days,
      y.days_12m
    FROM last_inv l
    LEFT JOIN year_inv y
      ON y.customer_id = l.customer_id
  `;

  try {
    const { rows } = await pool.query(sql, [NFE_EXCLUDED_STATUSES, ids]);
    const map = new Map();

    for (const row of rows) {
      map.set(Number(row.customer_id), enrichStats(row));
    }

    return map;
  } catch (err) {
    console.warn('[betterDateToBuy] histórico de compras indisponível:', err.message);
    return new Map();
  }
}

function toYmd(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

// Dia do mês em que o cliente costuma comprar (mediana). Trata a virada
// do mês: compras nos dias 29, 30, 1 e 2 dão "dia 30", e não "dia 2".
function usualDayOf(days = []) {
  const list = (days || []).map(Number).filter((d) => d >= 1 && d <= 31);
  if (!list.length) return null;

  const median = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  };
  const spread = (arr, m) => arr.reduce((sum, d) => sum + Math.abs(d - m), 0);

  const linear = median(list);
  const wrapped = list.map((d) => (d <= 15 ? d + 30 : d));
  const wrappedMedian = median(wrapped);

  const day = spread(wrapped, wrappedMedian) < spread(list, linear)
    ? wrappedMedian
    : linear;

  return day > 30 ? day - 30 : day;
}

// Dia do alerta = alguns dias antes do dia usual (volta para o fim do
// mês anterior quando passa do dia 1: dia usual 2 → alerta dia 29).
function suggestedDayOf(usualDay) {
  if (!usualDay) return null;
  const day = usualDay - SUGGESTION_LEAD_DAYS;
  return day >= 1 ? day : day + 30;
}

function enrichStats(row) {
  const lastYmd = toYmd(row.last_purchase_date);
  const interval = row.avg_interval_days != null ? Number(row.avg_interval_days) : null;
  const usualDay = usualDayOf(row.days_12m);

  let nextExpected = null;
  if (lastYmd && interval && interval > 0) {
    const [y, m, d] = lastYmd.split('-').map(Number);
    const next = new Date(y, m - 1, d + interval);
    nextExpected = toYmd(next);
  }

  return {
    last_purchase_date: lastYmd,
    last_nfe_number: row.last_nfe_number ?? null,
    last_purchase_total: row.last_purchase_total != null ? Number(row.last_purchase_total) : null,
    purchases_12m: Number(row.purchases_12m || 0),
    total_12m: Number(row.total_12m || 0),
    avg_interval_days: interval,
    usual_day: usualDay,
    suggested_day: suggestedDayOf(usualDay),
    next_expected_date: nextExpected,
  };
}

async function attachStats(rows) {
  const stats = await getPurchaseStats(rows.map((r) => r.customer_id));
  return rows.map((row) => ({
    ...row,
    today: toYmd(row.today),
    last_alert_sent: toYmd(row.last_alert_sent),
    ...(stats.get(Number(row.customer_id)) || {}),
  }));
}


// ──────────────────────────────────────────────────────────────────────
// LISTA TODOS OS ALERTAS (com situação e histórico de compras)
// ──────────────────────────────────────────────────────────────────────
export async function getAllBetterDates() {
  const sql = `
    ${BASE_SELECT}
    ORDER BY
      b.alert_day ASC,
      c.trade_name ASC
  `;

  const { rows } = await pool.query(sql);
  return attachStats(rows);
}


// ──────────────────────────────────────────────────────────────────────
// UM ALERTA
// ──────────────────────────────────────────────────────────────────────
export async function getBetterDateById(id) {
  const sql = `
    ${BASE_SELECT}
    WHERE b.better_date_to_buy_id = $1
  `;

  const { rows } = await pool.query(sql, [id]);
  if (!rows[0]) return null;

  const [row] = await attachStats(rows);
  return row;
}


// ──────────────────────────────────────────────────────────────────────
// ALERTA JÁ EXISTENTE PARA O CLIENTE (evita duplicar)
// ──────────────────────────────────────────────────────────────────────
export async function findByCustomer(customerId, exceptId = null) {
  const { rows } = await pool.query(
    `SELECT better_date_to_buy_id
       FROM "betterDateToBuy"
      WHERE customer_id = $1
        AND ($2::int IS NULL OR better_date_to_buy_id <> $2::int)
      LIMIT 1`,
    [customerId, exceptId]
  );
  return rows[0] || null;
}


// ──────────────────────────────────────────────────────────────────────
// CLIENTES PARA CONTATAR (usado no painel da Home)
//
// Regras:
// 1. status ativo
// 2. o dia do alerta já chegou neste mês (não só o dia exato:
//    quem não foi contatado no dia continua aparecendo)
// 3. ainda não foi marcado como contatado neste mês
// ──────────────────────────────────────────────────────────────────────
export async function getTodayAlerts() {
  const sql = `
    SELECT * FROM (
      ${BASE_SELECT}
    ) x
    WHERE x.situation = 'due'
    ORDER BY x.effective_day ASC, x.trade_name ASC
  `;

  const { rows } = await pool.query(sql);
  return attachStats(rows);
}


// ──────────────────────────────────────────────────────────────────────
// SUGESTÕES: clientes que compram com frequência e ainda não têm alerta
// (3+ NF-e nos últimos 12 meses e compra nos últimos 120 dias)
// ──────────────────────────────────────────────────────────────────────
export async function getSuggestions({ minPurchases = 3, limit = 100 } = {}) {
  const sql = `
    WITH inv AS (
      SELECT o.customer_id, ii.issued_date::date AS d
      FROM public."invoicesIssued" ii
      JOIN public."orders" o
        ON o.order_id = ii.order_id
      WHERE ii.issued_date IS NOT NULL
        AND ii.cancelled_at IS NULL
        AND UPPER(COALESCE(ii.nfe_status, '')) <> ALL($1::text[])
        AND o.customer_id IS NOT NULL
        AND ii.issued_date >= (${TODAY_SQL} - INTERVAL '12 months')
    )
    SELECT
      inv.customer_id,
      c.trade_name,
      c.legal_name,
      c.mobile_number,
      c.phone_number,
      COUNT(*)::int AS n
    FROM inv
    JOIN customers c
      ON c.customer_id = inv.customer_id
    WHERE NOT EXISTS (
      SELECT 1 FROM "betterDateToBuy" b WHERE b.customer_id = inv.customer_id
    )
    GROUP BY inv.customer_id, c.trade_name, c.legal_name, c.mobile_number, c.phone_number
    HAVING COUNT(*) >= $2
       AND MAX(inv.d) >= (${TODAY_SQL} - INTERVAL '120 days')
    ORDER BY COUNT(*) DESC, c.trade_name ASC
    LIMIT $3
  `;

  let rows;
  try {
    ({ rows } = await pool.query(sql, [NFE_EXCLUDED_STATUSES, minPurchases, limit]));
  } catch (err) {
    console.warn('[betterDateToBuy] sugestões indisponíveis:', err.message);
    return [];
  }

  const stats = await getPurchaseStats(rows.map((r) => r.customer_id));
  return rows
    .map(({ n, ...row }) => ({ ...row, ...(stats.get(Number(row.customer_id)) || {}) }))
    .filter((row) => row.suggested_day);
}
