// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.render.js                                        ║
// ║ MODULE: Fiscal Profile — Render (lista + rodapé)                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { ORIGINS } from './fiscalProfile.config.js';
import { currentPageRows, hasSt } from './fiscalProfile.filters.js';
import { state } from './fiscalProfile.state.js';
import { $, escapeHtml, formatPercent, toNumber } from './fiscalProfile.utils.js';

const COLUMNS = 10;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function messageRow(text) {
  return `<tr><td colspan="${COLUMNS}">${escapeHtml(text)}</td></tr>`;
}

function cstCell(cst, rate) {
  if (!cst && !toNumber(rate)) return '—';
  return `${escapeHtml(cst || '—')} · ${formatPercent(rate)}`;
}

function icmsCell(row) {
  const base = toNumber(row.icms_base_pct, 100);
  const origin = row.origin_code == null || row.origin_code === ''
    ? 'origem não informada'
    : `origem ${escapeHtml(row.origin_code)} – ${escapeHtml(ORIGINS[row.origin_code] || '')}`;
  const extra = [base !== 100 ? `base ${formatPercent(base)}` : '', origin].filter(Boolean).join(' · ');
  return `${cstCell(row.icms_cst, row.icms_rate)}<br><small>${extra}</small>`;
}

function stCell(row) {
  if (!hasSt(row)) return '—';
  return `MVA ${formatPercent(row.mva_pct)}<br><small>alíq. ST ${formatPercent(row.icms_st_rate)}</small>`;
}

function statusPill(row) {
  return row.is_active === false
    ? '<span class="summary-pill summary-pill--danger summary-pill--sm">Inativo</span>'
    : '<span class="summary-pill summary-pill--success summary-pill--sm">Ativo</span>';
}

export function renderProfileTable(handlers) {
  const tableBody = $('#bodyTable');
  if (!tableBody) return;

  const rows = currentPageRows();
  if (!rows.length) {
    tableBody.innerHTML = messageRow(
      state.allRows.length ? 'Nenhum perfil fiscal encontrado com esses filtros.' : 'Nenhum perfil fiscal cadastrado.',
    );
    return;
  }

  tableBody.innerHTML = '';
  rows.forEach((row) => {
    const active = row.is_active !== false;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.fiscal_profile_id ?? '')}</td>
      <td class="td-left"><b>${escapeHtml(row.profile_name || '(sem nome)')}</b>${row.description
        ? `<br><small>${escapeHtml(row.description)}</small>` : ''}</td>
      <td>${icmsCell(row)}</td>
      <td>${stCell(row)}</td>
      <td>${cstCell(row.pis_cst, row.pis_rate)}</td>
      <td>${cstCell(row.cofins_cst, row.cofins_rate)}</td>
      <td>${toNumber(row.ipi_rate) ? formatPercent(row.ipi_rate) : '—'}</td>
      <td>${escapeHtml(row.cfop_entry || '—')} / ${escapeHtml(row.cfop_exit || '—')}</td>
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

  // Selos: contam todos os perfis (não só o filtro de status)
  const activeRows = state.allRows.filter((row) => row.is_active !== false);
  const withSt = activeRows.filter(hasSt).length;

  const sumActive = $('#sumActive');
  if (sumActive) sumActive.textContent = plural(activeRows.length, 'ativo', 'ativos');
  const sumInactive = $('#sumInactive');
  if (sumInactive) sumInactive.textContent = plural(state.allRows.length - activeRows.length, 'inativo', 'inativos');
  // summary-pill ignora [hidden]: usar style.display
  const sumSt = $('#sumWithSt');
  if (sumSt) {
    sumSt.textContent = `${withSt} com ICMS-ST`;
    sumSt.style.display = withSt ? '' : 'none';
  }
}

export function renderListLoading() {
  const tableBody = $('#bodyTable');
  if (tableBody) tableBody.innerHTML = messageRow('Carregando perfis fiscais...');
}

export function renderListError(message) {
  const tableBody = $('#bodyTable');
  if (tableBody) tableBody.innerHTML = messageRow(`Erro ao carregar perfis fiscais: ${message || ''}`);
}
