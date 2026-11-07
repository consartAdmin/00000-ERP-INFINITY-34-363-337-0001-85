// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsFiscalBatch.products.js                              ║
// ║ MODULE: Products Fiscal Batch — Product Selection                  ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { dom, state } from './productsFiscalBatch.state.js';
import { queryAll } from './productsFiscalBatch.utils.js';

const ROW_CHECKBOX = '#pfb-products-body input[type="checkbox"][data-product-code]';

function productFromRow(product) {
  return {
    id: product.product_id,
    code: String(product.product_code || '').trim(),
    description: product.product_description || product.description || '',
    linked: isLinked(product),
  };
}

export function isLinked(product) {
  const value = product?.fiscal_is_linked;
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function updateSelectionSummary() {
  const count = state.selected.size;

  if (dom.selectedCount) dom.selectedCount.textContent = String(count);
  if (dom.openLinkButton) dom.openLinkButton.disabled = count === 0;

  if (dom.unlinkSelectedButton) {
    const anyLinked = [...state.selected.values()].some((item) => item.linked);
    dom.unlinkSelectedButton.disabled = !anyLinked;
  }

  if (dom.sumSelected) {
    dom.sumSelected.textContent = `${count} selecionado${count === 1 ? '' : 's'}`;
    // summary-pill ignora [hidden]: controlar por style.display
    dom.sumSelected.style.display = count ? '' : 'none';
  }
}

export function toggleProductSelection(product, checked) {
  const item = productFromRow(product);
  if (!item.code) return;

  if (checked) state.selected.set(item.code, item);
  else state.selected.delete(item.code);

  updateSelectionSummary();
  syncSelectAllState();
}

export function toggleAllVisibleProducts(checked) {
  const byCode = new Map(
    state.products.map((product) => [String(product.product_code || '').trim(), product])
  );

  queryAll(ROW_CHECKBOX).forEach((checkbox) => {
    const code = checkbox.dataset.productCode;
    checkbox.checked = checked;

    if (checked && byCode.has(code)) state.selected.set(code, productFromRow(byCode.get(code)));
    else state.selected.delete(code);
  });

  updateSelectionSummary();
  syncSelectAllState();
}

export function syncSelectAllState() {
  if (!dom.selectAll) return;

  const checkboxes = queryAll(ROW_CHECKBOX);
  const selectedOnPage = checkboxes.filter((checkbox) =>
    state.selected.has(checkbox.dataset.productCode)
  ).length;

  dom.selectAll.checked = checkboxes.length > 0 && selectedOnPage === checkboxes.length;
  dom.selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < checkboxes.length;
}

export function clearSelection() {
  state.selected.clear();
  queryAll(ROW_CHECKBOX).forEach((checkbox) => { checkbox.checked = false; });
  updateSelectionSummary();
  syncSelectAllState();
}

/** Atualiza a situação (vinculado ou não) dos itens já selecionados após recarregar. */
export function refreshSelectedFromRows() {
  state.products.forEach((product) => {
    const code = String(product.product_code || '').trim();
    if (state.selected.has(code)) state.selected.set(code, productFromRow(product));
  });
}
