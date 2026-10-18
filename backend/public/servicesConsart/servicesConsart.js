// ╔══════════════════════════════════════════════════════════════════════╗
// ║ servicesConsart.js — Cadastro de serviços (CONSART ERP)              ║
// ║ • Lista com filtros (texto, status, categoria) e paginação           ║
// ║ • Editor em modal: código, descrição, unidade, preço, cód. LC 116,   ║
// ║   categoria, detalhes, ativo                                         ║
// ║ API: /api/services-consart                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { apiFetch } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';

const API = '/api/services-consart';

const $ = (sel) => document.querySelector(sel);

const state = {
  page: 1,
  pages: 1,
  rows: [],
  editingId: null,
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusBadge(active) {
  return active
    ? '<span class="service-status service-status--ativo">Ativo</span>'
    : '<span class="service-status service-status--inativo">Inativo</span>';
}

// ─────────────────────────────────────────────────────────────────────
// Categorias (filtro + sugestões do formulário)
// ─────────────────────────────────────────────────────────────────────

async function loadCategories() {
  try {
    const json = await apiFetch(`${API}/categories`);
    const categories = json.data || [];

    const select = $('#filterCategory');
    const current = select.value;
    select.innerHTML = '<option value="">Todas</option>' +
      categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    select.value = categories.includes(current) ? current : '';

    $('#sf-categories').innerHTML = categories.map((c) => `<option value="${esc(c)}"></option>`).join('');
  } catch (error) {
    console.warn('[servicesConsart] categorias:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lista
// ─────────────────────────────────────────────────────────────────────

async function loadList() {
  const params = new URLSearchParams({
    page: String(state.page),
    limit: $('#pageSize').value,
  });
  const q = $('#q').value.trim();
  if (q) params.set('q', q);
  if ($('#filterActive').value) params.set('active', $('#filterActive').value);
  if ($('#filterCategory').value) params.set('category', $('#filterCategory').value);

  try {
    const json = await apiFetch(`${API}?${params}`);
    state.rows = json.data || [];
    state.pages = json.pages || 1;
    state.page = Math.min(state.page, state.pages);
    renderList(json);
  } catch (error) {
    console.error('[servicesConsart] lista:', error);
    alert(`Erro ao carregar serviços: ${error.message}`);
  }
}

function renderList(json) {
  $('#servicesBody').innerHTML = state.rows.map((s) => `
    <tr data-id="${s.id}" class="${s.active ? '' : 'is-inactive'}">
      <td>${esc(s.code)}</td>
      <td class="services-col-left" title="${esc(s.details || s.description)}">${esc(s.description)}</td>
      <td>${esc(s.unit)}</td>
      <td>${esc(s.service_code || '—')}</td>
      <td>${esc(s.category || '—')}</td>
      <td class="services-col-money">${money(s.price)}</td>
      <td>${statusBadge(s.active)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': s.id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': s.id } },
      ])}</td>
    </tr>
  `).join('');

  $('#servicesEmpty').hidden = state.rows.length > 0;

  const count = Number(json?.count || 0);
  $('#servicesInfo').textContent = `${count} ${count === 1 ? 'serviço' : 'serviços'}`;
  $('#pageInfo').textContent = `Página ${state.page} de ${state.pages}`;
  $('#btnPrevious').disabled = state.page <= 1;
  $('#btnNext').disabled = state.page >= state.pages;
}

async function onListClick(event) {
  const btn = event.target.closest('[data-act]');
  const tr = event.target.closest('tr[data-id]');
  if (!tr) return undefined;
  const id = Number(btn?.dataset.id || tr.dataset.id);

  if ((btn?.dataset.act || 'edit') === 'delete') return deleteService(id);
  return openEditor(id);
}

async function deleteService(id) {
  const row = state.rows.find((r) => Number(r.id) === id);
  const label = row ? `${row.code} - ${row.description}` : id;
  if (!confirm(`Excluir o serviço ${label}?\nAs propostas já feitas não mudam. Para só esconder da busca, deixe-o Inativo.`)) return;
  try {
    await apiFetch(`${API}/${id}`, { method: 'DELETE' });
    await loadList();
  } catch (error) {
    alert(`Erro ao excluir: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────────────

function fillForm(s = {}) {
  state.editingId = s.id || null;
  $('#serviceModalTitle').textContent = s.id ? `Serviço ${s.code}` : 'Novo Serviço';
  $('#sf-code').value = s.code || '';
  $('#sf-description').value = s.description || '';
  $('#sf-unit').value = s.unit || 'SV';
  $('#sf-price').value = s.id ? money(s.price) : '';
  $('#sf-service-code').value = s.service_code || '';
  $('#sf-active').value = s.active === false ? 'false' : 'true';
  $('#sf-category').value = s.category || '';
  $('#sf-details').value = s.details || '';
}

async function openEditor(id = null) {
  if (id) {
    try {
      const json = await apiFetch(`${API}/${id}`);
      fillForm(json.data);
    } catch (error) {
      alert(`Erro ao abrir o serviço: ${error.message}`);
      return;
    }
  } else {
    fillForm();
  }
  Modal.open('service-modal', { focusSelector: '#sf-description' });
}

async function saveService() {
  const payload = {
    code: $('#sf-code').value,
    description: $('#sf-description').value,
    unit: $('#sf-unit').value,
    price: $('#sf-price').value,
    service_code: $('#sf-service-code').value,
    active: $('#sf-active').value === 'true',
    category: $('#sf-category').value,
    details: $('#sf-details').value,
  };

  if (!payload.description.trim()) {
    alert('Informe a descrição do serviço.');
    $('#sf-description').focus();
    return;
  }

  const btn = $('#sf-save');
  btn.disabled = true;
  try {
    if (state.editingId) {
      await apiFetch(`${API}/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await apiFetch(API, { method: 'POST', body: JSON.stringify(payload) });
    }
    Modal.close('service-modal');
    await loadCategories();
    await loadList();
  } catch (error) {
    alert(`Erro ao salvar: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────────────────────────────

function bindEvents() {
  const search = () => { state.page = 1; loadList(); };

  $('#btnSearch').addEventListener('click', search);
  $('#btnReload').addEventListener('click', () => loadList());
  $('#btnNew').addEventListener('click', () => openEditor());
  $('#btnBack').addEventListener('click', () => history.back());
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  ['#filterActive', '#filterCategory', '#pageSize']
    .forEach((sel) => $(sel).addEventListener('change', search));
  $('#btnPrevious').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadList(); } });
  $('#btnNext').addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; loadList(); } });
  $('#servicesBody').addEventListener('click', onListClick);

  $('#sf-price').addEventListener('blur', (e) => {
    const s = e.target.value.trim();
    if (!s) return;
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    if (Number.isFinite(n)) e.target.value = money(n);
  });
  $('#sf-save').addEventListener('click', saveService);
  $('#service-form').addEventListener('submit', (e) => { e.preventDefault(); saveService(); });
}

// ─────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────

Modal.setup();
bindEvents();
loadCategories();
loadList();
