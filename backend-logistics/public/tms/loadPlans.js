// ╔══════════════════════════════════════════════════════════════════════╗
// ║ loadPlans.js — Planejamento de Carga (romaneio)                     ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Monta a carga do veículo com CT-es pendentes e coletas           ║
// ║ ✅ Ocupação de peso e cubagem x capacidade do veículo               ║
// ║ ✅ Liberar: CT-es e coletas herdam veículo, motorista e rota        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  mountTmsPage, api, pickRows, notifyOk, esc, fmtDate, fmtNum, fmtMoney, printHtml, todayIso, loadLookup,
} from './tmsEngine.js';
import { fVehicle, fDriver, fTrip, fNotes, fDate, fShow, cVehicle, cDriver, cTrip, place } from './tmsCommon.js';

const PLAN_STATUS = [
  { value: 'PLANEJADO', label: 'Planejado' }, { value: 'CARREGANDO', label: 'Carregando' },
  { value: 'LIBERADO', label: 'Liberado' }, { value: 'CANCELADO', label: 'Cancelado' },
];
const PLAN_LABEL = Object.fromEntries(PLAN_STATUS.map((s) => [s.value, s.label]));
const ITEM_TYPES = [{ value: 'CTE', label: 'CT-e' }, { value: 'COLETA', label: 'Coleta' }, { value: 'AVULSO', label: 'Avulso' }];

const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const pct = (v) => (v == null ? '—' : `${fmtNum(v, 1)}%`);

const setStatus = (status, msg, question) => async (r, page) => {
  if (question && !confirm(question)) return;
  await api(`/loadPlans/${r.load_plan_id}/status`, { method: 'PATCH', body: { status } });
  notifyOk(msg);
  await page.reloadAll();
};

async function printManifest(row) {
  const p = await api(`/loadPlans/${row.load_plan_id}`);
  printHtml(`Romaneio ${p.load_plan_id}`, `
    <h1>Romaneio de carga nº ${esc(p.load_plan_id)}${p.name ? ` — ${esc(p.name)}` : ''}</h1>
    <div class="grid">
      <div class="box">Data: <strong>${esc(fmtDate(p.plan_date))}</strong><br>Situação: ${esc(PLAN_LABEL[p.status])}<br>
        Rota: ${esc(p.trip_id ? `#${p.trip_id} ${p.trip_name || ''}` : '—')}</div>
      <div class="box">Veículo: <strong>${esc(p.vehicle_plate || '—')}</strong> ${esc(p.vehicle_description || '')}<br>
        Motorista: ${esc(p.driver_name || '—')}<br>
        Ocupação: peso ${esc(pct(p.weight_usage_pct))} · cubagem ${esc(pct(p.cubage_usage_pct))}</div>
    </div>
    <h2>Itens (${esc(p.item_count)})</h2>
    <table><tr><th>#</th><th>Tipo</th><th>Descrição</th><th class="r">Peso (kg)</th><th class="r">m³</th><th class="r">Valor</th><th>Conferido</th></tr>
      ${(p.items || []).map((i) => `<tr><td>${esc(i.sequence)}</td><td>${esc(i.item_type)}</td><td>${esc(i.description)}</td>
        <td class="r">${esc(fmtNum(i.weight_kg, 1))}</td><td class="r">${esc(fmtNum(i.cubage_m3, 2))}</td>
        <td class="r">${esc(fmtMoney(i.value))}</td><td></td></tr>`).join('')}
      <tr><th colspan="3">Totais</th><th class="r">${esc(fmtNum(p.total_weight_kg, 1))}</th><th class="r">${esc(fmtNum(p.total_cubage_m3, 2))}</th>
        <th class="r">${esc(fmtMoney(p.total_value))}</th><th></th></tr></table>
    <p style="margin-top:40px">__________________________________ Conferente &nbsp;&nbsp;&nbsp; __________________________________ Motorista</p>`);
}

mountTmsPage({
  title: 'Planejamento de Carga',
  subtitle: 'Monte a carga de cada veículo com os CT-es pendentes e as coletas, confira a ocupação e libere a saída.',
  tabs: [{
    key: 'plans', label: '📦 Cargas', resource: 'loadPlans', pk: 'load_plan_id', newLabel: '➕ Nova carga', actionsWidth: 330,
    searchPlaceholder: 'Nome, placa, motorista...',
    filters: [
      { key: 'status', label: 'Situação', options: PLAN_STATUS },
      { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
      { key: 'period', type: 'daterange', label: 'Data de' },
    ],
    columns: [
      { key: 'load_plan_id', label: 'Nº', width: 60 },
      { key: 'plan_date', label: 'Data', fmt: 'date', width: 95 },
      { key: 'name', label: 'Carga', width: 180 },
      cVehicle, cDriver, cTrip,
      { key: 'item_count', label: 'Itens', fmt: 'int', width: 60 },
      { key: 'total_weight_kg', label: 'Peso (kg)', fmt: 'num', digits: 0, width: 95 },
      {
        key: 'usage', label: 'Ocupação', width: 130,
        render: (r) => {
          const over = Number(r.weight_usage_pct) > 100 || Number(r.cubage_usage_pct) > 100;
          return `<span class="${over ? 'tms-warn' : ''}">${esc(pct(r.weight_usage_pct))} peso</span><span class="tms-sub">${esc(pct(r.cubage_usage_pct))} cubagem</span>`;
        },
      },
      { key: 'total_value', label: 'Valor', fmt: 'money', width: 110 },
      { key: 'status', label: 'Situação', fmt: 'badge', labels: PLAN_LABEL, width: 110 },
    ],
    canEdit: (r) => ['PLANEJADO', 'CARREGANDO'].includes(r.status),
    canDelete: (r) => ['PLANEJADO', 'CANCELADO'].includes(r.status),
    actions: [
      { label: '🏗️ Carregando', when: (r) => r.status === 'PLANEJADO', run: setStatus('CARREGANDO', 'Carga em carregamento.') },
      {
        label: '🚦 Liberar', cls: 'btn-confirm', when: (r) => ['PLANEJADO', 'CARREGANDO'].includes(r.status),
        run: setStatus('LIBERADO', 'Carga liberada.', 'Liberar a carga? Os CT-es e coletas passam para este veículo, motorista e rota.'),
      },
      { label: '🖨️ Romaneio', run: (r) => printManifest(r) },
      { label: '⛔ Cancelar', cls: 'btn-cancel', when: (r) => r.status !== 'CANCELADO', run: setStatus('CANCELADO', 'Carga cancelada.', 'Cancelar esta carga?') },
    ],
    form: {
      title: 'Carga', width: 14,
      defaults: () => ({ plan_date: todayIso(), items: [] }),
      sections: [
        {
          title: 'Carga e veículo',
          fields: [
            fDate('plan_date', 'Data'), { key: 'name', label: 'Nome da carga', w: 20, placeholder: 'Ex.: Rota Sul manhã' },
            fVehicle(), fDriver(), fTrip(),
          ],
        },
        {
          title: 'Ocupação',
          fields: [
            fShow('w_total', 'Peso total (kg)'), fShow('w_cap', 'Capacidade (kg)'), fShow('w_pct', 'Ocupação peso'),
            fShow('c_total', 'Cubagem (m³)'), fShow('c_cap', 'Capacidade (m³)'), fShow('c_pct', 'Ocupação cubagem'),
          ],
        },
        { fields: [fNotes()] },
      ],
      children: [{
        key: 'items', title: '📋 Itens da carga (na ordem de entrega)', keep: ['cte_id', 'pickup_id'], addLabel: 'Item avulso',
        newRow: () => ({ item_type: 'AVULSO' }),
        empty: 'Use "Buscar CT-es e coletas" ou adicione um item avulso.',
        columns: [
          { key: 'sequence', label: 'Ordem', type: 'int', width: 70 },
          { key: 'item_type', label: 'Tipo', type: 'select', options: ITEM_TYPES, noEmpty: true, readonly: true, width: 90 },
          { key: 'description', label: 'Descrição' },
          { key: 'weight_kg', label: 'Peso (kg)', type: 'number', step: 0.001, width: 110 },
          { key: 'cubage_m3', label: 'm³', type: 'number', step: 0.001, width: 90 },
          { key: 'value', label: 'Valor', type: 'money', width: 120 },
        ],
        footer: (rows) => `Itens: <strong>${rows.length}</strong> · Peso: <strong>${esc(fmtNum(sum(rows, 'weight_kg'), 1))} kg</strong>
          · Cubagem: <strong>${esc(fmtNum(sum(rows, 'cubage_m3'), 2))} m³</strong> · Valor: <strong>${esc(fmtMoney(sum(rows, 'value')))}</strong>`,
        toolbar: [{
          label: '📥 Buscar CT-es e coletas',
          async run(form) {
            const { ctes, pickups } = await api(`/loadPlans/candidates?load_plan_id=${form.get('load_plan_id') || ''}`);
            const have = new Set(form.childRows.items.map((i) => `${i.cte_id || ''}|${i.pickup_id || ''}`));
            const all = [...ctes, ...pickups].filter((r) => !have.has(`${r.cte_id || ''}|${r.pickup_id || ''}`));
            const picked = await pickRows({
              title: '📥 CT-es pendentes e coletas a fazer',
              rows: all,
              columns: [
                { key: 'item_type', label: 'Tipo' },
                { key: 'doc', label: 'Documento', render: (r) => esc(r.item_type === 'CTE' ? `CT-e ${r.number ?? '(digitado)'}` : `Coleta ${r.pickup_id}`) },
                { key: 'name', label: 'Destinatário / cliente' },
                { key: 'where', label: 'Cidade', render: (r) => esc(place(r.city, r.state)) },
                { key: 'weight_kg', label: 'Peso', fmt: 'num' }, { key: 'cubage_m3', label: 'm³', fmt: 'num' },
                { key: 'value', label: 'Valor', fmt: 'money' },
              ],
            });
            const start = form.childRows.items.length;
            form.addChildRows('items', picked.map((p, i) => ({
              item_type: p.item_type, cte_id: p.cte_id, pickup_id: p.pickup_id, sequence: start + i + 1,
              description: p.item_type === 'CTE'
                ? `CT-e ${p.number ?? '(digitado)'} · ${p.name} · ${place(p.city, p.state)}`
                : `Coleta ${p.pickup_id} · ${p.name} · ${place(p.city, p.state)}`,
              weight_kg: p.weight_kg, cubage_m3: p.cubage_m3, value: p.value,
            })));
          },
        }],
      }],
      async compute(v, form) {
        const items = v.items || [];
        const w = sum(items, 'weight_kg');
        const c = sum(items, 'cubage_m3');
        const veh = v.vehicle_id ? (await loadLookup('vehicles')).find((x) => String(x.id) === String(v.vehicle_id)) : null;
        const capW = Number(veh?.capacity_kg) || 0;
        const capC = Number(veh?.capacity_m3) || 0;
        form.set('w_total', fmtNum(w, 1));
        form.set('c_total', fmtNum(c, 2));
        form.set('w_cap', capW ? fmtNum(capW, 0) : '—');
        form.set('c_cap', capC ? fmtNum(capC, 1) : '—');
        form.set('w_pct', capW ? `${pct((w * 100) / capW)}${w > capW ? ' ⚠️' : ''}` : '—');
        form.set('c_pct', capC ? `${pct((c * 100) / capC)}${c > capC ? ' ⚠️' : ''}` : '—');
      },
    },
  }],
});
