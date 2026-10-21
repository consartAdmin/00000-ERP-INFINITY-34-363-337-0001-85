// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tmsCommon.js — campos, colunas e listas reaproveitados pelas telas  ║
// ║ do Transporte (TMS)                                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { esc, fmtDate } from './tmsEngine.js';

// ───────── Campos de formulário ─────────
export const fVehicle = (extra = {}) => ({ key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles', w: 20, ...extra });
export const fDriver = (extra = {}) => ({ key: 'driver_id', label: 'Motorista', type: 'lookup', lookup: 'drivers', w: 20, ...extra });
export const fTrip = (extra = {}) => ({ key: 'trip_id', label: 'Rota / viagem', type: 'lookup', lookup: 'trips', w: 25, ...extra });
export const fNotes = (extra = {}) => ({ key: 'notes', label: 'Observações', type: 'textarea', w: 40, rows: 2, ...extra });
export const fUf = (key, lbl = 'UF', extra = {}) => ({ key, label: lbl, type: 'uf', w: 6, ...extra });
export const fCity = (key, lbl = 'Cidade', extra = {}) => ({ key, label: lbl, w: 17, max: 120, ...extra });
export const fMoney = (key, lbl, extra = {}) => ({ key, label: lbl, type: 'money', w: 12, min: 0, ...extra });
export const fNum = (key, lbl, extra = {}) => ({ key, label: lbl, type: 'number', w: 10, step: 0.001, min: 0, ...extra });
export const fInt = (key, lbl, extra = {}) => ({ key, label: lbl, type: 'int', w: 8, min: 0, ...extra });
export const fDate = (key, lbl, extra = {}) => ({ key, label: lbl, type: 'date', w: 12, ...extra });
export const fShow = (key, lbl, extra = {}) => ({ key, label: lbl, readonly: true, display: true, w: 12, ...extra });

/** Cliente com autocomplete; preenche os campos ligados ao escolher */
export const fCustomer = (prefix, lbl, extra = {}) => ({
  key: `${prefix}_name`,
  label: lbl,
  type: 'customer',
  w: 30,
  placeholder: 'Digite nome, CNPJ ou código',
  idField: `${prefix}_customer_id`,
  fill: { tax_id: `${prefix}_tax_id`, city: `${prefix}_city`, state: `${prefix}_state`, address: `${prefix}_address` },
  ...extra,
});

export const hidden = (key) => ({ key, type: 'hidden' });

// ───────── Colunas ─────────
export const cVehicle = { key: 'vehicle_plate', label: 'Veículo', width: 110 };
export const cDriver = { key: 'driver_name', label: 'Motorista', width: 180 };
export const cTrip = {
  key: 'trip_id', label: 'Rota', width: 150,
  render: (r) => (r.trip_id ? `#${esc(r.trip_id)}<span class="tms-sub">${esc(fmtDate(r.trip_date))} ${esc(r.trip_name || '')}</span>` : ''),
};

export const place = (city, uf) => [city, uf].filter(Boolean).join('/');

/** Nº do documento fiscal (ou "digitado" quando ainda não emitido) */
export const docNumber = (r) => (r.number
  ? `<strong>${esc(r.number)}</strong><span class="tms-sub">série ${esc(r.series)}</span>`
  : '<span class="tms-sub">— digitado —</span>');

// ───────── Domínios ─────────
export const CTE_STATUS = [
  { value: 'DIGITADO', label: 'Digitado' }, { value: 'EMITIDO', label: 'Emitido (aguarda SEFAZ)' },
  { value: 'AUTORIZADO', label: 'Autorizado' }, { value: 'CANCELADO', label: 'Cancelado' },
];
export const DELIVERY_STATUS = [
  { value: 'PENDENTE', label: 'Pendente' }, { value: 'EM_TRANSITO', label: 'Em trânsito' },
  { value: 'ENTREGUE', label: 'Entregue' }, { value: 'OCORRENCIA', label: 'Com ocorrência' },
  { value: 'DEVOLVIDO', label: 'Devolvido' },
];
export const EVENT_TYPES = [
  { value: 'COLETADO', label: 'Coletado' }, { value: 'EM_TRANSITO', label: 'Em trânsito' },
  { value: 'SAIU_PARA_ENTREGA', label: 'Saiu para entrega' }, { value: 'ENTREGUE', label: 'Entregue' },
  { value: 'RECUSADO', label: 'Recusado pelo destinatário' }, { value: 'ENDERECO_NAO_ENCONTRADO', label: 'Endereço não encontrado' },
  { value: 'DESTINATARIO_AUSENTE', label: 'Destinatário ausente' }, { value: 'AVARIA', label: 'Avaria' },
  { value: 'EXTRAVIO', label: 'Extravio' }, { value: 'DEVOLVIDO', label: 'Devolvido ao remetente' },
  { value: 'OUTROS', label: 'Outros' },
];
export const EVENT_LABEL = Object.fromEntries(EVENT_TYPES.map((e) => [e.value, e.label]));
export const DELIVERY_LABEL = Object.fromEntries(DELIVERY_STATUS.map((e) => [e.value, e.label]));
export const CTE_LABEL = Object.fromEntries(CTE_STATUS.map((e) => [e.value, e.label]));
