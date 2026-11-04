// ╔══════════════════════════════════════════════════════════════════════╗
// ║ voiceBudgetsHistory.repository.js — Orçamento por voz                ║
// ║ Itens da última NF-e autorizada e do último orçamento de um cliente, ║
// ║ para o Claude montar um orçamento "igual ao último".                 ║
// ║ Somente leitura.                                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const MAX_ITEMS = 60;

const STATUS_CODE = `
  COALESCE(
    nsm.code,
    UPPER(TRANSLATE(COALESCE(i.nfe_status, ''),
      'ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ', 'AAAAEEEIIIOOOOUUUC'))
  )`;

function toId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Última NF-e autorizada do cliente (de pedido ou de orçamento) com os itens.
 * Devolve null quando o cliente não tem nota autorizada.
 */
export async function lastInvoiceItems(customerId) {
  const cid = toId(customerId);
  if (!cid) return null;

  const { rows } = await pool.query(
    `
    SELECT i.invoice_id, i.order_id, i.budget_id, i.nfe_number,
           COALESCE(i.issued_at, i.issued_date::timestamptz, i.created_at) AS issued_at,
           i.total_amount
      FROM public."invoicesIssued" i
      LEFT JOIN public."nfeStatusMap" nsm ON nsm.nfe_status_id = i.nfe_status_id
      LEFT JOIN public."orders" o ON o.order_id = i.order_id
      LEFT JOIN public."budgets" b ON b.budget_id = i.budget_id
     WHERE COALESCE(o.customer_id, b.customer_id) = $1
       AND ${STATUS_CODE} = 'AUTORIZADO'
     ORDER BY COALESCE(i.issued_at, i.issued_date::timestamptz, i.created_at) DESC NULLS LAST,
              i.invoice_id DESC
     LIMIT 1
    `,
    [cid],
  );
  const inv = rows[0];
  if (!inv) return null;

  let items = [];
  if (inv.order_id) {
    ({ rows: items } = await pool.query(
      `SELECT product_code, description, unit_code, quantity
         FROM public."ordersItems"
        WHERE order_id = $1
        ORDER BY order_item_id ASC
        LIMIT ${MAX_ITEMS}`,
      [inv.order_id],
    ));
  } else if (inv.budget_id) {
    ({ rows: items } = await pool.query(
      `SELECT product_code, description, unit_code, quantity
         FROM public."budgetsItems"
        WHERE budget_id = $1
        ORDER BY budget_item_id ASC
        LIMIT ${MAX_ITEMS}`,
      [inv.budget_id],
    ));
  }

  return { ...inv, items };
}

/** Último orçamento do cliente (qualquer status) com os itens. */
export async function lastBudgetItems(customerId) {
  const cid = toId(customerId);
  if (!cid) return null;

  const { rows } = await pool.query(
    `SELECT budget_id, issue_date, status, total_amount
       FROM public."budgets"
      WHERE customer_id = $1
      ORDER BY COALESCE(issue_date::timestamptz, created_at) DESC NULLS LAST, budget_id DESC
      LIMIT 1`,
    [cid],
  );
  const budget = rows[0];
  if (!budget) return null;

  const { rows: items } = await pool.query(
    `SELECT product_code, description, unit_code, quantity
       FROM public."budgetsItems"
      WHERE budget_id = $1
      ORDER BY budget_item_id ASC
      LIMIT ${MAX_ITEMS}`,
    [budget.budget_id],
  );
  return { ...budget, items };
}

export default { lastInvoiceItems, lastBudgetItems };
