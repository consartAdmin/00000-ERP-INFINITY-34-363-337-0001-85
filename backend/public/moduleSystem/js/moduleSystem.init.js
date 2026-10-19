import { loadModules, registrarLote, registrarPaginacao } from './moduleSystem.actions.js';
import { elements } from './moduleSystem.config.js';
import { registrarFormulario, resetForm } from './moduleSystem.form.js';
import { validarElementos } from './moduleSystem.validation.js';

console.log('VERSAO_MODULESYSTEM 1.5');

function iniciar() {
  validarElementos(elements);
  registrarFormulario(loadModules);
  registrarPaginacao();
  registrarLote();
  resetForm();
  loadModules();
}

iniciar();
