// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.render.js — List rendering (CONSART ERP)             ║
// ║ Path: backend/public/expenseEntries/expenseEntries.render.js         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { state } from './expenseEntries.state.js';
import {
  $,
  badge,
  canCancel,
  canDelete,
  canPost,
  dateBR,
  documentTypeLabel,
  escapeHtml,
  formatTaxId,
  moneyBR,
} from './expenseEntries.utils.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';

export function renderList(pageSizeFallback = 20) {
  const tbody = $('#tbody');
  const rows = state.rows || [];
  const total = Number(state.paging?.total || 0);
  const page = Number(state.paging?.page || state.page || 1);
  const pageSize = Number(state.paging?.pageSize || pageSizeFallback);
  const pageSum = rows.reduce(
    (sum, row) => sum + Number(row.totalExpenseValue || 0),
    0,
  );

  const kpiTotal = $('#kpiTotal');
  const kpiPageSum = $('#kpiPageSum');
  const tableInfo = $('#apTableInfo');

  if (kpiTotal) kpiTotal.textContent = String(total);
  if (kpiPageSum) kpiPageSum.textContent = moneyBR(pageSum);
  if (tableInfo) {
    tableInfo.textContent = `${total} registro${total === 1 ? '' : 's'} • ${moneyBR(pageSum)}`;
  }
  $('#pageInfo').textContent = `Página ${page} de ${Math.max(1, Math.ceil(total / pageSize))}`;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="ee-muted" style="padding:16px;">
          Nenhum registro encontrado.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const id = row.expenseEntryId;
    const document = `${row.documentNumber || '-'}${row.documentSeries ? `/${row.documentSeries}` : ''}`;
    const supplier = row.supplierName || '-';
    const supplierDocument = row.supplierDocument ? formatTaxId(row.supplierDocument) : '-';
    const type = documentTypeLabel(row.documentType);
    const isPosted = String(row.status || '').toUpperCase() === 'POSTED';
    const actions = actionIconsHtml([
      {
        action: 'confirm',
        title: canPost(row.status) ? 'Lançar (gera o Contas a Pagar)' : 'Já lançada',
        disabled: !canPost(row.status),
        attrs: { 'data-act': 'post', 'data-id': id },
      },
      {
        action: 'edit',
        title: isPosted ? 'Entrada lançada não pode ser editada' : 'Editar',
        disabled: isPosted,
        attrs: { 'data-act': 'edit', 'data-id': id },
      },
      {
        action: 'cancel',
        title: canCancel(row.status) ? 'Cancelar entrada' : 'Não pode ser cancelada',
        disabled: !canCancel(row.status),
        attrs: { 'data-act': 'cancel', 'data-id': id },
      },
      {
        action: 'delete',
        title: canDelete(row.status) ? 'Excluir' : 'Entrada lançada não pode ser excluída',
        disabled: !canDelete(row.status),
        attrs: { 'data-act': 'delete', 'data-id': id },
      },
    ]);

    return `
      <tr>
        <td>${id}</td>
        <td>${dateBR(row.issueDate)}</td>
        <td>${type}</td>
        <td>${escapeHtml(document)}</td>
        <td title="${escapeHtml(supplier)}">${escapeHtml(supplier)}</td>
        <td>${escapeHtml(supplierDocument)}</td>
        <td class="ee-right">${moneyBR(row.totalExpenseValue)}</td>
        <td>${badge(row.status)}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');
}
