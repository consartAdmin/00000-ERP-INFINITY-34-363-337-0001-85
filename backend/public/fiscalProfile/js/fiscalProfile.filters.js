// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.filters.js                                       ║
// ║ MODULE: Fiscal Profile — Filtros e ordenação (na tela)           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { state } from './fiscalProfile.state.js';
import { $, toNumber } from './fiscalProfile.utils.js';

export function syncFiltersFromDom() {
  state.filters.query = ($('#busca')?.value || '').trim();
  state.filters.active = $('#filtroAtivo')?.value || 'all';
  state.page = 1;
}

export function resetFiltersDom() {
  if ($('#busca')) $('#busca').value = '';
  if ($('#filtroAtivo')) $('#filtroAtivo').value = 'true';
}

const normalize = (value) => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const hasSt = (row) => row.mva_pct != null || row.icms_st_rate != null;

function matches(row) {
  const { query, active } = state.filters;
  if (active !== 'all' && String(row.is_active !== false) !== active) return false;

  if (query) {
    const haystack = normalize([
      row.fiscal_profile_id, row.profile_name, row.description, row.benefit_code,
      row.icms_cst, row.pis_cst, row.cofins_cst, row.cfop_entry, row.cfop_exit,
    ].join(' '));
    if (!normalize(query).split(/\s+/).every((term) => haystack.includes(term))) return false;
  }
  return true;
}

const NUMERIC = new Set(['fiscal_profile_id', 'mva_pct', 'ipi_rate']);

function sortValue(row, column) {
  if (column === 'is_active') return row.is_active === false ? 1 : 0;
  if (NUMERIC.has(column)) return row[column] == null ? -1 : toNumber(row[column]);
  if (column === 'cfop_exit') return `${row.cfop_exit ?? ''}${row.cfop_entry ?? ''}`;
  return normalize(row[column]);
}

/** Aplica filtros + ordenação em state.allRows → state.filteredRows. */
export function applyFiltersAndSort() {
  const factor = state.sortDirection === 'desc' ? -1 : 1;
  const column = state.sortColumn;

  state.filteredRows = state.allRows
    .filter(matches)
    .sort((a, b) => {
      const va = sortValue(a, column);
      const vb = sortValue(b, column);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      if (!va && vb) return 1; // vazios sempre no fim
      if (va && !vb) return -1;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * factor;
    });

  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;
}

export function currentPageRows() {
  const start = (state.page - 1) * state.pageSize;
  return state.filteredRows.slice(start, start + state.pageSize);
}
