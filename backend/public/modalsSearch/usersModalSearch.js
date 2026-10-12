// ╔════════════════════════════════════════════════════════════════════╗
// ║ usersModalSearch.js — Modal inline para buscar USUÁRIOS            ║
// ║ exporta: openUsersModalSearch({ apiBase, onPick(user) })           ║
// ╚════════════════════════════════════════════════════════════════════╝

export function openUsersModalSearch({ apiBase = '', onPick } = {}) {
  apiBase = (apiBase || '').replace(/\/$/, '');

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,.35);
    display:flex; align-items:center; justify-content:center; z-index: 99998;
    padding: 18px;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    width: min(980px, 96vw); max-height: 88vh; overflow: hidden; background:#fff;
    border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.28);
    display:flex; flex-direction:column;
  `;

  dialog.innerHTML = `
    <div style="display:flex; gap:10px; align-items:center; padding:14px 16px; border-bottom:1px solid #eef0f4;">
      <strong style="font-size:1rem">🔎 Buscar Usuário</strong>
      <span id="ums-chip" style="font-size:.85rem; color:#64748b"></span>
      <button id="ums-close" aria-label="Fechar" title="Fechar" style="
        margin-left:auto; background: #f1f5f9; border: 1px solid #e2e8f0;
        width: 40px; height: 34px; border-radius: 10px; font-size: 18px;
        line-height: 1; cursor:pointer; color:#0f172a;
      ">×</button>
    </div>

    <div style="padding:12px 16px; border-bottom:1px solid #f2f4f8; display:flex; gap:10px; flex-wrap:wrap; align-items:center">
      <input id="ums-q" type="text" placeholder="Digite nome, e-mail, login, ID…" style="
        flex:1; min-width: 280px; padding:.65rem .8rem; border:1px solid #d6d9e0; border-radius:10px;
        outline:none;
      " />
      <label style="display:flex; align-items:center; gap:8px; font-size:.92rem; color:#334155; padding: 8px 10px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc;">
        <input id="ums-inactive" type="checkbox" />
        <span>Incluir inativos</span>
      </label>
      <button id="ums-btn" style="
        padding: .65rem 1rem; border-radius: 10px; border: 1px solid #cbd5e1;
        background: #2563eb; color: #fff; font-weight: 700; cursor: pointer;
      ">Buscar</button>
    </div>

    <div style="overflow:auto; flex:1">
      <table style="width:100%; border-collapse: collapse;">
        <thead>
          <tr style="background:#f8fafc; border-bottom:1px solid #eef0f4;">
            <th style="text-align:left; padding: 10px 12px; font-size:.78rem; letter-spacing:.04em; text-transform: uppercase; color:#334155;">ID</th>
            <th style="text-align:left; padding: 10px 12px; font-size:.78rem; letter-spacing:.04em; text-transform: uppercase; color:#334155;">Nome</th>
            <th style="text-align:left; padding: 10px 12px; font-size:.78rem; letter-spacing:.04em; text-transform: uppercase; color:#334155;">Login/E-mail</th>
            <th style="text-align:left; padding: 10px 12px; font-size:.78rem; letter-spacing:.04em; text-transform: uppercase; color:#334155;">Status</th>
          </tr>
        </thead>
        <tbody id="ums-tbody"></tbody>
      </table>
    </div>

    <div id="ums-status" style="padding:10px 16px; color:#64748b; font-size:.92rem; border-top:1px solid #f2f4f8;">
      Digite e clique em “Buscar”.
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const $ = (sel) => dialog.querySelector(sel);
  const q = $('#ums-q');
  const btn = $('#ums-btn');
  const tbody = $('#ums-tbody');
  const status = $('#ums-status');
  const chip = $('#ums-chip');
  const chkInactive = $('#ums-inactive');

  let rowsCache = [];

  function close() { overlay.remove(); }

  $('#ums-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.addEventListener('keydown', onKeyClose, { capture: true });
  function onKeyClose(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      document.removeEventListener('keydown', onKeyClose, { capture: true });
      close();
    }
  }

  function esc(v){
    return (v ?? '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  async function fetchJSON(url){
    const r = await fetch(url, { headers: { 'Accept':'application/json' } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${t}`);
    try { return JSON.parse(t); } catch { return t; }
  }

  function badgeStatus(active) {
    return active
      ? `<span style="display:inline-flex; padding:4px 10px; border-radius:999px; border:1px solid #a7f3d0; background:#ecfdf5; color:#065f46; font-weight:800; font-size:.82rem;">Ativo</span>`
      : `<span style="display:inline-flex; padding:4px 10px; border-radius:999px; border:1px solid #fecaca; background:#fef2f2; color:#991b1b; font-weight:800; font-size:.82rem;">Inativo</span>`;
  }

  async function buscar(){
    // Termo vazio lista todos os usuários.
    const termo = q.value.trim();

    status.textContent = 'Pesquisando…';
    chip.textContent = '';
    tbody.innerHTML = '';

    try {
      const base = (apiBase && apiBase.trim())
        ? apiBase.replace(/\/$/, '')
        : window.location.origin;

      // GET /api/users/search?q=...&limit=...&is_active=...
      // Sem is_active o backend retorna ativos e inativos.
      const url = new URL('/api/users/search', base);
      url.searchParams.set('q', termo);
      url.searchParams.set('limit', '200');
      if (!chkInactive.checked) url.searchParams.set('is_active', 'true');

      const data = await fetchJSON(url.toString());
      const rows = Array.isArray(data) ? data : (data.rows || []);
      rowsCache = rows;

      tbody.innerHTML = rows.map((u, idx) => {
        const id = u.user_id ?? u.id ?? '';
        const name = u.name ?? u.full_name ?? u.display_name ?? u.username ?? '';
        const login = u.email ?? u.login ?? u.username ?? '';
        const active = (u.is_active ?? u.active ?? true) === true;

        return `
          <tr data-idx="${idx}" style="cursor:pointer; border-top:1px solid #f1f5f9;">
            <td style="padding: 12px; font-weight:800; color:#0f172a;">${esc(id)}</td>
            <td style="padding: 12px; color:#0f172a;">${esc(name)}</td>
            <td style="padding: 12px; color:#334155;">${esc(login)}</td>
            <td style="padding: 12px;">${badgeStatus(active)}</td>
          </tr>
        `;
      }).join('');

      chip.textContent = rows.length ? `• ${rows.length} encontrado(s)` : '';
      status.textContent = rows.length ? 'Clique em um registro para selecionar.' : 'Nenhum resultado encontrado.';
    } catch (e) {
      console.error(e);
      status.textContent = 'Erro ao buscar usuários.';
    }
  }

  btn.addEventListener('click', buscar);
  q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') buscar(); });
  chkInactive.addEventListener('change', buscar);

  tbody.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-idx]');
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const data = rowsCache[idx];
    try { onPick && onPick(data); } finally { close(); }
  });

  setTimeout(() => q.focus(), 0);
  buscar();
}
