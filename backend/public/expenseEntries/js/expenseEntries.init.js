// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.init.js — Initialization and events (CONSART ERP)    ║
// ║ Path: backend/public/expenseEntries/expenseEntries.init.js           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  cancelEntry,
  clearFilters,
  deleteEntry,
  importXmlFile,
  loadList,
  nextPage,
  openEdit,
  openNew,
  postEntry,
  previousPage,
  saveCurrent,
} from './expenseEntries.actions.js';
import { initImportFromDfe } from '/public/inboundInvoices/js/inboundInvoices.dfe.js';
import { apiBase } from './expenseEntries.config.js';
import { setupExpenseEntriesModal } from './expenseEntries.modal.js';
import { loadVehicleOptions } from './expenseEntries.form.js';
import { setupAttachments } from './expenseEntries.attachments.js';
import { state } from './expenseEntries.state.js';
import { $, toast } from './expenseEntries.utils.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';

// Período (emissão): <date-range-field> → hidden #fDateFrom / #fDateTo
function syncDateRange(event) {
  const field = $('#fDateRange');
  if (!field) return;
  const value = field.value || {};
  const detail = event?.detail || {};
  $('#fDateFrom').value = detail.startDate ?? detail.start_date ?? value.startDate ?? value.start_date ?? '';
  $('#fDateTo').value = detail.endDate ?? detail.end_date ?? value.endDate ?? value.end_date ?? '';
}

// Ordenação pelos cabeçalhos (o backend aceita "coluna direção")
function setupSorting() {
  const table = $('#expenseEntriesTable');
  if (!table) return;
  state.sortable = createSortableTable({
    table,
    defaultColumn: 'issueDate',
    defaultDirection: 'desc',
    allowedColumns: ['expenseEntryId', 'issueDate', 'documentType', 'documentNumber', 'supplierName', 'supplierDocument', 'totalExpenseValue', 'status'],
    onSort: async ({ column, direction }) => {
      $('#fOrderBy').value = `${column} ${direction}`;
      state.page = 1;
      await loadList();
    },
  });
}

function bindEvents() {
  $('#btnNew').addEventListener('click', openNew);
  $('#btnApply').addEventListener('click', () => {
    state.page = 1;
    loadList();
  });
  $('#btnClear').addEventListener('click', clearFilters);
  $('#btnPrevious').addEventListener('click', previousPage);
  $('#btnNext').addEventListener('click', nextPage);

  $('#pageSize').addEventListener('change', () => {
    state.page = 1;
    loadList();
  });

  $('#fDateRange')?.addEventListener('range-change', (event) => {
    syncDateRange(event);
    state.page = 1;
    loadList();
  });

  $('#fStatus').addEventListener('change', () => {
    state.page = 1;
    loadList();
  });

  $('#fQ').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    state.page = 1;
    loadList();
  });

  $('#form').addEventListener('submit', saveCurrent);

  $('#tbody').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button || button.disabled) return;

    const id = Number(button.dataset.id);
    if (button.dataset.act === 'post') postEntry(id);
    if (button.dataset.act === 'edit') openEdit(id);
    if (button.dataset.act === 'cancel') cancelEntry(id);
    if (button.dataset.act === 'delete') deleteEntry(id);
  });

  $('#btnImportXml').addEventListener('click', () => $('#xmlFile').click());
  $('#xmlFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importXmlFile(file);
  });
}

// Reaproveita o modal "Importar do DF-e" de Entradas Fiscais: lista a caixa
// de entrada DF-e, baixa o XML e entrega ao mesmo fluxo do "Importar XML".
function setupImportFromDfe() {
  initImportFromDfe({
    core: {
      toast: {
        error: (title, message) => toast(`${title}: ${message}`, 'error'),
      },
    },
    ROUTES: {
      nfeInboxList: () => `${apiBase}/api/nfe-inbox`,
      nfeInboxXmlById: (id) => `${apiBase}/api/nfe-inbox/${encodeURIComponent(String(id))}/xml`,
    },
    state: { actions: { importXmlFile } },
    refs: {
      btnImportFromDfe: $('#btnImportFromDfe'),
      dfeModal: $('#dfeImportModal'),
      dfeModalBackdrop: $('#dfeImportBackdrop'),
      dfeModalClose: $('#btnCloseDfeModal'),
      dfeSearch: $('#dfeSearch'),
      dfeOnlyPending: $('#dfeOnlyPending'),
      dfeReload: $('#btnReloadDfe'),
      dfeTbody: $('#dfeTableBody'),
      dfeStatus: $('#dfeStatus'),
    },
  });
}

export function initExpenseEntries() {
  setupExpenseEntriesModal();
  bindEvents();
  setupAttachments();
  setupSorting();
  setupImportFromDfe();
  loadVehicleOptions();
  loadList();
}

initExpenseEntries();
