// ╔══════════════════════════════════════════════════════════════════════╗
// ║ accountsReceivable.batchEdit.js — Seleção + Editar em lote          ║
// ║ CONSART ERP                                                         ║
// ║ • Checkbox por linha + "marcar todos" da página (cabeçalho)         ║
// ║ • A seleção fica em state.selectedIds (mantida entre páginas)       ║
// ║ • Modal: só os campos preenchidos são alterados nos marcados        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from './accountsReceivable.alert.js';
import { batchUpdateAccounts } from './accountsReceivable.api.js';
import { refreshCashSubcategorySelect } from './accountsReceivable.categories.js';
import { clearChartAccountPicker } from './accountsReceivable.chartAccountPicker.js';
import { state } from './accountsReceivable.state.js';
import { $ } from './accountsReceivable.utils.js';
import { Modal } from './modal.js';

const MODAL_ID = 'arBatchEditModal';

// -------------------------------------------------------------------
// SELEÇÃO
// -------------------------------------------------------------------

function rowBoxes() {
  const body = $('#tableBody');
  return body ? [...body.querySelectorAll('.ar-row-checkbox')] : [];
}

export function refreshSelectionUi() {
  const boxes = rowBoxes();

  boxes.forEach((box) => {
    const selected = state.selectedIds.has(Number(box.dataset.id));
    box.checked = selected;
    box.closest('tr')?.classList.toggle('is-selected', selected);
  });

  const onPage = boxes.filter((box) => state.selectedIds.has(Number(box.dataset.id))).length;
  const selectAll = $('#arSelectAll');
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && onPage === boxes.length;
    selectAll.indeterminate = onPage > 0 && onPage < boxes.length;
    selectAll.disabled = boxes.length === 0;
  }

  const total = state.selectedIds.size;
  const button = $('#btnBatchEdit');
  if (button) {
    button.disabled = total === 0;
    button.textContent = `✏️ Editar em lote (${total})`;
  }
}

function bindSelection() {
  $('#tableBody')?.addEventListener('change', (event) => {
    const box = event.target.closest('.ar-row-checkbox');
    if (!box) return;

    const id = Number(box.dataset.id);
    if (box.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    refreshSelectionUi();
  });

  $('#arSelectAll')?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    rowBoxes().forEach((box) => {
      const id = Number(box.dataset.id);
      if (checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
    });
    refreshSelectionUi();
  });

  // Re-render da tabela (filtro, página, ordenação): reaplica as marcações
  const body = $('#tableBody');
  if (body) new MutationObserver(refreshSelectionUi).observe(body, { childList: true });
}

// -------------------------------------------------------------------
// MODAL
// -------------------------------------------------------------------

function resetForm() {
  $('#arBatchEditForm')?.reset();
  refreshCashSubcategorySelect('#arBatchCategoryId');
  clearChartAccountPicker('batch');
}

function openBatchEdit() {
  const total = state.selectedIds.size;
  if (!total) return;

  resetForm();
  $('#arBatchEditSubtitle').textContent =
    `${total} ${total === 1 ? 'título marcado' : 'títulos marcados'}. Só os campos preenchidos serão alterados.`;

  Modal.open(MODAL_ID, { focusSelector: '#arBatchDueDate' });
}

function formFields() {
  const value = (selector) => $(selector)?.value || '';
  const fields = {
    due_date: value('#arBatchDueDate'),
    bank_account_id: value('#arBatchBankAccountId'),
    document_type_id: value('#arBatchDocumentTypeId'),
    category_id: value('#arBatchCategoryId'),
    subcategory_id: value('#arBatchSubcategoryId'),
    chart_account_id: value('#arBatchChartAccountId'),
  };

  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ''));
}

function resultMessage(result) {
  const lines = [`${result.updated} ${result.updated === 1 ? 'título alterado' : 'títulos alterados'}.`];

  if (result.skipped) lines.push(`${result.skipped} sem alteração.`);

  const notes = (result.results || []).filter((r) => r.message);
  if (notes.length) {
    lines.push('');
    notes.slice(0, 10).forEach((r) => lines.push(`#${r.id}: ${r.message}`));
    if (notes.length > 10) lines.push(`… e mais ${notes.length - 10}.`);
  }

  return lines.join('\n');
}

async function submitBatchEdit(event, onSaved) {
  event.preventDefault();

  const ids = [...state.selectedIds];
  const fields = formFields();

  if (!Object.keys(fields).length) {
    showCenterModal({
      type: 'warning',
      title: 'Nada para alterar',
      message: 'Preencha ao menos um campo. Os campos em branco ficam como estão.',
    });
    return;
  }

  const button = $('#btnConfirmBatchEdit');
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }

  try {
    const response = await batchUpdateAccounts(ids, fields);
    const result = response?.data ?? response ?? {};

    Modal.close(MODAL_ID);

    // Mantém marcados só os que falharam, para tentar de novo
    const failedIds = (result.results || []).filter((r) => !r.ok).map((r) => Number(r.id));
    state.selectedIds = new Set(failedIds);

    showCenterModal({
      type: result.failed ? 'warning' : 'success',
      title: result.failed ? `Lote concluído com ${result.failed} erro(s)` : 'Lote concluído',
      message: resultMessage(result),
    });

    if (typeof onSaved === 'function') await onSaved();
    refreshSelectionUi();
  } catch (error) {
    showCenterModal({ type: 'error', title: 'Erro ao editar em lote', message: error.message });
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

// -------------------------------------------------------------------
// API PÚBLICA
// -------------------------------------------------------------------

export function bindBatchEdit(onSaved) {
  bindSelection();
  refreshSelectionUi();

  $('#btnBatchEdit')?.addEventListener('click', openBatchEdit);
  $('#arBatchEditForm')?.addEventListener('submit', (event) => submitBatchEdit(event, onSaved));
}
