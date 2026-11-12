// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.state.js                                ║
// ║ MODULE: Fiscal Classification — State                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { DEFAULT_PAGE_SIZE } from './fiscalClassification.config.js';

export const state = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  allRows: [],
  filteredRows: [],
  sortColumn: 'classification_name',
  sortDirection: 'asc',
  filters: {
    query: '',
    ncm: '',
    cest: '',
    profileId: '',
    active: 'true',
  },
  fiscalProfilesById: new Map(),
  editingRow: null,
};
