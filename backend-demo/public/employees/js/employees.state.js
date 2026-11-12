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
  pageSize: 50,
  total: 0,

  // ordenação (sortableTable → backend) | '' = padrão (mais recentes primeiro)
  sort: '',
  dir: 'asc',
};