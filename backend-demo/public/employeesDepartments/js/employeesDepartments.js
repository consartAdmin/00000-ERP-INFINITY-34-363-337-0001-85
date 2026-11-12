// ╔══════════════════════════════════════════════════════════════════════╗
// ║ employeesDepartments.js — Cadastro de Departamentos (R.H | ESM)      ║
// ║ Lista (filtro local) + modal de edição                               ║
// ║ API: /api/employees-departments                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝
'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';

const API = '/api/employees-departments';
const LABEL = { one: 'departamento', title: 'Departamento' };

const $ = (id) => document.getElementById(id);
const state = { rows: [] };

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

// ─────────────────────────────────────────────────────────────
// Lista
// ─────────────────────────────────────────────────────────────
async function load() {
  const active = $('catalogShowInactive').checked ? '' : 'true';
  const { data } = await fetchJSON(`${API}?active=${active}`);
  state.rows = data || [];
  render();
}

function filteredRows() {
  const q = $('catalogSearch').value.trim().toLowerCase();
  if (!q) return state.rows;
  return state.rows.filter((r) =>
    `${r.name} ${r.description || ''}`.toLowerCase().includes(q));
}

function render() {
  const rows = filteredRows();
  const body = $('catalogBody');

  body.innerHTML = rows.length ? rows.map((r) => `
    <tr data-id="${r.employee_department_id}">
      <td>${r.employee_department_id}</td>
      <td class="cat-cell-left">${escapeHtml(r.name)}</td>
      <td class="cat-cell-left cat-cell-muted">${escapeHtml(r.description || '')}</td>
      <td>${r.employees_count || 0}</td>
      <td>${r.active
        ? '<span class="emp-pill emp-pill--active">● Ativo</span>'
        : '<span class="emp-pill emp-pill--inactive">● Inativo</span>'}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': r.employee_department_id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': r.employee_department_id } },
      ])}</td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="emp-empty">Nenhum ${LABEL.one} encontrado.</td></tr>`;

  $('catalogInfo').textContent = `${rows.length} Registro${rows.length === 1 ? '' : 's'}`;
}

// ─────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────
function openModal(row = null) {
  $('cf-id').value = row?.employee_department_id || '';
  $('cf-name').value = row?.name || '';
  $('cf-description').value = row?.description || '';
  $('cf-active').value = row && !row.active ? 'false' : 'true';
  $('catalogModalTitle').textContent = row ? `${LABEL.title} #${row.employee_department_id}` : `Novo ${LABEL.one}`;
  Modal.open('catalogModal', { focusSelector: '#cf-name' });
}

async function save(event) {
  event.preventDefault();
  const id = $('cf-id').value;
  const payload = {
    name: $('cf-name').value.trim(),
    description: $('cf-description').value.trim() || null,
    active: $('cf-active').value === 'true',
  };
  if (!payload.name) {
    showCenterModal({ variant: 'warning', title: 'Atenção', message: 'Informe o nome.' });
    return;
  }

  await fetchJSON(id ? `${API}/${id}` : API, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
  Modal.close('catalogModal');
  showCenterModal({ variant: 'success', title: 'Sucesso', message: `${LABEL.title} salvo.` });
  await load();
}

async function removeRow(row) {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Confirmar exclusão',
    message: `Excluir o ${LABEL.one} "${row.name}"?`,
    okText: 'Sim, excluir',
    closeText: 'Cancelar',
  });
  if (ok !== true) return;

  await fetchJSON(`${API}/${row.employee_department_id}`, { method: 'DELETE' });
  await load();
}

// ─────────────────────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────────────────────
function bindEvents() {
  $('catalogSearch').addEventListener('input', render);
  $('catalogShowInactive').addEventListener('change', () => load().catch(showError));
  $('btnReload').addEventListener('click', () => load().catch(showError));
  $('btnNew').addEventListener('click', () => openModal());
  $('catalogForm').addEventListener('submit', (e) => save(e).catch(showError));

  $('catalogBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const row = state.rows.find((r) => String(r.employee_department_id) === tr.dataset.id);
    if (!row) return;
    if (btn?.dataset.act === 'delete') removeRow(row).catch(showError);
    else openModal(row);
  });
}

Modal.setup();
bindEvents();
load().catch(showError);
