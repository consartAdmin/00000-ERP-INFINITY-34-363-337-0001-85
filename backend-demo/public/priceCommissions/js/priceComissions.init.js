// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceComissions.init.js — Inicialização do módulo | CONSART ERP     ║
// ║ NOTE: Nome mantido conforme padrão solicitado pelo projeto          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js';
import {
  assertRequiredDom,
  dom,
  refreshDom,
  SORT_COLUMNS
} from './priceCommissions.config.js';
import {
  loadPriceCommissionCombos,
  searchPriceCommissions,
  setSort
} from './priceCommissions.actions.js';
import { bindPriceCommissionEvents } from './priceCommissions.events.js';
import { setupPriceCommissionModal } from './priceCommissions.modal.js';
import { state } from './priceCommissions.state.js';
import { showToast } from './priceCommissions.utils.js';

async function initPriceCommissions() {
  if (state.initialized) return;

  try {
    refreshDom();
    assertRequiredDom();

    // Datas em dd/mm/aaaa (o input original continua com aaaa-mm-dd)
    [dom.fDate, dom.valid_from, dom.valid_to].forEach(enhanceBrDateTime);

    setupPriceCommissionModal();
    bindPriceCommissionEvents();

    state.limit = Number(dom.pageSize.value) || state.limit;

    createSortableTable({
      table: dom.commissionsTable,
      defaultColumn: state.sortColumn,
      defaultDirection: state.sortDirection,
      allowedColumns: [...SORT_COLUMNS],
      onSort: setSort,
      onError: (error) => showToast(error?.message || 'Não foi possível ordenar a lista.')
    });

    await loadPriceCommissionCombos();
    await searchPriceCommissions({ resetOffset: true });

    state.initialized = true;
  } catch (error) {
    console.error('[priceCommissions] init', error);
    showToast(error.message || 'Erro ao iniciar o módulo de comissões.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPriceCommissions, { once: true });
} else {
  initPriceCommissions();
}

export { initPriceCommissions };
