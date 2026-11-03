// ╔════════════════════════════════════════════════════════════════════╗
// ║ expensesBatch.repository.js — ações em lote (despesas marcadas)    ║
// ║ deleteExpensesBatch / updateExpensesBatch                          ║
// ║ Tabela: public."Expenses"                                          ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB } from './expenses.constants.js';

const MAX_BATCH = 1000;

/** Normaliza a lista de ids (inteiros positivos, sem repetição) */
export function normalizeIds(ids) {
  const list = Array.isArray(ids) ? ids : [];
  const out = [...new Set(list.map((v) => Number.parseInt(v, 10)).filter((n) => Number.isInteger(n) && n > 0))];
  return out.slice(0, MAX_BATCH);
}

export async function deleteExpensesBatch(ids) {
  const list = normalizeIds(ids);
  if (!list.length) return [];
  const { rows } = await pool.query(
    `DELETE FROM ${TB} WHERE "id" = ANY($1::int[]) RETURNING "id";`,
    [list]
  );
  return rows.map((r) => r.id);
}

const STATUS = new Set(['PENDING', 'PAID', 'CANCELLED']);
const RECURRENCE = new Set(['MONTHLY', 'WEEKLY', 'YEARLY', 'NONE']);

/**
 * Altera só os campos enviados em `changes` (os demais ficam como estão).
 * Campos aceitos: status, paid_date, payment_method, category,
 * cost_center, recurrence_type, is_active.
 */
export function buildBatchChanges(changes = {}) {
  const set = [];
  const params = [];
  const push = (column, value) => {
    params.push(value);
    set.push(`"${column}" = $${params.length}`);
  };
  const has = (k) => Object.prototype.hasOwnProperty.call(changes, k);
  const text = (v) => {
    const s = String(v ?? '').trim();
    return s ? s : null;
  };

  if (has('status')) {
    const s = String(changes.status || '').trim().toUpperCase();
    if (!STATUS.has(s)) throw new Error('Status inválido.');
    push('status', s);
  }
  if (has('paid_date')) {
    const d = text(changes.paid_date);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Data de pagamento inválida.');
    push('paid_date', d);
  }
  if (has('payment_method')) push('payment_method', text(changes.payment_method));
  if (has('category')) push('category', text(changes.category));
  if (has('cost_center')) push('cost_center', text(changes.cost_center));
  if (has('recurrence_type')) {
    const r = String(changes.recurrence_type || '').trim().toUpperCase();
    if (!RECURRENCE.has(r)) throw new Error('Recorrência inválida.');
    push('recurrence_type', r);
  }
  if (has('is_active')) {
    push('is_active', ['true', '1', 'sim', 'yes'].includes(String(changes.is_active).toLowerCase()));
  }

  return { set, params };
}

export async function updateExpensesBatch(ids, changes = {}) {
  const list = normalizeIds(ids);
  if (!list.length) return [];

  const { set, params } = buildBatchChanges(changes);
  if (!set.length) throw new Error('Nenhum campo para alterar.');

  params.push(list);
  const q = `
    UPDATE ${TB}
    SET ${set.join(', ')}, "updated_at" = NOW()
    WHERE "id" = ANY($${params.length}::int[])
    RETURNING "id";
  `;
  const { rows } = await pool.query(q, params);
  return rows.map((r) => r.id);
}
