export const API = Object.freeze({
  users: '/api/users',
  modules: '/api/module-system',
  userModules: '/api/user-modules',
});

export const elements = Object.freeze({
  selectUsuario: document.getElementById('selectUsuario'),
  modulosContainer: document.getElementById('modulosContainer'),
  listaModulos: document.getElementById('listaModulos'),
  permissoesForm: document.getElementById('permissoesForm'),
  campoBusca: document.getElementById('searchModulo'),
  btnSalvar: document.getElementById('btnSalvar'),
  btnRecarregar: document.getElementById('btnRecarregar'),
  msgSelecione: document.getElementById('msgSelecioneUsuario'),
  counterSelected: document.getElementById('counterSelected'),
  counterTotal: document.getElementById('counterTotal'),
  toggleSomenteMarcados: document.getElementById('toggleSomenteMarcados'),
  btnMarcarTodos: document.getElementById('btnMarcarTodos'),
  btnLimparTodos: document.getElementById('btnLimparTodos'),
});
