// ╔══════════════════════════════════════════════════════════════════════╗
// ║ pickupOrders.js — Ordens de Coleta                                  ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Solicitar, agendar (data, janela, veículo, motorista) e baixar   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, notifyOk, esc, fmtDate, fmtNum, todayIso } from './tmsEngine.js';
import {
  fVehicle, fDriver, fTrip, fNotes, fUf, fCity, fMoney, fNum, fInt, fDate, fCustomer, hidden, cVehicle, place,
} from './tmsCommon.js';

const PICKUP_STATUS = [
  { value: 'SOLICITADA', label: 'Solicitada' }, { value: 'AGENDADA', label: 'Agendada' },
  { value: 'EM_COLETA', label: 'Em coleta' }, { value: 'COLETADA', label: 'Coletada' }, { value: 'CANCELADA', label: 'Cancelada' },
];
const PICKUP_LABEL = Object.fromEntries(PICKUP_STATUS.map((s) => [s.value, s.label]));

const setStatus = (status, msg) => async (r, page) => {
  await api(`/pickups/${r.pickup_id}`, { method: 'PUT', body: { status } });
  notifyOk(msg);
  await page.reloadAll();
};

mountTmsPage({
  title: 'Ordens de Coleta',
  subtitle: 'Pedidos de coleta dos clientes: agende com veículo e motorista e dê baixa quando coletado.',
  tabs: [{
    key: 'pickups', label: '📦 Coletas', resource: 'pickups', pk: 'pickup_id', newLabel: '➕ Nova coleta', actionsWidth: 280,
    searchPlaceholder: 'Nº, cliente, cidade, NF, placa...',
    filters: [
      { key: 'status', label: 'Situação', options: PICKUP_STATUS },
      { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
      { key: 'period', type: 'daterange', label: 'Data de' },
    ],
    columns: [
      { key: 'pickup_id', label: 'Nº', width: 60 },
      { key: 'request_date', label: 'Pedido', fmt: 'date', width: 95 },
      { key: 'scheduled_date', label: 'Agendada', width: 120, render: (r) => `${esc(fmtDate(r.scheduled_date))}<span class="tms-sub">${esc(r.time_window || '')}</span>` },
      { key: 'customer_name', label: 'Cliente', width: 220 },
      { key: 'where', label: 'Local', width: 220, render: (r) => `${esc(r.address || '')}<span class="tms-sub">${esc(place(r.city, r.state))}</span>` },
      { key: 'load', label: 'Volumes / peso', width: 130, render: (r) => esc(`${r.volumes ?? '—'} vol · ${fmtNum(r.weight_kg, 1) || '—'} kg`) },
      cVehicle,
      { key: 'status', label: 'Situação', fmt: 'badge', labels: PICKUP_LABEL, width: 110 },
    ],
    canEdit: (r) => !['COLETADA', 'CANCELADA'].includes(r.status),
    canDelete: (r) => ['SOLICITADA', 'CANCELADA'].includes(r.status),
    actions: [
      { label: '🚚 Saiu p/ coleta', when: (r) => r.status === 'AGENDADA', run: setStatus('EM_COLETA', 'Coleta em andamento.') },
      { label: '✅ Coletada', cls: 'btn-confirm', when: (r) => ['AGENDADA', 'EM_COLETA'].includes(r.status), run: setStatus('COLETADA', 'Coleta baixada.') },
      { label: '⛔ Cancelar', cls: 'btn-cancel', when: (r) => ['SOLICITADA', 'AGENDADA'].includes(r.status), run: setStatus('CANCELADA', 'Coleta cancelada.') },
    ],
    form: {
      title: 'Ordem de coleta', width: 13,
      defaults: () => ({ request_date: todayIso(), status: 'SOLICITADA' }),
      sections: [
        {
          title: 'Cliente e local da coleta',
          fields: [
            hidden('customer_id'),
            fCustomer('customer', 'Cliente', {
              required: true, idField: 'customer_id',
              fill: { city: 'city', state: 'state', address: 'address', neighborhood: 'neighborhood', postal_code: 'postal_code', phone: 'contact_phone' },
            }),
            { key: 'contact_name', label: 'Contato', w: 15 }, { key: 'contact_phone', label: 'Telefone', w: 12 },
            { key: 'address', label: 'Endereço', w: 30 }, { key: 'neighborhood', label: 'Bairro', w: 15 },
            fCity('city'), fUf('state'), { key: 'postal_code', label: 'CEP', w: 10 },
          ],
        },
        {
          title: 'Carga',
          fields: [
            fInt('volumes', 'Volumes'), fNum('weight_kg', 'Peso (kg)'), fNum('cubage_m3', 'Cubagem (m³)'),
            fMoney('cargo_value', 'Valor da carga'), { key: 'invoice_numbers', label: 'Notas fiscais', w: 20, placeholder: '1234, 1235' },
            fCity('destination_city', 'Destino'), fUf('destination_state'),
          ],
        },
        {
          title: 'Agendamento',
          fields: [
            fDate('request_date', 'Data do pedido'), fDate('scheduled_date', 'Data agendada'),
            { key: 'time_window', label: 'Janela', w: 12, placeholder: '08h às 12h' },
            { key: 'status', label: 'Situação', type: 'select', noEmpty: true, options: PICKUP_STATUS, w: 12 },
            fVehicle(), fDriver(), fTrip(),
          ],
        },
        { fields: [fNotes()] },
      ],
    },
  }],
});
