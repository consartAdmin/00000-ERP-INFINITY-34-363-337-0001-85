export const state = {
  modules: [],
  editingId: null,
  page: 1,
  pageSize: 50,
  selected: new Set(), // ids marcados para alteração em lote
  filtered: [],        // módulos que passam nos filtros (todas as páginas)
};

export function setPage(page) {
  state.page = page;
}

export function setPageSize(size) {
  state.pageSize = size;
  state.page = 1;
}

export function setModules(modules) {
  state.modules = modules;
}

export function setEditingId(id) {
  state.editingId = id || null;
}
