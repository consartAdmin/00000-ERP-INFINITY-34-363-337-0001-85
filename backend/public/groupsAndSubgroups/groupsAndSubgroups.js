// ╔══════════════════════════════════════════════════════════════════════╗
// ║ groupsAndSubgroups.js — Grupos, Subgrupos e Famílias (Frontend)     ║
// ║ CONSART ERP | ESM                                                   ║
// ║ - Consome /api/products-groups, /api/products-subgroups e           ║
// ║   /api/products-families (3º nível, filha do subgrupo)              ║
// ║ - CRUD básico + filtro por grupo selecionado                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

/* eslint-disable no-console */

// ---------------------------------------------------------------------
// Helper definitivo: utiliza a função global getApiBase() do apiBase.js
// ---------------------------------------------------------------------
function getApiBase() {
  try {
    if (typeof window !== 'undefined' && window.getApiBase) {
      return window.getApiBase();
    }
  } catch (err) {
    console.error('[siteMenu] Erro ao obter API base:', err);
  }

  // fallback seguro (raro)
  return 'http://localhost:8080';
}

// Valor final utilizado em todo o arquivo
const API_BASE = getApiBase();

//----------------------------------------------------------------------

const GROUPS_URL = `${API_BASE}/api/products-groups`;
const SUBGROUPS_URL = `${API_BASE}/api/products-subgroups`;
const FAMILIES_URL = `${API_BASE}/api/products-families`;

// ======================================================================
// HELPERS
// ======================================================================

// Helper genérico de fetch com JSON (tenta SEMPRE ler JSON)
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Falha na requisição (${res.status} ${res.statusText}) — ${text}`,
    );
    err.status = res.status;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    console.warn('[groupsAndSubgroups] Resposta não é JSON válido em', url, e);
  }

  console.log('[groupsAndSubgroups] raw payload from', url, data);
  return data;
}

// Aceita vários formatos de retorno de controller
function normalizeRows(payload) {
  if (!payload) return [];

  // 1) Array direto
  if (Array.isArray(payload)) return payload;

  // 2) Padrão { rows, total, ... }
  if (Array.isArray(payload.rows)) return payload.rows;

  // 3) Padrões comuns { data: [...] }, { items: [...] }
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;

  // 4) Procura recursivamente por um array de objetos
  function findArray(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 3) return null;

    if (Array.isArray(obj)) {
      // Se for array de objetos com alguma chave típica, já serve
      if (
        obj.length &&
        typeof obj[0] === 'object' &&
        (Object.prototype.hasOwnProperty.call(obj[0], 'product_group_id') ||
          Object.prototype.hasOwnProperty.call(obj[0], 'product_subgroup_id') ||
          Object.prototype.hasOwnProperty.call(obj[0], 'name'))
      ) {
        return obj;
      }
    }

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const found = findArray(val, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const found = findArray(payload, 0);
  if (found) return found;

  return [];
}

// ======================================================================
// DOM ELEMENTS
// ======================================================================

const els = {};

function cacheDom() {
  els.btnReloadAll = document.querySelector('#btnReloadAll');

  // Grupos
  els.groupsSearch = document.querySelector('#groupsSearch');
  els.btnSearchGroups = document.querySelector('#btnSearchGroups');
  els.groupsShowInactive = document.querySelector('#groupsShowInactive');
  els.groupForm = document.querySelector('#groupForm');
  els.groupId = document.querySelector('#groupId');
  els.groupName = document.querySelector('#groupName');
  els.groupIsActive = document.querySelector('#groupIsActive');
  els.btnNewGroup = document.querySelector('#btnNewGroup');
  els.btnSaveGroup = document.querySelector('#btnSaveGroup');
  els.btnCancelGroupEdit = document.querySelector('#btnCancelGroupEdit');
  els.groupsTableBody = document.querySelector('#groupsTableBody');
  els.groupsSummary = document.querySelector('#groupsSummary');

  // Subgrupos
  els.subgroupsSearch = document.querySelector('#subgroupsSearch');
  els.btnSearchSubgroups = document.querySelector('#btnSearchSubgroups');
  els.subgroupsShowInactive = document.querySelector('#subgroupsShowInactive');
  els.subgroupForm = document.querySelector('#subgroupForm');
  els.subgroupId = document.querySelector('#subgroupId');
  els.subgroupName = document.querySelector('#subgroupName');
  els.subgroupGroupSelect = document.querySelector('#subgroupGroupSelect');
  els.subgroupIsActive = document.querySelector('#subgroupIsActive');
  els.btnNewSubgroup = document.querySelector('#btnNewSubgroup');
  els.btnSaveSubgroup = document.querySelector('#btnSaveSubgroup');
  els.btnCancelSubgroupEdit = document.querySelector('#btnCancelSubgroupEdit');
  els.subgroupsTableBody = document.querySelector('#subgroupsTableBody');
  els.subgroupsSummary = document.querySelector('#subgroupsSummary');
  els.selectedGroupLabel = document.querySelector('#selectedGroupLabel');
  els.btnClearSelectedGroup = document.querySelector('#btnClearSelectedGroup');

  // Famílias (3º nível)
  els.familiesSearch = document.querySelector('#familiesSearch');
  els.btnSearchFamilies = document.querySelector('#btnSearchFamilies');
  els.familiesShowInactive = document.querySelector('#familiesShowInactive');
  els.familyForm = document.querySelector('#familyForm');
  els.familyId = document.querySelector('#familyId');
  els.familyName = document.querySelector('#familyName');
  els.familySubgroupSelect = document.querySelector('#familySubgroupSelect');
  els.familyIsActive = document.querySelector('#familyIsActive');
  els.btnNewFamily = document.querySelector('#btnNewFamily');
  els.btnSaveFamily = document.querySelector('#btnSaveFamily');
  els.btnCancelFamilyEdit = document.querySelector('#btnCancelFamilyEdit');
  els.familiesTableBody = document.querySelector('#familiesTableBody');
  els.familiesSummary = document.querySelector('#familiesSummary');
  els.selectedSubgroupLabel = document.querySelector('#selectedSubgroupLabel');
  els.btnClearSelectedSubgroup = document.querySelector('#btnClearSelectedSubgroup');
}

// ======================================================================
// ESTADO
// ======================================================================

const state = {
  groups: [],
  subgroups: [],
  selectedGroupId: null,
  // Famílias (3º nível)
  allSubgroups: [],
  families: [],
  selectedSubgroupId: null,
  // IDs dos grupos retornados pela busca de grupos (null = sem busca ativa)
  searchGroupIds: null,
};

/** Restringe os subgrupos aos grupos encontrados na busca (quando não há grupo selecionado) */
function applySearchGroupFilter(subgroups) {
  if (state.selectedGroupId || !state.searchGroupIds) return subgroups;
  const ids = new Set(state.searchGroupIds.map(String));
  return subgroups.filter((sg) => ids.has(String(sg.group_id)));
}

// ======================================================================
// RENDER
// ======================================================================

function renderGroupsTable() {
  const tbody = els.groupsTableBody;
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!state.groups.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; padding:12px; font-size:0.85rem; color:#64748b;">
          Nenhum grupo encontrado.
        </td>
      </tr>
    `;
    els.groupsSummary.textContent = '0 grupos encontrados.';
    return;
  }

  state.groups.forEach((g) => {
    const tr = document.createElement('tr');
    tr.dataset.id = g.product_group_id;
    if (String(state.selectedGroupId) === String(g.product_group_id)) {
      tr.classList.add('gs-row--selected');
    }

    const statusBadge = g.is_active
      ? '<span class="gs-status-badge gs-status-badge--active">Ativo</span>'
      : '<span class="gs-status-badge gs-status-badge--inactive">Inativo</span>';

    tr.innerHTML = `
      <td class="gs-table__col-id">${g.product_group_id}</td>
      <td>${g.name || ''}</td>
      <td class="gs-table__col-status">${statusBadge}</td>
      <td class="gs-table__col-actions">
      <div class="gs-table-actions">
      <button
      type="button"
      class="btn btn-toolbar btn-sm js-edit-group"
      title="Editar grupo"
      >✏️</button>

      <button
      type="button"
      class="btn btn-toolbar btn-sm js-toggle-group"
      title="${g.is_active ? 'Inativar' : 'Reativar'} grupo"
      >${g.is_active ? '⏸' : '▶️'}</button>

      <button
      type="button"
      class="btn btn-toolbar btn-sm js-delete-group"
      title="Excluir grupo"
      >🗑</button>
      </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  els.groupsSummary.textContent = `${state.groups.length} grupo(s) carregado(s).`;
}

function renderSubgroupsTable() {
  const tbody = els.subgroupsTableBody;
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!state.subgroups.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; padding:12px; font-size:0.85rem; color:#64748b;">
          Nenhum subgrupo encontrado.
        </td>
      </tr>
    `;
    els.subgroupsSummary.textContent = '0 subgrupos encontrados.';
    return;
  }

  state.subgroups.forEach((sg) => {
    const tr = document.createElement('tr');
    tr.dataset.id = sg.product_subgroup_id;
    if (String(state.selectedSubgroupId) === String(sg.product_subgroup_id)) {
      tr.classList.add('gs-row--selected');
    }

    const groupName =
      (sg.group && sg.group.name) ||
      sg.group_name ||
      state.groups.find((g) => String(g.product_group_id) === String(sg.group_id))?.name ||
      (sg.group_id ? `#${sg.group_id}` : '');

    const statusBadge = sg.is_active
      ? '<span class="gs-status-badge gs-status-badge--active">Ativo</span>'
      : '<span class="gs-status-badge gs-status-badge--inactive">Inativo</span>';

    tr.innerHTML = `
      <td class="gs-table__col-id">${sg.product_subgroup_id}</td>
      <td>${sg.name || ''}</td>
      <td>${groupName}</td>
      <td class="gs-table__col-status">${statusBadge}</td>
      <td class="gs-table__col-actions">
      <div class="gs-table-actions">
      <button
      type="button"
      class="btn btn-toolbar btn-sm js-edit-subgroup"
      title="Editar subgrupo"
      >✏️</button>

      <button
      type="button"
      class="btn btn-toolbar btn-sm js-toggle-subgroup"
      title="${sg.is_active ? 'Inativar' : 'Reativar'} subgrupo"
      >${sg.is_active ? '⏸' : '▶️'}</button>

      <button
      type="button"
      class="btn btn-toolbar btn-sm js-delete-subgroup"
      title="Excluir subgrupo"
      >🗑</button>
      </div>
      </td>
      `;

    tbody.appendChild(tr);
  });

  els.subgroupsSummary.textContent = `${state.subgroups.length} subgrupo(s) carregado(s).`;
}

function renderSelectedGroupInfo() {
  if (!els.selectedGroupLabel) return;

  if (!state.selectedGroupId) {
    els.selectedGroupLabel.textContent = state.searchGroupIds
      ? `Filtrando subgrupos dos ${state.searchGroupIds.length} grupo(s) encontrados na busca. Clique em um grupo para filtrar só ele.`
      : 'Nenhum grupo selecionado. Clique em um grupo à esquerda para filtrar.';
    return;
  }

  const group = state.groups.find(
    (g) => String(g.product_group_id) === String(state.selectedGroupId),
  );

  if (!group) {
    els.selectedGroupLabel.textContent =
      'Grupo selecionado não encontrado (talvez tenha sido removido).';
    return;
  }

  els.selectedGroupLabel.textContent = `Filtrando subgrupos do grupo: ${group.name}`;
}

function fillSubgroupGroupSelect() {
  if (!els.subgroupGroupSelect) return;

  const currentValue = els.subgroupGroupSelect.value;
  els.subgroupGroupSelect.innerHTML = '';

  const optEmpty = document.createElement('option');
  optEmpty.value = '';
  optEmpty.textContent = '— Nenhum grupo (opcional) —';
  els.subgroupGroupSelect.appendChild(optEmpty);

  state.groups.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.product_group_id;
    opt.textContent = g.name || '';
    els.subgroupGroupSelect.appendChild(opt);
  });

  if (state.selectedGroupId) {
    els.subgroupGroupSelect.value = String(state.selectedGroupId);
  } else if (currentValue) {
    els.subgroupGroupSelect.value = currentValue;
  }
}

// ======================================================================
// API (GRUPOS)
// ======================================================================

async function apiListGroups() {
  const url = new URL(GROUPS_URL);

  const q = (els.groupsSearch && els.groupsSearch.value) || '';
  if (q.trim()) url.searchParams.set('q', q.trim());

  url.searchParams.set('limit', '500');
  url.searchParams.set('offset', '0');

  const payload = await fetchJson(url.toString(), { method: 'GET' });
  console.log('[groupsAndSubgroups] payload groups:', payload);

  return normalizeRows(payload);
}

async function apiCreateGroup({ name, is_active }) {
  const payload = { name, is_active };
  return fetchJson(GROUPS_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function apiUpdateGroup(id, patch) {
  const url = `${GROUPS_URL}/${encodeURIComponent(id)}`;
  return fetchJson(url, {
    method: 'PUT', // seu routes usa PUT para update
    body: JSON.stringify(patch),
  });
}

async function apiDeleteGroup(id) {
  const url = `${GROUPS_URL}/${encodeURIComponent(id)}`;
  await fetchJson(url, { method: 'DELETE' });
}

// ======================================================================
// API (SUBGRUPOS)
// ======================================================================

async function apiListSubgroups() {
  const url = new URL(SUBGROUPS_URL);

  const q = (els.subgroupsSearch && els.subgroupsSearch.value) || '';
  if (q.trim()) url.searchParams.set('q', q.trim());

  if (state.selectedGroupId) {
    url.searchParams.set('group_id', String(state.selectedGroupId));
  }

  url.searchParams.set('limit', '500');
  url.searchParams.set('offset', '0');

  const payload = await fetchJson(url.toString(), { method: 'GET' });
  console.log('[groupsAndSubgroups] payload subgroups:', payload);

  return normalizeRows(payload);
}

async function apiCreateSubgroup({ name, group_id, is_active }) {
  const payload = {
    name,
    group_id: group_id ? Number(group_id) : null,
    is_active,
  };
  return fetchJson(SUBGROUPS_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function apiUpdateSubgroup(id, patch) {
  const url = `${SUBGROUPS_URL}/${encodeURIComponent(id)}`;
  const payload = { ...patch };

  if ('group_id' in payload && payload.group_id !== null && payload.group_id !== '') {
    payload.group_id = Number(payload.group_id);
  }
  if (payload.group_id === '') payload.group_id = null;

  return fetchJson(url, {
    method: 'PUT', // seu routes usa PUT para update
    body: JSON.stringify(payload),
  });
}

async function apiDeleteSubgroup(id) {
  const url = `${SUBGROUPS_URL}/${encodeURIComponent(id)}`;
  await fetchJson(url, { method: 'DELETE' });
}

// ======================================================================
// AÇÕES DE PÁGINA
// ======================================================================

async function loadGroupsAndSubgroups(full = false) {
  try {
    els.groupsSummary.textContent = 'Carregando grupos...';
    els.subgroupsSummary.textContent = 'Carregando subgrupos...';

    const groups = await apiListGroups();
    state.groups = groups || [];

    // Busca de grupos ativa → subgrupos acompanham os grupos encontrados.
    // Um único resultado vira o grupo selecionado.
    const groupTerm = (els.groupsSearch && els.groupsSearch.value.trim()) || '';
    const foundIds = state.groups.map((g) => g.product_group_id);
    state.searchGroupIds = groupTerm ? foundIds : null;
    if (groupTerm && foundIds.length === 1) {
      state.selectedGroupId = foundIds[0];
    } else if (state.selectedGroupId && groupTerm &&
      !foundIds.some((id) => String(id) === String(state.selectedGroupId))) {
      state.selectedGroupId = null;
    }

    renderGroupsTable();
    fillSubgroupGroupSelect();

    const subgroups = await apiListSubgroups();
    state.subgroups = applySearchGroupFilter(subgroups || []);
    renderSubgroupsTable();
    renderSelectedGroupInfo();

    await refreshAllSubgroups();
    await loadFamiliesOnly();

    if (full) {
      console.info('[groupsAndSubgroups] Dados recarregados (full).');
    }
  } catch (err) {
    console.error('[groupsAndSubgroups] Erro ao carregar dados', err);
    alert('Erro ao carregar grupos/subgrupos. Detalhes no console.');
  }
}

function resetGroupForm() {
  els.groupId.value = '';
  els.groupName.value = '';
  els.groupIsActive.checked = true;
  els.btnSaveGroup.textContent = '💾 Salvar';
}

function resetSubgroupForm() {
  els.subgroupId.value = '';
  els.subgroupName.value = '';
  els.subgroupIsActive.checked = true;

  if (state.selectedGroupId) {
    els.subgroupGroupSelect.value = String(state.selectedGroupId);
  } else {
    els.subgroupGroupSelect.value = '';
  }
  els.btnSaveSubgroup.textContent = '💾 Salvar';
}

// ======================================================================
// HANDLERS (GRUPOS)
// ======================================================================

async function handleGroupFormSubmit(event) {
  event.preventDefault();

  const id = els.groupId.value || null;
  const name = (els.groupName.value || '').trim();
  const is_active = !!els.groupIsActive.checked;

  if (!name) {
    alert('Informe o nome do grupo.');
    els.groupName.focus();
    return;
  }

  try {
    if (!id) {
      await apiCreateGroup({ name, is_active });
    } else {
      await apiUpdateGroup(id, { name, is_active });
    }
    resetGroupForm();
    await loadGroupsAndSubgroups(false);
  } catch (err) {
    console.error('[groupsAndSubgroups] Erro ao salvar grupo', err);
    alert(
      err?.message ||
        'Erro ao salvar grupo. Verifique se o nome já não existe e tente novamente.',
    );
  }
}

function handleGroupsTableClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('tr');
  if (!row || !row.dataset.id) return;

  const id = row.dataset.id;
  const group = state.groups.find(
    (g) => String(g.product_group_id) === String(id),
  );

  if (btn) {
    if (btn.classList.contains('js-edit-group')) {
      if (!group) return;
      els.groupId.value = group.product_group_id;
      els.groupName.value = group.name || '';
      els.groupIsActive.checked = !!group.is_active;
      els.btnSaveGroup.textContent = '💾 Atualizar';
      return;
    }

    if (btn.classList.contains('js-toggle-group')) {
      if (!group) return;
      const newStatus = !group.is_active;
      const label = newStatus ? 'reativar' : 'inativar';

      const ok = window.confirm(
        `Tem certeza que deseja ${label} o grupo "${group.name}"?`,
      );
      if (!ok) return;

      apiUpdateGroup(group.product_group_id, { is_active: newStatus })
        .then(() => loadGroupsAndSubgroups(false))
        .catch((err) => {
          console.error('[groupsAndSubgroups] Erro ao alterar status grupo', err);
          alert('Erro ao alterar status do grupo. Veja detalhes no console.');
        });

      return;
    }

    if (btn.classList.contains('js-delete-group')) {
      if (!group) return;
      const ok = window.confirm(
        `Excluir DEFINITIVAMENTE o grupo "${group.name}"? (Subgrupos permanecerão com group_id nulo)`,
      );
      if (!ok) return;

      apiDeleteGroup(group.product_group_id)
        .then(() => {
          if (
            state.selectedGroupId &&
            String(state.selectedGroupId) === String(group.product_group_id)
          ) {
            state.selectedGroupId = null;
          }
          return loadGroupsAndSubgroups(false);
        })
        .catch((err) => {
          console.error('[groupsAndSubgroups] Erro ao excluir grupo', err);
          alert(
            'Erro ao excluir grupo. Verifique se não há vínculos obrigatórios no banco.',
          );
        });

      return;
    }

    return;
  }

  if (!group) return;
  state.selectedGroupId = group.product_group_id;
  state.selectedSubgroupId = null;
  renderGroupsTable();
  renderSelectedGroupInfo();
  loadSubgroupsOnly();
}

// ======================================================================
// HANDLERS (SUBGRUPOS)
// ======================================================================

async function handleSubgroupFormSubmit(event) {
  event.preventDefault();

  const id = els.subgroupId.value || null;
  const name = (els.subgroupName.value || '').trim();
  const group_id = els.subgroupGroupSelect.value || null;
  const is_active = !!els.subgroupIsActive.checked;

  if (!name) {
    alert('Informe o nome do subgrupo.');
    els.subgroupName.focus();
    return;
  }

  try {
    if (!id) {
      await apiCreateSubgroup({ name, group_id, is_active });
    } else {
      await apiUpdateSubgroup(id, { name, group_id, is_active });
    }
    resetSubgroupForm();
    await loadSubgroupsOnly();
  } catch (err) {
    console.error('[groupsAndSubgroups] Erro ao salvar subgrupo', err);
    alert(
      err?.message ||
        'Erro ao salvar subgrupo. Verifique se o nome já não existe e tente novamente.',
    );
  }
}

function handleSubgroupsTableClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('tr');
  if (!row || !row.dataset.id) return;

  const id = row.dataset.id;
  const sg = state.subgroups.find(
    (s) => String(s.product_subgroup_id) === String(id),
  );
  if (!sg) return;

  if (btn) {
    if (btn.classList.contains('js-edit-subgroup')) {
      els.subgroupId.value = sg.product_subgroup_id;
      els.subgroupName.value = sg.name || '';
      els.subgroupIsActive.checked = !!sg.is_active;

      if (sg.group_id) {
        els.subgroupGroupSelect.value = String(sg.group_id);
      } else if (state.selectedGroupId) {
        els.subgroupGroupSelect.value = String(state.selectedGroupId);
      } else {
        els.subgroupGroupSelect.value = '';
      }

      els.btnSaveSubgroup.textContent = '💾 Atualizar';
      return;
    }

    if (btn.classList.contains('js-toggle-subgroup')) {
      const newStatus = !sg.is_active;
      const label = newStatus ? 'reativar' : 'inativar';
      const ok = window.confirm(
        `Tem certeza que deseja ${label} o subgrupo "${sg.name}"?`,
      );
      if (!ok) return;

      apiUpdateSubgroup(sg.product_subgroup_id, { is_active: newStatus })
        .then(() => loadSubgroupsOnly())
        .catch((err) => {
          console.error(
            '[groupsAndSubgroups] Erro ao alterar status subgrupo',
            err,
          );
          alert('Erro ao alterar status do subgrupo. Veja detalhes no console.');
        });

      return;
    }

    if (btn.classList.contains('js-delete-subgroup')) {
      if (sg.product_subgroup_id && String(state.selectedSubgroupId) === String(sg.product_subgroup_id)) {
        state.selectedSubgroupId = null;
      }
      const ok = window.confirm(
        `Excluir DEFINITIVAMENTE o subgrupo "${sg.name}"?`,
      );
      if (!ok) return;

      apiDeleteSubgroup(sg.product_subgroup_id)
        .then(() => loadSubgroupsOnly())
        .catch((err) => {
          console.error('[groupsAndSubgroups] Erro ao excluir subgrupo', err);
          alert('Erro ao excluir subgrupo. Veja detalhes no console.');
        });

      return;
    }

    return;
  }

  // Clique na linha (fora dos botões): seleciona o subgrupo e filtra as famílias
  state.selectedSubgroupId = sg.product_subgroup_id;
  renderSubgroupsTable();
  resetFamilyForm();
  loadFamiliesOnly();
}

async function loadSubgroupsOnly() {
  try {
    els.subgroupsSummary.textContent = 'Carregando subgrupos...';
    const subgroups = await apiListSubgroups();
    state.subgroups = applySearchGroupFilter(subgroups || []);
    renderSubgroupsTable();
    renderSelectedGroupInfo();
    await refreshAllSubgroups();
    await loadFamiliesOnly();
  } catch (err) {
    console.error('[groupsAndSubgroups] Erro ao recarregar subgrupos', err);
    alert('Erro ao recarregar subgrupos. Detalhes no console.');
  }
}

// ======================================================================
// FAMÍLIAS (3º nível: Grupo → Subgrupo → Família)
// ======================================================================

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function subgroupName(id) {
  const sg = state.allSubgroups.find((s) => String(s.product_subgroup_id) === String(id))
    || state.subgroups.find((s) => String(s.product_subgroup_id) === String(id));
  return sg?.name || (id ? `#${id}` : '');
}

async function refreshAllSubgroups() {
  try {
    const url = new URL(SUBGROUPS_URL);
    url.searchParams.set('limit', '2000');
    url.searchParams.set('offset', '0');
    state.allSubgroups = normalizeRows(await fetchJson(url.toString(), { method: 'GET' }));
  } catch (err) {
    console.warn('[groupsAndSubgroups] Falha ao carregar todos os subgrupos', err);
    state.allSubgroups = [...state.subgroups];
  }
  fillFamilySubgroupSelect();
}

function fillFamilySubgroupSelect() {
  const sel = els.familySubgroupSelect;
  if (!sel) return;

  const current = sel.value;
  sel.innerHTML = '<option value="">— Selecione o subgrupo —</option>';

  // Com grupo selecionado, mostra só os subgrupos dele (o atual sempre aparece)
  const list = state.allSubgroups.filter((sg) =>
    !state.selectedGroupId
    || String(sg.group_id) === String(state.selectedGroupId)
    || String(sg.product_subgroup_id) === String(current));

  list.forEach((sg) => {
    const opt = document.createElement('option');
    opt.value = sg.product_subgroup_id;
    const groupName = state.groups.find((g) => String(g.product_group_id) === String(sg.group_id))?.name;
    opt.textContent = groupName ? `${sg.name} (${groupName})` : (sg.name || '');
    sel.appendChild(opt);
  });

  if (state.selectedSubgroupId) sel.value = String(state.selectedSubgroupId);
  else if (current) sel.value = current;
}

async function apiListFamilies() {
  const url = new URL(FAMILIES_URL);
  const q = (els.familiesSearch && els.familiesSearch.value) || '';
  if (q.trim()) url.searchParams.set('q', q.trim());

  if (state.selectedSubgroupId) {
    url.searchParams.set('subgroup_id', String(state.selectedSubgroupId));
  } else if (state.selectedGroupId) {
    url.searchParams.set('group_id', String(state.selectedGroupId));
  }
  if (!els.familiesShowInactive?.checked) url.searchParams.set('is_active', 'true');

  url.searchParams.set('limit', '1000');
  url.searchParams.set('offset', '0');
  return normalizeRows(await fetchJson(url.toString(), { method: 'GET' }));
}

function apiSaveFamily(id, body) {
  return fetchJson(id ? `${FAMILIES_URL}/${encodeURIComponent(id)}` : FAMILIES_URL, {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
}

function apiDeleteFamily(id) {
  return fetchJson(`${FAMILIES_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function renderSelectedSubgroupInfo() {
  if (!els.selectedSubgroupLabel) return;
  if (state.selectedSubgroupId) {
    els.selectedSubgroupLabel.textContent = `Filtrando famílias do subgrupo: ${subgroupName(state.selectedSubgroupId)}`;
  } else if (state.selectedGroupId) {
    const g = state.groups.find((x) => String(x.product_group_id) === String(state.selectedGroupId));
    els.selectedSubgroupLabel.textContent = `Famílias de todos os subgrupos do grupo ${g?.name || ''}. Clique em um subgrupo para filtrar só ele.`;
  } else {
    els.selectedSubgroupLabel.textContent = 'Nenhum subgrupo selecionado. Clique em um subgrupo para ver as famílias dele.';
  }
}

function renderFamiliesTable() {
  const tbody = els.familiesTableBody;
  if (!tbody) return;

  if (!state.families.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; padding:12px; font-size:0.85rem; color:#64748b;">
          Nenhuma família encontrada.
        </td>
      </tr>`;
    els.familiesSummary.textContent = '0 famílias encontradas.';
    return;
  }

  tbody.innerHTML = state.families.map((f) => {
    const statusBadge = f.is_active
      ? '<span class="gs-status-badge gs-status-badge--active">Ativo</span>'
      : '<span class="gs-status-badge gs-status-badge--inactive">Inativo</span>';
    return `
      <tr data-id="${f.product_family_id}">
        <td class="gs-table__col-id">${f.product_family_id}</td>
        <td>${escapeHtml(f.name)}</td>
        <td>${escapeHtml(f.subgroup_name || subgroupName(f.subgroup_id))}</td>
        <td class="gs-table__col-status">${statusBadge}</td>
        <td class="gs-table__col-actions">
          <div class="gs-table-actions">
            <button type="button" class="btn btn-toolbar btn-sm js-edit-family" title="Editar família">✏️</button>
            <button type="button" class="btn btn-toolbar btn-sm js-toggle-family"
              title="${f.is_active ? 'Inativar' : 'Reativar'} família">${f.is_active ? '⏸' : '▶️'}</button>
            <button type="button" class="btn btn-toolbar btn-sm js-delete-family" title="Excluir família">🗑</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  els.familiesSummary.textContent = `${state.families.length} família(s) carregada(s).`;
}

async function loadFamiliesOnly() {
  try {
    if (els.familiesSummary) els.familiesSummary.textContent = 'Carregando famílias...';
    state.families = await apiListFamilies();
    fillFamilySubgroupSelect();
    renderFamiliesTable();
    renderSelectedSubgroupInfo();
  } catch (err) {
    console.error('[groupsAndSubgroups] Erro ao carregar famílias', err);
    if (els.familiesSummary) els.familiesSummary.textContent = 'Erro ao carregar famílias.';
  }
}

function resetFamilyForm() {
  if (!els.familyForm) return;
  els.familyId.value = '';
  els.familyName.value = '';
  els.familyIsActive.checked = true;
  fillFamilySubgroupSelect();
  els.familySubgroupSelect.value = state.selectedSubgroupId ? String(state.selectedSubgroupId) : '';
  els.btnSaveFamily.textContent = '💾 Salvar';
}

async function handleFamilyFormSubmit(event) {
  event.preventDefault();

  const id = els.familyId.value || null;
  const name = (els.familyName.value || '').trim();
  const subgroup_id = Number(els.familySubgroupSelect.value) || null;
  const is_active = !!els.familyIsActive.checked;

  if (!name) {
    alert('Informe o nome da família.');
    els.familyName.focus();
    return;
  }
  if (!subgroup_id) {
    alert('Selecione o subgrupo da família.');
    els.familySubgroupSelect.focus();
    return;
  }

  try {
    await apiSaveFamily(id, { name, subgroup_id, is_active });
    resetFamilyForm();
    await loadFamiliesOnly();
  } catch (err) {
    console.error('[groupsAndSubgroups] Erro ao salvar família', err);
    let msg = 'Erro ao salvar família.';
    try { msg = JSON.parse(String(err.message).split(' — ')[1] || '{}').error || msg; } catch (_) { /* mantém */ }
    alert(msg);
  }
}

function handleFamiliesTableClick(event) {
  const btn = event.target.closest('button');
  const row = event.target.closest('tr');
  if (!btn || !row || !row.dataset.id) return;

  const fam = state.families.find((f) => String(f.product_family_id) === String(row.dataset.id));
  if (!fam) return;

  if (btn.classList.contains('js-edit-family')) {
    els.familyId.value = fam.product_family_id;
    els.familyName.value = fam.name || '';
    els.familyIsActive.checked = !!fam.is_active;
    fillFamilySubgroupSelect();
    els.familySubgroupSelect.value = String(fam.subgroup_id || '');
    els.btnSaveFamily.textContent = '💾 Atualizar';
    els.familyName.focus();
    return;
  }

  if (btn.classList.contains('js-toggle-family')) {
    const newStatus = !fam.is_active;
    if (!window.confirm(`Tem certeza que deseja ${newStatus ? 'reativar' : 'inativar'} a família "${fam.name}"?`)) return;
    apiSaveFamily(fam.product_family_id, { is_active: newStatus })
      .then(() => loadFamiliesOnly())
      .catch((err) => {
        console.error('[groupsAndSubgroups] Erro ao alterar status família', err);
        alert('Erro ao alterar status da família.');
      });
    return;
  }

  if (btn.classList.contains('js-delete-family')) {
    if (!window.confirm(`Excluir DEFINITIVAMENTE a família "${fam.name}"? (Os produtos dela ficam sem família)`)) return;
    apiDeleteFamily(fam.product_family_id)
      .then(() => loadFamiliesOnly())
      .catch((err) => {
        console.error('[groupsAndSubgroups] Erro ao excluir família', err);
        alert('Erro ao excluir família.');
      });
  }
}

// ======================================================================
// BIND EVENTS
// ======================================================================

function bindEvents() {
  if (els.btnReloadAll) {
    els.btnReloadAll.addEventListener('click', () => loadGroupsAndSubgroups(true));
  }

  // Grupos
  if (els.groupForm) {
    els.groupForm.addEventListener('submit', handleGroupFormSubmit);
  }
  if (els.btnCancelGroupEdit) {
    els.btnCancelGroupEdit.addEventListener('click', () => resetGroupForm());
  }
  if (els.btnNewGroup) {
    els.btnNewGroup.addEventListener('click', () => {
      resetGroupForm();
      els.groupName.focus();
    });
  }
  if (els.btnSearchGroups) {
    els.btnSearchGroups.addEventListener('click', () => loadGroupsAndSubgroups(false));
  }
  if (els.groupsSearch) {
    els.groupsSearch.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        loadGroupsAndSubgroups(false);
      }
    });
  }
  if (els.groupsShowInactive) {
    els.groupsShowInactive.addEventListener('change', () =>
      loadGroupsAndSubgroups(false),
    );
  }
  if (els.groupsTableBody) {
    els.groupsTableBody.addEventListener('click', handleGroupsTableClick);
  }

  // Subgrupos
  if (els.subgroupForm) {
    els.subgroupForm.addEventListener('submit', handleSubgroupFormSubmit);
  }
  if (els.btnCancelSubgroupEdit) {
    els.btnCancelSubgroupEdit.addEventListener('click', () =>
      resetSubgroupForm(),
    );
  }
  if (els.btnNewSubgroup) {
    els.btnNewSubgroup.addEventListener('click', () => {
      resetSubgroupForm();
      els.subgroupName.focus();
    });
  }
  if (els.btnSearchSubgroups) {
    els.btnSearchSubgroups.addEventListener('click', () => loadSubgroupsOnly());
  }
  if (els.subgroupsSearch) {
    els.subgroupsSearch.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        loadSubgroupsOnly();
      }
    });
  }
  if (els.subgroupsShowInactive) {
    els.subgroupsShowInactive.addEventListener('change', () => loadSubgroupsOnly());
  }
  if (els.subgroupsTableBody) {
    els.subgroupsTableBody.addEventListener('click', handleSubgroupsTableClick);
  }

  // Famílias
  if (els.familyForm) els.familyForm.addEventListener('submit', handleFamilyFormSubmit);
  if (els.btnCancelFamilyEdit) els.btnCancelFamilyEdit.addEventListener('click', () => resetFamilyForm());
  if (els.btnNewFamily) {
    els.btnNewFamily.addEventListener('click', () => {
      resetFamilyForm();
      els.familyName.focus();
    });
  }
  if (els.btnSearchFamilies) els.btnSearchFamilies.addEventListener('click', () => loadFamiliesOnly());
  if (els.familiesSearch) {
    els.familiesSearch.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        loadFamiliesOnly();
      }
    });
  }
  if (els.familiesShowInactive) els.familiesShowInactive.addEventListener('change', () => loadFamiliesOnly());
  if (els.familiesTableBody) els.familiesTableBody.addEventListener('click', handleFamiliesTableClick);
  if (els.btnClearSelectedSubgroup) {
    els.btnClearSelectedSubgroup.addEventListener('click', () => {
      state.selectedSubgroupId = null;
      if (els.familiesSearch) els.familiesSearch.value = '';
      renderSubgroupsTable();
      resetFamilyForm();
      loadFamiliesOnly();
    });
  }

  if (els.btnClearSelectedGroup) {
    els.btnClearSelectedGroup.addEventListener('click', () => {
      // Limpa também a busca de grupos, que filtra os subgrupos
      state.selectedGroupId = null;
      state.selectedSubgroupId = null;
      if (els.groupsSearch) els.groupsSearch.value = '';
      loadGroupsAndSubgroups(false);
    });
  }
}

// ======================================================================
// BOOTSTRAP
// ======================================================================

document.addEventListener('DOMContentLoaded', () => {
  try {
    cacheDom();
    bindEvents();
    loadGroupsAndSubgroups(true);
  } catch (err) {
    console.error('[groupsAndSubgroups] Erro na inicialização', err);
    alert('Erro ao inicializar a tela de Grupos & Subgrupos.');
  }
});
