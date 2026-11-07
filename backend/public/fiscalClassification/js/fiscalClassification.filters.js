// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.filters.js                              ║
// ║ MODULE: Fiscal Classification — Filtros e ordenação (na tela)      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { getFiscalProfileName } from './fiscalClassification.profiles.js';
import { state } from './fiscalClassification.state.js';
import { $, onlyDigits } from './fiscalClassification.utils.js';

export function syncFiltersFromDom() {
  state.filters.query = ($('#busca')?.value || '').trim();
  state.filters.ncm = ($('#buscaNcm')?.value || '').trim();
  state.filters.cest = ($('#buscaCest')?.value || '').trim();
  state.filters.profileId = $('#filtroPerfil')?.value || '';
  state.filters.active = $('#filtroAtivo')?.value || 'all';
  state.page = 1;
}

export function resetFiltersDom() {
  ['#busca', '#buscaNcm', '#buscaCest'].forEach((selector) => {
    const input = $(selector);
    if (input) input.value = '';
  });
  if ($('#filtroPerfil')) $('#filtroPerfil').value = '';
  if ($('#filtroAtivo')) $('#filtroAtivo').value = 'true';
}

const normalize = (value) => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const profileNameOf = (row) => row.profile_name || getFiscalProfileName(row.fiscal_profile_id);

function matches(row) {
  const { query, ncm, cest, profileId, active } = state.filters;

  if (active !== 'all' && String(row.is_active !== false) !== active) return false;
  if (profileId && String(row.fiscal_profile_id ?? '') !== profileId) return false;

  const ncmDigits = onlyDigits(ncm);
  if (ncmDigits && !onlyDigits(row.ncm_code).startsWith(ncmDigits)) return false;

  const cestDigits = onlyDigits(cest);
  if (cestDigits && !onlyDigits(row.cest_code).startsWith(cestDigits)) return false;

  if (query) {
    const haystack = normalize([
      row.fiscal_classification_id, row.classification_name, row.description,
      row.ncm_code, onlyDigits(row.ncm_code), row.ncm_description,
      row.cest_code, row.cest_description, profileNameOf(row),
      row.ibscbs_cst, row.ibscbs_classification,
    ].join(' '));
    if (!normalize(query).split(/\s+/).every((term) => haystack.includes(term))) return false;
  }
  return true;
}

function sortValue(row, column) {
  switch (column) {
    case 'fiscal_classification_id': return Number(row.fiscal_classification_id) || 0;
    case 'is_active': return row.is_active === false ? 1 : 0;
    case 'ncm_code': return onlyDigits(row.ncm_code);
    case 'cest_code': return onlyDigits(row.cest_code);
    case 'ibscbs_cst': return `${row.ibscbs_cst ?? ''}${row.ibscbs_classification ?? ''}`;
    case 'profile_name': return normalize(profileNameOf(row));
    default: return normalize(row[column]);
  }
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
      // Vazios sempre no fim
      if (!va && vb) return 1;
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
