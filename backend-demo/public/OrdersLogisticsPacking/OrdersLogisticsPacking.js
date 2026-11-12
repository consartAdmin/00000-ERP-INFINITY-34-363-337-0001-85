/*╔══════════════════════════════════════════════════════════════════════════╗
  ║ OrdersLogisticsPacking.js — Montar Pedido para Despacho (CONSART ERP)    ║
  ║ Path: backend/public/OrdersLogisticsPacking/OrdersLogisticsPacking.js     ║
  ║ Vanilla JS | Fetch | HTML5 Drag&Drop | modal.js | centerAlertModal.js     ║
  ║                                                                           ║
  ║ Origem: PEDIDO (ORDER) ou ORÇAMENTO (BUDGET)                              ║
  ║  - Itens à esquerda (pedido / embalado / restante)                        ║
  ║  - Volumes em cards à direita (volume ativo recebe o leitor de código)    ║
  ╚══════════════════════════════════════════════════════════════════════════╝*/

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';

/* ──────────────────────────────────────────────────────────────
   Config / rotas
────────────────────────────────────────────────────────────── */
const API = `${window.apiBase || window.location.origin}/api/packing`;
const enc = encodeURIComponent;

const ROUTES = Object.freeze({
  search: (p) => `${API}/search?${new URLSearchParams(p)}`,
  summary: (s, id) => `${API}/sources/${enc(s)}/${enc(id)}/summary`,
  pdf: (s, id) => `${API}/sources/${enc(s)}/${enc(id)}/pdf`,
  labels: (s, id, volumeId) => `${API}/sources/${enc(s)}/${enc(id)}/labels${volumeId ? `?volume_id=${enc(volumeId)}` : ''}`,
  createVolume: (s, id) => `${API}/sources/${enc(s)}/${enc(id)}/volumes`,
  volume: (volumeId) => `${API}/volumes/${enc(volumeId)}`,
  addItem: (volumeId) => `${API}/volumes/${enc(volumeId)}/items`,
  allocate: (volumeId) => `${API}/volumes/${enc(volumeId)}/allocate-remaining`,
  volumeItem: (viId) => `${API}/volume-items/${enc(viId)}`,
  moveItem: (viId) => `${API}/volume-items/${enc(viId)}/move`,
});

const SOURCE_LABEL = { ORDER: 'Pedido', BUDGET: 'Orçamento' };
const TYPE_LABEL = { BOX: 'CAIXA', PALLET: 'PALETE', BUNDLE: 'FARDO', BAG: 'SACO', OTHER: 'OUTRO' };

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const toNum = (v, def = 0) => {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
};
const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const fmtQty = (v) => toNum(v, 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtKg = (v) => `${toNum(v, 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
const fmtM3 = (v) => `${toNum(v, 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} m³`;
const fmtCm = (v) => toNum(v, 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const fmtMoney = (v) => (v === null || v === undefined ? '—'
  : toNum(v, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtDate = (v) => {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const pill = (text, kind = 'info', extra = '') =>
  `<span class="summary-pill summary-pill--${kind} summary-pill--sm" ${extra}>${text}</span>`;

const pctKind = (pct) => (pct >= 100 ? 'success' : pct > 0 ? 'warning' : 'danger');

async function api(url, opts = {}) {
  const res = await fetch(url, {
    cache: 'no-store',
    ...opts,
    headers: {
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });
const patch = (url, body) => api(url, { method: 'PATCH', body: JSON.stringify(body || {}) });
const del = (url) => api(url, { method: 'DELETE' });

const notifyError = (err, title = 'Atenção') =>
  showCenterModal({ variant: 'error', title, message: esc(err?.message || err || 'Falha na operação.') });
const notifyOk = (message) => showCenterModal({ variant: 'success', title: 'Pronto', message, timeoutMs: 1800 });
const confirmCenter = (title, message, okText = 'Confirmar') =>
  showCenterModal({ variant: 'warning', title, message, okText, closeText: 'Cancelar' });

/* ──────────────────────────────────────────────────────────────
   Estado
────────────────────────────────────────────────────────────── */
const state = {
  source: 'ORDER',
  id: null,
  data: null,
  activeVolumeId: null,
  itemsFilter: 'PENDING',
  search: { rows: [], index: -1 },
};

/* ──────────────────────────────────────────────────────────────
   Carregar
────────────────────────────────────────────────────────────── */
function syncSourceLabels() {
  const label = SOURCE_LABEL[$('fSource').value] || 'Pedido';
  $('fIdLabel').textContent = `Nº do ${label.toLowerCase()}`;
  $('fId').placeholder = $('fSource').value === 'BUDGET' ? 'Ex: 1532' : 'Ex: 724';
}

async function load(source = $('fSource').value, id = $('fId').value, { quiet = false } = {}) {
  const n = toInt(id);
  if (!n) {
    notifyError(`Informe o número do ${String(SOURCE_LABEL[source] || 'pedido').toLowerCase()}.`);
    return;
  }

  try {
    const data = await api(ROUTES.summary(source, n));
    state.source = source;
    state.id = n;
    state.data = data;
    $('fSource').value = source;
    $('fId').value = n;
    syncSourceLabels();

    const vols = data.volumes || [];
    if (!vols.some((v) => Number(v.id) === Number(state.activeVolumeId))) {
      state.activeVolumeId = vols.length ? vols[vols.length - 1].id : null;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('source', source);
    url.searchParams.set('id', n);
    url.searchParams.delete('order_id');
    window.history.replaceState(null, '', url);

    render();
  } catch (err) {
    if (!quiet) notifyError(err, 'Não foi possível carregar');
  }
}

const reload = () => (state.id ? load(state.source, state.id, { quiet: false }) : null);

/* ──────────────────────────────────────────────────────────────
   Render
────────────────────────────────────────────────────────────── */
function render() {
  const d = state.data;
  const loaded = !!d;

  ['btnPdf', 'btnLabels', 'btnNewVolume', 'fScan'].forEach((k) => { $(k).disabled = !loaded; });
  $('btnLabels').disabled = !loaded || !(d.volumes || []).length;

  renderInfo();
  renderItems();
  renderVolumes();
}

function renderInfo() {
  const d = state.data;
  const box = $('infoPills');
  if (!d) {
    box.innerHTML = '<div class="summary-pill summary-pill--info summary-width-auto">Informe a origem e o número e clique em Carregar.</div>';
    return;
  }
  const h = d.head || {};
  const t = d.totals || {};
  const pct = toNum(t.packed_pct, 0);
  const pills = [
    `<div class="summary-pill summary-pill--primary summary-width-auto"><b>${esc(d.sourceLabel)} ${esc(h.id)}</b>&nbsp;· ${esc(h.customer_name || 'Sem cliente')} · ${fmtDate(h.issue_date)}${h.status ? ` · ${esc(h.status)}` : ''}</div>`,
  ];
  if (h.carrier_name) pills.push(`<div class="summary-pill summary-pill--info summary-width-auto">Transportadora: ${esc(h.carrier_name)}</div>`);
  pills.push(`<div class="summary-pill summary-pill--${t.volumes ? 'success' : 'warning'} summary-width-auto">${t.volumes || 0} volume(s)</div>`);
  pills.push(t.pending_items
    ? `<div class="summary-pill summary-pill--warning summary-width-auto">${t.pending_items} item(ns) pendente(s) (${fmtQty(t.pending_qty)})</div>`
    : `<div class="summary-pill summary-pill--success summary-width-auto">Tudo embalado</div>`);
  pills.push(`<div class="summary-pill summary-pill--${pctKind(pct)} summary-width-auto">Embalado ${fmtQty(pct)}%</div>`);
  pills.push(`<div class="summary-pill summary-pill--info summary-width-auto">Peso ${fmtKg(t.weight_kg)}</div>`);
  pills.push(`<div class="summary-pill summary-pill--info summary-width-auto">Cubagem ${fmtM3(t.volume_m3)}</div>`);
  box.innerHTML = pills.join('');
}

function renderItems() {
  const d = state.data;
  const body = $('itemsBody');
  $('itemsTitle').textContent = `Itens do ${String(SOURCE_LABEL[state.source]).toLowerCase()}`;

  if (!d) {
    body.innerHTML = '<tr><td colspan="6" class="text-muted">Nenhum pedido carregado.</td></tr>';
    $('itemsInfo').textContent = '0 itens';
    $('btnAllocateAll').disabled = true;
    return;
  }

  const items = d.items || [];
  const filter = state.itemsFilter;
  const rows = items.filter((it) =>
    filter === 'ALL' ? true : filter === 'DONE' ? it.remaining_qty <= 0 : it.remaining_qty > 0);

  const done = items.filter((it) => it.remaining_qty <= 0).length;
  $('itemsInfo').textContent = `${items.length} itens · ${done} completo(s)`;

  const active = activeVolume();
  const pending = items.some((it) => it.remaining_qty > 0);
  $('btnAllocateAll').disabled = !active || !pending;
  $('btnAllocateAll').textContent = active
    ? `Alocar todos os pendentes no Volume ${active.volume_number}`
    : 'Alocar todos os pendentes';

  if (!rows.length) {
    const msg = !items.length ? 'Sem itens.' : filter === 'PENDING' ? 'Nenhum item pendente. Tudo embalado!' : 'Nenhum item.';
    body.innerHTML = `<tr><td colspan="6" class="text-muted">${msg}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((it) => {
    const pendingRow = it.remaining_qty > 0;
    return `
      <tr data-item-id="${esc(it.item_id)}" ${pendingRow ? 'draggable="true" style="cursor:grab"' : ''}>
        <td class="td-left"><b>${esc(it.product_code)}</b> · ${esc(it.description)}</td>
        <td>${esc(it.unit)}</td>
        <td class="td-right">${fmtQty(it.ordered_qty)}</td>
        <td class="td-right">${fmtQty(it.packed_qty)}</td>
        <td class="td-right">${pendingRow ? pill(fmtQty(it.remaining_qty), 'warning') : pill('OK', 'success')}</td>
        <td>${pendingRow ? actionIconsHtml([{ action: 'add', title: 'Adicionar ao volume', attrs: { 'data-act': 'add' } }]) : ''}</td>
      </tr>`;
  }).join('');
}

function activeVolume() {
  return (state.data?.volumes || []).find((v) => Number(v.id) === Number(state.activeVolumeId)) || null;
}

function renderVolumes() {
  const grid = $('volumesGrid');
  const vols = state.data?.volumes || [];
  const items = state.data?.volumeItems || [];
  // section.css usa display:flex, então controla pelo style (o atributo hidden não basta)
  $('volumesEmpty').style.display = vols.length ? 'none' : '';

  const active = activeVolume();
  $('activeVolumePill').textContent = active ? `Ativo: Volume ${active.volume_number}` : 'Nenhum volume ativo';
  $('fScanLabel').textContent = active ? `Bipar código de barras → Volume ${active.volume_number}` : 'Bipar código de barras';

  grid.innerHTML = vols.map((v) => {
    const isActive = Number(v.id) === Number(state.activeVolumeId);
    const list = items.filter((x) => Number(x.volume_id) === Number(v.id));
    const dims = `${fmtCm(v.height_cm)} × ${fmtCm(v.width_cm)} × ${fmtCm(v.length_cm)} cm`;
    const rows = list.length
      ? list.map((x) => `
          <tr data-vi-id="${esc(x.id)}" draggable="true" style="cursor:grab">
            <td class="td-left">${esc(x.description)}</td>
            <td>${esc(x.unit)}</td>
            <td class="td-right">${fmtQty(x.quantity)}</td>
            <td class="td-right">${fmtQty(x.line_weight_kg)}</td>
            <td>${actionIconsHtml([
        { action: 'edit', title: 'Alterar quantidade', attrs: { 'data-act': 'vi-edit' } },
        { action: 'cancel', title: 'Remover do volume', attrs: { 'data-act': 'vi-del' } },
      ])}</td>
          </tr>`).join('')
      : '<tr><td colspan="5" class="text-muted">Volume vazio.</td></tr>';

    return `
      <div class="section ${isActive ? 'section-blue section-border-medium' : 'section-border-thin'} section-p-3 section-gap-2"
           data-volume-id="${esc(v.id)}" style="cursor:pointer">
        <div class="consart-lr-header">
          <div>
            <b>Volume ${esc(v.volume_number)}</b>
            ${pill(TYPE_LABEL[v.volume_type] || esc(v.volume_type || ''), 'primary')}
            ${isActive ? pill('ATIVO', 'success') : ''}
            <div class="text-muted">${dims} · ${fmtM3(v.volume_m3)} · ${fmtKg(v.weight_kg)}</div>
            ${v.description ? `<div class="text-muted">${esc(v.description)}</div>` : ''}
          </div>
          ${actionIconsHtml([
      { action: 'edit', title: 'Editar volume (tipo, medidas, tara)', attrs: { 'data-act': 'vol-edit' } },
      { action: 'document', title: 'Etiqueta deste volume', attrs: { 'data-act': 'vol-label' } },
      { action: 'delete', title: 'Excluir volume', attrs: { 'data-act': 'vol-del' } },
    ])}
        </div>
        <table class="table table-zebra">
          <thead><tr><th class="th-left">Produto</th><th>U.M.</th><th class="th-right">Qtd</th><th class="th-right">Peso</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="section section-gray section-border-thin section-center section-p-2 text-muted" data-dropzone>
          Arraste itens aqui
        </div>
      </div>`;
  }).join('');
}

/* ──────────────────────────────────────────────────────────────
   Pesquisa (modal)
────────────────────────────────────────────────────────────── */
let searchTimer = null;
let searchSeq = 0;

function openSearch() {
  $('sSource').value = 'ALL';
  Modal.open('searchModal', { focusSelector: '#sQ' });
  doSearch();
}

async function doSearch() {
  const seq = ++searchSeq;
  $('searchHint').textContent = 'Buscando...';
  try {
    const data = await api(ROUTES.search({
      q: $('sQ').value.trim(),
      source: $('sSource').value,
      situation: $('sSituation').value,
      limit: 50,
    }));
    if (seq !== searchSeq) return;
    state.search.rows = data.rows || [];
    renderSearch();
    $('searchHint').textContent = `${state.search.rows.length} resultado(s) · ↑/↓ e Enter para selecionar`;
  } catch (err) {
    if (seq !== searchSeq) return;
    $('searchHint').textContent = 'Falha ao buscar.';
    notifyError(err);
  }
}

function renderSearch() {
  const rows = state.search.rows;
  state.search.index = rows.length ? 0 : -1;
  $('searchBody').innerHTML = rows.length
    ? rows.map((r, i) => `
      <tr data-index="${i}" style="cursor:pointer">
        <td>${pill(esc(r.label), r.source === 'BUDGET' ? 'info' : 'primary')}</td>
        <td>${esc(r.id)}</td>
        <td class="td-left">${esc(r.customer_name || '—')}</td>
        <td>${fmtDate(r.issue_date)}</td>
        <td>${esc(r.status || '—')}</td>
        <td class="td-right">${fmtMoney(r.total_amount)}</td>
        <td>${pill(`${fmtQty(r.packed_pct)}%`, pctKind(toNum(r.packed_pct, 0)))}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="text-muted">Nenhum pedido ou orçamento encontrado.</td></tr>';
  highlightSearch();
}

function highlightSearch() {
  [...$('searchBody').querySelectorAll('tr[data-index]')].forEach((tr) => {
    const on = Number(tr.dataset.index) === state.search.index;
    tr.style.outline = on ? '2px solid #2563eb' : '';
    tr.style.outlineOffset = on ? '-2px' : '';
    if (on) tr.scrollIntoView({ block: 'nearest' });
  });
}

function pickSearch(index) {
  const r = state.search.rows[index];
  if (!r) return;
  Modal.close('searchModal');
  state.activeVolumeId = null;
  load(r.source, r.id);
}

/* ──────────────────────────────────────────────────────────────
   Volume (modal criar/editar)
────────────────────────────────────────────────────────────── */
function openVolumeModal(volume = null) {
  const editing = !!volume;
  $('volumeTitle').textContent = editing ? `Editar Volume ${volume.volume_number}` : 'Criar volume';
  $('btnSaveVolume').textContent = editing ? 'Salvar' : 'Criar volume';
  $('vId').value = editing ? volume.id : '';
  $('vType').value = volume?.volume_type || 'BOX';
  $('vDesc').value = volume?.description || '';
  $('vH').value = editing ? toNum(volume.height_cm, 0) : '';
  $('vW').value = editing ? toNum(volume.width_cm, 0) : '';
  $('vL').value = editing ? toNum(volume.length_cm, 0) : '';
  $('vTare').value = editing ? toNum(volume.tare_kg, 0) : '';
  $('vNotes').value = volume?.notes || '';
  $('vCopies').value = 1;
  $('vCopiesWrap').hidden = editing;
  Modal.open('volumeModal', { focusSelector: '#vType' });
}

async function saveVolume(e) {
  e.preventDefault();
  const body = {
    volume_type: $('vType').value,
    description: $('vDesc').value,
    height_cm: toNum($('vH').value, 0),
    width_cm: toNum($('vW').value, 0),
    length_cm: toNum($('vL').value, 0),
    tare_kg: toNum($('vTare').value, 0),
    notes: $('vNotes').value,
  };
  if ([body.height_cm, body.width_cm, body.length_cm, body.tare_kg].some((v) => v < 0)) {
    notifyError('Medidas e tara não podem ser negativas.');
    return;
  }
  const id = toInt($('vId').value);
  try {
    if (id) {
      await patch(ROUTES.volume(id), body);
    } else {
      const out = await post(ROUTES.createVolume(state.source, state.id), { ...body, copies: toInt($('vCopies').value) || 1 });
      const created = out.rows || [];
      if (created.length) state.activeVolumeId = created[created.length - 1].id;
    }
    Modal.close('volumeModal');
    await reload();
  } catch (err) {
    notifyError(err);
  }
}

async function deleteVolume(volume) {
  const ok = await confirmCenter(
    'Excluir volume',
    `Excluir o <b>Volume ${esc(volume.volume_number)}</b>? Os itens dele voltam para pendentes e os volumes seguintes são renumerados.`,
    'Sim, excluir'
  );
  if (ok !== true) return;
  try {
    await del(ROUTES.volume(volume.id));
    if (Number(state.activeVolumeId) === Number(volume.id)) state.activeVolumeId = null;
    await reload();
  } catch (err) {
    notifyError(err);
  }
}

/* ──────────────────────────────────────────────────────────────
   Item → volume (modal)
────────────────────────────────────────────────────────────── */
const itemModalCtx = { item: null };

function findItem(itemId) {
  return (state.data?.items || []).find((x) => Number(x.item_id) === Number(itemId)) || null;
}

function unitOptionsFor(item) {
  // primeira opção = unidade do item; depois as demais unidades ativas do produto
  const opts = [{ value: '', label: `${item.unit} (unidade do item)`, fator: item.conversion_factor || 1, weight: item.unit_weight_kg }];
  for (const u of item.units || []) {
    if (Number(u.barcode_id) === Number(item.unit_barcode_id)) continue;
    opts.push({ value: String(u.barcode_id), label: `${u.unit} (fator ${fmtQty(u.fator)})`, fator: u.fator || 1, weight: u.weight_kg });
  }
  return opts;
}

function updateItemModalTotals() {
  const item = itemModalCtx.item;
  if (!item) return;
  const opt = itemModalCtx.units.find((o) => o.value === $('iUnit').value) || itemModalCtx.units[0];
  const factorItem = item.conversion_factor || 1;
  const qtyItem = (toNum($('iQty').value, 0) * opt.fator) / factorItem;
  const w = toNum($('iWeight').value, 0);
  $('iTotalWeight').value = fmtKg(qtyItem * w);
  const remainingInUnit = (item.remaining_qty * factorItem) / opt.fator;
  $('iQtyLabel').textContent = `Quantidade (restante ${fmtQty(remainingInUnit)})`;
}

function openItemModal(itemId, volumeId = state.activeVolumeId) {
  const item = findItem(itemId);
  if (!item) return;
  const vols = state.data?.volumes || [];
  if (!vols.length) {
    notifyError('Crie um volume antes de adicionar itens.');
    return;
  }
  itemModalCtx.item = item;
  itemModalCtx.units = unitOptionsFor(item);

  $('iItemId').value = item.item_id;
  $('iProduct').value = `${item.product_code} · ${item.description}`;
  $('iVolume').innerHTML = vols.map((v) =>
    `<option value="${esc(v.id)}">Volume ${esc(v.volume_number)} · ${esc(TYPE_LABEL[v.volume_type] || v.volume_type)}</option>`).join('');
  $('iVolume').value = String(volumeId || vols[vols.length - 1].id);
  $('iUnit').innerHTML = itemModalCtx.units.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  $('iQty').value = item.remaining_qty;
  $('iWeight').value = toNum(item.unit_weight_kg, 0);
  $('iWeightLabel').textContent = `Peso por ${item.unit} (kg)`;
  $('iDims').value = `${fmtCm(item.unit_height_cm)} × ${fmtCm(item.unit_width_cm)} × ${fmtCm(item.unit_length_cm)}`;
  $('itemTitle').textContent = 'Adicionar ao volume';
  updateItemModalTotals();
  Modal.open('itemModal', { focusSelector: '#iQty' });
  setTimeout(() => $('iQty').select?.(), 80);
}

async function saveItem(e) {
  e.preventDefault();
  const item = itemModalCtx.item;
  const volumeId = toInt($('iVolume').value);
  const qty = toNum($('iQty').value, 0);
  if (!item || !volumeId) return;
  if (!(qty > 0)) {
    notifyError('Informe uma quantidade maior que zero.');
    return;
  }
  const body = { item_id: item.item_id, quantity: qty };
  if ($('iUnit').value) body.unit_barcode_id = toInt($('iUnit').value);
  const w = toNum($('iWeight').value, NaN);
  if (Number.isFinite(w) && Math.abs(w - toNum(item.unit_weight_kg, 0)) > 0.00001) body.unit_weight_kg = w;

  try {
    await post(ROUTES.addItem(volumeId), body);
    state.activeVolumeId = volumeId;
    Modal.close('itemModal');
    await reload();
  } catch (err) {
    notifyError(err);
  }
}

async function editVolumeItem(vi) {
  const result = await showCenterModal({
    variant: 'info',
    title: 'Alterar quantidade',
    message: `
      <div class="fields fields-h-6 fields-w-full fields-font-3">
        <label for="cmQty">${esc(vi.description)} (${esc(vi.unit)})</label>
        <input id="cmQty" type="number" min="0.001" step="0.001" value="${esc(toNum(vi.quantity, 0))}" />
      </div>`,
    buttons: [
      { label: 'Cancelar', variant: 'cancel', action: () => null },
      {
        label: 'Salvar',
        variant: 'success',
        action: (ref) => {
          const root = ref?.card || ref?.el || document;
          return toNum(root.querySelector('#cmQty')?.value ?? document.getElementById('cmQty')?.value, 0);
        },
      },
    ],
  });
  if (!(toNum(result, 0) > 0)) return;
  try {
    await patch(ROUTES.volumeItem(vi.id), { quantity: toNum(result, 0) });
    await reload();
  } catch (err) {
    notifyError(err);
  }
}

async function removeVolumeItem(vi) {
  const ok = await confirmCenter('Remover item', `Remover <b>${esc(vi.description)}</b> deste volume?`, 'Sim, remover');
  if (ok !== true) return;
  try {
    await del(ROUTES.volumeItem(vi.id));
    await reload();
  } catch (err) {
    notifyError(err);
  }
}

async function allocateAll() {
  const v = activeVolume();
  if (!v) return;
  const t = state.data?.totals || {};
  const ok = await confirmCenter(
    'Alocar pendentes',
    `Colocar os <b>${t.pending_items}</b> item(ns) pendente(s) no <b>Volume ${esc(v.volume_number)}</b>?`,
    'Sim, alocar'
  );
  if (ok !== true) return;
  try {
    await post(ROUTES.allocate(v.id));
    await reload();
  } catch (err) {
    notifyError(err);
  }
}

/* ──────────────────────────────────────────────────────────────
   Leitor de código de barras → volume ativo
────────────────────────────────────────────────────────────── */
async function onScan(code) {
  const barcode = String(code || '').trim();
  if (!barcode) return;
  const v = activeVolume();
  if (!v) {
    notifyError('Crie ou selecione um volume antes de bipar.');
    return;
  }

  const items = state.data?.items || [];
  // procura nas unidades do produto (prioriza itens com saldo)
  let match = null;
  for (const it of [...items].sort((a, b) => (b.remaining_qty > 0) - (a.remaining_qty > 0))) {
    const u = (it.units || []).find((x) => String(x.barcode || '').trim() === barcode);
    if (u) { match = { it, u }; break; }
    if (String(it.product_code).trim() === barcode) { match = { it, u: null }; break; }
  }

  if (!match) {
    notifyError(`Código <b>${esc(barcode)}</b> não pertence a nenhum item deste ${String(SOURCE_LABEL[state.source]).toLowerCase()}.`, 'Código não encontrado');
    return;
  }
  if (match.it.remaining_qty <= 0) {
    notifyError(`<b>${esc(match.it.description)}</b> já está todo embalado.`, 'Item completo');
    return;
  }

  const body = { item_id: match.it.item_id, quantity: 1 };
  if (match.u && Number(match.u.barcode_id) !== Number(match.it.unit_barcode_id)) body.unit_barcode_id = match.u.barcode_id;

  try {
    await post(ROUTES.addItem(v.id), body);
    await reload();
  } catch (err) {
    notifyError(err);
  }
}

/* ──────────────────────────────────────────────────────────────
   PDFs
────────────────────────────────────────────────────────────── */
function openPdf(url) {
  window.open(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, '_blank', 'noopener');
}

/* ──────────────────────────────────────────────────────────────
   Eventos
────────────────────────────────────────────────────────────── */
function bindEvents() {
  $('fSource').addEventListener('change', syncSourceLabels);
  $('btnLoad').addEventListener('click', () => { state.activeVolumeId = null; load(); });
  $('btnReload').addEventListener('click', reload);
  $('fId').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); state.activeVolumeId = null; load(); }
  });
  $('btnSearch').addEventListener('click', openSearch);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); openSearch(); }
  });

  $('btnNewVolume').addEventListener('click', () => openVolumeModal());
  $('volumeForm').addEventListener('submit', saveVolume);
  $('itemForm').addEventListener('submit', saveItem);
  $('iUnit').addEventListener('change', () => {
    const opt = itemModalCtx.units.find((o) => o.value === $('iUnit').value);
    const item = itemModalCtx.item;
    if (opt && item) {
      // peso por unidade do item, convertido da unidade escolhida quando o item não tem peso
      if (!(toNum(item.unit_weight_kg, 0) > 0) && opt.weight > 0) {
        $('iWeight').value = Math.round(((opt.weight * (item.conversion_factor || 1)) / opt.fator) * 10000) / 10000;
      }
      const remainingInUnit = (item.remaining_qty * (item.conversion_factor || 1)) / opt.fator;
      $('iQty').value = Math.floor(remainingInUnit * 1000) / 1000;
    }
    updateItemModalTotals();
  });
  $('iQty').addEventListener('input', updateItemModalTotals);
  $('iWeight').addEventListener('input', updateItemModalTotals);

  $('btnPdf').addEventListener('click', () => state.id && openPdf(ROUTES.pdf(state.source, state.id)));
  $('btnLabels').addEventListener('click', () => state.id && openPdf(ROUTES.labels(state.source, state.id)));
  $('btnAllocateAll').addEventListener('click', allocateAll);
  $('fItemsFilter').addEventListener('change', () => { state.itemsFilter = $('fItemsFilter').value; renderItems(); });

  $('fScan').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = $('fScan').value;
    $('fScan').value = '';
    onScan(code);
  });

  // Itens (esquerda)
  $('itemsBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="add"]');
    const tr = e.target.closest('tr[data-item-id]');
    if (btn && tr) openItemModal(tr.dataset.itemId);
  });
  $('itemsBody').addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[data-item-id]');
    if (!tr) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'item', id: tr.dataset.itemId }));
    e.dataTransfer.effectAllowed = 'copyMove';
  });

  // Volumes (direita)
  const grid = $('volumesGrid');
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-volume-id]');
    if (!card) return;
    const volume = (state.data?.volumes || []).find((v) => String(v.id) === card.dataset.volumeId);
    if (!volume) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    const viTr = e.target.closest('tr[data-vi-id]');
    const vi = viTr ? (state.data?.volumeItems || []).find((x) => String(x.id) === viTr.dataset.viId) : null;

    if (act === 'vol-edit') return openVolumeModal(volume);
    if (act === 'vol-del') return deleteVolume(volume);
    if (act === 'vol-label') return openPdf(ROUTES.labels(state.source, state.id, volume.id));
    if (act === 'vi-edit' && vi) return editVolumeItem(vi);
    if (act === 'vi-del' && vi) return removeVolumeItem(vi);

    if (Number(state.activeVolumeId) !== Number(volume.id)) {
      state.activeVolumeId = volume.id;
      renderItems();
      renderVolumes();
    }
  });
  grid.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[data-vi-id]');
    if (!tr) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'vi', id: tr.dataset.viId }));
    e.dataTransfer.effectAllowed = 'move';
  });
  grid.addEventListener('dragover', (e) => {
    const card = e.target.closest('[data-volume-id]');
    if (!card) return;
    e.preventDefault();
    card.querySelector('[data-dropzone]')?.classList.add('section-blue');
  });
  grid.addEventListener('dragleave', (e) => {
    const card = e.target.closest('[data-volume-id]');
    if (card && !card.contains(e.relatedTarget)) card.querySelector('[data-dropzone]')?.classList.remove('section-blue');
  });
  grid.addEventListener('drop', async (e) => {
    const card = e.target.closest('[data-volume-id]');
    if (!card) return;
    e.preventDefault();
    card.querySelector('[data-dropzone]')?.classList.remove('section-blue');
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch { return; }
    const volumeId = toInt(card.dataset.volumeId);
    if (payload?.kind === 'item') {
      openItemModal(payload.id, volumeId);
    } else if (payload?.kind === 'vi') {
      try {
        await patch(ROUTES.moveItem(payload.id), { to_volume_id: volumeId });
        await reload();
      } catch (err) {
        notifyError(err);
      }
    }
  });

  // Pesquisa
  $('sQ').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 300);
  });
  $('sSource').addEventListener('change', doSearch);
  $('sSituation').addEventListener('change', doSearch);
  $('sQ').addEventListener('keydown', (e) => {
    const n = state.search.rows.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); state.search.index = (state.search.index + 1) % n; highlightSearch(); }
    if (e.key === 'ArrowUp' && n) { e.preventDefault(); state.search.index = (state.search.index - 1 + n) % n; highlightSearch(); }
    if (e.key === 'Enter') { e.preventDefault(); pickSearch(state.search.index); }
  });
  $('searchBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (tr) pickSearch(Number(tr.dataset.index));
  });
}

/* ──────────────────────────────────────────────────────────────
   Boot
────────────────────────────────────────────────────────────── */
function boot() {
  Modal.setup();
  bindEvents();
  syncSourceLabels();
  render();

  const p = new URLSearchParams(window.location.search);
  const source = String(p.get('source') || (p.get('budget_id') ? 'BUDGET' : 'ORDER')).toUpperCase();
  const id = p.get('id') || p.get('order_id') || p.get('budget_id');
  if (toInt(id)) load(source === 'BUDGET' ? 'BUDGET' : 'ORDER', id);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// usado nos testes/prints
export { state, notifyOk };
