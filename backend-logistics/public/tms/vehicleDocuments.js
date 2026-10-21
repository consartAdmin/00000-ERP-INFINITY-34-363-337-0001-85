// ╔══════════════════════════════════════════════════════════════════════╗
// ║ vehicleDocuments.js — Documentos, Multas e Vencimentos da Frota     ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ CRLV, licenciamento, IPVA, seguro, tacógrafo, AET, ANTT...       ║
// ║ ✅ Multas com indicação de condutor e desconto do motorista         ║
// ║ ✅ Painel de alertas (documentos, CNH, manutenção, multas)          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, esc, fmtDate, fmtMoney, badge, todayIso } from './tmsEngine.js';
import { fVehicle, fDriver, fNotes, fMoney, fInt, fDate, cVehicle, cDriver } from './tmsCommon.js';

const DOC_TYPES = [
  { value: 'CRLV', label: 'CRLV' }, { value: 'LICENCIAMENTO', label: 'Licenciamento' }, { value: 'IPVA', label: 'IPVA' },
  { value: 'SEGURO', label: 'Seguro' }, { value: 'TACOGRAFO', label: 'Aferição do tacógrafo' }, { value: 'AET', label: 'AET' },
  { value: 'ANTT', label: 'RNTRC / ANTT' }, { value: 'CIV_CIPP', label: 'CIV / CIPP' }, { value: 'OUTROS', label: 'Outros' },
];
const DOC_LABEL = Object.fromEntries(DOC_TYPES.map((d) => [d.value, d.label]));
const DOC_STATUS_LABEL = { EM_DIA: 'Em dia', VENCE_30_DIAS: 'Vence em 30 dias', VENCIDO: 'Vencido', SEM_VENCIMENTO: 'Sem vencimento' };
const FINE_STATUS = [
  { value: 'RECEBIDA', label: 'Recebida' }, { value: 'CONDUTOR_INDICADO', label: 'Condutor indicado' },
  { value: 'RECURSO', label: 'Em recurso' }, { value: 'PAGA', label: 'Paga' }, { value: 'CANCELADA', label: 'Cancelada' },
];
const FINE_LABEL = Object.fromEntries(FINE_STATUS.map((s) => [s.value, s.label]));
const ALERT_KIND = { DOCUMENTO: '📄 Documento', CNH: '🪪 CNH', MANUTENCAO: '🔧 Manutenção', MULTA: '🚨 Multa' };

const alertsTab = {
  key: 'alerts', label: '🔔 Alertas',
  custom: {
    async load(el) {
      const rows = await api('/reports/fleet-alerts');
      const late = rows.filter((r) => r.level === 'VENCIDO').length;
      el.innerHTML = `
        <div class="tms-cards">
          <div class="tms-card ${late ? 'tms-card--bad' : 'tms-card--good'}"><div class="tms-card__label">Vencidos</div><div class="tms-card__value">${late}</div></div>
          <div class="tms-card"><div class="tms-card__label">Vencem em 30 dias</div><div class="tms-card__value">${rows.length - late}</div></div>
        </div>
        <div class="table-layout-integrated"><div class="table-scroll">
          <table class="table table-zebra table-zebra-hover table-sticky-head">
            <thead><tr><th>Tipo</th><th>Veículo / motorista</th><th>Item</th><th>Vencimento</th><th>Situação</th></tr></thead>
            <tbody>${rows.length ? rows.map((r) => `<tr>
              <td>${esc(ALERT_KIND[r.kind] || r.kind)}</td><td>${esc(r.ref)}</td>
              <td>${esc(r.kind === 'DOCUMENTO' ? DOC_LABEL[r.item] || r.item : r.item)}</td>
              <td>${esc(/^\d{4}-\d{2}-\d{2}$/.test(r.due || '') ? fmtDate(r.due) : r.due || '')}</td>
              <td>${badge(r.level, DOC_STATUS_LABEL[r.level])}</td></tr>`).join('')
    : '<tr><td class="tms-empty" colspan="5">Nada vencido ou vencendo nos próximos 30 dias. 👍</td></tr>'}</tbody>
          </table>
        </div></div>`;
    },
  },
};

mountTmsPage({
  title: 'Documentos e Multas da Frota',
  subtitle: 'Controle os vencimentos dos documentos dos veículos e as multas de trânsito.',
  tabs: [
    {
      key: 'docs', label: '📄 Documentos', resource: 'vehicleDocuments', pk: 'vehicle_document_id', newLabel: '➕ Novo documento',
      searchPlaceholder: 'Placa, número, tipo...',
      filters: [
        { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
        { key: 'doc_type', label: 'Documento', options: DOC_TYPES },
        { key: 'period', type: 'daterange', label: 'Vencimento de' },
      ],
      columns: [
        cVehicle,
        { key: 'doc_type', label: 'Documento', width: 170, render: (r) => esc(DOC_LABEL[r.doc_type]) },
        { key: 'doc_number', label: 'Número', width: 130 },
        { key: 'issue_date', label: 'Emissão', fmt: 'date', width: 95 },
        { key: 'expiration_date', label: 'Vencimento', fmt: 'date', width: 100 },
        { key: 'days_to_expire', label: 'Dias', fmt: 'int', width: 70 },
        { key: 'amount', label: 'Valor', fmt: 'money', width: 110 },
        { key: 'is_paid', label: 'Pago', fmt: 'bool', width: 70 },
        { key: 'doc_status', label: 'Situação', fmt: 'badge', labels: DOC_STATUS_LABEL, width: 140 },
      ],
      form: {
        title: 'Documento do veículo', width: 11,
        defaults: () => ({ doc_type: 'CRLV', is_paid: false }),
        sections: [{
          fields: [
            fVehicle({ required: true, w: 19 }),
            { key: 'doc_type', label: 'Documento', type: 'select', noEmpty: true, options: DOC_TYPES, w: 19 },
            { key: 'doc_number', label: 'Número', w: 19 },
            fDate('issue_date', 'Emissão', { w: 9 }), fDate('expiration_date', 'Vencimento', { w: 9 }),
            fMoney('amount', 'Valor', { w: 9 }), { key: 'is_paid', label: 'Pago', type: 'bool', default: false, w: 9 },
            fDate('paid_at', 'Pago em', { w: 9 }),
            fNotes(),
          ],
        }],
        beforeSave(p) {
          if (p.is_paid && !p.paid_at) p.paid_at = todayIso();
        },
      },
    },
    {
      key: 'fines', label: '🚨 Multas', resource: 'fines', pk: 'fine_id', newLabel: '➕ Nova multa',
      searchPlaceholder: 'AIT, placa, motorista, local...',
      filters: [
        { key: 'status', label: 'Situação', options: FINE_STATUS },
        { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
        { key: 'driver_id', label: 'Motorista', type: 'lookup', lookup: 'drivers' },
        { key: 'period', type: 'daterange', label: 'Infração de' },
      ],
      columns: [
        { key: 'infraction_date', label: 'Infração', fmt: 'datetime', width: 130 },
        cVehicle, cDriver,
        { key: 'ait_number', label: 'AIT', width: 110 },
        { key: 'description', label: 'Descrição', width: 240, render: (r) => `${esc(r.description || '')}<span class="tms-sub">${esc([r.infraction_code, r.location].filter(Boolean).join(' · '))}</span>` },
        { key: 'points', label: 'Pontos', fmt: 'int', width: 70 },
        { key: 'amount', label: 'Valor', fmt: 'money', width: 100 },
        { key: 'due_date', label: 'Vencimento', fmt: 'date', width: 100 },
        { key: 'charge_driver', label: 'Desconta motorista', fmt: 'bool', width: 100 },
        { key: 'status', label: 'Situação', fmt: 'badge', labels: FINE_LABEL, width: 130 },
      ],
      summary: (rows) => `Em aberto na página: <strong>${esc(fmtMoney(rows.filter((r) => !['PAGA', 'CANCELADA'].includes(r.status)).reduce((a, r) => a + Number(r.amount || 0), 0)))}</strong>`,
      form: {
        title: 'Multa de trânsito', width: 12,
        defaults: () => ({ status: 'RECEBIDA', charge_driver: false }),
        sections: [
          {
            title: 'Infração',
            fields: [
              fVehicle({ required: true }), fDriver({ label: 'Motorista (condutor)' }),
              { key: 'infraction_date', label: 'Data e hora', type: 'datetime', w: 17 },
              { key: 'ait_number', label: 'Nº do AIT', w: 12 }, { key: 'infraction_code', label: 'Código', w: 8 },
              { key: 'agency', label: 'Órgão', w: 12, placeholder: 'DETRAN, PRF...' }, fInt('points', 'Pontos', { w: 8 }),
              { key: 'description', label: 'Descrição', w: 30 }, { key: 'location', label: 'Local', w: 25 },
            ],
          },
          {
            title: 'Pagamento',
            fields: [
              fMoney('amount', 'Valor'), fDate('due_date', 'Vencimento'),
              { key: 'status', label: 'Situação', type: 'select', noEmpty: true, options: FINE_STATUS, w: 15 },
              { key: 'charge_driver', label: 'Descontar do motorista', type: 'bool', default: false, w: 14 },
              fDate('paid_at', 'Pago em'),
            ],
          },
          { fields: [fNotes()] },
        ],
        beforeSave(p) {
          if (p.status === 'PAGA' && !p.paid_at) p.paid_at = todayIso();
        },
      },
    },
    alertsTab,
  ],
});
