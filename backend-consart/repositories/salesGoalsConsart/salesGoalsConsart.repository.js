// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesGoalsConsart.repository.js — Metas de vendas (CONSART ERP)    ║
// ║ • Meta x Realizado por vendedor no mês.                            ║
// ║ • Venda = Proposta de Serviços APROVADA, no mês da data da         ║
// ║   proposta (issue_date).                                           ║
// ║ • Realizado: valor (total da proposta) e quantidade de propostas.  ║
// ║ • Lead contatado = card do CRM Consart concluído no mês (Conversão,║
// ║   Queda de venda ou Sem sucesso no contato); UF vem do cliente.    ║
// ║ • getHistory: evolução mês a mês para os gráficos do painel.       ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, ensureSalesGoalsConsartTable } from './salesGoalsConsart.schema.js';
import {
  TB as TB_PROPOSALS,
  ensureProposalsServicesConsartTables,
} from '../proposalsServicesConsart/proposalsServicesConsart.schema.js';

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
  await ensureSalesGoalsConsartTable();
}

function percent(done, goal) {
  return goal > 0 ? round2((done / goal) * 100) : null;
}

/**
 * Meta x Realizado do mês. Lista os vendedores ativos e também os inativos
 * que tenham meta ou venda no mês.
 */
export async function getMonth({ year, month, seller_id } = {}) {
  await ensureTables();
  const period = parsePeriod(year, month);
  const sellerId = positiveId(seller_id);

  const params = [period.year, period.month, period.from, period.to, SALE_STATUS, LEAD_OUTCOMES];
  let sellerFilter = '';
  if (sellerId) {
    params.push(sellerId);
    sellerFilter = `AND s.id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    WITH leads AS (
      SELECT d.seller_id, COUNT(*)::int AS done_leads
        FROM ${TB_DEALS} d
       WHERE ${leadsWhere(6)}
         AND d.outcome_at >= $3::date
         AND d.outcome_at <  $4::date
         AND d.seller_id IS NOT NULL
       GROUP BY d.seller_id
    ),
    sales AS (
      SELECT p.seller_id,
             COUNT(*)::int                AS done_count,
             COALESCE(SUM(p.total), 0)    AS done_value
        FROM ${TB_PROPOSALS} p
       WHERE p.status = $5
         AND p.issue_date >= $3::date
         AND p.issue_date <  $4::date
         AND p.seller_id IS NOT NULL
       GROUP BY p.seller_id
    )
    SELECT s.id AS seller_id,
           COALESCE(NULLIF(s.nickname, ''), s.name) AS seller_name,
           COALESCE(s.active, TRUE)                 AS seller_active,
           g.id AS goal_id,
           COALESCE(g.goal_value, 0) AS goal_value,
           COALESCE(g.goal_count, 0) AS goal_count,
           COALESCE(g.goal_leads, 0) AS goal_leads,
           g.notes,
           COALESCE(x.done_value, 0) AS done_value,
           COALESCE(x.done_count, 0) AS done_count,
           COALESCE(l.done_leads, 0) AS done_leads
      FROM ${TB_SELLERS} s
      LEFT JOIN ${TB} g ON g.seller_id = s.id AND g.goal_year = $1 AND g.goal_month = $2
      LEFT JOIN sales x ON x.seller_id = s.id
      LEFT JOIN leads l ON l.seller_id = s.id
     WHERE (COALESCE(s.active, TRUE) OR g.id IS NOT NULL OR x.seller_id IS NOT NULL OR l.seller_id IS NOT NULL)
       ${sellerFilter}
     ORDER BY seller_name
    `,
    params
  );

  const data = rows.map((r) => {
    const row = {
      seller_id: Number(r.seller_id),
      seller_name: r.seller_name,
      seller_active: r.seller_active,
      has_goal: !!r.goal_id,
      notes: r.notes || '',
      goal_value: Number(r.goal_value),
      goal_count: Number(r.goal_count),
      goal_leads: Number(r.goal_leads),
      done_value: Number(r.done_value),
      done_count: Number(r.done_count),
      done_leads: Number(r.done_leads),
    };
    row.pct_value = percent(row.done_value, row.goal_value);
    row.pct_count = percent(row.done_count, row.goal_count);
    row.pct_leads = percent(row.done_leads, row.goal_leads);
    return row;
  });

  const sum = (key) => round2(data.reduce((acc, r) => acc + r[key], 0));
  const totals = {
    goal_value: sum('goal_value'),
    goal_count: sum('goal_count'),
    goal_leads: sum('goal_leads'),
    done_value: sum('done_value'),
    done_count: sum('done_count'),
    done_leads: sum('done_leads'),
  };
  totals.pct_value = percent(totals.done_value, totals.goal_value);
  totals.pct_count = percent(totals.done_count, totals.goal_count);
  totals.pct_leads = percent(totals.done_leads, totals.goal_leads);

  return { year: period.year, month: period.month, rows: data, totals };
}

/**
 * Grava as metas do mês (uma linha por vendedor). Vendedor com as metas
 * zeradas e sem observação tem a meta removida.
 */
export async function saveMonth({ year, month }, goals, user) {
  await ensureTables();
  const period = parsePeriod(year, month);
  if (!Array.isArray(goals)) throw validationError('Envie a lista de metas.');

  const clean = goals
    .map((g) => ({
      seller_id: positiveId(g.seller_id),
      goal_value: round2(Math.max(0, toNumber(g.goal_value))),
      goal_count: Math.max(0, Math.trunc(toNumber(g.goal_count))),
      goal_leads: Math.max(0, Math.trunc(toNumber(g.goal_leads))),
      notes: String(g.notes || '').trim().slice(0, 255) || null,
    }))
    .filter((g) => g.seller_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const g of clean) {
      if (!g.goal_value && !g.goal_count && !g.goal_leads && !g.notes) {
        await client.query(
          `DELETE FROM ${TB} WHERE goal_year = $1 AND goal_month = $2 AND seller_id = $3`,
          [period.year, period.month, g.seller_id]
        );
        continue;
      }
      await client.query(
        `INSERT INTO ${TB}
           (goal_year, goal_month, seller_id, goal_value, goal_count, goal_leads, notes,
            created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (goal_year, goal_month, seller_id) DO UPDATE SET
           goal_value = EXCLUDED.goal_value,
           goal_count = EXCLUDED.goal_count,
           goal_leads = EXCLUDED.goal_leads,
           notes      = EXCLUDED.notes,
           updated_at = NOW()`,
        [period.year, period.month, g.seller_id, g.goal_value, g.goal_count, g.goal_leads, g.notes,
          positiveId(user?.user_id ?? user?.id), user?.name || null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

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

  const params = [period.from, n, SALE_STATUS, LEAD_OUTCOMES];
  let goalSeller = '';
  let saleSeller = '';
  let leadSeller = '';
  if (sellerId) {
    params.push(sellerId);
    goalSeller = `AND g.seller_id = $${params.length}`;
    saleSeller = `AND p.seller_id = $${params.length}`;
    leadSeller = `AND d.seller_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
    WITH months AS (
      SELECT (date_trunc('month', $1::date) - make_interval(months => s.i))::date AS month_start
        FROM generate_series(0, $2::int - 1) AS s(i)
    )
    SELECT EXTRACT(YEAR FROM m.month_start)::int  AS year,
           EXTRACT(MONTH FROM m.month_start)::int AS month,
           COALESCE((SELECT SUM(g.goal_value) FROM ${TB} g
                      WHERE g.goal_year = EXTRACT(YEAR FROM m.month_start)
                        AND g.goal_month = EXTRACT(MONTH FROM m.month_start) ${goalSeller}), 0) AS goal_value,
           COALESCE((SELECT SUM(g.goal_count) FROM ${TB} g
                      WHERE g.goal_year = EXTRACT(YEAR FROM m.month_start)
                        AND g.goal_month = EXTRACT(MONTH FROM m.month_start) ${goalSeller}), 0) AS goal_count,
           COALESCE((SELECT SUM(p.total) FROM ${TB_PROPOSALS} p
                      WHERE p.status = $3
                        AND p.issue_date >= m.month_start
                        AND p.issue_date < (m.month_start + INTERVAL '1 month') ${saleSeller}), 0) AS done_value,
           (SELECT COUNT(*) FROM ${TB_PROPOSALS} p
             WHERE p.status = $3
               AND p.issue_date >= m.month_start
               AND p.issue_date < (m.month_start + INTERVAL '1 month') ${saleSeller})::int AS done_count,
           COALESCE((SELECT SUM(g.goal_leads) FROM ${TB} g
                      WHERE g.goal_year = EXTRACT(YEAR FROM m.month_start)
                        AND g.goal_month = EXTRACT(MONTH FROM m.month_start) ${goalSeller}), 0) AS goal_leads,
           (SELECT COUNT(*) FROM ${TB_DEALS} d
             WHERE ${leadsWhere(4)}
               AND d.outcome_at >= m.month_start
               AND d.outcome_at < (m.month_start + INTERVAL '1 month') ${leadSeller})::int AS done_leads
      FROM months m
     ORDER BY m.month_start
    `,
    params
  );

  return rows.map((r) => ({
    year: r.year,
    month: r.month,
    goal_value: Number(r.goal_value),
    goal_count: Number(r.goal_count),
    done_value: Number(r.done_value),
    done_count: Number(r.done_count),
    goal_leads: Number(r.goal_leads),
    done_leads: Number(r.done_leads),
  }));
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
