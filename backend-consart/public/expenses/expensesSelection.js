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
import { createCashCategoryPair } from '/public/includes/js/cashCategorySelects.js';

const BATCH_MODAL_ID = 'expenseBatchModal';
const PAYABLE_MODAL_ID = 'expensePayableModal';
const MAX_PARCELS = 60;

/** Soma n meses a 'YYYY-MM-DD' mantendo o dia (limitado ao último dia do mês) */
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const dateBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const moneyBR = (v) =>
  (Number(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function createExpensesSelection({ api, apiFetch, onChanged = async () => {} }) {
  // id → { value, name, due } (total e parcelas mesmo com marcadas em outras páginas)
  const selected = new Map();

  const el = {
    tbBody: document.getElementById('tbBody'),
    selectAll: document.getElementById('expSelectAll'),
    info: document.getElementById('expSelectedInfo'),
    pill: document.getElementById('expSelectedPill'),
    btnEdit: document.getElementById('btnBatchEdit'),
    btnDelete: document.getElementById('btnBatchDelete'),
    btnPayable: document.getElementById('btnBatchPayable'),
    payableForm: document.getElementById('formPayable'),
    payableSummary: document.getElementById('payableSummary'),
    payableParcels: document.getElementById('payable_parcels'),
    payableTotal: document.getElementById('payable_total'),
    payablePreview: document.getElementById('payablePreview'),
    payableSend: document.getElementById('btnPayableSend'),

    form: document.getElementById('formBatch'),
    summary: document.getElementById('batchSummary'),
    btnSave: document.getElementById('btnBatchSave'),
    recurrence_type: document.getElementById('batch_recurrence_type'),
    category: document.getElementById('batch_category'),
    subcategory: document.getElementById('batch_subcategory'),
    cost_center: document.getElementById('batch_cost_center'),
    is_active: document.getElementById('batch_is_active'),
  };

  function totalSelected() {
    let sum = 0;
    selected.forEach((info) => { sum += Number(info.value || 0); });
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
    if (el.btnPayable) {
      el.btnPayable.disabled = n === 0;
      el.btnPayable.textContent = `📤 Contas a Pagar (${n})`;
    }
  }

  function toggle(box, on) {
    const id = Number(box.dataset.id);
    if (on) selected.set(id, { value: Number(box.dataset.value || 0), name: box.dataset.name || `#${id}`, due: box.dataset.due || '' });
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

  /* ── Enviar ao Contas a Pagar em N parcelas mensais ───────────────── */
  function parcelsValue() {
    const n = Number.parseInt(el.payableParcels?.value, 10);
    return Number.isInteger(n) && n >= 1 && n <= MAX_PARCELS ? n : null;
  }

  function renderPayablePreview() {
    const n = parcelsValue();
    const items = [...selected.values()];
    if (el.payableTotal) {
      el.payableTotal.value = n
        ? `${items.length * n} título(s) • ${moneyBR(totalSelected() * n)}`
        : `Informe de 1 a ${MAX_PARCELS}`;
    }
    if (!el.payablePreview) return;
    if (!n) { el.payablePreview.innerHTML = ''; return; }
    const rows = items.slice(0, 8).map((it) => {
      if (!it.due) return `<li><b>${escapeHtml(it.name)}</b>: sem vencimento (não será enviada)</li>`;
      const last = addMonths(it.due, n - 1);
      const range = n > 1 ? `${dateBR(it.due)} até ${dateBR(last)}` : dateBR(it.due);
      return `<li><b>${escapeHtml(it.name)}</b>: ${n}× ${moneyBR(it.value)} • ${range}</li>`;
    });
    if (items.length > 8) rows.push(`<li>… e mais ${items.length - 8} despesa(s)</li>`);
    el.payablePreview.innerHTML = `<ul>${rows.join('')}</ul>
      <p class="exp-payable-preview__hint">Parcelas já enviadas com o mesmo vencimento são ignoradas (não duplica).</p>`;
  }

  function openPayable() {
    if (!selected.size) return;
    if (el.payableParcels) el.payableParcels.value = '1';
    if (el.payableSummary) el.payableSummary.textContent = `${selected.size} ${selected.size === 1 ? 'despesa' : 'despesas'} • ${moneyBR(totalSelected())} por mês`;
    renderPayablePreview();
    Modal.open(PAYABLE_MODAL_ID, { focusSelector: '#payable_parcels' });
  }

  async function sendPayable(event) {
    event.preventDefault();
    const parcels = parcelsValue();
    if (!parcels) return alert(`Informe a quantidade de parcelas (1 a ${MAX_PARCELS}).`);
    const ids = [...selected.keys()];

    el.payableSend.disabled = true;
    try {
      const data = await apiFetch(`${api}/to-accounts-payable`, { method: 'POST', body: JSON.stringify({ ids, parcels }) });
      const created = data?.created || [];
      const skipped = data?.skipped || [];
      const lines = [];
      const count = created.reduce((n, c) => n + (c.parcels?.length || 0), 0);
      if (created.length) {
        lines.push(`✅ ${count} título(s) gerado(s) no Contas a Pagar:`);
        created.forEach((c) => {
          const p = c.parcels || [];
          const first = p[0];
          const last = p[p.length - 1];
          const nums = p.length > 1 ? `títulos nº ${first.account_payable_id} a ${last.account_payable_id}` : `título nº ${first?.account_payable_id}`;
          lines.push(`  • ${c.name}: ${p.length} parcela(s), ${nums}${c.supplier_found ? '' : ' (fornecedor não encontrado no cadastro)'}`);
        });
      }
      if (skipped.length) {
        if (lines.length) lines.push('');
        lines.push('⚠️ Não enviadas:');
        skipped.forEach((s) => lines.push(`  • ${s.name}: ${s.reason}`));
      }
      Modal.close(PAYABLE_MODAL_ID);
      await onChanged();
      alert(lines.join('\n') || 'Nada para enviar.');
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      el.payableSend.disabled = false;
      refresh();
    }
  }

  function openBatchEdit() {
    if (!selected.size) return;
    el.form?.reset();
    cashCategory.reset();
    if (el.summary) el.summary.textContent = `${selected.size} ${selected.size === 1 ? 'despesa' : 'despesas'} • ${moneyBR(totalSelected())}`;
    Modal.open(BATCH_MODAL_ID, { focusSelector: '#batch_recurrence_type' });
  }

  function readChanges() {
    const changes = {};
    const val = (x) => String(x?.value ?? '').trim();
    if (val(el.recurrence_type)) changes.recurrence_type = val(el.recurrence_type);
    if (cashCategory.hasValue()) Object.assign(changes, cashCategory.getPayload());
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
    el.btnPayable?.addEventListener('click', openPayable);
    el.payableParcels?.addEventListener('input', renderPayablePreview);
    el.payableForm?.addEventListener('submit', sendPayable);
    el.form?.addEventListener('submit', saveBatchEdit);
  }

  const cashCategory = createCashCategoryPair({
    categorySelect: el.category,
    subcategorySelect: el.subcategory,
    categoryPlaceholder: '— não alterar —',
  });

  bind();
  refresh();

  return {
    refresh,
    clear,
    forget,
    isSelected: (id) => selected.has(Number(id)),
  };
}
