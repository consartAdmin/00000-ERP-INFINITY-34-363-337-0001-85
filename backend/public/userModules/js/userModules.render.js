import { elements } from './userModules.config.js';
import { carregarPermissoesUsuario, carregarTodosModulos } from './userModules.api.js';
import { showToast } from './userModules.modal.js';
import { state } from './userModules.state.js';
import { getModuloKey } from './userModules.utils.js';

export function atualizarContadores() {
  const checks = elements.listaModulos.querySelectorAll(
    'input[type="checkbox"][data-module-id]'
  );
  const total = checks.length;
  const selecionados = [...checks].filter((check) => check.checked).length;

  if (elements.counterSelected) {
    elements.counterSelected.textContent =
      `${selecionados} selecionado${selecionados === 1 ? '' : 's'}`;
  }
  if (elements.counterTotal) {
    elements.counterTotal.textContent =
      `de ${total} módulo${total === 1 ? '' : 's'}`;
  }
}

export function aplicarFiltrosUI() {
  const termo = elements.campoBusca.value.toLowerCase().trim();
  const apenasMarcados = elements.toggleSomenteMarcados?.checked ?? false;

  elements.listaModulos.querySelectorAll('.modulo-item').forEach((item) => {
    const check = item.querySelector('input[type="checkbox"][data-module-id]');
    if (!check) return;
    const atendeTexto = !termo || item.textContent.toLowerCase().includes(termo);
    const atendeMarcacao = !apenasMarcados || check.checked;
    item.style.display = atendeTexto && atendeMarcacao ? '' : 'none';
  });
}

function criarCardModulo(modulo) {
  const moduloId = getModuloKey(modulo);
  if (!Number.isFinite(moduloId)) return null;

  const canAccess = !!state.permissoesAtuais.get(moduloId)?.pode_acessar;
  const item = document.createElement('div');
  item.className = `modulo-item${canAccess ? ' modulo-item--checked' : ''}`;
  item.dataset.moduleId = String(moduloId);

  const label = document.createElement('label');
  label.className = 'modulo-label';
  label.htmlFor = `modulo_${moduloId}`;

  const topRow = document.createElement('div');
  topRow.className = 'modulo-top-row';
  const tag = document.createElement('span');
  tag.className = 'modulo-tag';
  tag.textContent = 'Módulo';

  const toggleWrap = document.createElement('span');
  toggleWrap.className = 'modulo-checkbox';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `modulo_${moduloId}`;
  checkbox.dataset.moduleId = String(moduloId);
  checkbox.checked = canAccess;
  const status = document.createElement('span');
  status.textContent = canAccess ? 'Permitido' : 'Bloqueado';
  toggleWrap.append(checkbox, status);
  topRow.append(tag, toggleWrap);

  const nome = document.createElement('span');
  nome.className = 'modulo-nome';
  nome.textContent = modulo.name || modulo.nome || `Módulo #${moduloId}`;
  const descricao = document.createElement('span');
  descricao.className = 'modulo-descricao';
  descricao.textContent = modulo.description || modulo.descricao || '';
  label.append(topRow, nome);
  if (descricao.textContent) label.appendChild(descricao);
  item.appendChild(label);

  checkbox.addEventListener('change', () => {
    item.classList.toggle('modulo-item--checked', checkbox.checked);
    status.textContent = checkbox.checked ? 'Permitido' : 'Bloqueado';
    atualizarContadores();
    aplicarFiltrosUI();
  });
  return item;
}

export async function carregarModulosParaUsuario(userId) {
  if (!userId) {
    elements.modulosContainer.classList.add('hidden');
    elements.listaModulos.innerHTML = '';
    elements.msgSelecione.classList.remove('hidden');
    atualizarContadores();
    return;
  }

  elements.btnSalvar.disabled = true;
  elements.listaModulos.innerHTML = '<p>Carregando módulos...</p>';
  elements.msgSelecione.classList.add('hidden');

  try {
    const [modulos] = await Promise.all([
      carregarTodosModulos(),
      carregarPermissoesUsuario(userId),
    ]);
    elements.listaModulos.innerHTML = '';
    modulos.forEach((modulo) => {
      const card = criarCardModulo(modulo);
      if (card) elements.listaModulos.appendChild(card);
    });
    elements.modulosContainer.classList.remove('hidden');
    atualizarContadores();
    aplicarFiltrosUI();
  } catch (error) {
    console.error('[ERRO MÓDULOS]', error);
    showToast('Erro ao carregar módulos.', 'error');
  } finally {
    elements.btnSalvar.disabled = false;
  }
}
