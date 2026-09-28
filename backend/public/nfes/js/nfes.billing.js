// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.billing.js                                                ║
// ║ MODULE: NF-es Billing UI                                             ║
// ║ CONSART ERP                                                          ║
// ║ Renderização de cobranças vinculadas ao pedido                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { formatDateBR, formatMoneyBR } from './nfes.utils.js';

export function renderBillingForOrder(container, billingRows = []) {
  if (!container) return;

  container.innerHTML = '';

  if (!billingRows.length) {
    container.innerHTML = `
      <p class="nfe-billing-empty nfe-details-muted">
        Nenhuma cobrança vinculada a este pedido.
      </p>
    `;
    return;
  }

  const table = document.createElement('table');
  table.className = 'tbl tbl-sm nfe-billing-table';

  table.innerHTML = `
    <thead>
      <tr>
        <th>Origem</th>
        <th>Tipo</th>
        <th>Valor</th>
        <th>Vencimento</th>
        <th>Pago em</th>
        <th>Status</th>
        <th>Parcela</th>
        <th>Boleto</th>
      </tr>
    </thead>
    <tbody>
      ${billingRows.map((row) => {
        const parcela =
          row.installment_number && row.installments_total
            ? `${row.installment_number}/${row.installments_total}`
            : row.installment_number
              ? `${row.installment_number}`
              : '-';

        const boletoLink = row.bank_slip_pdf_url || row.bank_slip_url || null;

        return `
          <tr>
            <td>${row.billing_source || '-'}</td>
            <td>${row.billing_type || '-'}</td>
            <td>R$ ${formatMoneyBR(row.amount)}</td>
            <td>${formatDateBR(row.due_date)}</td>
            <td>${formatDateBR(row.paid_date)}</td>
            <td>${row.status || '-'}</td>
            <td>${parcela || '-'}</td>
            <td>
              ${
                boletoLink
                  ? `<a href="${boletoLink}" target="_blank" rel="noopener noreferrer">Ver boleto</a>`
                  : '-'
              }
            </td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;

  container.appendChild(table);
}