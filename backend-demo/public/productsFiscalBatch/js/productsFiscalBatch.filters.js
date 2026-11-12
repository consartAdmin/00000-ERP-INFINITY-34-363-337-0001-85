// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsFiscalBatch.filters.js                               ║
// ║ MODULE: Products Fiscal Batch — Filters                            ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { dom, state } from './productsFiscalBatch.state.js';

export function syncFiltersFromDom() {
  state.search = (dom.searchInput?.value || '').trim();
  state.linkedFilter = dom.linkedFilter?.value || '';
}

export function clearFilters() {
  if (dom.searchInput) dom.searchInput.value = '';
  if (dom.linkedFilter) dom.linkedFilter.value = '';
  syncFiltersFromDom();
}

export function resetPage() {
  state.page = 1;
}

export function buildListParams() {
  return {
    page: state.page,
    pageSize: state.pageSize,
    search: state.search,
    linkedFilter: state.linkedFilter,
    sort: state.sortColumn,
    dir: state.sortDirection,
  };
}
