// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.init.js                                 ║
// ║ MODULE: Fiscal Classification — Bootstrap                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { createSortableTable } from '/public/includes/js/sortableTable.js';
import {
  applyFilters,
  clearFilters,
  goToNextPage,
  goToPreviousPage,
  loadClassifications,
  newClassification,
  saveClassification,
  setPageSize,
  setSort,
  toggleEditingActive,
} from './fiscalClassification.actions.js';
import {
  applyRates2026,
  bindDecimalInputs,
  getClassificationForm,
} from './fiscalClassification.form.js';
import { configureModal } from './fiscalClassification.modal.js';
import { loadFiscalProfiles } from './fiscalClassification.profiles.js';
import { state } from './fiscalClassification.state.js';
import { $ } from './fiscalClassification.utils.js';

function bindEvents() {
  $('#btnNovo')?.addEventListener('click', newClassification);
  $('#btnRecarregar')?.addEventListener('click', loadClassifications);
  $('#btnBuscar')?.addEventListener('click', applyFilters);
  $('#btnLimparFiltros')?.addEventListener('click', clearFilters);
  $('#btnPrev')?.addEventListener('click', goToPreviousPage);
  $('#btnNext')?.addEventListener('click', goToNextPage);
  $('#pageSize')?.addEventListener('change', (event) => setPageSize(event.target.value));
  $('#btnAplicar2026')?.addEventListener('click', applyRates2026);
  $('#btnToggleActive')?.addEventListener('click', toggleEditingActive);
  getClassificationForm()?.addEventListener('submit', saveClassification);

  ['#busca', '#buscaNcm', '#buscaCest'].forEach((selector) => {
    $(selector)?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); applyFilters(); }
    });
  });
  ['#filtroPerfil', '#filtroAtivo'].forEach((selector) => {
    $(selector)?.addEventListener('change', applyFilters);
  });
}

async function bootFiscalClassification() {
  try {
    configureModal();
    bindDecimalInputs();
    bindEvents();

    createSortableTable({
      table: '#classificationTable',
      defaultColumn: state.sortColumn,
      defaultDirection: state.sortDirection,
      allowedColumns: [
        'fiscal_classification_id', 'classification_name', 'ncm_code', 'cest_code',
        'ibscbs_cst', 'profile_name', 'is_active',
      ],
      onSort: setSort,
    });

    await loadFiscalProfiles();
    await loadClassifications();
  } catch (error) {
    console.error('[fiscalClassification] Falha na inicialização:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFiscalClassification, { once: true });
} else {
  bootFiscalClassification();
}
