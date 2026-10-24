// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ employees.catalogPicker.js — Departamento/Cargo no modal do colaborador      ║
// ║ Ícones discretos (actionIcons) no rótulo dos campos:                         ║
// ║   🔎 lupa → #catalogPickerModal (localizar e escolher)                       ║
// ║   ＋ add  → #catalogQuickModal (cadastro rápido; já preenche o campo)        ║
// ║ O campo guarda o nome (texto) + o id no hidden *_id.                         ║
// ║ API: /api/employees-departments  |  /api/employees-positions                 ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { fetchJSON } from './employees.api.js';
import { qs, escapeHtml } from './employees.utils.js';

const KINDS = {
  departments: {
    api: '/api/employees-departments',
    pk: 'employee_department_id',
    input: '#department',
    hidden: '#employee_department_id',
    one: 'departamento',
    title: 'Departamento',
  },
  positions: {
    api: '/api/employees-positions',
    pk: 'employee_position_id',
    input: '#position',
    hidden: '#employee_position_id',
    one: 'cargo',
    title: 'Cargo',
  },
};

const picker = { kind: null, rows: [] };

function authHeaders() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─────────────────────────────────────────────────────────────
// Valor do campo (nome + id)
// ─────────────────────────────────────────────────────────────
export function setCatalogValue(kind, row) {
  const cfg = KINDS[kind];
  qs(cfg.input).value = row?.name || '';
  qs(cfg.hidden).value = row?.[cfg.pk] || '';
}

function currentId(kind) {
  return Number(qs(KINDS[kind].hidden).value) || null;
}

function choose(kind, row) {
  setCatalogValue(kind, row);

  // cargo com departamento definido preenche o Departamento se estiver vazio
  if (kind === 'positions' && row?.employee_department_id && !currentId('departments')) {
    setCatalogValue('departments', { employee_department_id: row.employee_department_id, name: row.department_name });
  }
}

async function loadRows(kind) {
  const { data } = await fetchJSON(`${KINDS[kind].api}?active=true`, { headers: authHeaders() });
  return data || [];
}

// ─────────────────────────────────────────────────────────────
// Localizar (lupa)
// ─────────────────────────────────────────────────────────────
function renderPicker() {
  const { kind } = picker;
  const cfg = KINDS[kind];
  const withDept = kind === 'positions';
  const q = qs('#catalogPickerSearch').value.trim().toLowerCase();
  const selected = currentId(kind);

  const rows = picker.rows.filter((r) =>
    !q || `${r.name} ${r.department_name || ''} ${r.description || ''}`.toLowerCase().includes(q));

  qs('#catalogPickerHead').innerHTML = `
    <tr>
      <th class="cat-col-name">Nome</th>
      ${withDept ? '<th class="cat-col-dept">Departamento</th>' : ''}
      <th class="cat-col-desc">Descrição</th>
    </tr>`;

  qs('#catalogPickerBody').innerHTML = rows.length ? rows.map((r) => `
    <tr data-id="${r[cfg.pk]}" class="${r[cfg.pk] === selected ? 'is-current' : ''}" title="Clique para escolher">
      <td class="cat-cell-left">${escapeHtml(r.name)}</td>
      ${withDept ? `<td class="cat-cell-left">${escapeHtml(r.department_name || '')}</td>` : ''}
      <td class="cat-cell-left cat-cell-muted">${escapeHtml(r.description || '')}</td>
    </tr>`).join('')
    : `<tr><td colspan="${withDept ? 3 : 2}" class="emp-empty">Nenhum ${cfg.one} encontrado. Use “➕ Novo” para cadastrar.</td></tr>`;
}

export async function openCatalogPicker(kind) {
  picker.kind = kind;
  picker.rows = await loadRows(kind);
  qs('#catalogPickerTitle').textContent = `🔎 Localizar ${KINDS[kind].one}`;
  qs('#catalogPickerSearch').value = '';
  renderPicker();
  Modal.open('catalogPickerModal', { focusSelector: '#catalogPickerSearch' });
}

// ─────────────────────────────────────────────────────────────
// Cadastro rápido (+)
// ─────────────────────────────────────────────────────────────
export async function openCatalogQuick(kind, presetName = '') {
  picker.kind = kind;
  const isPosition = kind === 'positions';

  qs('#catalogQuickTitle').textContent = `➕ Novo ${KINDS[kind].one}`;
  qs('#catalogQuickName').value = presetName;
  qs('#catalogQuickDesc').value = '';
  qs('#catalogQuickDeptWrap').hidden = !isPosition;

  if (isPosition) {
    const departments = await loadRows('departments');
    qs('#catalogQuickDept').innerHTML = '<option value="">— Nenhum —</option>' +
      departments.map((d) => `<option value="${d.employee_department_id}">${escapeHtml(d.name)}</option>`).join('');
    // já sugere o departamento escolhido no colaborador
    qs('#catalogQuickDept').value = currentId('departments') ? String(currentId('departments')) : '';
  }

  Modal.open('catalogQuickModal', { focusSelector: '#catalogQuickName' });
}

async function saveQuick(event) {
  event.preventDefault();
  const kind = picker.kind;
  const name = qs('#catalogQuickName').value.trim();
  if (!name) {
    showCenterModal({ variant: 'warning', title: 'Atenção', message: 'Informe o nome.' });
    return;
  }

  const payload = { name, description: qs('#catalogQuickDesc').value.trim() || null };
  if (kind === 'positions') payload.employee_department_id = Number(qs('#catalogQuickDept').value) || null;

  const { data } = await fetchJSON(KINDS[kind].api, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });

  Modal.close('catalogQuickModal');
  Modal.close('catalogPickerModal');
  choose(kind, data);
}

// ─────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────
function showError(error) {
  showCenterModal({ variant: 'error', title: 'Erro', message: error?.message || String(error) });
}

export function initCatalogPicker() {
  // ícones nos rótulos
  document.querySelectorAll('[data-catalog-actions]').forEach((slot) => {
    const kind = slot.dataset.catalogActions;
    const { one } = KINDS[kind];
    slot.innerHTML = actionIconsHtml([
      { action: 'search', title: `Localizar ${one}`, attrs: { 'data-catalog-act': 'search', 'data-kind': kind } },
      { action: 'add', title: `Cadastrar ${one}`, attrs: { 'data-catalog-act': 'add', 'data-kind': kind } },
    ]);
  });

  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-catalog-act]');
    const field = e.target.closest('[data-catalog-open]');
    if (act?.dataset.catalogAct === 'search') openCatalogPicker(act.dataset.kind).catch(showError);
    else if (act?.dataset.catalogAct === 'add') openCatalogQuick(act.dataset.kind).catch(showError);
    else if (field) openCatalogPicker(field.dataset.catalogOpen).catch(showError);
  });

  // Enter/espaço no campo só leitura também abre a busca
  document.querySelectorAll('[data-catalog-open]').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openCatalogPicker(input.dataset.catalogOpen).catch(showError);
    });
  });

  qs('#catalogPickerSearch').addEventListener('input', renderPicker);
  qs('#catalogPickerSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter escolhe quando sobrou um só resultado
    const rows = qs('#catalogPickerBody').querySelectorAll('tr[data-id]');
    if (rows.length === 1) rows[0].click();
  });

  qs('#catalogPickerBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const cfg = KINDS[picker.kind];
    const row = picker.rows.find((r) => String(r[cfg.pk]) === tr.dataset.id);
    if (!row) return;
    choose(picker.kind, row);
    Modal.close('catalogPickerModal');
  });

  qs('#catalogPickerNew').addEventListener('click', () => {
    openCatalogQuick(picker.kind, qs('#catalogPickerSearch').value.trim()).catch(showError);
  });

  qs('#catalogPickerClear').addEventListener('click', () => {
    setCatalogValue(picker.kind, null);
    Modal.close('catalogPickerModal');
  });

  qs('#catalogQuickForm').addEventListener('submit', (e) => saveQuick(e).catch(showError));
}
