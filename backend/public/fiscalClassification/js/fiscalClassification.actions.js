// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.actions.js                              ║
// ║ MODULE: Fiscal Classification — Actions                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  createFiscalClassification,
  listAllFiscalClassifications,
  setFiscalClassificationActive,
  updateFiscalClassification,
} from './fiscalClassification.api.js';
import {
  applyFiltersAndSort,
  resetFiltersDom,
  syncFiltersFromDom,
} from './fiscalClassification.filters.js';
import { fillClassificationForm, readClassificationForm } from './fiscalClassification.form.js';
import { closeClassificationModal, openClassificationModal } from './fiscalClassification.modal.js';
import {
  renderClassificationTable,
  renderFooter,
  renderListError,
  renderListLoading,
} from './fiscalClassification.render.js';
import { state } from './fiscalClassification.state.js';
import { $, confirmCenter, logError, notify } from './fiscalClassification.utils.js';
import { validateFiscalClassification } from './fiscalClassification.validation.js';

const handlers = {
  onEdit: (row) => editClassification(row),
  onCopy: (row) => copyClassification(row),
  onToggle: (row) => toggleClassificationActive(row),
};

/** Redesenha a lista com os filtros/ordenação/página atuais (sem ir à API). */
export function refreshView() {
  applyFiltersAndSort();
  renderClassificationTable(handlers);
  renderFooter();
}

export async function loadClassifications() {
  renderListLoading();
  try {
    state.allRows = await listAllFiscalClassifications();
    refreshView();
  } catch (error) {
    logError('Erro ao carregar classificações', error);
    state.allRows = [];
    state.filteredRows = [];
    renderListError(error.message);
    renderFooter();
  }
}

export function applyFilters() {
  syncFiltersFromDom();
  refreshView();
}

export function clearFilters() {
  resetFiltersDom();
  applyFilters();
}

export function setSort({ column, direction }) {
  state.sortColumn = column;
  state.sortDirection = direction;
  state.page = 1;
  refreshView();
}

export function setPageSize(size) {
  state.pageSize = Number(size) || 50;
  state.page = 1;
  refreshView();
}

export function goToPreviousPage() {
  if (state.page <= 1) return;
  state.page -= 1;
  refreshView();
}

export function goToNextPage() {
  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
  if (state.page >= totalPages) return;
  state.page += 1;
  refreshView();
}

export function newClassification() {
  state.editingRow = null;
  fillClassificationForm(null);
  openClassificationModal();
}

export function editClassification(row) {
  state.editingRow = row;
  fillClassificationForm(row);
  openClassificationModal();
}

export function copyClassification(row) {
  state.editingRow = null;
  fillClassificationForm(row, { copy: true });
  openClassificationModal();
}

export async function toggleClassificationActive(row, { fromModal = false } = {}) {
  const id = row?.fiscal_classification_id;
  if (!id) return;
  const activate = row.is_active === false;
  const verb = activate ? 'Reativar' : 'Desativar';

  const ok = await confirmCenter(
    `${verb} a classificação "${row.classification_name}" (ID ${id})?` +
    (activate ? '' : ' Ela deixa de aparecer para novos produtos, mas os vínculos existentes são mantidos.'),
    { title: `${verb} classificação`, confirmLabel: verb },
  );
  if (!ok) return;

  try {
    await setFiscalClassificationActive(id, activate);
    if (fromModal) closeClassificationModal();
    await loadClassifications();
    notify(`Classificação ${activate ? 'reativada' : 'desativada'} com sucesso.`);
  } catch (error) {
    logError(`Erro ao ${verb.toLowerCase()} classificação`, error);
    notify(`Erro ao ${verb.toLowerCase()} classificação: ${error.message}`, 'error');
  }
}

export function toggleEditingActive() {
  if (state.editingRow) toggleClassificationActive(state.editingRow, { fromModal: true });
}

let saving = false;

export async function saveClassification(event) {
  event?.preventDefault();
  if (saving) return;

  const { id, payload } = readClassificationForm();
  const validation = validateFiscalClassification(payload);

  if (!validation.isValid) {
    const [first] = validation.errors;
    notify(first.message, 'warning');
    $(`#${first.field}`)?.focus();
    return;
  }

  const saveButton = $('#btnSalvar');
  saving = true;
  if (saveButton) saveButton.disabled = true;

  try {
    if (id) await updateFiscalClassification(id, payload);
    else await createFiscalClassification(payload);

    closeClassificationModal();
    await loadClassifications();
    notify(id ? 'Classificação fiscal atualizada.' : 'Classificação fiscal cadastrada.');
  } catch (error) {
    logError('Erro ao salvar classificação', error);
    notify(`Erro ao salvar classificação fiscal: ${error.message}`, 'error');
  } finally {
    saving = false;
    if (saveButton) saveButton.disabled = false;
  }
}
