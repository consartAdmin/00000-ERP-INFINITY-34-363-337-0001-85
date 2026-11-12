// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.actions.js — Ações do módulo | CONSART ERP         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { dom, SORT_COLUMNS } from './priceCommissions.config.js';
import { state } from './priceCommissions.state.js';
import {
  createPriceCommission,
  deletePriceCommission,
  listPriceCommissions,
  listPrices,
  listSellers,
  updatePriceCommission
} from './priceCommissions.api.js';
import { buildFilterParams, clearFilters } from './priceCommissions.filters.js';
import { getCurrentCommissionId, getFormPayload } from './priceCommissions.form.js';
import {
  closePriceCommissionModal,
  openPriceCommissionModal
} from './priceCommissions.modal.js';
import { renderPriceCommissions } from './priceCommissions.render.js';
import { validatePriceCommission } from './priceCommissions.validation.js';
import { confirmCenter, fillSelect, notify } from './priceCommissions.utils.js';

export function findCommissionById(id) {
  return state.rows.find(
    (row) => Number(row.commission_id) === Number(id)
  ) || null;
}

export async function loadPriceCommissionCombos() {
  const [pricesData, sellersData] = await Promise.all([
    listPrices(),
    listSellers()
  ]);

  state.prices = pricesData.rows || [];
  state.sellers = sellersData.rows || [];

  fillSelect(dom.fPrice, state.prices, { valueKey: 'price_id', labelKey: 'name' });
  fillSelect(dom.fSeller, state.sellers, { valueKey: 'id', labelKey: 'name' });
}

/** Carrega a página atual (resetOffset = volta para a página 1). */
export async function searchPriceCommissions({ resetOffset = false } = {}) {
  if (resetOffset) state.offset = 0;

  const data = await listPriceCommissions(buildFilterParams());
  state.rows = data.rows || [];
  state.total = Number(data.total ?? state.rows.length) || 0;

  // Se a página ficou vazia (ex.: depois de excluir), volta uma página.
  if (!state.rows.length && state.offset > 0 && state.total > 0) {
    state.offset = Math.max(0, state.offset - state.limit);
    return searchPriceCommissions();
  }

  renderPriceCommissions();
}

export async function clearAndSearchPriceCommissions() {
  clearFilters();
  await searchPriceCommissions({ resetOffset: true });
}

export async function goToPage(step) {
  const next = state.offset + step * state.limit;
  if (next < 0 || next >= Math.max(state.total, 1)) return;
  state.offset = next;
  await searchPriceCommissions();
}

export async function changePageSize(value) {
  state.limit = Number(value) || 50;
  await searchPriceCommissions({ resetOffset: true });
}

export async function setSort({ column, direction }) {
  if (!SORT_COLUMNS.includes(column)) return;
  state.sortColumn = column;
  state.sortDirection = direction === 'desc' ? 'desc' : 'asc';
  await searchPriceCommissions({ resetOffset: true });
}

export async function savePriceCommission(event) {
  event?.preventDefault?.();

  const id = getCurrentCommissionId();
  const payload = getFormPayload();

  validatePriceCommission(payload);

  if (id) {
    await updatePriceCommission(id, payload);
    notify('Comissão atualizada com sucesso.');
  } else {
    await createPriceCommission(payload);
    notify('Comissão cadastrada com sucesso.');
  }

  closePriceCommissionModal();
  await searchPriceCommissions();
}

async function removeById(id) {
  const row = findCommissionById(id);
  const label = row
    ? `a comissão #${id} (${row.price_name ?? row.price_id} · ${row.seller_name ?? row.seller_id})`
    : `a comissão #${id}`;

  const confirmed = await confirmCenter(`Confirma excluir ${label}?`, { title: 'Excluir comissão' });
  if (!confirmed) return false;

  await deletePriceCommission(id);
  await searchPriceCommissions();
  notify('Comissão excluída com sucesso.');
  return true;
}

export async function removeCurrentPriceCommission() {
  const id = getCurrentCommissionId();
  if (!id) return;
  if (await removeById(id)) closePriceCommissionModal();
}

export async function removePriceCommission(id) {
  await removeById(id);
}

export function newPriceCommission() {
  openPriceCommissionModal(null);
}

export function editPriceCommission(id) {
  const row = findCommissionById(id);
  if (!row) return notify('Comissão não encontrada.', 'warning');
  openPriceCommissionModal(row);
}

export function duplicatePriceCommission(id) {
  const row = findCommissionById(id);
  if (!row) return notify('Comissão não encontrada.', 'warning');
  openPriceCommissionModal(row, { duplicate: true });
}
