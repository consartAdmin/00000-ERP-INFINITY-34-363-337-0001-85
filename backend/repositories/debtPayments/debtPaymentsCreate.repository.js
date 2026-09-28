// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtPaymentsCreate.repository.js — createPayment                   ║
// ║ Insere pagamento e recalcula a dívida (transação)                  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_DEBTS, TB_PAYMENTS } from './debtPayments.constants.js';
import {
  roundMoney,
  safeText,
  normalizeDate,
  normalizeInstallmentNumber
} from './debtPayments.utils.js';
import { recalcDebtById } from './debtPaymentsRecalc.repository.js';

export async function createPayment(payload = {}) {
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
