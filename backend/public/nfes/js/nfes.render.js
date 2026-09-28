// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.render.js                                                 ║
// ║ MODULE: NF-es Render                                                 ║
// ║ CONSART ERP                                                          ║
// ║ Renderização principal da tabela                                     ║
// ║ ✅ Paginação integrada ao padrão table-footer                        ║
// ║ ✅ IDs: apTableInfo, infoPagina, pagAnterior e pagProxima            ║
// ║ ✅ Mantidos apenas Pedido, Atualizar, DANFE e XML                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { ROUTES } from './nfes.config.js';
import { state } from './nfes.state.js';

import {
  $,
  fmtMoney,
  formatDateTimeBR,
  statusToBadgeClass,
  ambienteToBadgeClass,
  formatAmbienteLabel,
  getDisplayStatus,
  getNfeNumber,
  getNfeKey,
  escapeAttr,
  escapeHtml,
  updateSortIndicators,
} from './nfes.utils.js';

import { refreshRow } from './nfes.actions.js';
import { toggleDetailsRow } from './nfes.details.js';

/* ===================================================================== */
/* HELPERS                                                                */
/* ===================================================================== */

/**
 * Retorna uma chave única e segura para a linha.
 */
function getRowKey(nfe) {
  const orderIdRaw = nfe?.order_id;

  if (
    orderIdRaw !== null &&
    orderIdRaw !== undefined &&
    String(orderIdRaw).trim() !== ''
  ) {
    return String(orderIdRaw).trim();
  }

  const nfeKey = getNfeKey(nfe);

  if (nfeKey && String(nfeKey).trim()) {
    return String(nfeKey).trim();
  }

  const nfeNumber = getNfeNumber(nfe);

  if (nfeNumber && String(nfeNumber).trim()) {
    return String(nfeNumber).trim();
  }

  return [
    Date.now(),
    Math.random().toString(16).slice(2),
  ].join('-');
}

/**
 * Retorna o ID do pedido formatado para uso no HTML.
 */
function getOrderId(nfe) {
  const orderIdRaw = nfe?.order_id;

  if (
    orderIdRaw === null ||
    orderIdRaw === undefined ||
    String(orderIdRaw).trim() === ''
  ) {
    return '';
  }

  return String(orderIdRaw).trim();
}

/**
 * Retorna a quantidade total de páginas.
 */
function getTotalPages() {
  const total = Number(state.total) || 0;
  const limit = Number(state.limit) || 20;

  return Math.max(1, Math.ceil(total / limit));
}

/**
 * Atualiza as informações e botões do rodapé da tabela.
 */
function updateTableFooter() {
  const total = Number(state.total) || 0;
  const currentPage = Math.max(1, Number(state.page) || 1);
  const totalPages = getTotalPages();
  const limit = Number(state.limit) || 20;

  const apTableInfo = $('#apTableInfo');
  const infoPagina = $('#infoPagina');
  const pagAnterior = $('#pagAnterior');
  const pagProxima = $('#pagProxima');
  const apRowsPerPage = $('#apRowsPerPage');

  if (apTableInfo) {
    apTableInfo.textContent =
      total === 1
        ? '1 registro encontrado'
        : `${total} registros encontrados`;
  }

  if (infoPagina) {
    infoPagina.textContent =
      `Página ${currentPage} de ${totalPages}`;
  }

  if (pagAnterior) {
    pagAnterior.disabled = currentPage <= 1;
  }

  if (pagProxima) {
    pagProxima.disabled = currentPage >= totalPages;
  }

  if (apRowsPerPage) {
    apRowsPerPage.value = String(limit);
  }
}

/* ===================================================================== */
/* RENDER                                                                 */
/* ===================================================================== */

export function renderNfes() {
  const tbody = $('#corpoTabelaMovimentacoes');
  const empty = $('#emptyNfes');

  /*
   * Mesmo se o tbody não existir, tenta atualizar o rodapé sem lançar
   * erro de acesso a elementos nulos.
   */
  if (!tbody) {
    console.error(
      '[NFES][RENDER] Elemento #corpoTabelaMovimentacoes não encontrado.',
    );

    updateTableFooter();
    return;
  }

  tbody.innerHTML = '';

  if (empty) {
    empty.style.display =
      state.list.length > 0 ? 'none' : 'block';
  }

  for (const nfe of state.list) {
    const rowKey = getRowKey(nfe);
    const orderId = getOrderId(nfe);

    const number =
      nfe?.order_number ||
      orderId ||
      '';

    const dataHora = formatDateTimeBR(
      nfe?.issue_date,
    );

    const customerName = String(
      nfe?.customer_name || '',
    );

    const customerTaxId = String(
      nfe?.customer_tax_id || '',
    );

    const total = Number(
      nfe?.total_amount || 0,
    );

    const status = String(
      getDisplayStatus(nfe) || '',
    ).trim();

    const nfeNumber = getNfeNumber(nfe);
    const nfeKey = getNfeKey(nfe);

    const environment = String(
      nfe?.nfe_environment ||
      nfe?.environment ||
      '',
    ).trim();

    const nfeNumberLabel =
      nfeNumber !== null &&
        nfeNumber !== undefined &&
        String(nfeNumber).trim() !== ''
        ? String(nfeNumber).trim()
        : '— —';

    const nfeKeyFull =
      nfeKey !== null &&
        nfeKey !== undefined &&
        String(nfeKey).trim() !== ''
        ? String(nfeKey).trim()
        : '';

    const nfeKeyLabel =
      nfeKeyFull || '— —';

    const displayCustomerName =
      customerName.length > 29
        ? `${customerName.slice(0, 29)}…`
        : customerName;

    const statusLabel = status
      ? status.charAt(0).toUpperCase() +
      status.slice(1).toLowerCase()
      : 'Não informado';

    const normalizedStatus =
      status.toUpperCase();

    const isCanceled =
      normalizedStatus === 'CANCELADO' ||
      normalizedStatus.includes('CANCEL');

    /* ================================================================= */
    /* LINHA PRINCIPAL                                                   */
    /* ================================================================= */

    const tr = document.createElement('tr');

    tr.classList.add('nfe-row');
    tr.dataset.orderId = orderId;
    tr.dataset.rowKey = rowKey;

    tr.classList.toggle(
      'nfe-row-canceled',
      isCanceled,
    );

    tr.innerHTML = `
      <td class="caret-cell">
        <button
          type="button"
          class="caret-btn"
          data-act="toggleDetails"
          data-row="${escapeAttr(rowKey)}"
          data-id="${escapeAttr(orderId)}"
          title="Mostrar detalhes da NF-e"
          aria-label="Mostrar detalhes da NF-e"
          aria-expanded="false"
        >▸</button>
      </td>

      <td class="num">
        ${escapeHtml(number)}
      </td>

      <td class="nowrap">
        ${escapeHtml(dataHora)}
      </td>

      <td class="td-nfe-num">
        ${escapeHtml(nfeNumberLabel)}
      </td>

      <td
        class="td-chave"
        title="${escapeAttr(nfeKeyLabel)}"
      >
        ${escapeHtml(nfeKeyLabel)}
      </td>

      <td title="${escapeAttr(customerName)}">
        ${escapeHtml(displayCustomerName)}
      </td>

      <td class="num">
        ${escapeHtml(customerTaxId)}
      </td>

      <td class="money ta-right">
        ${fmtMoney(total)}
      </td>

      <td>
        <span class="badge ${statusToBadgeClass(status)}">
          ${escapeHtml(statusLabel)}
        </span>
      </td>

      <td>
        <span class="badge ${ambienteToBadgeClass(environment)}">
          ${escapeHtml(formatAmbienteLabel(environment))}
        </span>
      </td>

      <td class="row gap-8">
        <button
          type="button"
          class="btn btn-flat btn-sm"
          data-act="viewOrder"
          data-id="${escapeAttr(orderId)}"
          title="Abrir pedido"
          ${orderId ? '' : 'disabled'}
        >
          🔍 Pedido
        </button>

        <button
          type="button"
          class="btn btn-flat btn-sm btn-icon"
          data-act="refresh"
          data-id="${escapeAttr(orderId)}"
          title="Atualizar status"
          aria-label="Atualizar status"
          ${orderId ? '' : 'disabled'}
        >
          🔄
        </button>

        <button
          type="button"
          class="btn btn-flat btn-sm btn-icon"
          data-act="pdf"
          data-id="${escapeAttr(orderId)}"
          title="Baixar DANFE"
          aria-label="Baixar DANFE"
          ${orderId ? '' : 'disabled'}
        >
          🧾
        </button>

        <button
          type="button"
          class="btn btn-flat btn-sm btn-icon"
          data-act="xml"
          data-id="${escapeAttr(orderId)}"
          title="Baixar XML"
          aria-label="Baixar XML"
          ${orderId ? '' : 'disabled'}
        >
          📄
        </button>
      </td>
    `;

    tbody.appendChild(tr);

    /* ================================================================= */
    /* LINHA DE DETALHES                                                 */
    /* ================================================================= */

    const detailsTr = document.createElement('tr');

    detailsTr.classList.add('nfe-details-row');
    detailsTr.setAttribute(
      'data-order-id',
      rowKey,
    );

    detailsTr.style.display = 'none';

    detailsTr.innerHTML = `
      <td colspan="11">
        <div
          class="nfe-details-container"
          id="nfe-details-${escapeAttr(rowKey)}"
          data-loaded="0"
        ></div>
      </td>
    `;

    tbody.appendChild(detailsTr);
  }

  /* =================================================================== */
  /* RODAPÉ E ORDENAÇÃO                                                  */
  /* =================================================================== */

  updateTableFooter();
  updateSortIndicators();

  /* =================================================================== */
  /* AÇÕES DA TABELA                                                     */
  /* =================================================================== */

  tbody.onclick = async (event) => {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const button = target.closest(
      'button[data-act]',
    );

    if (!button || !tbody.contains(button)) {
      return;
    }

    const id = button.dataset.id || '';
    const action = button.dataset.act || '';

    try {
      /* =============================================================== */
      /* ABRIR PEDIDO                                                    */
      /* =============================================================== */

      if (action === 'viewOrder') {
        if (!id) return;

        window.location.href =
          `/public/orders/orders.html?orderId=${encodeURIComponent(id)}`;

        return;
      }

      /* =============================================================== */
      /* ATUALIZAR STATUS                                                */
      /* =============================================================== */

      if (action === 'refresh') {
        if (!id) return;

        await refreshRow(id, button);
        return;
      }

      /* =============================================================== */
      /* BAIXAR DANFE                                                    */
      /* =============================================================== */

      if (action === 'pdf') {
        if (!id) return;

        window.open(
          ROUTES.danfePdf(id),
          '_blank',
          'noopener,noreferrer',
        );

        return;
      }

      /* =============================================================== */
      /* BAIXAR XML                                                      */
      /* =============================================================== */

      if (action === 'xml') {
        if (!id) return;

        window.open(
          ROUTES.xml(id),
          '_blank',
          'noopener,noreferrer',
        );

        return;
      }

      /* =============================================================== */
      /* EXIBIR/OCULTAR DETALHES                                         */
      /* =============================================================== */

      if (action === 'toggleDetails') {
        const row = button.dataset.row || '';

        if (!row) return;

        await toggleDetailsRow(
          row,
          id,
          button,
        );
      }
    } catch (error) {
      console.error(
        `[NFES][RENDER] Erro ao executar ação "${action}":`,
        error,
      );

      alert(
        'Não foi possível executar esta ação. Tente novamente.',
      );
    }
  };
}