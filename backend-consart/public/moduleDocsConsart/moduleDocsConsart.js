// ╔══════════════════════════════════════════════════════════════════════╗
// ║ moduleDocsConsart.js — Documentação dos módulos (CONSART ERP)        ║
// ║ • Lista em árvore (ordem do menu) com filtros: texto, módulo, tipo,  ║
// ║   documentação e status                                              ║
// ║ • Controle interno: nada aqui altera o menu do sistema               ║
// ║ • Editor em modal: nome, tipo, "Dentro de", endereço, ordem, ativo,  ║
// ║   descrição, funções, observações, status, sistemas e softwares;     ║
// ║   "Salvar e próximo" para documentar em sequência                    ║
// ║ • PDF com os filtros da tela                                         ║
// ║ • Lista = módulos do ERP Infinity ("Importar do ERP Infinity", que   ║
// ║   também preenche o texto comercial dos itens vazios → "Revisar")    ║
// ║ • Visão "Catálogo comercial": cards por módulo (só "Documentado" e   ║
// ║   ativos) para os vendedores + "PDF Comercial"                       ║
// ║ API: /api/module-docs-consart                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { apiFetch, getAuthToken } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const API = '/api/module-docs-consart';

const $ = (sel) => document.querySelector(sel);

const state = {
  rows: [],      // ordem do menu (vinda da API)
  view: [],      // ordem exibida (após ordenação por coluna)
  editingId: null,
  software: [],  // cadastro de softwares (Consart Infinity, Logistics...)
  sort: '',
  dir: 'asc',
  mode: 'table', // visão: 'table' | 'catalog'
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

function softwareBadges(ids = []) {
  const names = ids.map((id) => state.software.find((sw) => sw.id === id)).filter(Boolean);
  if (!names.length) return '—';
  // Na tabela sem o "Consart " para caber; nome completo no tooltip
  return names.map((sw) => `<span class="doc-software" title="${esc(sw.name)}${sw.description ? ` · ${esc(sw.description)}` : ''}">${esc(sw.name.replace(/^consart\s+/i, ''))}</span>`).join('');
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
  if ($('#filterSoftware').value) params.set('software', $('#filterSoftware').value);
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
  if (selectedText('#filterSoftware')) parts.push(`Software: ${selectedText('#filterSoftware')}`);
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
    // Nome repetido (ex.: dois "Clientes"): mostra o código para diferenciar
    const count = {};
    modules.forEach((m) => { count[m.name] = (count[m.name] || 0) + 1; });
    select.innerHTML = '<option value="">Todos</option>' +
      modules.map((m) => `<option value="${m.id}">${esc(m.name)}${count[m.name] > 1 ? ` (#${m.id})` : ''}${m.is_active ? '' : ' (inativo)'}</option>`).join('');
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
  const hidden = r.hidden_children
    ? ` <button type="button" class="docs-hidden" data-act="show-hidden" title="Itens inativos dentro deste, escondidos pelo Status = Ativos. Clique para mostrar.">+${r.hidden_children} inativo${r.hidden_children > 1 ? 's' : ''}</button>`
    : '';
  return `<span class="docs-name" style="padding-left:${indent}px" title="${esc(r.breadcrumb)}">${branch}${esc(title)}</span>${hidden}`;
}

function renderList(summary) {
  $('#docsBody').innerHTML = state.view.map((r) => `
    <tr data-id="${r.id}" class="level-${state.sort ? 'x' : r.level} ${r.is_active ? '' : 'is-inactive'}">
      <td class="docs-col-left">${nameCell(r)}</td>
      <td>${esc(r.type_label)}</td>
      <td>${systemsBadges(r.systems)}</td>
      <td>${softwareBadges(r.software_ids)}</td>
      <td class="docs-col-left" title="${esc(r.description)}">${r.description
        ? esc(r.description.replace(/\s+/g, ' '))
        : '<span class="docs-desc-empty">Sem descrição</span>'}</td>
      <td>${r.functions_count || '—'}</td>
      <td>${statusBadge(r.doc_status, r.doc_status_label)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': r.id } },
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
  if (event.target.closest('[data-act="show-hidden"]')) {
    const row = state.rows.find((r) => r.id === id);
    if (row) showModuleItems(row);
    return;
  }
  if (event.target.closest('[data-act="delete"]')) {
    deleteModule(id);
    return;
  }
  openEditor(id);
}

async function deleteModule(id) {
  const row = state.rows.find((r) => r.id === id);
  const label = row ? row.breadcrumb : `#${id}`;
  if (!confirm(`Excluir "${label}" da documentação?\n\nO menu do sistema não muda; só sai daqui, junto com a descrição e as funções.`)) return;
  try {
    await apiFetch(`${API}/${id}`, { method: 'DELETE' });
    await loadModules();
    await loadList();
  } catch (error) {
    if (row && /dentro dele/.test(error.message)) {
      // Itens de dentro podem estar escondidos (inativos ou fora da busca): oferece mostrar
      if (confirm(`Não foi possível excluir: ${error.message}\n\nMostrar agora o que está dentro de "${row.name}"?`)) {
        await showModuleItems(row);
      }
      return;
    }
    alert(`Não foi possível excluir: ${error.message}`);
  }
}

/** Limpa busca/filtros que escondem itens e mostra o módulo com tudo que está dentro */
async function showModuleItems(row) {
  $('#q').value = '';
  ['#filterType', '#filterSystem', '#filterSoftware', '#filterStatus', '#filterActive'].forEach((sel) => { $(sel).value = ''; });
  $('#filterModule').value = String(row.module_id);
  await loadList();
}

// ─────────────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────────────

function fillForm(r) {
  state.editingId = r.id;
  $('#docModalTitle').textContent = `Editar: ${r.name}`;
  $('#df-breadcrumb').textContent = r.breadcrumb || r.name;
  $('#df-breadcrumb').title = r.breadcrumb || r.name;
  $('#df-name').value = r.name || '';
  $('#df-type').value = r.menu_type || '';
  $('#df-order').value = r.sort_order ?? '';
  $('#df-path').value = r.path && r.path !== '#' ? r.path : '';
  $('#df-active').checked = r.is_active;
  fillParentSelect({ select: $('#df-parent'), type: r.menu_type || '', pathInput: $('#df-path'), preferredId: r.parent_id, excludeId: r.id });
  $('#df-status').value = r.doc_status || 'PENDENTE';
  const systems = r.systems || [];
  document.querySelectorAll('#df-systems input').forEach((input) => { input.checked = systems.includes(input.value); });
  const software = r.software_ids || [];
  document.querySelectorAll('#df-software input').forEach((input) => { input.checked = software.includes(Number(input.value)); });
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
    const [json] = await Promise.all([apiFetch(`${API}/${id}`), loadAllModules()]);
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

/** Nome/tipo/posição do item (só na documentação; o menu do sistema não muda) */
function treeFields(r) {
  const type = $('#df-type').value;
  const name = $('#df-name').value.trim();
  const typedPath = $('#df-path').value.trim();
  const orderText = $('#df-order').value.trim();

  if (!name) throw new Error('Informe o nome.');
  if (type === 'link' && !typedPath) throw new Error('Informe o endereço da tela (ex.: ../pasta/pagina.html).');
  if (orderText !== '' && !Number.isInteger(Number(orderText))) throw new Error('Ordem inválida.');

  return {
    name,
    menu_type: type || null,
    parent_id: $('#df-parent').disabled ? null : (Number($('#df-parent').value) || null),
    // Módulo e submenu não abrem página; "fora do menu" mantém o endereço que tinha
    path: typedPath || (type === '' && r.path ? r.path : '#'),
    sort_order: orderText,
    is_active: $('#df-active').checked,
  };
}

async function saveDoc({ goNext = false } = {}) {
  const current = state.rows.find((x) => x.id === state.editingId) || {};
  let tree;
  try {
    tree = treeFields(current);
  } catch (error) {
    alert(error.message);
    return;
  }

  const description = $('#df-description').value.trim();
  const status = $('#df-status').value;
  const payload = {
    ...tree,
    description,
    functions: $('#df-functions').value,
    notes: $('#df-notes').value,
    // Escreveu a descrição e deixou "Pendente": vira Documentado
    status: status === 'PENDENTE' && description ? 'DOCUMENTADO' : status,
    systems: [...document.querySelectorAll('#df-systems input:checked')].map((input) => input.value),
    software_ids: [...document.querySelectorAll('#df-software input:checked')].map((input) => Number(input.value)),
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
    const moved = ['name', 'menu_type', 'parent_id', 'is_active'].some((k) => (current[k] ?? null) !== (saved[k] ?? null));
    if (moved) await Promise.all([loadModules(), loadAllModules()]);
    await loadList();
    const latest = state.rows.find((x) => x.id === state.editingId);
    if (latest && Modal.isOpen('doc-modal')) fillForm(latest);
  } catch (error) {
    // Mantém o que foi digitado para corrigir e salvar de novo
    alert(`Erro ao salvar: ${error.message}`);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    if (Modal.isOpen('doc-modal')) {
      $('#df-save-next').disabled = $('#df-next').disabled;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Novo item (só na documentação; o menu do sistema não muda)
// ─────────────────────────────────────────────────────────────────────

// Onde cada tipo pode ficar (mesmas regras da Criação de Módulos)
const ALLOWED_PARENTS = Object.freeze({
  dropdown: [],
  submenu: ['dropdown'],
  link: ['', 'dropdown', 'submenu'],
  '': [],
});

let allModules = [];

async function openNew() {
  try {
    await loadAllModules();
  } catch (error) {
    alert(`Erro ao carregar os módulos: ${error.message}`);
    return;
  }

  $('#new-form').reset();
  $('#nf-active').checked = true;
  $('#nf-document').checked = true;

  // Já sugere o pai pelo filtro "Módulo" da tela
  fillNewParent($('#filterModule').value);
  Modal.open('new-modal', { focusSelector: '#nf-name' });
}

/** Árvore completa (ativos e inativos) para escolher o "Dentro de" */
async function loadAllModules() {
  const json = await apiFetch(`${API}?active=`);
  allModules = json.data || [];
}

/** Ids do item e de tudo que está abaixo dele (não podem ser o pai dele) */
function selfAndDescendants(id) {
  const ids = new Set([Number(id)]);
  let grew = true;
  while (grew) {
    grew = false;
    allModules.forEach((m) => {
      if (m.parent_id != null && ids.has(m.parent_id) && !ids.has(m.id)) {
        ids.add(m.id);
        grew = true;
      }
    });
  }
  return ids;
}

/** Monta o "Dentro de" conforme o tipo */
function fillParentSelect({ select, type, pathInput, preferredId = '', excludeId = null }) {
  const allowed = ALLOWED_PARENTS[type] || [];
  const excluded = excludeId != null ? selfAndDescendants(excludeId) : new Set();

  const options = [];
  if (allowed.includes('')) options.push('<option value="">(Topo do menu)</option>');
  allModules
    .filter((m) => allowed.includes(m.menu_type) && !excluded.has(m.id))
    .forEach((m) => {
      options.push(`<option value="${m.id}">${esc(m.breadcrumb)}${m.is_active ? '' : ' (inativo)'}</option>`);
    });

  if (!options.length) options.push('<option value="">(Topo do menu)</option>');
  select.innerHTML = options.join('');
  select.disabled = !allowed.some(Boolean);

  const preferred = String(preferredId ?? '');
  if (preferred && excludeId != null && allowed.some(Boolean) && ![...select.options].some((o) => o.value === preferred)) {
    // Pai atual fora da regra (cadastro antigo): mostra para não mover sem querer
    const current = allModules.find((m) => String(m.id) === preferred);
    if (current) select.insertAdjacentHTML('afterbegin', `<option value="${current.id}">${esc(current.breadcrumb)} (atual)</option>`);
  }
  if (preferred && [...select.options].some((o) => o.value === preferred)) select.value = preferred;

  const opensPage = type === 'link' || type === '';
  pathInput.disabled = !opensPage;
  pathInput.placeholder = opensPage ? '../pasta/pagina.html' : '# (não abre página)';
  if (pathInput.disabled) pathInput.value = '';
}

function fillNewParent(preferredId = '') {
  fillParentSelect({ select: $('#nf-parent'), type: $('#nf-type').value, pathInput: $('#nf-path'), preferredId });
}

async function createModule() {
  const type = $('#nf-type').value;
  const name = $('#nf-name').value.trim();
  let path = $('#nf-path').value.trim();

  if (!name) {
    alert('Informe o nome do módulo.');
    $('#nf-name').focus();
    return;
  }
  if (type === 'link' && !path) {
    alert('Informe o endereço da tela (ex.: ../pasta/pagina.html).');
    $('#nf-path').focus();
    return;
  }
  if (!path) path = '#'; // Módulo e submenu não abrem página

  const payload = {
    name,
    path,
    menu_type: type || null,
    parent_id: $('#nf-parent').disabled ? null : (Number($('#nf-parent').value) || null),
    sort_order: $('#nf-order').value.trim(),
    is_active: $('#nf-active').checked,
  };

  const btn = $('#nf-save');
  btn.disabled = true;
  try {
    const json = await apiFetch(API, { method: 'POST', body: JSON.stringify(payload) });
    const created = json.data;
    Modal.close('new-modal');
    await loadModules();
    await loadList();
    if ($('#nf-document').checked && created?.id) await openEditor(Number(created.id));
  } catch (error) {
    alert(`Erro ao criar: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Traz os módulos do ERP Infinity que ainda não estão aqui e preenche o
 * texto comercial dos itens vazios (status "Revisar"). Nenhum menu muda.
 */
async function importFromMenu() {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Importar do ERP Infinity',
    message: 'A lista passa a ter os módulos do ERP Infinity. Na primeira vez, os itens vazios que vieram do menu do CONSART ERP saem da lista (os que já têm descrição ficam). Os itens sem texto recebem descrição e funções comerciais com status "Revisar". Nenhum menu do sistema muda.',
    okText: 'Importar',
    closeText: 'Cancelar',
  });
  if (ok !== true) return;
  const btn = $('#btnImport');
  btn.disabled = true;
  try {
    const json = await apiFetch(`${API}/import`, { method: 'POST', body: '{}' });
    const { added = 0, removed = 0, filled = 0 } = json.data || {};
    await loadModules();
    await loadList();
    const parts = [];
    if (added) parts.push(`${plural(added, 'item trazido', 'itens trazidos')} do ERP Infinity`);
    if (removed) parts.push(`${plural(removed, 'item vazio do menu CONSART saiu', 'itens vazios do menu CONSART saíram')} da lista`);
    if (filled) parts.push(`${plural(filled, 'item recebeu', 'itens receberam')} o texto comercial (status "Revisar")`);
    await showCenterModal({
      variant: 'success',
      title: 'Importação concluída',
      message: parts.length ? `${parts.join('; ')}.` : 'Nada novo: a lista já está igual ao menu do ERP Infinity.',
    });
  } catch (error) {
    await showCenterModal({ variant: 'error', title: 'Erro ao importar', message: error.message });
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Catálogo comercial (para os vendedores)
// ─────────────────────────────────────────────────────────────────────

/** Mostra/esconde sem depender de CSS para [hidden] */
function show(el, visible) {
  if (!el) return;
  el.hidden = !visible;
  el.style.display = visible ? '' : 'none';
}

function setMode(mode) {
  state.mode = mode === 'catalog' ? 'catalog' : 'table';
  $('#viewMode').value = state.mode;
  document.querySelectorAll('[data-view]').forEach((el) => show(el, el.dataset.view === state.mode));
  return state.mode === 'catalog' ? loadCatalog() : loadList();
}

function catalogParams() {
  const params = new URLSearchParams();
  const q = $('#q').value.trim();
  if (q) params.set('q', q);
  if ($('#filterModule').value) params.set('module', $('#filterModule').value);
  return params;
}

function catalogCard(item) {
  // Submenu entre o módulo e a tela (ex.: "Estoque"), quando houver
  const trail = String(item.breadcrumb || '').split(' › ').slice(1, -1).join(' › ');
  const functions = (item.functions_list || []).map((f) => `✔ ${esc(f)}`).join('\n');
  return `
    <div class="kanban-card">
      <h4 class="kanban-card__title">${esc(item.name)}</h4>
      ${trail ? `<div class="kanban-card__meta">${esc(trail)}</div>` : ''}
      ${item.description ? `<p class="kanban-card__description">${esc(item.description)}</p>` : ''}
      ${functions ? `<div class="kanban-card__description">${functions}</div>` : ''}
    </div>`;
}

async function loadCatalog() {
  try {
    const json = await apiFetch(`${API}/catalog?${catalogParams()}`);
    const groups = json.data || [];
    const total = Number(json.total || 0);
    const review = Number(json.review || 0);

    $('#catalogBody').innerHTML = groups.length
      ? groups.map((g) => `
        <div class="section__header">
          <h3 class="section__title">${esc(g.name)}</h3>
          <span class="summary-pill summary-pill--info">${plural(g.items.length, 'tela', 'telas')}</span>
        </div>
        ${g.description ? `<p class="kanban-card__description">${esc(g.description)}</p>` : ''}
        <div class="c-grid g-4 gap-16">${g.items.map(catalogCard).join('')}</div>`).join('')
      : `<p class="kanban-card__description">${review
        ? `Nenhuma tela no catálogo ainda. ${plural(review, 'item está', 'itens estão')} em "Revisar": revise na Tabela ou use "Aprovar todos a revisar".`
        : 'Nenhuma tela documentada com os filtros atuais.'}</p>`;

    $('#catalogInfo').textContent = `${plural(total, 'tela', 'telas')} no catálogo · ${plural(groups.length, 'módulo', 'módulos')}`;
    $('#catalogReview').textContent = `${review} a revisar`;
    show($('#catalogReview'), review > 0);
    show($('#btnApproveReview'), review > 0);
  } catch (error) {
    console.error('[moduleDocsConsart] catálogo:', error);
    await showCenterModal({ variant: 'error', title: 'Erro', message: `Erro ao carregar o catálogo: ${error.message}` });
  }
}

async function approveReview() {
  const ok = await showCenterModal({
    variant: 'warning',
    title: 'Aprovar textos',
    message: `Marcar como "Documentado" ${$('#catalogReview').textContent.replace(' a revisar', '')} item(ns) em "Revisar"? Eles passam a aparecer no catálogo e no PDF Comercial.`,
    okText: 'Aprovar',
    closeText: 'Cancelar',
  });
  if (ok !== true) return;
  try {
    const json = await apiFetch(`${API}/approve-review`, { method: 'POST', body: '{}' });
    await loadCatalog();
    await showCenterModal({ variant: 'success', title: 'Aprovado', message: `${plural(Number(json.data?.approved || 0), 'item aprovado', 'itens aprovados')}.` });
  } catch (error) {
    await showCenterModal({ variant: 'error', title: 'Erro', message: error.message });
  }
}

async function downloadCatalogPdf() {
  const btn = $('#btnCatalogPdf');
  btn.disabled = true;
  try {
    const token = getAuthToken();
    const response = await fetch(`${API}/catalog/pdf?${catalogParams()}`, {
      headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } : { Accept: 'application/pdf' },
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(json?.error || `HTTP ${response.status}`);
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'Catalogo_Modulos_ERP_Infinity.pdf';
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    console.error('[moduleDocsConsart] pdf comercial:', error);
    await showCenterModal({ variant: 'error', title: 'Erro ao gerar PDF', message: error.message });
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Softwares (Consart Infinity, Logistics, ProdNex...) — cadastro simples
// ─────────────────────────────────────────────────────────────────────

let editingSoftwareId = null;

/** Carrega o cadastro e atualiza filtro, editor e tabela do modal */
async function loadSoftware() {
  try {
    const json = await apiFetch(`${API}/software`);
    state.software = json.data || [];
  } catch (error) {
    console.warn('[moduleDocsConsart] softwares:', error);
    return;
  }

  const filter = $('#filterSoftware');
  const current = filter.value;
  filter.innerHTML = '<option value="">Todos</option>' +
    state.software.map((sw) => `<option value="${sw.id}">${esc(sw.name)}</option>`).join('') +
    '<option value="NONE">Sem software</option>';
  filter.value = [...filter.options].some((o) => o.value === current) ? current : '';

  // Editor: mantém o que já estava marcado
  const checked = new Set([...document.querySelectorAll('#df-software input:checked')].map((i) => Number(i.value)));
  $('#df-software').innerHTML = state.software.length
    ? state.software.map((sw) => `
        <label class="doc-check" title="${esc(sw.description)}">
          <input type="checkbox" value="${sw.id}" ${checked.has(sw.id) ? 'checked' : ''} />
          <span>${esc(sw.name)}${sw.description ? ` <small>· ${esc(sw.description.replace(/^voltado para\s*/i, ''))}</small>` : ''}</span>
        </label>`).join('')
    : '<span class="doc-hint">Nenhum software cadastrado. Use o botão Softwares.</span>';

  $('#swBody').innerHTML = state.software.map((sw) => `
    <tr data-id="${sw.id}">
      <td class="docs-col-left"><strong>${esc(sw.name)}</strong></td>
      <td class="docs-col-left">${esc(sw.description) || '—'}</td>
      <td>${sw.modules_count || '—'}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'sw-edit', 'data-id': sw.id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'sw-delete', 'data-id': sw.id } },
      ])}</td>
    </tr>`).join('') || '<tr><td colspan="4">Nenhum software cadastrado.</td></tr>';
}

function resetSoftwareForm() {
  editingSoftwareId = null;
  $('#software-form').reset();
  $('#sw-save').textContent = 'Adicionar';
  $('#sw-clear').hidden = true;
}

async function openSoftware() {
  resetSoftwareForm();
  await loadSoftware();
  Modal.open('software-modal', { focusSelector: '#sw-name' });
}

async function saveSoftware() {
  const name = $('#sw-name').value.trim();
  if (!name) {
    alert('Informe o nome do software.');
    $('#sw-name').focus();
    return;
  }
  const payload = {
    name,
    description: $('#sw-description').value.trim(),
    sort_order: $('#sw-order').value.trim(),
  };
  const btn = $('#sw-save');
  btn.disabled = true;
  try {
    const url = editingSoftwareId ? `${API}/software/${editingSoftwareId}` : `${API}/software`;
    await apiFetch(url, { method: editingSoftwareId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    resetSoftwareForm();
    await loadSoftware();
    renderList(currentSummary());
  } catch (error) {
    alert(`Erro ao salvar o software: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function onSoftwareClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const sw = state.software.find((x) => x.id === Number(button.dataset.id));
  if (!sw) return;

  if (button.dataset.act === 'sw-edit') {
    editingSoftwareId = sw.id;
    $('#sw-name').value = sw.name;
    $('#sw-description').value = sw.description || '';
    $('#sw-order').value = sw.sort_order ?? '';
    $('#sw-save').textContent = 'Salvar';
    $('#sw-clear').hidden = false;
    $('#sw-name').focus();
    return;
  }

  const used = sw.modules_count ? `\n\nEle está marcado em ${plural(sw.modules_count, 'módulo', 'módulos')}; a marcação sai junto.` : '';
  if (!confirm(`Excluir o software "${sw.name}"?${used}`)) return;
  try {
    await apiFetch(`${API}/software/${sw.id}`, { method: 'DELETE' });
    if (editingSoftwareId === sw.id) resetSoftwareForm();
    if ($('#filterSoftware').value === String(sw.id)) $('#filterSoftware').value = '';
    await loadSoftware();
    await loadList();
  } catch (error) {
    alert(`Não foi possível excluir: ${error.message}`);
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
  $('#btnSearch').addEventListener('click', () => (state.mode === 'catalog' ? loadCatalog() : loadList()));
  $('#viewMode').addEventListener('change', () => setMode($('#viewMode').value));
  $('#btnCatalogPdf').addEventListener('click', downloadCatalogPdf);
  $('#btnApproveReview').addEventListener('click', approveReview);
  $('#btnReload').addEventListener('click', async () => {
    // Volta para a ordem do menu
    state.sort = '';
    sorter?.reset();
    await loadModules();
    if (state.mode === 'catalog') await loadCatalog();
    else await loadList();
  });
  $('#btnPdf').addEventListener('click', openPdf);
  $('#btnSoftware').addEventListener('click', openSoftware);
  $('#btnImport').addEventListener('click', importFromMenu);
  $('#software-form').addEventListener('submit', (e) => { e.preventDefault(); saveSoftware(); });
  $('#sw-clear').addEventListener('click', () => resetSoftwareForm());
  $('#swBody').addEventListener('click', onSoftwareClick);
  $('#btnNew').addEventListener('click', openNew);
  $('#nf-type').addEventListener('change', () => fillNewParent($('#nf-parent').value));
  $('#df-type').addEventListener('change', () => {
    fillParentSelect({
      select: $('#df-parent'),
      type: $('#df-type').value,
      pathInput: $('#df-path'),
      preferredId: $('#df-parent').value,
      excludeId: state.editingId,
    });
  });
  $('#nf-save').addEventListener('click', createModule);
  $('#new-form').addEventListener('submit', (e) => { e.preventDefault(); createModule(); });
  $('#btnBack').addEventListener('click', () => history.back());
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') state.mode === 'catalog' ? loadCatalog() : loadList();
  });
  $('#filterModule').addEventListener('change', () => (state.mode === 'catalog' ? loadCatalog() : loadList()));
  ['#filterType', '#filterSystem', '#filterSoftware', '#filterStatus', '#filterActive']
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
// Softwares antes da lista: as etiquetas usam os nomes do cadastro.
// ?view=catalog abre direto no Catálogo comercial (link para os vendedores)
const startMode = new URLSearchParams(location.search).get('view') === 'catalog' ? 'catalog' : 'table';
loadSoftware().then(() => setMode(startMode));
