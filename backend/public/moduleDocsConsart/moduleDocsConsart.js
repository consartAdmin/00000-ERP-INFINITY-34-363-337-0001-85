// ╔══════════════════════════════════════════════════════════════════════╗
// ║ moduleDocsConsart.js — Documentação dos módulos (CONSART ERP)        ║
// ║ • Lista em árvore (ordem do menu) com filtros: texto, módulo, tipo,  ║
// ║   documentação e status                                              ║
// ║ • Editor em modal: descrição, funções (uma por linha), observações,  ║
// ║   status; "Salvar e próximo" para documentar em sequência            ║
// ║ • PDF com os filtros da tela                                         ║
// ║ API: /api/module-docs-consart                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { apiFetch, getAuthToken } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';

const API = '/api/module-docs-consart';

const $ = (sel) => document.querySelector(sel);

const state = {
  rows: [],      // ordem do menu (vinda da API)
  view: [],      // ordem exibida (após ordenação por coluna)
  editingId: null,
  sort: '',
  dir: 'asc',
};

let sorter = null;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function statusBadge(status, label) {
  return `<span class="doc-status doc-status--${esc(status)}">${esc(label)}</span>`;
}

const SYSTEM_LABELS = Object.freeze({ CORE: 'Core', EDGE: 'Edge', INFINITY: 'Infinity' });

function systemsBadges(systems = []) {
  if (!systems.length) return '—';
  return systems.map((s) => `<span class="doc-system doc-system--${esc(s)}">${esc(SYSTEM_LABELS[s] || s)}</span>`).join('');
}

function dateTimeBR(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function filterParams() {
  const params = new URLSearchParams();
  const q = $('#q').value.trim();
  if (q) params.set('q', q);
  if ($('#filterModule').value) params.set('module', $('#filterModule').value);
  if ($('#filterType').value) params.set('type', $('#filterType').value);
  if ($('#filterStatus').value) params.set('status', $('#filterStatus').value);
  if ($('#filterSystem').value) params.set('system', $('#filterSystem').value);
  if ($('#filterActive').value) params.set('active', $('#filterActive').value);
  return params;
}

function selectedText(sel) {
  const el = $(sel);
  return el.value ? el.options[el.selectedIndex]?.textContent.trim() : '';
}

function filtersDescription() {
  const parts = [];
  if (selectedText('#filterModule')) parts.push(`Módulo: ${selectedText('#filterModule')}`);
  if (selectedText('#filterType')) parts.push(`Tipo: ${selectedText('#filterType')}`);
  if (selectedText('#filterSystem')) parts.push(`Sistema: ${selectedText('#filterSystem')}`);
  if (selectedText('#filterStatus')) parts.push(`Documentação: ${selectedText('#filterStatus')}`);
  if ($('#filterActive').value) parts.push(selectedText('#filterActive'));
  if ($('#q').value.trim()) parts.push(`Busca: "${$('#q').value.trim()}"`);
  return parts.length ? parts.join(' · ') : 'Todos os módulos';
}

// ─────────────────────────────────────────────────────────────────────
// Módulos (filtro)
// ─────────────────────────────────────────────────────────────────────

async function loadModules() {
  try {
    const json = await apiFetch(`${API}/modules`);
    const modules = json.data || [];
    const select = $('#filterModule');
    const current = select.value;
    select.innerHTML = '<option value="">Todos</option>' +
      modules.map((m) => `<option value="${m.id}">${esc(m.name)}${m.is_active ? '' : ' (inativo)'}</option>`).join('');
    select.value = modules.some((m) => String(m.id) === current) ? current : '';
  } catch (error) {
    console.warn('[moduleDocsConsart] módulos:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lista
// ─────────────────────────────────────────────────────────────────────

async function loadList() {
  try {
    const json = await apiFetch(`${API}?${filterParams()}`);
    state.rows = json.data || [];
    applySort();
    renderList(json.summary || {});
  } catch (error) {
    console.error('[moduleDocsConsart] lista:', error);
    alert(`Erro ao carregar módulos: ${error.message}`);
  }
}

function applySort() {
  if (!state.sort) {
    state.view = state.rows.slice();
    return;
  }
  const factor = state.dir === 'desc' ? -1 : 1;
  const key = state.sort;
  state.view = state.rows.slice().sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR', { sensitivity: 'base' }) * factor;
  });
}

function nameCell(r) {
  // Recuo da árvore só na ordem do menu
  const indent = state.sort ? 0 : Math.min(r.level, 4) * 18;
  const branch = !state.sort && r.level > 0 ? '<span class="docs-name__branch">└</span>' : '';
  const title = state.sort ? r.breadcrumb : r.name;
  return `<span class="docs-name" style="padding-left:${indent}px" title="${esc(r.breadcrumb)}">${branch}${esc(title)}</span>`;
}

function renderList(summary) {
  $('#docsBody').innerHTML = state.view.map((r) => `
    <tr data-id="${r.id}" class="level-${state.sort ? 'x' : r.level} ${r.is_active ? '' : 'is-inactive'}">
      <td class="docs-col-left">${nameCell(r)}</td>
      <td>${esc(r.type_label)}</td>
      <td>${systemsBadges(r.systems)}</td>
      <td class="docs-col-left" title="${esc(r.description)}">${r.description
        ? esc(r.description.replace(/\s+/g, ' '))
        : '<span class="docs-desc-empty">Sem descrição</span>'}</td>
      <td>${r.functions_count || '—'}</td>
      <td>${statusBadge(r.doc_status, r.doc_status_label)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Documentar', attrs: { 'data-act': 'edit', 'data-id': r.id } },
        { action: 'delete', title: 'Excluir módulo', attrs: { 'data-act': 'delete', 'data-id': r.id } },
      ])}</td>
    </tr>
  `).join('');

  $('#docsEmpty').hidden = state.view.length > 0;

  const total = Number(summary.total ?? state.rows.length);
  $('#docsInfo').textContent = plural(total, 'item', 'itens');
  $('#sumDocumentado').textContent = plural(Number(summary.DOCUMENTADO || 0), 'documentado', 'documentados');
  $('#sumRevisar').textContent = `${Number(summary.REVISAR || 0)} a revisar`;
  $('#sumPendente').textContent = plural(Number(summary.PENDENTE || 0), 'pendente', 'pendentes');
}

function onListClick(event) {
  const tr = event.target.closest('tr[data-id]');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  if (event.target.closest('[data-act="delete"]')) {
    deleteModule(id);
    return;
  }
  openEditor(id);
}

async function deleteModule(id) {
  const row = state.rows.find((r) => r.id === id);
  const label = row ? row.breadcrumb : `#${id}`;
  if (!confirm(`Excluir o módulo "${label}"?\n\nEle sai do menu e do cadastro de módulos (Criação de Módulos), junto com a documentação. Não dá para desfazer.`)) return;
  try {
    await apiFetch(`${API}/${id}`, { method: 'DELETE' });
    await loadModules();
    await loadList();
  } catch (error) {
    alert(`Não foi possível excluir: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────────────

function fillForm(r) {
  state.editingId = r.id;
  $('#docModalTitle').textContent = `Documentar: ${r.name}`;
  $('#df-breadcrumb').textContent = r.breadcrumb || r.name;
  $('#df-breadcrumb').title = r.breadcrumb || r.name;
  $('#df-type').textContent = `${r.type_label}${r.is_active ? '' : ' (inativo)'}`;
  $('#df-path').textContent = r.type === 'link' && r.path ? r.path : '—';
  $('#df-path').title = r.path || '';
  $('#df-status').value = r.doc_status || 'PENDENTE';
  const systems = r.systems || [];
  document.querySelectorAll('#df-systems input').forEach((input) => { input.checked = systems.includes(input.value); });
  $('#df-description').value = r.description || '';
  $('#df-functions').value = r.functions || '';
  $('#df-notes').value = r.notes || '';
  $('#df-updated').textContent = r.doc_updated_at
    ? `Atualizado em ${dateTimeBR(r.doc_updated_at)}${r.doc_updated_by ? ` por ${r.doc_updated_by}` : ''}`
    : 'Ainda não documentado.';

  const index = state.view.findIndex((x) => x.id === r.id);
  $('#df-prev').disabled = index <= 0;
  $('#df-next').disabled = index < 0 || index >= state.view.length - 1;
  $('#df-save-next').disabled = $('#df-next').disabled;
}

async function openEditor(id) {
  try {
    const json = await apiFetch(`${API}/${id}`);
    fillForm(json.data);
  } catch (error) {
    alert(`Erro ao abrir o módulo: ${error.message}`);
    return;
  }
  if (!Modal.isOpen('doc-modal')) Modal.open('doc-modal', { focusSelector: '#df-description' });
}

function move(step) {
  const index = state.view.findIndex((x) => x.id === state.editingId);
  const next = state.view[index + step];
  if (next) openEditor(next.id);
}

async function saveDoc({ goNext = false } = {}) {
  const description = $('#df-description').value.trim();
  const status = $('#df-status').value;
  const payload = {
    description,
    functions: $('#df-functions').value,
    notes: $('#df-notes').value,
    // Escreveu a descrição e deixou "Pendente": vira Documentado
    status: status === 'PENDENTE' && description ? 'DOCUMENTADO' : status,
    systems: [...document.querySelectorAll('#df-systems input:checked')].map((input) => input.value),
  };

  const buttons = [$('#df-save'), $('#df-save-next')];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const json = await apiFetch(`${API}/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    const saved = json.data;
    const index = state.rows.findIndex((x) => x.id === saved.id);
    if (index >= 0) state.rows[index] = saved;
    const viewIndex = state.view.findIndex((x) => x.id === saved.id);
    if (viewIndex >= 0) state.view[viewIndex] = saved;

    if (goNext && state.view[viewIndex + 1]) {
      await openEditor(state.view[viewIndex + 1].id);
    } else {
      Modal.close('doc-modal');
    }
    // Atualiza contadores/status sem perder a posição do editor
    await loadList();
  } catch (error) {
    alert(`Erro ao salvar: ${error.message}`);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    const current = state.rows.find((x) => x.id === state.editingId);
    if (current && Modal.isOpen('doc-modal')) fillForm(current);
  }
}

// ─────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────

function openPdf() {
  $('#pdf-filters').textContent = filtersDescription();
  Modal.open('pdf-modal', { focusSelector: '#pdf-generate' });
}

async function downloadPdf() {
  const params = filterParams();
  params.set('showEmpty', $('#pdf-empty').checked ? '1' : '0');
  params.set('showPaths', $('#pdf-paths').checked ? '1' : '0');
  params.set('showNotes', $('#pdf-notes').checked ? '1' : '0');

  const btn = $('#pdf-generate');
  btn.disabled = true;
  try {
    const token = getAuthToken();
    const response = await fetch(`${API}/pdf?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } : { Accept: 'application/pdf' },
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(json?.error || `HTTP ${response.status}`);
    }

    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'Documentacao_Modulos.pdf';

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    Modal.close('pdf-modal');
  } catch (error) {
    console.error('[moduleDocsConsart] pdf:', error);
    alert(`Erro ao gerar PDF: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────────────────────────────

function bindEvents() {
  $('#btnSearch').addEventListener('click', loadList);
  $('#btnReload').addEventListener('click', async () => {
    // Volta para a ordem do menu
    state.sort = '';
    sorter?.reset();
    await loadModules();
    await loadList();
  });
  $('#btnPdf').addEventListener('click', openPdf);
  $('#btnBack').addEventListener('click', () => history.back());
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadList(); });
  ['#filterModule', '#filterType', '#filterSystem', '#filterStatus', '#filterActive']
    .forEach((sel) => $(sel).addEventListener('change', loadList));
  $('#docsBody').addEventListener('click', onListClick);

  // Ordenação no navegador (lista inteira); "Recarregar" volta à ordem do menu
  sorter = createSortableTable({
    table: '#docsTable',
    onSort({ column, direction }) {
      state.sort = column;
      state.dir = direction;
      applySort();
      renderList(currentSummary());
    },
  });

  $('#df-save').addEventListener('click', () => saveDoc());
  $('#df-save-next').addEventListener('click', () => saveDoc({ goNext: true }));
  $('#df-prev').addEventListener('click', () => move(-1));
  $('#df-next').addEventListener('click', () => move(1));
  $('#doc-form').addEventListener('submit', (e) => { e.preventDefault(); saveDoc(); });
  $('#pdf-generate').addEventListener('click', downloadPdf);
}

function currentSummary() {
  const summary = { total: state.rows.length, PENDENTE: 0, REVISAR: 0, DOCUMENTADO: 0 };
  state.rows.forEach((r) => { summary[r.doc_status] = (summary[r.doc_status] || 0) + 1; });
  return summary;
}

// ─────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────

Modal.setup();
bindEvents();
loadModules();
loadList();
