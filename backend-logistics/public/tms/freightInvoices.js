// ╔══════════════════════════════════════════════════════════════════════╗
// ║ freightInvoices.js — Faturamento de Fretes                          ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Fatura com os CT-es em aberto do mesmo tomador                   ║
// ║ ✅ Emitir, baixar pagamento, cancelar, imprimir, gerar DOCCOB       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  mountTmsPage, api, ask, pickRows, download, notifyOk, esc, fmtDate, fmtMoney, printHtml, todayIso, qs,
} from './tmsEngine.js';
import { fNotes, fMoney, fDate, fShow, fCustomer, hidden, place } from './tmsCommon.js';

const INV_STATUS = [
  { value: 'ABERTA', label: 'Aberta' }, { value: 'EMITIDA', label: 'Emitida' },
  { value: 'PAGA', label: 'Paga' }, { value: 'CANCELADA', label: 'Cancelada' },
];
const INV_LABEL = Object.fromEntries(INV_STATUS.map((s) => [s.value, s.label]));

const sumAmount = (rows) => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

async function printInvoice(row) {
  const f = await api(`/freightInvoices/${row.freight_invoice_id}`);
  printHtml(`Fatura ${f.freight_invoice_id}`, `
    <h1>Fatura de Frete nº ${esc(f.freight_invoice_id)}</h1>
    <div class="grid">
      <div class="box"><strong>Cliente</strong><br>${esc(f.customer_name)}<br>${esc(f.customer_tax_id || '')}</div>
      <div class="box">Emissão: ${esc(fmtDate(f.issue_date))}<br>Vencimento: <strong>${esc(fmtDate(f.due_date))}</strong><br>
        Forma: ${esc(f.payment_method)} ${f.boleto_number ? `· ${esc(f.boleto_number)}` : ''}<br>Situação: ${esc(INV_LABEL[f.status])}</div>
    </div>
    <h2>Conhecimentos (${esc(f.cte_count)})</h2>
    <table><tr><th>CT-e</th><th>Emissão</th><th>Destinatário</th><th>Destino</th><th class="r">Valor</th></tr>
      ${(f.items || []).map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(fmtDate(i.cte_issue_date))}</td><td>${esc(i.recipient_name)}</td>
        <td>${esc(place(i.destination_city, i.destination_state))}</td><td class="r">${esc(fmtMoney(i.amount))}</td></tr>`).join('')}
      <tr><td colspan="4">Valor bruto</td><td class="r">${esc(fmtMoney(f.gross_amount))}</td></tr>
      <tr><td colspan="4">Desconto</td><td class="r">${esc(fmtMoney(f.discount))}</td></tr>
      <tr><td colspan="4">Juros / acréscimos</td><td class="r">${esc(fmtMoney(f.interest))}</td></tr>
      <tr><th colspan="4">VALOR A PAGAR</th><th class="r">${esc(fmtMoney(f.net_amount))}</th></tr></table>
    ${f.notes ? `<h2>Observações</h2><p>${esc(f.notes)}</p>` : ''}`);
}

mountTmsPage({
  title: 'Faturamento de Fretes',
  subtitle: 'Agrupe os CT-es emitidos do mesmo tomador numa fatura, acompanhe o vencimento e dê baixa no pagamento.',
  tabs: [{
    key: 'invoices', label: '💰 Faturas', resource: 'freightInvoices', pk: 'freight_invoice_id', newLabel: '➕ Nova fatura', actionsWidth: 360,
    searchPlaceholder: 'Nº, cliente, CNPJ, boleto...',
    filters: [{ key: 'status', label: 'Situação', options: INV_STATUS }, { key: 'period', type: 'daterange', label: 'Emissão de' }],
    columns: [
      { key: 'freight_invoice_id', label: 'Nº', width: 60 },
      { key: 'issue_date', label: 'Emissão', fmt: 'date', width: 95 },
      {
        key: 'due_date', label: 'Vencimento', width: 110,
        render: (r) => {
          const late = r.status === 'EMITIDA' && r.due_date < todayIso();
          return `<span class="${late ? 'tms-warn' : ''}">${esc(fmtDate(r.due_date))}${late ? ' ⚠️' : ''}</span>`;
        },
      },
      { key: 'customer_name', label: 'Cliente', width: 240 },
      { key: 'cte_count', label: 'CT-es', fmt: 'int', width: 70 },
      { key: 'net_amount', label: 'Valor', fmt: 'money', width: 120 },
      { key: 'payment_method', label: 'Forma', width: 100 },
      { key: 'status', label: 'Situação', fmt: 'badge', labels: INV_LABEL, width: 100 },
      { key: 'paid_at', label: 'Pago em', fmt: 'date', width: 95 },
    ],
    canEdit: (r) => r.status === 'ABERTA',
    canDelete: (r) => ['ABERTA', 'CANCELADA'].includes(r.status),
    summary: (rows) => `A receber na página: <strong>${esc(fmtMoney(rows.filter((r) => r.status === 'EMITIDA').reduce((a, r) => a + Number(r.net_amount || 0), 0)))}</strong>`,
    actions: [
      {
        label: '📨 Emitir', cls: 'btn-confirm', when: (r) => r.status === 'ABERTA',
        async run(r, page) {
          await api(`/freightInvoices/${r.freight_invoice_id}/issue`, { method: 'POST' });
          notifyOk('Fatura emitida.');
          await page.reloadAll();
        },
      },
      {
        label: '💵 Baixar', cls: 'btn-confirm', when: (r) => r.status === 'EMITIDA',
        async run(r, page) {
          const v = await ask({
            title: `💵 Pagamento da fatura ${r.freight_invoice_id}`,
            fields: [fMoney('paid_amount', 'Valor pago', { value: r.net_amount, w: 15 }), fDate('paid_at', 'Data do pagamento', { value: todayIso(), w: 15 })],
            confirmLabel: '💵 Baixar',
          });
          if (!v) return;
          await api(`/freightInvoices/${r.freight_invoice_id}/pay`, { method: 'POST', body: v });
          notifyOk('Pagamento registrado.');
          await page.reloadAll();
        },
      },
      { label: '🖨️ Imprimir', run: (r) => printInvoice(r) },
      {
        label: '📤 DOCCOB', title: 'Gerar o arquivo EDI de cobrança para o cliente', when: (r) => ['EMITIDA', 'PAGA'].includes(r.status),
        async run(r) {
          const f = await api('/edi/export', { method: 'POST', body: { edi_type: 'DOCCOB', freight_invoice_id: r.freight_invoice_id } });
          await download(`/edi/${f.file_id}/download`, f.file_name);
        },
      },
      {
        label: '❌ Cancelar', cls: 'btn-cancel', when: (r) => ['ABERTA', 'EMITIDA'].includes(r.status),
        async run(r, page) {
          if (!confirm('Cancelar a fatura? Os CT-es voltam a ficar livres para faturar.')) return;
          await api(`/freightInvoices/${r.freight_invoice_id}/cancel`, { method: 'POST' });
          notifyOk('Fatura cancelada.');
          await page.reloadAll();
        },
      },
    ],
    form: {
      title: 'Fatura de frete', width: 14,
      defaults: () => ({ issue_date: todayIso(), due_date: addDays(28), payment_method: 'BOLETO', items: [] }),
      sections: [
        {
          title: 'Tomador (cliente que paga o frete)',
          fields: [
            hidden('customer_id'),
            fCustomer('customer', 'Cliente', { required: true, idField: 'customer_id', fill: { tax_id: 'customer_tax_id' } }),
            { key: 'customer_tax_id', label: 'CNPJ/CPF', w: 15 },
            fDate('issue_date', 'Emissão'), fDate('due_date', 'Vencimento', { required: true }),
            { key: 'payment_method', label: 'Forma', type: 'select', noEmpty: true, options: ['BOLETO', 'PIX', 'TRANSFERENCIA', 'DINHEIRO', 'OUTROS'], w: 12 },
            { key: 'boleto_number', label: 'Nº boleto / nosso número', w: 15 },
          ],
        },
        {
          title: 'Valores',
          fields: [
            fMoney('discount', 'Desconto'), fMoney('interest', 'Juros / acréscimos'),
            fShow('gross_amount', 'Valor bruto', { value: (r) => fmtMoney(r.gross_amount) }),
            fShow('net_amount', 'Valor a pagar', { value: (r) => fmtMoney(r.net_amount) }),
          ],
        },
        { fields: [fNotes()] },
      ],
      children: [{
        key: 'items', title: '📄 CT-es da fatura', allowAdd: false, keep: ['cte_id'],
        empty: 'Use "Buscar CT-es em aberto" para incluir os conhecimentos do cliente.',
        columns: [
          { key: 'number', label: 'CT-e', display: true, readonly: true, width: 80 },
          { key: 'cte_issue_date', label: 'Emissão', display: true, readonly: true, fmt: 'date', width: 100 },
          { key: 'recipient_name', label: 'Destinatário', display: true, readonly: true },
          { key: 'dest', label: 'Destino', display: true, readonly: true, render: (r) => esc(place(r.destination_city, r.destination_state)) },
          { key: 'amount', label: 'Valor faturado', type: 'money', width: 140 },
        ],
        footer: (rows) => `CT-es: <strong>${rows.length}</strong> · Total: <strong>${esc(fmtMoney(sumAmount(rows)))}</strong>`,
        toolbar: [{
          label: '📥 Buscar CT-es em aberto',
          async run(form) {
            const customerId = form.get('customer_id');
            const rows = await api(`/freightInvoices/open-ctes${qs({ customer_id: customerId, q: customerId ? '' : form.get('customer_name') })}`);
            const have = new Set(form.childRows.items.map((i) => String(i.cte_id)));
            const picked = await pickRows({
              title: customerId ? '📥 CT-es em aberto do cliente' : '📥 CT-es em aberto (escolha o cliente para filtrar)',
              rows: rows.filter((r) => !have.has(String(r.cte_id))),
              columns: [
                { key: 'number', label: 'CT-e' }, { key: 'issue_date', label: 'Emissão', fmt: 'date' },
                { key: 'payer_name', label: 'Tomador' }, { key: 'recipient_name', label: 'Destinatário' },
                { key: 'freight_total', label: 'Frete', fmt: 'money' },
              ],
            });
            if (!picked.length) return;
            if (!form.get('customer_name')) {
              form.set('customer_name', picked[0].payer_name);
              form.set('customer_id', picked[0].payer_customer_id ?? '');
              form.set('customer_tax_id', picked[0].payer_tax_id ?? '');
            }
            form.addChildRows('items', picked.map((p) => ({ ...p, cte_issue_date: p.issue_date, amount: p.freight_total })));
          },
        }],
      }],
      compute(v, form) {
        const gross = sumAmount(v.items || []);
        form.set('gross_amount', fmtMoney(gross));
        form.set('net_amount', fmtMoney(gross - (Number(v.discount) || 0) + (Number(v.interest) || 0)));
      },
    },
  }],
});
