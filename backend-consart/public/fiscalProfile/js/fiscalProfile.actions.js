// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.actions.js                                       ║
// ║ MODULE: Fiscal Profile — Actions                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  createFiscalProfile,
  listAllFiscalProfiles,
  setFiscalProfileActive,
  updateFiscalProfile,
} from './fiscalProfile.api.js';
import { applyFiltersAndSort, resetFiltersDom, syncFiltersFromDom } from './fiscalProfile.filters.js';
import { fillProfileForm, readProfileForm } from './fiscalProfile.form.js';
import { closeProfileModal, openProfileModal } from './fiscalProfile.modal.js';
import {
  renderFooter, renderListError, renderListLoading, renderProfileTable,
} from './fiscalProfile.render.js';
import { state } from './fiscalProfile.state.js';
import { $, confirmCenter, logError, notify } from './fiscalProfile.utils.js';
import { validateFiscalProfile } from './fiscalProfile.validation.js';

const handlers = {
  onEdit: (row) => editProfile(row),
  onCopy: (row) => copyProfile(row),
  onToggle: (row) => toggleProfileActive(row),
};

/** Redesenha a lista com os filtros/ordenação/página atuais (sem ir à API). */
export function refreshView() {
  applyFiltersAndSort();
  renderProfileTable(handlers);
  renderFooter();
}

export async function loadProfiles() {
  renderListLoading();
  try {
    state.allRows = await listAllFiscalProfiles();
    refreshView();
  } catch (error) {
    logError('Erro ao carregar perfis', error);
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

export function newProfile() {
  state.editingRow = null;
  fillProfileForm(null);
  openProfileModal();
}

export function editProfile(row) {
  state.editingRow = row;
  fillProfileForm(row);
  openProfileModal();
}

export function copyProfile(row) {
  state.editingRow = null;
  fillProfileForm(row, { copy: true });
  openProfileModal();
}

export async function toggleProfileActive(row, { fromModal = false } = {}) {
  const id = row?.fiscal_profile_id;
  if (!id) return;
  const activate = row.is_active === false;
  const verb = activate ? 'Reativar' : 'Desativar';

  const ok = await confirmCenter(
    `${verb} o perfil fiscal "${row.profile_name}" (ID ${id})?` +
    (activate ? '' : ' Ele deixa de aparecer para novas classificações, mas os vínculos existentes são mantidos.'),
    { title: `${verb} perfil fiscal`, confirmLabel: verb },
  );
  if (!ok) return;

  try {
    await setFiscalProfileActive(id, activate);
    if (fromModal) closeProfileModal();
    await loadProfiles();
    notify(`Perfil fiscal ${activate ? 'reativado' : 'desativado'} com sucesso.`);
  } catch (error) {
    logError(`Erro ao ${verb.toLowerCase()} perfil`, error);
    notify(`Erro ao ${verb.toLowerCase()} perfil fiscal: ${error.message}`, 'error');
  }
}

export function toggleEditingActive() {
  if (state.editingRow) toggleProfileActive(state.editingRow, { fromModal: true });
}

let saving = false;

export async function saveProfile(event) {
  event?.preventDefault();
  if (saving) return;

  const { id, payload } = readProfileForm();
  const validation = validateFiscalProfile(payload);

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
    if (id) await updateFiscalProfile(id, payload);
    else await createFiscalProfile(payload);

    closeProfileModal();
    await loadProfiles();
    notify(id ? 'Perfil fiscal atualizado.' : 'Perfil fiscal cadastrado.');
  } catch (error) {
    logError('Erro ao salvar perfil', error);
    notify(`Erro ao salvar perfil fiscal: ${error.message}`, 'error');
  } finally {
    saving = false;
    if (saveButton) saveButton.disabled = false;
  }
}
