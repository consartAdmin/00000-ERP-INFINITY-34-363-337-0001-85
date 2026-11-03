// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expensesSelection.js — Despesas marcadas (checkbox) + ações em lote ║
// ║ Path: public/expenses/expensesSelection.js                          ║
// ║ - Marca/desmarca por linha e "todas desta página"                   ║
// ║ - Mantém as marcadas ao trocar de página/filtro/ordem               ║
// ║ - Rodapé: N marcadas • R$ total                                     ║
// ║ - Excluir em lote: POST /api/expenses/batch-delete                  ║
// ║ - Alterar em lote: POST /api/expenses/batch-update (modal)          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';

const BATCH_MODAL_ID = 'expenseBatchModal';

const moneyBR = (v) =>
  (Number(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function createExpensesSelection({ api, apiFetch, onChanged = async () => {} }) {
  // id → valor (para somar o total das marcadas mesmo em outras páginas)
  const selected = new Map();

  const el = {
    tbBody: document.getElementById('tbBody'),
    selectAll: document.getElementById('expSelectAll'),
    info: document.getElementById('expSelectedInfo'),
    pill: document.getElementById('expSelectedPill'),
    btnEdit: document.getElementById('btnBatchEdit'),
    btnDelete: document.getElementById('btnBatchDelete'),

    form: document.getElementById('formBatch'),
    summary: document.getElementById('batchSummary'),
    btnSave: document.getElementById('btnBatchSave'),
    status: document.getElementById('batch_status'),
    paid_date: document.getElementById('batch_paid_date'),
    payment_method: document.getElementById('batch_payment_method'),
    recurrence_type: document.getElementById('batch_recurrence_type'),
    category: document.getElementById('batch_category'),
    cost_center: document.getElementById('batch_cost_center'),
    is_active: document.getElementById('batch_is_active'),
  };

  function totalSelected() {
    let sum = 0;
    selected.forEach((value) => { sum += Number(value || 0); });
    return sum;
  }

  function summaryText() {
    const n = selected.size;
    return `${n} ${n === 1 ? 'marcada' : 'marcadas'} • ${moneyBR(totalSelected())}`;
  }

  function boxes() {
    return el.tbBody ? [...el.tbBody.querySelectorAll('.exp-row-checkbox')] : [];
  }

  function refresh() {
    const list = boxes();
    list.forEach((box) => {
      const on = selected.has(Number(box.dataset.id));
      box.checked = on;
      box.closest('tr')?.classList.toggle('is-selected', on);
    });

    const onPage = list.filter((box) => selected.has(Number(box.dataset.id))).length;
    if (el.selectAll) {
      el.selectAll.checked = list.length > 0 && onPage === list.length;
      el.selectAll.indeterminate = onPage > 0 && onPage < list.length;
      el.selectAll.disabled = list.length === 0;
    }

    const n = selected.size;
    if (el.info) el.info.textContent = summaryText();
    el.pill?.classList.toggle('is-active', n > 0);
    if (el.btnEdit) {
      el.btnEdit.disabled = n === 0;
      el.btnEdit.textContent = `✏️ Alterar (${n})`;
    }
    if (el.btnDelete) {
      el.btnDelete.disabled = n === 0;
      el.btnDelete.textContent = `🗑️ Excluir (${n})`;
    }
  }

  function toggle(box, on) {
    const id = Number(box.dataset.id);
    if (on) selected.set(id, Number(box.dataset.value || 0));
    else selected.delete(id);
  }

  function clear() {
    selected.clear();
    refresh();
  }

  /** Remove da seleção os ids que não existem mais (ex.: excluídos) */
  function forget(ids = []) {
    ids.forEach((id) => selected.delete(Number(id)));
    refresh();
  }

  async function deleteSelected() {
    const ids = [...selected.keys()];
    if (!ids.length) return;
    const n = ids.length;
    const label = n === 1 ? '1 despesa marcada' : `${n} despesas marcadas`;
    if (!confirm(`Excluir ${label} (total ${moneyBR(totalSelected())})?`)) return;

    el.btnDelete.disabled = true;
    try {
      const data = await apiFetch(`${api}/batch-delete`, { method: 'POST', body: JSON.stringify({ ids }) });
      forget(data?.ids || ids);
      await onChanged();
      alert(`${data?.deleted ?? ids.length} despesa(s) excluída(s).`);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      refresh();
    }
  }

  function openBatchEdit() {
    if (!selected.size) return;
    el.form?.reset();
    if (el.summary) el.summary.textContent = `${selected.size} ${selected.size === 1 ? 'despesa' : 'despesas'} • ${moneyBR(totalSelected())}`;
    Modal.open(BATCH_MODAL_ID, { focusSelector: '#batch_status' });
  }

  function readChanges() {
    const changes = {};
    const val = (x) => String(x?.value ?? '').trim();
    if (val(el.status)) changes.status = val(el.status);
    if (val(el.paid_date)) changes.paid_date = val(el.paid_date);
    if (val(el.payment_method)) changes.payment_method = val(el.payment_method);
    if (val(el.recurrence_type)) changes.recurrence_type = val(el.recurrence_type);
    if (val(el.category)) changes.category = val(el.category);
    if (val(el.cost_center)) changes.cost_center = val(el.cost_center);
    if (val(el.is_active)) changes.is_active = val(el.is_active);
    return changes;
  }

  async function saveBatchEdit(event) {
    event.preventDefault();
    const ids = [...selected.keys()];
    const changes = readChanges();
    if (!Object.keys(changes).length) return alert('Preencha pelo menos um campo para alterar.');

    el.btnSave.disabled = true;
    try {
      const data = await apiFetch(`${api}/batch-update`, { method: 'POST', body: JSON.stringify({ ids, changes }) });
      Modal.close(BATCH_MODAL_ID);
      await onChanged();
      alert(`${data?.updated ?? ids.length} despesa(s) alterada(s).`);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      el.btnSave.disabled = false;
    }
  }

  function bind() {
    Modal.setup();

    el.tbBody?.addEventListener('change', (e) => {
      const box = e.target.closest('.exp-row-checkbox');
      if (!box) return;
      toggle(box, box.checked);
      refresh();
    });

    el.selectAll?.addEventListener('change', (e) => {
      boxes().forEach((box) => toggle(box, e.target.checked));
      refresh();
    });

    el.btnDelete?.addEventListener('click', deleteSelected);
    el.btnEdit?.addEventListener('click', openBatchEdit);
    el.form?.addEventListener('submit', saveBatchEdit);
  }

  bind();
  refresh();

  return {
    refresh,
    clear,
    forget,
    isSelected: (id) => selected.has(Number(id)),
  };
}
