'use strict';

// Seleção de títulos (checkbox por linha + marcar todos da página)

import { state } from './accountsPayable.state.js';
import { qs } from './accountsPayable.utils.js';

export function getSelectedIds() {
  return [...state.selectedIds];
}

export function clearSelection() {
  state.selectedIds.clear();
  refreshSelectionUi();
}

export function refreshSelectionUi() {
  const body = qs('#apTableBody');
  const boxes = body ? [...body.querySelectorAll('.ap-row-checkbox')] : [];

  boxes.forEach((box) => {
    const selected = state.selectedIds.has(Number(box.dataset.id));
    box.checked = selected;
    box.closest('tr')?.classList.toggle('is-selected', selected);
  });

  const onPage = boxes.filter((box) => state.selectedIds.has(Number(box.dataset.id))).length;
  const selectAll = qs('#apSelectAll');
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && onPage === boxes.length;
    selectAll.indeterminate = onPage > 0 && onPage < boxes.length;
    selectAll.disabled = boxes.length === 0;
  }

  const total = state.selectedIds.size;
  const payButton = qs('#btnPaySelected');
  if (payButton) {
    payButton.disabled = total === 0;
    payButton.textContent = `💸 Baixar (${total})`;
  }

  const deleteButton = qs('#btnDeleteSelected');
  if (deleteButton) {
    deleteButton.disabled = total === 0;
    deleteButton.textContent = `🗑️ Selecionados (${total})`;
  }
}

export function initSelection() {
  qs('#apTableBody')?.addEventListener('change', (event) => {
    const box = event.target.closest('.ap-row-checkbox');
    if (!box) return;
    const id = Number(box.dataset.id);
    if (box.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    refreshSelectionUi();
  });

  qs('#apSelectAll')?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    qs('#apTableBody')?.querySelectorAll('.ap-row-checkbox').forEach((box) => {
      const id = Number(box.dataset.id);
      if (checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
    });
    refreshSelectionUi();
  });
}
