import { loadModules, registrarLote, registrarPaginacao } from './moduleSystem.actions.js';
import { elements } from './moduleSystem.config.js';
import { registrarFormulario, resetForm } from './moduleSystem.form.js';
import { registrarSeletorIcones } from './moduleSystem.iconPicker.js';
import { validarElementos } from './moduleSystem.validation.js';

console.log('VERSAO_MODULESYSTEM 1.7');

function iniciar() {
  validarElementos(elements);
  registrarFormulario(loadModules);
  registrarSeletorIcones();
  registrarPaginacao();
  registrarLote();
  resetForm();
  loadModules();
}

iniciar();
