// ╔══════════════════════════════════════════════════════════════════════╗
// ║ sellersModalSearch.js — Modal CONSART para buscar VENDEDORES         ║
// ║ exporta: openSellersModalSearch({ apiBase, onPick(seller), opts })   ║
// ╚══════════════════════════════════════════════════════════════════════╝

export function openSellersModalSearch({ apiBase = '', onPick, opts = {} } = {}) {
  apiBase = String(apiBase || '').replace(/\/$/, '');

  const cfg = {
    title: '🔎 Buscar Vendedor',
    placeholder: 'Digite nome, ID, documento…',
    hint: 'Use ↑↓ e Enter para selecionar. ESC fecha.',
    limit: 50,
    ...opts,
  };

  const esc = (v) => String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function resolveBase() {
    return apiBase && apiBase.trim()
      ? apiBase.replace(/\/$/, '')
      : window.location.origin;
  }

  async function fetchJSON(url) {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'include'
    });

    const t = await r.text();

    if (!r.ok) {
      throw new Error(`${r.status} ${r.statusText}: ${t}`);
    }

    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }

  function normalizeRows(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    return data.rows || data.data || data.items || data.result || [];
  }

  function pickSellerId(s) {
    return s?.seller_id ?? s?.id ?? s?.sellerId ?? s?.vendedor_id ?? s?.vendedorId ?? null;
  }

  function pickName(s) {
    return s?.name ?? s?.nome ?? s?.full_name ?? s?.fullName ?? s?.apelido ?? s?.nickname ?? '';
  }

  function pickDoc(s) {
    return s?.cpf ?? s?.cnpj ?? s?.document ?? s?.doc ?? s?.tax_id ?? '';
  }

  const overlay = document.createElement('div');
  overlay.className = 'sms-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'sms-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  dialog.innerHTML = `
    <div class="sms-header">
      <strong class="sms-title">${esc(cfg.title)}</strong>
      <span class="sms-hint-top">ESC para fechar</span>
      <button id="sms-close" class="sms-close" type="button" aria-label="Fechar" title="Fechar">×</button>
    </div>

    <div class="sms-searchbar">
      <input id="sms-q" class="sms-input" type="text" placeholder="${esc(cfg.placeholder)}" />
      <button id="sms-btn" class="sms-button" type="button">Buscar</button>
    </div>

    <div class="sms-hint">${esc(cfg.hint)}</div>

    <div class="sms-table-wrap">
      <table class="sms-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nome</th>
            <th>Documento</th>
          </tr>
        </thead>
        <tbody id="sms-tbody"></tbody>
      </table>
    </div>

    <div id="sms-status" class="sms-status">Digite para buscar vendedores.</div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const $ = (sel) => dialog.querySelector(sel);
  const q = $('#sms-q');
  const btn = $('#sms-btn');
  const tbody = $('#sms-tbody');
  const status = $('#sms-status');

  let rows = [];
  let activeIndex = -1;
  let destroyed = false;

  function close() {
    destroyed = true;
    overlay.remove();
    document.removeEventListener('keydown', handleGlobalKeydown, true);
  }

  function setStatus(text) {
    if (status) status.textContent = text || '';
  }

  function setActiveRow(idx) {
    activeIndex = idx;

    const trs = tbody.querySelectorAll('tr[data-idx]');
    trs.forEach((tr) => {
      const i = Number(tr.dataset.idx);
      tr.classList.toggle('active', i === activeIndex);
    });

    const tr = tbody.querySelector(`tr[data-idx="${activeIndex}"]`);
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }

  function renderTable() {
    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="sms-empty">Nenhum resultado.</td>
        </tr>
      `;
      activeIndex = -1;
      return;
    }

    tbody.innerHTML = rows.map((s, idx) => {
      const id = pickSellerId(s);
      const nome = pickName(s);
      const doc = pickDoc(s);

      return `
        <tr class="sms-row" data-idx="${idx}">
          <td>${esc(id ?? '')}</td>
          <td class="sms-name">${esc(nome || '—')}</td>
          <td>${esc(doc || '')}</td>
        </tr>
      `;
    }).join('');

    setActiveRow(0);
  }

  async function tryEndpoints(term) {
    const base = resolveBase();

    const candidates = [
      ['/api/sellers/search', { q: term, limit: String(cfg.limit), offset: '0' }],
      ['/api/sellers', { q: term, limit: String(cfg.limit), offset: '0' }],
      ['/api/sellers', { search: term, limit: String(cfg.limit), offset: '0' }],
      ['/api/vendedores/search', { q: term, limit: String(cfg.limit), offset: '0' }],
      ['/api/vendedores', { q: term, limit: String(cfg.limit), offset: '0' }],
      ['/api/vendedores', { search: term, limit: String(cfg.limit), offset: '0' }],
      ['/api/salesmen/search', { q: term, limit: String(cfg.limit), offset: '0' }],
      ['/api/salesmen', { q: term, limit: String(cfg.limit), offset: '0' }],
    ];

    let lastErr = null;

    for (const [path, params] of candidates) {
      try {
        const url = new URL(path, base);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

        const data = await fetchJSON(url.toString());
        const r = normalizeRows(data);

        if (Array.isArray(r)) return r;
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error('Nenhum endpoint respondeu.');
  }

  async function buscar() {
    const term = (q.value || '').trim();

    if (!term) {
      rows = [];
      tbody.innerHTML = '';
      setStatus('Informe um termo de busca.');
      return;
    }

    setStatus('Pesquisando…');

    try {
      const result = await tryEndpoints(term);
      if (destroyed) return;

      rows = result || [];
      renderTable();
      setStatus(rows.length ? `${rows.length} vendedor(es) encontrado(s).` : 'Nenhum resultado encontrado.');
    } catch (e) {
      console.error('[sellersModalSearch] erro ao buscar vendedores:', e);
      rows = [];
      renderTable();
      setStatus('Erro ao buscar vendedores. Verifique os endpoints no backend.');
    }
  }

  function pickIndex(idx) {
    const s = rows[idx];
    if (!s) return;

    try {
      if (typeof onPick === 'function') onPick(s);
    } finally {
      close();
    }
  }

  function handleGlobalKeydown(ev) {
    if (destroyed) return;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
      return;
    }

    if (ev.key === 'Enter' && document.activeElement !== q) {
      if (activeIndex >= 0) {
        ev.preventDefault();
        pickIndex(activeIndex);
      }
      return;
    }

    if (ev.key === 'ArrowDown' && document.activeElement !== q) {
      if (!rows.length) return;
      ev.preventDefault();
      setActiveRow(Math.min(activeIndex + 1, rows.length - 1));
      return;
    }

    if (ev.key === 'ArrowUp' && document.activeElement !== q) {
      if (!rows.length) return;
      ev.preventDefault();
      setActiveRow(Math.max(activeIndex - 1, 0));
    }
  }

  $('#sms-close')?.addEventListener('click', close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  btn?.addEventListener('click', buscar);

  q?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      buscar();
      return;
    }

    if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
      return;
    }

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (!rows.length) return;
      setActiveRow(Math.min(activeIndex + 1, rows.length - 1));
      return;
    }

    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!rows.length) return;
      setActiveRow(Math.max(activeIndex - 1, 0));
    }
  });

  tbody?.addEventListener('mousemove', (ev) => {
    const tr = ev.target.closest('tr[data-idx]');
    if (!tr) return;

    const idx = Number(tr.dataset.idx);
    if (!Number.isNaN(idx)) setActiveRow(idx);
  });

  tbody?.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-idx]');
    if (!tr) return;

    pickIndex(Number(tr.dataset.idx));
  });

  document.addEventListener('keydown', handleGlobalKeydown, true);

  setTimeout(() => q?.focus(), 0);
}