// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.render.js                               ║
// ║ MODULE: Fiscal Classification — Render (lista + rodapé)            ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { currentPageRows, profileNameOf } from './fiscalClassification.filters.js';
import { state } from './fiscalClassification.state.js';
import {
  $, escapeHtml, formatCest, formatDecimal, formatNcm,
} from './fiscalClassification.utils.js';

const COLUMNS = 8;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const hasIbsCbs = (row) => !!(row.ibscbs_cst || row.ibscbs_classification);

function messageRow(text) {
  return `<tr><td colspan="${COLUMNS}">${escapeHtml(text)}</td></tr>`;
}

function codeCell(code, description) {
  if (!code) return '—';
  return `${escapeHtml(code)}${description ? `<br><small>${escapeHtml(description)}</small>` : ''}`;
}

function ibsCbsCell(row) {
  if (!hasIbsCbs(row)) return '—<br><small>não informado</small>';
  const rates = `IBS ${formatDecimal(row.ibs_uf_rate)}% · CBS ${formatDecimal(row.cbs_rate)}%`;
  return `${escapeHtml(row.ibscbs_cst || '—')} / ${escapeHtml(row.ibscbs_classification || '—')}<br><small>${rates}</small>`;
}

function statusPill(row) {
  return row.is_active === false
    ? '<span class="summary-pill summary-pill--danger">Inativa</span>'
    : '<span class="summary-pill summary-pill--success">Ativa</span>';
}

export function renderClassificationTable(handlers) {
  const tableBody = $('#bodyTable');
  if (!tableBody) return;

  const rows = currentPageRows();
  if (!rows.length) {
    tableBody.innerHTML = messageRow(
      state.allRows.length ? 'Nenhuma classificação encontrada com esses filtros.' : 'Nenhuma classificação cadastrada.',
    );
    return;
  }

  tableBody.innerHTML = '';
  rows.forEach((row) => {
    const active = row.is_active !== false;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.fiscal_classification_id ?? '')}</td>
      <td class="td-left"><b>${escapeHtml(row.classification_name || '(sem nome)')}</b>${row.description
        ? `<br><small>${escapeHtml(row.description)}</small>` : ''}</td>
      <td>${codeCell(formatNcm(row.ncm_code), row.ncm_description)}</td>
      <td>${codeCell(formatCest(row.cest_code), row.cest_description)}</td>
      <td>${ibsCbsCell(row)}</td>
      <td class="td-left"><small>${escapeHtml(profileNameOf(row) || '—')}</small></td>
      <td>${statusPill(row)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-action': 'edit' } },
        { action: 'copy', title: 'Duplicar', attrs: { 'data-action': 'copy' } },
        active
          ? { action: 'pause', title: 'Desativar', attrs: { 'data-action': 'toggle' } }
          : { action: 'play', title: 'Reativar', attrs: { 'data-action': 'toggle' } },
      ])}</td>`;

    tr.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      const action = button?.dataset.action || 'edit';
      if (button) event.stopPropagation();
      if (action === 'copy') handlers.onCopy(row);
      else if (action === 'toggle') handlers.onToggle(row);
      else handlers.onEdit(row);
    });
    tableBody.appendChild(tr);
  });
}

export function renderFooter() {
  const total = state.filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const start = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const end = Math.min(total, state.page * state.pageSize);

  const info = $('#apTableInfo');
  if (info) {
    info.textContent = total > state.pageSize
      ? `${start}–${end} de ${plural(total, 'registro', 'registros')}`
      : plural(total, 'registro encontrado', 'registros encontrados');
  }

  const pageInfo = $('#paginacaoInfo');
  if (pageInfo) pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  if ($('#btnPrev')) $('#btnPrev').disabled = state.page <= 1;
  if ($('#btnNext')) $('#btnNext').disabled = state.page >= totalPages;

  // Selos: contam todas as classificações (não só o filtro de status)
  const activeCount = state.allRows.filter((row) => row.is_active !== false).length;
  const inactiveCount = state.allRows.length - activeCount;
  const missingIbs = state.allRows.filter((row) => row.is_active !== false && !hasIbsCbs(row)).length;

  const sumActive = $('#sumActive');
  if (sumActive) sumActive.textContent = plural(activeCount, 'ativa', 'ativas');
  const sumInactive = $('#sumInactive');
  if (sumInactive) sumInactive.textContent = plural(inactiveCount, 'inativa', 'inativas');
  // summary-pill ignora [hidden]: usar style.display
  const sumMissing = $('#sumMissingIbs');
  if (sumMissing) {
    sumMissing.textContent = `${missingIbs} ativa${missingIbs === 1 ? '' : 's'} sem IBS/CBS`;
    sumMissing.style.display = missingIbs ? '' : 'none';
  }
}

export function renderListLoading() {
  const tableBody = $('#bodyTable');
  if (tableBody) tableBody.innerHTML = messageRow('Carregando classificações...');
}

export function renderListError(message) {
  const tableBody = $('#bodyTable');
  if (tableBody) tableBody.innerHTML = messageRow(`Erro ao carregar classificações fiscais: ${message || ''}`);
}
