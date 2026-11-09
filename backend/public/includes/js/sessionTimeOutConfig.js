// ============================================================================
// sessionTimeOutConfig.js — timeout de sessão (CONSART ERP)
// Local: /public/includes/js/sessionTimeOutConfig.js (importado pelo core.js)
//
// Tudo vem da tela Configurar Timeout de Sessão (/api/session-config):
//  • Habilitar + Minutos de inatividade: sai do sistema depois de X minutos
//    sem clicar, digitar ou rolar a tela. Reinicia a cada interação.
//  • Validade do login (horas): validade do token gerado no login. Enquanto o
//    usuário usa o sistema, o token é renovado sozinho (/api/session/refresh),
//    então ninguém cai no meio do trabalho.
//  • O contador do rodapé (statusUsuario.js) lê window.__CONSART_STO__.deadline()
//    e mostra o que acontecer primeiro: inatividade ou fim do token.
// ============================================================================

(() => {
  if (window.__CONSART_STO__) return;

  const API = (window.apiBase || '') + '/api/session-config';
  const REFRESH_API = (window.apiBase || '') + '/api/session/refresh';
  const LS_KEY = 'consart.sessionTimeout.cfg';
  const LS_ACTIVITY = 'consart.sessionTimeout.lastActivity';

  const DEFAULTS = {
    enabled: false,
    idle_minutes: 10,
    warn_seconds: 0,
    silent: true,
    redirect_url: '/public/login/login.html',
    token_hours: 2
  };

  const PATH = (location.pathname || '').toLowerCase();
  const IS_LOGIN =
    PATH.endsWith('/login') ||
    PATH.endsWith('/login/') ||
    PATH.includes('/public/login/login.html');

  const merge = (a, b) => Object.assign({}, a, b || {});
  const safeInt = (v, min = -Infinity) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return NaN;
    const f = Math.floor(n);
    return f >= min ? f : NaN;
  };

  const lsGet = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? merge(DEFAULTS, JSON.parse(raw)) : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  };
  const lsSet = c => { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {} };
  const lsClear = () => { try { localStorage.removeItem(LS_KEY); } catch {} };

  // ── Token ────────────────────────────────────────────────────────────────
  const getToken = () =>
    localStorage.getItem('token') ||
    localStorage.getItem('auth_token') ||
    sessionStorage.getItem('token') ||
    sessionStorage.getItem('auth_token');

  const decodeJwt = (token) => {
    try {
      const part = String(token || '').split('.')[1] || '';
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      return JSON.parse(atob(b64));
    } catch {
      return null;
    }
  };

  const tokenTimes = () => {
    const p = decodeJwt(getToken());
    if (!p || !p.exp) return null;
    return { iat: (p.iat || 0) * 1000, exp: p.exp * 1000 };
  };

  const clearTokens = () => {
    ['token', 'auth_token'].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
      try { sessionStorage.removeItem(k); } catch {}
    });
    try { localStorage.removeItem('token_expires_at'); } catch {}
  };

  // Renova quando já passou metade da validade (no máximo 1 tentativa por minuto)
  let lastRefreshTry = 0;
  let refreshing = false;
  const maybeRefreshToken = async () => {
    if (IS_LOGIN || refreshing) return;
    const t = tokenTimes();
    if (!t) return;
    const now = Date.now();
    if (now >= t.exp) return; // já venceu: o rodapé manda para o login
    const life = t.iat ? t.exp - t.iat : 2 * 3600 * 1000;
    if (t.exp - now > life / 2) return;
    if (now - lastRefreshTry < 60 * 1000) return;

    lastRefreshTry = now;
    refreshing = true;
    try {
      const r = await fetch(REFRESH_API, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j && j.token) {
          // grava o token novo nas mesmas chaves que já existiam
          let saved = false;
          [localStorage, sessionStorage].forEach(store => {
            ['token', 'auth_token'].forEach(k => {
              try { if (store.getItem(k) != null) { store.setItem(k, j.token); saved = true; } } catch {}
            });
          });
          if (!saved) localStorage.setItem('token', j.token);
          if (j.expiresAt) localStorage.setItem('token_expires_at', j.expiresAt);
          window.dispatchEvent(new CustomEvent('consart:token-refresh', { detail: { expiresAt: j.expiresAt } }));
        }
      }
    } catch (e) {
      console.warn('[sessionTimeout] não foi possível renovar o login:', e?.message || e);
    } finally {
      refreshing = false;
    }
  };

  // ── Inatividade ──────────────────────────────────────────────────────────
  let cfg = lsGet();
  let warnTimer = null, logoutTimer = null, tickInt = null, isRedirecting = false;
  let lastActivity = Date.now();
  let lastActivityWrite = 0;

  const idleMs = () => {
    const m = safeInt(cfg.idle_minutes, 1);
    return Number.isFinite(m) ? m * 60 * 1000 : NaN;
  };

  const clearTimers = () => {
    if (warnTimer) { clearTimeout(warnTimer); warnTimer = null; }
    if (logoutTimer) { clearTimeout(logoutTimer); logoutTimer = null; }
    if (tickInt) { clearInterval(tickInt); tickInt = null; }
  };

  const showWarn = () => {
    let box = document.getElementById('session-warning');
    if (!box) {
      box = document.createElement('div');
      box.id = 'session-warning';
      box.style.cssText = [
        'position:fixed;right:16px;bottom:48px;z-index:9999',
        'background:#111827;color:#fff;padding:12px 14px',
        'border-radius:10px;box-shadow:0 10px 24px rgba(0,0,0,.25)',
        'display:flex;gap:10px;align-items:center'
      ].join(';');
      box.innerHTML =
        'Sessão expira em <strong id="sw-ct"></strong>s ' +
        '<button id="sw-stay" class="btn">Continuar</button>';
      document.body.appendChild(box);
      document.getElementById('sw-stay').addEventListener('click', () => { hideWarn(); onActivity(); }, { passive: true });
    }

    let remaining = safeInt(cfg.warn_seconds, 0);
    if (!Number.isFinite(remaining) || remaining < 0) remaining = 0;
    const ct = document.getElementById('sw-ct');
    ct.textContent = String(remaining);
    if (tickInt) clearInterval(tickInt);
    tickInt = setInterval(() => {
      remaining -= 1;
      ct.textContent = String(Math.max(0, remaining));
      if (remaining <= 0) { clearInterval(tickInt); tickInt = null; }
    }, 1000);
    box.style.display = 'flex';
  };

  const hideWarn = () => {
    const box = document.getElementById('session-warning');
    if (box) box.style.display = 'none';
    if (tickInt) { clearInterval(tickInt); tickInt = null; }
  };

  const redirect = () => {
    if (isRedirecting || IS_LOGIN) return;
    isRedirecting = true;
    try { hideWarn(); } catch {}
    clearTokens(); // sem isso a tela de login podia voltar direto para o sistema
    const url = cfg.redirect_url || DEFAULTS.redirect_url;
    const sep = url.includes('?') ? '&' : '?';
    setTimeout(() => { location.href = `${url}${sep}expired=1`; }, 10);
  };

  // (Re)agenda aviso e saída a partir da última atividade (desta ou de outra aba)
  const schedule = () => {
    clearTimers();
    if (!cfg.enabled || IS_LOGIN) return;
    const total = idleMs();
    if (!Number.isFinite(total)) return;

    const left = total - Math.max(0, Date.now() - lastActivity);
    const warnOk = safeInt(cfg.warn_seconds, 0);
    const warnMs = Number.isFinite(warnOk) ? warnOk * 1000 : 0;

    if (warnMs > 0 && !cfg.silent && warnMs < total && left > warnMs) {
      warnTimer = setTimeout(() => { try { showWarn(); } catch {} }, left - warnMs);
    }
    logoutTimer = setTimeout(() => {
      // outra aba pode ter tido atividade nesse meio-tempo
      if (Date.now() - lastActivity < total - 500) { schedule(); return; }
      try { if (!cfg.silent) alert('Sessão expirada!'); } catch {}
      redirect();
    }, Math.max(0, left));
  };

  const onActivity = () => {
    lastActivity = Date.now();
    // compartilha a atividade entre abas e tenta renovar o token (no máximo a cada 5s)
    if (lastActivity - lastActivityWrite > 5000) {
      lastActivityWrite = lastActivity;
      try { localStorage.setItem(LS_ACTIVITY, String(lastActivity)); } catch {}
      maybeRefreshToken();
    }
    schedule();
  };

  ['click', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach(ev => {
    document.addEventListener(ev, onActivity, { capture: true, passive: true });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onActivity(); });

  window.addEventListener('storage', e => {
    try {
      if (!e) return;
      if (e.key === LS_KEY || e.key == null) { cfg = lsGet(); schedule(); }
      if (e.key === LS_ACTIVITY) {
        const t = Number(e.newValue);
        if (Number.isFinite(t) && t > lastActivity) { lastActivity = t; schedule(); }
      }
    } catch (err) { console.warn('[sessionTimeout] storage handler falhou', err); }
  });

  window.__CONSART_STO__ = {
    get cfg() { return cfg; },
    /** Quando a sessão termina (ms) e por quê: 'idle' | 'token' | null */
    deadline() {
      const t = tokenTimes();
      const tokenEnd = t ? t.exp : null;
      const total = idleMs();
      const idleEnd = cfg.enabled && !IS_LOGIN && Number.isFinite(total) ? lastActivity + total : null;
      if (idleEnd != null && (tokenEnd == null || idleEnd <= tokenEnd)) return { at: idleEnd, reason: 'idle' };
      if (tokenEnd != null) return { at: tokenEnd, reason: 'token' };
      return { at: null, reason: null };
    },
    /** Usado pela tela de configuração depois de Salvar */
    apply(next) { cfg = merge(DEFAULTS, next); lsSet(cfg); schedule(); },
    disable() { cfg.enabled = false; lsSet(cfg); clearTimers(); hideWarn(); },
    enable(mins = 10) { cfg.enabled = true; cfg.idle_minutes = safeInt(mins, 1); lsSet(cfg); schedule(); },
    clearLS() { lsClear(); }
  };

  if (IS_LOGIN) return;

  (async () => {
    try {
      const r = await fetch(API, { credentials: 'include', cache: 'no-store' });
      if (r.ok) {
        const s = await r.json();
        cfg = merge(DEFAULTS, {
          enabled: !!s.enabled,
          idle_minutes: safeInt(s.idle_minutes, 1),
          warn_seconds: safeInt(s.warn_seconds, 0),
          silent: !!s.silent,
          redirect_url: s.redirect_url || DEFAULTS.redirect_url,
          token_hours: safeInt(s.token_hours, 1) || DEFAULTS.token_hours
        });
        lsSet(cfg);
      }
    } catch (e) { console.warn('[sessionTimeout] erro buscando configuração:', e?.message || e); }
    schedule();
    maybeRefreshToken();
  })();
})();
