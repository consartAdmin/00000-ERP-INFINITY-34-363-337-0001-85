// ╔══════════════════════════════════════════════════════════════════════╗
// ║ driverContracts.js — Contratos com Autônomos (TAC)                  ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Frete, adiantamento, vale-pedágio e CIOT                         ║
// ║ ✅ Retenções INSS, SEST/SENAT e IRRF calculadas ao digitar          ║
// ║ ✅ Contrato impresso para assinatura                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, ask, pickRows, notifyOk, esc, fmtDate, fmtMoney, printHtml, todayIso, qs } from './tmsEngine.js';
import { fTrip, fNotes, fUf, fCity, fMoney, fInt, fDate, fShow, hidden, cTrip, place } from './tmsCommon.js';

const CONTRACT_STATUS = [
  { value: 'ABERTO', label: 'Aberto' }, { value: 'CIOT_GERADO', label: 'CIOT gerado' },
  { value: 'QUITADO', label: 'Quitado' }, { value: 'CANCELADO', label: 'Cancelado' },
];
const CONTRACT_LABEL = Object.fromEntries(CONTRACT_STATUS.map((s) => [s.value, s.label]));

const setStatus = (status, msg, fields) => async (r, page) => {
  let extra = {};
  if (fields) {
    extra = await ask({ title: `Contrato ${r.contract_id}`, fields: fields(r) });
    if (!extra) return;
  }
  await api(`/contracts/${r.contract_id}`, { method: 'PUT', body: { ...extra, status } });
  notifyOk(msg);
  await page.reloadAll();
};

async function findTransporter(form) {
  const v = await ask({ title: '🔎 Buscar transportador cadastrado', fields: [{ key: 'q', label: 'Nome, CPF ou CNPJ', w: 40 }], confirmLabel: '🔎 Buscar' });
  if (!v) return;
  const rows = await api(`/lookups/transporters${qs({ q: v.q })}`);
  const [t] = await pickRows({
    title: '🚛 Transportadores',
    rows,
    columns: [{ key: 'name', label: 'Nome' }, { key: 'doc', label: 'CPF / CNPJ' }, { key: 'rntrc', label: 'RNTRC' }],
    confirmLabel: '✅ Usar este',
  });
  if (!t) return;
  form.set('transporter_id', t.id);
  form.set('contractor_name', t.name || '');
  form.set('contractor_doc', t.doc || '');
  if (t.rntrc) form.set('contractor_rntrc', t.rntrc);
  form.changed();
}

async function printContract(row) {
  const c = await api(`/contracts/${row.contract_id}`);
  printHtml(`Contrato ${c.contract_id}`, `
    <h1>Contrato de Transporte Rodoviário de Cargas nº ${esc(c.contract_id)}</h1>
    <p class="muted">Transportador Autônomo de Cargas (TAC) · Lei 11.442/2007</p>
    <div class="grid">
      <div class="box"><strong>Contratado</strong><br>${esc(c.contractor_name)}<br>CPF/CNPJ ${esc(c.contractor_doc)}
        · RNTRC ${esc(c.contractor_rntrc || '—')}<br>PIS/NIT ${esc(c.contractor_pis || '—')} · Veículo ${esc(c.vehicle_plate || '—')}</div>
      <div class="box">Data: ${esc(fmtDate(c.contract_date))}<br>Percurso: ${esc(place(c.origin_city, c.origin_state))} → ${esc(place(c.destination_city, c.destination_state))}<br>
        CIOT: <strong>${esc(c.ciot_number || '—')}</strong> ${c.ciot_provider ? `(${esc(c.ciot_provider)})` : ''}<br>
        Vale-pedágio: ${esc(fmtMoney(c.toll_voucher_amount))} ${c.toll_voucher_number ? `· nº ${esc(c.toll_voucher_number)}` : ''}</div>
    </div>
    <h2>Valores</h2>
    <table>
      <tr><td>Valor do frete</td><td class="r">${esc(fmtMoney(c.freight_amount))}</td></tr>
      <tr><td>(-) INSS</td><td class="r">${esc(fmtMoney(c.inss_amount))}</td></tr>
      <tr><td>(-) SEST/SENAT</td><td class="r">${esc(fmtMoney(c.sest_senat_amount))}</td></tr>
      <tr><td>(-) IRRF</td><td class="r">${esc(fmtMoney(c.irrf_amount))}</td></tr>
      <tr><th>Valor líquido</th><th class="r">${esc(fmtMoney(c.net_amount))}</th></tr>
      <tr><td>(-) Adiantamento</td><td class="r">${esc(fmtMoney(c.advance_amount))}</td></tr>
      <tr><th>Saldo a pagar na entrega</th><th class="r">${esc(fmtMoney(c.balance_amount))}</th></tr>
    </table>
    <p class="muted">O vale-pedágio é pago à parte e não integra o valor do frete (Lei 10.209/2001).</p>
    ${c.notes ? `<h2>Observações</h2><p>${esc(c.notes)}</p>` : ''}
    <p style="margin-top:50px">__________________________________ Contratante &nbsp;&nbsp;&nbsp; __________________________________ Contratado</p>`);
}

mountTmsPage({
  title: 'Contratos com Autônomos',
  subtitle: 'Contrate motoristas autônomos (TAC) com CIOT e vale-pedágio. As retenções de INSS, SEST/SENAT e IRRF são calculadas na hora.',
  notice: 'ℹ️ O CIOT e o vale-pedágio são gerados na operadora de pagamento (ex.: Repom, Pamcard) e informados aqui.',
  tabs: [{
    key: 'contracts', label: '🤝 Contratos', resource: 'contracts', pk: 'contract_id', newLabel: '➕ Novo contrato', actionsWidth: 320,
    searchPlaceholder: 'Nº, contratado, CPF, CIOT, placa...',
    filters: [{ key: 'status', label: 'Situação', options: CONTRACT_STATUS }, { key: 'period', type: 'daterange', label: 'Data de' }],
    columns: [
      { key: 'contract_id', label: 'Nº', width: 60 },
      { key: 'contract_date', label: 'Data', fmt: 'date', width: 95 },
      { key: 'contractor_name', label: 'Contratado', width: 200, render: (r) => `${esc(r.contractor_name)}<span class="tms-sub">${esc(r.contractor_doc)}</span>` },
      { key: 'vehicle_plate', label: 'Placa', width: 90 },
      { key: 'route', label: 'Percurso', width: 200, render: (r) => `${esc(place(r.origin_city, r.origin_state))} → ${esc(place(r.destination_city, r.destination_state))}` },
      cTrip,
      { key: 'freight_amount', label: 'Frete', fmt: 'money', width: 110 },
      { key: 'balance_amount', label: 'Saldo', fmt: 'money', width: 110 },
      { key: 'ciot_number', label: 'CIOT', width: 120 },
      { key: 'status', label: 'Situação', fmt: 'badge', labels: CONTRACT_LABEL, width: 110 },
    ],
    canEdit: (r) => ['ABERTO', 'CIOT_GERADO'].includes(r.status),
    canDelete: (r) => ['ABERTO', 'CANCELADO'].includes(r.status),
    actions: [
      {
        label: '🧾 CIOT gerado', when: (r) => r.status === 'ABERTO',
        run: setStatus('CIOT_GERADO', 'CIOT registrado.', (r) => [
          { key: 'ciot_number', label: 'Nº do CIOT', required: true, value: r.ciot_number, w: 19 },
          { key: 'ciot_provider', label: 'Operadora', value: r.ciot_provider, w: 19 },
        ]),
      },
      {
        label: '💵 Quitar', cls: 'btn-confirm', when: (r) => r.status === 'CIOT_GERADO',
        run: setStatus('QUITADO', 'Contrato quitado.', () => [fDate('paid_at', 'Data do pagamento', { value: todayIso(), w: 19 })]),
      },
      { label: '🖨️ Contrato', run: (r) => printContract(r) },
      {
        label: '⛔ Cancelar', cls: 'btn-cancel', when: (r) => ['ABERTO', 'CIOT_GERADO'].includes(r.status),
        async run(r, page) {
          if (!confirm('Cancelar este contrato?')) return;
          await setStatus('CANCELADO', 'Contrato cancelado.')(r, page);
        },
      },
    ],
    form: {
      title: 'Contrato com autônomo', width: 14,
      defaults: () => ({ contract_date: todayIso(), status: 'ABERTO', contractor_dependents: 0 }),
      footerButtons: [{ label: '🔎 Buscar transportador', when: (r) => !r.status || ['ABERTO', 'CIOT_GERADO'].includes(r.status), run: findTransporter }],
      sections: [
        {
          title: 'Contratado (TAC)',
          fields: [
            hidden('transporter_id'),
            { key: 'contractor_name', label: 'Nome', required: true, w: 25 },
            { key: 'contractor_doc', label: 'CPF / CNPJ', required: true, w: 14 },
            { key: 'contractor_rntrc', label: 'RNTRC', w: 10 }, { key: 'contractor_pis', label: 'PIS / NIT', w: 12 },
            fInt('contractor_dependents', 'Dependentes (IRRF)', { w: 10 }),
            { key: 'vehicle_plate', label: 'Placa do veículo', w: 10 },
          ],
        },
        {
          title: 'Viagem',
          fields: [
            fDate('contract_date', 'Data'), fTrip(), { key: 'mdfe_id', label: 'MDF-e', type: 'lookup', lookup: 'mdfes', w: 20 },
            fCity('origin_city', 'Origem'), fUf('origin_state'), fCity('destination_city', 'Destino'), fUf('destination_state'),
          ],
        },
        {
          title: 'Pagamento',
          fields: [
            fMoney('freight_amount', 'Valor do frete', { required: true }), fMoney('advance_amount', 'Adiantamento'),
            fMoney('toll_voucher_amount', 'Vale-pedágio'), { key: 'toll_voucher_supplier', label: 'Fornecedor do vale', w: 14 },
            { key: 'toll_voucher_number', label: 'Nº do vale', w: 12 },
            { key: 'ciot_number', label: 'CIOT', w: 12 }, { key: 'ciot_provider', label: 'Operadora do CIOT', w: 14 },
          ],
        },
        {
          title: 'Retenções e saldo',
          fields: [
            fShow('inss_amount', 'INSS', { value: (r) => fmtMoney(r.inss_amount) }),
            fShow('sest_senat_amount', 'SEST/SENAT', { value: (r) => fmtMoney(r.sest_senat_amount) }),
            fShow('irrf_amount', 'IRRF', { value: (r) => fmtMoney(r.irrf_amount) }),
            fShow('net_amount', 'Líquido', { value: (r) => fmtMoney(r.net_amount) }),
            fShow('balance_amount', 'Saldo a pagar', { value: (r) => fmtMoney(r.balance_amount) }),
          ],
        },
        { fields: [fNotes()] },
      ],
      async compute(v, form) {
        const freight = Number(v.freight_amount) || 0;
        const r = await api(`/contracts/retentions${qs({ freight, dependents: Number(v.contractor_dependents) || 0 })}`);
        const net = freight - r.inss_amount - r.sest_senat_amount - r.irrf_amount;
        form.set('inss_amount', fmtMoney(r.inss_amount));
        form.set('sest_senat_amount', fmtMoney(r.sest_senat_amount));
        form.set('irrf_amount', fmtMoney(r.irrf_amount));
        form.set('net_amount', fmtMoney(net));
        form.set('balance_amount', fmtMoney(net - (Number(v.advance_amount) || 0)));
      },
    },
  }],
});
