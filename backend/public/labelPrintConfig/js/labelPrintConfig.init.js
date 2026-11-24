// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: labelPrintConfig.init.js                                      ║
// ║ MODULE: Parâmetros Etiqueta Localização — Inicialização             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import {
  loadModels, openModel, printTest, refreshTable, removeModel, saveModel,
} from './labelPrintConfig.actions.js';
import { FORM_FIELDS, fillSelectOptions, renderPreview } from './labelPrintConfig.form.js';
import { $, state } from './labelPrintConfig.utils.js';

function bindEvents() {
  $('#btnNovo')?.addEventListener('click', () => openModel());
  $('#btnRecarregar')?.addEventListener('click', loadModels);
  $('#btnLimparFiltros')?.addEventListener('click', () => {
    $('#busca').value = '';
    $('#filtroAtivo').value = 'true';
    state.search = '';
    state.status = 'true';
    refreshTable();
  });
  $('#busca')?.addEventListener('input', (event) => { state.search = event.target.value; refreshTable(); });
  $('#filtroAtivo')?.addEventListener('change', (event) => { state.status = event.target.value; refreshTable(); });

  $('#formModel')?.addEventListener('submit', saveModel);
  $('#btnExcluir')?.addEventListener('click', () => removeModel());
  $('#btnImprimirTeste')?.addEventListener('click', printTest);

  [...FORM_FIELDS, 'sampleBarcode', 'sampleLocation'].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', renderPreview);
    el?.addEventListener('change', renderPreview);
  });
}

async function boot() {
  try {
    Modal.setup();
    fillSelectOptions();
    bindEvents();
    createSortableTable({
      table: '#modelsTable',
      defaultColumn: state.sortColumn,
      defaultDirection: state.sortDirection,
      allowedColumns: ['name', 'size', 'paper', 'barcode_type', 'copies', 'is_active'],
      onSort: ({ column, direction }) => {
        state.sortColumn = column;
        state.sortDirection = direction;
        refreshTable();
      },
    });
    await loadModels();
  } catch (error) {
    console.error('[labelPrintConfig] Falha na inicialização:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
