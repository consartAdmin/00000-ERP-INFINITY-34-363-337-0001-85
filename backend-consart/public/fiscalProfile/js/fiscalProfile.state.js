// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.state.js                                         ║
// ║ MODULE: Fiscal Profile — State                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { DEFAULT_PAGE_SIZE } from './fiscalProfile.config.js';

export const state = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  allRows: [],
  filteredRows: [],
  sortColumn: 'profile_name',
  sortDirection: 'asc',
  filters: {
    query: '',
    active: 'true',
  },
  editingRow: null,
};
