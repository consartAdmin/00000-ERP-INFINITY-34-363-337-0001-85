// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsFiscalBatch.render.js                                  ║
// ║ MODULE: Products Fiscal Batch — Render                               ║
// ║ CONSART ERP                                                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { createActionIcons } from '/public/includes/js/actionIcons.js';
import { dom, state } from './productsFiscalBatch.state.js';
import {
  isLinked,
  syncSelectAllState,
  toggleProductSelection,
  updateSelectionSummary,
} from './productsFiscalBatch.products.js';

const COLUMNS = 10;
const nf = new Intl.NumberFormat('pt-BR');

function createCell(value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  if (className) cell.className = className;
  return cell;
}

function createMessageRow(message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = COLUMNS;
  cell.textContent = message;
  row.appendChild(cell);
  return row;
}

function createStatusPill(linked) {
  const pill = document.createElement('span');
  pill.className = `summary-pill ${linked ? 'summary-pill--primary' : 'summary-pill--warning'}`;
  pill.textContent = linked ? 'Vinculado' : 'Sem vínculo';
  return pill;
}

/**
 * @param {{ onLink: Function, onUnlink: Function }} handlers
 */
export function renderProducts({ onLink, onUnlink }) {
  if (!dom.productsBody) return;

  dom.productsBody.replaceChildren();

  if (!state.products.length) {
    dom.productsBody.appendChild(createMessageRow(
      state.search ? 'Nenhum produto encontrado para a busca.' : 'Nenhum produto encontrado.'
    ));
    syncSelectAllState();
    updateSelectionSummary();
    return;
  }

  const fragment = document.createDocumentFragment();

  state.products.forEach((product) => {
    const code = String(product.product_code || '').trim();
    const linked = isLinked(product);
    const row = document.createElement('tr');

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.productCode = code;
    checkbox.checked = state.selected.has(code);
    checkbox.setAttribute('aria-label', `Selecionar produto ${code}`);
    checkbox.addEventListener('change', () => toggleProductSelection(product, checkbox.checked));
    checkboxCell.appendChild(checkbox);

    const statusCell = document.createElement('td');
    statusCell.appendChild(createStatusPill(linked));

    const actionsCell = document.createElement('td');
    actionsCell.appendChild(createActionIcons([
      {
        action: 'edit',
        title: linked ? 'Trocar classificação fiscal' : 'Vincular classificação fiscal',
        onClick: () => onLink(product),
      },
      {
        action: 'cancel',
        title: 'Desvincular',
        disabled: !linked,
        onClick: () => onUnlink([product]),
      },
    ]));

    row.append(
      checkboxCell,
      createCell(product.product_id),
      createCell(code),
      createCell(product.product_description || product.description, 'td-left'),
      createCell(product.ncm_code),
      createCell(product.cest_code),
      createCell(product.classification_name, 'td-left'),
      createCell(product.profile_name, 'td-left'),
      statusCell,
      actionsCell,
    );

    fragment.appendChild(row);
  });

  dom.productsBody.appendChild(fragment);
  syncSelectAllState();
  updateSelectionSummary();
}

export function renderLoadingRow() {
  if (!dom.productsBody) return;
  dom.productsBody.replaceChildren(createMessageRow('Carregando produtos...'));
}

export function renderPagination() {
  const first = state.total > 0 ? (state.page - 1) * state.pageSize + 1 : 0;
  const last = Math.min(state.page * state.pageSize, state.total);

  if (dom.pageInfo) dom.pageInfo.textContent = `Página ${state.page} de ${state.totalPages}`;

  if (dom.tableInfo) {
    dom.tableInfo.textContent = state.total > 0
      ? `${nf.format(first)}–${nf.format(last)} de ${nf.format(state.total)} registros`
      : '0 registros encontrados';
  }

  if (dom.sumLinked) dom.sumLinked.textContent = `${nf.format(state.linkedTotal)} vinculados`;
  if (dom.sumUnlinked) dom.sumUnlinked.textContent = `${nf.format(state.unlinkedTotal)} sem vínculo`;

  if (dom.previousButton) dom.previousButton.disabled = state.loading || state.page <= 1;
  if (dom.nextButton) dom.nextButton.disabled = state.loading || state.page >= state.totalPages;
}

export function setLoading(loading) {
  state.loading = loading;

  [dom.searchButton, dom.clearButton, dom.reloadButton, dom.previousButton,
    dom.nextButton, dom.pageSize, dom.linkedFilter].forEach((element) => {
    if (element) element.disabled = loading;
  });
}
