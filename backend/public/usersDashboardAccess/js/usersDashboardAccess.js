// ╔══════════════════════════════════════════════════════════════════════╗
// ║ usersDashboardAccess.js — Acesso aos Dashboards | CONSART ERP       ║
// ║                                                                     ║
// ║ Lista: usuários com o resumo do que cada um vê na Home, por slide.  ║
// ║ Modal: indicadores agrupados por slide, marcar slide inteiro,       ║
// ║ copiar acessos de outro usuário e salvar.                           ║
// ║ A herança (Impostos/Estoque seguem "Análise de Vendas" enquanto não ║
// ║ houver registro próprio) vem de dashboardAccess.js, a mesma regra   ║
// ║ que a Home usa: o que a tela mostra é o que a Home mostra.          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { SLIDES, ITEMS, TOTAL_ITEMS } from './usersDashboardAccess.config.js?v=20261109-1';
import {
  listAllDashboardAccess,
  listUserDashboardAccess,
  listUsers,
  replaceUserDashboardAccess,
} from './usersDashboardAccess.api.js?v=20261109-1';
import { resolveDashboardAccess } from '/public/includes/js/dashBoards/dashboardAccess.js?v=20261109-1';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

// ======================================================================
// STATE / DOM
// ======================================================================

const state = {
  users: [],          // [{ user_id, name, login, active, allowed:Set, summary }]
  filtered: [],
  page: 1,
  pageSize: 50,
  sortColumn: 'name',
  sortDirection: 'asc',
  editing: null,      // usuário aberto no modal
  checked: new Set(), // item.id marcados no modal
  saving: false,
};

const $ = (id) => document.getElementById(id);
const dom = {};

function cacheDom() {
  [
    'fQ', 'fSlide', 'fActive', 'btnClear', 'usersTable', 'tbody', 'tableInfo',
    'pageInfo', 'btnPrevious', 'btnNext', 'pageSize', 'modal', 'mTitle',
    'mCopyFrom', 'btnCopyFrom', 'btnCheckAll', 'btnUncheckAll', 'mBody',
    'mCount', 'btnSave',
  ].forEach((id) => { dom[id] = $(id); });
}

// ======================================================================
// UTILS
// ======================================================================

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function notify(message, variant = 'success') {
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Acesso aos Dashboards'),
    message: String(message ?? ''),
    timeoutMs: variant === 'success' ? 2500 : undefined,
  });
}

async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Confirmar' } = {}) {
  const button = await showCenterModal({
    variant: 'warning',
    title,
    message,
    timeoutMs: null,
    buttons: [
      { label: 'Cancelar', variant: 'cancel' },
      { label: confirmLabel, variant: 'confirm' },
    ],
  });
  return String(button?.variant || '').toLowerCase() === 'confirm';
}

// ======================================================================
// ACCESS <-> ITEMS
// ======================================================================

/** Set de chaves liberadas → Set de item.id marcados. */
function itemsFromAllowed(allowed) {
  return new Set(
    ITEMS.filter((item) => item.keys.some((key) => allowed.has(key))).map((item) => item.id)
  );
}

/** Resumo por slide: { finance: {on, total}, ..., total } */
function summarize(checkedItems) {
  const summary = { total: 0 };
  for (const slide of SLIDES) {
    const on = slide.items.filter((item) => checkedItems.has(item.id)).length;
    summary[slide.id] = { on, total: slide.items.length };
    summary.total += on;
  }
  return summary;
}

function slidePill({ on, total }) {
  if (!on) return '<span title="Sem acesso">—</span>';
  if (on === total) return '<span class="summary-pill summary-pill--success">Liberado</span>';
  return `<span class="summary-pill summary-pill--warning">${on} de ${total}</span>`;
}

function statusPill(active) {
  return active
    ? '<span class="summary-pill summary-pill--success">Ativo</span>'
    : '<span class="summary-pill summary-pill--danger">Inativo</span>';
}

// ======================================================================
// LIST
// ======================================================================

function sortValue(user, column) {
  if (column === 'user_id') return Number(user.user_id) || 0;
  if (column === 'total') return user.summary.total;
  if (column === 'active') return user.active ? 1 : 0;
  if (SLIDES.some((slide) => slide.id === column)) {
    return user.summary[column].on;
  }
  return normalizeText(user[column]);
}

function applyFilters() {
  const q = normalizeText(dom.fQ.value.trim());
  const slide = dom.fSlide.value;
  const active = dom.fActive.value;

  state.filtered = state.users.filter((user) => {
    if (active && String(user.active) !== active) return false;
    if (slide === 'none' && user.summary.total > 0) return false;
    if (slide && slide !== 'none' && !user.summary[slide].on) return false;
    if (!q) return true;
    return normalizeText(`${user.user_id} ${user.name} ${user.login}`).includes(q);
  });

  const dir = state.sortDirection === 'desc' ? -1 : 1;
  state.filtered.sort((a, b) => {
    const va = sortValue(a, state.sortColumn);
    const vb = sortValue(b, state.sortColumn);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return normalizeText(a.name).localeCompare(normalizeText(b.name));
  });

  renderList();
}

function renderList() {
  const total = state.filtered.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pages);

  dom.tableInfo.textContent = plural(total, 'usuário', 'usuários');
  dom.pageInfo.textContent = `Página ${state.page} de ${pages}`;
  dom.btnPrevious.disabled = state.page <= 1;
  dom.btnNext.disabled = state.page >= pages;

  if (!total) {
    dom.tbody.innerHTML = '<tr><td colspan="10" class="td-center">Nenhum usuário encontrado.</td></tr>';
    return;
  }

  const start = (state.page - 1) * state.pageSize;

  dom.tbody.innerHTML = state.filtered.slice(start, start + state.pageSize).map((user) => `
    <tr data-user-id="${esc(user.user_id)}">
      <td class="td-center"><strong>${esc(user.user_id)}</strong></td>
      <td><strong>${esc(user.name)}</strong></td>
      <td>${esc(user.login)}</td>
      ${SLIDES.map((slide) => `<td class="td-center">${slidePill(user.summary[slide.id])}</td>`).join('')}
      <td class="td-center"><strong>${user.summary.total}</strong> de ${TOTAL_ITEMS}</td>
      <td class="td-center">${statusPill(user.active)}</td>
      <td class="td-center">${actionIconsHtml([
        { action: 'edit', title: 'Editar acessos', attrs: { 'data-act': 'edit', 'data-id': user.user_id } },
        { action: 'copy', title: 'Copiar estes acessos para outro usuário', attrs: { 'data-act': 'copy-to', 'data-id': user.user_id } },
      ])}</td>
    </tr>
  `).join('');
}

async function loadList() {
  dom.tbody.innerHTML = '<tr><td colspan="10" class="td-center">Carregando usuários...</td></tr>';

  try {
    const [users, accessByUser] = await Promise.all([listUsers(), listAllDashboardAccess()]);

    state.users = users.map((u) => {
      const id = u.user_id ?? u.id;
      const allowed = resolveDashboardAccess(accessByUser[String(id)] || []);
      const checked = itemsFromAllowed(allowed);
      return {
        user_id: id,
        name: u.name ?? u.full_name ?? u.username ?? '',
        login: u.email ?? u.login ?? u.username ?? '',
        active: (u.is_active ?? u.active ?? true) === true,
        checked,
        summary: summarize(checked),
      };
    }).filter((u) => u.user_id);

    fillCopySelect();
    applyFilters();
  } catch (error) {
    console.error('[usersDashboardAccess] loadList', error);
    dom.tbody.innerHTML = '<tr><td colspan="10" class="td-center">Não foi possível carregar os usuários.</td></tr>';
    notify(error?.message || 'Não foi possível carregar os usuários.', 'error');
  }
}

// ======================================================================
// MODAL
// ======================================================================

function fillCopySelect(excludeId = null) {
  const options = state.users
    .filter((u) => String(u.user_id) !== String(excludeId))
    .sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name)))
    .map((u) => `<option value="${esc(u.user_id)}">${esc(u.name)} (#${esc(u.user_id)}) · ${u.summary.total} de ${TOTAL_ITEMS}</option>`);

  dom.mCopyFrom.innerHTML = `<option value="">Selecione um usuário...</option>${options.join('')}`;
  dom.btnCopyFrom.disabled = true;
}

function renderModal() {
  dom.mBody.innerHTML = SLIDES.map((slide) => {
    const on = slide.items.filter((item) => state.checked.has(item.id)).length;
    const all = on === slide.items.length;
    const pill = !on
      ? 'summary-pill'
      : (all ? 'summary-pill summary-pill--success' : 'summary-pill summary-pill--warning');

    const rows = slide.items.map((item) => `
      <label class="checkbox" title="${esc(item.hint)}">
        <input type="checkbox" data-item="${item.id}" ${state.checked.has(item.id) ? 'checked' : ''} />
        <span><strong>${esc(item.label)}</strong> · <small>${esc(item.hint)}</small></span>
      </label>`).join('');

    return `
      <section class="section section-panel section-column section-gap-2 section-justify-start section-h-full">
        <div class="section__header section-justify-between">
          <label class="checkbox">
            <input type="checkbox" data-slide="${slide.id}" ${all ? 'checked' : ''} />
            <span class="section__title">Slide ${esc(slide.title)}</span>
          </label>
          <span class="${pill}">${on} de ${slide.items.length}</span>
        </div>
        <div class="modal-divider modal-divider--soft"></div>
        <div class="section__body section section-column section-gap-3 section-p-0 section-transparent section-border-none section-justify-start section-align-start">${rows}</div>
      </section>`;
  }).join('');

  // indeterminate só existe via JS
  for (const slide of SLIDES) {
    const on = slide.items.filter((item) => state.checked.has(item.id)).length;
    const box = dom.mBody.querySelector(`[data-slide="${slide.id}"]`);
    if (box) box.indeterminate = on > 0 && on < slide.items.length;
  }

  dom.mCount.textContent = `${state.checked.size} de ${TOTAL_ITEMS} liberados`;
}

function openModal(user) {
  state.editing = user;
  state.checked = new Set(user.checked);
  dom.mTitle.textContent = `Acessos de ${user.name} (#${user.user_id})`;
  fillCopySelect(user.user_id);
  renderModal();
  Modal.open(dom.modal, { focusSelector: '#mCopyFrom' });
}

/** Ícone "copiar" na lista: abre o modal de outro usuário já com estes acessos. */
async function copyToAnother(source) {
  const target = await pickTargetUser(source);
  if (!target) return;
  openModal(target);
  state.checked = new Set(source.checked);
  renderModal();
  notify(`Acessos de ${source.name} copiados. Confira e clique em Salvar acessos.`, 'success');
}

async function pickTargetUser(source) {
  const { openUsersModalSearch } = await import('/public/modalsSearch/usersModalSearch.js');
  return new Promise((resolve) => {
    openUsersModalSearch({
      onPick: (picked) => {
        const id = picked?.user_id ?? picked?.id;
        if (String(id) === String(source.user_id)) {
          notify('Escolha um usuário diferente do original.', 'warning');
          resolve(null);
          return;
        }
        resolve(state.users.find((u) => String(u.user_id) === String(id)) || null);
      },
    });
  });
}

function copyFromSelected() {
  const source = state.users.find((u) => String(u.user_id) === dom.mCopyFrom.value);
  if (!source) return;
  state.checked = new Set(source.checked);
  renderModal();
}

async function saveModal() {
  if (state.saving || !state.editing) return;

  const user = state.editing;

  if (!state.checked.size) {
    const ok = await confirmCenter(
      `${user.name} não vai ver nenhum indicador na Home. Deseja salvar assim mesmo?`,
      { title: 'Sem nenhum acesso', confirmLabel: 'Salvar' }
    );
    if (!ok) return;
  }

  const dashboards = ITEMS.flatMap((item) =>
    item.keys.map((key) => ({ dashboardKey: key, canView: state.checked.has(item.id) }))
  );

  state.saving = true;
  dom.btnSave.disabled = true;

  try {
    await replaceUserDashboardAccess(user.user_id, dashboards);

    // confere com o que ficou gravado (mesma regra da Home)
    const saved = await listUserDashboardAccess(user.user_id);
    user.checked = itemsFromAllowed(resolveDashboardAccess(saved?.dashboards || []));
    user.summary = summarize(user.checked);

    Modal.close(dom.modal);
    applyFilters();
    notify(`Acessos de ${user.name} salvos. Valem no próximo carregamento da Home.`);
  } catch (error) {
    console.error('[usersDashboardAccess] save', error);
    notify(error?.message || 'Não foi possível salvar os acessos.', 'error');
  } finally {
    state.saving = false;
    dom.btnSave.disabled = false;
  }
}

// ======================================================================
// EVENTS
// ======================================================================

function bindEvents() {
  let typing = null;
  dom.fQ.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { state.page = 1; applyFilters(); }, 200);
  });

  [dom.fSlide, dom.fActive].forEach((el) => el.addEventListener('change', () => {
    state.page = 1;
    applyFilters();
  }));

  dom.btnClear.addEventListener('click', () => {
    dom.fQ.value = '';
    dom.fSlide.value = '';
    dom.fActive.value = 'true';
    state.page = 1;
    applyFilters();
  });

  dom.btnPrevious.addEventListener('click', () => { state.page -= 1; renderList(); });
  dom.btnNext.addEventListener('click', () => { state.page += 1; renderList(); });
  dom.pageSize.addEventListener('change', () => {
    state.pageSize = Number(dom.pageSize.value) || 50;
    state.page = 1;
    renderList();
  });

  dom.tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    const row = event.target.closest('tr[data-user-id]');
    if (!row) return;
    const user = state.users.find((u) => String(u.user_id) === row.dataset.userId);
    if (!user) return;

    if (button?.dataset.act === 'copy-to') copyToAnother(user);
    else openModal(user); // lápis ou clique na linha
  });

  dom.mBody.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.item) {
      if (input.checked) state.checked.add(input.dataset.item);
      else state.checked.delete(input.dataset.item);
    } else if (input.dataset.slide) {
      const slide = SLIDES.find((s) => s.id === input.dataset.slide);
      slide?.items.forEach((item) => {
        if (input.checked) state.checked.add(item.id);
        else state.checked.delete(item.id);
      });
    } else {
      return;
    }
    renderModal();
  });

  dom.mCopyFrom.addEventListener('change', () => {
    dom.btnCopyFrom.disabled = !dom.mCopyFrom.value;
  });
  dom.btnCopyFrom.addEventListener('click', copyFromSelected);

  dom.btnCheckAll.addEventListener('click', () => {
    state.checked = new Set(ITEMS.map((item) => item.id));
    renderModal();
  });
  dom.btnUncheckAll.addEventListener('click', () => {
    state.checked = new Set();
    renderModal();
  });

  dom.btnSave.addEventListener('click', saveModal);
}

// ======================================================================
// INIT
// ======================================================================

async function init() {
  cacheDom();
  Modal.setup();
  bindEvents();

  createSortableTable({
    table: dom.usersTable,
    defaultColumn: state.sortColumn,
    defaultDirection: state.sortDirection,
    allowedColumns: ['user_id', 'name', 'login', ...SLIDES.map((s) => s.id), 'total', 'active'],
    onSort: ({ column, direction }) => {
      state.sortColumn = column;
      state.sortDirection = direction;
      applyFilters();
    },
  });

  await loadList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
