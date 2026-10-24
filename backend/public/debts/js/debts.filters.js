// js/debts.summary.js
'use strict';

import { els } from './debts.config.js';
import { state } from './debts.state.js';
import { API_BASE, fetchJSON } from './debts.api.js';
import { buildQuery, formatMoney, showToast } from './debts.utils.js';
import { loadDebts } from './debts.render.js';

export function getFilters() {
  const selectedStatus = els.status?.value || '';

  // "Em Aberto" = tudo com saldo (inclui Parcial/Vencido);
  // "Vencido" = vencimento passado com saldo (o status gravado pode estar desatualizado).
  const onlyOpen = selectedStatus === 'EM_ABERTO';
  const onlyOverdue = selectedStatus === 'VENCIDO';

  return {
    q: els.q?.value.trim() || '',
    status: onlyOpen || onlyOverdue ? '' : selectedStatus,
    debt_type: els.debt_type?.value || '',
    creditor_name: els.creditor_name?.value.trim() || '',
    due_date_from: els.filterDueDateRange?.value?.startDate || '',
    due_date_to: els.filterDueDateRange?.value?.endDate || '',
    only_overdue: onlyOverdue,
    only_open: onlyOpen,
    page: state.page,
    limit: state.limit
  };
}

export async function loadSummary() {
  try {
    const filters = getFilters();

    delete filters.page;
    delete filters.limit;

    const qs = buildQuery(filters);
    const data = await fetchJSON(`${API_BASE}/debts/summary?${qs}`);

    const summary = data?.summary || {};

    els.sumTotalOpen.textContent = formatMoney(summary.total_open);
    els.sumTotalOverdue.textContent = formatMoney(summary.total_overdue);
    els.sumTotalPaid.textContent = formatMoney(summary.total_paid);
  } catch (error) {
    console.error('[debts] loadSummary', error);
    showToast(error.message || 'Erro ao carregar resumo.', 'error');
  }
}

export async function refreshAll() {
  await Promise.all([loadSummary(), loadDebts()]);
}
