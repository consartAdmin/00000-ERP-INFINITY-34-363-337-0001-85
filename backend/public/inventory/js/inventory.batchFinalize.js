// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inventory.batchFinalize.js — Finalizar inventários selecionados      ║
// ║ CONSART ERP | Inventário                                              ║
// ║                                                                      ║
// ║ - Checkbox por linha (só Aberto / Em contagem) + "marcar a página"    ║
// ║ - A seleção vale entre páginas; limpa depois de finalizar             ║
// ║ - Pede a senha de alçada UMA vez e chama, um por um, o mesmo          ║
// ║   POST /api/inventories/:id/finalize da finalização individual        ║
// ║   (cada inventário roda na sua própria transação no backend)          ║
// ║ - Progresso e resultado por inventário no modal batchFinalizeModal    ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

import { apiPost } from './inventory.api.js';
import { INVENTORY_API_BASE, logError } from './inventory.config.js';
import { askPasswordModal } from './inventory.passwordModal.js';
import { escapeHtml } from './inventory.utils.js';

const FINALIZABLE = new Set(['OPEN', 'COUNTING']);

/** id → código (descrição) dos inventários marcados */
const selected = new Map();
let running = false;

export function isFinalizable(inv) {
  return FINALIZABLE.has(String(inv?.status || '').toUpperCase());
}

export function isInventorySelected(id) {
  return selected.has(String(id));
}

/** Célula do checkbox da linha (vazia quando o inventário já não pode ser finalizado) */
export function selectCellHtml(inv) {
  if (!isFinalizable(inv)) return '<td class="table-cell-select"></td>';
  const id = escapeHtml(String(inv.inventory_id));
  const checked = isInventorySelected(inv.inventory_id) ? ' checked' : '';
  return `<td class="table-cell-select"><input type="checkbox" data-select-inventory="${id}"`
    + ` data-code="${escapeHtml(inv.code || '')}" title="Marcar para finalizar"${checked}></td>`;
}

function els() {
  return {
    btn: document.getElementById('btnFinalizeSelected'),
    btnLabel: document.getElementById('btnFinalizeSelectedLabel'),
    selectPage: document.getElementById('inventorySelectPage'),
    tbody: document.getElementById('inventoryTableBody'),
  };
}

function pageBoxes() {
  return [...(els().tbody?.querySelectorAll('input[data-select-inventory]') || [])];
}

/** Atualiza o botão "Finalizar selecionados (N)" e o checkbox do cabeçalho */
export function refreshSelectionUi() {
  const { btn, btnLabel, selectPage } = els();
  const n = selected.size;

  if (btn) btn.disabled = running || n === 0;
  if (btnLabel && !running) {
    btnLabel.textContent = n ? `Finalizar selecionados (${n})` : 'Finalizar selecionados';
  }

  if (selectPage) {
    const boxes = pageBoxes();
    const marked = boxes.filter((b) => b.checked).length;
    selectPage.disabled = boxes.length === 0;
    selectPage.checked = boxes.length > 0 && marked === boxes.length;
    selectPage.indeterminate = marked > 0 && marked < boxes.length;
  }
}

function setBox(box, on) {
  box.checked = on;
  if (on) selected.set(String(box.dataset.selectInventory), box.dataset.code || '');
  else selected.delete(String(box.dataset.selectInventory));
}

/* ──────────────────────────────────────────────────────────────
   Progresso (modal) — uma linha por inventário
────────────────────────────────────────────────────────────── */

const STEP = {
  wait: ['Aguardando', 'info'],
  run: ['Finalizando...', 'warning'],
  ok: ['Finalizado', 'success'],
  err: ['Erro', 'danger'],
};

function stepPill(kind) {
  const [label, tone] = STEP[kind];
  return `<span class="summary-pill summary-pill--${tone}">${label}</span>`;
}

function renderProgressRows(list) {
  const tbody = document.getElementById('batchFinalizeTableBody');
  if (!tbody) return;
  tbody.innerHTML = list.map((it, i) => `
    <tr data-batch-row="${i}">
      <td class="td-left">${escapeHtml(it.code || `#${it.id}`)}</td>
      <td data-batch-status>${stepPill('wait')}</td>
      <td class="td-left" data-batch-msg></td>
    </tr>`).join('');
}

function setProgressRow(i, kind, msg = '') {
  const tr = document.querySelector(`#batchFinalizeTableBody tr[data-batch-row="${i}"]`);
  if (!tr) return;
  tr.querySelector('[data-batch-status]').innerHTML = stepPill(kind);
  tr.querySelector('[data-batch-msg]').textContent = msg;
  tr.scrollIntoView({ block: 'nearest' });
}

function setProgressSummary(text, tone = 'info') {
  const el = document.getElementById('batchFinalizeSummary');
  if (!el) return;
  el.className = `summary-pill summary-pill--${tone}`;
  el.textContent = text;
}

function setProgressClosable(on) {
  ['batchFinalizeClose', 'batchFinalizeOk'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !on;
  });
}

const ERROR_PT = {
  'Inventory not found': 'Inventário não encontrado.',
  'Inventory already finalized/cancelled': 'Inventário já finalizado ou cancelado.',
};

/** apiPost lança "POST url -> 401: {json}": extrai status e a mensagem do backend */
function friendlyError(err) {
  const raw = String(err?.message || err);
  const m = raw.match(/->\s*(\d{3}):\s*([\s\S]*)$/);
  if (!m) return { msg: raw, status: 0 };
  const status = Number(m[1]);
  let msg = m[2].trim();
  try {
    const j = JSON.parse(msg);
    msg = j.error || j.message || msg;
  } catch { /* texto puro */ }
  return { msg: ERROR_PT[msg] || msg || `Erro ${status}`, status };
}

/* ──────────────────────────────────────────────────────────────
   Fluxo: confirmar → senha → finalizar um por um → resultado
────────────────────────────────────────────────────────────── */

async function runBatch({ afterReload } = {}) {
  if (running || selected.size === 0) return;

  const list = [...selected.entries()].map(([id, code]) => ({ id, code }));
  const n = list.length;
  const preview = list.slice(0, 8).map((it) => `<li>${escapeHtml(it.code || `#${it.id}`)}</li>`).join('');
  const more = n > 8 ? `<li>... e mais ${n - 8}</li>` : '';

  const ok = await showCenterModal({
    variant: 'warning',
    title: `Finalizar ${n} ${n === 1 ? 'inventário' : 'inventários'}?`,
    message: `<ul>${preview}${more}</ul>
      <p>A contagem de cada um será aplicada no estoque (mesma regra da finalização individual).
      Depois é possível estornar um por um pelo ícone de desfazer.</p>`,
    buttons: [
      { label: 'Cancelar', variant: 'cancel', action: () => false },
      { label: 'Finalizar e aplicar estoque', variant: 'danger', action: () => true },
    ],
  });
  if (ok !== true) return;

  const senha = await askPasswordModal({
    title: 'Finalizar selecionados',
    subtitle: `Digite a senha para FINALIZAR e APLICAR o estoque de ${n} ${n === 1 ? 'inventário' : 'inventários'}:`,
  });
  if (senha == null) return;
  if (!String(senha).trim()) {
    showCenterModal({ variant: 'warning', title: 'Senha obrigatória', message: 'Você precisa informar a senha para finalizar.' });
    return;
  }

  running = true;
  const { btn, btnLabel } = els();
  if (btn) btn.disabled = true;

  renderProgressRows(list);
  setProgressSummary(`Finalizando 0 de ${n}...`, 'warning');
  setProgressClosable(false);
  Modal.open('batchFinalizeModal');

  let okCount = 0;
  let errCount = 0;
  let stoppedByPassword = false;

  for (let i = 0; i < n; i += 1) {
    const it = list[i];
    if (stoppedByPassword) {
      setProgressRow(i, 'err', 'Não executado (senha inválida).');
      errCount += 1;
      continue;
    }

    setProgressRow(i, 'run');
    setProgressSummary(`Finalizando ${i + 1} de ${n}...`, 'warning');
    if (btnLabel) btnLabel.textContent = `Finalizando ${i + 1} de ${n}...`;

    try {
      await apiPost(`${INVENTORY_API_BASE}/${it.id}/finalize`, { applyAdjust: true, password: String(senha) });
      setProgressRow(i, 'ok');
      selected.delete(it.id);
      okCount += 1;
    } catch (err) {
      const { msg, status } = friendlyError(err);
      logError(`Erro ao finalizar inventário ${it.id}:`, err);
      setProgressRow(i, 'err', msg);
      errCount += 1;
      // Senha errada vale para todos: não insiste nos próximos
      if (status === 401) stoppedByPassword = true;
    }
  }

  running = false;
  // Os que deram erro continuam marcados para tentar de novo
  setProgressSummary(
    errCount
      ? `${okCount} de ${n} finalizado(s) · ${errCount} com erro (continuam marcados)`
      : `${okCount} de ${n} finalizado(s) com sucesso`,
    errCount ? (okCount ? 'warning' : 'danger') : 'success',
  );
  setProgressClosable(true);
  // Se fecharam com ESC no meio, reabre para mostrar o resultado
  if (!Modal.isOpen('batchFinalizeModal')) Modal.open('batchFinalizeModal');

  if (typeof afterReload === 'function') {
    try { await afterReload(); } catch (err) { logError('Erro ao recarregar inventários:', err); }
  }
  refreshSelectionUi();
}

/** Liga checkboxes, "marcar a página", botão e o modal de progresso (uma vez) */
export function bindBatchFinalize({ afterReload } = {}) {
  const { btn, selectPage, tbody } = els();

  tbody?.addEventListener('change', (ev) => {
    const box = ev.target.closest('input[data-select-inventory]');
    if (!box) return;
    setBox(box, box.checked);
    refreshSelectionUi();
  });

  selectPage?.addEventListener('change', () => {
    pageBoxes().forEach((b) => setBox(b, selectPage.checked));
    refreshSelectionUi();
  });

  btn?.addEventListener('click', () => runBatch({ afterReload }));

  ['batchFinalizeClose', 'batchFinalizeOk'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => {
      if (!running) Modal.close('batchFinalizeModal');
    });
  });

  refreshSelectionUi();
}
