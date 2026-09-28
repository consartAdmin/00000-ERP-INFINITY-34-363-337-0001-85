import { loadModules } from './moduleSystem.actions.js';
import { elements } from './moduleSystem.config.js';
import { registrarFormulario, resetForm } from './moduleSystem.form.js';
import { validarElementos } from './moduleSystem.validation.js';

console.log('VERSAO_MODULESYSTEM 1.1');

function recarregarBuscaAtual() {
  return loadModules({ search: elements.searchInput.value.trim() });
}

function iniciar() {
  validarElementos(elements);
  registrarFormulario(recarregarBuscaAtual);
  elements.searchInput.addEventListener('input', recarregarBuscaAtual);
  resetForm();
  loadModules();
}

iniciar();
