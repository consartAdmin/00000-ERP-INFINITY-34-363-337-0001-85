// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tripProfit.js — Resultado por Viagem                                ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Receita (CT-es) x custos (combustível, pedágio, despesas,        ║
// ║    autônomos, manutenção) por rota, por veículo ou por cliente      ║
// ║ ✅ Lançamento das despesas da viagem                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, esc, fmtDate, fmtMoney, fmtNum, todayIso, qs, loadLookup, notifyError } from './tmsEngine.js';
import { fTrip, fNotes, fMoney, fDate, cTrip } from './tmsCommon.js';

const EXPENSE_TYPES = [
  { value: 'PEDAGIO', label: 'Pedágio' }, { value: 'DIARIA', label: 'Diária' }, { value: 'ALIMENTACAO', label: 'Alimentação' },
  { value: 'HOSPEDAGEM', label: 'Hospedagem' }, { value: 'CARGA_DESCARGA', label: 'Carga / descarga' },
  { value: 'ESTACIONAMENTO', label: 'Estacionamento' }, { value: 'COMISSAO', label: 'Comissão' }, { value: 'OUTROS', label: 'Outros' },
];
const EXPENSE_LABEL = Object.fromEntries(EXPENSE_TYPES.map((e) => [e.value, e.label]));
const GROUPS = [{ value: 'trip', label: 'Por rota' }, { value: 'vehicle', label: 'Por veículo' }, { value: 'customer', label: 'Por cliente' }];

const firstOfMonth = () => `${todayIso().slice(0, 8)}01`;
const state = { group_by: 'trip', date_from: firstOfMonth(), date_to: todayIso(), vehicle_id: '' };

const money = (v) => esc(fmtMoney(v));
const profitCell = (v) => `<strong class="${Number(v) < 0 ? 'tms-warn' : 'tms-ok'}">${money(v)}</strong>`;
const marginCell = (v) => (v == null ? '—' : `<span class="${Number(v) < 0 ? 'tms-warn' : ''}">${esc(fmtNum(v, 1))}%</span>`);

const COST_COLS = [
  ['fuel', 'Combustível'], ['tolls', 'Pedágio'], ['other_expenses', 'Despesas'], ['third_party', 'Autônomos'], ['maintenance', 'Manutenção'],
];

function firstCols(g) {
  if (g === 'trip') {
    return [
      ['Rota', (r) => `#${esc(r.trip_id)} ${esc(r.name || '')}<span class="tms-sub">${esc(fmtDate(r.trip_date))}</span>`],
      ['Veículo / motorista', (r) => `${esc(r.vehicle_plate || '—')}<span class="tms-sub">${esc(r.driver_name || '')}</span>`],
      ['Km', (r) => esc(fmtNum(r.km, 0)), true], ['CT-es', (r) => esc(r.cte_count ?? 0), true],
    ];
  }
  if (g === 'vehicle') {
    return [
      ['Veículo', (r) => `${esc(r.vehicle_plate)}<span class="tms-sub">${esc(r.vehicle_description || '')}</span>`],
      ['Rotas', (r) => esc(r.trip_count), true], ['Km', (r) => esc(fmtNum(r.km, 0)), true], ['CT-es', (r) => esc(r.cte_count ?? 0), true],
    ];
  }
  return [['Cliente (tomador)', (r) => esc(r.payer_name)], ['Rotas', (r) => esc(r.trip_count), true], ['CT-es', (r) => esc(r.cte_count), true]];
}

function renderReport(el, data) {
  const g = data.group_by;
  const s = data.summary;
  const cols = [
    ...firstCols(g),
    ['Receita', (r) => money(r.revenue), true],
    ...COST_COLS.map(([k, l]) => [l, (r) => money(r[k]), true]),
    ['Custo total', (r) => money(r.cost), true],
    ['Lucro', (r) => profitCell(r.profit), true],
    ['Margem', (r) => marginCell(r.margin_pct), true],
  ];
  if (g !== 'customer') cols.push(['Custo/km', (r) => (r.cost_per_km == null ? '—' : money(r.cost_per_km)), true]);
  el.querySelector('[data-role="report"]').innerHTML = `
    <div class="tms-cards">
      <div class="tms-card"><div class="tms-card__label">Receita</div><div class="tms-card__value">${money(s.revenue)}</div></div>
      <div class="tms-card"><div class="tms-card__label">Custos</div><div class="tms-card__value">${money(s.cost)}</div></div>
      <div class="tms-card ${s.profit < 0 ? 'tms-card--bad' : 'tms-card--good'}"><div class="tms-card__label">Lucro</div><div class="tms-card__value">${money(s.profit)}</div></div>
      <div class="tms-card"><div class="tms-card__label">Margem</div><div class="tms-card__value">${s.margin_pct == null ? '—' : `${esc(fmtNum(s.margin_pct, 1))}%`}</div></div>
      ${COST_COLS.map(([k, l]) => `<div class="tms-card"><div class="tms-card__label">${esc(l)}</div><div class="tms-card__value">${money(s[k])}</div></div>`).join('')}
    </div>
    <div class="table-layout-integrated"><div class="table-scroll">
      <table class="table table-zebra table-zebra-hover table-sticky-head">
        <thead><tr>${cols.map(([l, , n]) => `<th class="${n ? 'tms-num' : ''}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${data.rows.length ? data.rows.map((r) => `<tr>${cols.map(([, f, n]) => `<td class="${n ? 'tms-num' : ''}">${f(r)}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="tms-empty" colspan="${cols.length}">Nenhuma rota no período.</td></tr>`}</tbody>
      </table>
    </div></div>
    <p class="tms-intro">Receita = frete dos CT-es da rota (exceto cancelados). Custos = abastecimentos, despesas da viagem, contratos com autônomos e
      ordens de serviço ligados à rota. Por cliente, o custo da rota é dividido pela participação de cada CT-e na receita.</p>`;
}

const reportTab = {
  key: 'report', label: '📊 Resultado',
  custom: {
    async load(el) {
      if (!el.dataset.ready) {
        el.dataset.ready = '1';
        const vehicles = await loadLookup('vehicles');
        el.innerHTML = `
          <div class="tms-panel">
            <div class="fields-inline fields-inline-wrap fields-gap-3" style="align-items:flex-end;">
              <div class="tms-segment" role="group">${GROUPS.map((g) => `<button type="button" data-group="${g.value}" class="${g.value === state.group_by ? 'is-active' : ''}">${esc(g.label)}</button>`).join('')}</div>
              <div class="fields fields-h-6 fields-w-12 fields-font-3"><label for="tp_from">De</label><input id="tp_from" type="date" value="${esc(state.date_from)}" /></div>
              <div class="fields fields-h-6 fields-w-12 fields-font-3"><label for="tp_to">Até</label><input id="tp_to" type="date" value="${esc(state.date_to)}" /></div>
              <div class="fields fields-h-6 fields-w-20 fields-font-3"><label for="tp_vehicle">Veículo</label>
                <select id="tp_vehicle"><option value="">Todos</option>${vehicles.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')}</select></div>
              <button type="button" class="btn btn-new btn-sm" data-role="run">🔎 Ver resultado</button>
            </div>
          </div>
          <div data-role="report"></div>`;
        const run = () => this.load(el).catch(notifyError);
        el.querySelectorAll('[data-group]').forEach((b) => {
          b.onclick = () => {
            state.group_by = b.dataset.group;
            el.querySelectorAll('[data-group]').forEach((x) => x.classList.toggle('is-active', x === b));
            run();
          };
        });
        el.querySelector('[data-role="run"]').onclick = run;
      }
      state.date_from = el.querySelector('#tp_from').value;
      state.date_to = el.querySelector('#tp_to').value;
      state.vehicle_id = el.querySelector('#tp_vehicle').value;
      const data = await api(`/reports/trip-profit${qs(state)}`);
      renderReport(el, data);
    },
  },
};

mountTmsPage({
  title: 'Resultado por Viagem',
  subtitle: 'Quanto cada rota, veículo ou cliente deu de lucro: receita dos CT-es menos os custos da viagem.',
  tabs: [
    reportTab,
    {
      key: 'expenses', label: '🧾 Despesas da viagem', resource: 'tripExpenses', pk: 'expense_id', newLabel: '➕ Nova despesa',
      intro: 'Pedágios pagos em dinheiro, diárias, alimentação e outras despesas. Combustível vai na tela de Abastecimentos.',
      searchPlaceholder: 'Descrição, rota...',
      filters: [
        { key: 'trip_id', label: 'Rota', type: 'lookup', lookup: 'trips' },
        { key: 'expense_type', label: 'Tipo', options: EXPENSE_TYPES },
        { key: 'period', type: 'daterange', label: 'Data de' },
      ],
      columns: [
        { key: 'expense_date', label: 'Data', fmt: 'date', width: 95 },
        cTrip,
        { key: 'expense_type', label: 'Tipo', width: 140, render: (r) => esc(EXPENSE_LABEL[r.expense_type]) },
        { key: 'description', label: 'Descrição', width: 260 },
        { key: 'amount', label: 'Valor', fmt: 'money', width: 110 },
      ],
      summary: (rows) => `Total na página: <strong>${money(rows.reduce((a, r) => a + Number(r.amount || 0), 0))}</strong>`,
      form: {
        title: 'Despesa da viagem', width: 10,
        defaults: () => ({ expense_date: todayIso(), expense_type: 'PEDAGIO' }),
        sections: [{
          fields: [
            fTrip({ required: true, w: 40 }),
            fDate('expense_date', 'Data', { w: 13 }),
            { key: 'expense_type', label: 'Tipo', type: 'select', noEmpty: true, options: EXPENSE_TYPES, w: 13 },
            fMoney('amount', 'Valor', { required: true, w: 12 }),
            { key: 'description', label: 'Descrição', w: 40 },
            fNotes(),
          ],
        }],
      },
    },
  ],
});
