export const state = {
  modulosBaseCache: [],
  permissoesAtuais: new Map(),
};

export function setModulosBaseCache(modulos) {
  state.modulosBaseCache = modulos;
}

export function resetPermissoes() {
  state.permissoesAtuais = new Map();
}
