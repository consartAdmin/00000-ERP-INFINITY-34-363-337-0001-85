// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ employees.state.js — State do módulo (CONSART ERP | ESM)                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
'use strict';

export const state = {
  list: [],
  selectedId: null,
  docs: [],
  lastQuery: '',
  includeInactive: false,

  // paginação (server-side: limit/offset)
  page: 1,
  pageSize: 20,
  total: 0,
};