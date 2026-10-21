// ╔════════════════════════════════════════════════════════════════════╗
// ║ tmsOperations.repository.js — ações de Comercial e Operação        ║
// ║ Faturas: CT-es em aberto do tomador, emitir, baixar, cancelar      ║
// ║ Carga  : candidatos (CT-es / coletas) e liberar o carregamento     ║
// ║ Listas : lookups usados nos selects das telas                      ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { httpError, toInt, toNum, cleanText, toDate } from './tms.helpers.js';
import { withTx, get } from './tmsCrud.repository.js';

const run = (client) => (t, p) => client.query(t, p);

async function lockRow(client, table, pk, id, notFound) {
  const { rows: [row] } = await client.query(`SELECT * FROM ${table} WHERE ${pk} = $1 FOR UPDATE`, [toInt(id)]);
  if (!row) throw httpError(notFound, 404);
  return row;
}

// ═════════════════════════════ FATURAS ═════════════════════════════

/** CT-es emitidos e ainda não faturados (filtra pelo tomador) */
export async function openCtesForBilling({ customer_id, q = '', date_from, date_to } = {}) {
  const params = [];
  const where = [
    `c.status IN ('EMITIDO','AUTORIZADO')`,
    `NOT EXISTS (SELECT 1 FROM public."tmsFreightInvoiceItems" i
                   JOIN public."tmsFreightInvoices" fi ON fi.freight_invoice_id = i.freight_invoice_id
                  WHERE i.cte_id = c.cte_id AND fi.status <> 'CANCELADA')`,
  ];
  const cid = toInt(customer_id);
  if (cid) { params.push(cid); where.push(`c.payer_customer_id = $${params.length}`); }
  const term = cleanText(q);
  if (term) { params.push(`%${term}%`); where.push(`(c.payer_name ILIKE $${params.length} OR c.number::text ILIKE $${params.length})`); }
  const from = toDate(date_from);
  const to = toDate(date_to);
  if (from) { params.push(from); where.push(`c.issue_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`c.issue_date <= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT c.cte_id, c.series, c.number, c.issue_date::text AS issue_date, c.payer_customer_id, c.payer_name,
            c.payer_tax_id, c.recipient_name, c.destination_city, c.destination_state, c.freight_total
       FROM public."tmsCte" c WHERE ${where.join(' AND ')}
      ORDER BY c.payer_name, c.issue_date, c.number LIMIT 500`,
    params
  );
  return rows;
}

export async function issueInvoice(id) {
  return withTx(async (client) => {
    const inv = await lockRow(client, 'public."tmsFreightInvoices"', 'freight_invoice_id', id, 'INVOICE_NOT_FOUND');
    if (inv.status !== 'ABERTA') throw httpError('INVOICE_NOT_OPEN', 409);
    if (!inv.cte_count) throw httpError('INVOICE_WITHOUT_CTE', 400);
    await client.query(
      `UPDATE public."tmsFreightInvoices" SET status = 'EMITIDA' WHERE freight_invoice_id = $1`, [inv.freight_invoice_id]
    );
    return get('freightInvoices', inv.freight_invoice_id, run(client));
  });
}

export async function payInvoice(id, body = {}) {
  return withTx(async (client) => {
    const inv = await lockRow(client, 'public."tmsFreightInvoices"', 'freight_invoice_id', id, 'INVOICE_NOT_FOUND');
    if (inv.status !== 'EMITIDA') throw httpError('INVOICE_NOT_ISSUED', 409);
    const paid = toNum(body.paid_amount, Number(inv.net_amount));
    const paidAt = toDate(body.paid_at) || new Date().toISOString().slice(0, 10);
    await client.query(
      `UPDATE public."tmsFreightInvoices" SET status = 'PAGA', paid_amount = $2, paid_at = $3 WHERE freight_invoice_id = $1`,
      [inv.freight_invoice_id, paid, paidAt]
    );
    return get('freightInvoices', inv.freight_invoice_id, run(client));
  });
}

export async function cancelInvoice(id) {
  return withTx(async (client) => {
    const inv = await lockRow(client, 'public."tmsFreightInvoices"', 'freight_invoice_id', id, 'INVOICE_NOT_FOUND');
    if (inv.status === 'PAGA') throw httpError('INVOICE_PAID', 409);
    await client.query(
      `UPDATE public."tmsFreightInvoices" SET status = 'CANCELADA' WHERE freight_invoice_id = $1`, [inv.freight_invoice_id]
    );
    return get('freightInvoices', inv.freight_invoice_id, run(client));
  });
}

// ═════════════════════════════ CARGA ═════════════════════════════

/** CT-es a entregar e coletas em aberto que ainda não estão num plano ativo */
export async function loadPlanCandidates({ load_plan_id } = {}) {
  const planId = toInt(load_plan_id);
  const { rows: ctes } = await pool.query(
    `SELECT 'CTE' AS item_type, c.cte_id, NULL::bigint AS pickup_id, c.series, c.number, c.recipient_name AS name,
            c.destination_city AS city, c.destination_state AS state, c.weight_kg, c.cubage_m3, c.cargo_value AS value,
            c.status, c.delivery_status
       FROM public."tmsCte" c
      WHERE c.status IN ('DIGITADO','EMITIDO','AUTORIZADO') AND c.delivery_status IN ('PENDENTE','OCORRENCIA')
        AND NOT EXISTS (SELECT 1 FROM public."tmsLoadPlanItems" i JOIN public."tmsLoadPlans" p ON p.load_plan_id = i.load_plan_id
                         WHERE i.cte_id = c.cte_id AND p.status <> 'CANCELADO' AND p.load_plan_id IS DISTINCT FROM $1)
      ORDER BY c.destination_state, c.destination_city, c.cte_id LIMIT 300`,
    [planId]
  );
  const { rows: pickups } = await pool.query(
    `SELECT 'COLETA' AS item_type, NULL::bigint AS cte_id, k.pickup_id, k.customer_name AS name, k.city, k.state,
            k.weight_kg, k.cubage_m3, k.cargo_value AS value, k.status, k.scheduled_date::text AS scheduled_date
       FROM public."tmsPickupOrders" k
      WHERE k.status IN ('SOLICITADA','AGENDADA')
        AND NOT EXISTS (SELECT 1 FROM public."tmsLoadPlanItems" i JOIN public."tmsLoadPlans" p ON p.load_plan_id = i.load_plan_id
                         WHERE i.pickup_id = k.pickup_id AND p.status <> 'CANCELADO' AND p.load_plan_id IS DISTINCT FROM $1)
      ORDER BY k.scheduled_date NULLS LAST, k.pickup_id LIMIT 300`,
    [planId]
  );
  return { ctes, pickups };
}

export async function setLoadPlanStatus(id, { status } = {}) {
  const next = String(status || '').toUpperCase();
  if (!['PLANEJADO', 'CARREGANDO', 'LIBERADO', 'CANCELADO'].includes(next)) throw httpError('INVALID_STATUS', 400);
  return withTx(async (client) => {
    const plan = await lockRow(client, 'public."tmsLoadPlans"', 'load_plan_id', id, 'LOAD_PLAN_NOT_FOUND');
    if (plan.status === 'LIBERADO' && next !== 'CANCELADO') throw httpError('LOAD_PLAN_LOCKED', 409);
    if (plan.status === 'CANCELADO') throw httpError('LOAD_PLAN_LOCKED', 409);
    if (next === 'LIBERADO') {
      if (!plan.vehicle_id) throw httpError('VEHICLE_REQUIRED', 400);
      if (!plan.item_count) throw httpError('LOAD_PLAN_EMPTY', 400);
      const { rows: [veh] } = await client.query(
        'SELECT capacity_kg, capacity_m3 FROM public."vehicles" WHERE vehicle_id = $1', [plan.vehicle_id]
      );
      if (veh?.capacity_kg && Number(plan.total_weight_kg) > Number(veh.capacity_kg)) throw httpError('OVER_WEIGHT_CAPACITY', 409);
      if (veh?.capacity_m3 && Number(plan.total_cubage_m3) > Number(veh.capacity_m3)) throw httpError('OVER_CUBAGE_CAPACITY', 409);
      // CT-es e coletas do plano herdam veículo / motorista / rota
      await client.query(
        `UPDATE public."tmsCte" c SET vehicle_id = $2, driver_id = COALESCE($3, c.driver_id), trip_id = COALESCE($4, c.trip_id)
          WHERE c.cte_id IN (SELECT cte_id FROM public."tmsLoadPlanItems" WHERE load_plan_id = $1 AND cte_id IS NOT NULL)`,
        [plan.load_plan_id, plan.vehicle_id, plan.driver_id, plan.trip_id]
      );
      await client.query(
        `UPDATE public."tmsPickupOrders" k SET vehicle_id = $2, driver_id = COALESCE($3, k.driver_id),
                trip_id = COALESCE($4, k.trip_id), scheduled_date = COALESCE(k.scheduled_date, $5),
                status = CASE WHEN k.status = 'SOLICITADA' THEN 'AGENDADA' ELSE k.status END
          WHERE k.pickup_id IN (SELECT pickup_id FROM public."tmsLoadPlanItems" WHERE load_plan_id = $1 AND pickup_id IS NOT NULL)`,
        [plan.load_plan_id, plan.vehicle_id, plan.driver_id, plan.trip_id, plan.plan_date]
      );
    }
    await client.query('UPDATE public."tmsLoadPlans" SET status = $2 WHERE load_plan_id = $1', [plan.load_plan_id, next]);
    return get('loadPlans', plan.load_plan_id, run(client));
  });
}

// ═════════════════════════════ LISTAS (selects) ═════════════════════════════

const LOOKUPS = {
  vehicles: `SELECT vehicle_id AS id, plate || ' · ' || description AS label, capacity_kg, capacity_m3
               FROM public."vehicles" WHERE is_active = TRUE ORDER BY plate`,
  drivers: `SELECT d.driver_id AS id, e.full_name AS label, d.cnh_expiration::text AS cnh_expiration
              FROM public."drivers" d JOIN public.employees e ON e.employee_id = d.employee_id
             WHERE d.is_active = TRUE ORDER BY e.full_name`,
  trips: `SELECT trip_id AS id, '#' || trip_id || ' · ' || to_char(trip_date, 'DD/MM/YYYY') || COALESCE(' · ' || name, '') AS label
            FROM public."deliveryTrips" WHERE status <> 'CANCELADA' ORDER BY trip_date DESC, trip_id DESC LIMIT 200`,
  policies: `SELECT policy_id AS id, insurer_name || ' · ' || policy_number || ' (' || coverage || ')' AS label
               FROM public."tmsInsurancePolicies" WHERE is_active = TRUE ORDER BY insurer_name`,
  freightTables: `SELECT table_id AS id, name || COALESCE(' · ' || customer_name, '') AS label
                    FROM public."tmsFreightTables" WHERE is_active = TRUE ORDER BY name`,
  maintenancePlans: `SELECT mp.maintenance_plan_id AS id, v.plate || ' · ' || mp.service_name AS label, mp.vehicle_id
                       FROM public."tmsMaintenancePlans" mp JOIN public."vehicles" v ON v.vehicle_id = mp.vehicle_id
                      WHERE mp.is_active = TRUE ORDER BY v.plate, mp.service_name`,
  tires: `SELECT tire_id AS id, fire_number || COALESCE(' · ' || brand, '') || ' (' || status || ')' AS label, status
            FROM public."tmsTires" WHERE status <> 'SUCATA' ORDER BY fire_number`,
  issuedCtes: `SELECT cte_id AS id, 'CT-e ' || number || ' · ' || recipient_name || ' · ' || COALESCE(destination_city, '')
                      || '/' || COALESCE(destination_state, '') AS label
                 FROM public."tmsCte" WHERE status IN ('EMITIDO','AUTORIZADO') ORDER BY number DESC LIMIT 500`,
  mdfes: `SELECT mdfe_id AS id, 'MDF-e ' || COALESCE(number::text, '(digitado)') || ' · ' || to_char(issue_date, 'DD/MM/YYYY') AS label
            FROM public."tmsMdfe" WHERE status <> 'CANCELADO' ORDER BY mdfe_id DESC LIMIT 200`,
};

export async function lookup(name, { q = '' } = {}) {
  if (name === 'customers') return searchCustomers(q);
  if (name === 'transporters') return searchTransporters(q);
  const sql = LOOKUPS[name];
  if (!sql) throw httpError('LOOKUP_NOT_FOUND', 404);
  const { rows } = await pool.query(sql);
  return rows;
}

async function searchCustomers(q) {
  const term = cleanText(q);
  const params = [];
  let where = 'WHERE COALESCE(c.is_active, TRUE) = TRUE';
  if (term) {
    params.push(`%${term}%`, `${term.replace(/\D/g, '') || '~'}%`, term);
    where += ` AND (c.trade_name ILIKE $1 OR c.legal_name ILIKE $1
                   OR regexp_replace(COALESCE(c.tax_id, ''), '\\D', '', 'g') LIKE $2 OR c.customer_id::text = $3)`;
  }
  const { rows } = await pool.query(
    `SELECT c.customer_id AS id, COALESCE(NULLIF(c.legal_name, ''), c.trade_name) AS name, c.trade_name, c.tax_id,
            c.city, LEFT(c.state, 2) AS state,
            CONCAT_WS(', ', NULLIF(CONCAT_WS(' ', c.street_type, c.street_name), ''), NULLIF(c.street_number, '')) AS address,
            c.neighborhood, c.postal_code, COALESCE(c.mobile_number, c.phone_number) AS phone
       FROM public.customers c ${where}
      ORDER BY 2 LIMIT 30`,
    params
  );
  return rows.map((r) => ({ ...r, label: `${r.name}${r.tax_id ? ` · ${r.tax_id}` : ''}${r.city ? ` · ${r.city}/${r.state ?? ''}` : ''}` }));
}

async function searchTransporters(q) {
  const term = cleanText(q);
  const params = [];
  let where = '';
  if (term) {
    params.push(`%${term}%`);
    where = 'WHERE t.legal_name ILIKE $1 OR t.trade_name ILIKE $1 OR t.tax_id ILIKE $1 OR t.cpf ILIKE $1';
  }
  const { rows } = await pool.query(
    `SELECT t.transporter_id AS id, t.legal_name AS name, COALESCE(NULLIF(t.cpf, ''), t.tax_id) AS doc, t.rntrc,
            t.legal_name || COALESCE(' · ' || NULLIF(t.cpf, ''), ' · ' || t.tax_id, '') AS label
       FROM public.transporters t ${where} ORDER BY t.legal_name LIMIT 30`,
    params
  );
  return rows;
}
