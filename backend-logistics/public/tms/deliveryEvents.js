// ╔══════════════════════════════════════════════════════════════════════╗
// ║ deliveryEvents.js — Ocorrências de Entrega                          ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Entregas em aberto com baixa rápida (entregue / ocorrência)      ║
// ║ ✅ Histórico de ocorrências por CT-e (códigos OCOREN)               ║
// ║ ✅ A situação de entrega do CT-e segue a última ocorrência          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, ask, notifyOk, notifyInfo, esc, fmtDateTime } from './tmsEngine.js';
import {
  fNotes, cVehicle, cTrip, place, EVENT_TYPES, EVENT_LABEL, DELIVERY_STATUS, DELIVERY_LABEL,
} from './tmsCommon.js';

const OPEN_STATUS = DELIVERY_STATUS.filter((s) => ['PENDENTE', 'EM_TRANSITO', 'OCORRENCIA'].includes(s.value));

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const cteLabel = (r) => `CT-e ${r.number ?? r.cte_number ?? ''}`;

async function addEvent(cte, page, preset) {
  const fields = preset === 'ENTREGUE'
    ? [
      { key: 'event_at', label: 'Data e hora da entrega', type: 'datetime', value: nowLocal(), required: true, w: 19 },
      { key: 'received_doc', label: 'Documento de quem recebeu', w: 19 },
      { key: 'received_by', label: 'Recebido por', required: true, w: 40 },
      { key: 'location', label: 'Local', value: place(cte.destination_city, cte.destination_state), w: 40 },
      fNotes({ w: 40 }),
    ]
    : [
      { key: 'event_type', label: 'Ocorrência', type: 'select', noEmpty: true, options: EVENT_TYPES.filter((e) => e.value !== 'ENTREGUE'), value: 'EM_TRANSITO', w: 40 },
      { key: 'event_at', label: 'Data e hora', type: 'datetime', value: nowLocal(), required: true, w: 19 },
      { key: 'location', label: 'Local', w: 19 },
      fNotes({ w: 40 }),
    ];
  const v = await ask({
    title: `${preset === 'ENTREGUE' ? '✅ Baixa de entrega' : '⚠️ Registrar ocorrência'} · ${cteLabel(cte)} · ${cte.recipient_name || ''}`,
    fields,
    confirmLabel: preset === 'ENTREGUE' ? '✅ Confirmar entrega' : '💾 Registrar',
  });
  if (!v) return;
  await api('/events', { method: 'POST', body: { ...v, cte_id: cte.cte_id, event_type: preset || v.event_type } });
  notifyOk(preset === 'ENTREGUE' ? 'Entrega baixada.' : 'Ocorrência registrada.');
  await page.reloadAll();
}

async function showHistory(cte) {
  const { rows } = await api(`/events?cte_id=${cte.cte_id}&limit=100`);
  notifyInfo(`Histórico · ${cteLabel(cte)}`, rows.length
    ? rows.map((e) => `${fmtDateTime(e.event_at)} · ${EVENT_LABEL[e.event_type] || e.event_type}${e.location ? ` · ${e.location}` : ''}${e.received_by ? ` · recebido por ${e.received_by}` : ''}`)
    : ['Nenhuma ocorrência registrada.']);
}

mountTmsPage({
  title: 'Ocorrências de Entrega',
  subtitle: 'Acompanhe as entregas dos CT-es emitidos, registre ocorrências e dê baixa com o nome de quem recebeu.',
  tabs: [
    {
      key: 'open', label: '🚚 Entregas em aberto', resource: 'cte', pk: 'cte_id', allowNew: false, allowDelete: false, actionsWidth: 330,
      intro: 'CT-es emitidos que ainda não foram entregues. As ocorrências enviadas aos clientes saem no EDI OCOREN.',
      baseQuery: { status: 'EMITIDO' },
      searchPlaceholder: 'Nº do CT-e, destinatário, cidade, placa...',
      filters: [
        { key: 'delivery_status', label: 'Entrega', options: OPEN_STATUS },
        { key: 'trip_id', label: 'Rota', type: 'lookup', lookup: 'trips' },
        { key: 'period', type: 'daterange', label: 'Emissão de' },
      ],
      columns: [
        { key: 'number', label: 'CT-e', width: 70 },
        { key: 'issue_date', label: 'Emissão', fmt: 'date', width: 95 },
        { key: 'recipient_name', label: 'Destinatário', width: 220 },
        { key: 'dest', label: 'Destino', width: 160, render: (r) => esc(place(r.destination_city, r.destination_state)) },
        { key: 'payer_name', label: 'Tomador', width: 180 },
        cVehicle, cTrip,
        { key: 'delivery_status', label: 'Entrega', fmt: 'badge', labels: DELIVERY_LABEL, width: 120 },
      ],
      rowClass: (r) => (r.delivery_status === 'ENTREGUE' ? 'is-muted' : ''),
      actions: [
        { label: '✅ Entregue', cls: 'btn-confirm', when: (r) => r.delivery_status !== 'ENTREGUE', run: (r, page) => addEvent(r, page, 'ENTREGUE') },
        { label: '⚠️ Ocorrência', run: (r, page) => addEvent(r, page, null) },
        { label: '📜 Histórico', run: (r) => showHistory(r) },
      ],
    },
    {
      key: 'events', label: '📜 Ocorrências', resource: 'events', pk: 'event_id', newLabel: '➕ Nova ocorrência',
      searchPlaceholder: 'Nº do CT-e, destinatário, local, recebedor...',
      filters: [
        { key: 'event_type', label: 'Ocorrência', options: EVENT_TYPES },
        { key: 'period', type: 'daterange', label: 'Data de' },
      ],
      columns: [
        { key: 'event_at', label: 'Data e hora', fmt: 'datetime', width: 140 },
        { key: 'cte_number', label: 'CT-e', width: 70 },
        { key: 'recipient_name', label: 'Destinatário', width: 200 },
        { key: 'event_type', label: 'Ocorrência', fmt: 'badge', labels: EVENT_LABEL, width: 170 },
        { key: 'event_code', label: 'Cód. OCOREN', width: 90 },
        { key: 'location', label: 'Local', width: 160 },
        { key: 'received_by', label: 'Recebido por', width: 160, render: (r) => `${esc(r.received_by || '')}<span class="tms-sub">${esc(r.received_doc || '')}</span>` },
      ],
      form: {
        title: 'Ocorrência de entrega', width: 11,
        defaults: () => ({ event_type: 'EM_TRANSITO', event_at: new Date().toISOString() }),
        sections: [{
          fields: [
            { key: 'cte_id', label: 'CT-e', type: 'lookup', lookup: 'issuedCtes', required: true, lockOnEdit: true, w: 40 },
            { key: 'event_type', label: 'Ocorrência', type: 'select', noEmpty: true, options: EVENT_TYPES, w: 20 },
            { key: 'event_at', label: 'Data e hora', type: 'datetime', required: true, w: 19 },
            { key: 'event_code', label: 'Código OCOREN (vazio = automático)', w: 19 },
            { key: 'location', label: 'Local', w: 20 },
            { key: 'received_by', label: 'Recebido por', w: 20 }, { key: 'received_doc', label: 'Documento do recebedor', w: 19 },
            fNotes(),
          ],
        }],
      },
    },
  ],
});
