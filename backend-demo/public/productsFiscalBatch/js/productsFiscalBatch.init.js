// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsFiscalBatch.init.js                                  ║
// ║ MODULE: Products Fiscal Batch — Initialization                     ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';

import {
  applyBatchLink,
  loadProducts,
  openLinkModal,
  pickClassification,
  unlinkSelected,
} from './productsFiscalBatch.actions.js';
import {
  clearFilters,
  resetPage,
  syncFiltersFromDom,
} from './productsFiscalBatch.filters.js';
import { toggleAllVisibleProducts } from './productsFiscalBatch.products.js';
import { dom, state } from './productsFiscalBatch.state.js';
import { debounce } from './productsFiscalBatch.utils.js';

const SORT_COLUMNS = [
  'product_id', 'product_code', 'description', 'ncm_code', 'cest_code',
  'classification_name', 'profile_name', 'fiscal_is_linked',
];

function searchProducts() {
  syncFiltersFromDom();
  resetPage();
  return loadProducts();
}

function bindEvents() {
  const debouncedSearch = debounce(searchProducts, 500);

  dom.searchButton?.addEventListener('click', searchProducts);
  dom.reloadButton?.addEventListener('click', () => loadProducts());
  dom.clearButton?.addEventListener('click', () => {
    clearFilters();
    resetPage();
    loadProducts();
  });

  dom.searchInput?.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      searchProducts();
      return;
    }
    const value = dom.searchInput.value.trim();
    if (!value || value.length >= 3) debouncedSearch();
  });

  dom.linkedFilter?.addEventListener('change', searchProducts);

  dom.selectAll?.addEventListener('change', (event) => {
    toggleAllVisibleProducts(event.currentTarget.checked);
  });

  dom.previousButton?.addEventListener('click', () => {
    if (state.page <= 1 || state.loading) return;
    state.page -= 1;
    loadProducts();
  });

  dom.nextButton?.addEventListener('click', () => {
    if (state.page >= state.totalPages || state.loading) return;
    state.page += 1;
    loadProducts();
  });

  dom.pageSize?.addEventListener('change', () => {
    state.pageSize = Number(dom.pageSize.value) || 50;
    state.page = 1;
    loadProducts();
  });

  dom.openLinkButton?.addEventListener('click', () => openLinkModal());
  dom.unlinkSelectedButton?.addEventListener('click', unlinkSelected);
  dom.pickClassificationButton?.addEventListener('click', pickClassification);
  dom.applyButton?.addEventListener('click', applyBatchLink);
}

export async function bootstrapProductsFiscalBatch() {
  Modal.setup();
  state.pageSize = Number(dom.pageSize?.value) || state.pageSize;
  syncFiltersFromDom();
  bindEvents();

  if (dom.table) {
    createSortableTable({
      table: dom.table,
      defaultColumn: state.sortColumn,
      defaultDirection: state.sortDirection,
      allowedColumns: SORT_COLUMNS,
      onSort: async ({ column, direction }) => {
        state.sortColumn = column;
        state.sortDirection = direction;
        state.page = 1;
        await loadProducts({ force: true });
      },
    });
  }

  await loadProducts();
}

document.addEventListener('DOMContentLoaded', bootstrapProductsFiscalBatch, { once: true });
