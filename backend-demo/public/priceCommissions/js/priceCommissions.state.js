// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.state.js — Estado do módulo | CONSART ERP          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { DEFAULT_LIMIT } from './priceCommissions.config.js';

export const state = {
  prices: [],
  sellers: [],
  rows: [],
  total: 0,
  limit: DEFAULT_LIMIT,
  offset: 0,
  sortColumn: 'price_name',
  sortDirection: 'asc',
  initialized: false
};
