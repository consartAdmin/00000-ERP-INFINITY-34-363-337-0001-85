// ╔══════════════════════════════════════════════════════════════════════╗
// ║ bankAccountsBalanceApi.js — DAL de Saldos / Conferências Bancárias   ║
// ║ CONSART ERP | PostgreSQL | ESM                                       ║
// ║                                                                      ║
// ║ public."bankAccountsBalance" guarda CONFERÊNCIAS (checkpoints):       ║
// ║   "no FIM do dia balance_date o extrato mostrava balance"            ║
// ║                                                                      ║
// ║ Saldo em uma data D (fim do dia):                                    ║
// ║   última conferência com balance_date <= D                           ║
// ║   + ENTRADAS − SAÍDAS ativas de "cashMoviments" da conta             ║
// ║     com movement_date entre (balance_date + 1 dia) e (D + 1 dia)      ║
// ║ Sem conferência anterior → saldo desconhecido (null).                 ║
// ║                                                                      ║
// ║ Ao gravar uma conferência, system_balance = saldo calculado pelo ERP ║
// ║ para a mesma data usando a conferência ANTERIOR (difference é gerada ║
// ║ pelo banco: balance − system_balance).                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB = 'public."bankAccountsBalance"';
const TB_BANK_ACCOUNTS = 'public."bankAccounts"';
const TB_CASH = 'public."cashMoviments"';

// Total da movimentação (mesma regra do resumo do Caixa)
const MOVEMENT_TOTAL_SQL = `(
  m.amount
  + COALESCE(m.penalty_amount, 0)
  + COALESCE(m.interest_amount, 0)
  + COALESCE(m.fee_amount, 0)
)`;

const MOVEMENT_TYPE_SQL = `
  translate(upper(m.movement_type), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')
`;

const SIGNED_MOVEMENT_SQL = `
  CASE
    WHEN ${MOVEMENT_TYPE_SQL} LIKE 'ENTR%' THEN ${MOVEMENT_TOTAL_SQL}
    WHEN ${MOVEMENT_TYPE_SQL} LIKE 'SAID%' THEN -${MOVEMENT_TOTAL_SQL}
    ELSE 0
  END
`;

const SELECT_FIELDS = `
  bb.id,
  bb.bank_account_id,
  ba.name AS bank_account_name,
  to_char(bb.balance_date, 'YYYY-MM-DD') AS balance_date,
  bb.balance,
  bb.system_balance,
  bb.difference,
  bb.notes,
  bb.created_by,
  bb.created_at,
  bb.updated_at
`;

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function requireId(value, label = 'ID') {
  const id = positiveId(value);
  if (!id) throw httpError(`${label} inválido.`);
  return id;
}

function isoDate(value, label = 'Data') {
  const str = String(value ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw httpError(`${label} inválida.`);
  const d = new Date(`${str}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw httpError(`${label} inválida.`);
  return str;
}

function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function requireMoney(value, label) {
  if (value === '' || value === null || value === undefined) throw httpError(`Informe ${label}.`);
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) throw httpError(`${label} inválido.`);
  return Math.round(n * 100) / 100;
}

function optionalText(value, max) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

async function ensureBankAccount(db, bankAccountId) {
  const { rows } = await db.query(
    `SELECT id, name FROM ${TB_BANK_ACCOUNTS} WHERE id = $1`,
    [bankAccountId]
  );
  if (!rows[0]) throw httpError('Conta bancária não encontrada.', 404);
  return rows[0];
}

/**
 * Saldo calculado pelo ERP no FIM do dia `date`.
 * @param {object} opts
 * @param {boolean} [opts.beforeDate=false] usa apenas conferências ANTERIORES
 *   a `date` (para calcular system_balance ao conferir a própria data)
 * @param {number} [opts.excludeId] ignora esta conferência (edição)
 */
export async function calculateBalance(
  bankAccountId,
  date,
  { beforeDate = false, excludeId = null, db = pool } = {}
) {
  const accountId = requireId(bankAccountId, 'Conta bancária');
  const day = isoDate(date);

  const { rows: cpRows } = await db.query(
    `
    SELECT id, to_char(balance_date, 'YYYY-MM-DD') AS balance_date, balance
    FROM ${TB}
    WHERE bank_account_id = $1
      AND ${beforeDate ? 'balance_date < $2::date' : 'balance_date <= $2::date'}
      AND ($3::bigint IS NULL OR id <> $3::bigint)
    ORDER BY balance_date DESC
    LIMIT 1
    `,
    [accountId, day, excludeId]
  );
  const checkpoint = cpRows[0] || null;

  if (!checkpoint) {
    return {
      bank_account_id: accountId,
      date: day,
      balance: null,
      base_checkpoint: null,
      entradas: 0,
      saidas: 0,
      movements: 0,
    };
  }

  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN ${MOVEMENT_TYPE_SQL} LIKE 'ENTR%' THEN ${MOVEMENT_TOTAL_SQL} END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN ${MOVEMENT_TYPE_SQL} LIKE 'SAID%' THEN ${MOVEMENT_TOTAL_SQL} END), 0) AS saidas,
      COALESCE(SUM(${SIGNED_MOVEMENT_SQL}), 0) AS net,
      COUNT(*) AS movements
    FROM ${TB_CASH} m
    WHERE m.bank_account_id = $1
      AND m.is_active = TRUE
      AND m.movement_date >= ($2::date + 1)
      AND m.movement_date <  ($3::date + 1)
    `,
    [accountId, checkpoint.balance_date, day]
  );
  const mv = rows[0];

  return {
    bank_account_id: accountId,
    date: day,
    balance: Math.round((Number(checkpoint.balance) + Number(mv.net)) * 100) / 100,
    base_checkpoint: {
      id: Number(checkpoint.id),
      balance_date: checkpoint.balance_date,
      balance: Number(checkpoint.balance),
    },
    entradas: Number(mv.entradas),
    saidas: Number(mv.saidas),
    movements: Number(mv.movements),
  };
}

/**
 * Resumo por conta bancária: saldo atual (inclui movimentações futuras
 * já lançadas até hoje) + última conferência.
 */
export async function getSummary({ active = 'true' } = {}) {
  const params = [];
  let where = '';
  if (active !== undefined && active !== null && active !== '') {
    params.push(String(active).toLowerCase() !== 'false');
    where = `WHERE ba.is_active = $${params.length}`;
  }

  const { rows: accounts } = await pool.query(
    `
    SELECT
      ba.id, ba.name, ba.integration_provider, ba.is_default, ba.is_active,
      last.id AS last_checkpoint_id,
      to_char(last.balance_date, 'YYYY-MM-DD') AS last_checkpoint_date,
      last.balance AS last_checkpoint_balance,
      last.difference AS last_checkpoint_difference,
      (SELECT COUNT(*) FROM ${TB} x WHERE x.bank_account_id = ba.id) AS checkpoints
    FROM ${TB_BANK_ACCOUNTS} ba
    LEFT JOIN LATERAL (
      SELECT bb.id, bb.balance_date, bb.balance, bb.difference
      FROM ${TB} bb
      WHERE bb.bank_account_id = ba.id
      ORDER BY bb.balance_date DESC
      LIMIT 1
    ) last ON TRUE
    ${where}
    ORDER BY ba.is_default DESC, ba.name ASC, ba.id ASC
    `,
    params
  );

  const today = todayIso();
  const items = [];
  for (const acc of accounts) {
    const calc = await calculateBalance(acc.id, today);
    items.push({
      bank_account_id: Number(acc.id),
      name: acc.name,
      integration_provider: acc.integration_provider,
      is_default: acc.is_default,
      is_active: acc.is_active,
      current_balance: calc.balance,
      entradas_since_checkpoint: calc.entradas,
      saidas_since_checkpoint: calc.saidas,
      movements_since_checkpoint: calc.movements,
      checkpoints: Number(acc.checkpoints),
      last_checkpoint: acc.last_checkpoint_id
        ? {
          id: Number(acc.last_checkpoint_id),
          balance_date: acc.last_checkpoint_date,
          balance: num(acc.last_checkpoint_balance),
          difference: num(acc.last_checkpoint_difference),
        }
        : null,
    });
  }

  const known = items.filter((i) => i.current_balance !== null);
  return {
    date: today,
    items,
    total_balance: Math.round(known.reduce((s, i) => s + i.current_balance, 0) * 100) / 100,
    accounts_without_checkpoint: items.length - known.length,
  };
}

export async function listCheckpoints({ bankAccountId, from, to, limit } = {}) {
  const where = [];
  const params = [];

  if (bankAccountId) {
    params.push(requireId(bankAccountId, 'Conta bancária'));
    where.push(`bb.bank_account_id = $${params.length}`);
  }
  if (from) {
    params.push(isoDate(from, 'Data inicial'));
    where.push(`bb.balance_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(isoDate(to, 'Data final'));
    where.push(`bb.balance_date <= $${params.length}::date`);
  }

  const max = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  params.push(max);

  const { rows } = await pool.query(
    `
    SELECT ${SELECT_FIELDS}
    FROM ${TB} bb
    INNER JOIN ${TB_BANK_ACCOUNTS} ba ON ba.id = bb.bank_account_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY bb.balance_date DESC, ba.name ASC, bb.id DESC
    LIMIT $${params.length}
    `,
    params
  );
  return rows;
}

export async function getCheckpointById(value, db = pool) {
  const id = positiveId(value);
  if (!id) return null;
  const { rows } = await db.query(
    `
    SELECT ${SELECT_FIELDS}
    FROM ${TB} bb
    INNER JOIN ${TB_BANK_ACCOUNTS} ba ON ba.id = bb.bank_account_id
    WHERE bb.id = $1
    `,
    [id]
  );
  return rows[0] || null;
}

export async function createCheckpoint(payload = {}, { user = null } = {}) {
  const bankAccountId = requireId(payload.bank_account_id, 'Conta bancária');
  const balanceDate = isoDate(payload.balance_date || todayIso(), 'Data da conferência');
  if (balanceDate > todayIso()) throw httpError('A data da conferência não pode ser futura.');
  const balance = requireMoney(payload.balance, 'o saldo do extrato');
  const notes = optionalText(payload.notes, 2000);

  await ensureBankAccount(pool, bankAccountId);

  const calc = await calculateBalance(bankAccountId, balanceDate, { beforeDate: true });

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB} (bank_account_id, balance_date, balance, system_balance, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
    `,
    [bankAccountId, balanceDate, balance, calc.balance, notes, optionalText(user, 150)]
  );
  return getCheckpointById(rows[0].id);
}

export async function updateCheckpoint(value, payload = {}) {
  const id = requireId(value);
  const current = await getCheckpointById(id);
  if (!current) return null;

  const balanceDate = payload.balance_date !== undefined
    ? isoDate(payload.balance_date, 'Data da conferência')
    : current.balance_date;
  if (balanceDate > todayIso()) throw httpError('A data da conferência não pode ser futura.');
  const balance = payload.balance !== undefined
    ? requireMoney(payload.balance, 'o saldo do extrato')
    : Number(current.balance);
  const notes = payload.notes !== undefined ? optionalText(payload.notes, 2000) : current.notes;

  // Recalcula o saldo do sistema para a (nova) data
  const calc = await calculateBalance(current.bank_account_id, balanceDate, {
    beforeDate: true,
    excludeId: id,
  });

  await pool.query(
    `
    UPDATE ${TB}
    SET balance_date = $1, balance = $2, system_balance = $3, notes = $4, updated_at = now()
    WHERE id = $5
    `,
    [balanceDate, balance, calc.balance, notes, id]
  );
  return getCheckpointById(id);
}

export async function deleteCheckpoint(value) {
  const id = requireId(value);
  const { rows } = await pool.query(`DELETE FROM ${TB} WHERE id = $1 RETURNING id`, [id]);
  return rows[0] ? { id: Number(rows[0].id) } : null;
}

export default {
  calculateBalance,
  getSummary,
  listCheckpoints,
  getCheckpointById,
  createCheckpoint,
  updateCheckpoint,
  deleteCheckpoint,
};
