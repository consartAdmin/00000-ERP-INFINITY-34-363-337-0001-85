// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsStock.js — Estoque mínimo e máximo (reposição) | ESM         ║
// ║ API: /api/productsStock/replenishment                                ║
// ║   /           lista + cards      /settings   parâmetros + fornecedors║
// ║   /orders     pedido mínimo      /params     salva mín./máx./prazo   ║
// ║   /product/:id cálculo           /export, /pdf                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';

/* ───────────────────────── Config ───────────────────────── */
function apiBase() {
  try { if (typeof window.getApiBase === 'function') return window.getApiBase() || ''; } catch { /* noop */ }
  return window.API_BASE || window.apiBase || '';
}
const ROOT = () => `${String(apiBase()).replace(/\/$/, '')}/api/productsStock`;
const API = () => `${ROOT()}/replenishment`;

const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  limit: 20,
  total: 0,
  rows: [],
  situations: [],
  settings: null,
  sort: '',
  dir: 'asc',
  filters: { q: '', situation: '', supplier_id: '', group_id: '', subgroup_id: '', with_sales: '' },
  selected: new Set(),
  editing: null,
  orders: [],
};

/* ───────────────────────── Helpers ───────────────────────── */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtQty = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtDaily = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtInt = (v) => Number(v || 0).toLocaleString('pt-BR');
function fmtDate(v) {
  if (!v) return '—';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : String(v);
}
function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-BR');
}
function parseMoney(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

async function api(path, { method = 'GET', body, base = API() } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || data?.error || `Erro HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function alertError(title, error) {
  console.error(`[productsStock] ${title}`, error);
  showCenterModal({ variant: 'error', title, message: error?.message || String(error) });
}
function alertOk(title, message) {
  showCenterModal({ variant: 'success', title, message });
}

async function download(path, filename, button) {
  const label = button?.querySelector('span');
  const original = label?.textContent;
  if (button) button.disabled = true;
  if (label) label.textContent = 'Gerando...';
  try {
    const response = await fetch(`${API()}${path}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.message || data?.error || `Erro HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    alertError('Não foi possível gerar o arquivo', error);
  } finally {
    if (button) button.disabled = false;
    if (label) label.textContent = original;
  }
}

/* ───────────────────────── Situações ───────────────────────── */
function situationOf(key) {
  return state.situations.find((s) => s.key === key) || { key, label: key, color: '#64748b' };
}
const SHORT_LABEL = { ZERO_SALES: 'Zerado c/ venda', OVER: 'Acima do máx.' };

function badge(key) {
  const s = situationOf(key);
  return `<span class="lot-badge" style="--c:${esc(s.color)}">${esc(SHORT_LABEL[key] || s.label)}</span>`;
}

/* ───────────────────────── Filtros ───────────────────────── */
function readMainFilters() {
  state.filters.q = $('fQ').value.trim();
  state.filters.situation = $('fSituation').value;
  state.filters.supplier_id = $('fSupplier').value;
}

function moreFiltersCount() {
  const n = ['group_id', 'subgroup_id', 'with_sales'].filter((k) => state.filters[k]).length;
  $('moreFiltersCount').hidden = !n;
  $('moreFiltersCount').textContent = String(n);
}

function queryString(extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...state.filters, sort: state.sort, dir: state.dir, ...extra }).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined) params.set(k, v);
  });
  return params.toString();
}

function fillSituationSelect() {
  const select = $('fSituation');
  const current = state.filters.situation;
  select.innerHTML = '<option value="">Todas</option><option value="NEED">Comprar agora + zerados</option>' + state.situations
    .map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
  select.value = current;
}

function fillSupplierSelect(list) {
  const current = $('fSupplier').value;
  const opts = (list || []).filter((o) => o.products > 0)
    .map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
  $('fSupplier').innerHTML = `<option value="">Todos</option><option value="none">Sem fornecedor</option>${opts}`;
  $('fSupplier').value = current;
}

async function loadFilterOptions() {
  try {
    const [data, sup] = await Promise.all([api('/filter-options', { base: ROOT() }), api('/settings')]);
    const opt = (list) => (list || []).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    fillSupplierSelect(sup.suppliers);
    $('fGroup').innerHTML = `<option value="">Todos</option>${opt(data.groups)}`;
    $('fSubgroup').innerHTML = `<option value="">Todos</option>${opt(data.subgroups)}`;
  } catch (error) {
    console.error('[productsStock] filter-options', error);
  }
}

/* ───────────────────────── Lista ───────────────────────── */
async function load() {
  $('tbody').innerHTML = '<tr><td colspan="14" class="lots-empty">Carregando…</td></tr>';
  try {
    const data = await api(`?${queryString({ page: state.page, limit: state.limit })}`);
    state.rows = data.rows || [];
    state.total = Number(data.total || 0);
    state.situations = data.situations || [];
    state.settings = data.settings || null;
    fillSituationSelect();
    renderKpis();
    renderRows();
    renderFooter();
  } catch (error) {
    $('tbody').innerHTML = `<tr><td colspan="14" class="lots-empty">Não foi possível carregar: ${esc(error.message)}</td></tr>`;
    console.error('[productsStock] load', error);
  }
}

function kpiSub(s) {
  const soon = state.settings?.soon_days ?? 15;
  switch (s.key) {
    case 'BUY': return `no ponto de pedido · ${fmtMoney(s.buy_value)}`;
    case 'ZERO_SALES': return s.buy_value ? `ruptura · comprar ${fmtMoney(s.buy_value)}` : 'ruptura: vendendo sem estoque';
    case 'SOON': return `chegam ao ponto em até ${soon} dias`;
    case 'OK': return 'entre o ponto de pedido e o máximo';
    case 'OVER': return `capital parado · ${fmtMoney(s.over_value)}`;
    default: return 'use "Calcular pelo consumo"';
  }
}

function renderKpis() {
  $('kpis').innerHTML = state.situations.map((s) => {
    const active = state.filters.situation === s.key ? ' is-active' : '';
    return `<button type="button" class="lots-kpi${active}" style="--k:${esc(s.color)}" data-situation="${esc(s.key)}" title="Filtrar: ${esc(s.label)}">
      <span class="lots-kpi__label"><i></i>${esc(s.label)}</span>
      <span class="lots-kpi__value">${fmtInt(s.items)} ${s.items === 1 ? 'item' : 'itens'}</span>
      <span class="lots-kpi__sub">${esc(kpiSub(s))}</span>
    </button>`;
  }).join('');
}

function coverageHtml(r) {
  const s = situationOf(r.situation);
  if (r.coverage_days === null) {
    return `<div class="cov"><b style="color:#94a3b8">${r.stock_qty > 0 ? 'sem saída' : '—'}</b><i><span style="width:0"></span></i></div>`;
  }
  const days = Math.floor(r.coverage_days);
  const pct = Math.min(100, (r.coverage_days / Math.max(30, (r.lead_days || 0) * 3)) * 100);
  return `<div class="cov" title="Acaba em ${fmtDate(r.runs_out_at)} · pedir até ${fmtDate(r.order_by)}">
    <b style="color:${esc(s.color)}">${days} ${days === 1 ? 'dia' : 'dias'}</b><i><span style="width:${pct}%;background:${esc(s.color)}"></span></i></div>`;
}

const LEAD_SOURCE = { PRODUCT: 'do produto', SUPPLIER: 'fornecedor', DEFAULT: 'padrão' };

function renderRows() {
  if (!state.rows.length) {
    $('tbody').innerHTML = '<tr><td colspan="14" class="lots-empty">Nenhum produto encontrado com os filtros escolhidos.</td></tr>';
    syncSelection();
    return;
  }
  $('tbody').innerHTML = state.rows.map((r) => {
    const checked = state.selected.has(r.product_id) ? ' checked' : '';
    const noParams = r.stock_min <= 0 && r.stock_max <= 0;
    const sug = r.suggestion > 0
      ? `<span class="sug" title="${esc(fmtMoney(r.suggestion_value))}${r.cost_price > 0 ? '' : ' · produto sem custo'}">${fmtQty(r.suggestion)}</span>`
      : '—';
    return `<tr data-id="${r.product_id}">
      <td><input type="checkbox" data-chk="${r.product_id}"${checked}></td>
      <td class="l ps-prod"><b title="${esc(r.product_description)}">${esc(r.product_description || '—')}</b><small>SKU ${esc(r.product_code || '—')}</small></td>
      <td title="${esc(r.product_group_name || '')}"><small>${esc(r.product_group_name || '—')}</small></td>
      <td title="${esc(r.supplier_name || '')}">${esc(r.supplier_name || '—')}</td>
      <td class="ps-lead">${r.lead_days} d<small>${LEAD_SOURCE[r.lead_source] || ''}</small></td>
      <td title="${esc(fmtQty(r.qty_out))} saídas em ${state.settings?.consumption_days ?? 90} dias">${r.daily > 0 ? fmtDaily(r.daily) : '—'}</td>
      <td class="num"><b class="${r.stock_qty <= 0 && r.daily > 0 ? 'ps-zero' : ''}">${fmtQty(r.stock_qty)}</b></td>
      <td class="num">${noParams ? '—' : fmtQty(r.stock_min)}</td>
      <td class="num">${noParams && !r.daily ? '—' : fmtQty(Math.round(r.reorder_point * 10) / 10)}</td>
      <td class="num">${noParams ? '—' : fmtQty(r.stock_max)}</td>
      <td>${coverageHtml(r)}</td>
      <td class="num">${sug}</td>
      <td>${badge(r.situation)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar mín./máx.', attrs: { 'data-act': 'edit', 'data-id': r.product_id } },
        { action: 'view', title: 'Movimentações (Kardex)', attrs: { 'data-act': 'kardex', 'data-id': r.product_id } },
      ])}</td>
    </tr>`;
  }).join('');
  syncSelection();
}

function renderFooter() {
  const pages = Math.max(1, Math.ceil(state.total / state.limit));
  if (state.page > pages) state.page = pages;
  $('tableInfo').textContent = `${fmtInt(state.total)} ${state.total === 1 ? 'produto' : 'produtos'}`;
  $('pageInfo').textContent = `Página ${state.page} de ${pages}`;
  $('btnPrev').disabled = state.page <= 1;
  $('btnNext').disabled = state.page >= pages;
}

function syncSelection() {
  const n = state.selected.size;
  $('btnBulk').disabled = !n;
  $('bulkCount').hidden = !n;
  $('bulkCount').textContent = String(n);
  const pageIds = state.rows.map((r) => r.product_id);
  $('chkAll').checked = pageIds.length > 0 && pageIds.every((id) => state.selected.has(id));
}

/* ───────────────────────── Editar um produto ───────────────────────── */
function calcText(row, lead, min, max) {
  const days = state.settings?.consumption_days ?? 90;
  const daily = row.daily || 0;
  if (!(daily > 0)) {
    return `Sem vendas/saídas nos últimos <b>${days} dias</b>. Sem consumo, o ponto de pedido é o próprio mínimo (<b>${fmtQty(min)}</b>).<br>
      Estoque atual: <b>${fmtQty(row.stock_qty)}</b>.`;
  }
  const during = daily * lead;
  const point = min + during;
  const buy = Math.max(0, Math.ceil(Math.max(max, min) - row.stock_qty + during));
  const cover = Math.floor(row.stock_qty / daily);
  const now = row.stock_qty <= point;
  const arrive = new Date(); arrive.setDate(arrive.getDate() + lead);
  return `Vendas/saídas em ${days} dias: <b>${fmtQty(row.qty_out)}</b> → consumo médio <b>${fmtDaily(daily)}/dia</b><br>
    Consumo durante o prazo: ${fmtDaily(daily)} × ${lead} dias = <b>${fmtQty(Math.round(during * 10) / 10)}</b><br>
    <b>Ponto de pedido</b> = mínimo ${fmtQty(min)} + ${fmtQty(Math.round(during * 10) / 10)} = <b>${fmtQty(Math.round(point * 10) / 10)}</b><br>
    Estoque atual: <b>${fmtQty(row.stock_qty)}</b> (cobre ${cover} dias) → ${now
      ? '<span style="color:#dc2626;font-weight:800">comprar agora</span>'
      : '<span style="color:#16a34a;font-weight:800">ainda não precisa comprar</span>'}<br>
    <b>Comprar</b> = máximo ${fmtQty(max)} − atual ${fmtQty(row.stock_qty)} + ${fmtQty(Math.round(during * 10) / 10)} (consumo até chegar) = <b>${fmtQty(buy)}</b><br>
    ${now ? `Se pedir hoje, chega em <b>${arrive.toLocaleDateString('pt-BR')}</b>.` : `Pedir até <b>${fmtDate(row.order_by)}</b>.`}`;
}

function editLead() {
  const row = state.editing;
  const v = $('eLead').value.trim();
  return v === '' ? (row.lead_time_supplier ?? state.settings?.default_lead_time_days ?? 0) : Number(v);
}

function refreshCalc() {
  const row = state.editing;
  if (!row) return;
  $('eCalc').innerHTML = calcText(row, editLead(), Number($('eMin').value || 0), Number($('eMax').value || 0));
}

async function openEdit(productId) {
  try {
    const { row } = await api(`/product/${productId}`);
    state.editing = row;
    $('editSub').textContent = `${row.product_description || ''} · SKU ${row.product_code || '—'}`;
    $('eManufacturer').value = row.supplier_name || 'Sem fornecedor';
    $('eLead').value = row.lead_time_product ?? '';
    const base = row.lead_time_supplier ?? row.settings?.default_lead_time_days;
    $('eLead').placeholder = String(base ?? '');
    $('eLeadHelp').textContent = row.lead_time_supplier !== null
      ? `Do fornecedor: ${row.lead_time_supplier} d. Preencha só se este produto for diferente.`
      : `Padrão: ${row.settings?.default_lead_time_days} d (fornecedor sem prazo). Preencha só se este produto for diferente.`;
    $('eMin').value = row.stock_min;
    $('eMax').value = row.stock_max;
    $('btnCalc').textContent = `🧮 Calcular pelo consumo dos últimos ${row.settings?.consumption_days ?? 90} dias`;
    $('btnCalc').disabled = !row.calc?.has_consumption;
    $('eCalcHelp').textContent = row.calc?.has_consumption
      ? `Mínimo = consumo durante o prazo; máximo = mínimo + ${row.settings?.max_cover_days ?? 30} dias de consumo.`
      : 'Sem saídas no período para calcular.';
    refreshCalc();
    Modal.open('editModal', { focusSelector: '#eMin' });
  } catch (error) {
    alertError('Não foi possível abrir o produto', error);
  }
}

function calcFromConsumption() {
  const row = state.editing;
  if (!row || !(row.daily > 0)) return;
  const lead = editLead();
  const cover = state.settings?.max_cover_days ?? 30;
  const min = Math.ceil(row.daily * lead);
  $('eMin').value = min;
  $('eMax').value = Math.max(min, Math.ceil(row.daily * (lead + cover)));
  refreshCalc();
}

async function saveEdit(event) {
  event.preventDefault();
  const row = state.editing;
  if (!row) return;
  const min = Number($('eMin').value || 0);
  const max = Number($('eMax').value || 0);
  if (max > 0 && max < min) return alertError('Valores inválidos', new Error('O máximo deve ser maior ou igual ao mínimo.'));
  const button = $('btnSaveEdit');
  button.disabled = true;
  try {
    await api('/params', {
      method: 'PUT',
      body: { items: [{ product_id: row.product_id, stock_min: min, stock_max: max, lead_time_days: $('eLead').value.trim() }] },
    });
    Modal.close('editModal');
    await load();
  } catch (error) {
    alertError('Erro ao salvar', error);
  } finally {
    button.disabled = false;
  }
}

/* ───────────────────────── Editar selecionados ───────────────────────── */
function bulkMode() {
  return document.querySelector('input[name="bulkMode"]:checked')?.value || 'calc';
}
function syncBulkForm() {
  const set = bulkMode() === 'set';
  $('bMin').disabled = !set;
  $('bMax').disabled = !set;
  $('bLeadDaysWrap').hidden = $('bLead').value !== 'set';
}
function openBulk() {
  if (!state.selected.size) return;
  $('bulkSub').textContent = `${state.selected.size} produto(s) selecionado(s).`;
  $('bMin').value = '';
  $('bMax').value = '';
  $('bLead').value = 'keep';
  $('bLeadDays').value = '';
  syncBulkForm();
  Modal.open('bulkModal');
}
async function saveBulk() {
  const mode = bulkMode();
  const leadMode = $('bLead').value;
  const items = [...state.selected].map((id) => {
    const item = { product_id: id };
    if (mode === 'calc') item.calc = true;
    else {
      if ($('bMin').value !== '') item.stock_min = Number($('bMin').value);
      if ($('bMax').value !== '') item.stock_max = Number($('bMax').value);
    }
    if (leadMode === 'clear') item.lead_time_days = '';
    if (leadMode === 'set') item.lead_time_days = $('bLeadDays').value;
    return item;
  });
  const button = $('btnSaveBulk');
  button.disabled = true;
  try {
    const out = await api('/params', { method: 'PUT', body: { items } });
    Modal.close('bulkModal');
    state.selected.clear();
    await load();
    alertOk('Produtos atualizados', `${out.updated} produto(s) atualizado(s)${out.skipped ? `; ${out.skipped} sem saída no período ficaram como estavam` : ''}.`);
  } catch (error) {
    alertError('Erro ao aplicar', error);
  } finally {
    button.disabled = false;
  }
}

/* ───────────────────────── Kardex ───────────────────────── */
async function openKardex(productId) {
  const row = state.rows.find((r) => r.product_id === Number(productId));
  $('kardexSub').textContent = row ? `${row.product_description || ''} · SKU ${row.product_code || '—'}` : '';
  $('kardexBody').innerHTML = '<tr><td colspan="7" class="lots-empty">Carregando…</td></tr>';
  Modal.open('kardexModal');
  try {
    const { rows } = await api(`/product/${productId}/movements?limit=60`);
    $('kardexBody').innerHTML = rows.length ? rows.map((m) => `<tr>
      <td>${esc(fmtDateTime(m.created_at))}</td>
      <td><b style="color:${m.movement_type === 'SAIDA' ? '#dc2626' : m.movement_type === 'ENTRADA' ? '#16a34a' : '#475569'}">${esc(m.movement_type)}</b></td>
      <td><small>${esc(m.origin_module || '—')}</small></td>
      <td class="num">${fmtQty(m.quantity)}</td>
      <td>${esc(m.lot_code || '—')}</td>
      <td>${esc(m.nfe_number || '—')}</td>
      <td class="l"><small>${esc(m.notes || '')}</small></td>
    </tr>`).join('') : '<tr><td colspan="7" class="lots-empty">Nenhuma movimentação.</td></tr>';
  } catch (error) {
    $('kardexBody').innerHTML = `<tr><td colspan="7" class="lots-empty">${esc(error.message)}</td></tr>`;
  }
}

/* ───────────────────────── Pedidos por fornecedor ───────────────────────── */
function orderRowHtml(o, index) {
  const hasMin = o.min_order_value > 0;
  const pct = hasMin ? Math.min(100, o.percent || 0) : 0;
  const color = !hasMin ? '#64748b' : o.reached ? '#16a34a' : '#d97706';
  const label = !hasMin ? 'Sem pedido mínimo' : o.reached ? `${o.percent}% · Atinge o mínimo` : `${o.percent}% · Faltam ${fmtMoney(o.missing)}`;
  const action = hasMin && !o.reached && o.supplier_id
    ? `<button class="btn btn-toolbar btn-sm" type="button" data-complete="${index}">➕ Completar</button>`
    : `<button class="btn btn-new btn-sm" type="button" data-order-pdf="${index}" title="Sugestão de compra deste fornecedor em PDF">🛒 Gerar pedido</button>`;
  const noCost = o.items_without_cost ? ` <small title="Itens sem custo não entram no total" style="color:#d97706">(${o.items_without_cost} sem custo)</small>` : '';
  return `<div class="ord-row">
    <b>${esc(o.supplier_name)}</b>
    <span class="n">${o.lead_days} d</span>
    <span class="n">${o.items}${noCost}</span>
    <span class="n"><b>${fmtMoney(o.total)}</b></span>
    <span class="n">${hasMin ? fmtMoney(o.min_order_value) : '—'}</span>
    <div class="ord-bar"><small style="color:${color}">${esc(label)}</small><i><span style="width:${pct}%;background:${color}"></span></i></div>
    <div class="ord-actions">${action}</div>
  </div>`;
}

function completeHtml(o, index) {
  if (!o.complete?.length) {
    return `<div class="ord-tip"><b>➕ ${esc(o.supplier_name)} (faltam ${fmtMoney(o.missing)}):</b> nenhum outro item deste fornecedor tem consumo e custo para antecipar.
      <div class="ord-actions" style="margin-top:6px"><button class="btn btn-toolbar btn-sm" type="button" data-order-pdf="${index}">🛒 Gerar pedido assim mesmo</button></div></div>`;
  }
  const lines = o.complete.map((c) => `${esc(c.product_description)} · chega ao ponto em ${c.days_to_reorder ?? '—'} dias · +${fmtQty(c.qty)} un. × ${fmtMoney(c.cost_price)} = ${fmtMoney(c.value)}`).join('<br>');
  const total = o.total + o.complete_total;
  return `<div class="ord-tip"><b>➕ Completar ${esc(o.supplier_name)} (faltam ${fmtMoney(o.missing)}):</b> antecipe os itens que vão chegar ao ponto de pedido mais cedo.<br>
    ${lines} → <b>total ${fmtMoney(total)}${o.complete_reaches ? ', atinge o mínimo' : ', ainda abaixo do mínimo'}</b>
    <div class="ord-actions" style="margin-top:6px"><button class="btn btn-new btn-sm" type="button" data-order-pdf="${index}" data-with-complete="1">🛒 Gerar pedido com os itens</button></div></div>`;
}

async function openOrders() {
  $('ordersList').innerHTML = '<div class="lots-empty">Carregando…</div>';
  $('ordersComplete').innerHTML = '';
  Modal.open('ordersModal');
  try {
    const data = await api('/orders');
    state.orders = data.orders || [];
    $('ordersList').innerHTML = state.orders.length
      ? state.orders.map(orderRowHtml).join('')
      : '<div class="lots-empty">Nenhum produto no ponto de pedido agora.</div>';
  } catch (error) {
    $('ordersList').innerHTML = `<div class="lots-empty">${esc(error.message)}</div>`;
  }
}

function onOrdersClick(e) {
  const complete = e.target.closest('[data-complete]');
  if (complete) {
    const o = state.orders[Number(complete.dataset.complete)];
    if (o) $('ordersComplete').innerHTML = completeHtml(o, Number(complete.dataset.complete));
    return;
  }
  const pdf = e.target.closest('[data-order-pdf]');
  if (pdf) {
    const o = state.orders[Number(pdf.dataset.orderPdf)];
    if (!o) return;
    const mf = o.supplier_id ?? 'none';
    const params = new URLSearchParams({ supplier_id: mf });
    if (pdf.dataset.withComplete) params.set('complete', '1');
    const slug = String(o.supplier_name || 'fornecedor').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    download(`/pdf?${params}`, `pedido-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`, pdf);
  }
}

/* ───────────────────────── Parâmetros ───────────────────────── */
async function openSettings() {
  try {
    const data = await api('/settings');
    const s = data.settings;
    $('sDays').value = String(s.consumption_days);
    if (!$('sDays').value) {
      $('sDays').insertAdjacentHTML('beforeend', `<option value="${s.consumption_days}">${s.consumption_days} dias</option>`);
      $('sDays').value = String(s.consumption_days);
    }
    $('sLead').value = s.default_lead_time_days;
    $('sSoon').value = s.soon_days;
    $('sSource').value = s.consumption_source;
    $('sCover').value = s.max_cover_days;
    const money = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    $('mfList').innerHTML = (data.suppliers || []).map((m) => `<div class="mf-row" data-mf="${m.id}">
        <span title="${esc(m.name)}">${esc(m.name)}</span>
        <input type="number" min="0" max="365" step="1" data-lead value="${m.lead_time_days ?? ''}" placeholder="padrão">
        <input type="text" inputmode="decimal" data-min value="${money(m.min_order_value)}" placeholder="sem mínimo">
        <span>${fmtInt(m.products)}</span>
      </div>`).join('') + `<div class="mf-row"><span>Sem fornecedor</span><input type="text" value="padrão" disabled><input type="text" value="—" disabled><span>${fmtInt(data.without_supplier)}</span></div>`;
    $('mfSearch').value = '';
    Modal.open('settingsModal');
  } catch (error) {
    alertError('Não foi possível abrir os parâmetros', error);
  }
}

async function saveSettings() {
  const suppliers = [...document.querySelectorAll('#mfList [data-mf]')].map((row) => ({
    id: Number(row.dataset.mf),
    lead_time_days: row.querySelector('[data-lead]').value.trim(),
    min_order_value: parseMoney(row.querySelector('[data-min]').value),
  }));
  const button = $('btnSaveSettings');
  button.disabled = true;
  try {
    await api('/settings', {
      method: 'PUT',
      body: {
        consumption_days: Number($('sDays').value),
        default_lead_time_days: Number($('sLead').value || 0),
        soon_days: Number($('sSoon').value || 0),
        consumption_source: $('sSource').value,
        max_cover_days: Number($('sCover').value || 30),
        suppliers,
      },
    });
    Modal.close('settingsModal');
    await load();
  } catch (error) {
    alertError('Erro ao salvar os parâmetros', error);
  } finally {
    button.disabled = false;
  }
}

/* ───────────────────────── Eventos ───────────────────────── */
function search() {
  readMainFilters();
  state.page = 1;
  load();
}

function bind() {
  Modal.setup();

  $('btnFilter').addEventListener('click', search);
  $('fQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  $('fSituation').addEventListener('change', search);
  $('fSupplier').addEventListener('change', search);

  $('kpis').addEventListener('click', (e) => {
    const card = e.target.closest('[data-situation]');
    if (!card) return;
    const key = card.dataset.situation;
    state.filters.situation = state.filters.situation === key ? '' : key;
    $('fSituation').value = state.filters.situation;
    state.page = 1;
    load();
  });

  $('btnMoreFilters').addEventListener('click', () => {
    $('fGroup').value = state.filters.group_id;
    $('fSubgroup').value = state.filters.subgroup_id;
    $('fWithSales').value = state.filters.with_sales;
    Modal.open('filtersModal');
  });
  $('btnApplyFilters').addEventListener('click', () => {
    state.filters.group_id = $('fGroup').value;
    state.filters.subgroup_id = $('fSubgroup').value;
    state.filters.with_sales = $('fWithSales').value;
    moreFiltersCount();
    Modal.close('filtersModal');
    search();
  });
  $('btnClearFilters').addEventListener('click', () => {
    ['fGroup', 'fSubgroup', 'fWithSales'].forEach((id) => { $(id).value = ''; });
  });

  $('btnPrev').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load(); } });
  $('btnNext').addEventListener('click', () => { state.page += 1; load(); });
  $('rowsPerPage').addEventListener('change', (e) => { state.limit = Number(e.target.value) || 20; state.page = 1; load(); });

  $('tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'edit') openEdit(btn.dataset.id);
    if (btn.dataset.act === 'kardex') openKardex(btn.dataset.id);
  });
  $('tbody').addEventListener('change', (e) => {
    const chk = e.target.closest('[data-chk]');
    if (!chk) return;
    const id = Number(chk.dataset.chk);
    if (chk.checked) state.selected.add(id); else state.selected.delete(id);
    syncSelection();
  });
  $('chkAll').addEventListener('change', (e) => {
    state.rows.forEach((r) => { if (e.target.checked) state.selected.add(r.product_id); else state.selected.delete(r.product_id); });
    renderRows();
  });

  createSortableTable({
    table: '#repTable',
    defaultColumn: '',
    defaultDirection: 'asc',
    onSort: ({ column, direction }) => {
      state.sort = column;
      state.dir = direction;
      state.page = 1;
      return load();
    },
  });

  $('editForm').addEventListener('submit', saveEdit);
  ['eLead', 'eMin', 'eMax'].forEach((id) => $(id).addEventListener('input', refreshCalc));
  $('btnCalc').addEventListener('click', calcFromConsumption);

  $('btnBulk').addEventListener('click', openBulk);
  document.querySelectorAll('input[name="bulkMode"]').forEach((el) => el.addEventListener('change', syncBulkForm));
  $('bLead').addEventListener('change', syncBulkForm);
  $('btnSaveBulk').addEventListener('click', saveBulk);

  $('btnOrders').addEventListener('click', openOrders);
  $('ordersModal').addEventListener('click', onOrdersClick);
  $('btnOrdersPdf').addEventListener('click', (e) => download('/pdf?complete=1', `sugestao-de-compra-${new Date().toISOString().slice(0, 10)}.pdf`, e.currentTarget));

  $('btnSettings').addEventListener('click', openSettings);
  $('btnSaveSettings').addEventListener('click', saveSettings);
  $('mfSearch').addEventListener('input', () => {
    const term = $('mfSearch').value.trim().toLowerCase();
    document.querySelectorAll('#mfList .mf-row').forEach((row) => {
      row.hidden = !!term && !row.textContent.toLowerCase().includes(term);
    });
  });

  $('btnPdf').addEventListener('click', (e) => {
    readMainFilters();
    download(`/pdf?${queryString()}`, `sugestao-de-compra-${new Date().toISOString().slice(0, 10)}.pdf`, e.currentTarget);
  });
  $('btnExcel').addEventListener('click', (e) => {
    readMainFilters();
    download(`/export?${queryString()}`, `estoque-reposicao-${new Date().toISOString().slice(0, 10)}.xlsx`, e.currentTarget);
  });
}

bind();
loadFilterOptions();
load();
