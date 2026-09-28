// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.details.js                                                ║
// ║ MODULE: NF-es Details                                                ║
// ║ CONSART ERP                                                          ║
// ║ Detalhes expandidos da NF-e                                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { ROUTES } from './nfes.config.js';
import { escapeHtml } from './nfes.utils.js';
import { renderBillingForOrder } from './nfes.billing.js';

export function renderNfeDetailsHtml(data) {
  if (!data) {
    return '<div class="nfe-details-error">Detalhes não disponíveis.</div>';
  }

  const summary = data.summary || data.resumo || null;
  const errors = data.errors || data.erros || data.rejections || [];
  const payments = data.payments || data.pagamentos || [];
  const timeline = data.timeline || data.historico || data.history || [];

  const summaryBlock = summary
    ? `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(summary, null, 2))}</pre>`
    : '<div class="nfe-details-muted">Sem resumo estruturado.</div>';

  const errorsBlock = errors?.length
    ? `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(errors, null, 2))}</pre>`
    : '<div class="nfe-details-ok">Sem erros registrados.</div>';

  const paymentsBlock = payments?.length
    ? `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(payments, null, 2))}</pre>`
    : '<div class="nfe-details-muted">Nenhuma forma de pagamento extraída do XML.</div>';

  const timelineBlock = timeline?.length
    ? `<ul class="nfe-timeline">
        ${timeline.map((t) => `
          <li>
            <span class="nfe-timeline-status">${escapeHtml(t.status || t.situacao || '')}</span>
            <small class="nfe-timeline-date">${escapeHtml(t.at || t.data || t.ts || '')}</small>
          </li>
        `).join('')}
      </ul>`
    : '<div class="nfe-details-muted">Nenhum histórico retornado.</div>';

  const rawBlock = `<pre class="nfe-details-pre">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;

  return `
    <div class="nfe-details-grid">
      <div class="nfe-details-col">
        <h4>📄 Resumo</h4>
        ${summaryBlock}

        <h4>🔄 Histórico de Status</h4>
        ${timelineBlock}
      </div>

      <div class="nfe-details-col">
        <h4>⚠️ Erros / Avisos</h4>
        ${errorsBlock}

        <h4>💳 Formas de Pagamento (XML)</h4>
        ${paymentsBlock}

        <h4>💳 Cobrança / Billing (ERP / Asaas)</h4>
        <div class="nfe-billing-container" data-billing-container>
          <div class="nfe-details-muted">Carregando cobrança vinculada ao pedido...</div>
        </div>
      </div>
    </div>

    <details class="nfe-details-raw">
      <summary>Ver JSON completo retornado pela API</summary>
      ${rawBlock}
    </details>
  `;
}

export async function toggleDetailsRow(rowKey, orderId, btn) {
  if (!rowKey) return;

  const row = document.querySelector(`.nfe-details-row[data-order-id="${rowKey}"]`);
  if (!row) return;

  const container = row.querySelector('.nfe-details-container');
  const isOpen = row.style.display === 'table-row';

  if (isOpen) {
    row.style.display = 'none';
    if (btn) btn.textContent = '▸';
    return;
  }

  row.style.display = 'table-row';
  if (btn) btn.textContent = '▾';

  if (container?.dataset.loaded === '1') return;

  if (!orderId) {
    container.innerHTML =
      '<div class="nfe-details-muted">Registro sem vínculo com Pedido no ERP (order_id ausente). Nenhum detalhe adicional disponível.</div>';
    container.dataset.loaded = '1';
    return;
  }

  container.innerHTML = '<div class="nfe-details-loading">Carregando detalhes da NF-e...</div>';

  try {
    const r = await fetch(ROUTES.details(orderId), { headers: { Accept: 'application/json' } });
    const js = await r.json().catch(() => null);

    if (!js) {
      container.innerHTML = '<div class="nfe-details-error">Não foi possível carregar os detalhes.</div>';
      return;
    }

    container.innerHTML = renderNfeDetailsHtml(js);
    container.dataset.loaded = '1';

    const billingContainer = container.querySelector('[data-billing-container]');
    if (billingContainer) {
      try {
        const br = await fetch(ROUTES.billing(orderId), { headers: { Accept: 'application/json' } });
        const bj = await br.json().catch(() => null);

        if (bj && bj.ok) {
          renderBillingForOrder(billingContainer, bj.rows || []);
        } else {
          renderBillingForOrder(billingContainer, []);
        }
      } catch {
        renderBillingForOrder(billingContainer, []);
      }
    }
  } catch (err) {
    console.error('[NFES] details EXC:', err);
    container.innerHTML = '<div class="nfe-details-error">Erro ao carregar os detalhes desta NF-e.</div>';
  }
}