import { salvarModulo } from './moduleSystem.api.js';
import { elements } from './moduleSystem.config.js';
import { showToast } from './moduleSystem.modal.js';
import { setEditingId } from './moduleSystem.state.js';
import { validarModulo } from './moduleSystem.validation.js';
import { moduloEstaAtivo } from './moduleSystem.utils.js';

export function resetForm() {
  elements.moduleId.value = '';
  elements.name.value = '';
  elements.path.value = '';
  elements.isActive.checked = true;
  elements.formTitle.textContent = '➕ Novo Módulo';
  elements.btnSave.textContent = '💾 Salvar';
  setEditingId(null);
}

export function fillForm(modulo) {
  elements.moduleId.value = modulo.id;
  elements.name.value = modulo.name || '';
  elements.path.value = modulo.path || '';
  elements.isActive.checked = moduloEstaAtivo(modulo);
  elements.formTitle.textContent = '✏️ Editar Módulo';
  elements.btnSave.textContent = '💾 Atualizar';
  setEditingId(modulo.id);
}

function obterDadosFormulario() {
  return {
    id: elements.moduleId.value.trim(),
    name: elements.name.value.trim(),
    path: elements.path.value.trim(),
    isActive: elements.isActive.checked,
  };
}

export function registrarFormulario(recarregar) {
  elements.moduleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dados = obterDadosFormulario();
    const erro = validarModulo(dados);
    if (erro) {
      showToast(erro, 'warn');
      return;
    }

    elements.btnSave.disabled = true;
    elements.btnSave.textContent = dados.id ? 'Atualizando...' : 'Salvando...';
    try {
      await salvarModulo(dados);
      showToast(
        dados.id ? 'Módulo atualizado com sucesso!' : 'Módulo criado com sucesso!',
        'success'
      );
      resetForm();
      await recarregar();
    } catch (error) {
      console.error('[moduleSystem] erro ao salvar módulo:', error);
      showToast('Erro ao salvar módulo.', 'error');
    } finally {
      elements.btnSave.disabled = false;
      elements.btnSave.textContent = elements.moduleId.value ? '💾 Atualizar' : '💾 Salvar';
    }
  });

  elements.btnClear.addEventListener('click', resetForm);
}
