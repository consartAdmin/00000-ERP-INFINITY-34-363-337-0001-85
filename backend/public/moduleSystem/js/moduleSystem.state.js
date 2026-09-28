export const state = {
  modules: [],
  editingId: null,
};

export function setModules(modules) {
  state.modules = modules;
}

export function setEditingId(id) {
  state.editingId = id || null;
}
