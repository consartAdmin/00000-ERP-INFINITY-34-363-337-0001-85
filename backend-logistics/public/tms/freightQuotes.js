// ╔══════════════════════════════════════════════════════════════════════╗
// ║ freightQuotes.js — Cotações de Frete                                ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Cálculo automático pela tabela de frete (ao digitar)             ║
// ║ ✅ Aprovar / recusar e gerar o CT-e a partir da cotação             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, notifyOk, esc, fmtMoney, fmtNum, todayIso } from './tmsEngine.js';
import { fNotes, fUf, fCity, fMoney, fNum, fInt, fDate, fShow, fCustomer, hidden, place } from './tmsCommon.js';

const QUOTE_STATUS = [
  { value: 'ABERTA', label: 'Aberta' }, { value: 'APROVADA', label: 'Aprovada' }, { value: 'RECUSADA', label: 'Recusada' },
  { value: 'VENCIDA', label: 'Vencida' }, { value: 'CONVERTIDA', label: 'Virou CT-e' },
];
const QUOTE_LABEL = Object.fromEntries(QUOTE_STATUS.map((s) => [s.value, s.label]));

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const setStatus = (status, msg) => async (r, page) => {
  await api(`/quotes/${r.quote_id}`, { method: 'PUT', body: { status } });
  notifyOk(msg);
  await page.reloadAll();
};

const RESULT_FIELDS = ['taxable_weight', 'freight_weight', 'ad_valorem', 'gris', 'toll', 'fees', 'icms_amount', 'total', 'lead_time_days'];

mountTmsPage({
  title: 'Cotações de Frete',
  subtitle: 'Calcule o frete pela tabela, envie ao cliente e transforme em CT-e quando aprovado.',
  tabs: [{
    key: 'quotes', label: '🧮 Cotações', resource: 'quotes', pk: 'quote_id', newLabel: '➕ Nova cotação', actionsWidth: 320,
    searchPlaceholder: 'Nº, cliente, cidade...',
    filters: [{ key: 'status', label: 'Situação', options: QUOTE_STATUS }, { key: 'period', type: 'daterange', label: 'Data de' }],
    columns: [
      { key: 'quote_id', label: 'Nº', width: 60 },
      { key: 'quote_date', label: 'Data', fmt: 'date', width: 95 },
      { key: 'valid_until', label: 'Validade', fmt: 'date', width: 95 },
      { key: 'customer_name', label: 'Cliente', width: 220 },
      { key: 'route', label: 'Origem → Destino', width: 260, render: (r) => `${esc(place(r.origin_city, r.origin_state))} → ${esc(place(r.destination_city, r.destination_state))}` },
      { key: 'weight_kg', label: 'Peso (kg)', fmt: 'num', digits: 1, width: 90 },
      { key: 'cargo_value', label: 'Valor carga', fmt: 'money', width: 110 },
      { key: 'total', label: 'Frete', fmt: 'money', width: 110 },
      { key: 'status', label: 'Situação', fmt: 'badge', labels: QUOTE_LABEL, width: 110 },
    ],
    canEdit: (r) => ['ABERTA', 'APROVADA'].includes(r.status),
    canDelete: (r) => r.status !== 'CONVERTIDA',
    actions: [
      { label: '👍 Aprovar', cls: 'btn-confirm', when: (r) => r.status === 'ABERTA', run: setStatus('APROVADA', 'Cotação aprovada.') },
      { label: '👎 Recusar', when: (r) => r.status === 'ABERTA', run: setStatus('RECUSADA', 'Cotação recusada.') },
      {
        label: '📄 Gerar CT-e', cls: 'btn-new', when: (r) => ['ABERTA', 'APROVADA'].includes(r.status) && !r.cte_id,
        async run(r, page) {
          if (!confirm('Gerar um CT-e digitado com os dados e o frete desta cotação?')) return;
          const cte = await api(`/quotes/${r.quote_id}/to-cte`, { method: 'POST' });
          notifyOk(`CT-e digitado #${cte.cte_id} criado. Complete o destinatário e as NF-e na tela de CT-e.`);
          await page.reloadAll();
        },
      },
    ],
    form: {
      title: 'Cotação', width: 14,
      defaults: () => ({ quote_date: todayIso(), valid_until: addDays(15), status: 'ABERTA' }),
      sections: [
        {
          title: 'Cliente',
          fields: [
            hidden('customer_id'),
            fCustomer('customer', 'Cliente', { required: true, idField: 'customer_id', fill: { city: 'origin_city', state: 'origin_state' } }),
            { key: 'contact_name', label: 'Contato', w: 15 }, { key: 'contact_phone', label: 'Telefone', w: 12 },
            { key: 'contact_email', label: 'E-mail', w: 20 },
            fDate('quote_date', 'Data'), fDate('valid_until', 'Validade'),
            { key: 'status', label: 'Situação', type: 'select', noEmpty: true, options: QUOTE_STATUS.filter((s) => s.value !== 'CONVERTIDA'), w: 12 },
          ],
        },
        {
          title: 'Carga e percurso',
          fields: [
            fCity('origin_city', 'Origem'), fUf('origin_state'),
            fCity('destination_city', 'Destino'), fUf('destination_state'),
            { key: 'cargo_description', label: 'Mercadoria', w: 20 },
            fNum('weight_kg', 'Peso (kg)'), fInt('volumes', 'Volumes'), fNum('cubage_m3', 'Cubagem (m³)'),
            fMoney('cargo_value', 'Valor da carga'), fNum('distance_km', 'Distância (km)', { step: 0.1 }),
          ],
        },
        {
          title: 'Cálculo do frete',
          fields: [
            { key: 'table_id', label: 'Tabela de frete', type: 'lookup', lookup: 'freightTables', w: 25 },
            fMoney('discount', 'Desconto (R$)'),
            fShow('taxable_weight', 'Peso taxado (kg)', { value: (r) => fmtNum(r.taxable_weight, 3) }),
            fShow('freight_weight', 'Frete peso', { value: (r) => fmtMoney(r.freight_weight) }),
            fShow('ad_valorem', 'Ad valorem', { value: (r) => fmtMoney(r.ad_valorem) }),
            fShow('gris', 'GRIS', { value: (r) => fmtMoney(r.gris) }),
            fShow('toll', 'Pedágio', { value: (r) => fmtMoney(r.toll) }),
            fShow('fees', 'Taxas', { value: (r) => fmtMoney(r.fees) }),
            fShow('icms_amount', 'ICMS', { value: (r) => fmtMoney(r.icms_amount) }),
            fShow('total', 'TOTAL DO FRETE', { value: (r) => fmtMoney(r.total) }),
            fShow('lead_time_days', 'Prazo (dias)', { w: 8 }),
          ],
        },
        { fields: [fNotes()] },
      ],
      async compute(v, form) {
        if (!v.table_id || !(Number(v.weight_kg) || Number(v.cubage_m3) || Number(v.distance_km))) return;
        try {
          const c = await api('/quotes/calc', { method: 'POST', body: v });
          c.total = Math.max(0, c.total - (Number(v.discount) || 0));
          for (const k of RESULT_FIELDS) {
            const val = c[k];
            form.set(k, k === 'taxable_weight' ? fmtNum(val, 3) : k === 'lead_time_days' ? (val ?? '') : fmtMoney(val));
          }
        } catch (err) {
          form.set('total', err.message === 'NO_FREIGHT_RANGE' ? 'sem faixa na tabela' : '—');
        }
      },
    },
  }],
});
