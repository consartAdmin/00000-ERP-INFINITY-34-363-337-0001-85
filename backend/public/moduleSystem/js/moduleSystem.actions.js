import { alterarStatusModulo, buscarModulos, excluirModulo } from './moduleSystem.api.js';
import { elements } from './moduleSystem.config.js';
import { fillForm, resetForm } from './moduleSystem.form.js';
import { confirmarExclusao, showToast } from './moduleSystem.modal.js';
import { renderModulesTable } from './moduleSystem.render.js';
import { setModules } from './moduleSystem.state.js';
import { moduloEstaAtivo } from './moduleSystem.utils.js';

export async function loadModules({ search } = {}) {
  try {
    const modules = await buscarModulos(search);
    setModules(modules);
    renderModulesTable(modules, {
      editar: fillForm,
      alternar: toggleActive,
      excluir: removeModule,
    });
  } catch (error) {
    console.error('[moduleSystem] erro ao carregar módulos:', error);
    showToast('Erro ao carregar módulos.', 'error');
  }
}

export async function toggleActive(modulo) {
  try {
    await alterarStatusModulo(modulo.id, !moduloEstaAtivo(modulo));
    await loadModules({ search: elements.searchInput.value.trim() });
  } catch (error) {
    console.error('[moduleSystem] erro ao alterar ativo:', error);
    showToast('Erro ao alterar status do módulo.', 'error');
  }
}

export async function removeModule(modulo) {
  if (!confirmarExclusao(modulo.name)) return;

  try {
    await excluirModulo(modulo.id);
    showToast('Módulo excluído com sucesso.', 'success');
    if (
      elements.moduleId.value &&
      String(elements.moduleId.value) === String(modulo.id)
    ) {
      resetForm();
    }
    await loadModules({ search: elements.searchInput.value.trim() });
  } catch (error) {
    console.error('[moduleSystem] erro ao excluir módulo:', error);
    showToast('Erro ao excluir módulo.', 'error');
  }
}
