// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inventory.logs.js — Logs (auditoria)                                  ║
// ║ CONSART ERP | Inventário                                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { apiGet } from './inventory.api.js';
import { INVENTORY_API_BASE } from './inventory.config.js';
import { state } from './inventory.state.js';
import { fmtQty3, escapeHtml } from './inventory.utils.js';
import { logError } from './inventory.config.js';

const ACTION_LABELS = {
  CREATE: 'Criação', CREATED: 'Criação', INSERT: 'Inclusão', ADD_ITEM: 'Item incluído', ITEM_ADDED: 'Item incluído',
  UPDATE: 'Alteração', UPDATED: 'Alteração', UPDATE_ITEM: 'Item alterado', ITEM_UPDATED: 'Item alterado',
  DELETE: 'Exclusão', DELETED: 'Exclusão', DELETE_ITEM: 'Item excluído', ITEM_DELETED: 'Item excluído',
  COUNT: 'Contagem', COUNTED: 'Contagem', FINALIZE: 'Finalização', FINALIZED: 'Finalização',
  ADJUST: 'Ajuste de estoque', ADJUSTED: 'Ajuste de estoque', REOPEN: 'Estorno', REOPENED: 'Estorno',
  IMPORT: 'Importação', IMPORT_XLS: 'Importação XLS',
  FINALIZE_ADJUST: 'Finalização (ajuste de estoque)', REOPEN_RESTORE_FROM_ITEMS: 'Estorno (estoque restaurado)',
};

function actionLabel(action) {
  const key = String(action || '').toUpperCase();
  return ACTION_LABELS[key] || action || '';
}

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Filtros da tela (data, usuário, produto) aplicados sobre os registros do inventário */
function filterLogs(els, rows) {
  const from = els.logDateFrom?.value || '';
  const to = els.logDateTo?.value || '';
  const user = norm(els.logUserName?.value);
  const product = norm(els.logProductCode?.value);

  return rows.filter((r) => {
    const day = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    if (user && !norm(r.user_name).includes(user)) return false;
    if (product && !norm(`${r.product_code ?? ''} ${r.product_name ?? ''}`).includes(product)) return false;
    return true;
  });
}

export function renderLogsTable(els) {
  const tbody = els.logsTbody;
  if (!tbody) return;

  const all = Array.isArray(state.logsData) ? state.logsData : [];
  const rows = filterLogs(els, all);

  const info = document.getElementById('logsInfo');
  if (info) info.textContent = rows.length === all.length
    ? `${all.length} ${all.length === 1 ? 'registro' : 'registros'}`
    : `${rows.length} de ${all.length} registros`;

  const title = document.getElementById('logsTitle');
  if (title) {
    const code = state.currentInventory?.code;
    title.textContent = code ? `Registros (Auditoria) — ${code}` : 'Registros (Auditoria)';
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty-state">${
      state.currentInventory?.inventory_id ? 'Nenhum registro encontrado.' : 'Abra um inventário para ver os registros dele.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((logRow) => {
    const dt = logRow.created_at ? new Date(logRow.created_at) : null;
    const dtText = dt ? `${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR')}` : '';
    return `
      <tr>
        <td>${dtText}</td>
        <td class="td-left">${escapeHtml(logRow.user_name || '')}</td>
        <td>${escapeHtml(actionLabel(logRow.action))}</td>
        <td>${escapeHtml(logRow.product_code || '')}</td>
        <td class="td-left">${escapeHtml(logRow.product_name || '')}</td>
        <td>${escapeHtml(logRow.unit || '')}</td>
        <td class="col-number">${logRow.system_qty_before != null ? fmtQty3(logRow.system_qty_before) : ''}</td>
        <td class="col-number">${logRow.counted_qty != null ? fmtQty3(logRow.counted_qty) : ''}</td>
        <td class="col-number">${logRow.system_qty_after != null ? fmtQty3(logRow.system_qty_after) : ''}</td>
      </tr>`;
  }).join('');
}

export function clearLogFilters(els) {
  ['logDateFrom', 'logDateTo', 'logUserName', 'logProductCode'].forEach((k) => {
    if (els[k]) els[k].value = '';
  });
  renderLogsTable(els);
}

export async function loadLogs(els) {
  try {
    if (!state.currentInventory?.inventory_id) {
      state.logsData = [];
      renderLogsTable(els);
      return;
    }

    const url = `${INVENTORY_API_BASE}/${state.currentInventory.inventory_id}/logs`;
    const data = await apiGet(url);

    state.logsData = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
    renderLogsTable(els);
  } catch (err) {
    logError('Erro em loadLogs:', err);
    showCenterModal({ variant: 'error', title: 'Erro ao carregar auditoria', message: String(err.message || err) });
  }
}