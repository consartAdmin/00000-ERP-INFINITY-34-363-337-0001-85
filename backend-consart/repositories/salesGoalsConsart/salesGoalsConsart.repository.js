// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesGoalsConsart.repository.js — Metas de vendas (CONSART ERP)    ║
// ║ • Meta x Realizado por vendedor e por estado (UF) no mês.          ║
// ║ • Realizado (FACTS_SQL, um fato por linha):                        ║
// ║   value/count → Propostas de Serviços APROVADAS (issue_date)       ║
// ║   sent        → propostas emitidas, menos rascunho (issue_date)    ║
// ║   leads       → cards do CRM Consart concluídos (outcome_at):      ║
// ║                 Conversão, Queda de venda ou Sem sucesso           ║
// ║   conversions → cards concluídos como Conversão                    ║
// ║   recurring   → mensalidade de contratos ATIVO/ENCERRADO pela      ║
// ║                 assinatura (senão início, senão emissão)           ║
// ║ • UF = estado do cliente (customersConsart).                       ║
// ║ • getHistory: evolução mês a mês para os gráficos do painel.       ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, TB_STATES, ensureSalesGoalsConsartTable } from './salesGoalsConsart.schema.js';
import {
  TB as TB_PROPOSALS,
  ensureProposalsServicesConsartTables,
} from '../proposalsServicesConsart/proposalsServicesConsart.schema.js';
import {
  TB as TB_CONTRACTS,
  ensureContractsConsartTables,
} from '../contractsConsart/contractsConsart.schema.js';

const TB_SELLERS = 'public."sellersConsart"';
const TB_CUSTOMERS = 'public."customersConsart"';
const TB_DEALS = 'public."crmDeals"';

export const SALE_STATUS = 'APROVADA';

// Cards concluídos do CRM Consart (crmDeals.crm_company), por desfecho
const LEAD_OUTCOMES = Object.freeze(['CONVERSION', 'LOSS', 'LOST', 'NO_SUCCESS_CONTACT']);
const LEADS_WHERE = `
  d.crm_company = 'CONSART'
  AND COALESCE(d.is_closed, FALSE) = TRUE
  AND UPPER(COALESCE(d.outcome, '')) = ANY($LEADS_OUTCOMES::text[])
`;
const leadsWhere = (paramIndex) => LEADS_WHERE.replace('$LEADS_OUTCOMES', `$${paramIndex}`);

// Metas por vendedor e por estado: chave → dinheiro (R$) ou contagem
export const SELLER_METRICS = Object.freeze(['value', 'count', 'sent', 'leads', 'conversions', 'recurring']);
export const STATE_METRICS = Object.freeze(['leads', 'conversions', 'value']);
const MONEY_METRICS = new Set(['value', 'recurring']);

export const UFS = Object.freeze(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']);

/**
 * Fatos do realizado entre [$from, $to): (seller_id, customer_id, fact_date, metric, amount).
 * Os desfechos dos leads vão no parâmetro $outcomes (LEAD_OUTCOMES).
 */
function factsSql(from, to, outcomes) {
  const proposalDate = `p.issue_date >= $${from}::date AND p.issue_date < $${to}::date`;
  const dealDate = `d.outcome_at >= $${from}::date AND d.outcome_at < $${to}::date`;
  const contractDate = 'COALESCE(c.signing_date, c.start_date, c.issue_date)';
  return `
    SELECT p.seller_id, p.customer_id, p.issue_date AS fact_date, 'value' AS metric, p.total::numeric AS amount
      FROM ${TB_PROPOSALS} p WHERE p.status = '${SALE_STATUS}' AND ${proposalDate}
    UNION ALL
    SELECT p.seller_id, p.customer_id, p.issue_date, 'count', 1
      FROM ${TB_PROPOSALS} p WHERE p.status = '${SALE_STATUS}' AND ${proposalDate}
    UNION ALL
    SELECT p.seller_id, p.customer_id, p.issue_date, 'sent', 1
      FROM ${TB_PROPOSALS} p WHERE p.status <> 'RASCUNHO' AND ${proposalDate}
    UNION ALL
    SELECT d.seller_id, d.customer_id, d.outcome_at::date, 'leads', 1
      FROM ${TB_DEALS} d WHERE ${leadsWhere(outcomes)} AND ${dealDate}
    UNION ALL
    SELECT d.seller_id, d.customer_id, d.outcome_at::date, 'conversions', 1
      FROM ${TB_DEALS} d WHERE ${leadsWhere(outcomes)} AND UPPER(d.outcome) = 'CONVERSION' AND ${dealDate}
    UNION ALL
    SELECT c.seller_id, c.customer_id, ${contractDate}, 'recurring', COALESCE(c.recurring_total, c.total)
      FROM ${TB_CONTRACTS} c
     WHERE c.status IN ('ATIVO', 'ENCERRADO')
       AND ${contractDate} >= $${from}::date AND ${contractDate} < $${to}::date
  `;
}

/** SUM(amount) de cada métrica como colunas done_<métrica>. */
function doneColumns(metrics, alias = 'f') {
  return metrics
    .map((m) => `COALESCE(SUM(${alias}.amount) FILTER (WHERE ${alias}.metric = '${m}'), 0) AS done_${m}`)
    .join(',\n             ');
}

/** Monta goal_/done_/pct_ de cada métrica numa linha do banco. */
function metricRow(r, metrics) {
  const row = {};
  for (const m of metrics) {
    const goal = Number(r[`goal_${m}`] || 0);
    const done = Number(r[`done_${m}`] || 0);
    row[`goal_${m}`] = MONEY_METRICS.has(m) ? round2(goal) : goal;
    row[`done_${m}`] = MONEY_METRICS.has(m) ? round2(done) : done;
    row[`pct_${m}`] = percent(done, goal);
  }
  return row;
}

function totalsOf(rows, metrics) {
  const t = {};
  for (const m of metrics) {
    t[`goal_${m}`] = round2(rows.reduce((acc, r) => acc + r[`goal_${m}`], 0));
    t[`done_${m}`] = round2(rows.reduce((acc, r) => acc + r[`done_${m}`], 0));
    t[`pct_${m}`] = percent(t[`done_${m}`], t[`goal_${m}`]);
  }
  return t;
}

function cleanGoal(g, metrics) {
  const out = {};
  for (const m of metrics) {
    const n = Math.max(0, toNumber(g[`goal_${m}`]));
    out[`goal_${m}`] = MONEY_METRICS.has(m) ? round2(n) : Math.trunc(n);
  }
  out.notes = String(g.notes || '').trim().slice(0, 255) || null;
  return out;
}

/** Grava metas (upsert por chave); meta toda zerada e sem observação é removida. */
async function upsertGoals({ table, keyCol, period, goals, metrics, user }) {
  const cols = metrics.map((m) => `goal_${m}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const g of goals) {
      const empty = cols.every((c) => !g[c]) && !g.notes;
      if (empty) {
        await client.query(
          `DELETE FROM ${table} WHERE goal_year = $1 AND goal_month = $2 AND ${keyCol} = $3`,
          [period.year, period.month, g.key]
        );
        continue;
      }
      const values = [period.year, period.month, g.key, ...cols.map((c) => g[c]), g.notes,
        positiveId(user?.user_id ?? user?.id), user?.name || null];
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(
        `INSERT INTO ${table}
           (goal_year, goal_month, ${keyCol}, ${cols.join(', ')}, notes, created_by, created_by_name)
         VALUES (${placeholders})
         ON CONFLICT (goal_year, goal_month, ${keyCol}) DO UPDATE SET
           ${[...cols, 'notes'].map((c) => `${c} = EXCLUDED.${c}`).join(',\n           ')},
           updated_at = NOW()`,
        values
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Valida ano/mês e devolve o intervalo [from, to) do mês. */
export function parsePeriod(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw validationError('Ano inválido.');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw validationError('Mês inválido.');
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m)}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { year: y, month: m, from, to };
}

async function ensureTables() {
  await ensureProposalsServicesConsartTables();
  await ensureContractsConsartTables();
  await ensureSalesGoalsConsartTable();
}

function percent(done, goal) {
  return goal > 0 ? round2((done / goal) * 100) : null;
}

/**
 * Meta x Realizado do mês por vendedor. Lista os vendedores ativos e também
 * os inativos que tenham meta ou realizado no mês.
 */
export async function getMonth({ year, month, seller_id } = {}) {
  await ensureTables();
  const period = parsePeriod(year, month);
  const sellerId = positiveId(seller_id);

  const params = [period.year, period.month, period.from, period.to, LEAD_OUTCOMES];
  let sellerFilter = '';
  if (sellerId) {
    params.push(sellerId);
    sellerFilter = `AND s.id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    WITH facts AS (${factsSql(3, 4, 5)}),
    done AS (
      SELECT f.seller_id,
             ${doneColumns(SELLER_METRICS)}
        FROM facts f
       WHERE f.seller_id IS NOT NULL
       GROUP BY f.seller_id
    )
    SELECT s.id AS seller_id,
           COALESCE(NULLIF(s.nickname, ''), s.name) AS seller_name,
           COALESCE(s.active, TRUE)                 AS seller_active,
           g.id AS goal_id,
           g.notes,
           ${SELLER_METRICS.map((m) => `COALESCE(g.goal_${m}, 0) AS goal_${m}`).join(', ')},
           ${SELLER_METRICS.map((m) => `COALESCE(x.done_${m}, 0) AS done_${m}`).join(', ')}
      FROM ${TB_SELLERS} s
      LEFT JOIN ${TB} g ON g.seller_id = s.id AND g.goal_year = $1 AND g.goal_month = $2
      LEFT JOIN done x ON x.seller_id = s.id
     WHERE (COALESCE(s.active, TRUE) OR g.id IS NOT NULL OR x.seller_id IS NOT NULL)
       ${sellerFilter}
     ORDER BY seller_name
    `,
    params
  );

  const data = rows.map((r) => ({
    seller_id: Number(r.seller_id),
    seller_name: r.seller_name,
    seller_active: r.seller_active,
    has_goal: !!r.goal_id,
    notes: r.notes || '',
    ...metricRow(r, SELLER_METRICS),
  }));

  return { year: period.year, month: period.month, rows: data, totals: totalsOf(data, SELLER_METRICS) };
}

/** Grava as metas do mês por vendedor (uma linha por vendedor). */
export async function saveMonth({ year, month }, goals, user) {
  await ensureTables();
  const period = parsePeriod(year, month);
  if (!Array.isArray(goals)) throw validationError('Envie a lista de metas.');

  const clean = goals
    .map((g) => ({ key: positiveId(g.seller_id), ...cleanGoal(g, SELLER_METRICS) }))
    .filter((g) => g.key);

  await upsertGoals({ table: TB, keyCol: 'seller_id', period, goals: clean, metrics: SELLER_METRICS, user });
  return getMonth(period);
}

/** Propostas aprovadas que entraram no realizado do mês (detalhe por vendedor). */
export async function listSales({ year, month, seller_id } = {}) {
  await ensureTables();
  const period = parsePeriod(year, month);
  const params = [period.from, period.to, SALE_STATUS];
  let sellerFilter = '';
  const sellerId = positiveId(seller_id);
  if (sellerId) {
    params.push(sellerId);
    sellerFilter = `AND p.seller_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    SELECT p.id,
           p.number_year::text || '/' || lpad(p.number_seq::text, 4, '0') AS number,
           to_char(p.issue_date, 'YYYY-MM-DD') AS issue_date,
           p.customer_name, p.title, p.seller_id, p.seller_name, p.total
      FROM ${TB_PROPOSALS} p
     WHERE p.status = $3
       AND p.issue_date >= $1::date
       AND p.issue_date <  $2::date
       ${sellerFilter}
     ORDER BY p.issue_date, p.id
    `,
    params
  );

  return rows.map((r) => ({ ...r, total: Number(r.total || 0) }));
}

/**
 * Evolução mês a mês (gráfico): meta x realizado dos últimos `months` meses
 * terminando no mês informado. Com seller_id, só daquele vendedor.
 */
export async function getHistory({ year, month, months = 12, seller_id } = {}) {
  await ensureTables();
  const period = parsePeriod(year, month);
  const n = Math.min(24, Math.max(1, Math.trunc(Number(months) || 12)));
  const sellerId = positiveId(seller_id);

  // $1 início do 1º mês · $2 fim do mês informado · $3 desfechos · $4 nº de meses
  const first = new Date(Date.UTC(period.year, period.month - n, 1)).toISOString().slice(0, 10);
  const params = [first, period.to, LEAD_OUTCOMES, n];
  let goalSeller = '';
  let factSeller = '';
  if (sellerId) {
    params.push(sellerId);
    goalSeller = `AND g.seller_id = $${params.length}`;
    factSeller = `AND f.seller_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    WITH months AS (
      SELECT ($1::date + make_interval(months => s.i))::date AS month_start
        FROM generate_series(0, $4::int - 1) AS s(i)
    ),
    facts AS (${factsSql(1, 2, 3)}),
    done AS (
      SELECT date_trunc('month', f.fact_date)::date AS month_start,
             ${doneColumns(SELLER_METRICS)}
        FROM facts f
       WHERE TRUE ${factSeller}
       GROUP BY 1
    ),
    goals AS (
      SELECT make_date(g.goal_year, g.goal_month, 1) AS month_start,
             ${SELLER_METRICS.map((m) => `SUM(g.goal_${m}) AS goal_${m}`).join(', ')}
        FROM ${TB} g
       WHERE TRUE ${goalSeller}
       GROUP BY 1
    )
    SELECT EXTRACT(YEAR FROM m.month_start)::int  AS year,
           EXTRACT(MONTH FROM m.month_start)::int AS month,
           ${SELLER_METRICS.map((m) => `COALESCE(g.goal_${m}, 0) AS goal_${m}, COALESCE(x.done_${m}, 0) AS done_${m}`).join(',\n           ')}
      FROM months m
      LEFT JOIN done x ON x.month_start = m.month_start
      LEFT JOIN goals g ON g.month_start = m.month_start
     ORDER BY m.month_start
    `,
    params
  );

  return rows.map((r) => {
    const row = { year: r.year, month: r.month };
    for (const m of SELLER_METRICS) {
      row[`goal_${m}`] = Number(r[`goal_${m}`]);
      row[`done_${m}`] = Number(r[`done_${m}`]);
    }
    return row;
  });
}

/**
 * Plano por estado: meta x realizado do mês por UF do cliente
 * (leads contatados, conversões e valor vendido) + cards abertos no CRM.
 * Lista as UFs com meta, realizado ou cards abertos.
 */
export async function getStatesMonth({ year, month } = {}) {
  await ensureTables();
  const period = parsePeriod(year, month);
  const params = [period.from, period.to, LEAD_OUTCOMES, period.year, period.month];

  const { rows } = await pool.query(
    `
    WITH facts AS (${factsSql(1, 2, 3)}),
    done AS (
      SELECT UPPER(TRIM(c.state)) AS state,
             ${doneColumns(STATE_METRICS)}
        FROM facts f
        JOIN ${TB_CUSTOMERS} c ON c.customer_id = f.customer_id
       WHERE COALESCE(TRIM(c.state), '') <> ''
       GROUP BY 1
    ),
    open_leads AS (
      SELECT UPPER(TRIM(c.state)) AS state, COUNT(*)::int AS open_leads
        FROM ${TB_DEALS} d
        JOIN ${TB_CUSTOMERS} c ON c.customer_id = d.customer_id
       WHERE d.crm_company = 'CONSART'
         AND NOT COALESCE(d.is_closed, FALSE)
         AND COALESCE(TRIM(c.state), '') <> ''
       GROUP BY 1
    ),
    goals AS (
      SELECT * FROM ${TB_STATES} WHERE goal_year = $4 AND goal_month = $5
    ),
    states AS (
      SELECT state FROM done UNION SELECT state FROM open_leads UNION SELECT state FROM goals
    )
    SELECT s.state,
           g.id AS goal_id,
           g.notes,
           COALESCE(o.open_leads, 0) AS open_leads,
           ${STATE_METRICS.map((m) => `COALESCE(g.goal_${m}, 0) AS goal_${m}, COALESCE(x.done_${m}, 0) AS done_${m}`).join(',\n           ')}
      FROM states s
      LEFT JOIN done x       ON x.state = s.state
      LEFT JOIN open_leads o ON o.state = s.state
      LEFT JOIN goals g      ON g.state = s.state
     ORDER BY s.state
    `,
    params
  );

  const data = rows.map((r) => ({
    state: r.state,
    has_goal: !!r.goal_id,
    notes: r.notes || '',
    open_leads: Number(r.open_leads),
    ...metricRow(r, STATE_METRICS),
  }));
  data.forEach((r) => {
    r.conversion_rate = r.done_leads ? round2((r.done_conversions / r.done_leads) * 100) : null;
  });

  const totals = totalsOf(data, STATE_METRICS);
  totals.open_leads = data.reduce((acc, r) => acc + r.open_leads, 0);
  return { year: period.year, month: period.month, rows: data, totals };
}

/** Grava o plano do mês por estado (uma linha por UF). */
export async function saveStatesMonth({ year, month }, goals, user) {
  await ensureTables();
  const period = parsePeriod(year, month);
  if (!Array.isArray(goals)) throw validationError('Envie a lista de metas.');

  const clean = goals
    .map((g) => ({ key: String(g.state || '').trim().toUpperCase(), ...cleanGoal(g, STATE_METRICS) }))
    .filter((g) => UFS.includes(g.key));

  await upsertGoals({ table: TB_STATES, keyCol: 'state', period, goals: clean, metrics: STATE_METRICS, user });
  return getStatesMonth(period);
}

/**
 * Leads contatados no mês por UF do cliente (para o plano por estado):
 * desfechos (conversão / queda / sem sucesso) e cards ainda abertos no CRM.
 */
export async function getLeadsByState({ year, month, seller_id } = {}) {
  await ensureTables();
  const period = parsePeriod(year, month);
  const params = [period.from, period.to, LEAD_OUTCOMES];
  let sellerFilter = '';
  const sellerId = positiveId(seller_id);
  if (sellerId) {
    params.push(sellerId);
    sellerFilter = `AND d.seller_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    WITH deals AS (
      SELECT COALESCE(NULLIF(UPPER(TRIM(c.state)), ''), '—') AS state,
             d.is_closed, d.outcome, d.outcome_at
        FROM ${TB_DEALS} d
        LEFT JOIN ${TB_CUSTOMERS} c ON c.customer_id = d.customer_id
       WHERE d.crm_company = 'CONSART'
         ${sellerFilter}
    )
    SELECT state,
           COUNT(*) FILTER (WHERE contacted)                                        ::int AS contacted,
           COUNT(*) FILTER (WHERE contacted AND outcome = 'CONVERSION')             ::int AS converted,
           COUNT(*) FILTER (WHERE contacted AND outcome IN ('LOSS', 'LOST'))        ::int AS lost,
           COUNT(*) FILTER (WHERE contacted AND outcome = 'NO_SUCCESS_CONTACT')     ::int AS no_contact,
           COUNT(*) FILTER (WHERE NOT COALESCE(is_closed, FALSE))                   ::int AS open_leads
      FROM (
        SELECT state, is_closed, UPPER(COALESCE(outcome, '')) AS outcome,
               (COALESCE(is_closed, FALSE)
                 AND UPPER(COALESCE(outcome, '')) = ANY($3::text[])
                 AND outcome_at >= $1::date AND outcome_at < $2::date) AS contacted
          FROM deals
      ) x
     GROUP BY state
    HAVING COUNT(*) FILTER (WHERE contacted) > 0 OR COUNT(*) FILTER (WHERE NOT COALESCE(is_closed, FALSE)) > 0
     ORDER BY contacted DESC, open_leads DESC, state
    `,
    params
  );

  return rows.map((r) => ({
    state: r.state,
    contacted: r.contacted,
    converted: r.converted,
    lost: r.lost,
    no_contact: r.no_contact,
    open_leads: r.open_leads,
    conversion_rate: r.contacted ? round2((r.converted / r.contacted) * 100) : null,
  }));
}
