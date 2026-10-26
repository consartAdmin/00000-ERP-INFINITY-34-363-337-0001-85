// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesGoalsConsart.performance.js — Funil e desempenho (CONSART)    ║
// ║ • Funil: cards abertos do CRM Consart por etapa (hoje) e entradas  ║
// ║   em cada etapa no mês (log de ações do CRM: criação e movimento). ║
// ║ • Desempenho por vendedor no mês: cards por etapa, concluídos      ║
// ║   (Conversão, Queda de venda, Sem sucesso), contatos (WhatsApp,    ║
// ║   Ligação, E-mail), propostas, valor vendido e % da meta.          ║
// ║ • Vendedor do card = crmDeals.seller_id; sem vendedor vira uma     ║
// ║   linha própria.                                                   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import perfApi from '../crmDealsPerformance/crmDealsPerformance.index.js';
import { TABLE as TB_ACTIONS } from '../crmDealsPerformance/crmDealsPerformance.constants.js';
import {
  TB as TB_CONTACTS,
  ensureCrmDealContactsTable,
} from '../crmDealContacts/crmDealContacts.repository.js';
import { getMonth } from './salesGoalsConsart.repository.js';

const TB_DEALS = 'public."crmDeals"';
const TB_STAGES = 'public."crmDealsStages"';
const TB_SELLERS = 'public."sellersConsart"';

// Card aberto sem atividade há mais de N dias = parado
export const STALLED_DAYS = 7;

const NO_SELLER = 0;

function sellerKey(id) {
  const n = Number(id);
  return Number.isSafeInteger(n) && n > 0 ? n : NO_SELLER;
}

function emptyRow(seller_id, seller_name) {
  return {
    seller_id,
    seller_name,
    stages: {},          // stage_id → { open, value, entered }
    open: 0,
    open_value: 0,
    stalled: 0,
    new_cards: 0,
    converted: 0,
    lost: 0,
    no_contact: 0,
    concluded: 0,
    conversion_rate: null,
    contacts: { WHATSAPP: 0, LIGACAO: 0, EMAIL: 0 },
    contacts_total: 0,
    sent: 0,
    approved: 0,
    value: 0,
    goal_value: 0,
    pct_value: null,
    avg_ticket: null,
  };
}

function stageCell(row, stageId) {
  const key = String(stageId);
  if (!row.stages[key]) row.stages[key] = { open: 0, value: 0, entered: 0 };
  return row.stages[key];
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Funil do CRM Consart + desempenho por vendedor no mês.
 * period = { year, month, from, to } já validado por getMonth.
 */
export async function getPerformance({ year, month, seller_id } = {}) {
  // Meta x realizado (propostas, valor) e lista de vendedores
  const goals = await getMonth({ year, month, seller_id });
  const from = `${goals.year}-${String(goals.month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(goals.year, goals.month, 1)).toISOString().slice(0, 10);

  await Promise.all([perfApi.ensureTable(), ensureCrmDealContactsTable()]);

  const sellerId = Number(seller_id) > 0 ? Number(seller_id) : null;
  const sellerFilter = (col) => (sellerId ? `AND ${col} = ${sellerId}` : '');

  const [stagesRes, openRes, enteredRes, newRes, outcomesRes, contactsRes] = await Promise.all([
    pool.query(`
      SELECT s.id, s.stage_name AS name, COALESCE(s.code, s.stage_code) AS code, s.color, s.sort_order
        FROM ${TB_STAGES} s
       WHERE COALESCE(s.is_active, TRUE)
       ORDER BY s.sort_order NULLS LAST, s.id
    `),
    // Cards abertos hoje por vendedor e etapa
    pool.query(`
      SELECT d.seller_id, d.stage_id,
             COUNT(*)::int AS open,
             COALESCE(SUM(d.estimated_value), 0)::numeric AS value,
             COUNT(*) FILTER (
               WHERE COALESCE(d.last_activity_date, d.updated_at, d.created_at) < NOW() - INTERVAL '${STALLED_DAYS} days'
             )::int AS stalled
        FROM ${TB_DEALS} d
       WHERE d.crm_company = 'CONSART'
         AND NOT COALESCE(d.is_closed, FALSE)
         ${sellerFilter('d.seller_id')}
       GROUP BY d.seller_id, d.stage_id
    `),
    // Entradas em cada etapa no mês (card criado ou movido para a etapa)
    pool.query(`
      SELECT COALESCE(a.seller_id, d.seller_id) AS seller_id,
             COALESCE(a.to_stage_id, a.stage_id) AS stage_id,
             COUNT(DISTINCT a.deal_id)::int AS entered
        FROM ${TB_ACTIONS} a
        JOIN ${TB_DEALS} d ON d.id = a.deal_id AND d.crm_company = 'CONSART'
       WHERE a.action_type IN ('CREATE_DEAL', 'MOVE_STAGE')
         AND a.created_at >= $1::date AND a.created_at < $2::date
         ${sellerFilter('COALESCE(a.seller_id, d.seller_id)')}
       GROUP BY 1, 2
    `, [from, next]),
    // Cards novos no mês
    pool.query(`
      SELECT d.seller_id, COUNT(*)::int AS total
        FROM ${TB_DEALS} d
       WHERE d.crm_company = 'CONSART'
         AND d.created_at >= $1::date AND d.created_at < $2::date
         ${sellerFilter('d.seller_id')}
       GROUP BY d.seller_id
    `, [from, next]),
    // Concluídos no mês por desfecho
    pool.query(`
      SELECT d.seller_id,
             COUNT(*) FILTER (WHERE UPPER(d.outcome) = 'CONVERSION')::int         AS converted,
             COUNT(*) FILTER (WHERE UPPER(d.outcome) IN ('LOSS', 'LOST'))::int     AS lost,
             COUNT(*) FILTER (WHERE UPPER(d.outcome) = 'NO_SUCCESS_CONTACT')::int AS no_contact
        FROM ${TB_DEALS} d
       WHERE d.crm_company = 'CONSART'
         AND COALESCE(d.is_closed, FALSE)
         AND d.outcome_at >= $1::date AND d.outcome_at < $2::date
         ${sellerFilter('d.seller_id')}
       GROUP BY d.seller_id
    `, [from, next]),
    // Contatos registrados nos cards no mês
    pool.query(`
      SELECT d.seller_id, c.contact_type, COUNT(*)::int AS total
        FROM ${TB_CONTACTS} c
        JOIN ${TB_DEALS} d ON d.id = c.deal_id AND d.crm_company = 'CONSART'
       WHERE c.contacted_at >= $1::date AND c.contacted_at < $2::date
         ${sellerFilter('d.seller_id')}
       GROUP BY d.seller_id, c.contact_type
    `, [from, next]),
  ]);

  const stages = stagesRes.rows.map((s) => ({
    id: Number(s.id),
    name: s.name,
    code: s.code,
    color: s.color || null,
  }));

  // Uma linha por vendedor (os de getMonth primeiro, na mesma ordem)
  const rows = new Map();
  for (const g of goals.rows) {
    const r = emptyRow(g.seller_id, g.seller_name);
    r.sent = g.done_sent;
    r.approved = g.done_count;
    r.value = g.done_value;
    r.goal_value = g.goal_value;
    r.pct_value = g.pct_value;
    rows.set(g.seller_id, r);
  }
  const rowOf = (id) => {
    const key = sellerKey(id);
    if (!rows.has(key)) rows.set(key, emptyRow(key, key === NO_SELLER ? 'Sem vendedor' : `Vendedor #${key}`));
    return rows.get(key);
  };

  for (const o of openRes.rows) {
    const r = rowOf(o.seller_id);
    const cell = stageCell(r, o.stage_id);
    cell.open += o.open;
    cell.value += Number(o.value);
    r.open += o.open;
    r.open_value += Number(o.value);
    r.stalled += o.stalled;
  }
  for (const e of enteredRes.rows) {
    if (e.stage_id == null) continue;
    stageCell(rowOf(e.seller_id), e.stage_id).entered += e.entered;
  }
  for (const n of newRes.rows) rowOf(n.seller_id).new_cards += n.total;
  for (const o of outcomesRes.rows) {
    const r = rowOf(o.seller_id);
    r.converted += o.converted;
    r.lost += o.lost;
    r.no_contact += o.no_contact;
  }
  for (const c of contactsRes.rows) {
    const r = rowOf(c.seller_id);
    if (c.contact_type in r.contacts) r.contacts[c.contact_type] += c.total;
  }

  // Vendedores fora da lista de metas (inativos): busca o nome
  const unnamed = [...rows.values()].filter((r) => r.seller_id && r.seller_name.startsWith('Vendedor #'));
  if (unnamed.length) {
    const { rows: names } = await pool.query(
      `SELECT id, COALESCE(NULLIF(nickname, ''), name) AS name FROM ${TB_SELLERS} WHERE id = ANY($1::bigint[])`,
      [unnamed.map((r) => r.seller_id)]
    );
    for (const n of names) rows.get(Number(n.id)).seller_name = n.name;
  }

  const data = [...rows.values()].map((r) => {
    r.concluded = r.converted + r.lost + r.no_contact;
    r.conversion_rate = r.concluded ? round2((r.converted / r.concluded) * 100) : null;
    r.contacts_total = r.contacts.WHATSAPP + r.contacts.LIGACAO + r.contacts.EMAIL;
    r.avg_ticket = r.approved ? round2(r.value / r.approved) : null;
    r.open_value = round2(r.open_value);
    return r;
  });

  // Sem nenhum movimento: some da tabela (vendedor inativo sem nada)
  const active = data.filter((r) => r.goal_value || r.value || r.sent || r.open || r.concluded
    || r.contacts_total || r.new_cards || Object.values(r.stages).some((c) => c.entered)
    || goals.rows.some((g) => g.seller_id === r.seller_id && g.seller_active));

  // Totais e funil
  const totals = emptyRow(null, 'Total');
  for (const r of active) {
    for (const [id, c] of Object.entries(r.stages)) {
      const t = stageCell(totals, id);
      t.open += c.open;
      t.value = round2(t.value + c.value);
      t.entered += c.entered;
    }
    for (const k of ['open', 'open_value', 'stalled', 'new_cards', 'converted', 'lost', 'no_contact',
      'concluded', 'contacts_total', 'sent', 'approved', 'value', 'goal_value']) totals[k] += r[k];
    for (const k of Object.keys(totals.contacts)) totals.contacts[k] += r.contacts[k];
  }
  totals.open_value = round2(totals.open_value);
  totals.conversion_rate = totals.concluded ? round2((totals.converted / totals.concluded) * 100) : null;
  totals.pct_value = totals.goal_value ? round2((totals.value / totals.goal_value) * 100) : null;
  totals.avg_ticket = totals.approved ? round2(totals.value / totals.approved) : null;

  return {
    year: goals.year,
    month: goals.month,
    stalled_days: STALLED_DAYS,
    stages,
    rows: active,
    totals,
  };
}
