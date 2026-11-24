// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: labelPrintConfig.render.js                                    ║
// ║ MODULE: Parâmetros Etiqueta Localização — Lista de modelos          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { BARCODE_TYPE_LABELS } from '/public/includes/js/locationLabelPrint.js';
import { $, escapeHtml, formatMm, state } from './labelPrintConfig.utils.js';

const PAPER_SHORT = { thermal: 'Térmica', a4: 'Folha A4' };

function sortValue(row, column) {
  if (column === 'size') return row.width_mm * 1000 + row.height_mm;
  if (column === 'copies') return row.copies;
  if (column === 'is_active') return (row.is_default ? 2 : 0) + (row.is_active ? 1 : 0);
  return String(row[column] ?? '').toLocaleLowerCase('pt-BR');
}

export function filteredRows() {
  const term = state.search.trim().toLocaleLowerCase('pt-BR');
  const dir = state.sortDirection === 'desc' ? -1 : 1;
  return state.models
    .filter((row) => (state.status === 'all' ? true : String(row.is_active) === state.status))
    .filter((row) => !term || `${row.name} ${row.description || ''}`.toLocaleLowerCase('pt-BR').includes(term))
    .sort((a, b) => {
      const va = sortValue(a, state.sortColumn);
      const vb = sortValue(b, state.sortColumn);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
}

function statusPills(row) {
  const pills = [];
  if (row.is_default) pills.push('<span class="summary-pill summary-pill--primary">Padrão</span>');
  pills.push(row.is_active
    ? '<span class="summary-pill summary-pill--success">Ativo</span>'
    : '<span class="summary-pill summary-pill--danger">Inativo</span>');
  return pills.join(' ');
}

export function renderTable(handlers) {
  const body = $('#bodyTable');
  const rows = filteredRows();
  body.innerHTML = '';

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7">Nenhum modelo encontrado.</td></tr>';
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const icons = [
      { action: 'edit', title: 'Editar', attrs: { 'data-action': 'edit' } },
      { action: 'copy', title: 'Duplicar', attrs: { 'data-action': 'copy' } },
    ];
    if (!row.is_default && row.is_active) {
      icons.push({ action: 'confirm', title: 'Definir como padrão', attrs: { 'data-action': 'default' } });
    }
    if (!row.is_default) {
      icons.push({ action: 'delete', title: 'Excluir', attrs: { 'data-action': 'delete' } });
    }

    tr.innerHTML = `
      <td class="td-left"><b>${escapeHtml(row.name)}</b>${row.description
        ? `<br><small>${escapeHtml(row.description)}</small>` : ''}</td>
      <td>${formatMm(row.width_mm)} × ${formatMm(row.height_mm)}</td>
      <td>${PAPER_SHORT[row.paper] || row.paper}</td>
      <td>${escapeHtml((BARCODE_TYPE_LABELS[row.barcode_type] || row.barcode_type).replace(' (recomendado)', ''))}</td>
      <td>${row.copies}</td>
      <td>${statusPills(row)}</td>
      <td>${actionIconsHtml(icons)}</td>`;

    tr.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      const action = button?.dataset.action || 'edit';
      if (button) event.stopPropagation();
      if (action === 'copy') handlers.onCopy(row);
      else if (action === 'default') handlers.onDefault(row);
      else if (action === 'delete') handlers.onDelete(row);
      else handlers.onEdit(row);
    });
    body.appendChild(tr);
  });

  const n = rows.length;
  $('#apTableInfo').textContent = `${n} ${n === 1 ? 'registro encontrado' : 'registros encontrados'}`;
  const def = state.models.find((row) => row.is_default);
  $('#sumDefault').textContent = `Padrão: ${def ? def.name : '—'}`;
  const active = state.models.filter((row) => row.is_active).length;
  $('#sumActive').textContent = `${active} ${active === 1 ? 'ativo' : 'ativos'}`;
}
