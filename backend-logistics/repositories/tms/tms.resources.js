// ╔════════════════════════════════════════════════════════════════════╗
// ║ tms.resources.js — definição dos cadastros do TMS                  ║
// ║ Cada chave vira /api/tms/<chave> no CRUD genérico                 ║
// ║ (tmsCrud.repository.js).                                           ║
// ║                                                                    ║
// ║ table / pk    tabela e chave                                       ║
// ║ fields        campos graváveis { type, max, values, required }     ║
// ║ source        FROM alternativo (subquery com colunas calculadas)   ║
// ║ select/joins  colunas extras das telas (placa, motorista...)       ║
// ║ search        colunas do 🔎 Pesquisar                              ║
// ║ filters       ?param=valor → igualdade                             ║
// ║ dateField     ?date_from / ?date_to                                ║
// ║ children      linhas filhas gravadas junto (substitui todas)       ║
// ║ beforeSave / afterSave / canEdit / canDelete  regras do módulo     ║
// ╚════════════════════════════════════════════════════════════════════╝

import { httpError, round2, onlyDigits } from './tms.helpers.js';
import { calcFreight } from './tmsFreight.calc.js';

// ─────────────────────────── Domínios ───────────────────────────
export const UF = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const CTE_STATUS = ['DIGITADO', 'EMITIDO', 'AUTORIZADO', 'CANCELADO'];
const MDFE_STATUS = ['DIGITADO', 'EMITIDO', 'AUTORIZADO', 'ENCERRADO', 'CANCELADO'];
export const EVENT_TYPES = ['COLETADO', 'EM_TRANSITO', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'RECUSADO',
  'ENDERECO_NAO_ENCONTRADO', 'DESTINATARIO_AUSENTE', 'AVARIA', 'EXTRAVIO', 'DEVOLVIDO', 'OUTROS'];

/** Código OCOREN (PROCEDA) sugerido por tipo de ocorrência */
export const OCOREN_CODES = Object.freeze({
  ENTREGUE: '01', DEVOLVIDO: '05', RECUSADO: '03', ENDERECO_NAO_ENCONTRADO: '06', DESTINATARIO_AUSENTE: '09',
  AVARIA: '25', EXTRAVIO: '11', EM_TRANSITO: '80', SAIU_PARA_ENTREGA: '81', COLETADO: '82', OUTROS: '99',
});

/** Situação da entrega do CT-e conforme a última ocorrência */
const EVENT_TO_DELIVERY = Object.freeze({
  COLETADO: 'EM_TRANSITO', EM_TRANSITO: 'EM_TRANSITO', SAIU_PARA_ENTREGA: 'EM_TRANSITO', ENTREGUE: 'ENTREGUE',
  DEVOLVIDO: 'DEVOLVIDO', RECUSADO: 'OCORRENCIA', ENDERECO_NAO_ENCONTRADO: 'OCORRENCIA',
  DESTINATARIO_AUSENTE: 'OCORRENCIA', AVARIA: 'OCORRENCIA', EXTRAVIO: 'OCORRENCIA', OUTROS: 'OCORRENCIA',
});

// ─────────────────────────── Campos comuns ───────────────────────────
const T = (max) => ({ type: 'text', max });
const U = (max) => ({ type: 'upper', max });
const N = { type: 'num' };
const I = { type: 'int' };
const D = { type: 'date' };
const TS = { type: 'ts' };
const B = (d = false) => ({ type: 'bool', default: d });
const E = (values, d) => ({ type: 'enum', values, default: d });
const REQ = (def) => ({ ...def, required: true });
const NOTES = { type: 'text' };

const VEHICLE_JOIN = 'LEFT JOIN public."vehicles" v ON v.vehicle_id = t.vehicle_id';
const DRIVER_JOIN = `LEFT JOIN public."drivers" d ON d.driver_id = t.driver_id
  LEFT JOIN public.employees e ON e.employee_id = d.employee_id`;
const TRIP_JOIN = 'LEFT JOIN public."deliveryTrips" tr ON tr.trip_id = t.trip_id';
const VEHICLE_COLS = 'v.plate AS vehicle_plate, v.description AS vehicle_description';
const DRIVER_COLS = 'e.full_name AS driver_name';
const TRIP_COLS = 'tr.name AS trip_name, tr.trip_date::text AS trip_date';

/** Odômetro atual do veículo: maior km lançado em abastecimento, OS ou rota */
export const vehicleKmSql = (col) => `GREATEST(
  (SELECT MAX(f.odometer_km) FROM public."tmsFuelEntries" f WHERE f.vehicle_id = ${col}),
  (SELECT MAX(w.odometer_km) FROM public."tmsWorkOrders" w WHERE w.vehicle_id = ${col}),
  (SELECT MAX(dt.end_km) FROM public."deliveryTrips" dt WHERE dt.vehicle_id = ${col}))`;

const sumBy = (items, key) => round2((items || []).reduce((acc, it) => acc + (Number(it[key]) || 0), 0));

function lockedUnless(statuses, code) {
  return (current) => {
    if (!statuses.includes(current.status)) throw httpError(code, 409);
  };
}

// ─────────────────────────── Retenções do TAC ───────────────────────────
// Base INSS/SEST-SENAT = 20% do frete; base IRRF = 10% do frete (Lei 12.794/2013).
// Valores de referência — conferir a tabela vigente com a contabilidade.
export const TAC_RULES = Object.freeze({
  INSS_BASE_PCT: 20, INSS_RATE: 11, INSS_CEILING: 8157.41,
  SEST_SENAT_RATE: 2.5,
  IRRF_BASE_PCT: 10, IRRF_DEPENDENT: 189.59,
  IRRF_TABLE: [ // [até, alíquota %, dedução]
    [2428.80, 0, 0], [2826.65, 7.5, 182.16], [3751.05, 15, 394.16], [4664.68, 22.5, 675.49], [Infinity, 27.5, 908.73],
  ],
});

export function calcTacRetentions(freight, dependents = 0) {
  const r = TAC_RULES;
  const inssBase = Math.min(freight * r.INSS_BASE_PCT / 100, r.INSS_CEILING);
  const inss = inssBase * r.INSS_RATE / 100;
  const sest = (freight * r.INSS_BASE_PCT / 100) * r.SEST_SENAT_RATE / 100;
  const irBase = Math.max(0, freight * r.IRRF_BASE_PCT / 100 - inss - dependents * r.IRRF_DEPENDENT);
  const [, rate, ded] = r.IRRF_TABLE.find(([lim]) => irBase <= lim);
  const irrf = Math.max(0, irBase * rate / 100 - ded);
  return { inss_amount: round2(inss), sest_senat_amount: round2(sest), irrf_amount: round2(irrf) };
}

// ═══════════════════════════ RECURSOS ═══════════════════════════
export const RESOURCES = {

  // ───────── Apólices de seguro (averbação) ─────────
  policies: {
    table: 'tmsInsurancePolicies', pk: 'policy_id',
    fields: {
      insurer_name: REQ(T(150)), insurer_cnpj: T(18), policy_number: REQ(T(40)),
      coverage: E(['RCTR-C', 'RC-DC', 'RCF-DC', 'OUTROS'], 'RCTR-C'), responsible: E(['EMITENTE', 'TOMADOR'], 'EMITENTE'),
      endorser: T(60), valid_from: D, valid_until: D, is_active: B(true), notes: NOTES,
    },
    search: ['t.insurer_name', 't.policy_number', 't.endorser'],
    filters: { is_active: 't.is_active' },
    order: 't.insurer_name',
  },

  // ───────── CT-e ─────────
  cte: {
    table: 'tmsCte', pk: 'cte_id', createdBy: true,
    fields: {
      series: I, cte_type: E(['NORMAL', 'COMPLEMENTAR', 'ANULACAO', 'SUBSTITUTO'], 'NORMAL'),
      service_type: E(['NORMAL', 'SUBCONTRATACAO', 'REDESPACHO', 'REDESPACHO_INTERMEDIARIO', 'MULTIMODAL'], 'NORMAL'),
      cfop: T(4), nature: T(80), issue_date: D,
      payer_role: E(['REMETENTE', 'EXPEDIDOR', 'RECEBEDOR', 'DESTINATARIO', 'OUTROS'], 'REMETENTE'),
      sender_customer_id: I, sender_name: REQ(T(200)), sender_tax_id: T(20), sender_city: T(120), sender_state: U(2),
      recipient_customer_id: I, recipient_name: REQ(T(200)), recipient_tax_id: T(20), recipient_address: T(300),
      recipient_city: T(120), recipient_state: U(2),
      payer_customer_id: I, payer_name: T(200), payer_tax_id: T(20),
      origin_city: T(120), origin_state: U(2), destination_city: T(120), destination_state: U(2),
      cargo_description: T(120), cargo_value: N, weight_kg: N, volumes: I, cubage_m3: N,
      freight_table_id: I, quote_id: I, trip_id: I, vehicle_id: I, driver_id: I,
      icms_cst: T(3), icms_base: N, icms_rate: N, policy_id: I, notes: NOTES,
    },
    select: `${VEHICLE_COLS}, ${DRIVER_COLS}, ${TRIP_COLS},
      p.insurer_name AS policy_insurer, p.policy_number AS policy_number,
      (SELECT COUNT(*)::int FROM public."tmsCteDocuments" x WHERE x.cte_id = t.cte_id) AS doc_count,
      (SELECT string_agg(x.number, ', ') FROM public."tmsCteDocuments" x WHERE x.cte_id = t.cte_id) AS doc_numbers`,
    joins: `${VEHICLE_JOIN} ${DRIVER_JOIN} ${TRIP_JOIN}
      LEFT JOIN public."tmsInsurancePolicies" p ON p.policy_id = t.policy_id`,
    search: ['t.number', 't.access_key', 't.sender_name', 't.recipient_name', 't.payer_name', 't.destination_city', 'v.plate'],
    filters: {
      status: 't.status', delivery_status: 't.delivery_status', insurance_status: 't.insurance_status',
      trip_id: 't.trip_id', payer_customer_id: 't.payer_customer_id',
    },
    dateField: 't.issue_date',
    order: 't.issue_date DESC, t.cte_id DESC',
    children: {
      documents: {
        table: 'tmsCteDocuments', pk: 'doc_id', fk: 'cte_id',
        fields: {
          doc_type: E(['NFE', 'NF', 'OUTROS'], 'NFE'), access_key: T(44), number: T(20), series: T(5),
          issue_date: D, amount: N, weight_kg: N, volumes: I,
        },
      },
      components: {
        table: 'tmsCteComponents', pk: 'component_id', fk: 'cte_id',
        fields: { name: REQ(U(40)), amount: N },
      },
    },
    canEdit: lockedUnless(['DIGITADO'], 'CTE_LOCKED'),
    canDelete: lockedUnless(['DIGITADO'], 'CTE_LOCKED'),
    async beforeSave(p, children, { client, id }) {
      if (p.payer_role && !p.payer_name) {
        const role = { REMETENTE: 'sender', DESTINATARIO: 'recipient' }[p.payer_role];
        if (role) {
          p.payer_name = p[`${role}_name`] ?? p.payer_name;
          p.payer_tax_id = p[`${role}_tax_id`] ?? p.payer_tax_id;
          p.payer_customer_id = p[`${role}_customer_id`] ?? p.payer_customer_id;
        }
      }
      if (!p.origin_city && p.sender_city) p.origin_city = p.sender_city;
      if (!p.origin_state && p.sender_state) p.origin_state = p.sender_state;
      if (!p.destination_city && p.recipient_city) p.destination_city = p.recipient_city;
      if (!p.destination_state && p.recipient_state) p.destination_state = p.recipient_state;
      if (p.sender_tax_id) p.sender_tax_id = onlyDigits(p.sender_tax_id);
      if (p.recipient_tax_id) p.recipient_tax_id = onlyDigits(p.recipient_tax_id);
      if (p.payer_tax_id) p.payer_tax_id = onlyDigits(p.payer_tax_id);

      const docs = children.documents;
      if (docs?.length) {
        if (p.cargo_value == null) p.cargo_value = sumBy(docs, 'amount');
        if (p.weight_kg == null) p.weight_kg = sumBy(docs, 'weight_kg');
        if (p.volumes == null) p.volumes = Math.round(sumBy(docs, 'volumes'));
      }
      let total = null;
      if (children.components) total = sumBy(children.components, 'amount');
      else if (id) {
        const { rows: [r] } = await client.query('SELECT freight_total FROM public."tmsCte" WHERE cte_id = $1', [id]);
        total = Number(r?.freight_total || 0);
      }
      if (total !== null) {
        p.freight_total = total;
        const base = p.icms_base ?? total;
        if (p.icms_rate != null) {
          p.icms_base = base;
          p.icms_amount = round2(base * Number(p.icms_rate) / 100);
        }
      }
    },
  },

  // ───────── Ocorrências de entrega ─────────
  events: {
    table: 'tmsCteEvents', pk: 'event_id', createdBy: true,
    fields: {
      cte_id: REQ(I), event_type: E(EVENT_TYPES, 'EM_TRANSITO'), event_code: T(3), event_at: TS,
      location: T(150), received_by: T(150), received_doc: T(30), notes: NOTES,
    },
    select: `c.series AS cte_series, c.number AS cte_number, c.recipient_name, c.destination_city,
      c.destination_state, c.payer_name, c.delivery_status`,
    joins: 'JOIN public."tmsCte" c ON c.cte_id = t.cte_id',
    search: ['c.number', 'c.recipient_name', 'c.payer_name', 't.location', 't.received_by'],
    filters: { cte_id: 't.cte_id', event_type: 't.event_type' },
    dateField: 't.event_at::date',
    order: 't.event_at DESC, t.event_id DESC',
    async beforeSave(p, _children, { client, current }) {
      const cteId = p.cte_id ?? current?.cte_id;
      const { rows: [c] } = await client.query('SELECT status FROM public."tmsCte" WHERE cte_id = $1', [cteId]);
      if (!c) throw httpError('CTE_NOT_FOUND', 404);
      if (c.status === 'DIGITADO' || c.status === 'CANCELADO') throw httpError('CTE_NOT_ISSUED', 409);
      const type = p.event_type ?? current?.event_type;
      if (!p.event_code && !current?.event_code) p.event_code = OCOREN_CODES[type] || '99';
    },
    async afterSave(_id, { client, current, id }) {
      const { rows: [ev] } = await client.query('SELECT cte_id FROM public."tmsCteEvents" WHERE event_id = $1', [id]);
      await syncDeliveryStatus(client, ev?.cte_id ?? current?.cte_id);
    },
    async afterDelete(current, { client }) {
      await syncDeliveryStatus(client, current.cte_id);
    },
  },

  // ───────── MDF-e ─────────
  mdfe: {
    table: 'tmsMdfe', pk: 'mdfe_id', createdBy: true,
    fields: {
      series: I, issue_date: D, origin_state: REQ(U(2)), destination_state: REQ(U(2)), route_states: U(100),
      loading_city: T(120), unloading_city: T(120), vehicle_id: I, trailer_plates: U(60), driver_id: I, trip_id: I,
      ciot_number: T(20), toll_voucher_number: T(30), notes: NOTES,
    },
    select: `${VEHICLE_COLS}, ${DRIVER_COLS}, ${TRIP_COLS}`,
    joins: `${VEHICLE_JOIN} ${DRIVER_JOIN} ${TRIP_JOIN}`,
    search: ['t.number', 't.access_key', 'v.plate', 'e.full_name', 't.unloading_city'],
    filters: { status: 't.status', vehicle_id: 't.vehicle_id', trip_id: 't.trip_id' },
    dateField: 't.issue_date',
    order: 't.issue_date DESC, t.mdfe_id DESC',
    children: {
      documents: {
        table: 'tmsMdfeDocuments', pk: 'item_id', fk: 'mdfe_id',
        fields: { cte_id: REQ(I) },
        select: `cx.series, cx.number, cx.recipient_name, cx.destination_city, cx.destination_state,
          cx.cargo_value, cx.weight_kg, cx.freight_total, cx.status AS cte_status`,
        joins: 'JOIN public."tmsCte" cx ON cx.cte_id = c.cte_id',
      },
    },
    canEdit: lockedUnless(['DIGITADO'], 'MDFE_LOCKED'),
    canDelete: lockedUnless(['DIGITADO'], 'MDFE_LOCKED'),
    async beforeSave(p, children, { client }) {
      const docs = children.documents;
      if (!docs) return;
      const ids = docs.map((d) => d.cte_id);
      const { rows } = await client.query(
        `SELECT cte_id, status, cargo_value, weight_kg FROM public."tmsCte" WHERE cte_id = ANY($1::bigint[])`,
        [ids]
      );
      if (rows.length !== new Set(ids).size) throw httpError('CTE_NOT_FOUND', 404);
      if (rows.some((r) => !['EMITIDO', 'AUTORIZADO'].includes(r.status))) throw httpError('CTE_NOT_ISSUED', 409);
      p.cte_count = rows.length;
      p.total_cargo_value = sumBy(rows, 'cargo_value');
      p.total_weight_kg = sumBy(rows, 'weight_kg');
    },
  },

  // ───────── Tabelas de frete ─────────
  freightTables: {
    table: 'tmsFreightTables', pk: 'table_id',
    fields: {
      name: REQ(T(120)), customer_id: I, customer_name: T(200), calc_mode: E(['PESO', 'KM', 'FIXO'], 'PESO'),
      valid_from: D, valid_until: D, cubage_factor: N, ad_valorem_pct: N, gris_pct: N, gris_min: N,
      toll_per_100kg: N, pickup_fee: N, delivery_fee: N, min_freight: N, icms_rate: N, icms_included: B(false),
      is_active: B(true), notes: NOTES,
    },
    select: '(SELECT COUNT(*)::int FROM public."tmsFreightTableRanges" r WHERE r.table_id = t.table_id) AS range_count',
    search: ['t.name', 't.customer_name'],
    filters: { is_active: 't.is_active', calc_mode: 't.calc_mode' },
    order: 't.name',
    children: {
      ranges: {
        table: 'tmsFreightTableRanges', pk: 'range_id', fk: 'table_id',
        order: 'c.origin_state NULLS FIRST, c.destination_state NULLS FIRST, c.destination_city NULLS FIRST, c.weight_from',
        fields: {
          origin_state: U(2), origin_city: T(120), destination_state: U(2), destination_city: T(120),
          weight_from: N, weight_to: N, price_per_kg: N, fixed_price: N, price_per_km: N, lead_time_days: I,
        },
      },
    },
  },

  // ───────── Cotações ─────────
  quotes: {
    table: 'tmsFreightQuotes', pk: 'quote_id', createdBy: true,
    fields: {
      quote_date: D, valid_until: D, status: E(['ABERTA', 'APROVADA', 'RECUSADA', 'VENCIDA', 'CONVERTIDA'], 'ABERTA'),
      customer_id: I, customer_name: REQ(T(200)), contact_name: T(120), contact_phone: T(40), contact_email: T(150),
      origin_city: T(120), origin_state: U(2), destination_city: T(120), destination_state: U(2),
      cargo_description: T(120), weight_kg: N, volumes: I, cubage_m3: N, cargo_value: N, distance_km: N,
      table_id: I, discount: N, notes: NOTES,
    },
    select: 'ft.name AS table_name',
    joins: 'LEFT JOIN public."tmsFreightTables" ft ON ft.table_id = t.table_id',
    search: ['t.quote_id', 't.customer_name', 't.destination_city', 't.origin_city'],
    filters: { status: 't.status' },
    dateField: 't.quote_date',
    order: 't.quote_date DESC, t.quote_id DESC',
    async beforeSave(p, _children, { client, current }) {
      const merged = { ...(current || {}), ...p };
      if (!merged.table_id) return;
      const calc = await calcFreight((t, prm) => client.query(t, prm), merged);
      const discount = Number(merged.discount || 0);
      Object.assign(p, {
        taxable_weight: calc.taxable_weight, freight_weight: calc.freight_weight, ad_valorem: calc.ad_valorem,
        gris: calc.gris, toll: calc.toll, fees: calc.fees, icms_amount: calc.icms_amount,
        total: round2(Math.max(0, calc.total - discount)), lead_time_days: calc.lead_time_days,
      });
    },
  },

  // ───────── Ordens de coleta ─────────
  pickups: {
    table: 'tmsPickupOrders', pk: 'pickup_id', createdBy: true,
    fields: {
      request_date: D, scheduled_date: D, time_window: T(30),
      status: E(['SOLICITADA', 'AGENDADA', 'EM_COLETA', 'COLETADA', 'CANCELADA'], 'SOLICITADA'),
      customer_id: I, customer_name: REQ(T(200)), contact_name: T(120), contact_phone: T(40),
      address: T(300), neighborhood: T(120), city: T(120), state: U(2), postal_code: T(12),
      destination_city: T(120), destination_state: U(2), volumes: I, weight_kg: N, cubage_m3: N, cargo_value: N,
      invoice_numbers: T(200), quote_id: I, vehicle_id: I, driver_id: I, trip_id: I, notes: NOTES,
    },
    select: `${VEHICLE_COLS}, ${DRIVER_COLS}, ${TRIP_COLS}`,
    joins: `${VEHICLE_JOIN} ${DRIVER_JOIN} ${TRIP_JOIN}`,
    search: ['t.pickup_id', 't.customer_name', 't.city', 't.invoice_numbers', 'v.plate'],
    filters: { status: 't.status', vehicle_id: 't.vehicle_id' },
    dateField: 'COALESCE(t.scheduled_date, t.request_date)',
    order: 'COALESCE(t.scheduled_date, t.request_date) DESC, t.pickup_id DESC',
    beforeSave(p, _children, { current }) {
      const status = p.status ?? current?.status;
      if (status === 'COLETADA' && !current?.collected_at) p.collected_at = new Date().toISOString();
      if (status === 'AGENDADA' && !(p.scheduled_date ?? current?.scheduled_date)) throw httpError('SCHEDULED_DATE_REQUIRED', 400);
    },
  },

  // ───────── Faturas de frete ─────────
  freightInvoices: {
    table: 'tmsFreightInvoices', pk: 'freight_invoice_id', createdBy: true,
    fields: {
      issue_date: D, due_date: REQ(D), customer_id: I, customer_name: REQ(T(200)), customer_tax_id: T(20),
      payment_method: E(['BOLETO', 'PIX', 'TRANSFERENCIA', 'DINHEIRO', 'OUTROS'], 'BOLETO'),
      discount: N, interest: N, boleto_number: T(60), notes: NOTES,
    },
    search: ['t.freight_invoice_id', 't.customer_name', 't.customer_tax_id', 't.boleto_number'],
    filters: { status: 't.status', customer_id: 't.customer_id' },
    dateField: 't.issue_date',
    order: 't.issue_date DESC, t.freight_invoice_id DESC',
    children: {
      items: {
        table: 'tmsFreightInvoiceItems', pk: 'item_id', fk: 'freight_invoice_id',
        fields: { cte_id: REQ(I), amount: N },
        select: `cx.series, cx.number, cx.issue_date::text AS cte_issue_date, cx.recipient_name,
          cx.destination_city, cx.destination_state, cx.freight_total`,
        joins: 'JOIN public."tmsCte" cx ON cx.cte_id = c.cte_id',
      },
    },
    canEdit: lockedUnless(['ABERTA'], 'INVOICE_LOCKED'),
    canDelete: lockedUnless(['ABERTA', 'CANCELADA'], 'INVOICE_LOCKED'),
    async beforeSave(p, children, { client, id, current }) {
      if (p.customer_tax_id) p.customer_tax_id = onlyDigits(p.customer_tax_id);
      let items = children.items;
      if (items) {
        const ids = items.map((i) => i.cte_id);
        const { rows } = await client.query(
          `SELECT c.cte_id, c.status, c.freight_total,
                  (SELECT fi.freight_invoice_id FROM public."tmsFreightInvoiceItems" ii
                     JOIN public."tmsFreightInvoices" fi ON fi.freight_invoice_id = ii.freight_invoice_id
                    WHERE ii.cte_id = c.cte_id AND fi.status <> 'CANCELADA'
                      AND fi.freight_invoice_id IS DISTINCT FROM $2 LIMIT 1) AS other_invoice
             FROM public."tmsCte" c WHERE c.cte_id = ANY($1::bigint[])`,
          [ids, id]
        );
        if (rows.length !== new Set(ids).size) throw httpError('CTE_NOT_FOUND', 404);
        if (rows.some((r) => !['EMITIDO', 'AUTORIZADO'].includes(r.status))) throw httpError('CTE_NOT_ISSUED', 409);
        const billed = rows.find((r) => r.other_invoice);
        if (billed) {
          const err = httpError('CTE_ALREADY_BILLED', 409);
          err.details = { cte_id: billed.cte_id, freight_invoice_id: billed.other_invoice };
          throw err;
        }
        const byId = new Map(rows.map((r) => [String(r.cte_id), r]));
        items = items.map((i) => ({ ...i, amount: i.amount ?? Number(byId.get(String(i.cte_id)).freight_total) }));
        children.items = items;
      } else if (id) {
        const { rows } = await client.query(
          'SELECT amount FROM public."tmsFreightInvoiceItems" WHERE freight_invoice_id = $1', [id]
        );
        items = rows;
      }
      const gross = sumBy(items || [], 'amount');
      p.cte_count = (items || []).length;
      p.gross_amount = gross;
      const discount = Number(p.discount ?? current?.discount ?? 0);
      const interest = Number(p.interest ?? current?.interest ?? 0);
      p.net_amount = round2(gross - discount + interest);
    },
  },

  // ───────── Arquivos EDI ─────────
  edi: {
    table: 'tmsEdiFiles', pk: 'file_id', createdBy: true,
    fields: { notes: NOTES },
    source: `(SELECT f.file_id, f.edi_type, f.direction, f.customer_id, f.customer_name, f.file_name, f.records,
                     f.period_from, f.period_to, f.status, f.result, f.created_by, f.created_at, f.updated_at
                FROM public."tmsEdiFiles" f) t`,
    search: ['t.file_name', 't.customer_name'],
    filters: { edi_type: 't.edi_type', direction: 't.direction' },
    dateField: 't.created_at::date',
    order: 't.created_at DESC',
  },

  // ───────── Planejamento de carga ─────────
  loadPlans: {
    table: 'tmsLoadPlans', pk: 'load_plan_id', createdBy: true,
    fields: {
      plan_date: D, name: T(120), vehicle_id: I, driver_id: I, trip_id: I, notes: NOTES,
    },
    select: `${VEHICLE_COLS}, v.capacity_kg, v.capacity_m3, ${DRIVER_COLS}, ${TRIP_COLS},
      CASE WHEN v.capacity_kg > 0 THEN ROUND(t.total_weight_kg * 100 / v.capacity_kg, 1) END AS weight_usage_pct,
      CASE WHEN v.capacity_m3 > 0 THEN ROUND(t.total_cubage_m3 * 100 / v.capacity_m3, 1) END AS cubage_usage_pct`,
    joins: `${VEHICLE_JOIN} ${DRIVER_JOIN} ${TRIP_JOIN}`,
    search: ['t.name', 'v.plate', 'e.full_name'],
    filters: { status: 't.status', vehicle_id: 't.vehicle_id' },
    dateField: 't.plan_date',
    order: 't.plan_date DESC, t.load_plan_id DESC',
    children: {
      items: {
        table: 'tmsLoadPlanItems', pk: 'item_id', fk: 'load_plan_id', order: 'c.sequence, c.item_id',
        fields: {
          item_type: E(['CTE', 'COLETA', 'AVULSO'], 'CTE'), cte_id: I, pickup_id: I, sequence: I,
          description: T(200), weight_kg: N, cubage_m3: N, value: N,
        },
      },
    },
    canEdit: lockedUnless(['PLANEJADO', 'CARREGANDO'], 'LOAD_PLAN_LOCKED'),
    canDelete: lockedUnless(['PLANEJADO', 'CANCELADO'], 'LOAD_PLAN_LOCKED'),
    async beforeSave(p, children, { client, id }) {
      let items = children.items;
      if (items) {
        for (const [idx, it] of items.entries()) {
          it.sequence = it.sequence || idx + 1;
          if (it.item_type === 'CTE') {
            if (!it.cte_id) throw httpError('CTE_ID_REQUIRED', 400);
            const { rows: [c] } = await client.query(
              `SELECT series, number, recipient_name, destination_city, destination_state, weight_kg, cubage_m3, cargo_value, status
                 FROM public."tmsCte" WHERE cte_id = $1`, [it.cte_id]
            );
            if (!c) throw httpError('CTE_NOT_FOUND', 404);
            if (c.status === 'CANCELADO') throw httpError('CTE_CANCELADO', 409);
            it.description = it.description || `CT-e ${c.number ?? '(digitado)'} · ${c.recipient_name} · ${c.destination_city ?? ''}/${c.destination_state ?? ''}`;
            it.weight_kg = it.weight_kg ?? c.weight_kg;
            it.cubage_m3 = it.cubage_m3 ?? c.cubage_m3;
            it.value = it.value ?? c.cargo_value;
          } else if (it.item_type === 'COLETA') {
            if (!it.pickup_id) throw httpError('PICKUP_ID_REQUIRED', 400);
            const { rows: [c] } = await client.query(
              'SELECT customer_name, city, state, weight_kg, cubage_m3, cargo_value FROM public."tmsPickupOrders" WHERE pickup_id = $1',
              [it.pickup_id]
            );
            if (!c) throw httpError('PICKUP_NOT_FOUND', 404);
            it.description = it.description || `Coleta ${it.pickup_id} · ${c.customer_name} · ${c.city ?? ''}/${c.state ?? ''}`;
            it.weight_kg = it.weight_kg ?? c.weight_kg;
            it.cubage_m3 = it.cubage_m3 ?? c.cubage_m3;
            it.value = it.value ?? c.cargo_value;
          }
        }
      } else if (id) {
        ({ rows: items } = await client.query(
          'SELECT weight_kg, cubage_m3, value FROM public."tmsLoadPlanItems" WHERE load_plan_id = $1', [id]
        ));
      }
      items = items || [];
      p.item_count = items.length;
      p.total_weight_kg = sumBy(items, 'weight_kg');
      p.total_cubage_m3 = sumBy(items, 'cubage_m3');
      p.total_value = sumBy(items, 'value');
    },
  },

  // ───────── Contratos com autônomos (TAC · CIOT · vale-pedágio) ─────────
  contracts: {
    table: 'tmsDriverContracts', pk: 'contract_id', createdBy: true,
    fields: {
      contract_date: D, status: E(['ABERTO', 'CIOT_GERADO', 'QUITADO', 'CANCELADO'], 'ABERTO'),
      contractor_name: REQ(T(200)), contractor_doc: REQ(T(20)), contractor_rntrc: T(20), contractor_pis: T(20),
      contractor_dependents: I, transporter_id: I, vehicle_plate: U(10), trip_id: I, mdfe_id: I,
      origin_city: T(120), origin_state: U(2), destination_city: T(120), destination_state: U(2),
      freight_amount: REQ(N), advance_amount: N, toll_voucher_amount: N, toll_voucher_supplier: T(60),
      toll_voucher_number: T(30), ciot_number: T(20), ciot_provider: T(60), paid_at: D, notes: NOTES,
    },
    select: `${TRIP_COLS}, m.number AS mdfe_number`,
    joins: `${TRIP_JOIN} LEFT JOIN public."tmsMdfe" m ON m.mdfe_id = t.mdfe_id`,
    search: ['t.contract_id', 't.contractor_name', 't.contractor_doc', 't.ciot_number', 't.vehicle_plate'],
    filters: { status: 't.status', trip_id: 't.trip_id' },
    dateField: 't.contract_date',
    order: 't.contract_date DESC, t.contract_id DESC',
    canDelete: lockedUnless(['ABERTO', 'CANCELADO'], 'CONTRACT_LOCKED'),
    beforeSave(p, _children, { current }) {
      const m = { ...(current || {}), ...p };
      if (p.contractor_doc) p.contractor_doc = onlyDigits(p.contractor_doc);
      const status = m.status;
      if (['CIOT_GERADO', 'QUITADO'].includes(status) && !m.ciot_number) throw httpError('CIOT_REQUIRED', 400);
      if (status === 'QUITADO' && !m.paid_at) p.paid_at = new Date().toISOString().slice(0, 10);
      const freight = Number(m.freight_amount || 0);
      const ret = calcTacRetentions(freight, Number(m.contractor_dependents || 0));
      Object.assign(p, ret);
      p.net_amount = round2(freight - ret.inss_amount - ret.sest_senat_amount - ret.irrf_amount);
      p.balance_amount = round2(p.net_amount - Number(m.advance_amount || 0));
    },
  },

  // ───────── Jornada do motorista (Lei 13.103) ─────────
  journeys: {
    table: 'tmsDriverJourneys', pk: 'journey_id',
    fields: {
      driver_id: REQ(I), vehicle_id: I, trip_id: I, journey_date: D, start_at: REQ(TS), end_at: TS,
      meal_break_min: I, rest_break_min: I, waiting_min: I, driving_min: I, notes: NOTES,
    },
    source: `(SELECT j.*,
        CASE WHEN j.end_at IS NOT NULL THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (j.end_at - j.start_at)) / 60)
             - j.meal_break_min - j.rest_break_min - j.waiting_min)::int END AS worked_min,
        ROUND(EXTRACT(EPOCH FROM (j.start_at - LAG(j.end_at) OVER (PARTITION BY j.driver_id ORDER BY j.start_at))) / 60)::int
          AS interjourney_rest_min
      FROM public."tmsDriverJourneys" j) t`,
    select: `${DRIVER_COLS}, ${VEHICLE_COLS},
      GREATEST(0, COALESCE(t.worked_min, 0) - 480) AS overtime_min,
      CONCAT_WS(' · ',
        CASE WHEN t.worked_min - 480 > 120 THEN 'Hora extra acima de 2h' END,
        CASE WHEN t.interjourney_rest_min < 660 THEN 'Interjornada menor que 11h' END,
        CASE WHEN t.worked_min > 360 AND t.meal_break_min < 60 THEN 'Refeição menor que 1h' END,
        CASE WHEN t.driving_min > 330 AND t.rest_break_min < 30 THEN 'Sem descanso de 30min a cada 5h30 de direção' END
      ) AS violations`,
    joins: `${DRIVER_JOIN} ${VEHICLE_JOIN}`,
    search: ['e.full_name', 'v.plate'],
    filters: { driver_id: 't.driver_id' },
    dateField: 't.journey_date',
    order: 't.start_at DESC',
    beforeSave(p, _children, { current }) {
      const m = { ...(current || {}), ...p };
      if (m.end_at && new Date(m.end_at) <= new Date(m.start_at)) throw httpError('END_BEFORE_START', 400);
      if (p.start_at && !p.journey_date && !current?.journey_date) p.journey_date = p.start_at.slice(0, 10);
      for (const k of ['meal_break_min', 'rest_break_min', 'waiting_min']) if (k in p && p[k] == null) p[k] = 0;
    },
  },

  // ───────── Despesas da viagem ─────────
  tripExpenses: {
    table: 'tmsTripExpenses', pk: 'expense_id',
    fields: {
      trip_id: REQ(I), expense_date: D,
      expense_type: E(['PEDAGIO', 'DIARIA', 'ALIMENTACAO', 'HOSPEDAGEM', 'CARGA_DESCARGA', 'ESTACIONAMENTO', 'COMISSAO', 'OUTROS'], 'PEDAGIO'),
      description: T(200), amount: REQ(N), notes: NOTES,
    },
    select: TRIP_COLS,
    joins: TRIP_JOIN,
    search: ['t.description', 'tr.name', 't.trip_id'],
    filters: { trip_id: 't.trip_id', expense_type: 't.expense_type' },
    dateField: 't.expense_date',
    order: 't.expense_date DESC, t.expense_id DESC',
  },

  // ───────── Planos de manutenção ─────────
  maintenancePlans: {
    table: 'tmsMaintenancePlans', pk: 'maintenance_plan_id',
    fields: {
      vehicle_id: REQ(I), service_name: REQ(T(120)), interval_km: I, interval_days: I, last_km: I, last_date: D,
      is_active: B(true), notes: NOTES,
    },
    source: `(SELECT mp.*, ${vehicleKmSql('mp.vehicle_id')} AS current_km FROM public."tmsMaintenancePlans" mp) t`,
    select: `${VEHICLE_COLS},
      CASE WHEN t.interval_km IS NOT NULL THEN COALESCE(t.last_km, 0) + t.interval_km END AS next_km,
      CASE WHEN t.interval_days IS NOT NULL AND t.last_date IS NOT NULL THEN (t.last_date + t.interval_days)::text END AS next_date,
      CASE
        WHEN (t.interval_km IS NOT NULL AND t.current_km >= COALESCE(t.last_km, 0) + t.interval_km)
          OR (t.interval_days IS NOT NULL AND t.last_date IS NOT NULL AND CURRENT_DATE >= t.last_date + t.interval_days) THEN 'VENCIDO'
        WHEN (t.interval_km IS NOT NULL AND t.current_km >= COALESCE(t.last_km, 0) + t.interval_km * 0.9)
          OR (t.interval_days IS NOT NULL AND t.last_date IS NOT NULL AND CURRENT_DATE >= t.last_date + (t.interval_days * 0.9)::int) THEN 'PROXIMO'
        ELSE 'EM_DIA' END AS plan_status`,
    joins: VEHICLE_JOIN,
    search: ['t.service_name', 'v.plate'],
    filters: { vehicle_id: 't.vehicle_id', is_active: 't.is_active' },
    order: 'v.plate, t.service_name',
  },

  // ───────── Ordens de serviço ─────────
  workOrders: {
    table: 'tmsWorkOrders', pk: 'work_order_id', createdBy: true,
    fields: {
      vehicle_id: REQ(I), maintenance_plan_id: I, trip_id: I,
      wo_type: E(['PREVENTIVA', 'CORRETIVA', 'PREDITIVA', 'SOCORRO'], 'PREVENTIVA'),
      status: E(['ABERTA', 'EM_EXECUCAO', 'CONCLUIDA', 'CANCELADA'], 'ABERTA'),
      open_date: D, close_date: D, odometer_km: I, workshop_name: T(150), description: REQ(T(4000)),
      parts_cost: N, labor_cost: N, invoice_number: T(30), notes: NOTES,
    },
    select: `${VEHICLE_COLS}, mp.service_name AS plan_service`,
    joins: `${VEHICLE_JOIN} LEFT JOIN public."tmsMaintenancePlans" mp ON mp.maintenance_plan_id = t.maintenance_plan_id`,
    search: ['t.work_order_id', 't.description', 't.workshop_name', 'v.plate'],
    filters: { status: 't.status', vehicle_id: 't.vehicle_id', wo_type: 't.wo_type' },
    dateField: 't.open_date',
    order: 't.open_date DESC, t.work_order_id DESC',
    beforeSave(p, _children, { current }) {
      const m = { ...(current || {}), ...p };
      p.total_cost = round2(Number(m.parts_cost || 0) + Number(m.labor_cost || 0));
      if (m.status === 'CONCLUIDA' && !m.close_date) p.close_date = new Date().toISOString().slice(0, 10);
    },
    async afterSave(id, { client }) {
      // OS preventiva concluída atualiza o plano (último km / última data)
      await client.query(
        `UPDATE public."tmsMaintenancePlans" mp
            SET last_km = COALESCE(w.odometer_km, mp.last_km), last_date = COALESCE(w.close_date, mp.last_date)
           FROM public."tmsWorkOrders" w
          WHERE w.work_order_id = $1 AND w.status = 'CONCLUIDA'
            AND mp.maintenance_plan_id = w.maintenance_plan_id
            AND (mp.last_date IS NULL OR w.close_date >= mp.last_date)`,
        [id]
      );
    },
  },

  // ───────── Pneus ─────────
  tires: {
    table: 'tmsTires', pk: 'tire_id',
    fields: {
      fire_number: REQ(U(30)), brand: T(60), model: T(60), size: T(30),
      status: E(['ESTOQUE', 'EM_USO', 'RECAPAGEM', 'SUCATA'], 'ESTOQUE'),
      vehicle_id: I, position: U(10), installed_km: I, total_km: I, retread_count: I, tread_depth_mm: N,
      purchase_date: D, purchase_cost: N, supplier_name: T(150), notes: NOTES,
    },
    select: `${VEHICLE_COLS}, ${vehicleKmSql('t.vehicle_id')} AS vehicle_km`,
    joins: VEHICLE_JOIN,
    search: ['t.fire_number', 't.brand', 't.model', 't.size', 'v.plate'],
    filters: { status: 't.status', vehicle_id: 't.vehicle_id' },
    order: 't.fire_number',
  },

  tireMovements: {
    table: 'tmsTireMovements', pk: 'tire_movement_id',
    fields: {
      tire_id: REQ(I), movement_date: D,
      movement_type: REQ(E(['MONTAGEM', 'DESMONTAGEM', 'RODIZIO', 'RECAPAGEM', 'RETORNO_RECAPAGEM', 'INSPECAO', 'SUCATA'])),
      vehicle_id: I, position: U(10), odometer_km: I, tread_depth_mm: N, cost: N, notes: NOTES,
    },
    select: `${VEHICLE_COLS}, ti.fire_number, ti.brand AS tire_brand`,
    joins: `${VEHICLE_JOIN} JOIN public."tmsTires" ti ON ti.tire_id = t.tire_id`,
    search: ['ti.fire_number', 'v.plate', 't.notes'],
    filters: { tire_id: 't.tire_id', movement_type: 't.movement_type' },
    dateField: 't.movement_date',
    order: 't.movement_date DESC, t.tire_movement_id DESC',
    canEdit() { throw httpError('MOVEMENT_LOCKED', 409); },
    async beforeSave(p, _children, { client }) {
      const { rows: [tire] } = await client.query(
        'SELECT * FROM public."tmsTires" WHERE tire_id = $1 FOR UPDATE', [p.tire_id]
      );
      if (!tire) throw httpError('TIRE_NOT_FOUND', 404);
      const t = p.movement_type;
      if (['MONTAGEM', 'RODIZIO'].includes(t) && (!p.vehicle_id || !p.position)) throw httpError('VEHICLE_AND_POSITION_REQUIRED', 400);
      if (t === 'MONTAGEM' && tire.status === 'EM_USO') throw httpError('TIRE_ALREADY_MOUNTED', 409);
      if (tire.status === 'SUCATA') throw httpError('TIRE_SCRAPPED', 409);
      if (!['MONTAGEM', 'RODIZIO'].includes(t) && !p.vehicle_id) p.vehicle_id = tire.vehicle_id;
      // km rodado na posição anterior entra no total do pneu
      const kmRun = tire.status === 'EM_USO' && tire.installed_km != null && p.odometer_km != null
        ? Math.max(0, p.odometer_km - tire.installed_km) : 0;
      const upd = { tread_depth_mm: p.tread_depth_mm ?? tire.tread_depth_mm };
      if (t === 'MONTAGEM' || t === 'RODIZIO') {
        Object.assign(upd, {
          status: 'EM_USO', vehicle_id: p.vehicle_id, position: p.position, installed_km: p.odometer_km,
          total_km: tire.total_km + kmRun,
        });
      } else if (t === 'DESMONTAGEM') {
        Object.assign(upd, { status: 'ESTOQUE', vehicle_id: null, position: null, installed_km: null, total_km: tire.total_km + kmRun });
      } else if (t === 'RECAPAGEM') {
        Object.assign(upd, { status: 'RECAPAGEM', vehicle_id: null, position: null, installed_km: null, total_km: tire.total_km + kmRun });
      } else if (t === 'RETORNO_RECAPAGEM') {
        Object.assign(upd, { status: 'ESTOQUE', retread_count: tire.retread_count + 1 });
      } else if (t === 'SUCATA') {
        Object.assign(upd, { status: 'SUCATA', vehicle_id: null, position: null, installed_km: null, total_km: tire.total_km + kmRun });
      }
      const cols = Object.keys(upd);
      await client.query(
        `UPDATE public."tmsTires" SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE tire_id = $1`,
        [p.tire_id, ...cols.map((c) => upd[c])]
      );
    },
  },

  // ───────── Abastecimentos ─────────
  fuel: {
    table: 'tmsFuelEntries', pk: 'fuel_entry_id',
    fields: {
      vehicle_id: REQ(I), driver_id: I, trip_id: I, fuel_date: D, odometer_km: I,
      fuel_type: E(['DIESEL_S10', 'DIESEL_S500', 'ARLA32', 'GASOLINA', 'ETANOL', 'GNV'], 'DIESEL_S10'),
      liters: REQ(N), unit_price: N, total_amount: N, full_tank: B(true), station_name: T(150),
      invoice_number: T(30), notes: NOTES,
    },
    source: `(SELECT f.*,
        f.odometer_km - LAG(f.odometer_km) OVER (
          PARTITION BY f.vehicle_id, (f.fuel_type = 'ARLA32') ORDER BY f.fuel_date, f.odometer_km, f.fuel_entry_id
        ) AS km_driven
      FROM public."tmsFuelEntries" f) t`,
    select: `${VEHICLE_COLS}, ${DRIVER_COLS}, ${TRIP_COLS},
      CASE WHEN t.km_driven > 0 AND t.liters > 0 AND t.fuel_type <> 'ARLA32' THEN ROUND(t.km_driven / t.liters, 2) END AS km_per_liter,
      CASE WHEN t.km_driven > 0 THEN ROUND(t.total_amount / t.km_driven, 3) END AS cost_per_km`,
    joins: `${VEHICLE_JOIN} ${DRIVER_JOIN} ${TRIP_JOIN}`,
    search: ['v.plate', 'e.full_name', 't.station_name', 't.invoice_number'],
    filters: { vehicle_id: 't.vehicle_id', fuel_type: 't.fuel_type', trip_id: 't.trip_id' },
    dateField: 't.fuel_date',
    order: 't.fuel_date DESC, t.odometer_km DESC NULLS LAST, t.fuel_entry_id DESC',
    beforeSave(p, _children, { current }) {
      const m = { ...(current || {}), ...p };
      if (!Number(m.total_amount) && m.unit_price != null) p.total_amount = round2(Number(m.liters) * Number(m.unit_price));
      if (Number(m.total_amount) && m.unit_price == null && Number(m.liters)) {
        p.unit_price = Math.round(Number(m.total_amount) / Number(m.liters) * 10000) / 10000;
      }
    },
  },

  // ───────── Documentos do veículo ─────────
  vehicleDocuments: {
    table: 'tmsVehicleDocuments', pk: 'vehicle_document_id',
    fields: {
      vehicle_id: REQ(I),
      doc_type: E(['CRLV', 'LICENCIAMENTO', 'IPVA', 'SEGURO', 'TACOGRAFO', 'AET', 'ANTT', 'CIV_CIPP', 'OUTROS'], 'CRLV'),
      doc_number: T(40), issue_date: D, expiration_date: D, amount: N, is_paid: B(false), paid_at: D, notes: NOTES,
    },
    select: `${VEHICLE_COLS},
      CASE WHEN t.expiration_date IS NULL THEN 'SEM_VENCIMENTO'
           WHEN t.expiration_date < CURRENT_DATE THEN 'VENCIDO'
           WHEN t.expiration_date <= CURRENT_DATE + 30 THEN 'VENCE_30_DIAS'
           ELSE 'EM_DIA' END AS doc_status,
      (t.expiration_date - CURRENT_DATE) AS days_to_expire`,
    joins: VEHICLE_JOIN,
    search: ['v.plate', 't.doc_number', 't.doc_type'],
    filters: { vehicle_id: 't.vehicle_id', doc_type: 't.doc_type' },
    dateField: 't.expiration_date',
    order: 't.expiration_date NULLS LAST, v.plate',
  },

  // ───────── Multas ─────────
  fines: {
    table: 'tmsTrafficFines', pk: 'fine_id',
    fields: {
      vehicle_id: REQ(I), driver_id: I, ait_number: T(30), infraction_date: TS, infraction_code: T(10),
      description: T(250), location: T(200), agency: T(80), points: I, amount: N, due_date: D,
      status: E(['RECEBIDA', 'CONDUTOR_INDICADO', 'RECURSO', 'PAGA', 'CANCELADA'], 'RECEBIDA'),
      charge_driver: B(false), paid_at: D, notes: NOTES,
    },
    select: `${VEHICLE_COLS}, ${DRIVER_COLS}`,
    joins: `${VEHICLE_JOIN} ${DRIVER_JOIN}`,
    search: ['v.plate', 'e.full_name', 't.ait_number', 't.description'],
    filters: { status: 't.status', vehicle_id: 't.vehicle_id', driver_id: 't.driver_id' },
    dateField: 't.infraction_date::date',
    order: 't.infraction_date DESC NULLS LAST, t.fine_id DESC',
    beforeSave(p, _children, { current }) {
      const m = { ...(current || {}), ...p };
      if (m.status === 'PAGA' && !m.paid_at) p.paid_at = new Date().toISOString().slice(0, 10);
    },
  },
};

/** Atualiza a situação de entrega do CT-e pela última ocorrência */
export async function syncDeliveryStatus(client, cteId) {
  if (!cteId) return;
  const { rows: [last] } = await client.query(
    `SELECT event_type, event_at FROM public."tmsCteEvents" WHERE cte_id = $1 ORDER BY event_at DESC, event_id DESC LIMIT 1`,
    [cteId]
  );
  const status = last ? EVENT_TO_DELIVERY[last.event_type] || 'OCORRENCIA' : 'PENDENTE';
  await client.query(
    `UPDATE public."tmsCte" SET delivery_status = $2, delivered_at = $3 WHERE cte_id = $1`,
    [cteId, status, status === 'ENTREGUE' ? last.event_at : null]
  );
}
