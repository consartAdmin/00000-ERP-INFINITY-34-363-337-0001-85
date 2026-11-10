// ╔════════════════════════════════════════════════════════════╗
// ║ pcpBom.js — Ficha técnica: estrutura + roteiro (PCP)       ║
// ╚════════════════════════════════════════════════════════════╝

import {
  pcpApi, escapeHtml, fmtNum, fmtMoney, activeBadge, showMessage, notify,
  paginate, bindPagination, renderPagination,
  attachProductSearch, productCodeOf, productLabel,
} from '/public/pcp/js/pcp.common.js';

const $ = (id) => document.getElementById(id);
const PAGER = { info: 'bomTableInfo', pageInfo: 'bomPageInfo', prev: 'bomPrevPage', next: 'bomNextPage', size: 'bomRowsPerPage' };
const state = { rows: [], workCenters: [], page: 1, pageSize: 50 };

// ── Lista ─────────────────────────────────────────────────────

function filtered() {
  const q = $('search').value.trim().toLowerCase();
  const all = $('includeInactive').checked;
  return state.rows.filter((r) =>
    (all || r.is_active) &&
    (!q || `${r.product_code} ${r.product_description || ''}`.toLowerCase().includes(q)));
}

function render() {
  const pg = paginate(filtered(), state);
  $('tableBody').innerHTML = pg.slice.length ? pg.slice.map((r) => `
    <tr class="is-clickable" data-edit="${r.bom_id}">
      <td><strong>${escapeHtml(r.product_code)}</strong></td>
      <td>${escapeHtml(r.product_description || '—')}</td>
      <td class="center">${escapeHtml(r.version)}</td>
      <td class="num">${fmtNum(r.base_qty, 4)}</td>
      <td class="num">${r.items_count}</td>
      <td class="num">${r.operations_count}</td>
      <td class="num"><strong>${fmtMoney(r.product_cost)}</strong></td>
      <td class="center">${activeBadge(r.is_active)}</td>
      <td class="center">
        <div class="pcp-action-group">
          <button type="button" class="btn btn-toolbar btn-sm pcp-action-button" data-edit="${r.bom_id}" title="Editar">✎</button>
          <button type="button" class="btn btn-clean btn-sm pcp-action-button" data-delete="${r.bom_id}">Excluir</button>
        </div>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="9" class="pcp-table-empty">Nenhuma ficha técnica cadastrada.</td></tr>';
  renderPagination(PAGER, pg, state, 'fichas');
}

async function load() {
  try {
    state.rows = await pcpApi('/boms') || [];
    render();
  } catch (e) {
    $('tableBody').innerHTML = `<tr><td colspan="9" class="pcp-table-error">${escapeHtml(e.message)}</td></tr>`;
  }
}

// ── Grades do modal ───────────────────────────────────────────

// Unidades e custo de cada componente (cache por código), para o select e o cálculo na tela.
const componentInfo = new Map();

async function loadComponentInfo(code) {
  if (!code) return null;
  if (!componentInfo.has(code)) {
    componentInfo.set(code, pcpApi(`/products/${encodeURIComponent(code)}/units`).catch(() => null));
  }
  return componentInfo.get(code);
}

function fillUnitSelect(tr, info, selected) {
  const select = tr.querySelector('[data-f="unit"]');
  const base = info?.base_unit || '';
  const options = info?.units?.length ? info.units : [{ unit: base, factor: 1 }];
  const current = selected || base;
  if (current && !options.some((o) => o.unit === current)) options.push({ unit: current, factor: null });
  select.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o.unit)}" ${o.unit === current ? 'selected' : ''}>${escapeHtml(o.unit || '—')}</option>`)
    .join('');
  tr._info = info;
}

function itemLineCost(tr) {
  const info = tr._info;
  const base = Number($('baseQty').value) || 1;
  const qty = Number(tr.querySelector('[data-f="quantity"]').value) || 0;
  const loss = Number(tr.querySelector('[data-f="loss"]').value) || 0;
  const unit = tr.querySelector('[data-f="unit"]').value;
  const factor = info?.units?.find((o) => o.unit === unit)?.factor ?? (unit === (info?.base_unit || '') ? 1 : null);
  if (!info || factor == null) return null;
  const fraction = (qty / base) * factor;
  return { fraction, cost: fraction * (1 + loss / 100) * Number(info.cost_price || 0), info };
}

function refreshLine(tr) {
  const line = itemLineCost(tr);
  const base = tr._info?.base_unit || '';
  tr.querySelector('[data-c="fraction"]').textContent = line ? `${fmtNum(line.fraction, 6)} ${base}` : '—';
  tr.querySelector('[data-c="cost"]').textContent = line ? `${fmtMoney(line.info.cost_price)}${base ? ` / ${base}` : ''}` : '—';
  tr.querySelector('[data-c="unit-cost"]').textContent = line ? fmtMoney4(line.cost) : '—';
}

function refreshCost() {
  const rows = [...$('itemsBody').querySelectorAll('tr:not(.pcp-hint)')];
  rows.forEach(refreshLine);
  const material = rows.reduce((sum, tr) => sum + (itemLineCost(tr)?.cost || 0), 0);
  $('costBox').hidden = false;
  $('costMaterial').textContent = `${fmtMoney4(material)} → ${fmtMoney(material)}`;
}

function fmtMoney4(v) {
  return `R$ ${fmtNum(v, 4, 4)}`;
}

function itemRow(it = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" list="productOptions" data-f="component" placeholder="Código ou descrição"
      value="${escapeHtml(productLabel(it.component_code, it.component_description))}" autocomplete="off" /></td>
    <td><input type="number" step="any" min="0" data-f="quantity" value="${escapeHtml(it.quantity == null ? '' : Number(it.quantity))}" /></td>
    <td><select data-f="unit"></select></td>
    <td><input type="number" step="any" min="0" data-f="loss" value="${escapeHtml(Number(it.loss_percent ?? 0))}" /></td>
    <td class="num" data-c="fraction">—</td>
    <td class="num" data-c="cost">—</td>
    <td class="num"><strong data-c="unit-cost">—</strong></td>
    <td><input type="text" data-f="notes" value="${escapeHtml(it.notes || '')}" autocomplete="off" /></td>
    <td><button type="button" class="btn btn-clean btn-sm" data-remove title="Remover">×</button></td>`;
  const input = tr.querySelector('[data-f="component"]');
  attachProductSearch(input, $('productOptions'));
  if (it.component_code) {
    const info = { base_unit: it.base_unit || '', units: it.unit_options || [], cost_price: Number(it.component_cost || 0) };
    componentInfo.set(it.component_code, Promise.resolve(info));
    fillUnitSelect(tr, info, it.unit);
  } else {
    fillUnitSelect(tr, null, '');
  }
  input.addEventListener('change', async () => {
    const info = await loadComponentInfo(productCodeOf(input.value));
    fillUnitSelect(tr, info, '');
    refreshCost();
  });
  $('itemsBody').appendChild(tr);
}

function opRow(op = {}) {
  const seq = op.seq ?? ($('opsBody').children.length + 1) * 10;
  const options = ['<option value="">—</option>']
    .concat(state.workCenters
      .filter((w) => w.is_active || w.work_center_id === op.work_center_id)
      .map((w) => `<option value="${w.work_center_id}" ${w.work_center_id === op.work_center_id ? 'selected' : ''}>${escapeHtml(`${w.code} — ${w.name}`)}</option>`))
    .join('');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="number" step="1" min="1" data-f="seq" value="${escapeHtml(seq)}" /></td>
    <td><select data-f="wc">${options}</select></td>
    <td><input type="text" data-f="description" maxlength="150" value="${escapeHtml(op.description || '')}" autocomplete="off" /></td>
    <td><input type="number" step="any" min="0" data-f="setup" value="${escapeHtml(Number(op.setup_minutes ?? 0))}" /></td>
    <td><input type="number" step="any" min="0" data-f="run" value="${escapeHtml(Number(op.run_minutes_per_unit ?? 0))}" /></td>
    <td><button type="button" class="btn btn-clean btn-sm" data-remove title="Remover">×</button></td>`;
  $('opsBody').appendChild(tr);
}

function emptyHint() {
  for (const [id, text, cols] of [['itemsBody', 'Nenhum componente.', 5], ['opsBody', 'Nenhuma operação.', 6]]) {
    const body = $(id);
    const hasRows = body.querySelector('tr:not(.pcp-hint)');
    body.querySelector('.pcp-hint')?.remove();
    if (!hasRows) body.insertAdjacentHTML('beforeend', `<tr class="pcp-hint"><td colspan="${cols}" class="pcp-grid-empty">${text}</td></tr>`);
  }
}

function showCost(cost) {
  refreshCost();
  $('costOperation').textContent = cost ? fmtMoney4(cost.operation) : '—';
  $('costTotal').textContent = cost ? fmtMoney4(cost.total) : '—';
}

function fill(bom = null) {
  $('form').reset();
  showMessage($('formMessage'), '');
  $('modalTitle').textContent = bom ? `Ficha técnica — ${bom.product_code}` : 'Nova ficha técnica';
  $('bomId').value = bom?.bom_id || '';
  $('product').value = bom ? productLabel(bom.product_code, bom.product_description) : '';
  $('product').readOnly = !!bom;
  $('version').value = bom?.version || '1';
  $('baseQty').value = Number(bom?.base_qty ?? 1);
  $('notes').value = bom?.notes || '';
  $('isActive').checked = bom ? bom.is_active : true;
  $('itemsBody').innerHTML = '';
  $('opsBody').innerHTML = '';
  (bom?.items || []).forEach(itemRow);
  (bom?.operations || []).forEach(opRow);
  if (!bom) itemRow();
  emptyHint();
  showCost(bom?.cost);
}

async function openModal(id = null) {
  try {
    state.workCenters = await pcpApi('/work-centers') || [];
    fill(id ? await pcpApi(`/boms/${id}`) : null);
    $('modal').showModal();
    if (!id) $('product').focus();
  } catch (e) {
    notify('error', 'Erro ao abrir a ficha', e.message);
  }
}

function collect() {
  const rows = (id) => [...$(id).querySelectorAll('tr:not(.pcp-hint)')];
  const v = (tr, f) => tr.querySelector(`[data-f="${f}"]`).value;
  return {
    product_code: productCodeOf($('product').value),
    version: $('version').value,
    base_qty: $('baseQty').value,
    notes: $('notes').value,
    is_active: $('isActive').checked,
    items: rows('itemsBody')
      .filter((tr) => v(tr, 'component').trim() || v(tr, 'quantity'))
      .map((tr) => ({
        component_code: productCodeOf(v(tr, 'component')),
        quantity: v(tr, 'quantity'),
        unit: v(tr, 'unit'),
        loss_percent: v(tr, 'loss'),
        notes: v(tr, 'notes'),
      })),
    operations: rows('opsBody')
      .filter((tr) => v(tr, 'description').trim())
      .map((tr) => ({
        seq: v(tr, 'seq'),
        work_center_id: v(tr, 'wc') || null,
        description: v(tr, 'description'),
        setup_minutes: v(tr, 'setup'),
        run_minutes_per_unit: v(tr, 'run'),
      })),
  };
}

async function save(e) {
  e.preventDefault();
  const id = $('bomId').value;
  try {
    const bom = await pcpApi(id ? `/boms/${id}` : '/boms', { method: id ? 'PUT' : 'POST', body: collect() });
    fill(bom);
    const changed = bom?.cost_update?.updated?.length || 0;
    showMessage($('formMessage'), changed
      ? `Ficha técnica salva. Preço de Custo atualizado em ${changed} produto(s).`
      : 'Ficha técnica salva.', 'success');
    load();
  } catch (err) {
    showMessage($('formMessage'), err.message);
  }
}

async function remove(id) {
  const row = state.rows.find((r) => r.bom_id === id);
  if (!confirm(`Excluir a ficha técnica de ${row?.product_code}?`)) return;
  try {
    const res = await pcpApi(`/boms/${id}`, { method: 'DELETE' });
    if (res?.deactivated) notify('info', 'Ficha inativada', 'Ela já foi usada em ordens de produção, então foi apenas inativada.');
    load();
  } catch (err) {
    notify('error', 'Não foi possível excluir', err.message);
  }
}

// ── Eventos ───────────────────────────────────────────────────

attachProductSearch($('product'), $('productOptions'));
$('btnNew').addEventListener('click', () => openModal());
$('btnRecalc').addEventListener('click', async () => {
  if (!confirm('Recalcular o Preço de Custo de todos os produtos com ficha técnica ativa, pelos ingredientes?')) return;
  try {
    const res = await pcpApi('/boms/recalc-costs', { method: 'POST' });
    notify('success', 'Custos recalculados', `${res?.updated?.length || 0} produto(s) com Preço de Custo alterado.`);
    load();
  } catch (err) {
    notify('error', 'Não foi possível recalcular', err.message);
  }
});
$('form').addEventListener('input', (e) => {
  if (e.target.matches('[data-f="quantity"], [data-f="loss"], [data-f="unit"], #baseQty')) refreshCost();
});
$('form').addEventListener('change', (e) => {
  if (e.target.matches('[data-f="unit"]')) refreshCost();
});
$('btnClose').addEventListener('click', () => $('modal').close());
$('btnCancel').addEventListener('click', () => $('modal').close());
$('btnAddItem').addEventListener('click', () => { itemRow(); emptyHint(); });
$('btnAddOp').addEventListener('click', () => { opRow(); emptyHint(); });
$('form').addEventListener('submit', save);
$('form').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  btn.closest('tr').remove();
  emptyHint();
  refreshCost();
});
$('search').addEventListener('input', () => { state.page = 1; render(); });
$('includeInactive').addEventListener('change', () => { state.page = 1; render(); });
$('tableBody').addEventListener('click', (e) => {
  const del = e.target.closest('[data-delete]');
  if (del) return remove(Number(del.dataset.delete));
  const edit = e.target.closest('[data-edit]');
  if (edit) openModal(Number(edit.dataset.edit));
});
bindPagination(state, PAGER, render);
load();
