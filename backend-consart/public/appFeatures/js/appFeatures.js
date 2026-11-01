// ╔══════════════════════════════════════════════════════════════════════╗
// ║ appFeatures.js — Funcionalidades / Opções / Atribuições (ESM)        ║
// ║ Uma tabela por aba + modal de edição para cada tabela                ║
// ║ API: /api/app-features-admin                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝
'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js?v=2';

const API = '/api/app-features-admin';

const $ = (id) => document.getElementById(id);
const state = {
  tab: 'features',
  features: [],     // todas (inclusive inativas): usadas nos selects
  options: [],
  assignments: [],
};

const TYPE_LABEL = {
  OPTION: 'Opção',
  BOOLEAN: 'Sim/Não',
  NUMBER: 'Número',
  TEXT: 'Texto',
  JSON: 'JSON',
};

const NEW_LABEL = {
  features: '➕ Nova Funcionalidade',
  options: '➕ Nova Opção',
  assignments: '➕ Nova Atribuição',
};

// ─────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────
function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function authHeaders() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJSON(url, opts = {}) {
  const headers = { ...authHeaders(), ...(opts.headers || {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showError(error) {
  showCenterModal({ variant: 'error', title: 'Erro', message: error?.message || String(error) });
}

function warn(message) {
  showCenterModal({ variant: 'warning', title: 'Atenção', message });
}

function jsonPreview(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return '';
  return JSON.stringify(value);
}

function jsonForTextarea(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return '';
  return JSON.stringify(value, null, 2);
}

// textarea → valor JSON (vazio = null). Lança erro amigável.
function parseJsonField(text, label) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label}: JSON inválido. Textos precisam de aspas, ex.: "texto".`);
  }
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// ISO → valor de <input type="datetime-local"> (hora local)
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function statusPill(active, on = 'Ativo', off = 'Inativo') {
  return active
    ? `<span class="emp-pill emp-pill--active">● ${on}</span>`
    : `<span class="emp-pill emp-pill--inactive">● ${off}</span>`;
}

function actions(id) {
  return actionIconsHtml([
    { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': id } },
    { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': id } },
  ]);
}

function featureLabel(f) {
  return `${f.feature_code} — ${f.feature_name}${f.is_active ? '' : ' (inativa)'}`;
}

function defaultValueText(f) {
  const v = f.default_value;
  if (v === null || v === undefined) return '';
  if (f.value_type === 'OPTION') return v.optionCode || jsonPreview(v);
  if (f.value_type === 'BOOLEAN') return v === true ? 'Sim' : v === false ? 'Não' : jsonPreview(v);
  return typeof v === 'string' ? v : jsonPreview(v);
}

// ─────────────────────────────────────────────────────────────
// Carga
// ─────────────────────────────────────────────────────────────
async function loadFeatures() {
  const { data } = await fetchJSON(`${API}/features?includeInactive=true`);
  state.features = data || [];
  fillFeatureFilter();
}

async function loadOptions() {
  const featureId = $('afFeatureFilter').value;
  const qs = new URLSearchParams({ includeInactive: 'true' });
  if (featureId) qs.set('featureId', featureId);
  const { data } = await fetchJSON(`${API}/options?${qs}`);
  state.options = data || [];
}

async function loadAssignments() {
  const featureId = $('afFeatureFilter').value;
  const qs = new URLSearchParams();
  if (featureId) qs.set('featureId', featureId);
  const { data } = await fetchJSON(`${API}/assignments?${qs}`);
  state.assignments = data || [];
}

async function loadTab() {
  if (state.tab === 'features') await loadFeatures();
  else if (state.tab === 'options') await loadOptions();
  else await loadAssignments();
  render();
}

function fillFeatureFilter() {
  const select = $('afFeatureFilter');
  const current = select.value;
  select.innerHTML = '<option value="">Todas as funcionalidades</option>'
    + state.features.map((f) => `<option value="${f.feature_id}">${escapeHtml(featureLabel(f))}</option>`).join('');
  select.value = state.features.some((f) => String(f.feature_id) === current) ? current : '';
}

// ─────────────────────────────────────────────────────────────
// Render (cabeçalho + linhas da aba ativa)
// ─────────────────────────────────────────────────────────────
const HEADS = {
  features: `<tr>
      <th class="af-col-id">ID</th>
      <th class="af-col-code">Código</th>
      <th class="af-col-name">Nome</th>
      <th class="af-col-type">Tipo</th>
      <th class="af-col-default">Valor padrão</th>
      <th class="af-col-desc">Descrição</th>
      <th class="af-col-small">Opções</th>
      <th class="af-col-small">Atribuições</th>
      <th class="af-col-status">Status</th>
      <th class="af-col-actions">Ações</th>
    </tr>`,
  options: `<tr>
      <th class="af-col-id">ID</th>
      <th class="af-col-code">Funcionalidade</th>
      <th class="af-col-code">Código</th>
      <th class="af-col-name">Nome</th>
      <th class="af-col-desc">Configuração</th>
      <th class="af-col-small">Ordem</th>
      <th class="af-col-small">Em uso</th>
      <th class="af-col-status">Status</th>
      <th class="af-col-actions">Ações</th>
    </tr>`,
  assignments: `<tr>
      <th class="af-col-id">ID</th>
      <th class="af-col-code">Funcionalidade</th>
      <th class="af-col-scope">Escopo</th>
      <th class="af-col-name">Opção</th>
      <th class="af-col-desc">Valor personalizado</th>
      <th class="af-col-date">Início</th>
      <th class="af-col-date">Fim</th>
      <th class="af-col-status">Situação</th>
      <th class="af-col-actions">Ações</th>
    </tr>`,
};

function matches(text) {
  const q = $('afSearch').value.trim().toLowerCase();
  return !q || String(text).toLowerCase().includes(q);
}

function rowsOfTab() {
  const showInactive = $('afShowInactive').checked;

  if (state.tab === 'features') {
    return state.features.filter((f) => (showInactive || f.is_active)
      && matches(`${f.feature_code} ${f.feature_name} ${f.description || ''}`));
  }
  if (state.tab === 'options') {
    return state.options.filter((o) => (showInactive || o.is_active)
      && matches(`${o.feature_code} ${o.option_code} ${o.option_name} ${o.description || ''}`));
  }
  return state.assignments.filter((a) =>
    matches(`${a.feature_code} ${a.feature_name} ${a.scope_type} ${a.scope_id} ${a.option_code || ''} ${a.option_name || ''}`));
}

function renderRow(r) {
  if (state.tab === 'features') {
    return `<tr data-id="${r.feature_id}">
      <td>${r.feature_id}</td>
      <td class="af-cell-left af-mono" title="${escapeHtml(r.feature_code)}">${escapeHtml(r.feature_code)}</td>
      <td class="af-cell-left">${escapeHtml(r.feature_name)}</td>
      <td><span class="af-type">${TYPE_LABEL[r.value_type] || escapeHtml(r.value_type)}</span></td>
      <td class="af-cell-left af-mono">${escapeHtml(defaultValueText(r))}</td>
      <td class="af-cell-left af-cell-muted">${escapeHtml(r.description || '')}</td>
      <td>${r.options_count || 0}</td>
      <td>${r.assignments_count || 0}</td>
      <td>${statusPill(r.is_active)}</td>
      <td>${actions(r.feature_id)}</td>
    </tr>`;
  }
  if (state.tab === 'options') {
    const config = jsonPreview(r.option_config);
    return `<tr data-id="${r.feature_option_id}">
      <td>${r.feature_option_id}</td>
      <td class="af-cell-left af-mono" title="${escapeHtml(r.feature_name)}">${escapeHtml(r.feature_code)}</td>
      <td class="af-cell-left af-mono">${escapeHtml(r.option_code)}</td>
      <td class="af-cell-left">${escapeHtml(r.option_name)}</td>
      <td class="af-cell-left af-mono af-cell-muted" title="${escapeHtml(config)}">${escapeHtml(config)}</td>
      <td>${r.sort_order ?? 0}</td>
      <td>${r.assignments_count || 0}</td>
      <td>${statusPill(r.is_active)}</td>
      <td>${actions(r.feature_option_id)}</td>
    </tr>`;
  }
  const custom = jsonPreview(r.custom_value);
  return `<tr data-id="${r.feature_assignment_id}">
    <td>${r.feature_assignment_id}</td>
    <td class="af-cell-left af-mono" title="${escapeHtml(r.feature_name)}">${escapeHtml(r.feature_code)}</td>
    <td class="af-cell-left af-mono">${escapeHtml(r.scope_type)} #${r.scope_id}</td>
    <td class="af-cell-left">${r.option_code ? `${escapeHtml(r.option_name || '')} <span class="af-cell-muted af-mono">(${escapeHtml(r.option_code)})</span>` : '<span class="af-cell-muted">—</span>'}</td>
    <td class="af-cell-left af-mono af-cell-muted" title="${escapeHtml(custom)}">${escapeHtml(custom)}</td>
    <td>${formatDateTime(r.starts_at)}</td>
    <td>${formatDateTime(r.ends_at)}</td>
    <td>${statusPill(r.is_enabled, 'Ligada', 'Desligada')}</td>
    <td>${actions(r.feature_assignment_id)}</td>
  </tr>`;
}

function render() {
  const rows = rowsOfTab();
  const cols = state.tab === 'features' ? 10 : 9;
  $('afHead').innerHTML = HEADS[state.tab];
  $('afBody').innerHTML = rows.length
    ? rows.map(renderRow).join('')
    : `<tr><td colspan="${cols}" class="emp-empty">Nenhum registro encontrado.</td></tr>`;
  $('afInfo').textContent = `${rows.length} Registro${rows.length === 1 ? '' : 's'}`;
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.af-tabs .tab').forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  $('afFeatureFilterWrap').hidden = tab === 'features';
  $('afInactiveWrap').hidden = tab === 'assignments';
  $('btnNew').textContent = NEW_LABEL[tab];
  $('afTable').setAttribute('aria-label', document.querySelector(`.af-tabs [data-tab="${tab}"]`).textContent.trim());
  $('afBody').innerHTML = '';
  loadTab().catch(showError);
}

// ─────────────────────────────────────────────────────────────
// Selects compartilhados pelos modais
// ─────────────────────────────────────────────────────────────
function featureOptionsHtml(selectedId) {
  return state.features
    .filter((f) => f.is_active || f.feature_id === selectedId)
    .map((f) => `<option value="${f.feature_id}">${escapeHtml(featureLabel(f))}</option>`)
    .join('');
}

async function optionsOfFeature(featureId) {
  if (!featureId) return [];
  const { data } = await fetchJSON(`${API}/options?featureId=${featureId}&includeInactive=true`);
  return data || [];
}

// ─────────────────────────────────────────────────────────────
// Modal Funcionalidade
// ─────────────────────────────────────────────────────────────
function showDefaultField(type) {
  document.querySelectorAll('#featureForm [data-default]').forEach((el) => {
    el.hidden = el.dataset.default !== type;
  });
}

async function openFeatureModal(row = null) {
  $('ff-id').value = row?.feature_id || '';
  $('ff-code').value = row?.feature_code || '';
  $('ff-name').value = row?.feature_name || '';
  $('ff-type').value = row?.value_type || 'OPTION';
  $('ff-active').value = row && !row.is_active ? 'false' : 'true';
  $('ff-description').value = row?.description || '';

  const v = row?.default_value ?? null;
  const type = $('ff-type').value;
  $('ff-default-bool').value = type === 'BOOLEAN' && typeof v === 'boolean' ? String(v) : '';
  $('ff-default-number').value = type === 'NUMBER' && v !== null ? v : '';
  $('ff-default-text').value = type === 'TEXT' && v !== null ? String(v) : '';
  $('ff-default-json').value = type === 'JSON' ? jsonForTextarea(v) : '';

  // opções da própria funcionalidade (só existe depois de cadastrada)
  const opts = row ? await optionsOfFeature(row.feature_id) : [];
  const selectedCode = type === 'OPTION' ? (v?.optionCode || '') : '';
  $('ff-default-option').innerHTML = `<option value="">${row ? '— Nenhuma —' : '— Cadastre as opções depois de salvar —'}</option>`
    + opts.map((o) => `<option value="${escapeHtml(o.option_code)}">${escapeHtml(o.option_name)} (${escapeHtml(o.option_code)})</option>`).join('');
  $('ff-default-option').value = selectedCode;

  showDefaultField(type);
  $('featureModalTitle').textContent = row ? `Funcionalidade #${row.feature_id}` : 'Nova funcionalidade';
  Modal.open('featureModal', { focusSelector: '#ff-code' });
}

function readDefaultValue(type) {
  if (type === 'OPTION') {
    const code = $('ff-default-option').value;
    return code ? { optionCode: code } : null;
  }
  if (type === 'BOOLEAN') {
    const v = $('ff-default-bool').value;
    return v === '' ? null : v === 'true';
  }
  if (type === 'NUMBER') {
    const v = $('ff-default-number').value;
    return v === '' ? null : Number(v);
  }
  if (type === 'TEXT') return $('ff-default-text').value.trim() || null;
  return parseJsonField($('ff-default-json').value, 'Valor padrão');
}

async function saveFeature(event) {
  event.preventDefault();
  const id = $('ff-id').value;
  const type = $('ff-type').value;
  const payload = {
    feature_code: $('ff-code').value.trim().toUpperCase(),
    feature_name: $('ff-name').value.trim(),
    value_type: type,
    default_value: readDefaultValue(type),
    is_active: $('ff-active').value === 'true',
    description: $('ff-description').value.trim() || null,
  };
  if (!payload.feature_code || !payload.feature_name) return warn('Informe o código e o nome.');

  await fetchJSON(id ? `${API}/features/${id}` : `${API}/features`, {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  Modal.close('featureModal');
  showCenterModal({ variant: 'success', title: 'Sucesso', message: 'Funcionalidade salva.' });
  await loadTab();
}

// ─────────────────────────────────────────────────────────────
// Modal Opção
// ─────────────────────────────────────────────────────────────
function openOptionModal(row = null) {
  const featureId = row?.feature_id || Number($('afFeatureFilter').value) || null;
  $('of-id').value = row?.feature_option_id || '';
  $('of-feature').innerHTML = `<option value="">— Selecione —</option>${featureOptionsHtml(featureId)}`;
  $('of-feature').value = featureId ? String(featureId) : '';
  $('of-code').value = row?.option_code || '';
  $('of-name').value = row?.option_name || '';
  $('of-order').value = row?.sort_order ?? 0;
  $('of-active').value = row && !row.is_active ? 'false' : 'true';
  $('of-config').value = jsonForTextarea(row?.option_config);
  $('of-description').value = row?.description || '';
  $('optionModalTitle').textContent = row ? `Opção #${row.feature_option_id}` : 'Nova opção';
  Modal.open('optionModal', { focusSelector: featureId ? '#of-code' : '#of-feature' });
}

async function saveOption(event) {
  event.preventDefault();
  const id = $('of-id').value;
  const config = parseJsonField($('of-config').value, 'Configuração');
  if (config !== null && (typeof config !== 'object' || Array.isArray(config))) {
    return warn('A configuração deve ser um objeto JSON, ex.: {"chave": "valor"}.');
  }
  const payload = {
    feature_id: Number($('of-feature').value) || null,
    option_code: $('of-code').value.trim().toUpperCase(),
    option_name: $('of-name').value.trim(),
    sort_order: Number($('of-order').value) || 0,
    is_active: $('of-active').value === 'true',
    option_config: config ?? {},
    description: $('of-description').value.trim() || null,
  };
  if (!payload.feature_id) return warn('Selecione a funcionalidade.');
  if (!payload.option_code || !payload.option_name) return warn('Informe o código e o nome.');

  await fetchJSON(id ? `${API}/options/${id}` : `${API}/options`, {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  Modal.close('optionModal');
  showCenterModal({ variant: 'success', title: 'Sucesso', message: 'Opção salva.' });
  await loadTab();
}

// ─────────────────────────────────────────────────────────────
// Modal Atribuição
// ─────────────────────────────────────────────────────────────
async function fillAssignmentOptions(featureId, selectedId = null) {
  const opts = await optionsOfFeature(featureId);
  $('asf-option').innerHTML = '<option value="">— Nenhuma —</option>'
    + opts
      .filter((o) => o.is_active || o.feature_option_id === selectedId)
      .map((o) => `<option value="${o.feature_option_id}">${escapeHtml(o.option_name)} (${escapeHtml(o.option_code)})${o.is_active ? '' : ' (inativa)'}</option>`)
      .join('');
  $('asf-option').value = selectedId ? String(selectedId) : '';
}

async function openAssignmentModal(row = null) {
  const featureId = row?.feature_id || Number($('afFeatureFilter').value) || null;
  $('asf-id').value = row?.feature_assignment_id || '';
  $('asf-feature').innerHTML = `<option value="">— Selecione —</option>${featureOptionsHtml(featureId)}`;
  $('asf-feature').value = featureId ? String(featureId) : '';
  await fillAssignmentOptions(featureId, row?.feature_option_id ?? null);
  $('asf-scope-type').value = row?.scope_type || 'GLOBAL';
  $('asf-scope-id').value = row?.scope_id ?? 1;
  $('asf-starts').value = toLocalInput(row?.starts_at);
  $('asf-ends').value = toLocalInput(row?.ends_at);
  $('asf-enabled').value = row && !row.is_enabled ? 'false' : 'true';
  $('asf-custom').value = jsonForTextarea(row?.custom_value);
  $('assignmentModalTitle').textContent = row ? `Atribuição #${row.feature_assignment_id}` : 'Nova atribuição';
  Modal.open('assignmentModal', { focusSelector: '#asf-feature' });
}

async function saveAssignment(event) {
  event.preventDefault();
  const id = $('asf-id').value;
  const payload = {
    feature_id: Number($('asf-feature').value) || null,
    feature_option_id: Number($('asf-option').value) || null,
    scope_type: $('asf-scope-type').value.trim().toUpperCase() || 'GLOBAL',
    scope_id: Number($('asf-scope-id').value),
    starts_at: fromLocalInput($('asf-starts').value),
    ends_at: fromLocalInput($('asf-ends').value),
    is_enabled: $('asf-enabled').value === 'true',
    custom_value: parseJsonField($('asf-custom').value, 'Valor personalizado'),
  };
  if (!payload.feature_id) return warn('Selecione a funcionalidade.');
  if (!Number.isInteger(payload.scope_id) || payload.scope_id <= 0) return warn('O ID do escopo deve ser um inteiro maior que zero.');
  if (payload.starts_at && payload.ends_at && payload.ends_at <= payload.starts_at) {
    return warn('A data de fim deve ser depois da data de início.');
  }

  await fetchJSON(id ? `${API}/assignments/${id}` : `${API}/assignments`, {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  Modal.close('assignmentModal');
  showCenterModal({ variant: 'success', title: 'Sucesso', message: 'Atribuição salva.' });
  await loadTab();
}

// ─────────────────────────────────────────────────────────────
// Excluir
// ─────────────────────────────────────────────────────────────
async function removeRow(row) {
  const cfg = {
    features: { url: `${API}/features/${row.feature_id}`, text: `a funcionalidade "${row.feature_code}"` },
    options: { url: `${API}/options/${row.feature_option_id}`, text: `a opção "${row.option_code}"` },
    assignments: { url: `${API}/assignments/${row.feature_assignment_id}`, text: `a atribuição de "${row.feature_code}" (${row.scope_type} #${row.scope_id})` },
  }[state.tab];

  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Confirmar exclusão',
    message: `Excluir ${cfg.text}?`,
    okText: 'Sim, excluir',
    closeText: 'Cancelar',
  });
  if (ok !== true) return;

  await fetchJSON(cfg.url, { method: 'DELETE' });
  await loadTab();
}

// ─────────────────────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────────────────────
function findRow(id) {
  if (state.tab === 'features') return state.features.find((r) => String(r.feature_id) === id);
  if (state.tab === 'options') return state.options.find((r) => String(r.feature_option_id) === id);
  return state.assignments.find((r) => String(r.feature_assignment_id) === id);
}

function openModalForTab(row = null) {
  if (state.tab === 'features') return openFeatureModal(row);
  if (state.tab === 'options') return openOptionModal(row);
  return openAssignmentModal(row);
}

function bindEvents() {
  document.querySelectorAll('.af-tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => { if (btn.dataset.tab !== state.tab) switchTab(btn.dataset.tab); });
  });

  $('afSearch').addEventListener('input', render);
  $('afShowInactive').addEventListener('change', render);
  $('afFeatureFilter').addEventListener('change', () => loadTab().catch(showError));
  $('btnReload').addEventListener('click', () => loadTab().catch(showError));
  $('btnNew').addEventListener('click', () => Promise.resolve(openModalForTab()).catch(showError));

  $('ff-type').addEventListener('change', (e) => showDefaultField(e.target.value));
  $('asf-feature').addEventListener('change', (e) =>
    fillAssignmentOptions(Number(e.target.value) || null).catch(showError));

  $('featureForm').addEventListener('submit', (e) => saveFeature(e).catch(showError));
  $('optionForm').addEventListener('submit', (e) => saveOption(e).catch(showError));
  $('assignmentForm').addEventListener('submit', (e) => saveAssignment(e).catch(showError));

  $('afBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const row = findRow(tr.dataset.id);
    if (!row) return;
    if (btn?.dataset.act === 'delete') removeRow(row).catch(showError);
    else Promise.resolve(openModalForTab(row)).catch(showError);
  });
}

Modal.setup();
// Início/Fim em dd/mm/aaaa hh:mm (mantém o .value aaaa-mm-ddThh:mm do input original)
enhanceBrDateTime($('asf-starts'));
enhanceBrDateTime($('asf-ends'));
bindEvents();
// funcionalidades primeiro: alimentam o filtro e os selects das outras abas
loadTab().catch(showError);
