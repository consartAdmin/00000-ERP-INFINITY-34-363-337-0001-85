// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ locations.js — Localizações (endereçamento do estoque) | CONSART ERP      ║
// ║ Path: backend/public/locations/locations.js                               ║
// ║ API base: /api/locations (locals/corridors/shelves/bins/positions)        ║
// ║ - Carrega os 5 níveis de uma vez e navega em colunas (sem recarregar).    ║
// ║ - ＋ na coluna cria dentro do item selecionado na coluna anterior.        ║
// ║ - Editar / inativar / excluir por linha; modal único (modal.js).          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const API_BASE = '/api/locations';

/* -------------------------------------------------------------------------- */
/* 1. Níveis                                                                   */
/* -------------------------------------------------------------------------- */

const LEVELS = [
  { key: 'locals', title: 'Locais', one: 'Local', novo: 'Novo', icon: '🏢', parentKey: null, placeholder: 'Ex.: GALPÃO, LOJA' },
  { key: 'corridors', title: 'Corredores', one: 'Corredor', novo: 'Novo', icon: '🚪', parentKey: 'local_id', placeholder: 'Ex.: A, CORREDOR 1' },
  { key: 'shelves', title: 'Prateleiras', one: 'Prateleira', novo: 'Nova', icon: '🗄️', parentKey: 'corridor_id', placeholder: 'Ex.: 01, PRAT-01' },
  { key: 'bins', title: 'Bandejas', one: 'Bandeja', novo: 'Nova', icon: '📥', parentKey: 'shelf_id', placeholder: 'Ex.: 1, BIN-02' },
  { key: 'positions', title: 'Posições', one: 'Posição', novo: 'Nova', icon: '📌', parentKey: 'bin_id', placeholder: 'Ex.: P01' },
];

const state = {
  rows: { locals: [], corridors: [], shelves: [], bins: [], positions: [] },
  selected: [null, null, null, null, null], // id selecionado por nível
  filters: ['', '', '', '', ''],
  showInactive: false,
  modal: null, // { mode: 'new'|'edit', level, parentId, id }
};

/* -------------------------------------------------------------------------- */
/* 2. Helpers                                                                  */
/* -------------------------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    const detail = data?.detail ? ` — ${data.detail}` : '';
    throw new Error(`${msg}${detail}`);
  }
  return data;
}

function alertError(title, err) {
  return showCenterModal({ variant: 'error', title, message: esc(err?.message || err) });
}

function confirmDanger(title, message, label) {
  return showCenterModal({
    variant: 'warning',
    title,
    message,
    buttons: [
      { label: 'Cancelar', variant: 'cancel', action: () => false },
      { label, variant: 'danger', action: () => true },
    ],
  }).then((r) => r === true);
}

function findRow(levelIdx, id) {
  if (id == null) return null;
  return state.rows[LEVELS[levelIdx].key].find((r) => Number(r.id) === Number(id)) || null;
}

/** filhos de um item (nível levelIdx+1 cujo parentKey = id) */
function childrenOf(levelIdx, id) {
  const next = LEVELS[levelIdx + 1];
  if (!next) return [];
  return state.rows[next.key].filter((r) => Number(r[next.parentKey]) === Number(id));
}

/** linhas visíveis da coluna levelIdx (respeita pai selecionado + inativos) */
function rowsForColumn(levelIdx) {
  const lvl = LEVELS[levelIdx];
  let rows = state.rows[lvl.key];
  if (levelIdx > 0) {
    const parentId = state.selected[levelIdx - 1];
    if (parentId == null) return null; // coluna bloqueada
    rows = rows.filter((r) => Number(r[lvl.parentKey]) === Number(parentId));
  }
  if (!state.showInactive) rows = rows.filter((r) => r.active !== false);
  const f = norm(state.filters[levelIdx]);
  if (f) rows = rows.filter((r) => norm(r.name).includes(f) || norm(r.description).includes(f));
  return [...rows].sort((a, b) => collator.compare(a.name ?? '', b.name ?? ''));
}

/** caminho (nomes) até o item: [{levelIdx,id,name}] */
function pathTo(levelIdx, id) {
  const out = [];
  let li = levelIdx;
  let row = findRow(li, id);
  while (row && li >= 0) {
    out.unshift({ levelIdx: li, id: row.id, name: row.name });
    const pk = LEVELS[li].parentKey;
    li -= 1;
    row = pk ? findRow(li, row[pk]) : null;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 3. Carga                                                                    */
/* -------------------------------------------------------------------------- */

async function loadAll() {
  // sempre traz ativos e inativos; o filtro "Mostrar inativos" é na tela
  const results = await Promise.all(
    LEVELS.map((l) => apiFetch(`/${l.key}?activeOnly=false`).then((r) => (Array.isArray(r) ? r : [])))
  );
  LEVELS.forEach((l, i) => { state.rows[l.key] = results[i]; });

  // descarta seleção que não existe mais
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (state.selected[i] != null && !findRow(i, state.selected[i])) {
      for (let j = i; j < LEVELS.length; j += 1) state.selected[j] = null;
      break;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Render                                                                   */
/* -------------------------------------------------------------------------- */

const columnsEl = $('#locColumns');

function buildColumns() {
  columnsEl.innerHTML = LEVELS.map((lvl, i) => `
    <div class="loc-col" data-level="${i}">
      <div class="loc-col__head">
        <span class="loc-col__title">${lvl.icon} ${lvl.title} <span class="loc-col__count" data-count></span></span>
        <button type="button" class="loc-col__add" data-add="${i}" title="${lvl.novo} ${lvl.one.toLowerCase()}">＋</button>
      </div>
      <div class="loc-col__filter">
        <input type="search" data-filter="${i}" placeholder="Filtrar ${lvl.title.toLowerCase()}..." autocomplete="off" />
      </div>
      <ul class="loc-col__list" data-list role="listbox" aria-label="${lvl.title}"></ul>
    </div>
  `).join('');
}

function renderColumn(i) {
  const lvl = LEVELS[i];
  const col = columnsEl.querySelector(`.loc-col[data-level="${i}"]`);
  const list = col.querySelector('[data-list]');
  const countEl = col.querySelector('[data-count]');
  const addBtn = col.querySelector('[data-add]');
  const filterEl = col.querySelector('[data-filter]');
  const rows = rowsForColumn(i);

  const locked = rows === null;
  col.classList.toggle('is-locked', locked);
  addBtn.disabled = locked;
  filterEl.disabled = locked;

  if (locked) {
    countEl.textContent = '';
    list.innerHTML = `<li class="loc-col__empty"><span>← Selecione um item em <b>${LEVELS[i - 1].title}</b></span></li>`;
    return;
  }

  countEl.textContent = `(${rows.length})`;

  if (!rows.length) {
    const parent = i > 0 ? findRow(i - 1, state.selected[i - 1]) : null;
    list.innerHTML = `<li class="loc-col__empty"><span>${state.filters[i] ? 'Nada encontrado no filtro.' : `Nenhum item${parent ? ` em <b>${esc(parent.name)}</b>` : ''}.`}</span>
      ${state.filters[i] ? '' : `<button type="button" class="btn btn-toolbar btn-sm" data-add="${i}">＋ ${lvl.novo} ${lvl.one.toLowerCase()}</button>`}</li>`;
    return;
  }

  const isLast = i === LEVELS.length - 1;
  list.innerHTML = rows.map((r) => {
    const kids = isLast ? [] : childrenOf(i, r.id).filter((k) => state.showInactive || k.active !== false);
    const sel = Number(state.selected[i]) === Number(r.id);
    const off = r.active === false;
    return `
      <li class="loc-item${sel ? ' is-selected' : ''}${off ? ' is-inactive' : ''}" data-id="${r.id}" role="option" aria-selected="${sel}" tabindex="0">
        <div class="loc-item__main">
          <span class="loc-item__name">${esc(r.name)}</span>
          ${off ? '<span class="loc-badge loc-badge--off">inativo</span>' : ''}
          ${r.description ? `<span class="loc-item__desc" title="${esc(r.description)}">${esc(r.description)}</span>` : ''}
        </div>
        <div class="loc-item__side">
          <span class="loc-item__actions">
            <button type="button" data-act="edit" title="Editar">✏️</button>
            <button type="button" data-act="toggle" title="${off ? 'Ativar' : 'Inativar'}">${off ? '✅' : '⛔'}</button>
            <button type="button" data-act="del" title="Excluir">🗑️</button>
          </span>
          ${isLast ? '' : `<span class="loc-item__kids" title="Itens dentro">${kids.length}</span><span class="loc-item__chev" aria-hidden="true">›</span>`}
        </div>
      </li>`;
  }).join('');
}

function renderBreadcrumb() {
  const el = $('#locBreadcrumb');
  let last = -1;
  for (let i = 0; i < LEVELS.length; i += 1) if (state.selected[i] != null) last = i;

  const parts = [`<button type="button" class="loc-crumb" data-crumb="-1">🏠 Todos os locais</button>`];
  if (last >= 0) {
    pathTo(last, state.selected[last]).forEach((p) => {
      parts.push(`<span class="loc-crumb__sep">›</span><button type="button" class="loc-crumb${p.levelIdx === last ? ' is-current' : ''}" data-crumb="${p.levelIdx}"><small>${LEVELS[p.levelIdx].one}</small> ${esc(p.name)}</button>`);
    });
  }
  el.innerHTML = parts.join('');
}

function renderTotals() {
  const count = (k) => state.rows[k].filter((r) => state.showInactive || r.active !== false).length;
  $('#locTotals').textContent = LEVELS.map((l) => `${count(l.key)} ${l.title.toLowerCase()}`).join(' · ');
}

function renderAll() {
  LEVELS.forEach((_, i) => renderColumn(i));
  renderBreadcrumb();
  renderTotals();
}

/* -------------------------------------------------------------------------- */
/* 5. Seleção / navegação                                                      */
/* -------------------------------------------------------------------------- */

function selectItem(levelIdx, id) {
  state.selected[levelIdx] = id;
  for (let j = levelIdx + 1; j < LEVELS.length; j += 1) {
    state.selected[j] = null;
    state.filters[j] = '';
    const f = columnsEl.querySelector(`[data-filter="${j}"]`);
    if (f) f.value = '';
  }
  renderAll();
  // em telas estreitas leva a próxima coluna para a vista
  const next = columnsEl.querySelector(`.loc-col[data-level="${Math.min(levelIdx + 1, LEVELS.length - 1)}"]`);
  next?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function goToPath(levelIdx, id) {
  const path = pathTo(levelIdx, id);
  state.selected = [null, null, null, null, null];
  state.filters = ['', '', '', '', ''];
  columnsEl.querySelectorAll('[data-filter]').forEach((f) => { f.value = ''; });
  path.forEach((p) => { state.selected[p.levelIdx] = p.id; });
  const target = findRow(levelIdx, id);
  if (target?.active === false) {
    state.showInactive = true;
    $('#locShowInactive').checked = true;
  }
  renderAll();
  columnsEl.querySelector(`.loc-col[data-level="${levelIdx}"] .loc-item[data-id="${id}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* -------------------------------------------------------------------------- */
/* 6. Busca global                                                             */
/* -------------------------------------------------------------------------- */

function renderSearch() {
  const box = $('#locSearchResults');
  const q = norm($('#locSearch').value);
  if (q.length < 1) { box.hidden = true; box.innerHTML = ''; return; }

  const hits = [];
  LEVELS.forEach((lvl, i) => {
    state.rows[lvl.key].forEach((r) => {
      if (!state.showInactive && r.active === false) return;
      if (norm(r.name).includes(q) || norm(r.description).includes(q)) hits.push({ i, r });
    });
  });

  if (!hits.length) {
    box.innerHTML = '<div class="loc-search-results__empty">Nenhum endereço encontrado.</div>';
  } else {
    box.innerHTML = hits.slice(0, 40).map(({ i, r }) => {
      const path = pathTo(i, r.id).map((p) => esc(p.name)).join(' › ');
      return `<button type="button" class="loc-search-hit" data-level="${i}" data-id="${r.id}">
        <span class="loc-search-hit__lvl">${LEVELS[i].icon} ${LEVELS[i].one}</span>
        <span class="loc-search-hit__path">${path}</span>
      </button>`;
    }).join('') + (hits.length > 40 ? `<div class="loc-search-results__empty">+${hits.length - 40} resultado(s). Refine a busca.</div>` : '');
  }
  box.hidden = false;
}

/* -------------------------------------------------------------------------- */
/* 7. Modal Novo / Editar                                                      */
/* -------------------------------------------------------------------------- */

const els = {
  title: $('#locModalTitle'),
  path: $('#locModalPath'),
  name: $('#locName'),
  desc: $('#locDesc'),
  active: $('#locActive'),
  bulkBox: $('#locBulkBox'),
  bulk: $('#locBulk'),
  bulkFields: $('#locBulkFields'),
  bulkFrom: $('#locBulkFrom'),
  bulkTo: $('#locBulkTo'),
  bulkPad: $('#locBulkPad'),
  bulkPreview: $('#locBulkPreview'),
  btnDelete: $('#locBtnDelete'),
  btnSave: $('#locBtnSave'),
  btnSaveNew: $('#locBtnSaveNew'),
};

function pathHtml(levelIdx, parentId) {
  if (levelIdx === 0 || parentId == null) return '<span class="loc-modal-path__root">Nível mais alto (sem pai)</span>';
  return `<span class="loc-modal-path__label">Dentro de</span> ${pathTo(levelIdx - 1, parentId)
    .map((p) => `<span class="loc-modal-path__chip"><small>${LEVELS[p.levelIdx].one}</small> ${esc(p.name)}</span>`)
    .join('<span class="loc-crumb__sep">›</span>')}`;
}

function bulkNames() {
  const from = Math.trunc(Number(els.bulkFrom.value));
  const to = Math.trunc(Number(els.bulkTo.value));
  const pad = Number(els.bulkPad.value) || 1;
  const prefix = String(els.name.value || '').trim();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const out = [];
  for (let n = from; n <= to && out.length <= 200; n += 1) out.push(`${prefix}${String(n).padStart(pad, '0')}`);
  return out;
}

function updateBulkPreview() {
  const on = els.bulk.checked;
  els.bulkFields.hidden = !on;
  $('label[for="locName"]').textContent = on ? 'Prefixo (opcional)' : 'Nome *';
  if (!on) return;
  const names = bulkNames();
  if (!names.length) { els.bulkPreview.textContent = 'Informe De ≤ Até.'; return; }
  if (names.length > 200) { els.bulkPreview.textContent = 'Máximo de 200 por vez.'; return; }
  const sample = names.length > 4 ? `${names.slice(0, 3).join(', ')} … ${names[names.length - 1]}` : names.join(', ');
  els.bulkPreview.textContent = `Vai criar ${names.length}: ${sample}`;
}

function openModal({ mode, level, parentId = null, id = null }) {
  const lvl = LEVELS[level];
  state.modal = { mode, level, parentId, id };

  if (mode === 'edit') {
    const row = findRow(level, id);
    if (!row) return;
    els.title.textContent = `✏️ Editar ${lvl.one.toLowerCase()}`;
    els.path.innerHTML = pathHtml(level, lvl.parentKey ? row[lvl.parentKey] : null);
    els.name.value = row.name ?? '';
    els.desc.value = row.description ?? '';
    els.active.checked = row.active !== false;
    els.bulkBox.hidden = true;
    els.bulk.checked = false;
    els.btnDelete.hidden = false;
    els.btnSaveNew.hidden = true;
  } else {
    els.title.textContent = `${lvl.icon} ${lvl.novo} ${lvl.one.toLowerCase()}`;
    els.path.innerHTML = pathHtml(level, parentId);
    els.name.value = '';
    els.desc.value = '';
    els.active.checked = true;
    els.bulkBox.hidden = false;
    els.bulk.checked = false;
    els.btnDelete.hidden = true;
    els.btnSaveNew.hidden = false;
  }
  els.name.placeholder = lvl.placeholder;
  updateBulkPreview();
  Modal.open('locModal', { focusSelector: '#locName' });
}

async function saveModal({ keepOpen = false } = {}) {
  const m = state.modal;
  if (!m) return;
  const lvl = LEVELS[m.level];
  const name = String(els.name.value || '').trim();
  const description = String(els.desc.value || '').trim() || null;
  const active = !!els.active.checked;

  try {
    if (m.mode === 'edit') {
      if (!name) { els.name.focus(); return showCenterModal({ variant: 'warning', title: 'Atenção', message: 'Informe o nome.' }); }
      await apiFetch(`/${lvl.key}/${m.id}`, { method: 'PUT', body: JSON.stringify({ name, description, active }) });
    } else {
      const names = els.bulk.checked ? bulkNames() : [name];
      if (!names.length || !names[0]) { els.name.focus(); return showCenterModal({ variant: 'warning', title: 'Atenção', message: els.bulk.checked ? 'Confira De / Até.' : 'Informe o nome.' }); }
      if (names.length > 200) return showCenterModal({ variant: 'warning', title: 'Atenção', message: 'Máximo de 200 por vez.' });

      const created = [];
      for (const n of names) {
        const payload = { name: n, description, active };
        if (lvl.parentKey) payload[lvl.parentKey] = m.parentId;
        created.push(await apiFetch(`/${lvl.key}`, { method: 'POST', body: JSON.stringify(payload) }));
      }
      if (created.length > 1) {
        showCenterModal({ variant: 'success', title: 'Criados', message: `${created.length} ${lvl.title.toLowerCase()} criados.` });
      }
    }

    await loadAll();
    renderAll();

    if (keepOpen && m.mode === 'new') {
      els.name.value = '';
      els.desc.value = '';
      els.bulk.checked = false;
      updateBulkPreview();
      els.name.focus();
    } else {
      Modal.close('locModal');
    }
  } catch (err) {
    alertError('Erro ao salvar', err);
  }
}

/* -------------------------------------------------------------------------- */
/* 8. Ações por item                                                           */
/* -------------------------------------------------------------------------- */

async function toggleItem(level, id) {
  const lvl = LEVELS[level];
  const row = findRow(level, id);
  if (!row) return;
  const next = row.active === false;
  if (!next) {
    const kids = childrenOf(level, id).filter((k) => k.active !== false).length;
    const ok = await confirmDanger(
      `Inativar ${lvl.one.toLowerCase()}`,
      `Inativar <b>${esc(row.name)}</b>?${kids ? `<br><small>Os ${kids} item(ns) dentro dele continuam como estão.</small>` : ''}`,
      'Inativar'
    );
    if (!ok) return;
  }
  try {
    await apiFetch(`/${lvl.key}/${id}`, { method: 'PUT', body: JSON.stringify({ active: next }) });
    await loadAll();
    renderAll();
  } catch (err) {
    alertError('Erro', err);
  }
}

async function deleteItem(level, id) {
  const lvl = LEVELS[level];
  const row = findRow(level, id);
  if (!row) return false;
  const kids = childrenOf(level, id).length;
  if (kids) {
    await showCenterModal({
      variant: 'warning',
      title: 'Não é possível excluir',
      message: `<b>${esc(row.name)}</b> tem ${kids} ${LEVELS[level + 1].title.toLowerCase()} dentro.<br>Exclua-os antes, ou apenas inative.`,
    });
    return false;
  }
  const ok = await confirmDanger(`Excluir ${lvl.one.toLowerCase()}`, `Excluir <b>${esc(row.name)}</b> definitivamente?`, 'Excluir');
  if (!ok) return false;
  try {
    await apiFetch(`/${lvl.key}/${id}`, { method: 'DELETE' });
    if (Number(state.selected[level]) === Number(id)) selectItem(level, null);
    await loadAll();
    renderAll();
    return true;
  } catch (err) {
    alertError('Erro ao excluir', err);
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* 9. Eventos                                                                  */
/* -------------------------------------------------------------------------- */

const lastClick = { level: -1, id: -1, at: 0 };

function wireEvents() {
  columnsEl.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const level = Number(add.dataset.add);
      openModal({ mode: 'new', level, parentId: level > 0 ? state.selected[level - 1] : null });
      return;
    }
    const item = e.target.closest('.loc-item');
    if (!item) return;
    const level = Number(item.closest('.loc-col').dataset.level);
    const id = Number(item.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') return openModal({ mode: 'edit', level, id });
    if (act === 'toggle') return toggleItem(level, id);
    if (act === 'del') return deleteItem(level, id);

    // duplo clique "manual": o 1º clique re-renderiza a coluna (troca o nó),
    // então o evento dblclick nativo nem sempre chega
    const now = Date.now();
    if (lastClick.level === level && lastClick.id === id && now - lastClick.at < 450) {
      lastClick.at = 0;
      return openModal({ mode: 'edit', level, id });
    }
    lastClick.level = level; lastClick.id = id; lastClick.at = now;
    if (Number(state.selected[level]) !== id) selectItem(level, id);
  });

  columnsEl.addEventListener('keydown', (e) => {
    const item = e.target.closest('.loc-item');
    if (!item) return;
    const level = Number(item.closest('.loc-col').dataset.level);
    if (e.key === 'Enter') { e.preventDefault(); selectItem(level, Number(item.dataset.id)); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const sib = e.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling;
      sib?.focus();
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      selectItem(level, Number(item.dataset.id));
      columnsEl.querySelector(`.loc-col[data-level="${level + 1}"] .loc-item`)?.focus();
    }
    if (e.key === 'ArrowLeft' && level > 0) {
      e.preventDefault();
      columnsEl.querySelector(`.loc-col[data-level="${level - 1}"] .loc-item.is-selected`)?.focus();
    }
  });

  columnsEl.addEventListener('input', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f) return;
    const i = Number(f.dataset.filter);
    state.filters[i] = f.value;
    renderColumn(i);
  });

  $('#locBreadcrumb').addEventListener('click', (e) => {
    const c = e.target.closest('[data-crumb]');
    if (!c) return;
    const level = Number(c.dataset.crumb);
    if (level < 0) {
      state.selected = [null, null, null, null, null];
      renderAll();
    } else {
      selectItem(level, state.selected[level]);
    }
  });

  $('#locShowInactive').addEventListener('change', (e) => {
    state.showInactive = e.target.checked;
    renderAll();
    renderSearch();
  });

  $('#locBtnReload').addEventListener('click', async () => {
    try { await loadAll(); renderAll(); } catch (err) { alertError('Erro ao carregar', err); }
  });

  const search = $('#locSearch');
  search.addEventListener('input', renderSearch);
  search.addEventListener('focus', renderSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; renderSearch(); }
    if (e.key === 'Enter') { e.preventDefault(); $('#locSearchResults .loc-search-hit')?.click(); }
  });
  $('#locSearchResults').addEventListener('click', (e) => {
    const hit = e.target.closest('.loc-search-hit');
    if (!hit) return;
    goToPath(Number(hit.dataset.level), Number(hit.dataset.id));
    $('#locSearchResults').hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.loc-toolbar__search')) $('#locSearchResults').hidden = true;
  });

  // modal
  els.bulk.addEventListener('change', updateBulkPreview);
  [els.bulkFrom, els.bulkTo, els.bulkPad, els.name].forEach((el) => el.addEventListener('input', updateBulkPreview));
  els.btnSave.addEventListener('click', () => saveModal());
  els.btnSaveNew.addEventListener('click', () => saveModal({ keepOpen: true }));
  $('#locForm').addEventListener('submit', (e) => { e.preventDefault(); saveModal(); });
  els.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveModal(); } });
  els.btnDelete.addEventListener('click', async () => {
    const m = state.modal;
    if (m?.mode !== 'edit') return;
    if (await deleteItem(m.level, m.id)) Modal.close('locModal');
  });
}

/* -------------------------------------------------------------------------- */
/* 10. Init                                                                    */
/* -------------------------------------------------------------------------- */

async function init() {
  Modal.setup();
  buildColumns();
  wireEvents();
  try {
    await loadAll();
  } catch (err) {
    alertError('Erro ao carregar localizações', err);
  }
  renderAll();
}

init();
