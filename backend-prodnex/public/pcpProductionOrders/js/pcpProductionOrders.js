// ╔════════════════════════════════════════════════════════════╗
// ║ pcpProductionOrders.js — Ordens de Produção (PCP)          ║
// ╚════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import {
  pcpApi, escapeHtml, fmtNum, fmtDate, fmtDateTime, toInputDate, statusBadge, messageRow, showMessage, notify, confirmCenter,
  paginate, bindPagination, renderPagination,
  attachProductSearch, productCodeOf, STATUS_LABEL,
} from '/public/pcp/js/pcp.common.js';

const $ = (id) => document.getElementById(id);
const PAGER = { info: 'opTableInfo', pageInfo: 'opPageInfo', prev: 'opPrevPage', next: 'opNextPage', size: 'opRowsPerPage' };
const OPEN = ['PLANEJADA', 'LIBERADA', 'EM_PRODUCAO'];
const state = { rows: [], order: null, page: 1, pageSize: 50 };

// Rótulo do botão para cada transição de status.
const ACTION_LABEL = {
  LIBERADA: 'Liberar',
  PLANEJADA: 'Voltar para planejada',
  EM_PRODUCAO: 'Iniciar produção',
  CONCLUIDA: 'Concluir OP',
  CANCELADA: 'Cancelar OP',
};

// Cor e ícone de linha de cada botão de transição (padrão dos botões dock).
const STATUS_ICON = {
  go: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  done: '<path d="M20 6 9 17l-5-5"/>',
  back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  cancel: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const STATUS_BUTTON = {
  LIBERADA: ['btn-toolbar', STATUS_ICON.go],
  EM_PRODUCAO: ['btn-toolbar', STATUS_ICON.play],
  CONCLUIDA: ['btn-new', STATUS_ICON.done],
  PLANEJADA: ['btn-clean', STATUS_ICON.back],
  CANCELADA: ['btn-delete', STATUS_ICON.cancel],
};

// ── Lista ─────────────────────────────────────────────────────

function progress(r) {
  const pct = Math.min(100, (Number(r.quantity_produced) / Number(r.quantity_planned)) * 100 || 0);
  const tone = pct >= 100 ? 'success' : (pct > 0 ? 'warning' : 'info');
  return `<span class="summary-pill summary-pill--${tone}">${fmtNum(pct, 0)}%</span>`;
}

function filtered() {
  const q = $('search').value.trim().toLowerCase();
  const st = $('statusFilter').value;
  return state.rows.filter((r) =>
    (st === '' || (st === 'OPEN' ? OPEN.includes(r.status) : r.status === st)) &&
    (!q || `${r.order_number} ${r.product_code} ${r.product_description || ''} ${r.sales_order_ref || ''}`.toLowerCase().includes(q)));
}

function render() {
  const pg = paginate(filtered(), state);
  $('tableBody').innerHTML = pg.slice.length ? pg.slice.map((r) => `
    <tr data-open="${r.order_id}">
      <td><strong>${escapeHtml(r.order_number)}</strong></td>
      <td>${escapeHtml(r.product_code)}</td>
      <td class="td-left">${escapeHtml(r.product_description || '—')}</td>
      <td class="td-right">${fmtNum(r.quantity_planned)}</td>
      <td class="td-right">${fmtNum(r.quantity_produced)}</td>
      <td>${progress(r)}</td>
      <td>${fmtDate(r.due_date)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${actionIconsHtml([{ action: 'view', title: `Abrir ${r.order_number}`, attrs: { 'data-open': r.order_id } }])}</td>
    </tr>`).join('')
    : messageRow(9, 'Nenhuma ordem de produção encontrada.');
  renderPagination(PAGER, pg, state, 'OPs');
}

async function load() {
  try {
    state.rows = await pcpApi('/orders') || [];
    render();
  } catch (e) {
    $('tableBody').innerHTML = messageRow(9, `Erro ao carregar: ${e.message}`);
  }
}

// ── Nova OP ───────────────────────────────────────────────────

function openNew() {
  $('newForm').reset();
  Modal.open('newModal', { focusSelector: '#newProduct' });
}

async function createOrder(e) {
  e.preventDefault();
  try {
    const order = await pcpApi('/orders', {
      method: 'POST',
      body: {
        product_code: productCodeOf($('newProduct').value),
        quantity_planned: $('newQty').value,
        due_date: $('newDue').value || null,
        sales_order_ref: $('newRef').value,
        notes: $('newNotes').value,
      },
    });
    Modal.close('newModal');
    load();
    showOrder(order);
    Modal.open('orderModal');
  } catch (err) {
    showMessage(null, err.message);
  }
}

// ── Detalhe da OP ─────────────────────────────────────────────

function showOrder(o, message = null, kind = 'success') {
  state.order = o;
  const planned = o.status === 'PLANEJADA';
  const canReport = ['LIBERADA', 'EM_PRODUCAO'].includes(o.status);

  $('orderTitle').textContent = `${o.order_number} — ${o.product_code}`;
  $('orderCaption').textContent = [
    o.product_description,
    o.sales_order_ref ? `Pedido ${o.sales_order_ref}` : null,
    o.started_at ? `Início ${fmtDateTime(o.started_at)}` : null,
    o.finished_at ? `Conclusão ${fmtDateTime(o.finished_at)}` : null,
    o.status === 'CONCLUIDA' ? (o.stock_posted ? 'Estoque lançado' : 'Estoque não lançado') : null,
  ].filter(Boolean).join(' · ');

  $('kpiStatus').innerHTML = statusBadge(o.status);
  $('kpiPlanned').textContent = fmtNum(o.quantity_planned);
  $('kpiProduced').textContent = fmtNum(o.quantity_produced);
  $('kpiScrap').textContent = fmtNum(o.quantity_scrap);

  $('editQty').value = Number(o.quantity_planned);
  $('editDue').value = toInputDate(o.due_date);
  $('editRef').value = o.sales_order_ref || '';
  $('editNotes').value = o.notes || '';
  $('editForm').querySelectorAll('input').forEach((i) => { i.disabled = !planned; });
  // .btn tem display próprio: o atributo hidden sozinho não esconde
  $('btnSaveEdit').style.display = planned ? '' : 'none';
  $('btnDelete').style.display = planned ? '' : 'none';

  $('materialsBody').innerHTML = o.materials.length ? o.materials.map((m) => {
    const short = OPEN.includes(o.status) && Number(m.stock_qty) < Number(m.qty_required) - Number(m.qty_consumed);
    return `<tr>
      <td class="td-left"><strong>${escapeHtml(m.component_code)}</strong> ${escapeHtml(m.component_description || '')}</td>
      <td class="td-right">${fmtNum(m.qty_per_unit, 6)}</td>
      <td class="td-right">${fmtNum(m.qty_required, 4)}</td>
      <td class="td-right">${fmtNum(m.qty_consumed, 4)}</td>
      <td class="td-right">${short ? `<span class="summary-pill summary-pill--danger">${fmtNum(m.stock_qty, 4)}</span>` : fmtNum(m.stock_qty, 4)}</td>
    </tr>`;
  }).join('') : messageRow(5, 'OP sem materiais.');

  $('opsBody').innerHTML = o.operations.length ? o.operations.map((op) => {
    const hours = (Number(op.setup_minutes) + Number(op.run_minutes_per_unit) * Number(o.quantity_planned)) / 60;
    return `<tr>
      <td>${op.seq}</td>
      <td class="td-left">${escapeHtml(op.description)}</td>
      <td class="td-left">${escapeHtml(op.work_center_code ? `${op.work_center_code} — ${op.work_center_name}` : '—')}</td>
      <td class="td-right">${fmtNum(op.setup_minutes, 2)}</td>
      <td class="td-right">${fmtNum(op.run_minutes_per_unit, 4)}</td>
      <td class="td-right">${fmtNum(hours, 2)}</td>
    </tr>`;
  }).join('') : messageRow(6, 'Sem roteiro de operações.');

  $('reportForm').style.display = canReport ? '' : 'none';
  $('reportForm').reset();
  $('repOp').innerHTML = ['<option value="">Sem operação (OP inteira)</option>']
    .concat(o.operations.map((op) => `<option value="${op.seq}" data-wc="${op.work_center_id ?? ''}">${op.seq} — ${escapeHtml(op.description)}</option>`))
    .join('');
  if (o.operations.length) $('repOp').value = String(o.operations[o.operations.length - 1].seq);

  $('reportsBody').innerHTML = o.reports.length ? o.reports.map((r) => `<tr>
      <td>${fmtDateTime(r.reported_at)}</td>
      <td>${r.operation_seq ?? '—'}</td>
      <td>${escapeHtml(r.work_center_code || '—')}</td>
      <td class="td-right">${fmtNum(r.qty_good)}</td>
      <td class="td-right">${fmtNum(r.qty_scrap)}</td>
      <td class="td-right">${fmtNum(r.minutes, 2)}</td>
      <td class="td-left">${escapeHtml(r.operator_name || '—')}</td>
      <td class="td-left">${escapeHtml(r.notes || '')}</td>
    </tr>`).join('') : messageRow(8, 'Nenhum apontamento.');

  $('statusButtons').innerHTML = (o.next_statuses || []).map((s) => {
    const [cls, icon] = STATUS_BUTTON[s] || ['btn-toolbar', STATUS_ICON.go];
    return `<button type="button" class="btn ${cls} btn-sm" data-status="${s}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${escapeHtml(ACTION_LABEL[s] || STATUS_LABEL[s] || s)}</span></button>`;
  }).join('');

  if (message) showMessage(null, message, kind);
}

async function openOrder(id) {
  try {
    showOrder(await pcpApi(`/orders/${id}`));
    Modal.open('orderModal');
  } catch (e) {
    notify('error', 'Erro ao abrir a OP', e.message);
  }
}

async function run(fn, okMessage) {
  try {
    const o = await fn();
    const warnings = o?.warnings || [];
    showOrder(o, warnings.length ? [okMessage, ...warnings] : okMessage, warnings.length ? 'warning' : 'success');
    load();
  } catch (err) {
    showMessage(null, err.message);
  }
}

async function changeStatus(status) {
  const o = state.order;
  if (status === 'CANCELADA' && !await confirmCenter(`Cancelar a ${o.order_number}?`,
    { title: 'Cancelar OP', confirmLabel: 'Cancelar OP', variant: 'error' })) return;
  if (status === 'CONCLUIDA' && !await confirmCenter(
    `Concluir a ${o.order_number} com ${fmtNum(o.quantity_produced)} produzidos?\n` +
    'O estoque do produto e dos componentes será atualizado.', { title: 'Concluir OP', confirmLabel: 'Concluir' })) return;
  run(() => pcpApi(`/orders/${o.order_id}/status`, { method: 'PATCH', body: { status } }),
    `Status alterado para ${STATUS_LABEL[status] || status}.`);
}

function saveEdit() {
  const o = state.order;
  run(() => pcpApi(`/orders/${o.order_id}`, {
    method: 'PUT',
    body: {
      quantity_planned: $('editQty').value,
      due_date: $('editDue').value || null,
      sales_order_ref: $('editRef').value,
      notes: $('editNotes').value,
    },
  }), 'Dados da OP salvos.');
}

function addReport(e) {
  e.preventDefault();
  const o = state.order;
  const opt = $('repOp').selectedOptions[0];
  run(() => pcpApi(`/orders/${o.order_id}/reports`, {
    method: 'POST',
    body: {
      operation_seq: $('repOp').value || null,
      work_center_id: opt?.dataset.wc || null,
      qty_good: $('repGood').value,
      qty_scrap: $('repScrap').value,
      minutes: $('repMinutes').value,
      operator_name: $('repOperator').value,
      notes: $('repNotes').value,
    },
  }), 'Apontamento registrado.');
}

async function removeOrder() {
  const o = state.order;
  if (!await confirmCenter(`Excluir a ${o.order_number}?`, { title: 'Excluir OP', confirmLabel: 'Excluir', variant: 'error' })) return;
  try {
    await pcpApi(`/orders/${o.order_id}`, { method: 'DELETE' });
    Modal.close('orderModal');
    load();
  } catch (err) {
    showMessage(null, err.message);
  }
}

// ── Eventos ───────────────────────────────────────────────────

attachProductSearch($('newProduct'), $('productOptions'));
$('btnNew').addEventListener('click', openNew);
$('newForm').addEventListener('submit', createOrder);
$('reportForm').addEventListener('submit', addReport);
$('btnSaveEdit').addEventListener('click', saveEdit);
$('btnDelete').addEventListener('click', removeOrder);
$('statusButtons').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-status]');
  if (btn) changeStatus(btn.dataset.status);
});
$('search').addEventListener('input', () => { state.page = 1; render(); });
$('statusFilter').addEventListener('change', () => { state.page = 1; render(); });
$('tableBody').addEventListener('click', (e) => {
  const row = e.target.closest('[data-open]');
  if (row) openOrder(Number(row.dataset.open));
});
Modal.setup();
bindPagination(state, PAGER, render);
load();
