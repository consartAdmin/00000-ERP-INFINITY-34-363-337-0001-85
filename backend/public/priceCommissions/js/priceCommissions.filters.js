// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.filters.js — Filtros | CONSART ERP                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { dom } from './priceCommissions.config.js';
import { state } from './priceCommissions.state.js';

export function buildFilterParams() {
  return {
    q: dom.fQ.value.trim(),
    price_id: dom.fPrice.value,
    seller_id: dom.fSeller.value,
    active: dom.fActive.value,
    date: dom.fDate.value,
    sort: state.sortColumn,
    dir: state.sortDirection,
    limit: state.limit,
    offset: state.offset
  };
}

export function clearFilters() {
  dom.fQ.value = '';
  dom.fPrice.value = '';
  dom.fSeller.value = '';
  dom.fActive.value = 'true';
  dom.fDate.value = '';
  dom.fDate.dispatchEvent(new Event('change', { bubbles: true }));
}
