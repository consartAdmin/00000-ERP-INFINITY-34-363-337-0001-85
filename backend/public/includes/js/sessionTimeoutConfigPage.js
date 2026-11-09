// ╔════════════════════════════════════════════════════════════════════╗
// ║ sessionTimeoutConfigPage.js — tela Configurar Timeout de Sessão    ║
// ║ Carrega e salva /api/session-config (PUT só administrador) e       ║
// ║ aplica na hora nesta aba (sessionTimeOutConfig.js / rodapé).       ║
// ╚════════════════════════════════════════════════════════════════════╝

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const API = (window.apiBase || '') + '/api/session-config';

const DEFAULTS = {
  enabled: false,
  idle_minutes: 10,
  warn_seconds: 0,
  silent: true,
  redirect_url: '/public/login/login.html',
  token_hours: 2
};

const $ = (id) => document.getElementById(id);

const getToken = () =>
  localStorage.getItem('token') ||
  localStorage.getItem('auth_token') ||
  sessionStorage.getItem('token') ||
  sessionStorage.getItem('auth_token');

function fillForm(cfg) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  $('enabled').checked = !!c.enabled;
  $('idleMinutes').value = c.idle_minutes;
  $('warnSeconds').value = c.warn_seconds;
  $('silent').checked = !!c.silent;
  $('tokenHours').value = c.token_hours;
  toggleIdleFields();

  const upd = $('stoUpdated');
  if (c.updated_at) {
    const quando = new Date(c.updated_at).toLocaleString('pt-BR');
    upd.textContent = `Última alteração: ${quando}${c.updated_by ? ` por ${c.updated_by}` : ''}`;
  } else {
    upd.textContent = '';
  }
}

function toggleIdleFields() {
  const on = $('enabled').checked;
  ['idleMinutes', 'warnSeconds', 'silent'].forEach(id => { $(id).disabled = !on; });
}

function readForm() {
  const toInt = (v) => Math.floor(Number(v));
  return {
    enabled: $('enabled').checked,
    idle_minutes: toInt($('idleMinutes').value),
    warn_seconds: toInt($('warnSeconds').value || 0),
    silent: $('silent').checked,
    token_hours: toInt($('tokenHours').value)
  };
}

function validate(c) {
  if (!Number.isFinite(c.idle_minutes) || c.idle_minutes < 1) return 'Informe os minutos de inatividade (mínimo 1).';
  if (!Number.isFinite(c.warn_seconds) || c.warn_seconds < 0) return 'O aviso deve ser 0 ou mais segundos.';
  if (c.warn_seconds >= c.idle_minutes * 60) return 'O aviso precisa ser menor que o tempo de inatividade.';
  if (!Number.isFinite(c.token_hours) || c.token_hours < 1 || c.token_hours > 24) return 'A validade do login deve ficar entre 1 e 24 horas.';
  if (c.enabled && c.idle_minutes > c.token_hours * 60) {
    return 'A inatividade não pode ser maior que a validade do login.';
  }
  return null;
}

async function load() {
  try {
    const r = await fetch(API, { cache: 'no-store', credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    fillForm(await r.json());
  } catch (e) {
    fillForm(DEFAULTS);
    showCenterModal({ variant: 'error', title: 'Timeout de Sessão', message: `Não foi possível carregar a configuração (${e.message}).` });
  }
}

async function save(ev) {
  ev?.preventDefault();
  const cfg = readForm();
  const erro = validate(cfg);
  if (erro) {
    showCenterModal({ variant: 'warning', title: 'Verifique os campos', message: erro });
    return;
  }

  const btn = $('save');
  btn.disabled = true;
  try {
    const r = await fetch(API, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
      body: JSON.stringify(cfg)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      const msg = r.status === 403
        ? 'Só administradores podem alterar o timeout de sessão.'
        : (j.error || j.message || `Erro ${r.status} ao salvar.`);
      throw new Error(msg);
    }
    fillForm(j.data || cfg);
    window.__CONSART_STO__?.apply?.(j.data || cfg);
    showCenterModal({
      variant: 'success',
      title: 'Configuração salva',
      message: 'A inatividade vale na hora em todas as abas. A nova validade do login vale a partir da próxima renovação ou login.'
    });
  } catch (e) {
    showCenterModal({ variant: 'error', title: 'Não foi possível salvar', message: e.message });
  } finally {
    btn.disabled = false;
  }
}

$('enabled').addEventListener('change', toggleIdleFields);
$('stoForm').addEventListener('submit', save);
$('reset').addEventListener('click', () => fillForm(DEFAULTS));

load();
