// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtPaymentsRemove.repository.js — deletePayment                   ║
// ║ Remove pagamento e recalcula a dívida (transação)                  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_PAYMENTS } from './debtPayments.constants.js';
import { recalcDebtById } from './debtPaymentsRecalc.repository.js';

export async function deletePayment(id) {
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
