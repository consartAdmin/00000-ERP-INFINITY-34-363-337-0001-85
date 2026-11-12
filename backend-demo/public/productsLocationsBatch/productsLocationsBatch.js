// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsLocationsBatch.js — Localizações em Lote (CONSART ERP | ESM) ║
// ║ Lista produtos + localização atual, marca vários e grava a mesma     ║
// ║ localização em todos (MOVER ou ADICIONAR).                           ║
// ║ API: /api/products-locations/batch/products  (GET)                   ║
// ║      /api/products-locations/batch           (POST)                  ║
// ║      /api/locations/{locals,corridors,shelves,bins,positions}        ║
// ║      /api/locations-barcode/read/:barcode    (etiqueta LOC-)         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';

const API_BASE = String(window.API_BASE || window.location.origin).replace(/\/$/, '');
const BATCH_API = `${API_BASE}/api/products-locations/batch`;
const LOC_API = `${API_BASE}/api/locations`;
const BARCODE_API = `${API_BASE}/api/locations-barcode`;

const $ = (sel) => document.querySelector(sel);

/* --------------------------------------------------------------------- */
/* Estado                                                                */
/* --------------------------------------------------------------------- */
const state = {
  page: 1,
  pageSize: 50,
  total: 0,
  rows: [],
  selected: new Map(), // product_code → row
  locals: [],
  localNames: new Map(), // id → name
  filters: { q: '', store_id: '', corredor: '', withoutLocation: false, positiveStock: false },
  sort: { column: 'descricao', direction: 'asc' },
  saving: false,
};

/* --------------------------------------------------------------------- */
/* Fetch                                                                 */
/* --------------------------------------------------------------------- */
async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

const asArray = (data) => (Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.data) ? data.data : []);

/* --------------------------------------------------------------------- */
/* Helpers de texto                                                      */
/* --------------------------------------------------------------------- */
const localName = (id) => (id == null ? '' : state.localNames.get(Number(id)) || `LOCAL ${id}`);

function locationLabel(r) {
  if (!r || (r.location_id == null && !r.corredor && !r.store_id)) return null;
  const parts = [localName(r.store_id) || '—'];
  if (r.corredor) parts.push(r.corredor);
  if (r.prateleira) parts.push(`G${r.prateleira}`);
  if (r.bandeja) parts.push(`B${r.bandeja}`);
  if (r.box) parts.push(`P${r.box}`);
  return parts.join(' · ');
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtQty = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function td(text, className) {
  const cell = document.createElement('td');
  cell.textContent = text ?? '';
  if (className) cell.className = className;
  if (text) cell.title = String(text);
  return cell;
}

function fillSelect(select, items, placeholder, valueKey = 'id') {
  select.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  select.appendChild(first);
  items.forEach((it) => {
    const opt = document.createElement('option');
    opt.value = String(it[valueKey]);
    opt.textContent = it.name;
    opt.dataset.name = it.name;
    select.appendChild(opt);
  });
}

const selectedName = (select) => (select?.value ? select.options[select.selectedIndex]?.dataset.name?.trim() || null : null);

/* --------------------------------------------------------------------- */
/* Locais / filtros                                                      */
/* --------------------------------------------------------------------- */
async function loadLocals() {
  try {
    state.locals = asArray(await apiGet(`${LOC_API}/locals?activeOnly=true`));
  } catch (err) {
    console.error('[localizacoesLote] loadLocals', err);
    state.locals = [];
  }
  state.localNames = new Map(state.locals.map((l) => [Number(l.id), l.name]));
  fillSelect($('#plbFilterLocal'), state.locals, 'Todos');
  fillSelect($('#plbDestLocal'), state.locals, 'Selecione...');
}

async function loadFilterCorridors() {
  const localId = $('#plbFilterLocal').value;
  const select = $('#plbFilterCorridor');
  if (!localId) {
    fillSelect(select, [], 'Todos');
    select.disabled = true;
    return;
  }
  try {
    const rows = asArray(await apiGet(`${LOC_API}/corridors?localId=${encodeURIComponent(localId)}&activeOnly=true`));
    fillSelect(select, rows, 'Todos', 'name');
  } catch (err) {
    console.error('[localizacoesLote] loadFilterCorridors', err);
    fillSelect(select, [], 'Todos');
  }
  select.disabled = false;
}

function readFilters() {
  const without = $('#plbWithoutLocation').checked;
  state.filters = {
    q: $('#plbSearch').value.trim(),
    store_id: without ? '' : $('#plbFilterLocal').value,
    corredor: without ? '' : $('#plbFilterCorridor').value,
    withoutLocation: without,
    positiveStock: $('#plbPositiveStock').checked,
  };
}

function filterParams() {
  const p = new URLSearchParams();
  const f = state.filters;
  if (f.q) p.set('q', f.q);
  if (f.store_id) p.set('store_id', f.store_id);
  if (f.corredor) p.set('corredor', f.corredor);
  if (f.withoutLocation) p.set('withoutLocation', 'true');
  if (f.positiveStock) p.set('positiveStock', 'true');
  return p;
}

/* --------------------------------------------------------------------- */
/* Lista                                                                 */
/* --------------------------------------------------------------------- */
async function loadProducts() {
  const params = filterParams();
  if (state.sort.column) {
    params.set('sortColumn', state.sort.column);
    params.set('sortDir', state.sort.direction);
  }
  params.set('limit', String(state.pageSize));
  params.set('offset', String((state.page - 1) * state.pageSize));

  const tbody = $('#plbTbody');
  tbody.innerHTML = '<tr><td colspan="10" class="plb-empty">Carregando...</td></tr>';

  try {
    const data = await apiGet(`${BATCH_API}/products?${params}`);
    state.rows = asArray(data);
    state.total = Number(data?.total || 0);
  } catch (err) {
    console.error('[localizacoesLote] loadProducts', err);
    state.rows = [];
    state.total = 0;
    tbody.innerHTML = '';
    tbody.appendChild(emptyRow(`Erro ao carregar produtos: ${err.message}`));
    renderFooter();
    return;
  }

  renderTable();
  renderFooter();
}

function emptyRow(text) {
  const tr = document.createElement('tr');
  const cell = td(text, 'plb-empty');
  cell.colSpan = 10;
  tr.appendChild(cell);
  return tr;
}

function renderTable() {
  const tbody = $('#plbTbody');
  tbody.innerHTML = '';

  if (!state.rows.length) {
    tbody.appendChild(emptyRow('Nenhum produto encontrado.'));
    syncPageCheckbox();
    return;
  }

  const frag = document.createDocumentFragment();
  state.rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.dataset.code = r.product_code;
    if (state.selected.has(r.product_code)) tr.classList.add('plb-row-selected');

    const chkCell = document.createElement('td');
    chkCell.className = 'table-col-select';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = state.selected.has(r.product_code);
    chk.setAttribute('aria-label', `Selecionar ${r.product_code}`);
    chkCell.appendChild(chk);
    tr.appendChild(chkCell);

    tr.appendChild(td(r.product_code));
    tr.appendChild(td(r.description));

    if (locationLabel(r) === null) {
      const none = td('sem localização', 'plb-none');
      none.colSpan = 5;
      tr.appendChild(none);
    } else {
      tr.appendChild(td(localName(r.store_id)));
      tr.appendChild(td(r.corredor));
      tr.appendChild(td(r.prateleira));
      tr.appendChild(td(r.bandeja));
      tr.appendChild(td(r.box));
    }

    tr.appendChild(td(fmtQty(r.stock_qty), 'plb-qty'));
    tr.appendChild(td(r.other_locations ? `+${r.other_locations}` : '', 'plb-other'));
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  syncPageCheckbox();
}

function renderFooter() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page > pages) state.page = pages;
  $('#plbTotalInfo').textContent = `${state.total.toLocaleString('pt-BR')} produto(s)`;
  $('#plbPageInfo').textContent = `Página ${state.page} de ${pages}`;
  $('#plbBtnPrev').disabled = state.page <= 1;
  $('#plbBtnNext').disabled = state.page >= pages;
  $('#plbBtnSelectAll').textContent = `Marcar todos do filtro (${state.total.toLocaleString('pt-BR')})`;
  $('#plbBtnSelectAll').disabled = !state.total;
  renderSelection();
}

function renderSelection() {
  const n = state.selected.size;
  $('#plbSelectedInfo').textContent = `${n.toLocaleString('pt-BR')} selecionado(s)`;
  $('#plbSelectedCountBtn').textContent = `(${n})`;
  $('#plbSelectedCountConfirm').textContent = `(${n})`;
  $('#plbBtnOpenModal').disabled = n === 0;
  $('#plbBtnClearSelection').disabled = n === 0;
}

function syncPageCheckbox() {
  const box = $('#plbSelectPage');
  const codes = state.rows.map((r) => r.product_code);
  const marked = codes.filter((c) => state.selected.has(c)).length;
  box.checked = codes.length > 0 && marked === codes.length;
  box.indeterminate = marked > 0 && marked < codes.length;
}

function toggleRow(code, force) {
  const row = state.rows.find((r) => r.product_code === code);
  if (!row) return;
  const on = force ?? !state.selected.has(code);
  if (on) state.selected.set(code, row);
  else state.selected.delete(code);

  const tr = $('#plbTbody').querySelector(`tr[data-code="${CSS.escape(code)}"]`);
  if (tr) {
    tr.classList.toggle('plb-row-selected', on);
    const chk = tr.querySelector('input[type="checkbox"]');
    if (chk) chk.checked = on;
  }
}

async function selectAllFromFilter() {
  const params = filterParams();
  params.set('codesOnly', 'true');
  try {
    const data = await apiGet(`${BATCH_API}/products?${params}`);
    const rows = asArray(data);
    rows.forEach((r) => state.selected.set(r.product_code, r));
    renderTable();
    renderSelection();
    if (Number(data?.total || 0) > rows.length) {
      showCenterModal({
        variant: 'warning',
        title: 'Limite de seleção',
        message: `Foram marcados ${rows.length} produtos (máximo por vez). Refine o filtro para os demais.`,
      });
    }
  } catch (err) {
    showCenterModal({ variant: 'error', title: 'Erro', message: escapeHtml(err.message) });
  }
}

/* --------------------------------------------------------------------- */
/* Modal — destino                                                       */
/* --------------------------------------------------------------------- */
const DEST = {
  local: () => $('#plbDestLocal'),
  corridor: () => $('#plbDestCorridor'),
  shelf: () => $('#plbDestShelf'),
  bin: () => $('#plbDestBin'),
  position: () => $('#plbDestPosition'),
};

const CHILD_LEVELS = [
  { key: 'corridor', url: (id) => `${LOC_API}/corridors?localId=${id}&activeOnly=true`, placeholder: 'Selecione...' },
  { key: 'shelf', url: (id) => `${LOC_API}/shelves?corridorId=${id}&activeOnly=true`, placeholder: 'Selecione...' },
  { key: 'bin', url: (id) => `${LOC_API}/bins?shelfId=${id}&activeOnly=true`, placeholder: '—' },
  { key: 'position', url: (id) => `${LOC_API}/positions?binId=${id}&activeOnly=true`, placeholder: '—' },
];

/** Recarrega o nível `index` (0 = corredor) a partir do valor do pai e limpa os de baixo. */
async function loadChildLevel(index, parentId) {
  for (let i = index; i < CHILD_LEVELS.length; i++) {
    const lvl = CHILD_LEVELS[i];
    fillSelect(DEST[lvl.key](), [], lvl.placeholder);
  }
  if (!parentId) return;
  const lvl = CHILD_LEVELS[index];
  try {
    const rows = asArray(await apiGet(lvl.url(encodeURIComponent(parentId))));
    fillSelect(DEST[lvl.key](), rows, lvl.placeholder);
  } catch (err) {
    console.error('[localizacoesLote] loadChildLevel', lvl.key, err);
  }
}

function bindDestinationCascade() {
  const order = ['local', 'corridor', 'shelf', 'bin'];
  order.forEach((key, i) => {
    DEST[key]().addEventListener('change', async () => {
      await loadChildLevel(i, DEST[key]().value);
      renderPreview();
    });
  });
  DEST.position().addEventListener('change', renderPreview);
}

function readDestination() {
  return {
    store_id: DEST.local().value ? Number(DEST.local().value) : null,
    corredor: selectedName(DEST.corridor()),
    prateleira: selectedName(DEST.shelf()),
    bandeja: selectedName(DEST.bin()),
    box: selectedName(DEST.position()),
  };
}

function destinationLabel(d) {
  if (!d.store_id) return '—';
  return locationLabel({ location_id: 0, ...d });
}

async function applyScan(code) {
  const info = $('#plbScanInfo');
  info.className = 'plb-scan-info';
  info.textContent = 'Lendo...';
  try {
    const res = await apiGet(`${BARCODE_API}/read/${encodeURIComponent(code)}`);
    const loc = res?.data || res;
    if (!loc?.local_id) throw new Error('Etiqueta sem Local cadastrado.');

    DEST.local().value = String(loc.local_id);
    await loadChildLevel(0, loc.local_id);
    const ids = [loc.corridor_id, loc.shelf_id, loc.bin_id, loc.position_id];
    for (let i = 0; i < CHILD_LEVELS.length; i++) {
      if (!ids[i]) break;
      DEST[CHILD_LEVELS[i].key]().value = String(ids[i]);
      if (i + 1 < CHILD_LEVELS.length) await loadChildLevel(i + 1, ids[i]);
    }

    info.classList.add('is-ok');
    info.textContent = `✔ ${loc.label || code}`;
    renderPreview();
  } catch (err) {
    info.classList.add('is-error');
    info.textContent = err.status === 404 ? 'Etiqueta não encontrada.' : `Erro: ${err.message}`;
  }
}

/* --------------------------------------------------------------------- */
/* Modal — modo e conferência                                            */
/* --------------------------------------------------------------------- */
const currentMode = () => document.querySelector('input[name="plbMode"]:checked')?.value || 'MOVER';

function syncModeCards() {
  document.querySelectorAll('.plb-mode__opt').forEach((opt) => {
    opt.classList.toggle('is-on', opt.querySelector('input').checked);
  });
}

function renderPreview() {
  const tbody = $('#plbPreview');
  tbody.innerHTML = '';
  const dest = destinationLabel(readDestination());
  const frag = document.createDocumentFragment();

  state.selected.forEach((r) => {
    const tr = document.createElement('tr');
    tr.appendChild(td(r.product_code));
    tr.appendChild(td(r.description));

    const from = locationLabel(r);
    const fromCell = td(from ?? 'sem localização', from ? 'plb-loc' : 'plb-loc plb-none');
    tr.appendChild(fromCell);

    const same = from && from === dest;
    tr.appendChild(td(same ? '=' : '→', same ? 'plb-arrow plb-same' : 'plb-arrow'));
    const toCell = td(dest, 'plb-loc');
    toCell.style.fontWeight = '700';
    tr.appendChild(toCell);
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
}

function openModal() {
  if (!state.selected.size) return;
  $('#plbModalTitle').textContent = `📍 Alterar localização em lote — ${state.selected.size} produto(s)`;
  $('#plbScan').value = '';
  $('#plbScanInfo').textContent = '';
  renderPreview();
  Modal.open('plbModal', { focusSelector: '#plbScan' });
}

async function confirmBatch() {
  if (state.saving) return;
  const destination = readDestination();

  if (!destination.store_id || !destination.corredor || !destination.prateleira) {
    showCenterModal({ variant: 'warning', title: 'Nova localização', message: 'Selecione Local, Corredor e Gôndola.' });
    return;
  }

  const product_codes = [...state.selected.keys()];
  const mode = currentMode();
  const btn = $('#plbBtnConfirm');

  state.saving = true;
  btn.disabled = true;
  try {
    const r = await apiPost(BATCH_API, {
      product_codes,
      mode,
      destination,
      observacao: $('#plbNotes').value.trim() || null,
    });

    Modal.close('plbModal');
    state.selected.clear();
    $('#plbNotes').value = '';
    await loadProducts();

    const lines = [
      `${r.updated} produto(s) ${mode === 'MOVER' ? 'movidos' : 'com localização adicionada'} para <b>${escapeHtml(destinationLabel(destination))}</b>.`,
    ];
    if (r.unchanged) lines.push(`${r.unchanged} já estavam nessa localização.`);
    if (r.not_found?.length) lines.push(`${r.not_found.length} SKU(s) não encontrados: ${escapeHtml(r.not_found.slice(0, 10).join(', '))}`);

    showCenterModal({ variant: 'success', title: 'Localizações alteradas', message: lines.join('<br>') });
  } catch (err) {
    console.error('[localizacoesLote] confirmBatch', err);
    showCenterModal({ variant: 'error', title: 'Erro ao alterar', message: escapeHtml(err.message) });
  } finally {
    state.saving = false;
    btn.disabled = false;
  }
}

/* --------------------------------------------------------------------- */
/* Eventos                                                               */
/* --------------------------------------------------------------------- */
function bindEvents() {
  const search = () => { readFilters(); state.page = 1; loadProducts(); };

  $('#plbBtnSearch').addEventListener('click', search);
  $('#plbSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  $('#plbFilterLocal').addEventListener('change', async () => {
    await loadFilterCorridors();
    search();
  });
  $('#plbFilterCorridor').addEventListener('change', search);

  $('#plbWithoutLocation').addEventListener('change', () => {
    const on = $('#plbWithoutLocation').checked;
    $('#plbFilterLocal').disabled = on;
    $('#plbFilterCorridor').disabled = on || !$('#plbFilterLocal').value;
    search();
  });

  $('#plbPositiveStock').addEventListener('change', search);

  $('#plbBtnClear').addEventListener('click', async () => {
    $('#plbSearch').value = '';
    $('#plbPositiveStock').checked = false;
    $('#plbFilterLocal').value = '';
    $('#plbFilterLocal').disabled = false;
    $('#plbWithoutLocation').checked = false;
    await loadFilterCorridors();
    search();
  });

  $('#plbTbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-code]');
    if (!tr) return;
    toggleRow(tr.dataset.code);
    syncPageCheckbox();
    renderSelection();
  });

  $('#plbSelectPage').addEventListener('change', (e) => {
    state.rows.forEach((r) => toggleRow(r.product_code, e.target.checked));
    syncPageCheckbox();
    renderSelection();
  });

  $('#plbBtnSelectAll').addEventListener('click', selectAllFromFilter);
  $('#plbBtnClearSelection').addEventListener('click', () => {
    state.selected.clear();
    renderTable();
    renderSelection();
  });

  $('#plbBtnPrev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadProducts(); } });
  $('#plbBtnNext').addEventListener('click', () => { state.page++; loadProducts(); });
  $('#plbPageSize').addEventListener('change', (e) => {
    state.pageSize = Number(e.target.value) || 50;
    state.page = 1;
    loadProducts();
  });

  $('#plbBtnOpenModal').addEventListener('click', openModal);
  $('#plbBtnConfirm').addEventListener('click', confirmBatch);

  document.querySelectorAll('input[name="plbMode"]').forEach((r) => r.addEventListener('change', syncModeCards));

  $('#plbScan').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = $('#plbScan').value.trim();
    if (code) applyScan(code);
  });

  bindDestinationCascade();

  // Ordenação pelo cabeçalho — feita no backend (a lista é paginada)
  createSortableTable({
    table: '#plbTable',
    defaultColumn: state.sort.column,
    defaultDirection: state.sort.direction,
    onSort: async ({ column, direction }) => {
      state.sort = { column, direction };
      state.page = 1;
      await loadProducts();
    },
  });
}

/* --------------------------------------------------------------------- */
/* Init                                                                  */
/* --------------------------------------------------------------------- */
async function init() {
  Modal.setup();
  bindEvents();
  await loadLocals();
  readFilters();
  await loadProducts();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
