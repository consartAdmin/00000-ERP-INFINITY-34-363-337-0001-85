// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.init.js — Bootstrap único do módulo             ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import '/public/includes/js/core.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import {
  applyFilters, clearFilters, consultCurrent, duplicateCurrent, goToNextPage, goToPreviousPage,
  loadList, newInutilizacao, setPageSize, setSort, submitInutilizacao,
} from './nfeInutilizarEvents.actions.js';
import { bindFormInputs, getForm } from './nfeInutilizarEvents.form.js';
import { configureModals } from './nfeInutilizarEvents.modal.js';
import { state } from './nfeInutilizarEvents.state.js';
import { $ } from './nfeInutilizarEvents.utils.js';

function bindEvents() {
  $('#btnNovo')?.addEventListener('click', () => newInutilizacao());
  $('#btnRecarregar')?.addEventListener('click', loadList);
  $('#btnBuscar')?.addEventListener('click', applyFilters);
  $('#btnLimparFiltros')?.addEventListener('click', clearFilters);
  $('#btnPrev')?.addEventListener('click', goToPreviousPage);
  $('#btnNext')?.addEventListener('click', goToNextPage);
  $('#pageSize')?.addEventListener('change', (event) => setPageSize(event.target.value));
  $('#btnConsultar')?.addEventListener('click', consultCurrent);
  $('#btnDuplicarFaixa')?.addEventListener('click', duplicateCurrent);
  getForm()?.addEventListener('submit', submitInutilizacao);

  ['#busca', '#filtroSerie', '#filtroAno', '#filtroNumero'].forEach((selector) => {
    $(selector)?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); applyFilters(); }
    });
  });
  ['#filtroStatus', '#filtroModelo'].forEach((selector) => {
    $(selector)?.addEventListener('change', applyFilters);
  });
}

async function bootNfeInutilizarEvents() {
  try {
    configureModals();
    bindFormInputs();
    bindEvents();

    createSortableTable({
      table: '#inutilizacaoTable',
      defaultColumn: state.sortColumn,
      defaultDirection: state.sortDirection,
      allowedColumns: ['id', 'status', 'companyCnpj', 'model', 'numberStart', 'year', 'message', 'createdAt'],
      onSort: setSort,
    });

    await loadList();
  } catch (error) {
    console.error('[nfeInutilizarEvents] Falha na inicialização:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootNfeInutilizarEvents, { once: true });
} else {
  bootNfeInutilizarEvents();
}
