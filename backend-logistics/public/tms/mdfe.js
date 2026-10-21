// ╔══════════════════════════════════════════════════════════════════════╗
// ║ mdfe.js — MDF-e (Manifesto Eletrônico de Documentos Fiscais, 58)    ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Manifesto por viagem: CT-es emitidos, veículo, motorista, UFs    ║
// ║ ✅ Emitir (número + chave), encerrar, cancelar, DAMDFE simplificado ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  mountTmsPage, api, ask, pickRows, notifyOk, esc, fmtDate, fmtMoney, fmtNum, printHtml, formatKey, todayIso,
} from './tmsEngine.js';
import { fVehicle, fDriver, fTrip, fNotes, fUf, fCity, fDate, fInt, fShow, cVehicle, cDriver, place, docNumber } from './tmsCommon.js';

const MDFE_STATUS = [
  { value: 'DIGITADO', label: 'Digitado' }, { value: 'EMITIDO', label: 'Emitido (aguarda SEFAZ)' },
  { value: 'AUTORIZADO', label: 'Autorizado' }, { value: 'ENCERRADO', label: 'Encerrado' }, { value: 'CANCELADO', label: 'Cancelado' },
];
const MDFE_LABEL = Object.fromEntries(MDFE_STATUS.map((s) => [s.value, s.label]));

async function printDamdfe(row) {
  const { doc: m, emitter: e } = await api(`/print/mdfe/${row.mdfe_id}`);
  printHtml(`DAMDFE ${m.number ?? ''}`, `
    <h1>DAMDFE — Documento Auxiliar do Manifesto Eletrônico de Documentos Fiscais</h1>
    <p class="warn">Documento sem valor fiscal enquanto o MDF-e não for autorizado pela SEFAZ.</p>
    <div class="grid">
      <div class="box"><strong>${esc(e?.razao_social || 'EMITENTE')}</strong><br>CNPJ ${esc(e?.cnpj || '')} · IE ${esc(e?.ie || '')}</div>
      <div class="box">Modelo 58 · Série ${esc(m.series)} · Nº <strong>${esc(m.number ?? '—')}</strong> · Emissão ${esc(fmtDate(m.issue_date))}<br>
        Situação: <strong>${esc(MDFE_LABEL[m.status] || m.status)}</strong><br>Chave: <span class="key">${esc(formatKey(m.access_key) || '—')}</span></div>
    </div>
    <h2>Modal rodoviário</h2>
    <table><tr><th>Veículo</th><th>Reboques</th><th>Motorista</th><th>CIOT</th><th>Vale-pedágio</th></tr>
      <tr><td>${esc(m.vehicle_plate || '')}</td><td>${esc(m.trailer_plates || '')}</td><td>${esc(m.driver_name || '')}</td>
        <td>${esc(m.ciot_number || '')}</td><td>${esc(m.toll_voucher_number || '')}</td></tr></table>
    <h2>Percurso</h2>
    <p>Carregamento: ${esc(place(m.loading_city, m.origin_state))} · Descarregamento: ${esc(place(m.unloading_city, m.destination_state))}
      · UFs de percurso: ${esc(m.route_states || '—')}</p>
    <h2>Documentos (${esc(m.cte_count)})</h2>
    <table><tr><th>CT-e</th><th>Destinatário</th><th>Destino</th><th class="r">Peso (kg)</th><th class="r">Valor da carga</th></tr>
      ${(m.documents || []).map((d) => `<tr><td>${esc(d.number)}</td><td>${esc(d.recipient_name)}</td>
        <td>${esc(place(d.destination_city, d.destination_state))}</td><td class="r">${esc(fmtNum(d.weight_kg, 3))}</td>
        <td class="r">${esc(fmtMoney(d.cargo_value))}</td></tr>`).join('')}
      <tr><th colspan="3">Totais</th><th class="r">${esc(fmtNum(m.total_weight_kg, 3))}</th><th class="r">${esc(fmtMoney(m.total_cargo_value))}</th></tr></table>
    ${m.closed_at ? `<p>Encerrado em ${esc(place(m.closing_city, m.closing_state))} · ${esc(new Date(m.closed_at).toLocaleString('pt-BR'))}</p>` : ''}`);
}

mountTmsPage({
  title: 'MDF-e — Manifesto de Carga',
  subtitle: 'Manifeste os CT-es de cada viagem com veículo, motorista e percurso.',
  notice: '⚠️ Nesta etapa o MDF-e é numerado e recebe a chave de acesso no sistema. O envio para a SEFAZ entra numa próxima etapa.',
  tabs: [{
    key: 'mdfe', label: '🧾 MDF-e', resource: 'mdfe', pk: 'mdfe_id', newLabel: '➕ Novo MDF-e', actionsWidth: 330,
    searchPlaceholder: 'Nº, chave, placa, motorista, cidade...',
    filters: [
      { key: 'status', label: 'Situação', options: MDFE_STATUS },
      { key: 'vehicle_id', label: 'Veículo', type: 'lookup', lookup: 'vehicles' },
      { key: 'period', type: 'daterange', label: 'Emissão de' },
    ],
    columns: [
      { key: 'number', label: 'Nº', width: 80, render: docNumber },
      { key: 'issue_date', label: 'Emissão', fmt: 'date', width: 95 },
      cVehicle, cDriver,
      { key: 'route', label: 'Percurso', width: 230, render: (r) => `${esc(place(r.loading_city, r.origin_state))} → ${esc(place(r.unloading_city, r.destination_state))}<span class="tms-sub">${esc(r.route_states || '')}</span>` },
      { key: 'cte_count', label: 'CT-es', fmt: 'int', width: 70 },
      { key: 'total_weight_kg', label: 'Peso (kg)', fmt: 'num', digits: 0, width: 100 },
      { key: 'total_cargo_value', label: 'Valor carga', fmt: 'money', width: 120 },
      { key: 'status', label: 'Situação', fmt: 'badge', labels: MDFE_LABEL, width: 150 },
    ],
    canEdit: (r) => r.status === 'DIGITADO',
    canDelete: (r) => r.status === 'DIGITADO',
    actions: [
      {
        label: '🚀 Emitir', cls: 'btn-confirm', when: (r) => r.status === 'DIGITADO',
        async run(r, page) {
          if (!confirm('Emitir o MDF-e? Ele recebe número e chave e os CT-es passam a "em trânsito".')) return;
          const out = await api(`/mdfe/${r.mdfe_id}/emit`, { method: 'POST' });
          notifyOk(`MDF-e nº ${out.number} emitido.`);
          await page.reloadAll();
        },
      },
      {
        label: '🏁 Encerrar', when: (r) => ['EMITIDO', 'AUTORIZADO'].includes(r.status),
        async run(r, page) {
          const v = await ask({
            title: `🏁 Encerrar MDF-e ${r.number}`,
            fields: [fCity('closing_city', 'Cidade de encerramento', { value: r.unloading_city, w: 25 }),
              { key: 'closing_state', label: 'UF', type: 'uf', value: r.destination_state, w: 8 }],
            confirmLabel: '🏁 Encerrar',
          });
          if (!v) return;
          await api(`/mdfe/${r.mdfe_id}/close`, { method: 'POST', body: v });
          notifyOk('MDF-e encerrado.');
          await page.reloadAll();
        },
      },
      { label: '🖨️ DAMDFE', run: (r) => printDamdfe(r) },
      {
        label: '❌ Cancelar', cls: 'btn-cancel', when: (r) => ['EMITIDO', 'AUTORIZADO'].includes(r.status),
        async run(r, page) {
          const v = await ask({
            title: `❌ Cancelar MDF-e ${r.number}`,
            fields: [{ key: 'reason', label: 'Motivo do cancelamento (mín. 15 letras)', type: 'textarea', required: true }],
            confirmLabel: '❌ Cancelar MDF-e',
          });
          if (!v) return;
          await api(`/mdfe/${r.mdfe_id}/cancel`, { method: 'POST', body: v });
          notifyOk('MDF-e cancelado.');
          await page.reloadAll();
        },
      },
    ],
    form: {
      title: 'MDF-e', width: 14,
      editTitle: (r) => `🧾 MDF-e ${r.number ? `nº ${r.number}` : `(digitado #${r.mdfe_id})`}`,
      defaults: () => ({ issue_date: todayIso(), series: 1, documents: [] }),
      sections: [
        {
          title: 'Percurso',
          fields: [
            fInt('series', 'Série', { w: 6 }), fDate('issue_date', 'Emissão'),
            fCity('loading_city', 'Cidade de carregamento'), fUf('origin_state', 'UF carga', { required: true }),
            fCity('unloading_city', 'Cidade de descarregamento'), fUf('destination_state', 'UF descarga', { required: true }),
            { key: 'route_states', label: 'UFs de percurso (ex.: MG,RJ,SP)', w: 17, placeholder: 'MG,SP' },
          ],
        },
        {
          title: 'Veículo e motorista',
          fields: [
            fVehicle({ required: true }), { key: 'trailer_plates', label: 'Placas dos reboques', w: 15, placeholder: 'ABC1D23, XYZ9K88' },
            fDriver({ required: true }), fTrip(),
            { key: 'ciot_number', label: 'CIOT', w: 12 }, { key: 'toll_voucher_number', label: 'Nº vale-pedágio', w: 12 },
          ],
        },
        {
          title: 'Situação', when: (r) => !!r.mdfe_id,
          fields: [
            fShow('status_show', 'Situação', { value: (r) => MDFE_LABEL[r.status] || r.status }),
            fShow('access_key', 'Chave de acesso', { w: 30, value: (r) => formatKey(r.access_key) }),
            fShow('closing', 'Encerramento', { w: 20, value: (r) => (r.closed_at ? place(r.closing_city, r.closing_state) : '') }),
          ],
        },
        { fields: [fNotes()] },
      ],
      children: [{
        key: 'documents', title: '📄 CT-es do manifesto', allowAdd: false, keep: ['cte_id'],
        empty: 'Use "Adicionar CT-es emitidos" para incluir os conhecimentos.',
        columns: [
          { key: 'number', label: 'CT-e', display: true, readonly: true, width: 80 },
          { key: 'recipient_name', label: 'Destinatário', display: true, readonly: true },
          { key: 'dest', label: 'Destino', display: true, readonly: true, render: (r) => esc(place(r.destination_city, r.destination_state)) },
          { key: 'weight_kg', label: 'Peso (kg)', display: true, readonly: true, fmt: 'num', digits: 3, width: 110 },
          { key: 'cargo_value', label: 'Valor carga', display: true, readonly: true, fmt: 'money', width: 130 },
        ],
        footer: (rows) => `CT-es: <strong>${rows.length}</strong> · Peso: <strong>${esc(fmtNum(rows.reduce((a, r) => a + (Number(r.weight_kg) || 0), 0), 3))} kg</strong>
          · Valor: <strong>${esc(fmtMoney(rows.reduce((a, r) => a + (Number(r.cargo_value) || 0), 0)))}</strong>`,
        toolbar: [{
          label: '📥 Adicionar CT-es emitidos',
          async run(form) {
            const { rows } = await api('/cte?status=EMITIDO&limit=300');
            const have = new Set(form.childRows.documents.map((d) => String(d.cte_id)));
            const picked = await pickRows({
              title: '📥 CT-es emitidos',
              rows: rows.filter((r) => !have.has(String(r.cte_id))),
              columns: [
                { key: 'number', label: 'CT-e' }, { key: 'issue_date', label: 'Emissão', fmt: 'date' },
                { key: 'recipient_name', label: 'Destinatário' },
                { key: 'dest', label: 'Destino', render: (r) => esc(place(r.destination_city, r.destination_state)) },
                { key: 'weight_kg', label: 'Peso', fmt: 'num' }, { key: 'cargo_value', label: 'Valor carga', fmt: 'money' },
                { key: 'delivery_status', label: 'Entrega', fmt: 'badge' },
              ],
            });
            form.addChildRows('documents', picked);
          },
        }],
      }],
    },
  }],
});
