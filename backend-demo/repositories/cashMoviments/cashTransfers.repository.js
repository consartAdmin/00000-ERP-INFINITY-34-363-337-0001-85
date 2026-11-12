// ╔════════════════════════════════════════════════════════════════════╗
// ║ cashTransfers.repository.js — Transferência entre contas           ║
// ║ - SAIDA na origem + ENTRADA no destino, ligadas por transfer_id    ║
// ║ - Não são receita/despesa: sem categoria/plano de contas           ║
// ║ - Tarifa opcional = SAIDA comum (despesa) na origem                ║
// ║ - Editar muda as duas pontas; excluir apaga as duas (e a tarifa)   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { ensureCashTaxColumns } from './cashMoviments.utils.js';
import { ensureFiscalDocumentsSchema } from '../cashFiscalDocuments/cashFiscalDocuments.schema.js';
import { ensureTransfersSchema } from './cashTransfers.schema.js';

const DOC_TYPE = 'TRANSFERÊNCIA';
const FEE_DOC_TYPE = 'TARIFA';

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

async function ensureSchema() {
  await ensureCashTaxColumns();
  await ensureFiscalDocumentsSchema();
  await ensureTransfersSchema();
}

const positiveId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Aceita 1234.56, "1234,56" e "1.234,56"
function toMoney(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const raw = String(value).trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const docNumber = (id) => `TRF-${id}`;
const outName = (to) => `Transferência → ${to}`.slice(0, 255);
const inName = (from) => `Transferência ← ${from}`.slice(0, 255);
const feeName = (from) => `Tarifa de transferência ${from}`.slice(0, 255);

async function loadAccount(client, id, label) {
  const accountId = positiveId(id);
  const { rows } = accountId
    ? await client.query(`SELECT id, name FROM "bankAccounts" WHERE id = $1`, [accountId])
    : { rows: [] };
  if (!rows[0]) throw badRequest(`Escolha a conta de ${label}.`);
  return { id: Number(rows[0].id), name: String(rows[0].name).trim().slice(0, 50) };
}

/** Normaliza e valida o payload da tela (criar ou editar). */
async function readPayload(client, payload = {}) {
  const from = await loadAccount(client, payload.from_bank_account_id, 'origem');
  const to = await loadAccount(client, payload.to_bank_account_id, 'destino');
  if (from.id === to.id) throw badRequest('A conta de origem e a de destino precisam ser diferentes.');

  const date = String(payload.transfer_date ?? payload.movement_date ?? '').trim();
  if (!date || Number.isNaN(new Date(date).getTime())) throw badRequest('Informe a data da transferência.');

  const amount = toMoney(payload.amount);
  if (!amount || amount <= 0) throw badRequest('Informe o valor da transferência.');

  const notes = String(payload.notes ?? '').trim() || null;

  const feeAmount = toMoney(payload.fee_amount);
  const fee = feeAmount && feeAmount > 0
    ? {
      amount: feeAmount,
      chart_account_id: positiveId(payload.fee_chart_account_id),
      is_deductible: payload.fee_is_deductible === undefined ? true : payload.fee_is_deductible !== false,
    }
    : null;

  if (fee?.chart_account_id) {
    const { rows } = await client.query(`SELECT id FROM "chartOfAccounts" WHERE id = $1`, [fee.chart_account_id]);
    if (!rows[0]) throw badRequest('Plano de contas da tarifa não encontrado.');
  }

  return { from, to, date, amount, notes, fee };
}

async function insertLeg(client, { type, account, date, amount, name, notes, transferId }) {
  const { rows } = await client.query(
    `INSERT INTO "cashMoviments" (
       movement_date, movement_type, cash_account, bank_account_id, amount,
       document_type, document_number, supplier_name, notes,
       penalty_amount, interest_amount, fee_amount,
       category, subcategory, chart_account_id,
       is_deductible, is_pis_cofins_creditable, deduct_charges_only,
       is_active, transfer_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, 0, NULL, NULL, NULL,
               FALSE, FALSE, NULL, TRUE, $10)
     RETURNING id`,
    [date, type, account.name, account.id, amount, DOC_TYPE, docNumber(transferId), name, notes, transferId]
  );
  return Number(rows[0].id);
}

async function insertFee(client, { from, date, fee, notes, transferId }) {
  const { rows } = await client.query(
    `INSERT INTO "cashMoviments" (
       movement_date, movement_type, cash_account, bank_account_id, amount,
       document_type, document_number, supplier_name, notes,
       penalty_amount, interest_amount, fee_amount,
       chart_account_id, is_deductible, is_pis_cofins_creditable, is_active
     ) VALUES ($1, 'SAIDA', $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, $9, $10, FALSE, TRUE)
     RETURNING id`,
    [date, from.name, from.id, fee.amount, FEE_DOC_TYPE, docNumber(transferId), feeName(from.name),
      notes, fee.chart_account_id, fee.is_deductible]
  );
  return Number(rows[0].id);
}

async function withTransaction(fn) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getTransfer(id, client = null) {
  if (!client) await ensureSchema();
  const db = client || pool;
  const transferId = positiveId(id);
  if (!transferId) return null;

  const { rows } = await db.query(
    `SELECT t.*,
            f.amount AS fee_amount,
            f.chart_account_id AS fee_chart_account_id,
            coa.code AS fee_chart_account_code,
            coa.description AS fee_chart_account_description,
            f.is_deductible AS fee_is_deductible
       FROM "cashTransfers" t
       LEFT JOIN "cashMoviments" f ON f.id = t.fee_movement_id
       LEFT JOIN "chartOfAccounts" coa ON coa.id = f.chart_account_id
      WHERE t.id = $1`,
    [transferId]
  );
  if (!rows[0]) return null;

  const legs = await db.query(
    `SELECT id, movement_type, cash_account, bank_account_id, amount
       FROM "cashMoviments" WHERE transfer_id = $1 ORDER BY id`,
    [transferId]
  );

  const t = rows[0];
  return {
    ...t,
    document_number: docNumber(t.id),
    out_movement_id: legs.rows.find((r) => r.movement_type === 'SAIDA')?.id ?? null,
    in_movement_id: legs.rows.find((r) => r.movement_type === 'ENTRADA')?.id ?? null,
    movement_ids: legs.rows.map((r) => Number(r.id)),
  };
}

export async function createTransfer(payload = {}) {
  return withTransaction(async (client) => {
    const p = await readPayload(client, payload);

    const { rows } = await client.query(
      `INSERT INTO "cashTransfers"
         (transfer_date, amount, from_bank_account_id, from_account, to_bank_account_id, to_account, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [p.date, p.amount, p.from.id, p.from.name, p.to.id, p.to.name, p.notes]
    );
    const transferId = Number(rows[0].id);

    await insertLeg(client, { type: 'SAIDA', account: p.from, date: p.date, amount: p.amount, name: outName(p.to.name), notes: p.notes, transferId });
    await insertLeg(client, { type: 'ENTRADA', account: p.to, date: p.date, amount: p.amount, name: inName(p.from.name), notes: p.notes, transferId });

    if (p.fee) {
      const feeId = await insertFee(client, { from: p.from, date: p.date, fee: p.fee, notes: p.notes, transferId });
      await client.query(`UPDATE "cashTransfers" SET fee_movement_id = $1 WHERE id = $2`, [feeId, transferId]);
    }

    return getTransfer(transferId, client);
  });
}

export async function updateTransfer(id, payload = {}) {
  return withTransaction(async (client) => {
    const current = await getTransfer(id, client);
    if (!current) return null;

    const p = await readPayload(client, payload);
    const transferId = Number(current.id);

    await client.query(
      `UPDATE "cashTransfers"
          SET transfer_date = $1, amount = $2,
              from_bank_account_id = $3, from_account = $4,
              to_bank_account_id = $5, to_account = $6,
              notes = $7, updated_at = now()
        WHERE id = $8`,
      [p.date, p.amount, p.from.id, p.from.name, p.to.id, p.to.name, p.notes, transferId]
    );

    // Recria a ponta que faltar (ex.: excluída por fora antes deste recurso)
    const legs = [
      { type: 'SAIDA', account: p.from, name: outName(p.to.name), movementId: current.out_movement_id },
      { type: 'ENTRADA', account: p.to, name: inName(p.from.name), movementId: current.in_movement_id },
    ];
    for (const leg of legs) {
      if (leg.movementId) {
        await client.query(
          `UPDATE "cashMoviments"
              SET movement_date = $1, cash_account = $2, bank_account_id = $3, amount = $4,
                  supplier_name = $5, notes = $6, updated_at = now()
            WHERE id = $7`,
          [p.date, leg.account.name, leg.account.id, p.amount, leg.name, p.notes, leg.movementId]
        );
      } else {
        await insertLeg(client, { ...leg, date: p.date, amount: p.amount, notes: p.notes, transferId });
      }
    }

    const feeId = current.fee_amount != null ? Number(current.fee_movement_id) : null;
    if (p.fee && feeId) {
      await client.query(
        `UPDATE "cashMoviments"
            SET movement_date = $1, cash_account = $2, bank_account_id = $3, amount = $4,
                supplier_name = $5, notes = $6, chart_account_id = $7, is_deductible = $8, updated_at = now()
          WHERE id = $9`,
        [p.date, p.from.name, p.from.id, p.fee.amount, feeName(p.from.name), p.notes,
          p.fee.chart_account_id, p.fee.is_deductible, feeId]
      );
    } else if (p.fee) {
      const newFeeId = await insertFee(client, { from: p.from, date: p.date, fee: p.fee, notes: p.notes, transferId });
      await client.query(`UPDATE "cashTransfers" SET fee_movement_id = $1 WHERE id = $2`, [newFeeId, transferId]);
    } else if (feeId) {
      await client.query(`DELETE FROM "cashMovimentsAttachments" WHERE cash_movement_id = $1`, [feeId]);
      await client.query(`DELETE FROM "cashMoviments" WHERE id = $1`, [feeId]);
      await client.query(`UPDATE "cashTransfers" SET fee_movement_id = NULL WHERE id = $1`, [transferId]);
    }

    return getTransfer(transferId, client);
  });
}

/** Apaga as transferências (pontas + tarifa + anexos). Usa o client da transação, se vier. */
export async function deleteTransfers(ids = [], client = null) {
  const transferIds = [...new Set((ids || []).map(positiveId).filter(Boolean))];
  if (!transferIds.length) return { transfers: 0, movement_ids: [] };

  const run = async (db) => {
    const { rows } = await db.query(
      `SELECT id FROM "cashMoviments" WHERE transfer_id = ANY($1::bigint[])
       UNION
       SELECT fee_movement_id FROM "cashTransfers"
        WHERE id = ANY($1::bigint[]) AND fee_movement_id IS NOT NULL`,
      [transferIds]
    );
    const movementIds = rows.map((r) => Number(r.id));

    if (movementIds.length) {
      await db.query(`DELETE FROM "cashMovimentsAttachments" WHERE cash_movement_id = ANY($1::bigint[])`, [movementIds]);
      await db.query(`DELETE FROM "cashMoviments" WHERE id = ANY($1::bigint[])`, [movementIds]);
    }
    const res = await db.query(`DELETE FROM "cashTransfers" WHERE id = ANY($1::bigint[])`, [transferIds]);

    return { transfers: res.rowCount, movement_ids: movementIds };
  };

  return client ? run(client) : withTransaction(run);
}

export async function deleteTransfer(id) {
  const result = await deleteTransfers([id]);
  return result.transfers > 0 ? result : null;
}

/** transfer_id das movimentações informadas (só as que são ponta de transferência). */
export async function transferIdsOfMovements(movementIds = [], client = null) {
  const ids = [...new Set((movementIds || []).map(positiveId).filter(Boolean))];
  if (!ids.length) return [];
  if (!client) await ensureSchema();
  const { rows } = await (client || pool).query(
    `SELECT DISTINCT transfer_id FROM "cashMoviments"
      WHERE id = ANY($1::bigint[]) AND transfer_id IS NOT NULL`,
    [ids]
  );
  return rows.map((r) => Number(r.transfer_id));
}
