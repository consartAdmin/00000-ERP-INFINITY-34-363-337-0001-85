/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: deliveryTripsApi.js                                           ║
   ║ MODULE: Entregas — Rotas do dia + Paradas                           ║
   ║ DESCRIPTION: DAL de public."deliveryTrips" e "deliveryTripStops"    ║
   ║   • Rota = data + motorista + veículo + paradas ordenadas           ║
   ║   • Parada = ENTREGA ou COLETA, gerada de um Pedido (orders), de    ║
   ║     um Orçamento (budgets), de uma NF-e (invoicesIssued) ou avulsa  ║
   ║   • Um documento só fica "agendado" uma vez por movimento enquanto  ║
   ║     a parada estiver PENDENTE/CONCLUIDA numa rota não cancelada     ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../../config/db.js';
import {
  TRIP_STATUS, STOP_STATUS, MOVEMENT_TYPES, SOURCE_TYPES,
  httpError, toInt, toNum, cleanText, toEnum, toDate, mapDbError,
} from './deliveryTripsSchema.js';

const TRIPS = 'public."deliveryTrips"';
const STOPS = 'public."deliveryTripStops"';

/** Transições de status permitidas para a rota */
const TRIP_TRANSITIONS = Object.freeze({
  PLANEJADA: ['EM_ROTA', 'CANCELADA'],
  EM_ROTA: ['CONCLUIDA', 'PLANEJADA', 'CANCELADA'],
  CONCLUIDA: ['EM_ROTA'],
  CANCELADA: ['PLANEJADA'],
});

/** Rotas nesses status não aceitam mudança de paradas */
const LOCKED_TRIP_STATUS = ['CONCLUIDA', 'CANCELADA'];

/* ─────────────────────────── SQL fragments ─────────────────────────── */

/** Endereço do cliente em uma linha (customers guarda o endereço em partes) */
const CUSTOMER_ADDRESS_SQL = `
  NULLIF(CONCAT_WS(' - ',
    NULLIF(CONCAT_WS(', ',
      NULLIF(TRIM(CONCAT_WS(' ', c.street_type, c.street_name)), ''),
      NULLIF(TRIM(c.street_number), '')
    ), ''),
    NULLIF(TRIM(c.address_complement), '')
  ), '')`;

/**
 * Parada "s" pertence ao documento cujas chaves são {order, budget, invoice} (expressões SQL).
 * Uma NF-e guarda também o Pedido/Orçamento de origem, então agendar o Pedido
 * bloqueia a NF-e dele (e vice-versa).
 */
const stopMatchesDoc = ({ order = 'NULL', budget = 'NULL', invoice = 'NULL' }) => `(
  (${order}::bigint IS NOT NULL AND s.order_id = ${order})
  OR (${budget}::bigint IS NOT NULL AND s.budget_id = ${budget})
  OR (${invoice}::bigint IS NOT NULL AND s.invoice_id = ${invoice}))`;

/** Paradas "ativas" de um documento: parada PENDENTE/CONCLUIDA em rota não cancelada */
const scheduledSql = (keys) => `
  COALESCE((
    SELECT json_agg(json_build_object(
             'trip_id', t.trip_id, 'trip_date', t.trip_date::text, 'trip_status', t.status,
             'movement_type', s.movement_type, 'stop_status', s.status
           ) ORDER BY t.trip_date DESC)
      FROM ${STOPS} s
      JOIN ${TRIPS} t ON t.trip_id = s.trip_id
     WHERE ${stopMatchesDoc(keys)}
       AND t.status <> 'CANCELADA'
       AND s.status IN ('PENDENTE','CONCLUIDA')
  ), '[]'::json)`;

const TRIP_SELECT = `
  SELECT t.trip_id, t.trip_date::text AS trip_date, t.name, t.status, t.driver_id, t.vehicle_id,
         t.start_km, t.end_km, t.departed_at, t.finished_at, t.notes,
         t.created_by, t.created_at, t.updated_at,
         e.full_name AS driver_name, COALESCE(d.phone, e.mobile, e.phone) AS driver_phone,
         d.cnh_number AS driver_cnh,
         v.plate AS vehicle_plate, v.description AS vehicle_description,
         v.capacity_kg AS vehicle_capacity_kg,
         COALESCE(st.total, 0)::int       AS stops_total,
         COALESCE(st.pending, 0)::int     AS stops_pending,
         COALESCE(st.done, 0)::int        AS stops_done,
         COALESCE(st.failed, 0)::int      AS stops_failed,
         COALESCE(st.deliveries, 0)::int  AS deliveries_count,
         COALESCE(st.pickups, 0)::int     AS pickups_count,
         COALESCE(st.weight, 0)::numeric  AS total_weight,
         COALESCE(st.volumes, 0)::int     AS total_volumes
    FROM ${TRIPS} t
    LEFT JOIN public."drivers" d  ON d.driver_id = t.driver_id
    LEFT JOIN public.employees e  ON e.employee_id = d.employee_id
    LEFT JOIN public."vehicles" v ON v.vehicle_id = t.vehicle_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE s.status <> 'CANCELADA')   AS total,
             COUNT(*) FILTER (WHERE s.status = 'PENDENTE')     AS pending,
             COUNT(*) FILTER (WHERE s.status = 'CONCLUIDA')    AS done,
             COUNT(*) FILTER (WHERE s.status = 'FALHOU')       AS failed,
             COUNT(*) FILTER (WHERE s.movement_type = 'ENTREGA' AND s.status <> 'CANCELADA') AS deliveries,
             COUNT(*) FILTER (WHERE s.movement_type = 'COLETA'  AND s.status <> 'CANCELADA') AS pickups,
             SUM(s.gross_weight) FILTER (WHERE s.status <> 'CANCELADA') AS weight,
             SUM(s.volumes)      FILTER (WHERE s.status <> 'CANCELADA') AS volumes
        FROM ${STOPS} s WHERE s.trip_id = t.trip_id
    ) st ON TRUE
`;

const STOP_COLS = `
  s.stop_id, s.trip_id, s.stop_order, s.movement_type, s.source_type, s.order_id, s.budget_id,
  s.invoice_id, inv.nfe_number, inv.nfe_key, s.customer_id, s.recipient_name, s.tax_id, s.contact_phone, s.address, s.neighborhood,
  s.city, s.state, s.postal_code, s.volumes, s.gross_weight, s.document_amount, s.status,
  s.received_by, s.failure_reason, s.completed_at, s.notes, s.created_at, s.updated_at`;

/* ─────────────────────────── Helpers ─────────────────────────── */

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw mapDbError(err);
  } finally {
    client.release();
  }
}

async function lockTrip(client, tripId) {
  const { rows } = await client.query(
    `SELECT trip_id, status FROM ${TRIPS} WHERE trip_id = $1 FOR UPDATE`,
    [tripId]
  );
  if (!rows[0]) throw httpError('TRIP_NOT_FOUND', 404);
  return rows[0];
}

function assertTripEditable(trip) {
  if (LOCKED_TRIP_STATUS.includes(trip.status)) throw httpError(`TRIP_${trip.status}`, 409);
}

function pickTripHeader(data = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || 'trip_date' in data) {
    out.trip_date = toDate(data.trip_date);
    if (!out.trip_date) throw httpError('TRIP_DATE_REQUIRED', 400);
  }
  if (!partial || 'name' in data) out.name = cleanText(data.name, 120);
  if (!partial || 'driver_id' in data) out.driver_id = toInt(data.driver_id);
  if (!partial || 'vehicle_id' in data) out.vehicle_id = toInt(data.vehicle_id);
  if (!partial || 'start_km' in data) out.start_km = toInt(data.start_km);
  if (!partial || 'end_km' in data) out.end_km = toInt(data.end_km);
  if (!partial || 'notes' in data) out.notes = cleanText(data.notes);
  return out;
}

/** Campos editáveis manualmente em uma parada */
function pickStopFields(data = {}) {
  const out = {};
  if ('movement_type' in data) out.movement_type = toEnum(data.movement_type, MOVEMENT_TYPES, 'INVALID_MOVEMENT_TYPE');
  if ('recipient_name' in data) out.recipient_name = cleanText(data.recipient_name, 255);
  if ('tax_id' in data) out.tax_id = cleanText(data.tax_id, 32);
  if ('contact_phone' in data) out.contact_phone = cleanText(data.contact_phone, 50);
  if ('address' in data) out.address = cleanText(data.address, 500);
  if ('neighborhood' in data) out.neighborhood = cleanText(data.neighborhood, 120);
  if ('city' in data) out.city = cleanText(data.city, 120);
  if ('state' in data) out.state = cleanText(data.state, 2)?.toUpperCase() ?? null;
  if ('postal_code' in data) out.postal_code = cleanText(data.postal_code, 12);
  if ('volumes' in data) out.volumes = toInt(data.volumes);
  if ('gross_weight' in data) out.gross_weight = toNum(data.gross_weight);
  if ('document_amount' in data) out.document_amount = toNum(data.document_amount);
  if ('notes' in data) out.notes = cleanText(data.notes);
  if ('recipient_name' in out && !out.recipient_name) throw httpError('RECIPIENT_NAME_REQUIRED', 400);
  return out;
}

/* ─────────────────────────── Documentos de origem ─────────────────────────── */

/** Tipos de documento que podem virar parada */
const DOCUMENT_TYPES = ['PEDIDO', 'ORCAMENTO', 'NFE'];

const NOT_FOUND = { PEDIDO: 'ORDER_NOT_FOUND', ORCAMENTO: 'BUDGET_NOT_FOUND', NFE: 'INVOICE_NOT_FOUND' };

/**
 * SELECT de documentos no formato de parada.
 *   idCol      → chave usada em source_id
 *   numberExpr → número exibido/buscado (Pedido/Orçamento = id; NF-e = nº da nota)
 *   keys       → vínculos do documento para detectar agendamento duplicado
 */
function sourceQuery(sourceType) {
  if (sourceType === 'PEDIDO') {
    const keys = { order: 'o.order_id' };
    return {
      alias: 'o',
      idCol: 'order_id',
      numberExpr: 'o.order_id',
      statusExpr: 'o.status',
      dateCol: 'o.issue_date',
      keys,
      searchLike: ['o.customer_name', 'o.customer_tax_id'],
      base: `
        SELECT 'PEDIDO' AS source_type, o.order_id AS source_id, o.order_id AS doc_number,
               o.order_id, NULL::bigint AS budget_id, NULL::bigint AS invoice_id, NULL::bigint AS nfe_number,
               o.issue_date::text AS issue_date, o.status, o.customer_id,
               COALESCE(NULLIF(o.customer_name, ''), c.legal_name, c.trade_name) AS recipient_name,
               COALESCE(NULLIF(o.customer_tax_id, ''), c.tax_id) AS tax_id,
               COALESCE(NULLIF(o.customer_phone, ''), c.mobile_number, c.phone_number) AS contact_phone,
               ${CUSTOMER_ADDRESS_SQL} AS address,
               c.neighborhood, c.city, LEFT(c.state, 2) AS state, c.postal_code,
               od.volume_quantity AS volumes, od.gross_weight, o.total_amount AS document_amount,
               ${scheduledSql(keys)} AS scheduled
          FROM public.orders o
          LEFT JOIN public.customers c ON c.customer_id = o.customer_id
          LEFT JOIN public."ordersDelivery" od ON od.order_id = o.order_id
         WHERE COALESCE(o.status, '') <> 'CANCELADO'`,
    };
  }

  if (sourceType === 'NFE') {
    // invoicesIssued não tem customer_id: cliente/endereço/volumes vêm do Pedido ou Orçamento de origem
    const keys = { order: 'i.order_id', budget: 'i.budget_id', invoice: 'i.invoice_id' };
    return {
      alias: 'i',
      idCol: 'invoice_id',
      numberExpr: 'i.nfe_number',
      statusExpr: 'i.nfe_status',
      dateCol: 'COALESCE(i.issued_date, i.issued_at::date)',
      keys,
      searchLike: ['i.customer_name', 'i.customer_tax_id', 'i.nfe_key'],
      base: `
        SELECT 'NFE' AS source_type, i.invoice_id AS source_id, i.nfe_number AS doc_number,
               i.order_id, i.budget_id, i.invoice_id, i.nfe_number, i.nfe_key,
               COALESCE(i.issued_date, i.issued_at::date)::text AS issue_date, i.nfe_status AS status,
               c.customer_id,
               COALESCE(NULLIF(i.customer_name, ''), c.legal_name, c.trade_name) AS recipient_name,
               COALESCE(NULLIF(i.customer_tax_id, ''), c.tax_id) AS tax_id,
               COALESCE(NULLIF(o.customer_phone, ''), NULLIF(b.customer_phone, ''), c.mobile_number, c.phone_number) AS contact_phone,
               ${CUSTOMER_ADDRESS_SQL} AS address,
               c.neighborhood, c.city, LEFT(c.state, 2) AS state, c.postal_code,
               COALESCE(od.volume_quantity, bs.volumes) AS volumes,
               COALESCE(od.gross_weight, bs.gross_weight) AS gross_weight,
               i.total_amount AS document_amount,
               ${scheduledSql(keys)} AS scheduled
          FROM public."invoicesIssued" i
          LEFT JOIN public.orders o  ON o.order_id = i.order_id
          LEFT JOIN public.budgets b ON b.budget_id = i.budget_id
          LEFT JOIN public.customers c ON c.customer_id = COALESCE(o.customer_id, b.customer_id)
          LEFT JOIN public."ordersDelivery" od  ON od.order_id = i.order_id
          LEFT JOIN public."budgetsShipping" bs ON bs.budget_id = i.budget_id
         WHERE i.nfe_status IN ('AUTORIZADO', 'AUTORIZADA')`,
    };
  }

  const keys = { budget: 'b.budget_id' };
  return {
    alias: 'b',
    idCol: 'budget_id',
    numberExpr: 'b.budget_id',
    statusExpr: 'b.status',
    dateCol: 'b.issue_date',
    keys,
    searchLike: ['b.customer_name', 'b.customer_tax_id'],
    // Orçamentos CONVERTIDOS viraram Pedido — a entrega é feita pelo Pedido
    base: `
      SELECT 'ORCAMENTO' AS source_type, b.budget_id AS source_id, b.budget_id AS doc_number,
             NULL::bigint AS order_id, b.budget_id, NULL::bigint AS invoice_id, NULL::bigint AS nfe_number,
             b.issue_date::text AS issue_date, b.status, b.customer_id,
             COALESCE(NULLIF(b.customer_name, ''), c.legal_name, c.trade_name) AS recipient_name,
             COALESCE(NULLIF(b.customer_tax_id, ''), c.tax_id) AS tax_id,
             COALESCE(NULLIF(b.customer_phone, ''), c.mobile_number, c.phone_number) AS contact_phone,
             ${CUSTOMER_ADDRESS_SQL} AS address,
             c.neighborhood, c.city, LEFT(c.state, 2) AS state, c.postal_code,
             bs.volumes, bs.gross_weight, b.total_amount AS document_amount,
             ${scheduledSql(keys)} AS scheduled
        FROM public.budgets b
        LEFT JOIN public.customers c ON c.customer_id = b.customer_id
        LEFT JOIN public."budgetsShipping" bs ON bs.budget_id = b.budget_id
       WHERE COALESCE(b.status, '') NOT IN ('CONVERTIDO', 'CANCELADO')`,
  };
}

/**
 * Lista Pedidos / Orçamentos / Notas Fiscais disponíveis para montar rota.
 * only_unscheduled=true esconde os que já têm parada ativa do mesmo movimento.
 */
export async function listSources({
  source_type = 'PEDIDO', q = '', date_from = null, date_to = null, status = '',
  movement_type = 'ENTREGA', only_unscheduled = true, limit = 100,
} = {}) {
  const type = toEnum(source_type, DOCUMENT_TYPES, 'INVALID_SOURCE_TYPE');
  const movement = toEnum(movement_type, MOVEMENT_TYPES, 'INVALID_MOVEMENT_TYPE', 'ENTREGA');
  const { alias, idCol, numberExpr, statusExpr, dateCol, keys, base, searchLike } = sourceQuery(type);

  const params = [];
  const where = [];
  const term = cleanText(q);
  if (term) {
    params.push(`%${term}%`, term);
    const like = `$${params.length - 1}`;
    const exact = `$${params.length}`;
    const likes = [...searchLike, 'c.city', 'c.neighborhood'].map((col) => `${col} ILIKE ${like}`);
    where.push(`(${numberExpr}::text = ${exact} OR ${likes.join(' OR ')})`);
  }
  const from = toDate(date_from);
  if (from) { params.push(from); where.push(`${dateCol} >= $${params.length}`); }
  const to = toDate(date_to);
  if (to) { params.push(to); where.push(`${dateCol} <= $${params.length}`); }
  const st = cleanText(status, 40);
  if (st) { params.push(st.toUpperCase()); where.push(`${statusExpr} = $${params.length}`); }
  if (only_unscheduled === true || only_unscheduled === 'true') {
    params.push(movement);
    where.push(`NOT EXISTS (
      SELECT 1 FROM ${STOPS} s JOIN ${TRIPS} t ON t.trip_id = s.trip_id
       WHERE ${stopMatchesDoc(keys)} AND s.movement_type = $${params.length}
         AND t.status <> 'CANCELADA' AND s.status IN ('PENDENTE','CONCLUIDA'))`);
  }
  params.push(Math.min(Math.max(toInt(limit, 100), 1), 500));

  const sql = `${base} ${where.length ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY ${dateCol} DESC, ${alias}.${idCol} DESC
    LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function loadSource(client, sourceType, sourceId) {
  const { alias, idCol, base } = sourceQuery(sourceType);
  const { rows } = await client.query(`${base} AND ${alias}.${idCol} = $1`, [sourceId]);
  if (!rows[0]) throw httpError(NOT_FOUND[sourceType], 404);
  return rows[0];
}

async function loadCustomerAsStop(client, customerId) {
  const { rows } = await client.query(
    `SELECT c.customer_id, COALESCE(c.legal_name, c.trade_name) AS recipient_name, c.tax_id,
            COALESCE(c.mobile_number, c.phone_number) AS contact_phone,
            ${CUSTOMER_ADDRESS_SQL} AS address, c.neighborhood, c.city, LEFT(c.state, 2) AS state, c.postal_code
       FROM public.customers c WHERE c.customer_id = $1`,
    [customerId]
  );
  if (!rows[0]) throw httpError('CUSTOMER_NOT_FOUND', 404);
  return rows[0];
}

/**
 * Monta a parada a partir do payload:
 *   { source_type:'PEDIDO', source_id | order_id, movement_type }
 *   { source_type:'ORCAMENTO', source_id | budget_id, movement_type }
 *   { source_type:'NFE', source_id | invoice_id, movement_type }  → guarda também o Pedido/Orçamento da nota
 *   { source_type:'AVULSO', customer_id?, recipient_name, address, ... }
 * Campos enviados explicitamente sobrescrevem os do documento.
 */
const SOURCE_ID_FIELD = { PEDIDO: 'order_id', ORCAMENTO: 'budget_id', NFE: 'invoice_id' };

async function buildStop(client, input = {}) {
  const source_type = toEnum(input.source_type, SOURCE_TYPES, 'INVALID_SOURCE_TYPE', 'AVULSO');
  const movement_type = toEnum(input.movement_type, MOVEMENT_TYPES, 'INVALID_MOVEMENT_TYPE', 'ENTREGA');
  const overrides = pickStopFields(input);

  let base = {};
  if (DOCUMENT_TYPES.includes(source_type)) {
    const id = toInt(input.source_id ?? input[SOURCE_ID_FIELD[source_type]]);
    if (!id) throw httpError('SOURCE_ID_REQUIRED', 400);
    const doc = await loadSource(client, source_type, id);
    base = {
      order_id: doc.order_id, budget_id: doc.budget_id, invoice_id: doc.invoice_id,
      nfe_number: doc.nfe_number, customer_id: doc.customer_id,
      recipient_name: doc.recipient_name, tax_id: doc.tax_id, contact_phone: doc.contact_phone,
      address: doc.address, neighborhood: doc.neighborhood, city: doc.city, state: doc.state,
      postal_code: doc.postal_code, volumes: doc.volumes, gross_weight: doc.gross_weight,
      document_amount: doc.document_amount,
    };
  } else if (toInt(input.customer_id)) {
    base = await loadCustomerAsStop(client, toInt(input.customer_id));
  }

  const stop = {
    order_id: null, budget_id: null, invoice_id: null, customer_id: null,
    ...base,
    ...overrides,
    source_type,
    movement_type,
  };
  stop.recipient_name = cleanText(stop.recipient_name, 255);
  if (!stop.recipient_name) throw httpError('RECIPIENT_NAME_REQUIRED', 400);
  return stop;
}

/** Garante que o documento não está em outra parada ativa do mesmo movimento */
async function assertNotScheduled(client, stop, ignoreStopId = null) {
  if (!stop.order_id && !stop.budget_id && !stop.invoice_id) return;
  const { rows } = await client.query(
    `SELECT s.stop_id, s.trip_id, t.trip_date::text AS trip_date,
            s.source_type, s.order_id, s.budget_id, inv.nfe_number
       FROM ${STOPS} s
       JOIN ${TRIPS} t ON t.trip_id = s.trip_id
       LEFT JOIN public."invoicesIssued" inv ON inv.invoice_id = s.invoice_id
      WHERE ${stopMatchesDoc({ order: '$1', budget: '$2', invoice: '$3' })}
        AND s.movement_type = $4
        AND t.status <> 'CANCELADA' AND s.status IN ('PENDENTE','CONCLUIDA')
        AND ($5::bigint IS NULL OR s.stop_id <> $5)
      LIMIT 1`,
    [stop.order_id ?? null, stop.budget_id ?? null, stop.invoice_id ?? null, stop.movement_type, ignoreStopId]
  );
  if (rows[0]) {
    // Descreve a parada que já existe (pode ser o Pedido de uma NF-e, ou vice-versa)
    const hit = rows[0];
    const label = hit.source_type === 'NFE' ? `NF-e ${hit.nfe_number}`
      : hit.order_id ? `Pedido ${hit.order_id}` : `Orçamento ${hit.budget_id}`;
    const err = httpError(`ALREADY_SCHEDULED`, 409);
    err.details = { document: label, trip_id: hit.trip_id, trip_date: hit.trip_date };
    throw err;
  }
}

async function insertStops(client, tripId, inputs = [], { force = false } = {}) {
  const { rows: [{ next }] } = await client.query(
    `SELECT COALESCE(MAX(stop_order), 0) + 1 AS next FROM ${STOPS} WHERE trip_id = $1`,
    [tripId]
  );
  let order = Number(next);
  const inserted = [];
  const seen = new Set();

  for (const input of inputs) {
    const stop = await buildStop(client, input);
    const key = (stop.order_id || stop.budget_id || stop.invoice_id)
      ? `${stop.order_id}|${stop.budget_id}|${stop.invoice_id}|${stop.movement_type}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    if (!force) await assertNotScheduled(client, stop);

    const cols = [
      'trip_id', 'stop_order', 'movement_type', 'source_type', 'order_id', 'budget_id', 'invoice_id', 'customer_id',
      'recipient_name', 'tax_id', 'contact_phone', 'address', 'neighborhood', 'city', 'state',
      'postal_code', 'volumes', 'gross_weight', 'document_amount', 'notes',
    ];
    const values = { ...stop, trip_id: tripId, stop_order: order++ };
    const { rows } = await client.query(
      `INSERT INTO ${STOPS} (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING stop_id`,
      cols.map((c) => values[c] ?? null)
    );
    inserted.push(rows[0].stop_id);
  }
  return inserted;
}

/* ─────────────────────────── Rotas ─────────────────────────── */

export async function listTrips({
  q = '', status = '', date_from = null, date_to = null, driver_id = null, page = 1, limit = 30,
} = {}) {
  const where = [];
  const params = [];
  const term = cleanText(q);
  if (term) {
    params.push(`%${term}%`);
    where.push(`(t.name ILIKE $${params.length} OR e.full_name ILIKE $${params.length}
                 OR v.plate ILIKE $${params.length} OR t.trip_id::text = $${params.length + 1})`);
    params.push(term);
  }
  const st = cleanText(status);
  if (st) { params.push(toEnum(st, TRIP_STATUS, 'INVALID_STATUS')); where.push(`t.status = $${params.length}`); }
  const from = toDate(date_from);
  if (from) { params.push(from); where.push(`t.trip_date >= $${params.length}`); }
  const to = toDate(date_to);
  if (to) { params.push(to); where.push(`t.trip_date <= $${params.length}`); }
  const drv = toInt(driver_id);
  if (drv) { params.push(drv); where.push(`t.driver_id = $${params.length}`); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(toInt(limit, 30), 1), 200);
  const safePage = Math.max(toInt(page, 1), 1);

  const countSql = `
    SELECT COUNT(*)::int AS total FROM ${TRIPS} t
      LEFT JOIN public."drivers" d  ON d.driver_id = t.driver_id
      LEFT JOIN public.employees e  ON e.employee_id = d.employee_id
      LEFT JOIN public."vehicles" v ON v.vehicle_id = t.vehicle_id
    ${whereSql}`;
  const [{ rows: [{ total }] }, { rows }] = await Promise.all([
    pool.query(countSql, params),
    pool.query(
      `${TRIP_SELECT} ${whereSql} ORDER BY t.trip_date DESC, t.trip_id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, safeLimit, (safePage - 1) * safeLimit]
    ),
  ]);
  return { total, page: safePage, limit: safeLimit, rows };
}

export async function getTrip(tripId, db = pool) {
  const id = toInt(tripId);
  const { rows } = await db.query(`${TRIP_SELECT} WHERE t.trip_id = $1`, [id]);
  if (!rows[0]) throw httpError('TRIP_NOT_FOUND', 404);
  const { rows: stops } = await db.query(
    `SELECT ${STOP_COLS} FROM ${STOPS} s
       LEFT JOIN public."invoicesIssued" inv ON inv.invoice_id = s.invoice_id
      WHERE s.trip_id = $1 ORDER BY s.stop_order, s.stop_id`,
    [id]
  );
  return { ...rows[0], stops };
}

export async function createTrip(data = {}, userId = null) {
  const header = pickTripHeader(data);
  const stops = Array.isArray(data.stops) ? data.stops : [];
  const force = data.force === true;

  const tripId = await withTransaction(async (client) => {
    const cols = Object.keys(header);
    const { rows } = await client.query(
      `INSERT INTO ${TRIPS} (${cols.join(', ')}, created_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1})
       RETURNING trip_id`,
      [...cols.map((c) => header[c]), toInt(userId)]
    );
    if (stops.length) await insertStops(client, rows[0].trip_id, stops, { force });
    return rows[0].trip_id;
  });
  return getTrip(tripId);
}

export async function updateTrip(tripId, data = {}) {
  const id = toInt(tripId);
  const header = pickTripHeader(data, { partial: true });
  const cols = Object.keys(header);
  await withTransaction(async (client) => {
    const trip = await lockTrip(client, id);
    if (trip.status === 'CANCELADA') throw httpError('TRIP_CANCELADA', 409);
    if (!cols.length) return;
    await client.query(
      `UPDATE ${TRIPS} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE trip_id = $1`,
      [id, ...cols.map((c) => header[c])]
    );
  });
  return getTrip(id);
}

export async function setTripStatus(tripId, data = {}) {
  const id = toInt(tripId);
  const next = toEnum(data.status, TRIP_STATUS, 'INVALID_STATUS');

  await withTransaction(async (client) => {
    const trip = await lockTrip(client, id);
    if (trip.status === next) return;
    if (!TRIP_TRANSITIONS[trip.status].includes(next)) {
      throw httpError(`INVALID_TRANSITION_${trip.status}_TO_${next}`, 409);
    }

    const { rows: [info] } = await client.query(
      `SELECT t.driver_id, t.vehicle_id,
              COUNT(s.*) FILTER (WHERE s.status <> 'CANCELADA')::int AS active_stops,
              COUNT(s.*) FILTER (WHERE s.status = 'PENDENTE')::int   AS pending_stops
         FROM ${TRIPS} t LEFT JOIN ${STOPS} s ON s.trip_id = t.trip_id
        WHERE t.trip_id = $1 GROUP BY t.trip_id`,
      [id]
    );

    const sets = ['status = $2'];
    const params = [id, next];
    const push = (sql, v) => { params.push(v); sets.push(sql.replace('?', `$${params.length}`)); };

    if (next === 'EM_ROTA' && trip.status === 'PLANEJADA') {
      if (!info.driver_id) throw httpError('DRIVER_REQUIRED', 400);
      if (!info.vehicle_id) throw httpError('VEHICLE_REQUIRED', 400);
      if (!info.active_stops) throw httpError('TRIP_WITHOUT_STOPS', 400);
      sets.push('departed_at = now()');
      if ('start_km' in data) push('start_km = ?', toInt(data.start_km));
    }
    if (next === 'CONCLUIDA') {
      if (info.pending_stops) {
        const err = httpError('PENDING_STOPS', 409);
        err.details = { pending: info.pending_stops };
        throw err;
      }
      sets.push('finished_at = now()');
      if ('end_km' in data) push('end_km = ?', toInt(data.end_km));
    }
    if (next === 'PLANEJADA') sets.push('departed_at = NULL', 'finished_at = NULL');
    if (next === 'EM_ROTA' && trip.status === 'CONCLUIDA') sets.push('finished_at = NULL');

    await client.query(`UPDATE ${TRIPS} SET ${sets.join(', ')} WHERE trip_id = $1`, params);
  });
  return getTrip(id);
}

export async function deleteTrip(tripId) {
  const id = toInt(tripId);
  await withTransaction(async (client) => {
    const trip = await lockTrip(client, id);
    if (!['PLANEJADA', 'CANCELADA'].includes(trip.status)) throw httpError(`TRIP_${trip.status}`, 409);
    await client.query(`DELETE FROM ${TRIPS} WHERE trip_id = $1`, [id]);
  });
  return { trip_id: id };
}

/* ─────────────────────────── Paradas ─────────────────────────── */

export async function addStops(tripId, data = {}) {
  const id = toInt(tripId);
  const inputs = Array.isArray(data.stops) ? data.stops : [data];
  await withTransaction(async (client) => {
    assertTripEditable(await lockTrip(client, id));
    await insertStops(client, id, inputs, { force: data.force === true });
  });
  return getTrip(id);
}

async function lockStop(client, stopId) {
  const { rows } = await client.query(
    `SELECT s.stop_id, s.trip_id, s.status, s.movement_type, s.order_id, s.budget_id, s.invoice_id,
            t.status AS trip_status
       FROM ${STOPS} s JOIN ${TRIPS} t ON t.trip_id = s.trip_id
      WHERE s.stop_id = $1 FOR UPDATE OF s, t`,
    [stopId]
  );
  if (!rows[0]) throw httpError('STOP_NOT_FOUND', 404);
  return rows[0];
}

export async function updateStop(stopId, data = {}) {
  const id = toInt(stopId);
  const fields = pickStopFields(data);
  const cols = Object.keys(fields);
  const tripId = await withTransaction(async (client) => {
    const stop = await lockStop(client, id);
    assertTripEditable({ status: stop.trip_status });
    if (fields.movement_type && fields.movement_type !== stop.movement_type) {
      await assertNotScheduled(client, { ...stop, movement_type: fields.movement_type }, id);
    }
    if (cols.length) {
      await client.query(
        `UPDATE ${STOPS} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE stop_id = $1`,
        [id, ...cols.map((c) => fields[c])]
      );
    }
    return stop.trip_id;
  });
  return getTrip(tripId);
}

export async function setStopStatus(stopId, data = {}) {
  const id = toInt(stopId);
  const next = toEnum(data.status, STOP_STATUS, 'INVALID_STATUS');
  const tripId = await withTransaction(async (client) => {
    const stop = await lockStop(client, id);
    assertTripEditable({ status: stop.trip_status });

    // Reativar uma parada não pode duplicar agendamento do documento
    if (['PENDENTE', 'CONCLUIDA'].includes(next) && !['PENDENTE', 'CONCLUIDA'].includes(stop.status)) {
      await assertNotScheduled(client, stop, id);
    }

    let received_by = null;
    let failure_reason = null;
    if (next === 'CONCLUIDA') received_by = cleanText(data.received_by, 150);
    if (next === 'FALHOU') {
      failure_reason = cleanText(data.failure_reason);
      if (!failure_reason) throw httpError('FAILURE_REASON_REQUIRED', 400);
    }
    await client.query(
      `UPDATE ${STOPS}
          SET status = $2::varchar, received_by = $3, failure_reason = $4,
              completed_at = CASE WHEN $2::varchar IN ('CONCLUIDA','FALHOU') THEN now() ELSE NULL END
        WHERE stop_id = $1`,
      [id, next, received_by, failure_reason]
    );
    return stop.trip_id;
  });
  return getTrip(tripId);
}

export async function deleteStop(stopId) {
  const id = toInt(stopId);
  const tripId = await withTransaction(async (client) => {
    const stop = await lockStop(client, id);
    assertTripEditable({ status: stop.trip_status });
    await client.query(`DELETE FROM ${STOPS} WHERE stop_id = $1`, [id]);
    return stop.trip_id;
  });
  return getTrip(tripId);
}

/** Reordena as paradas: stop_ids na ordem desejada */
export async function reorderStops(tripId, stopIds = []) {
  const id = toInt(tripId);
  const ids = (Array.isArray(stopIds) ? stopIds : []).map((v) => toInt(v)).filter(Boolean);
  if (!ids.length) throw httpError('STOP_IDS_REQUIRED', 400);
  await withTransaction(async (client) => {
    assertTripEditable(await lockTrip(client, id));
    const { rowCount } = await client.query(
      `UPDATE ${STOPS} s SET stop_order = x.ord
         FROM UNNEST($2::bigint[]) WITH ORDINALITY AS x(stop_id, ord)
        WHERE s.stop_id = x.stop_id AND s.trip_id = $1`,
      [id, ids]
    );
    if (rowCount !== ids.length) throw httpError('STOP_NOT_IN_TRIP', 400);
  });
  return getTrip(id);
}
