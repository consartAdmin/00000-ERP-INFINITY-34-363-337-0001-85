// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.filters.js — Filtros e ordenação (na tela)      ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { state } from './nfeInutilizarEvents.state.js';
import { messageText, STATUS_INFO, statusKey } from './nfeInutilizarEvents.status.js';
import { $, normalize, onlyDigits, toInt } from './nfeInutilizarEvents.utils.js';

const FILTER_INPUTS = {
  query: '#busca', status: '#filtroStatus', model: '#filtroModelo',
  serie: '#filtroSerie', year: '#filtroAno', number: '#filtroNumero',
};

export function syncFiltersFromDom() {
  Object.entries(FILTER_INPUTS).forEach(([key, selector]) => {
    state.filters[key] = ($(selector)?.value || '').trim();
  });
  state.page = 1;
}

export function resetFiltersDom() {
  Object.values(FILTER_INPUTS).forEach((selector) => {
    const input = $(selector);
    if (input) input.value = '';
  });
}

function matches(row) {
  const { query, status, model, serie, year, number } = state.filters;

  if (status) {
    const key = statusKey(row);
    if (status === 'error' ? !['error', 'rejected'].includes(key) : key !== status) return false;
  }
  if (model && String(row.model ?? '') !== model) return false;
  if (serie && String(row.serie ?? '') !== String(toInt(serie))) return false;
  if (year && String(row.year ?? '') !== String(toInt(year))) return false;

  if (number) {
    const n = toInt(number);
    if (!(n >= Number(row.numberStart) && n <= Number(row.numberEnd))) return false;
  }

  if (query) {
    const haystack = normalize([
      row.id, row.protocol, messageText(row), row.justification,
      row.companyCnpj, onlyDigits(row.companyCnpj),
    ].join(' '));
    if (!normalize(query).split(/\s+/).every((term) => haystack.includes(term))) return false;
  }
  return true;
}

function sortValue(row, column) {
  switch (column) {
    case 'id':
    case 'numberStart':
    case 'year':
      return Number(row[column]) || 0;
    case 'model': return `${row.model ?? ''}-${String(row.serie ?? '').padStart(3, '0')}`;
    case 'status': return STATUS_INFO[statusKey(row)].order;
    case 'createdAt': return new Date(row.createdAt || 0).getTime() || 0;
    case 'message': return normalize(messageText(row));
    default: return normalize(row[column]);
  }
}

export function applyFiltersAndSort() {
  const factor = state.sortDirection === 'asc' ? 1 : -1;
  const column = state.sortColumn;

  state.filteredRows = state.allRows
    .filter(matches)
    .sort((a, b) => {
      const va = sortValue(a, column);
      const vb = sortValue(b, column);
      if (va < vb) return -1 * factor;
      if (va > vb) return 1 * factor;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });

  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
}

export function currentPageRows() {
  const start = (state.page - 1) * state.pageSize;
  return state.filteredRows.slice(start, start + state.pageSize);
}
