import { alterarEmLote, alterarStatusModulo, buscarModulos, excluirModulo } from './moduleSystem.api.js';
import { elements } from './moduleSystem.config.js';
import { atualizarOpcoesPai, fillForm, resetForm } from './moduleSystem.form.js';
import { confirmarAlteracaoEmLote, confirmarExclusao, showToast } from './moduleSystem.modal.js';
import { renderModulesTable } from './moduleSystem.render.js';
import { state, setModules, setPage, setPageSize } from './moduleSystem.state.js';
import { aplicarFiltros, caminhoNoMenu, filtrarModulos, moduloEstaAtivo } from './moduleSystem.utils.js';

const handlers = {
  editar: fillForm,
  alternar: toggleActive,
  excluir: removeModule,
  selecionado: (modulo) => state.selected.has(String(modulo.id)),
  marcar: (modulo, marcado) => {
    if (marcado) state.selected.add(String(modulo.id));
    else state.selected.delete(String(modulo.id));
    renderCurrentPage();
  },
};

/** Barra de alteração em lote + checkbox "marcar todos" do cabeçalho */
function atualizarSelecao() {
  // Remove da seleção o que foi excluído
  const existentes = new Set(state.modules.map((m) => String(m.id)));
  [...state.selected].forEach((id) => { if (!existentes.has(id)) state.selected.delete(id); });

  const total = state.selected.size;
  elements.batchBar.hidden = total === 0;
  elements.batchCount.textContent = `${total} selecionado${total === 1 ? '' : 's'}`;

  const marcadosNoFiltro = state.filtered.filter((m) => state.selected.has(String(m.id))).length;
  elements.selectAll.checked = state.filtered.length > 0 && marcadosNoFiltro === state.filtered.length;
  elements.selectAll.indeterminate = marcadosNoFiltro > 0 && marcadosNoFiltro < state.filtered.length;
}

async function aplicarEmLote(alteracoes, descricao) {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (!(await confirmarAlteracaoEmLote(ids.length, descricao))) return;
  try {
    const { updated } = await alterarEmLote(ids, alteracoes);
    showToast(`${updated} módulo${updated === 1 ? '' : 's'} alterado${updated === 1 ? '' : 's'}.`, 'success');
    state.selected.clear();
    await loadModules();
  } catch (error) {
    console.error('[moduleSystem] erro na alteração em lote:', error);
    showToast(error.message || 'Erro ao alterar os módulos.', 'error');
  }
}

export function registrarLote() {
  elements.selectAll.addEventListener('change', () => {
    state.filtered.forEach((m) => {
      if (elements.selectAll.checked) state.selected.add(String(m.id));
      else state.selected.delete(String(m.id));
    });
    renderCurrentPage();
  });
  elements.btnBatchCompany.addEventListener('click', () => {
    const company = elements.batchCompany.value;
    const texto = elements.batchCompany.selectedOptions[0]?.textContent.replace(/^\S+\s/, '') || '';
    aplicarEmLote({ company: company || null }, `mudar a empresa para "${texto}"`);
  });
  elements.btnBatchActivate.addEventListener('click', () => aplicarEmLote({ isActive: true }, 'ativar'));
  elements.btnBatchDeactivate.addEventListener('click', () => aplicarEmLote({ isActive: false }, 'desativar'));
  elements.btnBatchClear.addEventListener('click', () => {
    state.selected.clear();
    renderCurrentPage();
  });
}

/** Preenche o filtro "Menu pai" com os dropdowns e submenus */
function atualizarFiltroPai() {
  const atual = elements.filterParent.value;
  const opcoes = state.modules
    .filter((m) => m.menu_type === 'dropdown' || m.menu_type === 'submenu')
    .map((m) => ({ id: String(m.id), texto: caminhoNoMenu(m, state.modules) }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'pt-BR'));

  elements.filterParent.replaceChildren();
  [{ id: '', texto: 'Todos' }, { id: 'root', texto: '(Topo do menu)' }, ...opcoes]
    .forEach(({ id, texto }) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = texto;
      elements.filterParent.appendChild(option);
    });
  elements.filterParent.value = [...elements.filterParent.options].some((o) => o.value === atual) ? atual : '';
}

/** Desenha a página atual da tabela (filtro + paginação) e o rodapé */
export function renderCurrentPage() {
  const filtrados = aplicarFiltros(
    filtrarModulos(state.modules, elements.searchInput.value.trim()),
    {
      status: elements.filterStatus.value,
      type: elements.filterType.value,
      parentId: elements.filterParent.value,
      visibility: elements.filterVisibility.value,
      company: elements.filterCompany.value,
    }
  );
  state.filtered = filtrados;
  const totalPages = Math.max(1, Math.ceil(filtrados.length / state.pageSize));
  if (state.page > totalPages) setPage(totalPages);
  const inicio = (state.page - 1) * state.pageSize;

  renderModulesTable(filtrados.slice(inicio, inicio + state.pageSize), handlers, state.modules);

  elements.tableInfo.textContent = `${filtrados.length} Registro${filtrados.length === 1 ? '' : 's'}`;
  elements.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  elements.btnPreviousPage.disabled = state.page <= 1;
  elements.btnNextPage.disabled = state.page >= totalPages;
  atualizarSelecao();
}

export function registrarPaginacao() {
  elements.btnPreviousPage.addEventListener('click', () => {
    if (state.page > 1) { setPage(state.page - 1); renderCurrentPage(); }
  });
  elements.btnNextPage.addEventListener('click', () => {
    setPage(state.page + 1);
    renderCurrentPage();
  });
  elements.rowsPerPage.addEventListener('change', () => {
    setPageSize(Number(elements.rowsPerPage.value) || 50);
    renderCurrentPage();
  });
  // Busca e filtros rodam no navegador e voltam para a primeira página
  const aoFiltrar = () => {
    setPage(1);
    renderCurrentPage();
  };
  elements.searchInput.addEventListener('input', aoFiltrar);
  [elements.filterStatus, elements.filterType, elements.filterParent, elements.filterCompany, elements.filterVisibility]
    .forEach((select) => select.addEventListener('change', aoFiltrar));
  elements.btnClearFilters.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.filterStatus.value = '';
    elements.filterType.value = '';
    elements.filterParent.value = '';
    elements.filterCompany.value = '';
    elements.filterVisibility.value = '';
    aoFiltrar();
  });
  setPageSize(Number(elements.rowsPerPage.value) || 50);
}

// Carrega todos os módulos (a lista completa alimenta o select "Menu pai")
// e mostra a página atual da tabela.
export async function loadModules() {
  try {
    setModules(await buscarModulos());
    atualizarOpcoesPai();
    atualizarFiltroPai();
    renderCurrentPage();
  } catch (error) {
    console.error('[moduleSystem] erro ao carregar módulos:', error);
    showToast('Erro ao carregar módulos.', 'error');
  }
}

export async function toggleActive(modulo) {
  try {
    await alterarStatusModulo(modulo.id, !moduloEstaAtivo(modulo));
    await loadModules();
  } catch (error) {
    console.error('[moduleSystem] erro ao alterar ativo:', error);
    showToast('Erro ao alterar status do módulo.', 'error');
  }
}

export async function removeModule(modulo) {
  if (!(await confirmarExclusao(modulo.name))) return;

  try {
    await excluirModulo(modulo.id);
    showToast('Módulo excluído com sucesso.', 'success');
    if (
      elements.moduleId.value &&
      String(elements.moduleId.value) === String(modulo.id)
    ) {
      resetForm();
    }
    await loadModules();
  } catch (error) {
    console.error('[moduleSystem] erro ao excluir módulo:', error);
    showToast(error.message || 'Erro ao excluir módulo.', 'error');
  }
}
