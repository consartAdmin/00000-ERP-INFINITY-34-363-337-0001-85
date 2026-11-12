// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarterCash.repository.js — Abertura, movimentos e fechamento    ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import {
  TB_SALES,
  TB_CASH_SESSIONS,
  TB_CASH_MOVEMENTS,
  CASH_MOVEMENT_TYPES,
  PAYMENT_METHODS,
} from './pdvStarter.constants.js';
import { toMoney, cleanText, pdvError } from './pdvStarter.utils.js';

export async function getOpenSession(terminal) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TB_CASH_SESSIONS} WHERE terminal = $1 AND status = 'ABERTO' LIMIT 1`,
    [terminal],
  );
  return rows[0] || null;
}

export async function getSession(sessionId) {
  const { rows } = await pool.query(`SELECT * FROM ${TB_CASH_SESSIONS} WHERE session_id = $1`, [sessionId]);
  return rows[0] || null;
}

export async function getLastClosed(terminal) {
  const { rows } = await pool.query(
    `SELECT session_id, closed_at, closed_by_name, counted
       FROM ${TB_CASH_SESSIONS}
      WHERE terminal = $1 AND status = 'FECHADO'
      ORDER BY closed_at DESC LIMIT 1`,
    [terminal],
  );
  return rows[0] || null;
}

export async function openSession({ terminal, user, openingAmount, notes }) {
  if (!terminal) throw pdvError('Informe o caixa (terminal).', 'TERMINAL_REQUIRED', 400);
  const existing = await getOpenSession(terminal);
  if (existing) return { session: existing, alreadyOpen: true };

  try {
    const { rows } = await pool.query(
      `INSERT INTO ${TB_CASH_SESSIONS} (terminal, operator_id, operator_name, opening_amount, opening_notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [terminal, user.pdv_user_id, user.full_name, toMoney(openingAmount), cleanText(notes, 500)],
    );
    return { session: rows[0], alreadyOpen: false };
  } catch (error) {
    if (error.code === '23505') return { session: await getOpenSession(terminal), alreadyOpen: true };
    throw error;
  }
}

export async function addMovement(sessionId, { type, amount, reason, user }) {
  const t = String(type || '').toUpperCase();
  if (!CASH_MOVEMENT_TYPES.has(t)) throw pdvError('Tipo deve ser SANGRIA ou SUPRIMENTO.', 'INVALID_MOVEMENT_TYPE', 400);
  const value = toMoney(amount);
  if (!(value > 0)) throw pdvError('Informe um valor maior que zero.', 'INVALID_AMOUNT', 400);

  const session = await getSession(sessionId);
  if (!session || session.status !== 'ABERTO') throw pdvError('Caixa não está aberto.', 'SESSION_NOT_OPEN', 409);

  const { rows } = await pool.query(
    `INSERT INTO ${TB_CASH_MOVEMENTS} (session_id, movement_type, amount, reason, operator_id, operator_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sessionId, t, value, cleanText(reason, 500), user.pdv_user_id, user.full_name],
  );
  return rows[0];
}

/** Resumo do caixa: esperado por forma de pagamento, movimentos e indicadores. */
export async function getSummary(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw pdvError('Caixa não encontrado.', 'SESSION_NOT_FOUND', 404);

  const { rows: sales } = await pool.query(
    `SELECT sale_id, total, troco, payments, status, nfce_status
       FROM ${TB_SALES}
      WHERE session_id = $1`,
    [sessionId],
  );
  const { rows: movements } = await pool.query(
    `SELECT * FROM ${TB_CASH_MOVEMENTS} WHERE session_id = $1 ORDER BY created_at`,
    [sessionId],
  );

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.code, 0]));
  let total = 0;
  let count = 0;
  let canceled = 0;
  let nfceAuthorized = 0;
  let cashSales = 0;

  for (const sale of sales) {
    if (sale.status === 'CANCELADA') { canceled += 1; continue; }
    count += 1;
    total += Number(sale.total || 0);
    if (sale.nfce_status === 'AUTORIZADA') nfceAuthorized += 1;
    const payments = Array.isArray(sale.payments) ? sale.payments : [];
    for (const p of payments) {
      const code = byMethod[p.method] !== undefined ? p.method : 'OUTROS';
      byMethod[code] += Number(p.amount || 0);
    }
    // O troco sai do dinheiro da gaveta
    byMethod.DINHEIRO -= Number(sale.troco || 0);
    if (payments.some((p) => p.method === 'DINHEIRO')) cashSales += 1;
  }

  const sangrias = movements.filter((m) => m.movement_type === 'SANGRIA').reduce((s, m) => s + Number(m.amount), 0);
  const suprimentos = movements.filter((m) => m.movement_type === 'SUPRIMENTO').reduce((s, m) => s + Number(m.amount), 0);

  const expected = { ...byMethod };
  expected.DINHEIRO = toMoney(Number(session.opening_amount || 0) + byMethod.DINHEIRO + suprimentos - sangrias);
  for (const k of Object.keys(expected)) expected[k] = toMoney(expected[k]);

  return {
    session,
    movements,
    indicators: {
      sales: count,
      canceled,
      total: toMoney(total),
      ticket: count ? toMoney(total / count) : 0,
      nfce_authorized: nfceAuthorized,
      cash_sales: cashSales,
      cash_sales_amount: toMoney(byMethod.DINHEIRO),
      sangrias: toMoney(sangrias),
      suprimentos: toMoney(suprimentos),
    },
    expected,
  };
}

export async function closeSession(sessionId, { counted, notes, user }) {
  const summary = await getSummary(sessionId);
  if (summary.session.status !== 'ABERTO') throw pdvError('Este caixa já foi fechado.', 'SESSION_ALREADY_CLOSED', 409);

  const countedClean = {};
  let difference = 0;
  for (const code of Object.keys(summary.expected)) {
    const value = counted?.[code] === undefined ? summary.expected[code] : toMoney(counted[code]);
    countedClean[code] = value;
    difference += value - summary.expected[code];
  }

  const { rows } = await pool.query(
    `UPDATE ${TB_CASH_SESSIONS}
        SET status = 'FECHADO', closed_at = NOW(), closed_by_id = $2, closed_by_name = $3,
            expected = $4::jsonb, counted = $5::jsonb, difference = $6, closing_notes = $7
      WHERE session_id = $1 AND status = 'ABERTO'
      RETURNING *`,
    [
      sessionId,
      user.pdv_user_id,
      user.full_name,
      JSON.stringify(summary.expected),
      JSON.stringify(countedClean),
      toMoney(difference),
      cleanText(notes, 1000),
    ],
  );
  if (!rows[0]) throw pdvError('Este caixa já foi fechado.', 'SESSION_ALREADY_CLOSED', 409);
  return { ...summary, session: rows[0], counted: countedClean, difference: toMoney(difference) };
}
