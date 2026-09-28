// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsKits.filters.js                                       ║
// ║ MODULE: Products Kits — Filters                                     ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { dom } from './productsKits.state.js';

export function readListFilters() {
  return {
    q: dom.searchKit?.value?.trim() || '',
    active: 'all',
  };
}
