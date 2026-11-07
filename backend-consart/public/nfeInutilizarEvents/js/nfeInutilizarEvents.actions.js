// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.actions.js — Fluxo do módulo                    ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  consultarInutilizacao, createInutilizacao, getInutilizacaoById, listAllInutilizacoes,
} from './nfeInutilizarEvents.api.js';
import {
  applyFiltersAndSort, resetFiltersDom, syncFiltersFromDom,
} from './nfeInutilizarEvents.filters.js';
import { buildPayload, fillForm, validatePayload } from './nfeInutilizarEvents.form.js';
import {
  closeDetailsModal, closeNewModal, openDetailsModal, openNewModal,
} from './nfeInutilizarEvents.modal.js';
import {
  renderDetails, renderFooter, renderListError, renderListLoading, renderTable,
} from './nfeInutilizarEvents.render.js';
import { state } from './nfeInutilizarEvents.state.js';
import { messageText, statusInfo } from './nfeInutilizarEvents.status.js';
import {
  $, confirmCenter, formatCnpj, logError, notify, plural,
} from './nfeInutilizarEvents.utils.js';

const handlers = {
  onView: (row) => viewDetails(row),
  onConsult: (row, button) => consult(row, button),
  onCopy: (row) => newInutilizacao(row),
};

export function refreshView() {
  applyFiltersAndSort();
  renderTable(handlers);
  renderFooter();
}

export async function loadList() {
  renderListLoading();
  try {
    state.allRows = await listAllInutilizacoes();
    refreshView();
  } catch (error) {
    logError('loadList', error);
    state.allRows = [];
    state.filteredRows = [];
    renderListError(error?.message);
    renderFooter();
  }
}

/* Filtros / paginação / ordenação ----------------------------------- */
export function applyFilters() { syncFiltersFromDom(); refreshView(); }
export function clearFilters() { resetFiltersDom(); syncFiltersFromDom(); refreshView(); }
export function goToPreviousPage() { if (state.page > 1) { state.page -= 1; refreshView(); } }
export function goToNextPage() { state.page += 1; refreshView(); }
export function setPageSize(value) { state.pageSize = Number(value) || 50; state.page = 1; refreshView(); }
export function setSort({ column, direction }) {
  state.sortColumn = column;
  state.sortDirection = direction;
  refreshView();
}

/* Detalhes ----------------------------------------------------------- */
async function viewDetails(row) {
  state.current = row;
  renderDetails(row);
  openDetailsModal();
  try {
    const result = await getInutilizacaoById(row.id);
    if (result?.data && state.current?.id === row.id) {
      state.current = result.data;
      renderDetails(result.data);
    }
  } catch (error) {
    logError('viewDetails', error);
  }
}

/* Consulta na SEFAZ -------------------------------------------------- */
async function consult(row, button) {
  if (!row?.id) return;
  if (button) button.disabled = true;
  try {
    await consultarInutilizacao(row.id);
    await loadList();
    const updated = state.allRows.find((item) => item.id === row.id) || row;
    if (state.current?.id === row.id) renderDetails(updated);
    const info = statusInfo(updated);
    notify(`Inutilização #${row.id}: ${info.label}.\n${messageText(updated) || ''}`.trim(),
      info.label === 'Inutilizada' ? 'success' : 'info');
  } catch (error) {
    logError('consult', error);
    notify(error?.message || 'Falha ao consultar a SEFAZ.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export function consultCurrent() {
  if (state.current) consult(state.current, $('#btnConsultar'));
}

/* Nova inutilização -------------------------------------------------- */
export function newInutilizacao(base = null) {
  closeDetailsModal();
  const fallbackCnpj = state.allRows.find((row) => row.companyCnpj)?.companyCnpj || '';
  fillForm(base
    ? { ...base, numberStart: '', numberEnd: '', justification: base.justification }
    : { companyCnpj: fallbackCnpj });
  openNewModal();
}

export function duplicateCurrent() {
  if (state.current) newInutilizacao(state.current);
}

export async function submitInutilizacao(event) {
  event?.preventDefault();
  if (state.submitting) return;

  const payload = buildPayload();
  const errors = validatePayload(payload);
  if (errors.length) {
    notify(errors.join('\n'), 'warning');
    return;
  }

  const total = payload.numberEnd - payload.numberStart + 1;
  const range = total === 1 ? payload.numberStart : `${payload.numberStart} a ${payload.numberEnd}`;
  const ok = await confirmCenter(
    `Inutilizar ${plural(total, 'número', 'números')} (${range}) do modelo ${payload.model}, série ${payload.serie}/${payload.year}, `
    + `CNPJ ${formatCnpj(payload.companyCnpj)}?\n\nDepois de homologada pela SEFAZ, a inutilização não pode ser desfeita.`,
    { title: 'Enviar inutilização', confirmLabel: 'Enviar à SEFAZ' },
  );
  if (!ok) return;

  const button = $('#btnSubmit');
  state.submitting = true;
  if (button) { button.disabled = true; button.textContent = 'Enviando...'; }
  try {
    const result = await createInutilizacao(payload);
    closeNewModal();
    await loadList();
    notify(result?.message || 'Inutilização enviada à SEFAZ.', 'success');
  } catch (error) {
    logError('submit', error);
    notify(error?.message || 'Erro ao enviar a inutilização.', 'error');
  } finally {
    state.submitting = false;
    if (button) { button.disabled = false; button.textContent = 'Enviar à SEFAZ'; }
  }
}
