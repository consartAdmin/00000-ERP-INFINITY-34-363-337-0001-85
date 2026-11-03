// ╔══════════════════════════════════════════════════════════════════════╗
// ║ appFeatures.js — Funcionalidades (ESM)                               ║
// ║ Lista de funcionalidades + modal único que edita, de uma vez:        ║
// ║   funcionalidade (appFeatures), opções (appFeatureOptions) e         ║
// ║   atribuições (appFeatureAssignments)                                ║
// ║ API: /api/app-features-admin (features, options, assignments,        ║
// ║      features-full)                                                  ║
// ╚══════════════════════════════════════════════════════════════════════╝
'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js?v=2';

const API = '/api/app-features-admin';

const $ = (id) => document.getElementById(id);
const state = { features: [] };

const TYPE_LABEL = {
  OPTION: 'Opção',
  BOOLEAN: 'Sim/Não',
  NUMBER: 'Número',
  TEXT: 'Texto',
  JSON: 'JSON',
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

function isEmptyObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length;
}

// valor JSON → texto de uma linha (vazio para null / {})
function jsonText(value) {
  if (value === null || value === undefined || isEmptyObject(value)) return '';
  return JSON.stringify(value);
}

// texto → valor JSON (vazio = null). Lança erro amigável.
function parseJsonField(text, label) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label}: JSON inválido. Textos precisam de aspas, ex.: "texto".`);
  }
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

function defaultValueText(f) {
  const v = f.default_value;
  if (v === null || v === undefined) return '';
  if (f.value_type === 'OPTION') return v.optionCode || jsonText(v);
  if (f.value_type === 'BOOLEAN') return v === true ? 'Sim' : v === false ? 'Não' : jsonText(v);
  return typeof v === 'string' ? v : jsonText(v);
}

// ─────────────────────────────────────────────────────────────
// Lista de funcionalidades
// ─────────────────────────────────────────────────────────────
const HEAD = `<tr>
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
  </tr>`;

async function load() {
  const { data } = await fetchJSON(`${API}/features?includeInactive=true`);
  state.features = data || [];
  render();
}

function render() {
  const q = $('afSearch').value.trim().toLowerCase();
  const showInactive = $('afShowInactive').checked;
  const rows = state.features.filter((f) => (showInactive || f.is_active)
    && (!q || `${f.feature_code} ${f.feature_name} ${f.description || ''}`.toLowerCase().includes(q)));

  $('afHead').innerHTML = HEAD;
  $('afBody').innerHTML = rows.length ? rows.map((f) => `
    <tr data-id="${f.feature_id}">
      <td>${f.feature_id}</td>
      <td class="af-cell-left af-mono" title="${escapeHtml(f.feature_code)}">${escapeHtml(f.feature_code)}</td>
      <td class="af-cell-left">${escapeHtml(f.feature_name)}</td>
      <td><span class="af-type">${TYPE_LABEL[f.value_type] || escapeHtml(f.value_type)}</span></td>
      <td class="af-cell-left af-mono">${escapeHtml(defaultValueText(f))}</td>
      <td class="af-cell-left af-cell-muted" title="${escapeHtml(f.description || '')}">${escapeHtml(f.description || '')}</td>
      <td>${f.options_count || 0}</td>
      <td>${f.assignments_count || 0}</td>
      <td>${f.is_active
        ? '<span class="emp-pill emp-pill--active">● Ativo</span>'
        : '<span class="emp-pill emp-pill--inactive">● Inativo</span>'}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': f.feature_id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': f.feature_id } },
      ])}</td>
    </tr>`).join('')
    : '<tr><td colspan="10" class="emp-empty">Nenhuma funcionalidade encontrada.</td></tr>';

  $('afInfo').textContent = `${rows.length} Registro${rows.length === 1 ? '' : 's'}`;
}

// ─────────────────────────────────────────────────────────────
// Modal: linhas de opções
// ─────────────────────────────────────────────────────────────
function optionRowHtml(o = {}) {
  return `<tr class="af-option-row" data-option-id="${o.feature_option_id || ''}">
    <td><input type="text" class="af-code" data-f="option_code" maxlength="100" value="${escapeHtml(o.option_code || '')}" placeholder="CODIGO" /></td>
    <td><input type="text" data-f="option_name" maxlength="150" value="${escapeHtml(o.option_name || '')}" placeholder="Nome" /></td>
    <td><input type="text" data-f="description" value="${escapeHtml(o.description || '')}" placeholder="Opcional" /></td>
    <td><input type="text" class="af-json" data-f="option_config" value="${escapeHtml(jsonText(o.option_config))}" placeholder='{"chave": true}' /></td>
    <td><input type="number" data-f="sort_order" step="1" value="${o.sort_order ?? 0}" /></td>
    <td class="af-e-check"><input type="checkbox" data-f="is_active" ${o.is_active === false ? '' : 'checked'} /></td>
    <td><button type="button" class="af-del-btn" data-del="option" title="Remover opção">🗑</button></td>
  </tr>`;
}

function emptyRow(colspan, text) {
  return `<tr class="af-empty-row"><td colspan="${colspan}">${text}</td></tr>`;
}

function syncEmptyRows() {
  const ob = $('optionsBody');
  const ab = $('assignmentsBody');
  ob.querySelector('.af-empty-row')?.remove();
  ab.querySelector('.af-empty-row')?.remove();
  if (!ob.querySelector('.af-option-row')) ob.insertAdjacentHTML('beforeend', emptyRow(7, 'Nenhuma opção. Clique em "Adicionar opção".'));
  if (!ab.querySelector('.af-assignment-row')) ab.insertAdjacentHTML('beforeend', emptyRow(8, 'Nenhuma atribuição: vale o valor padrão.'));
}

// opções que estão na tela (código + nome), para os selects
function currentOptionCodes() {
  return [...document.querySelectorAll('#optionsBody .af-option-row')]
    .map((tr) => ({
      code: tr.querySelector('[data-f="option_code"]').value.trim().toUpperCase(),
      name: tr.querySelector('[data-f="option_name"]').value.trim(),
      active: tr.querySelector('[data-f="is_active"]').checked,
    }))
    .filter((o) => o.code);
}

function optionSelectHtml(selected, emptyText) {
  const opts = currentOptionCodes();
  const list = opts.map((o) =>
    `<option value="${escapeHtml(o.code)}">${escapeHtml(o.name || o.code)} (${escapeHtml(o.code)})${o.active ? '' : ' (inativa)'}</option>`);
  // mantém um código que sumiu da lista para o usuário ver e trocar
  if (selected && !opts.some((o) => o.code === selected)) {
    list.push(`<option value="${escapeHtml(selected)}">${escapeHtml(selected)} (não está na lista)</option>`);
  }
  return `<option value="">${emptyText}</option>${list.join('')}`;
}

// atualiza "Opção padrão" e as opções das atribuições, mantendo a escolha
function refreshOptionSelects() {
  const def = $('ff-default-option');
  const defValue = def.value || def.dataset.value || '';
  def.innerHTML = optionSelectHtml(defValue, '— Nenhuma —');
  def.value = defValue;
  def.dataset.value = '';

  document.querySelectorAll('#assignmentsBody [data-f="option_code"]').forEach((sel) => {
    const v = sel.value || sel.dataset.value || '';
    sel.innerHTML = optionSelectHtml(v, '— Nenhuma —');
    sel.value = v;
    sel.dataset.value = '';
  });
}

// ─────────────────────────────────────────────────────────────
// Modal: linhas de atribuições
// ─────────────────────────────────────────────────────────────
function addAssignmentRow(a = {}) {
  $('assignmentsBody').insertAdjacentHTML('beforeend', `<tr class="af-assignment-row" data-assignment-id="${a.feature_assignment_id || ''}">
    <td><input type="text" class="af-code" data-f="scope_type" maxlength="30" list="asf-scope-list" value="${escapeHtml(a.scope_type || 'GLOBAL')}" /></td>
    <td><input type="number" data-f="scope_id" min="1" step="1" value="${a.scope_id ?? 1}" /></td>
    <td><select data-f="option_code" data-value="${escapeHtml(a.option_code || '')}"></select></td>
    <td class="af-e-check"><input type="checkbox" data-f="is_enabled" ${a.is_enabled === false ? '' : 'checked'} /></td>
    <td><input type="datetime-local" data-f="starts_at" /></td>
    <td><input type="datetime-local" data-f="ends_at" /></td>
    <td><input type="text" class="af-json" data-f="custom_value" value="${escapeHtml(jsonText(a.custom_value))}" placeholder="Opcional" title='JSON. Ex.: 10, "texto" ou {"chave": 1}' /></td>
    <td><button type="button" class="af-del-btn" data-del="assignment" title="Remover atribuição">🗑</button></td>
  </tr>`);

  const tr = $('assignmentsBody').lastElementChild;
  const starts = tr.querySelector('[data-f="starts_at"]');
  const ends = tr.querySelector('[data-f="ends_at"]');
  enhanceBrDateTime(starts);
  enhanceBrDateTime(ends);
  starts.value = toLocalInput(a.starts_at);
  ends.value = toLocalInput(a.ends_at);
}

// ─────────────────────────────────────────────────────────────
// Modal: abrir
// ─────────────────────────────────────────────────────────────
function showDefaultField(type) {
  document.querySelectorAll('#featureForm [data-default]').forEach((el) => {
    el.hidden = el.dataset.default !== type;
  });
}

async function openFeatureModal(row = null) {
  let options = [];
  let assignments = [];
  if (row) {
    const [o, a] = await Promise.all([
      fetchJSON(`${API}/options?featureId=${row.feature_id}&includeInactive=true`),
      fetchJSON(`${API}/assignments?featureId=${row.feature_id}`),
    ]);
    options = o.data || [];
    assignments = a.data || [];
  }

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
  $('ff-default-json').value = type === 'JSON' ? jsonText(v) : '';
  $('ff-default-option').value = '';
  $('ff-default-option').dataset.value = type === 'OPTION' ? (v?.optionCode || '') : '';

  $('optionsBody').innerHTML = options.map(optionRowHtml).join('');
  $('assignmentsBody').innerHTML = '';
  assignments.forEach(addAssignmentRow);
  syncEmptyRows();
  refreshOptionSelects();

  showDefaultField(type);
  $('featureModalTitle').textContent = row
    ? `Funcionalidade #${row.feature_id}: ${row.feature_code}`
    : 'Nova funcionalidade';
  Modal.open('featureModal', { focusSelector: '#ff-name' });
}

// ─────────────────────────────────────────────────────────────
// Modal: salvar tudo
// ─────────────────────────────────────────────────────────────
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

function readOptions() {
  return [...document.querySelectorAll('#optionsBody .af-option-row')].map((tr, i) => {
    const f = (name) => tr.querySelector(`[data-f="${name}"]`);
    const code = f('option_code').value.trim().toUpperCase();
    const label = `Opção ${code || `da linha ${i + 1}`}`;
    const config = parseJsonField(f('option_config').value, `${label}, configuração`);
    if (config !== null && (typeof config !== 'object' || Array.isArray(config))) {
      throw new Error(`${label}: a configuração deve ser um objeto JSON, ex.: {"chave": "valor"}.`);
    }
    if (!code || !f('option_name').value.trim()) throw new Error(`Informe o código e o nome da opção da linha ${i + 1}.`);
    return {
      feature_option_id: Number(tr.dataset.optionId) || null,
      option_code: code,
      option_name: f('option_name').value.trim(),
      description: f('description').value.trim() || null,
      option_config: config ?? {},
      sort_order: Number(f('sort_order').value) || 0,
      is_active: f('is_active').checked,
    };
  });
}

function readAssignments() {
  return [...document.querySelectorAll('#assignmentsBody .af-assignment-row')].map((tr, i) => {
    const f = (name) => tr.querySelector(`[data-f="${name}"]`);
    const scopeType = f('scope_type').value.trim().toUpperCase() || 'GLOBAL';
    const scopeId = Number(f('scope_id').value);
    const label = `Atribuição ${scopeType} #${f('scope_id').value || '?'}`;
    if (!Number.isInteger(scopeId) || scopeId <= 0) throw new Error(`${label}: o ID do escopo deve ser um inteiro maior que zero.`);
    const startsAt = fromLocalInput(f('starts_at').value);
    const endsAt = fromLocalInput(f('ends_at').value);
    if (startsAt && endsAt && endsAt <= startsAt) throw new Error(`${label}: a data de fim deve ser depois da data de início.`);
    return {
      feature_assignment_id: Number(tr.dataset.assignmentId) || null,
      scope_type: scopeType,
      scope_id: scopeId,
      option_code: f('option_code').value || null,
      is_enabled: f('is_enabled').checked,
      starts_at: startsAt,
      ends_at: endsAt,
      custom_value: parseJsonField(f('custom_value').value, `${label}, valor personalizado`),
    };
  });
}

async function saveFeature(event) {
  event.preventDefault();
  const id = $('ff-id').value;
  const type = $('ff-type').value;

  let payload;
  try {
    payload = {
      feature: {
        feature_code: $('ff-code').value.trim().toUpperCase(),
        feature_name: $('ff-name').value.trim(),
        value_type: type,
        default_value: readDefaultValue(type),
        is_active: $('ff-active').value === 'true',
        description: $('ff-description').value.trim() || null,
      },
      options: readOptions(),
      assignments: readAssignments(),
    };
  } catch (error) {
    return warn(error.message);
  }
  if (!payload.feature.feature_code || !payload.feature.feature_name) return warn('Informe o código e o nome da funcionalidade.');

  await fetchJSON(id ? `${API}/features-full/${id}` : `${API}/features-full`, {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
  Modal.close('featureModal');
  showCenterModal({ variant: 'success', title: 'Sucesso', message: 'Funcionalidade, opções e atribuições salvas.' });
  await load();
}

// ─────────────────────────────────────────────────────────────
// Excluir funcionalidade
// ─────────────────────────────────────────────────────────────
async function removeFeature(row) {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Confirmar exclusão',
    message: `Excluir a funcionalidade "${row.feature_code}"? Antes, remova as opções e as atribuições dela no modal.`,
    okText: 'Sim, excluir',
    closeText: 'Cancelar',
  });
  if (ok !== true) return;

  await fetchJSON(`${API}/features/${row.feature_id}`, { method: 'DELETE' });
  await load();
}

// ─────────────────────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────────────────────
function bindEvents() {
  $('afSearch').addEventListener('input', render);
  $('afShowInactive').addEventListener('change', render);
  $('btnReload').addEventListener('click', () => load().catch(showError));
  $('btnNew').addEventListener('click', () => openFeatureModal().catch(showError));

  $('ff-type').addEventListener('change', (e) => showDefaultField(e.target.value));

  // Trocar a opção padrão leva a mesma opção para todas as atribuições:
  // os módulos leem a atribuição (GLOBAL #1 etc.), então o sistema todo
  // passa a funcionar com a nova opção ao salvar.
  $('ff-default-option').addEventListener('change', (e) => {
    const code = e.target.value;
    let rows = document.querySelectorAll('#assignmentsBody .af-assignment-row');
    if (!code) return;
    if (!rows.length) {
      // sem atribuição: cria a GLOBAL #1 para a opção valer de fato
      addAssignmentRow({ scope_type: 'GLOBAL', scope_id: 1, option_code: code });
      syncEmptyRows();
      refreshOptionSelects();
      rows = document.querySelectorAll('#assignmentsBody .af-assignment-row');
    }
    rows.forEach((tr) => {
      const sel = tr.querySelector('[data-f="option_code"]');
      sel.value = code;
      tr.classList.add('af-row-synced');
      setTimeout(() => tr.classList.remove('af-row-synced'), 1200);
    });
  });

  $('btnAddOption').addEventListener('click', () => {
    $('optionsBody').insertAdjacentHTML('beforeend', optionRowHtml({
      sort_order: (document.querySelectorAll('#optionsBody .af-option-row').length + 1) * 10,
    }));
    syncEmptyRows();
    $('optionsBody').querySelector('.af-option-row:last-of-type [data-f="option_code"]')?.focus();
  });

  $('btnAddAssignment').addEventListener('click', () => {
    const used = new Set([...document.querySelectorAll('#assignmentsBody [data-f="scope_type"]')].map((i) => i.value.trim().toUpperCase()));
    addAssignmentRow({ scope_type: used.has('GLOBAL') ? 'COMPANY' : 'GLOBAL', scope_id: 1 });
    syncEmptyRows();
    refreshOptionSelects();
  });

  // código/nome/ativa das opções mudam os selects de opção
  $('optionsBody').addEventListener('input', (e) => {
    if (e.target.matches('[data-f="option_code"], [data-f="option_name"]')) refreshOptionSelects();
  });
  $('optionsBody').addEventListener('change', (e) => {
    if (e.target.matches('[data-f="is_active"]')) refreshOptionSelects();
  });

  // remover linhas
  $('featureForm').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    btn.closest('tr').remove();
    syncEmptyRows();
    refreshOptionSelects();
  });

  $('featureForm').addEventListener('submit', (e) => saveFeature(e).catch(showError));

  $('afBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const row = state.features.find((r) => String(r.feature_id) === tr.dataset.id);
    if (!row) return;
    if (btn?.dataset.act === 'delete') removeFeature(row).catch(showError);
    else openFeatureModal(row).catch(showError);
  });
}

Modal.setup();
bindEvents();
load().catch(showError);
