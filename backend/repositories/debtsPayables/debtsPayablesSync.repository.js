// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtsPayablesSync.repository.js — Compromissos → Contas a Pagar    ║
// ║ Cada parcela do Compromisso = 1 título (criado/atualizado/removido)║
// ║ Valor, vencimento e pagamentos vêm sempre do Compromisso           ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import {
  TB_DEBTS,
  TB_PAYMENTS,
  TB_PLANS,
  TB_PAYABLE,
  TB_SUPPLIERS,
  SOURCE_TYPE
} from './debtsPayables.constants.js';
import {
  buildDebtSchedule,
  hasSchedule,
  installmentLabel,
  roundMoney,
  dateOnly
} from './debtsPayables.schedule.js';
import { ensureDebtPayableColumns } from './debtsPayablesSchema.repository.js';

/** Fornecedor do credor: pelo CNPJ/CPF, senão pelo nome */
async function resolveSupplierId(client, debt) {
  const doc = String(debt.creditor_document || '').replace(/\D/g, '');
  if (doc) {
    const { rows } = await client.query(
      `SELECT supplier_id FROM ${TB_SUPPLIERS}
        WHERE regexp_replace(COALESCE(tax_id, ''), '\\D', '', 'g') = $1
        ORDER BY supplier_id LIMIT 1`,
      [doc]
    );
    if (rows[0]) return rows[0].supplier_id;
  }

  const name = String(debt.creditor_name || '').trim();
  if (name) {
    const { rows } = await client.query(
      `SELECT supplier_id FROM ${TB_SUPPLIERS}
        WHERE UPPER(TRIM(name)) = UPPER($1)
        ORDER BY supplier_id LIMIT 1`,
      [name]
    );
    if (rows[0]) return rows[0].supplier_id;
  }

  return null;
}

/** Pagamentos por parcela: { [n]: { paid, last_date } } (null = sem parcela) */
async function loadPaidByInstallment(client, debtId) {
  const { rows } = await client.query(
    `SELECT installment_number,
            COALESCE(SUM(amount + interest_amount + fine_amount - discount_amount), 0) AS paid,
            MAX(payment_date) AS last_date
       FROM ${TB_PAYMENTS}
      WHERE debt_id = $1
      GROUP BY installment_number`,
    [debtId]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.installment_number == null ? null : Number(row.installment_number), {
      paid: roundMoney(row.paid),
      last_date: dateOnly(row.last_date)
    });
  }
  return map;
}

async function syncWithClient(client, debtId) {
  const { rows: debtRows } = await client.query(
    `SELECT * FROM ${TB_DEBTS} WHERE id = $1`,
    [debtId]
  );
  const debt = debtRows[0];

  if (!debt) {
    const del = await client.query(`DELETE FROM ${TB_PAYABLE} WHERE debt_id = $1`, [debtId]);
    return { debt_id: debtId, upserted: 0, removed: del.rowCount };
  }

  const { rows: plans } = await client.query(
    `SELECT start_installment, end_installment, installment_amount
       FROM ${TB_PLANS} WHERE debt_id = $1`,
    [debtId]
  );

  const schedule = buildDebtSchedule(debt, plans);
  const paidMap = await loadPaidByInstallment(client, debtId);
  const supplierId = await resolveSupplierId(client, debt);
  const scheduled = hasSchedule(debt);
  const issueDate = dateOnly(debt.issue_date) ||
    dateOnly(debt.agreement_closed_at) ||
    schedule[0]?.due_date || null;

  for (const item of schedule) {
    let paid;
    let paymentDate;
    let isPaid;

    if (scheduled) {
      const info = paidMap.get(item.number);
      paid = info?.paid || 0;
      paymentDate = info?.last_date || null;
      // Mesma regra do modal Pagamentos: parcela com pagamento = PAGA
      isPaid = Boolean(info);
    } else {
      paid = roundMoney(debt.paid_amount);
      paymentDate = [...paidMap.values()].map((v) => v.last_date).filter(Boolean).sort().pop() || null;
      isPaid = roundMoney(debt.open_amount) <= 0 && paid > 0;
    }

    const label = scheduled ? installmentLabel(item.number, item.total) : null;
    const invoiceNumber = (label || debt.document_number || debt.code || `COMP-${debt.id}`).slice(0, 50);
    const description = [debt.description, label ? `parcela ${label}` : null]
      .filter(Boolean).join(' — ');

    await client.query(
      `INSERT INTO ${TB_PAYABLE} (
         supplier_id, invoice_number, issue_date, due_date, payment_date,
         description, document_number, total_value, amount_paid, status,
         source_type, source_id, debt_id, debt_installment_number,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14,
         NOW(), NOW()
       )
       ON CONFLICT (debt_id, debt_installment_number) WHERE debt_id IS NOT NULL
       DO UPDATE SET
         supplier_id     = COALESCE(EXCLUDED.supplier_id, ${TB_PAYABLE}.supplier_id),
         invoice_number  = EXCLUDED.invoice_number,
         issue_date      = EXCLUDED.issue_date,
         due_date        = EXCLUDED.due_date,
         payment_date    = EXCLUDED.payment_date,
         description     = EXCLUDED.description,
         document_number = EXCLUDED.document_number,
         total_value     = EXCLUDED.total_value,
         amount_paid     = EXCLUDED.amount_paid,
         status          = EXCLUDED.status,
         source_type     = EXCLUDED.source_type,
         source_id       = EXCLUDED.source_id,
         updated_at      = NOW()
       WHERE (${TB_PAYABLE}.supplier_id, ${TB_PAYABLE}.invoice_number, ${TB_PAYABLE}.issue_date,
              ${TB_PAYABLE}.due_date, ${TB_PAYABLE}.payment_date, ${TB_PAYABLE}.description,
              ${TB_PAYABLE}.document_number, ${TB_PAYABLE}.total_value, ${TB_PAYABLE}.amount_paid,
              ${TB_PAYABLE}.status)
         IS DISTINCT FROM
             (COALESCE(EXCLUDED.supplier_id, ${TB_PAYABLE}.supplier_id), EXCLUDED.invoice_number,
              EXCLUDED.issue_date, EXCLUDED.due_date, EXCLUDED.payment_date, EXCLUDED.description,
              EXCLUDED.document_number, EXCLUDED.total_value, EXCLUDED.amount_paid, EXCLUDED.status)`,
      [
        supplierId,
        invoiceNumber,
        issueDate,
        item.due_date,
        isPaid ? paymentDate : null,
        description.slice(0, 255),
        debt.document_number || debt.reference_number || null,
        item.amount,
        paid,
        isPaid ? 'PAID' : 'PENDING',
        SOURCE_TYPE,
        debt.id,
        debt.id,
        item.number
      ]
    );
  }

  // Parcelas que deixaram de existir (total de parcelas diminuiu)
  const del = await client.query(
    `DELETE FROM ${TB_PAYABLE}
      WHERE debt_id = $1
        AND NOT (debt_installment_number = ANY($2::int[]))`,
    [debt.id, schedule.map((item) => item.number)]
  );

  return { debt_id: debt.id, upserted: schedule.length, removed: del.rowCount };
}

/** Sincroniza os títulos de um Compromisso (transação própria). */
export async function syncDebtPayables(debtId) {
  const id = Number(debtId);
  if (!Number.isInteger(id) || id <= 0) return null;

  await ensureDebtPayableColumns();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await syncWithClient(client, id);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Chamado pelos controllers depois de salvar: a falha só vai para o log,
 * o Compromisso já foi gravado e a carga do boot corrige depois.
 */
export async function syncDebtPayablesSafe(...debtIds) {
  const ids = [...new Set(debtIds.flat().map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  for (const id of ids) {
    try {
      await syncDebtPayables(id);
    } catch (error) {
      console.error(`[debtsPayables] Falha ao sincronizar o Compromisso #${id}:`, error);
    }
  }
}

/** Carga completa (boot): todos os Compromissos viram títulos em Contas a Pagar. */
export async function syncAllDebtPayables() {
  await ensureDebtPayableColumns();
  const { rows } = await pool.query(`SELECT id FROM ${TB_DEBTS} ORDER BY id`);
  let synced = 0;
  for (const row of rows) {
    try {
      await syncDebtPayables(row.id);
      synced += 1;
    } catch (error) {
      console.error(`[debtsPayables] Falha ao sincronizar o Compromisso #${row.id}:`, error);
    }
  }
  return { total: rows.length, synced };
}
