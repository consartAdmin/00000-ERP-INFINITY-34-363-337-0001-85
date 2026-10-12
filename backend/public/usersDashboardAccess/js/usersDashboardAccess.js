// ╔══════════════════════════════════════════════════════════════════════╗
// ║ usersDashboardAccess.js — Dashboard permission management frontend  ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { DASHBOARDS } from './usersDashboardAccess.config.js';

import {
  listUserDashboardAccess,
  replaceUserDashboardAccess,
} from './usersDashboardAccess.api.js';

import { openUsersModalSearch } from '/public/modalsSearch/usersModalSearch.js';

const state = {
  userId: null,
  permissions: new Map(),
  loaded: false,
  loading: false,
  saving: false,
};

const elements = {};

function cacheElements() {
  elements.userId = document.getElementById('udaUserId');
  elements.userName = document.getElementById('udaUserName');
  elements.searchUserButton = document.getElementById('udaSearchUserButton');
  elements.loadButton = document.getElementById('udaLoadButton');
  elements.selectAllButton = document.getElementById('udaSelectAllButton');
  elements.clearAllButton = document.getElementById('udaClearAllButton');
  elements.saveButton = document.getElementById('udaSaveButton');
  elements.status = document.getElementById('udaStatus');
  elements.tableBody = document.getElementById('udaTableBody');
}

function setStatus(message = '', type = 'info') {
  elements.status.textContent = message;

  if (message) {
    elements.status.dataset.type = type;
  } else {
    delete elements.status.dataset.type;
  }
}

function parseUserId() {
  const value = Number.parseInt(elements.userId.value, 10);

  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function openUserSearch() {
  openUsersModalSearch({
    onPick: (user) => {
      const id = user?.user_id ?? user?.id ?? null;

      if (!id) {
        setStatus(
          'Usuário sem ID retornado pela busca.',
          'error'
        );
        return;
      }

      elements.userId.value = String(id);
      elements.userName.value =
        user.name ??
        user.full_name ??
        user.display_name ??
        user.username ??
        '';

      loadPermissions();
    },
  });
}

function setActionsEnabled(enabled) {
  elements.selectAllButton.disabled = !enabled;
  elements.clearAllButton.disabled = !enabled;
  elements.saveButton.disabled = !enabled;
}

function renderTable() {
  elements.tableBody.innerHTML = DASHBOARDS
    .map((dashboard) => {
      const checked =
        state.permissions.get(dashboard.key) === true
          ? 'checked'
          : '';

      return `
        <tr>
          <td>
            <strong>${dashboard.label}</strong>
          </td>

          <td>
            <span class="uda-key">
              ${dashboard.key}
            </span>
          </td>

          <td class="uda-access-cell">
            <input
              class="uda-switch"
              type="checkbox"
              data-dashboard-key="${dashboard.key}"
              ${checked}
              ${state.loaded ? '' : 'disabled'}
              aria-label="Acesso: ${dashboard.label}"
            />
          </td>
        </tr>
      `;
    })
    .join('');
}

function syncStateFromCheckboxes() {
  elements.tableBody
    .querySelectorAll('[data-dashboard-key]')
    .forEach((input) => {
      state.permissions.set(
        input.dataset.dashboardKey,
        input.checked
      );
    });
}

function applyAll(value) {
  elements.tableBody
    .querySelectorAll('[data-dashboard-key]')
    .forEach((input) => {
      input.checked = value;
    });

  syncStateFromCheckboxes();
}

async function loadPermissions() {
  if (state.loading) return;

  const userId = parseUserId();

  if (!userId) {
    setStatus(
      'Informe um ID de usuário válido.',
      'error'
    );

    elements.userId.focus();
    return;
  }

  state.loading = true;
  state.loaded = false;
  state.userId = userId;
  state.permissions = new Map();

  setActionsEnabled(false);
  renderTable();

  elements.loadButton.disabled = true;

  setStatus(
    `Carregando acessos do usuário ${userId}...`,
    'info'
  );

  try {
    const result =
      await listUserDashboardAccess(userId);

    const rows = Array.isArray(result?.dashboards)
      ? result.dashboards
      : [];

    for (const dashboard of DASHBOARDS) {
      state.permissions.set(
        dashboard.key,
        false
      );
    }

    for (const item of rows) {
      if (!item?.dashboardKey) continue;

      state.permissions.set(
        item.dashboardKey,
        item.canView === true
      );
    }

    state.loaded = true;

    renderTable();
    setActionsEnabled(true);

    setStatus(
      `Acessos do usuário ${userId} carregados.`,
      'success'
    );
  } catch (error) {
    console.error(
      '[usersDashboardAccess] loadPermissions:',
      error
    );

    state.loaded = false;
    renderTable();

    setStatus(
      error?.message ||
        'Não foi possível carregar os acessos.',
      'error'
    );
  } finally {
    state.loading = false;
    elements.loadButton.disabled = false;
  }
}

async function savePermissions() {
  if (
    state.saving ||
    !state.loaded ||
    !state.userId
  ) {
    return;
  }

  syncStateFromCheckboxes();

  const dashboards = DASHBOARDS.map(
    (dashboard) => ({
      dashboardKey: dashboard.key,
      canView:
        state.permissions.get(dashboard.key) === true,
    })
  );

  state.saving = true;
  setActionsEnabled(false);

  setStatus(
    `Salvando acessos do usuário ${state.userId}...`,
    'info'
  );

  try {
    await replaceUserDashboardAccess(
      state.userId,
      dashboards
    );

    setStatus(
      'Acessos aos dashboards salvos com sucesso.',
      'success'
    );
  } catch (error) {
    console.error(
      '[usersDashboardAccess] savePermissions:',
      error
    );

    setStatus(
      error?.message ||
        'Não foi possível salvar os acessos.',
      'error'
    );
  } finally {
    state.saving = false;
    setActionsEnabled(true);
  }
}

function bindEvents() {
  elements.loadButton.addEventListener(
    'click',
    loadPermissions
  );

  elements.saveButton.addEventListener(
    'click',
    savePermissions
  );

  elements.selectAllButton.addEventListener(
    'click',
    () => applyAll(true)
  );

  elements.clearAllButton.addEventListener(
    'click',
    () => applyAll(false)
  );

  elements.searchUserButton.addEventListener(
    'click',
    openUserSearch
  );

  // Typing an ID manually invalidates the name picked in the modal.
  elements.userId.addEventListener(
    'input',
    () => {
      elements.userName.value = '';
    }
  );

  elements.userId.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadPermissions();
      }
    }
  );

  elements.tableBody.addEventListener(
    'change',
    (event) => {
      const input =
        event.target.closest('[data-dashboard-key]');

      if (!input) return;

      state.permissions.set(
        input.dataset.dashboardKey,
        input.checked
      );
    }
  );
}

function init() {
  cacheElements();
  renderTable();
  bindEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    init
  );
} else {
  init();
}
