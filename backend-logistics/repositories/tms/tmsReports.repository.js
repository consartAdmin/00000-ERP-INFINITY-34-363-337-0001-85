// ╔════════════════════════════════════════════════════════════════════╗
// ║ tmsReports.repository.js — Resultado por viagem / veículo /        ║
// ║ cliente e alertas da frota                                          ║
// ║ Receita : frete dos CT-es da rota (exceto cancelados)              ║
// ║ Custos  : abastecimentos + despesas da viagem (pedágio, diárias…)  ║
// ║           + contratos TAC (frete + vale-pedágio) + OS da viagem    ║
// ║ Por cliente: o custo da rota é rateado pela receita de cada CT-e   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { toDate, toInt } from './tms.helpers.js';
import { vehicleKmSql } from './tms.resources.js';

const TRIP_RESULT_CTE = `
  trips AS (
    SELECT tr.trip_id, tr.trip_date, tr.name, tr.status, tr.vehicle_id, tr.driver_id,
           CASE WHEN tr.end_km > tr.start_km THEN tr.end_km - tr.start_km END AS km
      FROM public."deliveryTrips" tr
     WHERE tr.status <> 'CANCELADA' AND tr.trip_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR tr.vehicle_id = $3)
  ),
  rev AS (
    SELECT trip_id, SUM(freight_total) AS revenue, COUNT(*) AS cte_count
      FROM public."tmsCte" WHERE status <> 'CANCELADO' AND trip_id IN (SELECT trip_id FROM trips) GROUP BY trip_id
  ),
  fuel AS (
    SELECT trip_id, SUM(total_amount) AS fuel FROM public."tmsFuelEntries"
     WHERE trip_id IN (SELECT trip_id FROM trips) GROUP BY trip_id
  ),
  exp AS (
    SELECT trip_id, SUM(amount) FILTER (WHERE expense_type = 'PEDAGIO') AS tolls,
           SUM(amount) FILTER (WHERE expense_type <> 'PEDAGIO') AS other_expenses
      FROM public."tmsTripExpenses" WHERE trip_id IN (SELECT trip_id FROM trips) GROUP BY trip_id
  ),
  tac AS (
    SELECT trip_id, SUM(freight_amount) AS third_party, SUM(toll_voucher_amount) AS toll_vouchers
      FROM public."tmsDriverContracts" WHERE status <> 'CANCELADO' AND trip_id IN (SELECT trip_id FROM trips) GROUP BY trip_id
  ),
  wo AS (
    SELECT trip_id, SUM(total_cost) AS maintenance FROM public."tmsWorkOrders"
     WHERE status <> 'CANCELADA' AND trip_id IN (SELECT trip_id FROM trips) GROUP BY trip_id
  ),
  result AS (
    SELECT t.*, COALESCE(rev.revenue, 0) AS revenue, COALESCE(rev.cte_count, 0) AS cte_count,
           COALESCE(fuel.fuel, 0) AS fuel, COALESCE(exp.tolls, 0) + COALESCE(tac.toll_vouchers, 0) AS tolls,
           COALESCE(exp.other_expenses, 0) AS other_expenses, COALESCE(tac.third_party, 0) AS third_party,
           COALESCE(wo.maintenance, 0) AS maintenance
      FROM trips t
      LEFT JOIN rev ON rev.trip_id = t.trip_id
      LEFT JOIN fuel ON fuel.trip_id = t.trip_id
      LEFT JOIN exp ON exp.trip_id = t.trip_id
      LEFT JOIN tac ON tac.trip_id = t.trip_id
      LEFT JOIN wo ON wo.trip_id = t.trip_id
  )`;

const COST = '(r.fuel + r.tolls + r.other_expenses + r.third_party + r.maintenance)';

const totals = (prefix = '') => `
  ROUND(SUM(${prefix}revenue), 2) AS revenue, ROUND(SUM(${prefix}fuel), 2) AS fuel, ROUND(SUM(${prefix}tolls), 2) AS tolls,
  ROUND(SUM(${prefix}other_expenses), 2) AS other_expenses, ROUND(SUM(${prefix}third_party), 2) AS third_party,
  ROUND(SUM(${prefix}maintenance), 2) AS maintenance, ROUND(SUM(${prefix}cost), 2) AS cost,
  ROUND(SUM(${prefix}revenue) - SUM(${prefix}cost), 2) AS profit,
  CASE WHEN SUM(${prefix}revenue) > 0 THEN ROUND((SUM(${prefix}revenue) - SUM(${prefix}cost)) * 100 / SUM(${prefix}revenue), 1) END AS margin_pct`;

function period(query) {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [toDate(query.date_from) || iso(first), toDate(query.date_to) || iso(today), toInt(query.vehicle_id)];
}

export async function tripProfit(query = {}) {
  const groupBy = ['trip', 'vehicle', 'customer'].includes(query.group_by) ? query.group_by : 'trip';
  const params = period(query);
  let sql;
  if (groupBy === 'trip') {
    sql = `WITH ${TRIP_RESULT_CTE}
      SELECT r.trip_id, r.trip_date::text AS trip_date, r.name, r.status, v.plate AS vehicle_plate, e.full_name AS driver_name,
             r.km, r.cte_count, ${totals()},
             CASE WHEN r.km > 0 THEN ROUND(SUM(r.cost) / r.km, 2) END AS cost_per_km,
             CASE WHEN r.km > 0 THEN ROUND(SUM(r.revenue) / r.km, 2) END AS revenue_per_km
        FROM (SELECT r.*, ${COST} AS cost FROM result r) r
        LEFT JOIN public."vehicles" v ON v.vehicle_id = r.vehicle_id
        LEFT JOIN public."drivers" d ON d.driver_id = r.driver_id
        LEFT JOIN public.employees e ON e.employee_id = d.employee_id
       GROUP BY r.trip_id, r.trip_date, r.name, r.status, v.plate, e.full_name, r.km, r.cte_count
       ORDER BY r.trip_date DESC, r.trip_id DESC`;
  } else if (groupBy === 'vehicle') {
    sql = `WITH ${TRIP_RESULT_CTE}
      SELECT r.vehicle_id, COALESCE(v.plate, '(sem veículo)') AS vehicle_plate, v.description AS vehicle_description,
             COUNT(*)::int AS trip_count, SUM(r.km)::int AS km, SUM(r.cte_count)::int AS cte_count, ${totals()},
             CASE WHEN SUM(r.km) > 0 THEN ROUND(SUM(r.cost) / SUM(r.km), 2) END AS cost_per_km,
             CASE WHEN SUM(r.km) > 0 THEN ROUND(SUM(r.revenue) / SUM(r.km), 2) END AS revenue_per_km
        FROM (SELECT r.*, ${COST} AS cost FROM result r) r
        LEFT JOIN public."vehicles" v ON v.vehicle_id = r.vehicle_id
       GROUP BY r.vehicle_id, v.plate, v.description
       ORDER BY profit DESC NULLS LAST`;
  } else {
    // custo da rota rateado pela participação de cada CT-e na receita da rota
    sql = `WITH ${TRIP_RESULT_CTE},
      share AS (
        SELECT c.payer_customer_id, COALESCE(c.payer_name, '(sem tomador)') AS payer_name, c.freight_total,
               r.trip_id, ${COST} * CASE WHEN r.revenue > 0 THEN c.freight_total / r.revenue ELSE 0 END AS cost,
               r.fuel * CASE WHEN r.revenue > 0 THEN c.freight_total / r.revenue ELSE 0 END AS fuel,
               r.tolls * CASE WHEN r.revenue > 0 THEN c.freight_total / r.revenue ELSE 0 END AS tolls,
               r.other_expenses * CASE WHEN r.revenue > 0 THEN c.freight_total / r.revenue ELSE 0 END AS other_expenses,
               r.third_party * CASE WHEN r.revenue > 0 THEN c.freight_total / r.revenue ELSE 0 END AS third_party,
               r.maintenance * CASE WHEN r.revenue > 0 THEN c.freight_total / r.revenue ELSE 0 END AS maintenance
          FROM public."tmsCte" c JOIN result r ON r.trip_id = c.trip_id
         WHERE c.status <> 'CANCELADO'
      )
      SELECT s.payer_customer_id, s.payer_name, COUNT(*)::int AS cte_count, COUNT(DISTINCT s.trip_id)::int AS trip_count,
             ${totals('s.').replace(/s\.revenue/g, 's.freight_total')}
        FROM share s
       GROUP BY s.payer_customer_id, s.payer_name
       ORDER BY profit DESC NULLS LAST`;
  }
  const { rows } = await pool.query(sql, params);
  const sum = (k) => Math.round(rows.reduce((a, r) => a + Number(r[k] || 0), 0) * 100) / 100;
  const summary = {
    revenue: sum('revenue'), cost: sum('cost'), profit: sum('profit'),
    fuel: sum('fuel'), tolls: sum('tolls'), other_expenses: sum('other_expenses'),
    third_party: sum('third_party'), maintenance: sum('maintenance'),
  };
  summary.margin_pct = summary.revenue > 0 ? Math.round(summary.profit * 1000 / summary.revenue) / 10 : null;
  return { group_by: groupBy, date_from: params[0], date_to: params[1], rows, summary };
}

/** Vencimentos e pendências da frota (documentos, manutenção, CNH, multas) */
export async function fleetAlerts() {
  const { rows } = await pool.query(`
    SELECT 'DOCUMENTO' AS kind, v.plate AS ref, d.doc_type AS item, d.expiration_date::text AS due,
           CASE WHEN d.expiration_date < CURRENT_DATE THEN 'VENCIDO' ELSE 'VENCE_30_DIAS' END AS level
      FROM public."tmsVehicleDocuments" d JOIN public."vehicles" v ON v.vehicle_id = d.vehicle_id
     WHERE d.expiration_date <= CURRENT_DATE + 30 AND v.is_active
    UNION ALL
    SELECT 'CNH', e.full_name, 'CNH ' || COALESCE(dr.cnh_category, ''), dr.cnh_expiration::text,
           CASE WHEN dr.cnh_expiration < CURRENT_DATE THEN 'VENCIDO' ELSE 'VENCE_30_DIAS' END
      FROM public."drivers" dr JOIN public.employees e ON e.employee_id = dr.employee_id
     WHERE dr.is_active AND dr.cnh_expiration <= CURRENT_DATE + 30
    UNION ALL
    SELECT 'MANUTENCAO', v.plate, mp.service_name,
           COALESCE((mp.last_date + mp.interval_days)::text, (COALESCE(mp.last_km, 0) + mp.interval_km)::text || ' km'),
           'VENCIDO'
      FROM public."tmsMaintenancePlans" mp JOIN public."vehicles" v ON v.vehicle_id = mp.vehicle_id
     WHERE mp.is_active AND (
           (mp.interval_km IS NOT NULL AND ${vehicleKmSql('mp.vehicle_id')} >= COALESCE(mp.last_km, 0) + mp.interval_km)
        OR (mp.interval_days IS NOT NULL AND mp.last_date IS NOT NULL AND CURRENT_DATE >= mp.last_date + mp.interval_days))
    UNION ALL
    SELECT 'MULTA', v.plate, COALESCE(f.ait_number, 'AIT') || ' · ' || COALESCE(f.description, ''), f.due_date::text,
           CASE WHEN f.due_date < CURRENT_DATE THEN 'VENCIDO' ELSE 'VENCE_30_DIAS' END
      FROM public."tmsTrafficFines" f JOIN public."vehicles" v ON v.vehicle_id = f.vehicle_id
     WHERE f.status IN ('RECEBIDA','CONDUTOR_INDICADO') AND f.due_date <= CURRENT_DATE + 30
    ORDER BY level, due NULLS LAST
  `);
  return rows;
}
