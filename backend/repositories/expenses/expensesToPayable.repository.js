// ╔════════════════════════════════════════════════════════════════════╗
// ║ expensesToPayable.repository.js — Despesas marcadas → Contas a     ║
// ║ Pagar. A despesa é um modelo: gera N parcelas mensais a partir do  ║
// ║ vencimento da despesa (source_type 'EXPENSE', source_id = id).     ║
// ║ Grava o último título em Expenses.account_payable_id.              ║
// ║ Não duplica: parcela com mesmo vencimento já enviada é ignorada.   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB } from './expenses.constants.js';
import { normalizeIds } from './expensesBatch.repository.js';
import { ensureCashCategoryColumns } from '../cashCategories/cashCategoryLink.repository.js';

const TB_AP = 'public."accountsPayable"';
const TB_SUPPLIERS = 'public.suppliers';
const SOURCE_TYPE = 'EXPENSE';

const toIdOrNull = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const dateOnly = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Fornecedor da despesa (texto) → suppliers.supplier_id pelo nome */
async function findSupplierId(client, vendor) {
  const name = String(vendor || '').trim();
  if (!name) return null;
  const { rows } = await client.query(
    `SELECT supplier_id FROM ${TB_SUPPLIERS}
      WHERE UPPER(TRIM(name)) = UPPER($1)
      ORDER BY supplier_id LIMIT 1`,
    [name]
  );
  return rows[0] ? Number(rows[0].supplier_id) : null;
}

export const MAX_PARCELS = 60;

/** Soma n meses a 'YYYY-MM-DD', mantendo o dia (limitado ao último dia do mês) */
export function addMonths(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/**
 * Envia as despesas marcadas ao Contas a Pagar em N parcelas mensais.
 * Parcela 1 vence no vencimento da despesa; as demais, mês a mês.
 * Cada parcela tem o valor da despesa. Parcela com o mesmo vencimento
 * já enviada (mesma despesa) é ignorada, então reenviar não duplica.
 *
 * @param {number[]} ids
 * @param {number} parcels 1..60
 * @returns {{ created: Array, skipped: Array }}
 */
export async function sendExpensesToPayable(ids, parcels, user = {}) {
  const list = normalizeIds(ids);
  if (!list.length) return { created: [], skipped: [] };
  const total = Number.parseInt(parcels, 10);
  if (!Number.isInteger(total) || total < 1 || total > MAX_PARCELS) {
    throw Object.assign(new Error(`Quantidade de parcelas inválida (1 a ${MAX_PARCELS}).`), { status: 400 });
  }

  const cash = await ensureCashCategoryColumns(TB);
  const cashCols = cash.columns
    ? 'e."cash_category_id", e."cash_subcategory_id"'
    : 'NULL::integer AS "cash_category_id", NULL::integer AS "cash_subcategory_id"';

  const client = await pool.connect();
  const created = [];
  const skipped = [];

  try {
    await client.query('BEGIN');

    const { rows: expenses } = await client.query(
      `SELECT e."id", e."expense_id", e."name", e."description", e."value", e."due_date",
              e."vendor", e."is_active", e."cost_center", ${cashCols}
         FROM ${TB} e
        WHERE e."id" = ANY($1::int[])
        ORDER BY e."due_date" NULLS LAST, e."id"
        FOR UPDATE OF e`,
      [list]
    );

    for (const e of expenses) {
      const label = e.name || `#${e.id}`;
      if (e.is_active === false) {
        skipped.push({ id: e.id, name: label, reason: 'despesa inativa' });
        continue;
      }
      const value = Number(e.value || 0);
      if (!(value > 0)) {
        skipped.push({ id: e.id, name: label, reason: 'sem valor' });
        continue;
      }
      const firstDue = dateOnly(e.due_date);
      if (!firstDue) {
        skipped.push({ id: e.id, name: label, reason: 'sem vencimento' });
        continue;
      }

      const dues = Array.from({ length: total }, (_, i) => addMonths(firstDue, i));
      const { rows: existing } = await client.query(
        `SELECT id, to_char(due_date, 'YYYY-MM-DD') AS due
           FROM ${TB_AP}
          WHERE source_type = $1 AND source_id::text = $2::text
            AND due_date = ANY($3::date[])`,
        [SOURCE_TYPE, String(e.id), dues]
      );
      const already = new Map(existing.map((r) => [r.due, Number(r.id)]));

      const supplierId = await findSupplierId(client, e.vendor);
      const code = e.expense_id || `DESP-${e.id}`;
      const description = [e.name, e.description].filter(Boolean).join(' - ') || `Despesa #${e.id}`;
      let lastPayableId = null;
      const mine = { id: e.id, name: label, value, parcels: [], supplier_found: Boolean(supplierId) };
      const repeated = [];

      for (let i = 0; i < total; i += 1) {
        const due = dues[i];
        if (already.has(due)) {
          repeated.push(`${i + 1}/${total} (título nº ${already.get(due)})`);
          continue;
        }
        const parcelLabel = total > 1 ? ` (${i + 1}/${total})` : '';
        const notes = [
          `Gerado em Gestão de Despesas (despesa #${e.id}${e.expense_id ? ` • ${e.expense_id}` : ''}${total > 1 ? `, parcela ${i + 1}/${total}` : ''}).`,
          e.vendor && !supplierId ? `Fornecedor informado na despesa: ${e.vendor} (não encontrado no cadastro).` : '',
          e.cost_center ? `Centro de custo: ${e.cost_center}.` : '',
          user?.name ? `Enviado por ${user.name}.` : '',
        ].filter(Boolean).join(' ');

        const { rows } = await client.query(
          `INSERT INTO ${TB_AP} (
             supplier_id, invoice_number, issue_date, due_date, payment_date, payment_method_id,
             description, category_id, subcategory_id, document_number, total_value, amount_paid,
             status, notes, attachment_url, source_type, source_id, created_at, updated_at
           ) VALUES ($1, NULL, CURRENT_DATE, $2, NULL, NULL, $3, $4, $5, $6, $7, 0,
                     'PENDING', $8, NULL, $9, $10, NOW(), NOW())
           RETURNING id`,
          [
            supplierId,
            due,
            `${description}${parcelLabel}`,
            toIdOrNull(e.cash_category_id),
            toIdOrNull(e.cash_subcategory_id),
            total > 1 ? `${code}/${i + 1}-${total}` : code,
            value,
            notes,
            SOURCE_TYPE,
            e.id,
          ]
        );
        lastPayableId = Number(rows[0].id);
        mine.parcels.push({ number: i + 1, due_date: due, account_payable_id: lastPayableId });
      }

      if (lastPayableId) {
        await client.query(
          `UPDATE ${TB} SET "account_payable_id" = $1, "updated_at" = NOW() WHERE "id" = $2`,
          [lastPayableId, e.id]
        );
        created.push(mine);
      }
      if (repeated.length) {
        skipped.push({ id: e.id, name: label, reason: `parcela(s) já enviada(s): ${repeated.join(', ')}` });
      }
    }

    // ids pedidos que não existem mais
    const found = new Set(expenses.map((e) => Number(e.id)));
    list.filter((id) => !found.has(id)).forEach((id) => skipped.push({ id, name: `#${id}`, reason: 'despesa não encontrada' }));

    await client.query('COMMIT');
    return { created, skipped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
