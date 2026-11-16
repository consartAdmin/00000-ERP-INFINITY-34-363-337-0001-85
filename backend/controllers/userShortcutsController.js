// ╔════════════════════════════════════════════════════════════════════╗
// ║ userShortcutsController.js — Meus atalhos de teclado (Home)        ║
// ║ Cada usuário só vê e altera os próprios atalhos (req.user.user_id) ║
// ╚════════════════════════════════════════════════════════════════════╝

import {
  SHORTCUT_ACTIONS,
  BLOCKED_KEYS,
  ALLOWED_KEYS,
  listUserShortcuts,
  findActiveByKey,
  insertUserShortcut,
  updateUserShortcut,
  setUserShortcutActive,
  deleteUserShortcut,
} from '../repositories/userShortcuts/userShortcuts.repository.js';

function currentUserId(req) {
  const id = Number(req.user?.user_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

// Valida e normaliza o corpo do POST/PUT
function parseBody(body = {}) {
  const key_char = String(body.key_char || '').trim().toUpperCase();
  const action = String(body.action || '').trim();
  const label = String(body.label || '').trim().slice(0, 60);
  const is_active = body.is_active !== false && body.is_active !== 'false';
  let module_href = String(body.module_href || '').trim() || null;
  let module_path = String(body.module_path || '').trim().slice(0, 300) || null;

  if (!/^[A-Z]$/.test(key_char)) return { error: 'Escolha uma letra de A a Z.' };
  if (BLOCKED_KEYS.includes(key_char)) {
    return { error: `Ctrl + ${key_char} é usado pelo navegador ou pelo sistema e não pode ser um atalho.` };
  }
  if (!SHORTCUT_ACTIONS[action]) return { error: 'Ação inválida.' };
  if (!label) return { error: 'Informe o texto que aparece no ícone de atalhos.' };

  if (action === 'open_module') {
    // Só links internos do sistema (vindos do menu)
    if (!module_href || !module_href.startsWith('/') || module_href.startsWith('//')) {
      return { error: 'Escolha o módulo que o atalho vai abrir.' };
    }
  } else {
    module_href = null;
    module_path = null;
  }

  return { data: { key_char, action, label, is_active, module_href, module_path } };
}

export async function getShortcutsOptions(req, res) {
  return res.json({ ok: true, actions: SHORTCUT_ACTIONS, allowedKeys: ALLOWED_KEYS, blockedKeys: BLOCKED_KEYS });
}

export async function listMyShortcuts(req, res) {
  const userId = currentUserId(req);
  if (!userId) return fail(res, 401, 'Usuário não identificado.');
  try {
    const onlyActive = String(req.query.active || '') === 'true';
    const data = await listUserShortcuts(userId, { onlyActive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[USER_SHORTCUTS][LIST]', err);
    return fail(res, 500, 'Erro ao carregar os atalhos.');
  }
}

export async function createMyShortcut(req, res) {
  const userId = currentUserId(req);
  if (!userId) return fail(res, 401, 'Usuário não identificado.');
  const { data, error } = parseBody(req.body);
  if (error) return fail(res, 400, error);
  try {
    const used = await findActiveByKey(userId, data.key_char);
    if (used) return fail(res, 409, `Ctrl + ${data.key_char} já está em uso em "${used.label}".`);
    const row = await insertUserShortcut(userId, data);
    return res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error('[USER_SHORTCUTS][CREATE]', err);
    return fail(res, 500, 'Erro ao salvar o atalho.');
  }
}

export async function updateMyShortcut(req, res) {
  const userId = currentUserId(req);
  if (!userId) return fail(res, 401, 'Usuário não identificado.');
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Atalho inválido.');
  const { data, error } = parseBody(req.body);
  if (error) return fail(res, 400, error);
  try {
    const used = await findActiveByKey(userId, data.key_char, id);
    if (used) return fail(res, 409, `Ctrl + ${data.key_char} já está em uso em "${used.label}".`);
    const row = await updateUserShortcut(userId, id, data);
    if (!row) return fail(res, 404, 'Atalho não encontrado.');
    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[USER_SHORTCUTS][UPDATE]', err);
    return fail(res, 500, 'Erro ao salvar o atalho.');
  }
}

export async function toggleMyShortcut(req, res) {
  const userId = currentUserId(req);
  if (!userId) return fail(res, 401, 'Usuário não identificado.');
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Atalho inválido.');
  try {
    const row = await setUserShortcutActive(userId, id, req.body?.is_active === true);
    if (!row) return fail(res, 404, 'Atalho não encontrado.');
    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[USER_SHORTCUTS][TOGGLE]', err);
    return fail(res, 500, 'Erro ao alterar o atalho.');
  }
}

export async function deleteMyShortcut(req, res) {
  const userId = currentUserId(req);
  if (!userId) return fail(res, 401, 'Usuário não identificado.');
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 400, 'Atalho inválido.');
  try {
    const ok = await deleteUserShortcut(userId, id);
    if (!ok) return fail(res, 404, 'Atalho não encontrado.');
    return res.json({ ok: true });
  } catch (err) {
    console.error('[USER_SHORTCUTS][DELETE]', err);
    return fail(res, 500, 'Erro ao excluir o atalho.');
  }
}
