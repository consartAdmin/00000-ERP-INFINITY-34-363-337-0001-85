// ╔══════════════════════════════════════════════════════════════════════╗
// ║ groupsAndSubgroups.js — Grupos, Subgrupos e Famílias (Frontend)     ║
// ║ CONSART ERP | ESM                                                   ║
// ║ - Consome /api/products-groups, /api/products-subgroups e           ║
// ║   /api/products-families (3º nível, filha do subgrupo)              ║
// ║ - 3 listas no padrão table-layout-integrated (só style.css)         ║
// ║ - Clicar num grupo filtra subgrupos e famílias; num subgrupo,       ║
// ║   filtra as famílias (clicar de novo desfaz)                        ║
// ║ - Cadastro/edição em modal (modal.js), ações com actionIcons.js,    ║
// ║   avisos/confirmações no centerAlertModal.js                        ║
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
    console.error('[groupsAndSubgroups] Erro ao obter API base:', err);
  }
  return window.location.origin;
}

const API_BASE = getApiBase();
const GROUPS_URL = `${API_BASE}/api/products-groups`;
const SUBGROUPS_URL = `${API_BASE}/api/products-subgroups`;
const FAMILIES_URL = `${API_BASE}/api/products-families`;

// ======================================================================
// HELPERS
// ======================================================================

const $ = (selector) => document.querySelector(selector);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data = null;
  const text = await res.text().catch(() => '');
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

  if (!res.ok) {
    const msg = data?.error || data?.message || `Falha na requisição (${res.status}).`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Aceita { data: { rows } }, { rows }, { data: [] } ou array direto */
function normalizeRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

function notify(message, variant = 'success') {
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Grupos & Subgrupos'),
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

function statusPill(isActive) {
  return isActive
    ? '<span class="summary-pill summary-pill--success">Ativo</span>'
    : '<span class="summary-pill summary-pill--danger">Inativo</span>';
}

function messageRow(colspan, text) {
  return `<tr><td colspan="${colspan}" class="table-empty-state">${escapeHtml(text)}</td></tr>`;
}

function rowActions(kind, row, idField) {
  const id = row[idField];
  return actionIconsHtml([
    { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': id } },
    row.is_active
      ? { action: 'pause', title: 'Inativar', attrs: { 'data-act': 'toggle', 'data-id': id } }
      : { action: 'play', title: 'Reativar', attrs: { 'data-act': 'toggle', 'data-id': id } },
    { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': id } },
  ]);
}

/** Ordena uma cópia da lista pela coluna escolhida no cabeçalho */
function sortRows(rows, { column, direction }, valueOf = (r, c) => r[c]) {
  const dir = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, column);
    const vb = valueOf(b, column);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    if (typeof va === 'boolean' || typeof vb === 'boolean') return (Number(!!va) - Number(!!vb)) * dir;
    return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' }) * dir;
  });
}

function statusParam(selectEl) {
  const v = selectEl?.value || 'true';
  return v === 'all' ? null : v;
}

// ======================================================================
// ESTADO
// ======================================================================

const state = {
  allGroups: [],       // todos (para nomes e selects)
  allSubgroups: [],    // todos (para nomes, contagem e selects)
  groups: [],
  subgroups: [],
  families: [],
  selectedGroupId: null,
  selectedSubgroupId: null,
  searchGroupIds: null, // grupos achados pela busca de grupos (null = sem busca)
  sort: {
    groups: { column: 'name', direction: 'asc' },
    subgroups: { column: 'name', direction: 'asc' },
    families: { column: 'name', direction: 'asc' },
  },
};

const groupName = (id) => state.allGroups.find((g) => sameId(g.product_group_id, id))?.name || '';
const subgroupName = (id) => state.allSubgroups.find((s) => sameId(s.product_subgroup_id, id))?.name || '';
const subgroupsCount = (groupId) => state.allSubgroups.filter((s) => sameId(s.group_id, groupId)).length;

// ======================================================================
// API
// ======================================================================

async function apiList(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && String(v).trim() !== '') url.searchParams.set(k, String(v).trim());
  });
  return normalizeRows(await fetchJson(url.toString(), { method: 'GET' }));
}

const apiSave = (baseUrl, id, body) => fetchJson(id ? `${baseUrl}/${encodeURIComponent(id)}` : baseUrl, {
  method: id ? 'PUT' : 'POST',
  body: JSON.stringify(body),
});

const apiDelete = (baseUrl, id) => fetchJson(`${baseUrl}/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ======================================================================
// CARREGAMENTO
// ======================================================================

async function loadLookups() {
  const [groups, subgroups] = await Promise.all([
    apiList(GROUPS_URL, { limit: 2000, offset: 0 }),
    apiList(SUBGROUPS_URL, { limit: 5000, offset: 0 }),
  ]);
  state.allGroups = groups;
  state.allSubgroups = subgroups;
}

async function loadGroups() {
  setInfo('groups', 'Carregando...');
  const term = $('#groupsSearch').value.trim();
  state.groups = await apiList(GROUPS_URL, {
    q: term, is_active: statusParam($('#groupsStatus')), limit: 2000, offset: 0,
  });

  // Busca de grupos ativa: subgrupos acompanham os grupos achados; um só resultado vira o selecionado
  const foundIds = state.groups.map((g) => g.product_group_id);
  state.searchGroupIds = term ? foundIds : null;
  if (term && foundIds.length === 1) {
    if (!sameId(state.selectedGroupId, foundIds[0])) state.selectedSubgroupId = null;
    state.selectedGroupId = foundIds[0];
  } else if (term && state.selectedGroupId && !foundIds.some((id) => sameId(id, state.selectedGroupId))) {
    state.selectedGroupId = null;
    state.selectedSubgroupId = null;
  }
  renderGroups();
}

async function loadSubgroups() {
  setInfo('subgroups', 'Carregando...');
  let rows = await apiList(SUBGROUPS_URL, {
    q: $('#subgroupsSearch').value,
    group_id: state.selectedGroupId,
    is_active: statusParam($('#subgroupsStatus')),
    limit: 5000,
    offset: 0,
  });
  if (!state.selectedGroupId && state.searchGroupIds) {
    const ids = new Set(state.searchGroupIds.map(String));
    rows = rows.filter((sg) => ids.has(String(sg.group_id)));
  }
  state.subgroups = rows;
  renderSubgroups();
}

async function loadFamilies() {
  setInfo('families', 'Carregando...');
  state.families = await apiList(FAMILIES_URL, {
    q: $('#familiesSearch').value,
    subgroup_id: state.selectedSubgroupId,
    group_id: state.selectedSubgroupId ? null : state.selectedGroupId,
    is_active: statusParam($('#familiesStatus')),
    limit: 5000,
    offset: 0,
  });
  renderFamilies();
}

async function run(task, errorText) {
  try {
    await task();
  } catch (err) {
    console.error('[groupsAndSubgroups]', errorText, err);
    notify(`${errorText} ${err?.message || ''}`.trim(), 'error');
  }
}

const reloadAll = () => run(async () => {
  await loadLookups();
  await loadGroups();
  await loadSubgroups();
  await loadFamilies();
}, 'Erro ao carregar grupos, subgrupos e famílias.');

const reloadFromSubgroups = () => run(async () => {
  await loadSubgroups();
  await loadFamilies();
}, 'Erro ao carregar subgrupos.');

const reloadFamilies = () => run(loadFamilies, 'Erro ao carregar famílias.');

// ======================================================================
// RENDER
// ======================================================================

function setInfo(key, text) {
  const el = $(`#${key}Info`);
  if (el) el.textContent = text;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function renderGroups() {
  const tbody = $('#groupsTableBody');
  const rows = sortRows(state.groups, state.sort.groups, (r, c) => (
    c === 'subgroups_count' ? subgroupsCount(r.product_group_id) : r[c]));

  tbody.innerHTML = rows.length
    ? rows.map((g) => `
      <tr data-id="${g.product_group_id}" class="${sameId(state.selectedGroupId, g.product_group_id) ? 'is-selected' : ''}" title="Clique para ver os subgrupos deste grupo">
        <td>${g.product_group_id}</td>
        <td class="td-left">${escapeHtml(g.name)}</td>
        <td>${subgroupsCount(g.product_group_id)}</td>
        <td>${statusPill(g.is_active)}</td>
        <td>${rowActions('group', g, 'product_group_id')}</td>
      </tr>`).join('')
    : messageRow(5, 'Nenhum grupo encontrado.');

  setInfo('groups', plural(rows.length, 'grupo', 'grupos'));
}

function renderSubgroups() {
  const tbody = $('#subgroupsTableBody');
  const rows = sortRows(state.subgroups, state.sort.subgroups, (r, c) => (
    c === 'group_name' ? groupName(r.group_id) : r[c]));

  tbody.innerHTML = rows.length
    ? rows.map((sg) => `
      <tr data-id="${sg.product_subgroup_id}" class="${sameId(state.selectedSubgroupId, sg.product_subgroup_id) ? 'is-selected' : ''}" title="Clique para ver as famílias deste subgrupo">
        <td>${sg.product_subgroup_id}</td>
        <td class="td-left">${escapeHtml(sg.name)}</td>
        <td class="td-left">${escapeHtml(groupName(sg.group_id) || '—')}</td>
        <td>${statusPill(sg.is_active)}</td>
        <td>${rowActions('subgroup', sg, 'product_subgroup_id')}</td>
      </tr>`).join('')
    : messageRow(5, state.selectedGroupId ? 'Este grupo ainda não tem subgrupos.' : 'Nenhum subgrupo encontrado.');

  setInfo('subgroups', plural(rows.length, 'subgrupo', 'subgrupos'));

  const bar = $('#subgroupsFilterBar');
  if (state.selectedGroupId) {
    $('#subgroupsFilterLabel').textContent = `Grupo: ${groupName(state.selectedGroupId)}`;
    bar.style.display = '';
  } else if (state.searchGroupIds) {
    $('#subgroupsFilterLabel').textContent = `Grupos da busca: ${state.searchGroupIds.length}`;
    bar.style.display = '';
  } else {
    bar.style.display = 'none';
  }
}

function renderFamilies() {
  const tbody = $('#familiesTableBody');
  const rows = sortRows(state.families, state.sort.families, (r, c) => (
    c === 'subgroup_name' ? (r.subgroup_name || subgroupName(r.subgroup_id)) : r[c]));

  tbody.innerHTML = rows.length
    ? rows.map((f) => `
      <tr data-id="${f.product_family_id}">
        <td>${f.product_family_id}</td>
        <td class="td-left">${escapeHtml(f.name)}</td>
        <td class="td-left">${escapeHtml(f.subgroup_name || subgroupName(f.subgroup_id) || '—')}</td>
        <td>${statusPill(f.is_active)}</td>
        <td>${rowActions('family', f, 'product_family_id')}</td>
      </tr>`).join('')
    : messageRow(5, state.selectedSubgroupId ? 'Este subgrupo ainda não tem famílias.' : 'Nenhuma família encontrada.');

  setInfo('families', plural(rows.length, 'família', 'famílias'));

  const bar = $('#familiesFilterBar');
  if (state.selectedSubgroupId) {
    $('#familiesFilterLabel').textContent = `Subgrupo: ${subgroupName(state.selectedSubgroupId)}`;
    bar.style.display = '';
  } else if (state.selectedGroupId) {
    $('#familiesFilterLabel').textContent = `Grupo: ${groupName(state.selectedGroupId)}`;
    bar.style.display = '';
  } else {
    bar.style.display = 'none';
  }
}

// ======================================================================
// MODAIS (cadastro / edição)
// ======================================================================

function fillSelect(select, items, { idField, label, emptyText, selected }) {
  select.innerHTML = `<option value="">${escapeHtml(emptyText)}</option>${
    items.map((it) => `<option value="${it[idField]}">${escapeHtml(label(it))}</option>`).join('')}`;
  select.value = selected != null ? String(selected) : '';
}

function openGroupModal(group = null) {
  $('#groupModalTitle').textContent = group ? `Editar grupo #${group.product_group_id}` : 'Novo grupo';
  $('#groupId').value = group?.product_group_id ?? '';
  $('#groupName').value = group?.name ?? '';
  $('#groupIsActive').value = String(group ? !!group.is_active : true);
  Modal.open('groupModal', { focusSelector: '#groupName' });
}

function openSubgroupModal(sg = null) {
  $('#subgroupModalTitle').textContent = sg ? `Editar subgrupo #${sg.product_subgroup_id}` : 'Novo subgrupo';
  $('#subgroupId').value = sg?.product_subgroup_id ?? '';
  $('#subgroupName').value = sg?.name ?? '';
  $('#subgroupIsActive').value = String(sg ? !!sg.is_active : true);
  const groups = state.allGroups.filter((g) => g.is_active || sameId(g.product_group_id, sg?.group_id));
  fillSelect($('#subgroupGroupSelect'), sortRows(groups, { column: 'name', direction: 'asc' }), {
    idField: 'product_group_id',
    label: (g) => g.name,
    emptyText: '— Nenhum grupo (opcional) —',
    selected: sg ? sg.group_id : state.selectedGroupId,
  });
  Modal.open('subgroupModal', { focusSelector: '#subgroupName' });
}

function openFamilyModal(fam = null) {
  $('#familyModalTitle').textContent = fam ? `Editar família #${fam.product_family_id}` : 'Nova família';
  $('#familyId').value = fam?.product_family_id ?? '';
  $('#familyName').value = fam?.name ?? '';
  $('#familyIsActive').value = String(fam ? !!fam.is_active : true);

  // Com grupo selecionado, mostra só os subgrupos dele (o atual sempre aparece)
  const list = state.allSubgroups.filter((sg) => (
    (sg.is_active && (!state.selectedGroupId || sameId(sg.group_id, state.selectedGroupId)))
    || sameId(sg.product_subgroup_id, fam?.subgroup_id)));
  fillSelect($('#familySubgroupSelect'), sortRows(list, { column: 'name', direction: 'asc' }), {
    idField: 'product_subgroup_id',
    label: (sg) => (groupName(sg.group_id) ? `${sg.name} (${groupName(sg.group_id)})` : sg.name),
    emptyText: '— Selecione o subgrupo —',
    selected: fam ? fam.subgroup_id : state.selectedSubgroupId,
  });
  Modal.open('familyModal', { focusSelector: '#familyName' });
}

async function submitGroup(event) {
  event.preventDefault();
  const id = $('#groupId').value || null;
  const name = $('#groupName').value.trim();
  if (!name) { notify('Informe o nome do grupo.', 'warning'); $('#groupName').focus(); return; }

  await run(async () => {
    await apiSave(GROUPS_URL, id, { name, is_active: $('#groupIsActive').value === 'true' });
    Modal.close('groupModal');
    notify(id ? 'Grupo atualizado.' : 'Grupo cadastrado.');
    await reloadAll();
  }, 'Erro ao salvar o grupo.');
}

async function submitSubgroup(event) {
  event.preventDefault();
  const id = $('#subgroupId').value || null;
  const name = $('#subgroupName').value.trim();
  if (!name) { notify('Informe o nome do subgrupo.', 'warning'); $('#subgroupName').focus(); return; }
  const groupId = Number($('#subgroupGroupSelect').value) || null;

  await run(async () => {
    await apiSave(SUBGROUPS_URL, id, { name, group_id: groupId, is_active: $('#subgroupIsActive').value === 'true' });
    Modal.close('subgroupModal');
    notify(id ? 'Subgrupo atualizado.' : 'Subgrupo cadastrado.');
    await reloadAll();
  }, 'Erro ao salvar o subgrupo.');
}

async function submitFamily(event) {
  event.preventDefault();
  const id = $('#familyId').value || null;
  const name = $('#familyName').value.trim();
  const subgroupId = Number($('#familySubgroupSelect').value) || null;
  if (!name) { notify('Informe o nome da família.', 'warning'); $('#familyName').focus(); return; }
  if (!subgroupId) { notify('Selecione o subgrupo da família.', 'warning'); $('#familySubgroupSelect').focus(); return; }

  await run(async () => {
    await apiSave(FAMILIES_URL, id, { name, subgroup_id: subgroupId, is_active: $('#familyIsActive').value === 'true' });
    Modal.close('familyModal');
    notify(id ? 'Família atualizada.' : 'Família cadastrada.');
    await loadFamilies();
  }, 'Erro ao salvar a família.');
}

// ======================================================================
// AÇÕES DAS LINHAS
// ======================================================================

const ENTITIES = {
  groups: {
    url: GROUPS_URL,
    idField: 'product_group_id',
    label: 'o grupo',
    list: () => state.groups,
    edit: openGroupModal,
    deleteNote: 'Os subgrupos dele ficam sem grupo.',
    after: () => reloadAll(),
    onRowClick(row) {
      const id = row.product_group_id;
      state.selectedGroupId = sameId(state.selectedGroupId, id) ? null : id;
      state.selectedSubgroupId = null;
      renderGroups();
      reloadFromSubgroups();
    },
  },
  subgroups: {
    url: SUBGROUPS_URL,
    idField: 'product_subgroup_id',
    label: 'o subgrupo',
    list: () => state.subgroups,
    edit: openSubgroupModal,
    deleteNote: '',
    after: () => reloadAll(),
    onRowClick(row) {
      const id = row.product_subgroup_id;
      state.selectedSubgroupId = sameId(state.selectedSubgroupId, id) ? null : id;
      renderSubgroups();
      reloadFamilies();
    },
  },
  families: {
    url: FAMILIES_URL,
    idField: 'product_family_id',
    label: 'a família',
    list: () => state.families,
    edit: openFamilyModal,
    deleteNote: 'Os produtos dela ficam sem família.',
    after: () => reloadFamilies(),
    onRowClick: null,
  },
};

async function handleTableClick(key, event) {
  const entity = ENTITIES[key];
  const tr = event.target.closest('tr[data-id]');
  if (!tr) return;
  const row = entity.list().find((r) => sameId(r[entity.idField], tr.dataset.id));
  if (!row) return;

  const btn = event.target.closest('[data-act]');
  if (!btn) {
    entity.onRowClick?.(row);
    return;
  }

  const act = btn.dataset.act;
  if (act === 'edit') {
    entity.edit(row);
    return;
  }

  if (act === 'toggle') {
    const activate = !row.is_active;
    const ok = await confirmCenter(
      `Deseja ${activate ? 'reativar' : 'inativar'} ${entity.label} "${row.name}"?`,
      { title: activate ? 'Reativar' : 'Inativar', confirmLabel: activate ? 'Reativar' : 'Inativar' },
    );
    if (!ok) return;
    await run(async () => {
      await apiSave(entity.url, row[entity.idField], { is_active: activate });
      notify(activate ? 'Reativado.' : 'Inativado.');
      await entity.after();
    }, 'Erro ao alterar o status.');
    return;
  }

  if (act === 'delete') {
    const ok = await confirmCenter(
      `Excluir definitivamente ${entity.label} "${row.name}"? ${entity.deleteNote}`.trim(),
      { title: 'Excluir', confirmLabel: 'Excluir', variant: 'error' },
    );
    if (!ok) return;
    await run(async () => {
      await apiDelete(entity.url, row[entity.idField]);
      if (key === 'groups' && sameId(state.selectedGroupId, row.product_group_id)) {
        state.selectedGroupId = null;
        state.selectedSubgroupId = null;
      }
      if (key === 'subgroups' && sameId(state.selectedSubgroupId, row.product_subgroup_id)) {
        state.selectedSubgroupId = null;
      }
      notify('Excluído.');
      await entity.after();
    }, 'Erro ao excluir. Verifique se não há vínculos no banco.');
  }
}

// ======================================================================
// EVENTOS
// ======================================================================

function bindSearch(inputSel, statusSel, reload) {
  let timer = null;
  $(inputSel).addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 350);
  });
  $(inputSel).addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(timer); reload(); }
  });
  $(statusSel).addEventListener('change', reload);
}

function bindSort(key, renderFn, columns) {
  createSortableTable({
    table: `#${key}Table`,
    defaultColumn: state.sort[key].column,
    defaultDirection: state.sort[key].direction,
    allowedColumns: columns,
    onSort: ({ column, direction }) => {
      state.sort[key] = { column, direction };
      renderFn();
    },
  });
}

function bindEvents() {
  Modal.setup();

  $('#groupsBtnNew').addEventListener('click', () => openGroupModal());
  $('#subgroupsBtnNew').addEventListener('click', () => openSubgroupModal());
  $('#familiesBtnNew').addEventListener('click', () => openFamilyModal());

  $('#groupForm').addEventListener('submit', submitGroup);
  $('#subgroupForm').addEventListener('submit', submitSubgroup);
  $('#familyForm').addEventListener('submit', submitFamily);

  ['groups', 'subgroups', 'families'].forEach((key) => {
    $(`#${key}TableBody`).addEventListener('click', (ev) => handleTableClick(key, ev));
  });

  bindSearch('#groupsSearch', '#groupsStatus', () => run(async () => {
    await loadGroups();
    await loadSubgroups();
    await loadFamilies();
  }, 'Erro ao buscar grupos.'));
  bindSearch('#subgroupsSearch', '#subgroupsStatus', reloadFromSubgroups);
  bindSearch('#familiesSearch', '#familiesStatus', reloadFamilies);

  $('#subgroupsBtnClearFilter').addEventListener('click', () => {
    state.selectedGroupId = null;
    state.selectedSubgroupId = null;
    $('#groupsSearch').value = '';
    run(async () => {
      await loadGroups();
      await loadSubgroups();
      await loadFamilies();
    }, 'Erro ao limpar o filtro.');
  });

  $('#familiesBtnClearFilter').addEventListener('click', () => {
    if (state.selectedSubgroupId) {
      state.selectedSubgroupId = null;
      renderSubgroups();
    } else {
      state.selectedGroupId = null;
      renderGroups();
      reloadFromSubgroups();
      return;
    }
    reloadFamilies();
  });

  bindSort('groups', renderGroups, ['product_group_id', 'name', 'subgroups_count', 'is_active']);
  bindSort('subgroups', renderSubgroups, ['product_subgroup_id', 'name', 'group_name', 'is_active']);
  bindSort('families', renderFamilies, ['product_family_id', 'name', 'subgroup_name', 'is_active']);
}

// ======================================================================
// BOOTSTRAP
// ======================================================================

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  reloadAll();
});
