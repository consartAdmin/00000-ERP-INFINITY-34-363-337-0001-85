// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ibgeLocations.js — UFs e Cidades IBGE (Frontend) | CONSART ERP | ESM ║
// ║ - Consome /api/ibge-locations (+ count-by-state, import, ensure)     ║
// ║ - Estados: as 27 UFs (nome fixo) com nº de cidades da tabela;        ║
// ║   clicar numa UF filtra as cidades (clicar de novo desfaz)           ║
// ║ - Cidades: busca, Status, ordenação no servidor (sort/dir) e         ║
// ║   paginação no rodapé (table-footer)                                 ║
// ║ - Cadastro/edição em modal (modal.js), ações com actionIcons.js,     ║
// ║   avisos/confirmações no centerAlertModal.js                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';

// ======================================================================
// API BASE
// ======================================================================

function getApiBase() {
  try {
    if (typeof window !== 'undefined' && window.getApiBase) return window.getApiBase();
  } catch (err) {
    console.error('[ibgeLocations] Erro ao obter API base:', err);
  }
  return window.location.origin;
}

const API = `${getApiBase()}/api/ibge-locations`;

// ======================================================================
// UFs (nomes fixos — a tabela só guarda a sigla)
// ======================================================================

const UF_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

const ufName = (uf) => UF_NAMES[uf] || uf;

// ======================================================================
// HELPERS
// ======================================================================

const $ = (selector) => document.querySelector(selector);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data = null;
  const text = await res.text().catch(() => '');
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

  if (!res.ok || data?.ok === false) {
    const msg = data?.error || data?.message || `Falha na requisição (${res.status}).`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Aceita { data: [] }, { data: { rows } }, { rows } ou array direto */
function normalizeRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmtInt = (n) => Number(n || 0).toLocaleString('pt-BR');

function notify(message, variant = 'success') {
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'UFs e Cidades IBGE'),
    message: String(message ?? ''),
    timeoutMs: variant === 'success' ? 2500 : undefined,
  });
}

async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Confirmar', variant = 'warning' } = {}) {
  const button = await showCenterModal({
    variant,
    title,
    message: String(message ?? ''),
    timeoutMs: null,
    buttons: [
      { label: 'Cancelar', variant: 'cancel' },
      { label: confirmLabel, variant: 'confirm' },
    ],
  });
  return String(button?.variant || '').toLowerCase() === 'confirm';
}

function messageRow(colspan, text) {
  return `<tr><td colspan="${colspan}" class="table-empty-state">${escapeHtml(text)}</td></tr>`;
}

function sortRows(rows, { column, direction }) {
  const dir = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[column];
    const vb = b[column];
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    if (typeof va === 'boolean' || typeof vb === 'boolean') return (Number(!!va) - Number(!!vb)) * dir;
    return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' }) * dir;
  });
}

// ======================================================================
// ESTADO
// ======================================================================

const state = {
  ufs: [],               // [{ uf, name, active, total, imported }]
  selectedUF: '',
  ufsSort: { column: 'uf', direction: 'asc' },

  cities: [],
  citiesTotal: 0,
  citiesPage: 1,
  citiesLimit: 50,
  citiesSort: { column: 'city', direction: 'asc' },
  citiesLoading: false,
};

// ======================================================================
// ESTADOS (UF)
// ======================================================================

async function loadUFs() {
  try {
    const [allRes, activeRes] = await Promise.all([
      fetchJson(`${API}/count-by-state`),
      fetchJson(`${API}/count-by-state?status=true`),
    ]);

    const totals = new Map(normalizeRows(allRes).map((r) => [String(r.state || '').trim(), Number(r.total_cities || 0)]));
    const actives = new Map(normalizeRows(activeRes).map((r) => [String(r.state || '').trim(), Number(r.total_cities || 0)]));

    // 27 UFs + qualquer sigla estranha que exista na tabela
    const codes = new Set([...Object.keys(UF_NAMES), ...totals.keys()]);
    state.ufs = [...codes].filter(Boolean).map((uf) => ({
      uf,
      name: ufName(uf),
      total: totals.get(uf) || 0,
      active: actives.get(uf) || 0,
      imported: (totals.get(uf) || 0) > 0,
    }));
  } catch (err) {
    state.ufs = [];
    $('#ufsTableBody').innerHTML = messageRow(5, `Erro ao carregar UFs: ${err.message}`);
    $('#ufsInfo').textContent = 'Erro';
    return;
  }
  renderUFs();
}

function filteredUFs() {
  const term = String($('#ufsSearch').value || '').trim().toLowerCase();
  const situation = $('#ufsSituation').value;

  let rows = state.ufs;
  if (situation === 'imported') rows = rows.filter((u) => u.imported);
  if (situation === 'pending') rows = rows.filter((u) => !u.imported);
  if (term) {
    rows = rows.filter((u) =>
      u.uf.toLowerCase().includes(term) ||
      u.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .includes(term.normalize('NFD').replace(/[̀-ͯ]/g, '')));
  }
  return sortRows(rows, state.ufsSort);
}

function situationPill(u) {
  return u.imported
    ? '<span class="summary-pill summary-pill--success">Importada</span>'
    : '<span class="summary-pill summary-pill--warning">Não importada</span>';
}

function renderUFs() {
  const tbody = $('#ufsTableBody');
  const rows = filteredUFs();

  if (!rows.length) {
    tbody.innerHTML = messageRow(5, 'Nenhuma UF encontrada.');
  } else {
    tbody.innerHTML = rows.map((u) => {
      const selected = state.selectedUF === u.uf;
      const actions = actionIconsHtml([
        { action: 'view', title: selected ? 'Mostrar todas as cidades' : `Ver cidades de ${u.name}`, attrs: { 'data-act': 'select', 'data-uf': u.uf } },
        { action: 'add', title: `Nova cidade em ${u.uf}`, attrs: { 'data-act': 'new', 'data-uf': u.uf } },
        { action: 'download', title: u.imported ? `Reimportar cidades de ${u.uf} do IBGE` : `Importar cidades de ${u.uf} do IBGE`, attrs: { 'data-act': 'import', 'data-uf': u.uf } },
      ]);
      const inactive = u.total - u.active;
      const count = `${fmtInt(u.active)}${inactive > 0 ? ` <small title="Inativas">+${fmtInt(inactive)}</small>` : ''}`;
      return `
        <tr data-uf="${u.uf}" class="${selected ? 'is-selected' : ''}" style="cursor:pointer">
          <td><b>${u.uf}</b></td>
          <td class="td-left">${escapeHtml(u.name)}</td>
          <td>${count}</td>
          <td>${situationPill(u)}</td>
          <td>${actions}</td>
        </tr>`;
    }).join('');
  }

  const imported = state.ufs.filter((u) => u.imported).length;
  const cities = state.ufs.reduce((acc, u) => acc + u.active, 0);
  $('#ufsInfo').textContent = `${imported} de ${state.ufs.length} UFs importadas · ${fmtInt(cities)} cidades ativas`;
}

function selectUF(uf) {
  state.selectedUF = state.selectedUF === uf ? '' : uf;
  state.citiesPage = 1;
  renderUFs();
  renderFilterBar();
  loadCities();
}

function renderFilterBar() {
  const bar = $('#citiesFilterBar');
  if (!state.selectedUF) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  $('#citiesFilterLabel').textContent = `UF: ${state.selectedUF} · ${ufName(state.selectedUF)}`;
}

async function importUF(uf) {
  const info = state.ufs.find((u) => u.uf === uf);
  const ok = await confirmCenter(
    info?.imported
      ? `${ufName(uf)} já tem ${fmtInt(info.total)} cidade(s). Buscar de novo no IBGE e atualizar a lista?`
      : `Buscar as cidades de ${ufName(uf)} no IBGE e gravar na tabela?`,
    { title: `Importar ${uf}`, confirmLabel: 'Importar' },
  );
  if (!ok) return;

  try {
    const res = await fetchJson(`${API}/import/state`, { method: 'POST', body: JSON.stringify({ state: uf }) });
    const d = res?.data || {};
    const detail = Number.isFinite(Number(d.total))
      ? ` ${fmtInt(d.total)} cidade(s): ${fmtInt(d.inserted)} nova(s), ${fmtInt(d.updated)} atualizada(s).`
      : '';
    notify(`Importação de ${ufName(uf)} concluída.${detail}`);
    state.selectedUF = uf;
    state.citiesPage = 1;
    renderFilterBar();
    await Promise.all([loadUFs(), loadCities()]);
  } catch (err) {
    notify(`Não foi possível importar ${uf}: ${err.message}`, 'error');
  }
}

// ======================================================================
// CIDADES
// ======================================================================

async function loadCities() {
  const tbody = $('#citiesTableBody');
  const status = $('#citiesStatus').value;
  const term = String($('#citiesSearch').value || '').trim();

  const params = new URLSearchParams();
  if (state.selectedUF) params.set('state', state.selectedUF);
  if (term) params.set('q', term);
  if (status !== 'all') params.set('status', status);
  params.set('limit', String(state.citiesLimit));
  params.set('offset', String((state.citiesPage - 1) * state.citiesLimit));
  params.set('sort', state.citiesSort.column);
  params.set('dir', state.citiesSort.direction);

  state.citiesLoading = true;
  tbody.innerHTML = messageRow(6, 'Carregando...');

  try {
    const res = await fetchJson(`${API}?${params}`);
    state.cities = normalizeRows(res);
    state.citiesTotal = Number(res?.pagination?.total ?? state.cities.length) || 0;
  } catch (err) {
    state.cities = [];
    state.citiesTotal = 0;
    tbody.innerHTML = messageRow(6, `Erro ao carregar cidades: ${err.message}`);
    $('#citiesInfo').textContent = 'Erro';
    renderPagination();
    return;
  } finally {
    state.citiesLoading = false;
  }

  renderCities();
}

function cityStatusPill(active) {
  return active
    ? '<span class="summary-pill summary-pill--success">Ativa</span>'
    : '<span class="summary-pill summary-pill--danger">Inativa</span>';
}

function renderCities() {
  const tbody = $('#citiesTableBody');

  if (!state.cities.length) {
    const hint = state.selectedUF && !state.ufs.find((u) => u.uf === state.selectedUF)?.imported
      ? `Nenhuma cidade de ${ufName(state.selectedUF)}. Use "Importar da UF" para buscar no IBGE.`
      : 'Nenhuma cidade encontrada.';
    tbody.innerHTML = messageRow(6, hint);
  } else {
    tbody.innerHTML = state.cities.map((r) => {
      const id = r.ibge_location_id;
      const active = r.status !== false;
      const actions = actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': id } },
        active
          ? { action: 'pause', title: 'Inativar', attrs: { 'data-act': 'toggle', 'data-id': id } }
          : { action: 'play', title: 'Reativar', attrs: { 'data-act': 'toggle', 'data-id': id } },
      ]);
      return `
        <tr>
          <td>${escapeHtml(id)}</td>
          <td><b>${escapeHtml(String(r.state || '').trim())}</b></td>
          <td class="td-left">${escapeHtml(r.city || '—')}</td>
          <td>${escapeHtml(r.ibge_code ?? '—')}</td>
          <td>${cityStatusPill(active)}</td>
          <td>${actions}</td>
        </tr>`;
    }).join('');
  }

  const from = state.citiesTotal ? (state.citiesPage - 1) * state.citiesLimit + 1 : 0;
  const to = Math.min(state.citiesTotal, from + state.cities.length - 1);
  $('#citiesInfo').textContent = state.citiesTotal
    ? `${fmtInt(from)}–${fmtInt(to)} de ${fmtInt(state.citiesTotal)} cidade(s)`
    : '0 cidades';
  renderPagination();
}

function totalPages() {
  return Math.max(1, Math.ceil(state.citiesTotal / Math.max(1, state.citiesLimit)));
}

function renderPagination() {
  const pages = totalPages();
  $('#citiesPageInfo').textContent = `Página ${state.citiesPage} de ${pages}`;
  $('#citiesPrev').disabled = state.citiesPage <= 1;
  $('#citiesNext').disabled = state.citiesPage >= pages;
}

// ======================================================================
// MODAL — CIDADE
// ======================================================================

function fillUfSelect(selected) {
  $('#cityState').innerHTML = Object.keys(UF_NAMES).sort()
    .map((uf) => `<option value="${uf}"${uf === selected ? ' selected' : ''}>${uf} · ${escapeHtml(UF_NAMES[uf])}</option>`)
    .join('');
}

function openCityModal(row = null, uf = '') {
  const isEdit = !!row?.ibge_location_id;
  $('#cityModalTitle').textContent = isEdit ? `Editar cidade #${row.ibge_location_id}` : 'Nova cidade';
  $('#cityId').value = isEdit ? row.ibge_location_id : '';
  fillUfSelect(String(row?.state || uf || state.selectedUF || 'MG').trim());
  $('#cityName').value = row?.city || '';
  $('#cityIbgeCode').value = row?.ibge_code ?? '';
  $('#cityStatus').value = String(row ? row.status !== false : true);
  Modal.open('cityModal', { focusSelector: '#cityName' });
}

async function submitCity(ev) {
  ev.preventDefault();

  const id = $('#cityId').value || null;
  const payload = {
    state: $('#cityState').value,
    city: String($('#cityName').value || '').trim(),
    ibge_code: Number(String($('#cityIbgeCode').value || '').replace(/\D/g, '')),
    status: $('#cityStatus').value === 'true',
  };

  if (!payload.city) return notify('Informe o nome da cidade.', 'warning');
  if (!Number.isFinite(payload.ibge_code) || String(payload.ibge_code).length !== 7) {
    return notify('O código IBGE do município tem 7 dígitos.', 'warning');
  }

  try {
    await fetchJson(id ? `${API}/${encodeURIComponent(id)}` : API, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    Modal.close('cityModal');
    notify(id ? 'Cidade atualizada.' : 'Cidade cadastrada.');
    await Promise.all([loadCities(), loadUFs()]);
  } catch (err) {
    notify(`Não foi possível salvar: ${err.message}`, 'error');
  }
}

async function toggleCity(row) {
  const active = row.status !== false;
  const ok = await confirmCenter(
    active
      ? `Inativar ${row.city} (${row.state})? Ela deixa de aparecer nas buscas de cidade.`
      : `Reativar ${row.city} (${row.state})?`,
    { title: active ? 'Inativar cidade' : 'Reativar cidade', confirmLabel: active ? 'Inativar' : 'Reativar', variant: active ? 'warning' : 'info' },
  );
  if (!ok) return;

  try {
    if (active) await fetchJson(`${API}/${encodeURIComponent(row.ibge_location_id)}`, { method: 'DELETE' });
    else await fetchJson(`${API}/${encodeURIComponent(row.ibge_location_id)}`, { method: 'PUT', body: JSON.stringify({ status: true }) });
    notify(active ? 'Cidade inativada.' : 'Cidade reativada.');
    await Promise.all([loadCities(), loadUFs()]);
  } catch (err) {
    notify(`Não foi possível alterar: ${err.message}`, 'error');
  }
}

// ======================================================================
// EVENTOS
// ======================================================================

function debounce(fn, ms = 350) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function bindEvents() {
  Modal.setup();

  // UFs
  $('#ufsSearch').addEventListener('input', debounce(renderUFs, 200));
  $('#ufsSituation').addEventListener('change', renderUFs);

  $('#ufsTableBody').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (btn) {
      const uf = btn.dataset.uf;
      if (btn.dataset.act === 'select') selectUF(uf);
      if (btn.dataset.act === 'new') openCityModal(null, uf);
      if (btn.dataset.act === 'import') importUF(uf);
      return;
    }
    const tr = ev.target.closest('tr[data-uf]');
    if (tr) selectUF(tr.dataset.uf);
  });

  createSortableTable({
    table: '#ufsTable',
    defaultColumn: state.ufsSort.column,
    defaultDirection: state.ufsSort.direction,
    allowedColumns: ['uf', 'name', 'active', 'imported'],
    onSort: ({ column, direction }) => { state.ufsSort = { column, direction }; renderUFs(); },
  });

  $('#btnEnsure').addEventListener('click', async () => {
    try {
      await fetchJson(`${API}/ensure`, { method: 'POST' });
      notify('Tabela verificada.');
      await Promise.all([loadUFs(), loadCities()]);
    } catch (err) {
      notify(`Falha ao verificar a tabela: ${err.message}`, 'error');
    }
  });

  $('#btnRefreshAll').addEventListener('click', () => Promise.all([loadUFs(), loadCities()]));

  // Cidades
  const reloadCities = () => { state.citiesPage = 1; loadCities(); };
  $('#citiesSearch').addEventListener('input', debounce(reloadCities));
  $('#citiesSearch').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); reloadCities(); } });
  $('#citiesStatus').addEventListener('change', reloadCities);
  $('#citiesPerPage').addEventListener('change', (ev) => {
    state.citiesLimit = Number(ev.target.value) || 50;
    reloadCities();
  });

  $('#citiesPrev').addEventListener('click', () => {
    if (state.citiesLoading || state.citiesPage <= 1) return;
    state.citiesPage -= 1;
    loadCities();
  });
  $('#citiesNext').addEventListener('click', () => {
    if (state.citiesLoading || state.citiesPage >= totalPages()) return;
    state.citiesPage += 1;
    loadCities();
  });

  createSortableTable({
    table: '#citiesTable',
    defaultColumn: state.citiesSort.column,
    defaultDirection: state.citiesSort.direction,
    allowedColumns: ['ibge_location_id', 'state', 'city', 'ibge_code', 'status'],
    onSort: ({ column, direction }) => { state.citiesSort = { column, direction }; reloadCities(); },
  });

  $('#citiesTableBody').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const row = state.cities.find((r) => String(r.ibge_location_id) === String(btn.dataset.id));
    if (!row) return;
    if (btn.dataset.act === 'edit') openCityModal(row);
    if (btn.dataset.act === 'toggle') toggleCity(row);
  });

  $('#btnImportUf').addEventListener('click', () => {
    if (!state.selectedUF) return notify('Clique numa UF da lista de Estados para escolher qual importar.', 'warning');
    importUF(state.selectedUF);
  });

  $('#btnNewCity').addEventListener('click', () => openCityModal());

  $('#btnClearUf').addEventListener('click', () => {
    state.selectedUF = '';
    state.citiesPage = 1;
    renderUFs();
    renderFilterBar();
    loadCities();
  });

  $('#cityForm').addEventListener('submit', submitCity);
  $('#cityIbgeCode').addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 7); });
}

// ======================================================================
// INIT
// ======================================================================

function init() {
  bindEvents();
  renderFilterBar();
  loadUFs();
  loadCities();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
