// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.state.js — Estado do módulo                     ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const state = {
  allRows: [],
  filteredRows: [],
  filters: { query: '', status: '', model: '', serie: '', year: '', number: '' },
  sortColumn: 'id',
  sortDirection: 'desc',
  page: 1,
  pageSize: 50,
  current: null,
  submitting: false,
};
