// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.render.js — Lista + rodapé | CONSART ERP           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { dom } from './priceCommissions.config.js';
import { state } from './priceCommissions.state.js';
import {
  escapeHtml,
  formatCommissionType,
  formatCommissionValue,
  formatDateBR
} from './priceCommissions.utils.js';

const COLSPAN = 9;

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function statusPill(active) {
  return active
    ? '<span class="summary-pill summary-pill--success">Ativo</span>'
    : '<span class="summary-pill summary-pill--danger">Inativo</span>';
}

export function renderFooter() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
  const page = Math.min(totalPages, Math.floor(state.offset / state.limit) + 1);

  dom.tableInfo.textContent = plural(state.total, 'registro encontrado', 'registros encontrados');
  dom.pageInfo.textContent = `Página ${page} de ${totalPages}`;
  dom.btnPrevious.disabled = page <= 1;
  dom.btnNext.disabled = page >= totalPages;
}

export function renderPriceCommissions() {
  renderFooter();

  if (!state.rows.length) {
    dom.tbody.innerHTML = `
      <tr>
        <td colspan="${COLSPAN}" class="td-center">Nenhuma comissão encontrada.</td>
      </tr>
    `;
    return;
  }

  dom.tbody.innerHTML = state.rows.map((row) => {
    const id = escapeHtml(row.commission_id);
    return `
    <tr data-id="${id}" title="Clique para editar">
      <td>${id}</td>
      <td class="td-left">${escapeHtml(row.price_name ?? row.price_id)}</td>
      <td class="td-left">${escapeHtml(row.seller_name ?? row.seller_id)}</td>
      <td>${escapeHtml(formatCommissionType(row.commission_type))}</td>
      <td class="td-right">${escapeHtml(formatCommissionValue(row))}</td>
      <td>${escapeHtml(formatDateBR(row.valid_from) || '—')}</td>
      <td>${row.valid_to ? escapeHtml(formatDateBR(row.valid_to)) : 'Sem data final'}</td>
      <td>${statusPill(row.active)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-action': 'edit', 'data-id': row.commission_id } },
        { action: 'copy', title: 'Duplicar (nova vigência)', attrs: { 'data-action': 'copy', 'data-id': row.commission_id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-action': 'delete', 'data-id': row.commission_id } }
      ])}</td>
    </tr>`;
  }).join('');
}
