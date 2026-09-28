// ╔════════════════════════════════════════════════════════════╗
// ║ units.state.js — Estado do módulo Unidades                  ║
// ╚════════════════════════════════════════════════════════════╝

export const state = {
  rows: [],
  filteredRows: [],
  search: '',
  includeInactive: false,
  page: 1,
  pageSize: 20,
  editingId: null,
  loading: false,
  saving: false,
  deleting: false,
  refs: {},
};

export function setState(values = {}) {
  Object.assign(state, values);
}
