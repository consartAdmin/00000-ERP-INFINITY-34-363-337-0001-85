// ╔════════════════════════════════════════════════════════════════════╗
// ║ deliveryTripsRentability.repository.js — Rentabilidade da rota     ║
// ║ Itens (com preço e desconto) de cada parada de ENTREGA da rota,    ║
// ║ vindos do Pedido/Orçamento da parada ou da NF-e (pedido/orçamento  ║
// ║ de origem). Custo e impostos são calculados no front, com as       ║
// ║ mesmas regras do modal Rentabilidade do Orçamento.                 ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { httpError, toInt } from './deliveryTrips.schema.js';
import { STOPS } from './deliveryTrips.constants.js';

const ITEM_COLS = `product_code, description, unit_code, quantity, unit_price, discount_value`;

/** Frete por documento (budgetsShipping / ordersShipping); se a tabela não existir, fica 0 */
async function freightMap(table, col, ids) {
  if (!ids.length) return {};
  try {
    const { rows } = await pool.query(
      `SELECT ${col} AS id, SUM(COALESCE(freight_value, 0)) AS freight
         FROM public."${table}" WHERE ${col} = ANY($1::bigint[]) GROUP BY ${col}`,
      [ids]
    );
    return Object.fromEntries(rows.map((r) => [String(r.id), Number(r.freight) || 0]));
  } catch (e) {
    console.warn(`[deliveryTrips] frete ${table}:`, e.message);
    return {};
  }
}

export async function getTripRentability(tripId) {
  const id = toInt(tripId);
  const trip = await pool.query(`SELECT trip_id FROM public."deliveryTrips" WHERE trip_id = $1`, [id]);
  if (!trip.rows[0]) throw httpError('TRIP_NOT_FOUND', 404);

  const { rows: stops } = await pool.query(
    `SELECT s.stop_id, s.stop_order, s.movement_type, s.source_type, s.status,
            s.recipient_name, s.document_amount, s.invoice_id, i.nfe_number,
            COALESCE(s.order_id, i.order_id)   AS order_id,
            COALESCE(s.budget_id, i.budget_id) AS budget_id
       FROM ${STOPS} s
       LEFT JOIN public."invoicesIssued" i ON i.invoice_id = s.invoice_id
      WHERE s.trip_id = $1 AND s.movement_type = 'ENTREGA'
      ORDER BY s.stop_order, s.stop_id`,
    [id]
  );

  const orderIds = [...new Set(stops.map((s) => s.order_id).filter(Boolean).map(Number))];
  const budgetIds = [...new Set(stops.filter((s) => !s.order_id && s.budget_id).map((s) => Number(s.budget_id)))];

  const [orderItems, budgetItems, orderFreight, budgetFreight] = await Promise.all([
    orderIds.length
      ? pool.query(`SELECT order_id AS doc_id, ${ITEM_COLS} FROM public."ordersItems"
                     WHERE order_id = ANY($1::bigint[]) ORDER BY order_item_id`, [orderIds]).then((r) => r.rows)
      : [],
    budgetIds.length
      ? pool.query(`SELECT budget_id AS doc_id, ${ITEM_COLS} FROM public."budgetsItems"
                     WHERE budget_id = ANY($1::bigint[]) ORDER BY budget_item_id`, [budgetIds]).then((r) => r.rows)
      : [],
    freightMap('ordersShipping', 'order_id', orderIds),
    freightMap('budgetsShipping', 'budget_id', budgetIds),
  ]);

  const group = (rows) => rows.reduce((acc, r) => {
    (acc[String(r.doc_id)] ||= []).push({
      sku: r.product_code,
      description: r.description,
      unit: r.unit_code,
      quantity: Number(r.quantity) || 0,
      unit_price: Number(r.unit_price) || 0,
      discount_value: Number(r.discount_value) || 0,
    });
    return acc;
  }, {});
  const byOrder = group(orderItems);
  const byBudget = group(budgetItems);

  return {
    trip_id: id,
    stops: stops.map((s) => {
      const key = s.order_id ? String(s.order_id) : String(s.budget_id || '');
      return {
        stop_id: Number(s.stop_id),
        stop_order: s.stop_order,
        source_type: s.source_type,
        status: s.status,
        recipient_name: s.recipient_name,
        document_amount: Number(s.document_amount) || 0,
        nfe_number: s.nfe_number,
        order_id: s.order_id ? Number(s.order_id) : null,
        budget_id: s.budget_id ? Number(s.budget_id) : null,
        freight_value: s.order_id ? (orderFreight[key] || 0) : (budgetFreight[key] || 0),
        items: (s.order_id ? byOrder[key] : byBudget[key]) || [],
      };
    }),
  };
}
