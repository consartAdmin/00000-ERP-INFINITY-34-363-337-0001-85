/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: debtPaymentsApi.js                                            ║
   ║ MODULE: Debt Payments DAL/API                                       ║
   ║ DESCRIPTION: Access layer for debt payments and debt balance sync   ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../config/db.js';

const TB_DEBTS = 'public.debts';
const TB_PAYMENTS = 'public.debt_payments';

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;

  let v = String(value)
    .trim()
    .replace(/[R$\s]/g, '');

  if (v.includes(',')) {
    v = v.replace(/\./g, '').replace(',', '.');
  }

  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function safeText(value, max = 255) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizeDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) return null;

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

function normalizeInstallmentNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;

  return n;
}

function buildStatusFromDebt(debtRow) {
  const dueDate = debtRow?.due_date ? new Date(debtRow.due_date) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openAmount = roundMoney(debtRow?.open_amount);
  const paidAmount = roundMoney(debtRow?.paid_amount);
  const updatedAmount = roundMoney(debtRow?.updated_amount);

  if (openAmount <= 0) return 'PAGO';
  if (paidAmount > 0 && openAmount > 0) return 'PARCIAL';
  if (dueDate && dueDate < today && updatedAmount > 0) return 'VENCIDO';

  return 'EM_ABERTO';
}

async function recalcDebtById(client, debtId) {
  const debtRes = await client.query(
    `
      SELECT
        id,
        due_date,
        original_amount,
        interest_amount,
        fine_amount,
        discount_amount,
        paid_amount,
        open_amount
      FROM ${TB_DEBTS}
      WHERE id = $1
      LIMIT 1
    `,
    [debtId]
  );

  if (!debtRes.rows.length) {
    throw new Error('Dívida não encontrada para recálculo.');
  }

  const debt = debtRes.rows[0];

  const payRes = await client.query(
    `
      SELECT
        COALESCE(SUM(amount), 0) AS principal_paid,
        COALESCE(SUM(interest_amount), 0) AS interest_paid,
        COALESCE(SUM(fine_amount), 0) AS fine_paid,
        COALESCE(SUM(discount_amount), 0) AS discount_paid,
        COALESCE(SUM(amount + interest_amount + fine_amount - discount_amount), 0) AS total_paid_effective
      FROM ${TB_PAYMENTS}
      WHERE debt_id = $1
    `,
    [debtId]
  );

  const sums = payRes.rows[0] || {};

  const originalAmount = roundMoney(debt.original_amount);
  const debtInterest = roundMoney(debt.interest_amount);
  const debtFine = roundMoney(debt.fine_amount);
  const debtDiscount = roundMoney(debt.discount_amount);

  const updatedAmount = roundMoney(originalAmount + debtInterest + debtFine - debtDiscount);
  const paidAmount = roundMoney(sums.total_paid_effective);
  const openAmount = roundMoney(Math.max(updatedAmount - paidAmount, 0));

  const status = buildStatusFromDebt({
    due_date: debt.due_date,
    updated_amount: updatedAmount,
    paid_amount: paidAmount,
    open_amount: openAmount
  });

  const updRes = await client.query(
    `
      UPDATE ${TB_DEBTS}
      SET
        paid_amount = $2,
        open_amount = $3,
        status = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [debtId, paidAmount, openAmount, status]
  );

  return updRes.rows[0];
}

/* ──────────────────────────────────────────────────────────────────────
 * CRUD / Queries
 * ────────────────────────────────────────────────────────────────────── */

async function listByDebtId(debtId) {
  const res = await pool.query(
    `
      SELECT
        id,
        debt_id,
        installment_number,
        installment_due_date,
        payment_date,
        amount,
        interest_amount,
        fine_amount,
        discount_amount,
        payment_method,
        receipt_number,
        notes,
        created_at,
        ROUND((amount + interest_amount + fine_amount - discount_amount)::numeric, 2) AS effective_amount
      FROM ${TB_PAYMENTS}
      WHERE debt_id = $1
      ORDER BY
        installment_number ASC NULLS LAST,
        installment_due_date ASC NULLS LAST,
        payment_date DESC,
        id DESC
    `,
    [debtId]
  );

  return res.rows;
}

async function getById(id) {
  const res = await pool.query(
    `
      SELECT
        id,
        debt_id,
        installment_number,
        installment_due_date,
        payment_date,
        amount,
        interest_amount,
        fine_amount,
        discount_amount,
        payment_method,
        receipt_number,
        notes,
        created_at,
        ROUND((amount + interest_amount + fine_amount - discount_amount)::numeric, 2) AS effective_amount
      FROM ${TB_PAYMENTS}
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return res.rows[0] || null;
}

async function createPayment(payload = {}) {
  const debtId = Number(payload.debt_id || payload.debtId);

  if (!Number.isInteger(debtId) || debtId <= 0) {
    throw new Error('debt_id inválido.');
  }

  const paymentDate = normalizeDate(payload.payment_date || payload.paymentDate);

  if (!paymentDate) {
    throw new Error('payment_date é obrigatório e deve ser válido.');
  }

  const installmentNumber = normalizeInstallmentNumber(
    payload.installment_number || payload.installmentNumber
  );

  const installmentDueDate = normalizeDate(
    payload.installment_due_date || payload.installmentDueDate
  );

  const amount = roundMoney(payload.amount);
  const interestAmount = roundMoney(payload.interest_amount);
  const fineAmount = roundMoney(payload.fine_amount);
  const discountAmount = roundMoney(payload.discount_amount);

  if (amount <= 0) {
    throw new Error('O valor do pagamento deve ser maior que zero.');
  }

  const paymentMethod = safeText(payload.payment_method || payload.paymentMethod, 50);
  const receiptNumber = safeText(payload.receipt_number || payload.receiptNumber, 80);
  const notes = safeText(payload.notes, 5000);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const debtRes = await client.query(
      `
        SELECT
          id,
          installment_total
        FROM ${TB_DEBTS}
        WHERE id = $1
        LIMIT 1
      `,
      [debtId]
    );

    if (!debtRes.rows.length) {
      throw new Error('Dívida não encontrada.');
    }

    const debt = debtRes.rows[0];
    const installmentTotal = Number(debt.installment_total || 0);

    if (installmentNumber && installmentTotal > 0 && installmentNumber > installmentTotal) {
      throw new Error('Número da parcela maior que a quantidade total de parcelas.');
    }

    const insRes = await client.query(
      `
        INSERT INTO ${TB_PAYMENTS} (
          debt_id,
          installment_number,
          installment_due_date,
          payment_date,
          amount,
          interest_amount,
          fine_amount,
          discount_amount,
          payment_method,
          receipt_number,
          notes,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        RETURNING
          id,
          debt_id,
          installment_number,
          installment_due_date,
          payment_date,
          amount,
          interest_amount,
          fine_amount,
          discount_amount,
          payment_method,
          receipt_number,
          notes,
          created_at,
          ROUND((amount + interest_amount + fine_amount - discount_amount)::numeric, 2) AS effective_amount
      `,
      [
        debtId,
        installmentNumber,
        installmentDueDate,
        paymentDate,
        amount,
        interestAmount,
        fineAmount,
        discountAmount,
        paymentMethod,
        receiptNumber,
        notes
      ]
    );

    const payment = insRes.rows[0];
    const updatedDebt = await recalcDebtById(client, debtId);

    await client.query('COMMIT');

    return {
      payment,
      debt: updatedDebt
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deletePayment(id) {
  const paymentId = Number(id);

  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    throw new Error('ID do pagamento inválido.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const payRes = await client.query(
      `
        SELECT id, debt_id
        FROM ${TB_PAYMENTS}
        WHERE id = $1
        LIMIT 1
      `,
      [paymentId]
    );

    if (!payRes.rows.length) {
      throw new Error('Pagamento não encontrado.');
    }

    const payment = payRes.rows[0];

    await client.query(
      `DELETE FROM ${TB_PAYMENTS} WHERE id = $1`,
      [paymentId]
    );

    const debt = await recalcDebtById(client, payment.debt_id);

    await client.query('COMMIT');

    return {
      deleted: true,
      payment_id: paymentId,
      debt
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getSummaryByDebtId(debtId) {
  const res = await pool.query(
    `
      SELECT
        debt_id,
        COUNT(*)::int AS payments_count,
        COALESCE(SUM(amount), 0)::numeric(14,2) AS principal_paid,
        COALESCE(SUM(interest_amount), 0)::numeric(14,2) AS interest_paid,
        COALESCE(SUM(fine_amount), 0)::numeric(14,2) AS fine_paid,
        COALESCE(SUM(discount_amount), 0)::numeric(14,2) AS discount_paid,
        COALESCE(SUM(amount + interest_amount + fine_amount - discount_amount), 0)::numeric(14,2) AS effective_paid
      FROM ${TB_PAYMENTS}
      WHERE debt_id = $1
      GROUP BY debt_id
    `,
    [debtId]
  );

  if (!res.rows.length) {
    return {
      debt_id: Number(debtId),
      payments_count: 0,
      principal_paid: 0,
      interest_paid: 0,
      fine_paid: 0,
      discount_paid: 0,
      effective_paid: 0
    };
  }

  return res.rows[0];
}

export default {
  listByDebtId,
  getById,
  createPayment,
  deletePayment,
  getSummaryByDebtId
};