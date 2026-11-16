// ╔══════════════════════════════════════════════════════════════════════╗
// ║ userShortcuts.js — Meus Atalhos de Teclado (Frontend) | CONSART ERP  ║
// ║ - Consome /api/user-shortcuts (só os atalhos do usuário logado)      ║
// ║ - Módulos do modal vêm do menu (/api/module-system/menu), filtrados  ║
// ║   pelas permissões do usuário (/api/user-modules/:id/modulos)        ║
// ║ - Cadastro/edição em modal (modal.js), ações com actionIcons.js,     ║
// ║   avisos/confirmações no centerAlertModal.js                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const API = '/api/user-shortcuts';

const ACTION_LABELS = {
  open_module: 'Abrir módulo',
  product_search: 'Buscar produto',
  customer_search: 'Buscar cliente',
};

const state = {
  rows: [],
  modules: [],          // [{ href, path }]
  allowedKeys: [],
  blockedKeys: [],
};

// ======================================================================
// HELPERS
// ======================================================================

const $ = (selector) => document.querySelector(selector);

function getToken() {
  return localStorage.getItem('token') || localStorage.getItem('auth_token') || '';
}

function getUserId() {
  try {
    const payload = JSON.parse(atob(getToken().split('.')[1]));
    return payload.userId || payload.usuarioId || payload.user_id || payload.id || null;
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  let data = null;
  const text = await res.text().catch(() => '');
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }

  if (!res.ok || data?.ok === false) {
    const err = new Error(data?.error || data?.message || `Falha na requisição (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function notify(message, variant = 'success') {
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Meus atalhos'),
    message: String(message ?? ''),
    timeoutMs: variant === 'success' ? 2000 : undefined,
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

function destinationText(row) {
  if (row.action === 'product_search') return 'Janela de busca de produtos';
  if (row.action === 'customer_search') return 'Janela de busca de clientes';
  return row.module_path || row.module_href || '—';
}

// ======================================================================
// MÓDULOS (do menu, só os que o usuário pode acessar)
// ======================================================================

function flattenMenu(items, parentPath = '') {
  return (items || []).flatMap((item) => {
    const path = parentPath ? `${parentPath} › ${item.label}` : item.label;
    const current = item.type === 'link' && item.href && !item.external
      ? [{ id: item.id != null ? String(item.id) : null, href: String(item.href).trim(), path }]
      : [];
    return item.children ? current.concat(flattenMenu(item.children, path)) : current;
  });
}

// Tira emojis e setas antigas do nome que vem da "Criação de Módulos"
function cleanPath(path) {
  return String(path)
    .split(' › ')
    .map((part) => part.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/[▹▸]/g, '').trim())
    .filter(Boolean)
    .join(' › ');
}

async function loadModules() {
  const menu = await fetchJson('/api/module-system/menu').catch(() => null);
  let links = flattenMenu(menu?.data || []).filter((l) => l.href.startsWith('/'));

  // Esconde os módulos que o usuário não pode acessar (itens públicos vêm com id null)
  const userId = getUserId();
  if (userId) {
    try {
      // Mesma rota e mesmas regras do securityModules.js (modulo_id + flag de acesso)
      const perms = await fetchJson(`/api/user-modules/${encodeURIComponent(userId)}/modulos`);
      const items = Array.isArray(perms) ? perms : (perms?.rows || perms?.data || []);
      const allowed = new Set(items
        .filter((m) => (m?.permitido ?? m?.pode_acessar ?? m?.can_access ?? true))
        .map((m) => String(m?.modulo_id ?? m?.module_id ?? m?.moduloId ?? '')).filter(Boolean));
      links = links.filter((l) => l.id == null || allowed.has(l.id));
    } catch (err) {
      console.warn('[USER_SHORTCUTS] Permissões não carregadas; mostrando todos os módulos.', err);
    }
  }

  const seen = new Set();
  state.modules = links
    .map((l) => ({ href: l.href, path: cleanPath(l.path) }))
    .filter((l) => (seen.has(l.href) ? false : seen.add(l.href)))
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
}

function fillModuleSelect(selectedHref = '', selectedPath = '') {
  const options = state.modules.slice();
  if (selectedHref && !options.some((m) => m.href === selectedHref)) {
    options.unshift({ href: selectedHref, path: selectedPath || selectedHref });
  }
  $('#shortcutModule').innerHTML = '<option value="">Selecione o módulo...</option>' +
    options.map((m) => `<option value="${escapeHtml(m.href)}" data-path="${escapeHtml(m.path)}"${m.href === selectedHref ? ' selected' : ''}>${escapeHtml(m.path)}</option>`).join('');
}

// ======================================================================
// LISTA
// ======================================================================

function filteredRows() {
  const term = $('#shortcutsSearch').value.trim().toLocaleLowerCase('pt-BR');
  const status = $('#shortcutsStatus').value;
  return state.rows.filter((r) => {
    if (status === 'active' && !r.is_active) return false;
    if (status === 'inactive' && r.is_active) return false;
    if (!term) return true;
    return [`ctrl + ${r.key_char}`, r.key_char, ACTION_LABELS[r.action], destinationText(r), r.label]
      .some((v) => String(v || '').toLocaleLowerCase('pt-BR').includes(term));
  });
}

function renderTable() {
  const rows = filteredRows();
  const tbody = $('#shortcutsTableBody');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty-state">Nenhum atalho encontrado.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((r) => {
      const actions = actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': r.id } },
        r.is_active
          ? { action: 'pause', title: 'Desativar', attrs: { 'data-act': 'toggle', 'data-id': r.id } }
          : { action: 'play', title: 'Ativar', attrs: { 'data-act': 'toggle', 'data-id': r.id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': r.id } },
      ]);
      const status = r.is_active
        ? '<span class="summary-pill summary-pill--success">Ativo</span>'
        : '<span class="summary-pill summary-pill--danger">Inativo</span>';
      return `
        <tr data-id="${r.id}">
          <td><span class="summary-pill summary-pill--info"><b>Ctrl + ${escapeHtml(r.key_char)}</b></span></td>
          <td>${escapeHtml(ACTION_LABELS[r.action] || r.action)}</td>
          <td class="td-left">${escapeHtml(destinationText(r))}</td>
          <td class="td-left">${escapeHtml(r.label)}</td>
          <td>${status}</td>
          <td>${actions}</td>
        </tr>`;
    }).join('');
  }

  const active = state.rows.filter((r) => r.is_active).length;
  $('#shortcutsInfo').textContent =
    `${state.rows.length} atalho${state.rows.length === 1 ? '' : 's'} · ${active} ativo${active === 1 ? '' : 's'}`;
}

async function loadShortcuts() {
  try {
    const payload = await fetchJson(API);
    state.rows = payload?.data || [];
  } catch (err) {
    state.rows = [];
    notify(err.message, 'error');
  }
  renderTable();
}

// ======================================================================
// MODAL
// ======================================================================

function usedKeys(exceptId) {
  return new Map(state.rows.filter((r) => String(r.id) !== String(exceptId)).map((r) => [r.key_char, r.label]));
}

function fillKeySelect(selected = '', exceptId = null) {
  const used = usedKeys(exceptId);
  $('#shortcutKey').innerHTML = state.allowedKeys.map((k) => {
    const busy = used.get(k);
    return `<option value="${k}"${k === selected ? ' selected' : ''}${busy ? ' disabled' : ''}>Ctrl + ${k}${busy ? ` (em uso: ${escapeHtml(busy)})` : ''}</option>`;
  }).join('');
  if (!selected) {
    const free = state.allowedKeys.find((k) => !used.has(k));
    if (free) $('#shortcutKey').value = free;
  }
}

function syncActionFields() {
  const isModule = $('#shortcutAction').value === 'open_module';
  $('#shortcutModuleField').hidden = !isModule;
  $('#shortcutModule').required = isModule;
}

function updatePreview() {
  const key = $('#shortcutKey').value || '?';
  const label = $('#shortcutLabel').value.trim() || '...';
  $('#shortcutPreview').textContent = `Prévia: Ctrl + ${key} · ${label}`;
}

// Sugere o texto do ícone a partir da ação/módulo, se o usuário ainda não digitou
function suggestLabel() {
  const input = $('#shortcutLabel');
  if (input.dataset.touched === '1') return;
  const action = $('#shortcutAction').value;
  if (action === 'product_search') input.value = 'Buscar produto';
  else if (action === 'customer_search') input.value = 'Buscar cliente';
  else {
    const opt = $('#shortcutModule').selectedOptions[0];
    const last = opt?.dataset.path ? opt.dataset.path.split(' › ').pop() : '';
    input.value = last ? `Abrir ${last}`.slice(0, 40) : '';
  }
  updatePreview();
}

function openModal(row = null) {
  $('#shortcutForm').reset();
  $('#shortcutId').value = row?.id || '';
  $('#shortcutModalTitle').textContent = row ? 'Editar atalho' : 'Novo atalho';
  fillKeySelect(row?.key_char || '', row?.id || null);
  $('#shortcutAction').value = row?.action || 'open_module';
  fillModuleSelect(row?.module_href || '', row?.module_path || '');
  $('#shortcutLabel').value = row?.label || '';
  $('#shortcutLabel').dataset.touched = row ? '1' : '0';
  $('#shortcutStatus').value = row ? String(row.is_active) : 'true';
  syncActionFields();
  updatePreview();
  Modal.open('shortcutModal', { focusSelector: '#shortcutKey' });
}

async function submitShortcut(event) {
  event.preventDefault();

  const id = $('#shortcutId').value;
  const action = $('#shortcutAction').value;
  const moduleOpt = $('#shortcutModule').selectedOptions[0];
  const body = {
    key_char: $('#shortcutKey').value,
    action,
    module_href: action === 'open_module' ? $('#shortcutModule').value : null,
    module_path: action === 'open_module' ? (moduleOpt?.dataset.path || '') : null,
    label: $('#shortcutLabel').value.trim(),
    is_active: $('#shortcutStatus').value === 'true',
  };

  if (!body.key_char) return notify('Escolha a tecla do atalho.', 'warning');
  if (action === 'open_module' && !body.module_href) return notify('Escolha o módulo que o atalho vai abrir.', 'warning');
  if (!body.label) return notify('Informe o texto que aparece no ícone de atalhos.', 'warning');

  try {
    await fetchJson(id ? `${API}/${id}` : API, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    Modal.close('shortcutModal');
    notify(`Atalho Ctrl + ${body.key_char} salvo.`);
    await loadShortcuts();
  } catch (err) {
    notify(err.message, 'error');
  }
}

// ======================================================================
// AÇÕES DA LINHA
// ======================================================================

async function onTableClick(event) {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  const row = state.rows.find((r) => String(r.id) === String(btn.dataset.id));
  if (!row) return;

  if (btn.dataset.act === 'edit') return openModal(row);

  if (btn.dataset.act === 'toggle') {
    try {
      await fetchJson(`${API}/${row.id}/active`, { method: 'PATCH', body: JSON.stringify({ is_active: !row.is_active }) });
      await loadShortcuts();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (btn.dataset.act === 'delete') {
    const ok = await confirmCenter(`Excluir o atalho Ctrl + ${row.key_char} (${row.label})?`, {
      title: 'Excluir atalho', confirmLabel: 'Excluir', variant: 'warning',
    });
    if (!ok) return;
    try {
      await fetchJson(`${API}/${row.id}`, { method: 'DELETE' });
      notify('Atalho excluído.');
      await loadShortcuts();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
}

// ======================================================================
// INIT
// ======================================================================

async function init() {
  Modal.setup();

  try {
    const opts = await fetchJson(`${API}/options`);
    state.allowedKeys = opts.allowedKeys || [];
    state.blockedKeys = opts.blockedKeys || [];
  } catch (err) {
    notify(err.message, 'error');
  }
  $('#shortcutBlockedHint').textContent = state.blockedKeys.length
    ? `Ctrl + ${state.blockedKeys.join(', ')} não podem ser usadas (são do navegador, da edição ou da busca do menu).`
    : '';

  $('#btnNewShortcut').addEventListener('click', () => openModal());
  $('#shortcutsSearch').addEventListener('input', renderTable);
  $('#shortcutsStatus').addEventListener('change', renderTable);
  $('#shortcutsTableBody').addEventListener('click', onTableClick);
  $('#shortcutForm').addEventListener('submit', submitShortcut);
  $('#shortcutKey').addEventListener('change', updatePreview);
  $('#shortcutAction').addEventListener('change', () => { syncActionFields(); suggestLabel(); });
  $('#shortcutModule').addEventListener('change', suggestLabel);
  $('#shortcutLabel').addEventListener('input', (e) => { e.target.dataset.touched = '1'; updatePreview(); });

  await Promise.all([loadModules(), loadShortcuts()]);
}

init();
