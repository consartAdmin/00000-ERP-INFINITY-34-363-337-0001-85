// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.init.js                                          ║
// ║ MODULE: Fiscal Profile — Bootstrap                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { createSortableTable } from '/public/includes/js/sortableTable.js';
import {
  applyFilters,
  clearFilters,
  goToNextPage,
  goToPreviousPage,
  loadProfiles,
  newProfile,
  saveProfile,
  setPageSize,
  setSort,
  toggleEditingActive,
} from './fiscalProfile.actions.js';
import { bindDecimalInputs, getProfileForm } from './fiscalProfile.form.js';
import { configureModal } from './fiscalProfile.modal.js';
import { state } from './fiscalProfile.state.js';
import { $ } from './fiscalProfile.utils.js';

function bindEvents() {
  $('#btnNovo')?.addEventListener('click', newProfile);
  $('#btnRecarregar')?.addEventListener('click', loadProfiles);
  $('#btnBuscar')?.addEventListener('click', applyFilters);
  $('#btnLimparFiltros')?.addEventListener('click', clearFilters);
  $('#btnPrev')?.addEventListener('click', goToPreviousPage);
  $('#btnNext')?.addEventListener('click', goToNextPage);
  $('#pageSize')?.addEventListener('change', (event) => setPageSize(event.target.value));
  $('#btnToggleActive')?.addEventListener('click', toggleEditingActive);
  $('#filtroAtivo')?.addEventListener('change', applyFilters);
  getProfileForm()?.addEventListener('submit', saveProfile);

  $('#busca')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); applyFilters(); }
  });
}

async function bootFiscalProfile() {
  try {
    configureModal();
    bindDecimalInputs();
    bindEvents();

    createSortableTable({
      table: '#profileTable',
      defaultColumn: state.sortColumn,
      defaultDirection: state.sortDirection,
      allowedColumns: [
        'fiscal_profile_id', 'profile_name', 'icms_cst', 'mva_pct', 'pis_cst',
        'cofins_cst', 'ipi_rate', 'cfop_exit', 'is_active',
      ],
      onSort: setSort,
    });

    await loadProfiles();
  } catch (error) {
    console.error('[fiscalProfile] Falha na inicialização:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFiscalProfile, { once: true });
} else {
  bootFiscalProfile();
}
