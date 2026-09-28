import { registrarAcoes } from './userModules.actions.js';
import { carregarUsuarios } from './userModules.api.js';
import { elements } from './userModules.config.js';
import { registrarFormulario } from './userModules.form.js';
import { aplicarFiltrosUI, carregarModulosParaUsuario } from './userModules.render.js';

console.log('VERSAO_USERMODULES 1.5');

function validarElementosObrigatorios() {
  const obrigatorios = [
    'selectUsuario',
    'modulosContainer',
    'listaModulos',
    'permissoesForm',
    'campoBusca',
    'btnSalvar',
    'btnRecarregar',
    'msgSelecione',
  ];
  const ausentes = obrigatorios.filter((nome) => !elements[nome]);
  if (ausentes.length) {
    throw new Error(`Elementos HTML ausentes: ${ausentes.join(', ')}`);
  }
}

function iniciar() {
  validarElementosObrigatorios();
  registrarAcoes();
  registrarFormulario();

  elements.campoBusca.addEventListener('input', aplicarFiltrosUI);
  elements.toggleSomenteMarcados?.addEventListener('change', aplicarFiltrosUI);
  elements.selectUsuario.addEventListener('change', () =>
    carregarModulosParaUsuario(elements.selectUsuario.value)
  );
  elements.btnRecarregar.addEventListener('click', () => {
    const userId = elements.selectUsuario.value;
    return userId ? carregarModulosParaUsuario(userId) : carregarUsuarios();
  });

  carregarUsuarios();
}

iniciar();
