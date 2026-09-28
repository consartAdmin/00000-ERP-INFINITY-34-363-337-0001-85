import { carregarPermissoesUsuario } from './userModules.api.js';
import { API, elements } from './userModules.config.js';
import { showToast } from './userModules.modal.js';
import { state } from './userModules.state.js';
import { validarSalvamento } from './userModules.validation.js';

async function salvarCheck(check, usuarioId) {
  const moduloId = Number(check.dataset.moduleId);
  const querAcesso = check.checked;
  const permissao = state.permissoesAtuais.get(moduloId);

  if (permissao?.id) {
    if (!!permissao.pode_acessar === querAcesso) return;
    const res = await fetch(`${API.userModules}/${permissao.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pode_acessar: querAcesso }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(`Erro ao atualizar módulo ${moduloId}: ${data.error || `HTTP ${res.status}`}`);
    }
    return;
  }

  if (!querAcesso) return;
  const res = await fetch(API.userModules, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usuario_id: Number(usuarioId),
      modulo_id: moduloId,
      pode_acessar: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) return;

  const mensagem = data.error || `HTTP ${res.status}`;
  if (
    typeof mensagem === 'string' &&
    mensagem.toLowerCase().includes('já existe um vínculo')
  ) {
    console.warn(`[userModules] Vínculo já existe: usuário=${usuarioId}, módulo=${moduloId}.`);
    return;
  }
  throw new Error(`Erro ao criar permissão para módulo ${moduloId}: ${mensagem}`);
}

async function handleSubmit(event) {
  event.preventDefault();
  const usuarioId = elements.selectUsuario.value;
  const checks = [...elements.listaModulos.querySelectorAll(
    'input[type="checkbox"][data-module-id]'
  )];
  const erro = validarSalvamento(usuarioId, checks);
  if (erro) {
    showToast(erro, 'error');
    return;
  }

  elements.btnSalvar.disabled = true;
  const originalLabel = elements.btnSalvar.textContent;
  elements.btnSalvar.textContent = 'Salvando...';

  try {
    await Promise.all(checks.map((check) => salvarCheck(check, usuarioId)));
    await carregarPermissoesUsuario(usuarioId);
    showToast('Permissões salvas com sucesso!', 'success');
  } catch (error) {
    console.error('[ERRO SALVAR PERMISSÕES]', error);
    showToast('Erro ao salvar permissões. Verifique o console.', 'error');
  } finally {
    elements.btnSalvar.disabled = false;
    elements.btnSalvar.textContent = originalLabel;
  }
}

export function registrarFormulario() {
  elements.permissoesForm.addEventListener('submit', handleSubmit);
}
