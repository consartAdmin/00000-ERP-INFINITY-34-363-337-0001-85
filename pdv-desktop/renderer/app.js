// ╔══════════════════════════════════════════════════════════════════════╗
// ║ Consart Starter — Frente de Caixa (tela)                            ║
// ║ Login → abertura de caixa → venda → pagamento → fechamento          ║
// ║ Vende sem internet: catálogo em cache e fila de vendas no PC.       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const PAYMENT_METHODS = [
  { code: 'DINHEIRO', short: 'Dinheiro', label: 'Dinheiro', sub: 'Troco automático', icon: 'cash' },
  { code: 'PIX', short: 'PIX', label: 'PIX', sub: 'Na maquininha ou QR da loja', icon: 'qr' },
  { code: 'DEBITO', short: 'Débito', label: 'Cartão de débito', sub: 'Maquininha', icon: 'card' },
  { code: 'CREDITO', short: 'Crédito', label: 'Cartão de crédito', sub: 'À vista ou parcelado', icon: 'card' },
  { code: 'OUTROS', short: 'Outros', label: 'Crediário / Outros', sub: 'Vale, boleto, convênio', icon: 'receipt' },
];
const SYNC_INTERVAL_MS = 15000;
const CATALOG_PAGE = 2000;

const state = {
  config: {},
  token: null,
  user: null,
  online: false,
  session: null,
  lastClosed: null,
  catalog: [],
  byCode: new Map(),
  byBarcode: new Map(),
  catalogAt: null,
  queue: [],
  history: [],
  favorites: {},
  cart: [],
  selected: -1,
  customer: { doc: '', name: '' },
  saleDiscount: 0,
  view: 'venda',
  results: [],
  resultIndex: 0,
  lastSync: null,
  syncing: false,
  pay: null,
};

/* ── Utilidades ────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const money = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (d) => (d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--');
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const parseMoney = (s) => Number(String(s ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;

function logo(size) {
  return `<img src="../assets/logo.svg" width="${size}" height="${size}" alt="">`;
}

let toastTimer;
function toast(message, kind = '') {
  const el = $('#toast');
  el.innerHTML = `<div class="toast ${kind}">${kind === 'ok' ? icon('check', 18) : ''}${esc(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.innerHTML = ''; }, 3500);
}

async function api(method, url, body, timeoutMs) {
  const res = await window.pdv.api({ method, url, body, token: state.token, ...(timeoutMs ? { timeoutMs } : {}) });
  state.online = !res.offline;
  if (res.status === 401 && state.token) {
    state.token = null;
    toast('Sessão expirada no ERP. Entre novamente para sincronizar.', 'err');
  }
  return res;
}

function imageUrl(url) {
  if (!url) return null;
  if (/^https?:|^data:/.test(url)) return url;
  return `${String(state.config.apiUrl || '').replace(/\/+$/, '')}/${String(url).replace(/^\/+/, '')}`;
}

function thumb(product, cls = 'th') {
  const src = imageUrl(product?.image_url);
  return `<div class="${cls}">${src ? `<img src="${esc(src)}" onerror="this.remove()">` : `<span class="ph">${icon('package', 20)}</span>`}</div>`;
}

/* ── Catálogo ──────────────────────────────────────────────────────── */
function indexCatalog(items) {
  state.catalog = items;
  state.byCode = new Map();
  state.byBarcode = new Map();
  for (const p of items) {
    state.byCode.set(String(p.product_code), p);
    for (const b of p.barcodes || []) state.byBarcode.set(String(b.barcode), { product: p, unit: b.unit, factor: Number(b.factor) || 1 });
  }
}

async function refreshCatalog() {
  const all = [];
  for (let offset = 0; ; offset += CATALOG_PAGE) {
    const res = await api('GET', `/api/pdv/catalogo?limit=${CATALOG_PAGE}&offset=${offset}`);
    if (!res.ok) return false;
    all.push(...res.data.items);
    if (res.data.items.length < CATALOG_PAGE || all.length >= res.data.total) break;
  }
  indexCatalog(all);
  state.catalogAt = new Date().toISOString();
  await window.pdv.write('catalog', { at: state.catalogAt, items: all });
  return true;
}

function searchCatalog(term) {
  const t = term.trim().toUpperCase();
  if (!t) return [];
  const words = t.split(/\s+/);
  const out = [];
  for (const p of state.catalog) {
    const hay = `${p.product_code} ${p.description}`.toUpperCase();
    if (words.every((w) => hay.includes(w))) out.push(p);
    if (out.length >= 30) break;
  }
  return out;
}

/* ── Venda (carrinho) ──────────────────────────────────────────────── */
function cartTotals() {
  const subtotal = round2(state.cart.reduce((s, it) => s + it.quantity * it.unit_price, 0));
  const itemDiscounts = round2(state.cart.reduce((s, it) => s + (it.discount || 0), 0));
  const discountTotal = round2(itemDiscounts + state.saleDiscount);
  const units = state.cart.reduce((s, it) => s + it.quantity, 0);
  return { subtotal, itemDiscounts, discountTotal, total: round2(subtotal - discountTotal), units };
}

function addToCart(product, { quantity = 1, unit, factor = 1, barcode = null } = {}) {
  const u = unit || product.unit || 'UN';
  const price = round2(Number(product.sale_price || 0) * factor);
  const existing = state.cart.findIndex((it) => it.product_code === product.product_code && it.unit === u && !it.discount);
  if (existing >= 0) {
    state.cart[existing].quantity = Math.round((state.cart[existing].quantity + quantity) * 1000) / 1000;
    state.selected = existing;
  } else {
    state.cart.push({
      product_code: product.product_code,
      description: product.description,
      barcode,
      unit: u,
      unit_factor: factor,
      quantity,
      unit_price: price,
      discount: 0,
      image_url: product.image_url,
    });
    state.selected = state.cart.length - 1;
  }
  if (!price) toast('Produto sem preço de venda cadastrado no ERP.', 'err');
  state.results = [];
  render();
}

function handleScan(raw) {
  let term = String(raw || '').trim();
  if (!term) return;
  let quantity = 1;
  const mult = term.match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.+)$/);
  if (mult) {
    quantity = Number(mult[1].replace(',', '.')) || 1;
    term = mult[2].trim();
  }

  const hit = state.byBarcode.get(term);
  if (hit) return addToCart(hit.product, { quantity, unit: hit.unit, factor: hit.factor, barcode: term });
  const byCode = state.byCode.get(term) || state.byCode.get(term.padStart(8, '0'));
  if (byCode) return addToCart(byCode, { quantity });

  state.results = searchCatalog(term);
  state.resultIndex = 0;
  state.pendingQty = quantity;
  if (!state.results.length) toast(`Nenhum produto encontrado para "${term}".`, 'err');
  render();
}

function clearSale() {
  state.cart = [];
  state.selected = -1;
  state.customer = { doc: '', name: '' };
  state.saleDiscount = 0;
  state.results = [];
}

/* ── Fila offline e sincronização ──────────────────────────────────── */
async function persistQueue() {
  await window.pdv.write('queue', state.queue);
}

async function syncQueue() {
  if (!state.token) return;
  // Já sincronizando: espera terminar e roda de novo (a venda recém-feita pode ter entrado depois)
  if (state.syncing) { await state.syncing; return syncQueue(); }
  let done;
  state.syncing = new Promise((r) => { done = r; });
  try {
    while (state.queue.length) {
      const sale = state.queue[0];
      const res = await api('POST', '/api/pdv/vendas', sale.payload, 70000);
      if (res.offline || res.status === 401) break;
      if (!res.ok && res.status >= 500) break;
      const hist = state.history.find((h) => h.pdv_uuid === sale.payload.pdv_uuid);
      if (hist) {
        hist.status = res.ok ? 'SINCRONIZADA' : 'ERRO';
        hist.sale_id = res.data?.sale?.sale_id ?? null;
        hist.error = res.ok ? null : res.data?.message;
        hist.stock_status = res.data?.sale?.stock_status ?? null;
        if (res.data?.nfce) hist.nfce = res.data.nfce;
      }
      state.queue.shift();
      await persistQueue();
    }
    if (!state.queue.length) state.lastSync = new Date().toISOString();
    await window.pdv.write('history', state.history.slice(0, 500));
  } finally {
    state.syncing = null;
    done();
    renderHeaderOnly();
  }
}

/* ── Fluxo principal ───────────────────────────────────────────────── */
async function boot() {
  state.config = (await window.pdv.read('config', {})) || {};
  const cached = await window.pdv.read('catalog', null);
  if (cached?.items) { indexCatalog(cached.items); state.catalogAt = cached.at; }
  state.queue = (await window.pdv.read('queue', [])) || [];
  state.history = (await window.pdv.read('history', [])) || [];
  state.favorites = (await window.pdv.read('favorites', {})) || {};
  if (!state.config.apiUrl) return showSetup(true);
  renderLogin();
}

async function afterLogin() {
  const cachedSession = await window.pdv.read('session', null);
  if (state.token) {
    refreshCatalog().then((ok) => { if (ok) render(); });
    loadServerConfig();
    const res = await api('GET', `/api/pdv/caixa/atual?terminal=${encodeURIComponent(state.config.terminal)}`);
    if (res.ok) {
      state.session = res.data.data.session;
      state.lastClosed = res.data.data.last_closed;
      await window.pdv.write('session', state.session);
    } else {
      state.session = cachedSession;
    }
  } else {
    state.session = cachedSession;
  }
  state.view = 'venda';
  render();
  if (!state.session) showOpenCash();
  syncQueue();
}

// NFC-e ligada no ERP e dados do emitente (guardados para imprimir sem internet)
async function loadServerConfig() {
  const res = await api('GET', '/api/pdv/config');
  if (!res.ok || !res.data?.data) return;
  const nfce = res.data.data.nfce || { enabled: false };
  state.config = { ...state.config, nfce };
  await window.pdv.write('config', state.config);
}

const nfceOn = () => Boolean(state.config.nfce?.enabled);

/* ── Telas ─────────────────────────────────────────────────────────── */
function render() {
  if (!state.user) return renderLogin();
  const views = { venda: viewSale, produtos: viewProducts, caixa: viewClosing, vendas: viewHistory };
  $('#root').innerHTML = shell((views[state.view] || viewSale)());
  bindShell();
  if (state.view === 'venda') bindSale();
  if (state.view === 'produtos') bindProducts();
  if (state.view === 'caixa') bindClosing();
  focusSearch();
}

function focusSearch() {
  if ($('#modal').innerHTML) return;
  const input = $('#scan');
  if (input) input.focus();
}

function shell(inner) {
  const nav = [
    ['venda', 'cart', 'Venda'],
    ['produtos', 'package', 'Produtos'],
    ['caixa', 'wallet', 'Caixa'],
    ['vendas', 'receipt', 'Vendas'],
  ];
  const titles = {
    venda: ['Frente de Caixa', `${esc(state.config.storeName || 'Loja')} · ${esc(state.config.terminal)}`],
    produtos: ['Produtos', `${num(state.catalog.length)} no catálogo · atualizado ${hhmm(state.catalogAt)}`],
    caixa: ['Fechamento de caixa', state.session ? `${esc(state.session.terminal)} · aberto às ${hhmm(state.session.opened_at)} por ${esc(state.session.operator_name)}` : 'Nenhum caixa aberto'],
    vendas: ['Vendas deste caixa', `${state.history.filter((h) => h.session_id === state.session?.session_id).length} vendas`],
  };
  const [title, sub] = titles[state.view] || titles.venda;
  return `<div class="app">
    <aside class="sb"><div class="sb-logo">${logo(40)}</div><nav>
      ${nav.map(([k, i, l]) => `<div class="nv ${state.view === k ? 'on' : ''}" data-nav="${k}">${icon(i, 20)}<span>${l}</span></div>`).join('')}
    </nav><div class="sb-bot">
      <div class="nv" data-act="settings">${icon('settings', 20)}<span>Ajustes</span></div>
      <div class="nv" data-act="logout">${icon('logout', 20)}<span>Sair</span></div>
    </div></aside>
    <div class="cnt">
      <header class="hd"><div class="ttl"><b>${title}</b><span>${sub}</span></div>
        ${state.view === 'venda' ? searchBox() : '<div style="flex:1"></div>'}
        <div class="st" id="status">${statusChips()}</div>
        <div class="op"><div class="av">${esc(initials(state.user.full_name))}</div><div><b>${esc(state.user.full_name)}</b><span>${esc(state.user.role || 'operador')} · ${esc(state.config.terminal)}</span></div></div>
      </header>
      ${inner}
      ${keysBar()}
    </div></div>`;
}

function statusChips() {
  const pending = state.queue.length;
  return `<span class="chip ${state.online ? 'ok' : 'off'}"><i></i>${state.online ? 'ERP online' : 'Sem internet'}</span>
    <span class="chip ${state.config.printer ? 'ok' : 'warn'}">${icon('printer', 14)}${state.config.printer ? 'Impressora' : 'Sem impressora'}</span>
    <span class="chip ${pending ? 'warn' : 'ok'}">${icon('cloud', 14)}${pending ? `${pending} venda(s) na fila` : `Sincronizado ${hhmm(state.lastSync)}`}</span>`;
}

function renderHeaderOnly() {
  const el = $('#status');
  if (el) el.innerHTML = statusChips();
  const fila = $('#fila');
  if (fila) fila.textContent = String(state.queue.length);
}

function keysBar() {
  const k = [['F2', 'Buscar'], ['F3', 'Quantidade'], ['F4', 'Desconto'], ['F5', 'Cliente/CPF'], ['F6', 'Sangria'], ['F7', 'Suprimento'], ['Del', 'Remover item'], ['F10', 'Finalizar'], ['Esc', 'Cancelar']];
  return `<footer class="kb">${k.map(([a, b]) => `<span><kbd>${a}</kbd>${b}</span>`).join('')}<span class="sp"></span>
    <span class="ver">Consart Starter v${esc(state.version || '1.0')} · Fila: <b id="fila">${state.queue.length}</b></span></footer>`;
}

function searchBox() {
  const results = state.results.length ? `<div class="results">${state.results.map((p, i) => `
      <div class="res ${i === state.resultIndex ? 'on' : ''}" data-res="${i}">${thumb(p)}
        <div class="pd"><b>${esc(p.description)}</b><span>Cód. ${esc(p.product_code)}${p.barcodes?.[0] ? ` · EAN ${esc(p.barcodes[0].barcode)}` : ''}</span></div>
        <span class="stk">Estoque ${num(p.stock_qty)}</span><span class="pr">${money(p.sale_price)}</span></div>`).join('')}</div>` : '';
  return `<div class="srch">${icon('scan', 22, '#16a34a')}<input id="scan" autocomplete="off" placeholder="Bipe o código de barras ou busque por nome, código ou EAN (3*código = quantidade 3)"><span class="kc">F2</span>${results}</div>`;
}

function viewSale() {
  const t = cartTotals();
  const favCodes = Object.entries(state.favorites).sort((a, b) => b[1] - a[1]).map(([c]) => c).filter((c) => state.byCode.has(c));
  const fallback = state.catalog.filter((p) => p.image_url && Number(p.sale_price) > 0).slice(0, 6).map((p) => p.product_code);
  const favs = [...new Set([...favCodes, ...fallback])].slice(0, 6).map((c) => state.byCode.get(c));

  const rows = state.cart.map((it, i) => `
    <div class="row ${i === state.selected ? 'sel' : ''}" data-row="${i}"><span class="n">${i + 1}</span>${thumb(it)}
      <div class="pd"><b>${esc(it.description)}</b><span>Cód. ${esc(it.product_code)}${it.barcode ? ` · EAN ${esc(it.barcode)}` : ''}${it.unit_factor > 1 ? ` · ${esc(it.unit)} c/ ${num(it.unit_factor)}` : ''}</span></div>
      <div class="qty"><i data-dec="${i}">${icon('minus', 14)}</i><b>${num(it.quantity)}</b><i data-inc="${i}">${icon('plus', 14)}</i></div>
      <span class="un">${money(it.unit_price)}</span>
      ${it.discount ? `<span class="dsc">− ${money(it.discount)}</span>` : '<span class="mut">—</span>'}
      <b class="tt">${money(it.quantity * it.unit_price - it.discount)}</b>
      <span class="rm" data-rm="${i}">${icon('trash', 16)}</span></div>`).join('');

  return `<main class="mn"><div class="lc">
    ${favs.length ? `<div class="sec"><div class="sh"><b>Atalhos rápidos</b><span class="mut">Mais vendidos neste caixa</span></div>
      <div class="favs">${favs.map((p) => `<div class="fav" data-fav="${esc(p.product_code)}">${thumb(p, 'fi')}<div class="fn">${esc(p.description)}</div><div class="fp">${money(p.sale_price)}</div></div>`).join('')}</div></div>` : ''}
    <div class="sec cartc"><div class="sh"><b>Itens da venda</b><span class="badge">${state.cart.length} produtos · ${num(t.units)} un.</span><span class="sp"></span>
      <span class="mut">${state.session ? `Caixa nº ${state.session.session_id} · aberto ${hhmm(state.session.opened_at)}` : 'Caixa fechado'}</span></div>
      <div class="thd"><span class="n">#</span><span style="width:48px"></span><span style="flex:1">Produto</span><span style="width:112px;text-align:center">Qtd</span><span class="un">Unitário</span><span style="width:90px;text-align:right">Desconto</span><span class="tt">Total</span><span class="rm"></span></div>
      <div class="rows">${rows || `<div class="empty">${icon('scan', 40, '#cbd5e1', 1.5)}<b>Pronto para vender</b>Bipe um produto ou digite o nome na busca.</div>`}</div></div>
  </div>
  <div class="rc">
    <div class="cust" data-act="customer">${icon('user', 18, '#16a34a')}<div><b>${esc(state.customer.name || 'Consumidor final')}</b><span>${state.customer.doc ? `CPF/CNPJ na nota: ${esc(state.customer.doc)}` : 'Sem CPF na nota'}</span></div><span class="kc">F5</span></div>
    <div class="sum"><div><span>Subtotal (${num(t.units)} itens)</span><b>${money(t.subtotal)}</b></div><div><span>Descontos</span><b class="${t.discountTotal ? 'dsc' : ''}">${t.discountTotal ? '− ' : ''}${money(t.discountTotal)}</b></div></div>
    <div class="total"><span>TOTAL A PAGAR</span><b>${money(t.total)}</b><small>${state.cart.length ? `${state.cart.length} produto(s)` : 'Nenhum item'}</small></div>
    <div class="pays">${PAYMENT_METHODS.slice(0, 4).map((m, i) => `<div class="pay" data-pay="${m.code}">${icon(m.icon, 22)}<b>${m.short}</b><kbd>${i + 1}</kbd></div>`).join('')}</div>
    <div class="fin ${state.cart.length ? '' : 'disabled'}" data-act="finish">Finalizar venda <kbd>F10</kbd></div>
    <div class="acts"><span data-act="discount">${icon('tag', 15)}Desconto</span><span data-act="remove">${icon('del', 15)}Remover item</span><span class="red" data-act="cancel">${icon('x', 15)}Cancelar venda</span></div>
  </div></main>`;
}

function viewProducts() {
  const term = state.productTerm || '';
  const list = term ? searchCatalog(term) : state.catalog.slice(0, 30);
  return `<main class="fx"><div class="sec fill"><div class="sh"><div class="in" style="flex:1;height:38px">${icon('search', 18, '#64748b')}<input id="ptxt" value="${esc(term)}" placeholder="Buscar produto por nome ou código"></div>
    <div class="btn" data-act="reload-catalog">${icon('cloud', 16)} Atualizar catálogo</div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th></th><th>Código</th><th>Produto</th><th>Códigos de barras</th><th class="r">Estoque</th><th class="r">Preço</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr><td style="width:56px">${thumb(p)}</td><td>${esc(p.product_code)}</td><td><b>${esc(p.description)}</b></td>
      <td class="mut">${(p.barcodes || []).map((b) => `${esc(b.barcode)}${Number(b.factor) > 1 ? ` (${esc(b.unit)} ${num(b.factor)})` : ''}`).join('<br>')}</td>
      <td class="r">${num(p.stock_qty)}</td><td class="r"><b>${money(p.sale_price)}</b></td>
      <td class="r"><span class="btn" data-addp="${esc(p.product_code)}">${icon('plus', 14)} Vender</span></td></tr>`).join('')}
    </tbody></table></div></div></main>`;
}

function viewHistory() {
  const list = state.history.filter((h) => !state.session || h.session_id === state.session.session_id);
  const pill = (h) => (h.status === 'SINCRONIZADA' ? '<span class="pill g">No ERP</span>' : h.status === 'ERRO' ? `<span class="pill r" title="${esc(h.error)}">Erro</span>` : '<span class="pill y">Na fila</span>');
  const nfcePill = (h) => {
    if (!nfceOn()) return '';
    const st = h.nfce?.status;
    if (st === 'AUTORIZADA') return `<span class="pill g" title="Chave ${esc(h.nfce.key)}">NFC-e ${esc(h.nfce.number)}</span>`;
    if (st === 'REJEITADA' || st === 'ERRO' || st === 'DENEGADA') return `<span class="pill r" title="${esc(h.nfce.message)}">NFC-e ${st === 'ERRO' ? 'com erro' : st.toLowerCase()}</span>`;
    if (h.status !== 'SINCRONIZADA') return '<span class="pill y">NFC-e após sincronizar</span>';
    return `<span class="pill y" title="${esc(h.nfce?.message || '')}">NFC-e pendente</span>`;
  };
  const nfceBtn = (h) => (nfceOn() && h.status === 'SINCRONIZADA' && h.nfce?.status !== 'AUTORIZADA'
    ? `<span class="btn" data-nfce="${esc(h.pdv_uuid)}">${icon('cloud', 14)} Emitir NFC-e</span> ` : '');
  return `<main class="fx"><div class="sec fill"><div class="sh"><b>Vendas</b><span class="sp"></span><div class="btn" data-act="sync">${icon('cloud', 16)} Sincronizar agora</div></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Nº</th><th>Hora</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th class="r">Total</th><th>ERP</th><th>${nfceOn() ? 'NFC-e' : ''}</th><th></th></tr></thead><tbody>
    ${list.map((h) => `<tr><td>${esc(h.number)}${h.sale_id ? ` <span class="mut">(#${esc(h.sale_id)})</span>` : ''}</td><td>${hhmm(h.sold_at)}</td><td>${esc(h.customer_doc || 'Consumidor final')}</td><td>${h.items.length}</td>
      <td>${h.payments.map((p) => esc(p.label)).join(', ')}</td><td class="r"><b>${money(h.total)}</b></td><td>${pill(h)}${h.stock_status === 'PARCIAL' ? ' <span class="pill y" title="Parte dos itens sem lote com saldo">Estoque parcial</span>' : ''}</td>
      <td>${nfcePill(h)}</td>
      <td class="r" style="white-space:nowrap">${nfceBtn(h)}<span class="btn" data-reprint="${esc(h.pdv_uuid)}">${icon('printer', 14)} Reimprimir</span></td></tr>`).join('') || '<tr><td colspan="9" class="mut">Nenhuma venda neste caixa.</td></tr>'}
    </tbody></table></div></div></main>`;
}

function viewClosing() {
  if (!state.session) {
    return `<main class="fx"><div class="sec fill"><div class="empty">${icon('lock', 40, '#cbd5e1', 1.5)}<b>Nenhum caixa aberto</b><div class="btn pri" data-act="open-cash">Abrir caixa</div></div></div></main>`;
  }
  const s = state.summary;
  if (!s) return `<main class="fx"><div class="sec fill"><div class="empty"><b>Carregando resumo do caixa…</b>${state.online ? '' : 'É preciso estar conectado ao ERP para fechar o caixa.'}</div></div></main>`;
  const ind = s.indicators;
  const counted = state.counted || {};
  const rows = PAYMENT_METHODS.map((m) => {
    const exp = s.expected[m.code] || 0;
    const cv = counted[m.code] ?? exp;
    const diff = round2(cv - exp);
    return `<div class="cr">${icon(m.icon, 18, '#16a34a')}<span>${m.label}</span><b>${money(exp)}</b>
      <div class="in sm"><input data-count="${m.code}" value="${esc(Number(cv).toFixed(2).replace('.', ','))}" style="text-align:right;font-weight:600"></div>
      <span class="df ${Math.abs(diff) < 0.005 ? 'okk' : 'neg'}">${Math.abs(diff) < 0.005 ? 'OK' : `${diff > 0 ? '+' : '−'} ${money(Math.abs(diff))}`}</span></div>`;
  }).join('');
  const totExp = round2(Object.values(s.expected).reduce((a, b) => a + b, 0));
  const totCnt = round2(PAYMENT_METHODS.reduce((a, m) => a + Number(counted[m.code] ?? s.expected[m.code] ?? 0), 0));
  const movIcon = { SANGRIA: ['r', 'down'], SUPRIMENTO: ['g', 'up'] };
  return `<main class="fx">
    <div class="kpis"><div class="kp"><span>Vendas</span><b>${ind.sales}</b><small>${ind.canceled} cancelada(s)</small></div>
      <div class="kp"><span>Faturamento</span><b>${money(ind.total)}</b><small>${state.queue.length ? `<span style="color:#d97706">${state.queue.length} venda(s) ainda na fila</span>` : 'Tudo sincronizado'}</small></div>
      <div class="kp"><span>Ticket médio</span><b>${money(ind.ticket)}</b><small>${ind.cash_sales} venda(s) em dinheiro</small></div>
      <div class="kp"><span>NFC-e</span><b>${ind.nfce_authorized} / ${ind.sales}</b><small class="warn">Emissão na próxima etapa</small></div></div>
    <div class="fxg"><div class="sec"><div class="sh"><b>Conferência por forma de pagamento</b><span class="sp"></span><span class="mut">Digite o valor contado</span></div>
      <div class="ct"><div class="ch"><span>Forma</span><span>Sistema</span><span>Contado</span><span>Diferença</span></div>${rows}
      <div class="cr tot"><span></span><span>Total</span><b>${money(totExp)}</b><b style="padding-left:12px">${money(totCnt)}</b><span class="df ${Math.abs(totCnt - totExp) < 0.005 ? 'okk' : 'neg'}">${money(totCnt - totExp)}</span></div></div></div>
    <div class="sec"><div class="sh"><b>Movimentos do caixa</b></div><div class="tlm">
      <div><i class="g">${icon('up', 14)}</i><span><b>Abertura</b> · fundo de troco</span><em>${hhmm(s.session.opened_at)}</em><b>${money(s.session.opening_amount)}</b></div>
      ${s.movements.map((m) => `<div><i class="${movIcon[m.movement_type][0]}">${icon(movIcon[m.movement_type][1], 14)}</i><span><b>${m.movement_type === 'SANGRIA' ? 'Sangria' : 'Suprimento'}</b>${m.reason ? ` · ${esc(m.reason)}` : ''}</span><em>${hhmm(m.created_at)}</em><b>${m.movement_type === 'SANGRIA' ? '− ' : ''}${money(m.amount)}</b></div>`).join('')}
      <div><i class="b">${icon('cash', 14)}</i><span><b>Vendas em dinheiro</b> (líquido de troco)</span><em></em><b>${money(ind.cash_sales_amount)}</b></div></div>
      <div class="tlsum"><span>Saldo esperado na gaveta</span><b>${money(s.expected.DINHEIRO)}</b></div></div></div>
    <div class="fxf"><div class="btn" data-nav="venda">Voltar à venda</div><div class="sp"></div>
      <div class="btn" data-act="print-closing">${icon('printer', 16)} Imprimir resumo</div>
      <div class="btn pri big" data-act="close-cash">${icon('lock', 18, '#fff')} Fechar caixa</div></div></main>`;
}

/* ── Eventos ───────────────────────────────────────────────────────── */
function bindShell() {
  document.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => go(el.dataset.nav)));
  document.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => action(el.dataset.act)));
}

async function go(view) {
  state.view = view;
  state.results = [];
  if (view === 'caixa' && state.session) {
    state.summary = null;
    state.counted = null;
    render();
    await syncQueue();
    const res = await api('GET', `/api/pdv/caixa/${state.session.session_id}/resumo`);
    if (res.ok) state.summary = res.data.data;
    else toast(res.data?.message || 'Não foi possível carregar o resumo do caixa.', 'err');
  }
  render();
}

function bindSale() {
  const input = $('#scan');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.results.length && !input.value.trim()) return pickResult(state.resultIndex);
      if (state.results.length && input.value.trim() === state.lastTerm) return pickResult(state.resultIndex);
      state.lastTerm = input.value.trim();
      handleScan(input.value);
      const again = $('#scan');
      if (again && state.results.length) again.value = state.lastTerm;
    } else if (state.results.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      state.resultIndex = (state.resultIndex + (e.key === 'ArrowDown' ? 1 : -1) + state.results.length) % state.results.length;
      document.querySelectorAll('.res').forEach((el, i) => el.classList.toggle('on', i === state.resultIndex));
      document.querySelector('.res.on')?.scrollIntoView({ block: 'nearest' });
    }
  });
  document.querySelectorAll('[data-res]').forEach((el) => el.addEventListener('click', () => pickResult(Number(el.dataset.res))));
  document.querySelectorAll('[data-fav]').forEach((el) => el.addEventListener('click', () => addToCart(state.byCode.get(el.dataset.fav))));
  document.querySelectorAll('[data-row]').forEach((el) => el.addEventListener('click', () => { state.selected = Number(el.dataset.row); render(); }));
  document.querySelectorAll('[data-inc]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); changeQty(Number(el.dataset.inc), 1); }));
  document.querySelectorAll('[data-dec]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); changeQty(Number(el.dataset.dec), -1); }));
  document.querySelectorAll('[data-rm]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); removeItem(Number(el.dataset.rm)); }));
  document.querySelectorAll('[data-pay]').forEach((el) => el.addEventListener('click', () => showPayment(el.dataset.pay)));
}

function bindProducts() {
  const input = $('#ptxt');
  input.addEventListener('input', () => {
    state.productTerm = input.value;
    const pos = input.selectionStart;
    render();
    const again = $('#ptxt');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  document.querySelectorAll('[data-addp]').forEach((el) => el.addEventListener('click', () => {
    state.view = 'venda';
    addToCart(state.byCode.get(el.dataset.addp));
  }));
}

function bindClosing() {
  document.querySelectorAll('[data-count]').forEach((el) => el.addEventListener('change', () => {
    state.counted = state.counted || {};
    state.counted[el.dataset.count] = round2(parseMoney(el.value));
    render();
  }));
}

function pickResult(i) {
  const p = state.results[i];
  if (p) addToCart(p, { quantity: state.pendingQty || 1 });
  state.pendingQty = 1;
}

function changeQty(i, delta) {
  const it = state.cart[i];
  if (!it) return;
  it.quantity = Math.round((it.quantity + delta) * 1000) / 1000;
  if (it.quantity <= 0) return removeItem(i);
  state.selected = i;
  render();
}

function removeItem(i) {
  if (i < 0 || !state.cart[i]) return toast('Selecione um item para remover.');
  state.cart.splice(i, 1);
  state.selected = Math.min(i, state.cart.length - 1);
  render();
}

async function action(act) {
  switch (act) {
    case 'settings': return showSetup(false);
    case 'logout': return logout();
    case 'customer': return showCustomer();
    case 'discount': return showDiscount();
    case 'remove': return removeItem(state.selected);
    case 'cancel': return confirmCancel();
    case 'finish': return showPayment();
    case 'open-cash': return showOpenCash();
    case 'close-cash': return closeCash();
    case 'print-closing': return printClosing();
    case 'sync': await syncQueue(); return render();
    case 'reload-catalog': {
      toast('Atualizando catálogo…');
      const ok = await refreshCatalog();
      toast(ok ? `Catálogo atualizado: ${num(state.catalog.length)} produtos.` : 'Sem conexão com o ERP.', ok ? 'ok' : 'err');
      return render();
    }
    default: return null;
  }
}

document.addEventListener('click', (e) => {
  const rp = e.target.closest('[data-reprint]');
  if (rp) {
    const sale = state.history.find((h) => h.pdv_uuid === rp.dataset.reprint);
    if (sale) printReceipt(sale);
  }
  const nf = e.target.closest('[data-nfce]');
  if (nf) retryNfce(nf.dataset.nfce);
});

async function retryNfce(pdvUuid) {
  const hist = state.history.find((h) => h.pdv_uuid === pdvUuid);
  if (!hist) return;
  showBusy('Emitindo NFC-e…', 'Aguardando a autorização da SEFAZ');
  const res = await api('POST', `/api/pdv/vendas/${encodeURIComponent(pdvUuid)}/nfce`, undefined, 70000);
  closeModal();
  if (!res.ok) return toast(res.data?.message || 'Não foi possível emitir a NFC-e.', 'err');
  hist.nfce = res.data.nfce;
  await window.pdv.write('history', state.history.slice(0, 500));
  render();
  if (hist.nfce?.status === 'AUTORIZADA') {
    toast(`NFC-e ${hist.nfce.number} autorizada.`, 'ok');
    printReceipt(hist);
  } else {
    toast(`NFC-e não autorizada: ${hist.nfce?.message || hist.nfce?.status}`, 'err');
  }
}

function showBusy(title, sub) {
  openModal(`<div class="busy"><div class="spin"></div><b>${esc(title)}</b><span>${esc(sub || '')}</span></div>`, { width: 420, lock: true });
}

document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  const modalOpen = Boolean($('#modal').innerHTML);
  if (modalOpen) {
    if (e.key === 'Escape' && !state.lockModal) { e.preventDefault(); closeModal(); }
    return;
  }
  const keys = {
    F2: () => focusSearch(),
    F3: () => showQuantity(),
    F4: () => showDiscount(),
    F5: () => showCustomer(),
    F6: () => showCashMovement('SANGRIA'),
    F7: () => showCashMovement('SUPRIMENTO'),
    F10: () => showPayment(),
    Delete: () => removeItem(state.selected),
    Escape: () => (state.results.length ? (state.results = [], render()) : confirmCancel()),
  };
  if (state.view === 'venda' && !e.target.closest('#scan') && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    return showPayment(PAYMENT_METHODS[Number(e.key) - 1].code);
  }
  if (state.view === 'venda' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !state.results.length && state.cart.length) {
    e.preventDefault();
    state.selected = Math.max(0, Math.min(state.cart.length - 1, state.selected + (e.key === 'ArrowDown' ? 1 : -1)));
    return render();
  }
  if (keys[e.key]) {
    e.preventDefault();
    if (state.view !== 'venda' && !['F6', 'F7'].includes(e.key)) { state.view = 'venda'; render(); }
    keys[e.key]();
  }
});

/* ── Modais ────────────────────────────────────────────────────────── */
function openModal(html, { width = 560, lock = false } = {}) {
  state.lockModal = lock;
  $('#modal').innerHTML = `<div class="ov"><div class="md" style="width:${width}px">${html}</div></div>`;
  $('#modal').querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
  const first = $('#modal').querySelector('input');
  if (first) { first.focus(); first.select?.(); }
}

function closeModal() {
  $('#modal').innerHTML = '';
  state.pay = null;
  focusSearch();
}

function modalHead(title, sub, closable = true) {
  return `<div class="mh"><div><b>${title}</b><span>${sub || ''}</span></div>${closable ? `<span class="cls" data-close>${icon('x', 20)}</span>` : ''}</div>`;
}

function simpleForm({ title, sub, fields, okLabel, onOk, width }) {
  openModal(`${modalHead(title, sub)}<form class="fm" id="mf">${fields}<div class="err" id="merr"></div></form>
    <div class="mf"><div class="btn" data-close>Cancelar <kbd>Esc</kbd></div><div class="sp"></div><button class="btn pri big" form="mf">${okLabel} <kbd>Enter</kbd></button></div>`, { width });
  $('#mf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData($('#mf')).entries());
    const err = await onOk(data);
    if (err) $('#merr').textContent = err;
  });
}

function showQuantity() {
  const it = state.cart[state.selected];
  if (!it) return toast('Selecione um item (setas ↑ ↓) para mudar a quantidade.');
  simpleForm({
    title: 'Quantidade',
    sub: esc(it.description),
    fields: `<label>Nova quantidade (${esc(it.unit)})</label><div class="in"><input name="q" value="${num(it.quantity)}"></div>`,
    okLabel: 'Aplicar',
    onOk: ({ q }) => {
      const v = Number(String(q).replace(',', '.'));
      if (!(v > 0)) return 'Informe uma quantidade maior que zero.';
      it.quantity = Math.round(v * 1000) / 1000;
      closeModal();
      render();
      return null;
    },
  });
}

function showDiscount() {
  if (!state.cart.length) return toast('Adicione itens antes de dar desconto.');
  const it = state.cart[state.selected];
  const t = cartTotals();
  simpleForm({
    title: 'Desconto',
    sub: `Total atual ${money(t.total)}`,
    fields: `<label>Aplicar em</label><div class="in"><select name="target">${it ? `<option value="item">Item selecionado: ${esc(it.description)}</option>` : ''}<option value="sale" ${it ? '' : 'selected'}>Venda inteira</option></select></div>
      <label>Desconto (valor em R$ ou percentual, ex.: 5%)</label><div class="in"><input name="v" placeholder="0,00 ou 5%"></div>`,
    okLabel: 'Aplicar',
    onOk: ({ target, v }) => {
      const raw = String(v || '').trim();
      const isPct = raw.endsWith('%');
      const value = parseMoney(raw);
      if (!(value >= 0)) return 'Valor inválido.';
      if (target === 'item' && it) {
        const gross = it.quantity * it.unit_price;
        const d = round2(isPct ? gross * value / 100 : value);
        if (d > gross) return 'Desconto maior que o valor do item.';
        it.discount = d;
      } else {
        const base = t.subtotal - t.itemDiscounts;
        const d = round2(isPct ? base * value / 100 : value);
        if (d > base) return 'Desconto maior que o valor da venda.';
        state.saleDiscount = d;
      }
      closeModal();
      render();
      return null;
    },
  });
}

function showCustomer() {
  simpleForm({
    title: 'Cliente / CPF na nota',
    sub: 'Deixe em branco para consumidor final',
    fields: `<label>CPF ou CNPJ</label><div class="in"><input name="doc" value="${esc(state.customer.doc)}" placeholder="000.000.000-00"></div>
      <label>Nome (opcional)</label><div class="in"><input name="name" value="${esc(state.customer.name)}"></div>`,
    okLabel: 'Salvar',
    onOk: ({ doc, name }) => {
      const digits = String(doc || '').replace(/\D/g, '');
      if (digits && digits.length !== 11 && digits.length !== 14) return 'CPF deve ter 11 dígitos e CNPJ 14.';
      state.customer = { doc: digits ? String(doc).trim() : '', name: String(name || '').trim().toUpperCase() };
      closeModal();
      render();
      return null;
    },
  });
}

function confirmCancel() {
  if (!state.cart.length) return null;
  openModal(`${modalHead('Cancelar venda?', `${state.cart.length} item(ns) · ${money(cartTotals().total)}`)}
    <div class="fm"><span>Os itens serão removidos e nada será enviado ao ERP.</span></div>
    <div class="mf"><div class="btn" data-close>Voltar <kbd>Esc</kbd></div><div class="sp"></div><div class="btn pri big" id="cc" style="background:#dc2626;border-color:#dc2626">Cancelar venda</div></div>`, { width: 460 });
  $('#cc').addEventListener('click', () => { clearSale(); closeModal(); render(); });
  return null;
}

function showOpenCash() {
  const last = state.lastClosed;
  openModal(`${modalHead('Abertura de caixa', `${esc(state.config.terminal)} · ${new Date().toLocaleDateString('pt-BR')} · ${esc(state.user.full_name)}`, false)}
    <div style="padding:20px 24px"><div class="lbl">Fundo de troco</div><div class="amt" style="font-size:34px"><input id="oa" value="0,00"></div>
    <div class="qk">${[100, 150, 200].map((v) => `<span data-oa="${v}">${money(v)}</span>`).join('')}</div>
    ${last ? `<div class="info">${icon('clock', 16, '#64748b')}<span>Último fechamento: <b>${new Date(last.closed_at).toLocaleString('pt-BR')}</b> por ${esc(last.closed_by_name)} · dinheiro contado <b>${money(last.counted?.DINHEIRO)}</b></span></div>` : ''}
    <div class="lbl" style="margin-top:14px">Observação</div><div class="in"><input id="on" placeholder="Opcional"></div><div class="err" id="merr"></div></div>
    <div class="mf"><div class="btn" id="oq">Sair</div><div class="sp"></div><div class="btn pri big" id="ok">${icon('check', 18, '#fff')} Abrir caixa <kbd>Enter</kbd></div></div>`, { width: 640, lock: true });
  $('#modal').querySelectorAll('[data-oa]').forEach((el) => el.addEventListener('click', () => { $('#oa').value = Number(el.dataset.oa).toFixed(2).replace('.', ','); }));
  $('#oq').addEventListener('click', logout);
  const submit = async () => {
    if (!state.token) { $('#merr').textContent = 'É preciso estar conectado ao ERP para abrir o caixa.'; return; }
    const res = await api('POST', '/api/pdv/caixa/abrir', { terminal: state.config.terminal, opening_amount: parseMoney($('#oa').value), notes: $('#on').value });
    if (!res.ok) { $('#merr').textContent = res.data?.message || 'Não foi possível abrir o caixa.'; return; }
    state.session = res.data.data.session;
    await window.pdv.write('session', state.session);
    state.lockModal = false;
    closeModal();
    toast(res.data.data.alreadyOpen ? 'Este caixa já estava aberto.' : 'Caixa aberto. Boas vendas!', 'ok');
    render();
  };
  $('#ok').addEventListener('click', submit);
  $('#modal .ov').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

function showCashMovement(type) {
  if (!state.session) return toast('Abra o caixa primeiro.', 'err');
  const label = type === 'SANGRIA' ? 'Sangria' : 'Suprimento';
  simpleForm({
    title: label,
    sub: type === 'SANGRIA' ? 'Retirada de dinheiro da gaveta' : 'Entrada de dinheiro para troco',
    fields: `<label>Valor</label><div class="in"><input name="amount" placeholder="0,00"></div><label>Motivo</label><div class="in"><input name="reason" placeholder="${type === 'SANGRIA' ? 'Ex.: cofre' : 'Ex.: troco'}"></div>`,
    okLabel: `Registrar ${label.toLowerCase()}`,
    onOk: async ({ amount, reason }) => {
      const value = parseMoney(amount);
      if (!(value > 0)) return 'Informe um valor maior que zero.';
      const res = await api('POST', `/api/pdv/caixa/${state.session.session_id}/movimentos`, { type, amount: value, reason });
      if (!res.ok) return res.offline ? 'Sem conexão com o ERP. Tente de novo quando a internet voltar.' : (res.data?.message || 'Erro ao registrar.');
      closeModal();
      toast(`${label} de ${money(value)} registrada.`, 'ok');
      if (state.view === 'caixa') go('caixa');
      return null;
    },
  });
  return null;
}

/* ── Pagamento ─────────────────────────────────────────────────────── */
function showPayment(method) {
  if (!state.cart.length) return toast('Adicione itens antes de finalizar.');
  if (!state.session) return showOpenCash();
  const t = cartTotals();
  if (t.total < 0) return toast('Desconto maior que o total.', 'err');
  if (!state.pay) state.pay = { method: method || 'DINHEIRO', entry: '', payments: [], print: true };
  if (method) state.pay.method = method;
  renderPayment();
  return null;
}

function payState() {
  const t = cartTotals();
  const paid = round2(state.pay.payments.reduce((s, p) => s + p.amount, 0));
  const remaining = round2(Math.max(0, t.total - paid));
  const cash = state.pay.payments.filter((p) => p.method === 'DINHEIRO').reduce((s, p) => s + p.amount, 0);
  const change = round2(Math.min(Math.max(0, paid - t.total), cash));
  return { t, paid, remaining, change };
}

function renderPayment() {
  const p = state.pay;
  const { t, paid, remaining, change } = payState();
  const entryValue = p.entry ? Number(p.entry) / 100 : remaining;
  const quick = p.method === 'DINHEIRO'
    ? [...new Set([remaining, Math.ceil(remaining / 10) * 10, Math.ceil(remaining / 50) * 50, Math.ceil(remaining / 100) * 100])].filter((v) => v > 0).slice(0, 4)
    : [remaining];
  const done = remaining <= 0 && p.payments.length;
  openModal(`${modalHead('Pagamento', `${state.cart.length} produto(s) · ${esc(state.customer.name || 'Consumidor final')}${state.customer.doc ? ` · CPF ${esc(state.customer.doc)}` : ''}`)}
    <div class="pmb"><div class="pml">${PAYMENT_METHODS.map((m) => `<div class="pt ${p.method === m.code ? 'on' : ''}" data-m="${m.code}">${icon(m.icon, 22)}<div><b>${m.label}</b><span>${m.sub}</span></div></div>`).join('')}
      <span class="mut" style="font-size:11.5px;text-align:center;margin-top:4px"><kbd>↑</kbd> <kbd>↓</kbd> trocam a forma · números digitam o valor</span></div>
    <div class="pmc"><div class="lbl">${done ? 'Pagamento completo' : `Valor em ${esc(PAYMENT_METHODS.find((m) => m.code === p.method).label.toLowerCase())}`}</div>
      <div class="amt">${money(done ? 0 : entryValue)}<i></i></div>
      <div class="qk">${quick.map((v, i) => `<span data-q="${v}">${i === 0 ? 'Valor exato' : money(v)}</span>`).join('')}</div>
      <div class="pad">${['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫'].map((k) => `<span data-k="${k}">${k}</span>`).join('')}</div></div>
    <div class="pmr"><div class="lbl">Resumo do pagamento</div>
      <div class="tl"><span>Total da venda</span><b>${money(t.total)}</b></div>
      <div class="ap">${p.payments.map((x, i) => `<div>${icon(PAYMENT_METHODS.find((m) => m.code === x.method).icon, 16, '#16a34a')}<span>${esc(x.label)}</span><b>${money(x.amount)}</b><i data-del="${i}">${icon('x', 14)}</i></div>`).join('') || '<div><span class="mut">Nenhum pagamento lançado</span></div>'}</div>
      <div class="tl"><span>Total pago</span><b>${money(paid)}</b></div><div class="tl"><span>Restante</span><b>${money(remaining)}</b></div>
      <div class="troco"><span>TROCO</span><b>${money(change)}</b></div>
      <div class="opt"><span class="cb ${p.print ? 'on' : 'off'}" data-print>${p.print ? icon('check', 14, '#fff') : ''}</span>Imprimir cupom
        <span class="dis" style="margin-left:14px">NFC-e: próxima etapa</span></div></div></div>
    <div class="mf"><div class="btn" data-close>Voltar <kbd>Esc</kbd></div><div class="sp"></div>
      ${done ? `<div class="btn pri big" id="conclude">${icon('check', 18, '#fff')} Concluir venda <kbd>Enter</kbd></div>` : `<div class="btn pri big" id="addpay">${icon('plus', 18, '#fff')} Lançar ${money(entryValue)} <kbd>Enter</kbd></div>`}</div>`, { width: 1080 });

  const m = $('#modal');
  m.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('click', () => { p.method = el.dataset.m; p.entry = ''; renderPayment(); }));
  m.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('click', () => keyEntry(el.dataset.k)));
  m.querySelectorAll('[data-q]').forEach((el) => el.addEventListener('click', () => { addPayment(Number(el.dataset.q)); }));
  m.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => { p.payments.splice(Number(el.dataset.del), 1); renderPayment(); }));
  m.querySelector('[data-print]').addEventListener('click', () => { p.print = !p.print; renderPayment(); });
  $('#addpay')?.addEventListener('click', () => addPayment(entryValue));
  $('#conclude')?.addEventListener('click', concludeSale);
}

function keyEntry(k) {
  const p = state.pay;
  if (k === '⌫') p.entry = p.entry.slice(0, -1);
  else p.entry = (p.entry + k).replace(/^0+/, '').slice(0, 9);
  renderPayment();
}

function addPayment(value) {
  const p = state.pay;
  const { remaining } = payState();
  const v = round2(value);
  if (!(v > 0)) return;
  if (p.method !== 'DINHEIRO' && v > remaining + 0.001) { toast('Só o dinheiro pode passar do total (troco).', 'err'); return; }
  const m = PAYMENT_METHODS.find((x) => x.code === p.method);
  p.payments.push({ method: m.code, label: m.label, amount: v });
  p.entry = '';
  renderPayment();
}

document.addEventListener('keydown', (e) => {
  if (!state.pay || !$('#modal').innerHTML) return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); return keyEntry(e.key); }
  if (e.key === 'Backspace') { e.preventDefault(); return keyEntry('⌫'); }
  if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
    e.preventDefault();
    const idx = PAYMENT_METHODS.findIndex((m) => m.code === state.pay.method);
    const step = e.key === 'ArrowDown' ? 1 : PAYMENT_METHODS.length - 1;
    state.pay.method = PAYMENT_METHODS[(idx + step) % PAYMENT_METHODS.length].code;
    state.pay.entry = '';
    return renderPayment();
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if ($('#conclude')) return concludeSale();
    return $('#addpay')?.click();
  }
  return null;
}, true);

async function concludeSale() {
  if (state.concluding) return;
  state.concluding = true;
  try {
    const { t, paid, change } = payState();
    const seq = (Number(localStorage.getItem('pdv-seq') || 0) + 1);
    localStorage.setItem('pdv-seq', String(seq));
    const soldAt = new Date().toISOString();
    const pdvUuid = crypto.randomUUID();
    const payload = {
      pdv_uuid: pdvUuid,
      session_id: state.session.session_id,
      terminal: state.config.terminal,
      customer_name: state.customer.name || null,
      customer_doc: state.customer.doc || null,
      sold_at: soldAt,
      discount: state.saleDiscount,
      items: state.cart.map((it) => ({
        product_code: it.product_code, description: it.description, barcode: it.barcode, unit: it.unit,
        unit_factor: it.unit_factor, quantity: it.quantity, unit_price: it.unit_price, discount: it.discount,
      })),
      payments: state.pay.payments.map((p) => ({ method: p.method, amount: p.amount })),
    };
    const record = {
      pdv_uuid: pdvUuid,
      number: `${state.config.terminal}-${String(seq).padStart(6, '0')}`,
      session_id: state.session.session_id,
      sold_at: soldAt,
      operator_name: state.user.full_name,
      customer_doc: state.customer.doc,
      items: payload.items,
      payments: state.pay.payments,
      subtotal: t.subtotal,
      discount_total: t.discountTotal,
      total: t.total,
      paid,
      change,
      status: 'NA_FILA',
    };

    state.queue.push({ payload, at: soldAt });
    await persistQueue();
    state.history.unshift(record);
    await window.pdv.write('history', state.history.slice(0, 500));
    for (const it of state.cart) state.favorites[it.product_code] = (state.favorites[it.product_code] || 0) + it.quantity;
    window.pdv.write('favorites', state.favorites);

    const shouldPrint = state.pay.print;
    clearSale();
    closeModal();
    render();
    const trocoMsg = change > 0 ? ` · TROCO ${money(change)}` : '';

    // NFC-e: com o ERP no ar, envia a venda agora e imprime o DANFE NFC-e autorizado
    if (nfceOn() && state.token && state.online !== false) {
      showBusy('Emitindo NFC-e…', change > 0 ? `TROCO ${money(change)}` : 'Aguardando a autorização da SEFAZ');
      await syncQueue();
      closeModal();
      render();
      const st = record.nfce?.status;
      if (st === 'AUTORIZADA') toast(`NFC-e ${record.nfce.number} autorizada${trocoMsg}`, 'ok');
      else if (record.status !== 'SINCRONIZADA') toast(`Sem conexão: venda na fila, NFC-e sai ao sincronizar${trocoMsg}`, 'err');
      else toast(`Venda gravada, NFC-e não autorizada: ${record.nfce?.message || st}${trocoMsg}`, 'err');
      if (shouldPrint) printReceipt(record);
      return;
    }

    toast(`Venda concluída${trocoMsg}`, 'ok');
    if (shouldPrint) printReceipt(record);
    syncQueue();
  } finally {
    state.concluding = false;
  }
}

async function printReceipt(record) {
  const authorized = record.nfce?.status === 'AUTORIZADA';
  const html = authorized
    ? buildDanfceHtml(record, record.nfce, state.config.nfce?.issuer || {}, state.config)
    : buildReceiptHtml(record, state.config, nfceOn());
  const res = await window.pdv.printHtml({ html, printer: state.config.printer || null });
  if (!res?.ok && res?.reason && res.reason !== 'cancelled') toast(`Não foi possível imprimir: ${res.reason}`, 'err');
}

/* ── Fechamento ────────────────────────────────────────────────────── */
async function closeCash() {
  if (state.queue.length) {
    await syncQueue();
    if (state.queue.length) return toast(`Ainda há ${state.queue.length} venda(s) na fila. Conecte ao ERP antes de fechar o caixa.`, 'err');
  }
  const s = state.summary;
  if (!s) return null;
  const counted = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.code, state.counted?.[m.code] ?? s.expected[m.code] ?? 0]));
  openModal(`${modalHead('Fechar caixa?', `${esc(s.session.terminal)} · ${s.indicators.sales} vendas · ${money(s.indicators.total)}`)}
    <div class="fm"><span>Diferença total: <b>${money(Object.values(counted).reduce((a, b) => a + b, 0) - Object.values(s.expected).reduce((a, b) => a + b, 0))}</b></span>
    <label>Observação do fechamento</label><div class="in"><input id="cn" placeholder="Opcional"></div><div class="err" id="merr"></div></div>
    <div class="mf"><div class="btn" data-close>Voltar</div><div class="sp"></div><div class="btn pri big" id="cf">${icon('lock', 18, '#fff')} Fechar caixa</div></div>`, { width: 520 });
  $('#cf').addEventListener('click', async () => {
    const res = await api('POST', `/api/pdv/caixa/${s.session.session_id}/fechar`, { counted, notes: $('#cn').value });
    if (!res.ok) { $('#merr').textContent = res.data?.message || 'Não foi possível fechar o caixa.'; return; }
    await window.pdv.printHtml({ html: buildClosingHtml(res.data.data, counted, state.config), printer: state.config.printer || null });
    state.session = null;
    await window.pdv.write('session', null);
    closeModal();
    toast('Caixa fechado.', 'ok');
    logout();
  });
  return null;
}

async function printClosing() {
  const s = state.summary;
  if (!s) return;
  const counted = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.code, state.counted?.[m.code] ?? s.expected[m.code] ?? 0]));
  await window.pdv.printHtml({ html: buildClosingHtml(s, counted, state.config), printer: state.config.printer || null });
}

/* ── Login e configuração ──────────────────────────────────────────── */
function renderLogin() {
  $('#modal').innerHTML = '';
  $('#root').innerHTML = `<div class="lg"><div class="lgl"><div class="lgb">${logo(88)}<div><div class="w1">CONSART</div><div class="w2">STARTER</div><div class="w3">FRENTE DE CAIXA</div></div></div>
    <h2>Venda rápida, conectada<br>ao seu ERP.</h2>
    <ul><li>${icon('zap', 18, '#86efac')}Leitor de código de barras e atalhos de teclado</li><li>${icon('wifi', 18, '#86efac')}Continua vendendo sem internet e sincroniza depois</li><li>${icon('shield', 18, '#86efac')}Cada venda baixa o estoque no Consart ERP</li><li>${icon('chart', 18, '#86efac')}Abertura, sangria e fechamento de caixa conferidos</li></ul>
    <div class="lgf">${esc(state.config.storeName || 'BH3 Distribuidora')} · ${esc(state.config.terminal || '')} · v${esc(state.version || '1.0.0')}</div></div>
    <div class="lgr"><form class="lgc" id="lf"><h3>Entrar no caixa</h3><p>Use seu usuário do PDV cadastrado no ERP.</p>
      <label>Operador</label><div class="in">${icon('user', 18, '#64748b')}<input name="username" autocomplete="username" value="${esc(localStorage.getItem('pdv-last-user') || '')}"></div>
      <label>Senha</label><div class="in">${icon('lock', 18, '#64748b')}<input name="password" type="password" autocomplete="current-password"></div>
      <label>Caixa</label><div class="in">${icon('store', 18, '#64748b')}<span>${esc(state.config.terminal)} · ${esc(state.config.storeName || 'Loja')}</span><span class="sp"></span><span class="mut" id="cfg" style="cursor:pointer">${icon('settings', 16)}</span></div>
      <button class="btn pri big w">Entrar <kbd>Enter</kbd></button><div class="err" id="lerr"></div>
      <div class="lgs" id="lst"><span class="chip"><i style="background:#94a3b8"></i>Verificando ERP…</span><span class="mut">Catálogo: ${num(state.catalog.length)} produtos${state.catalogAt ? ` · ${hhmm(state.catalogAt)}` : ''}</span></div></form></div></div>`;
  const form = $('#lf');
  form.querySelector(localStorage.getItem('pdv-last-user') ? '[name=password]' : '[name=username]').focus();
  $('#cfg').addEventListener('click', () => showSetup(false));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { username, password } = Object.fromEntries(new FormData(form).entries());
    if (!username || !password) { $('#lerr').textContent = 'Informe usuário e senha.'; return; }
    $('#lerr').textContent = '';
    const res = await api('POST', '/api/pdv/auth/login', { username, password, terminal: state.config.terminal });
    if (res.ok) {
      state.token = res.data.token;
      state.user = res.data.user;
      await window.pdv.rememberLogin({ username, password, user: res.data.user });
    } else if (res.offline) {
      const user = await window.pdv.offlineLogin({ username, password });
      if (!user) { $('#lerr').textContent = 'Sem conexão com o ERP e este usuário ainda não entrou neste caixa.'; return; }
      state.user = user;
      state.token = null;
      toast('Entrou sem internet. As vendas ficam na fila até o ERP voltar.', 'err');
    } else {
      $('#lerr').textContent = res.data?.message || 'Não foi possível entrar.';
      return;
    }
    localStorage.setItem('pdv-last-user', username);
    afterLogin();
  });
  api('GET', '/api/pdv/health').then((r) => {
    const el = $('#lst .chip');
    if (el) el.outerHTML = `<span class="chip ${r.ok ? 'ok' : 'off'}"><i></i>${r.ok ? 'ERP online' : 'ERP fora do ar'}</span>`;
  });
}

async function showSetup(firstRun) {
  const printers = await window.pdv.printers().catch(() => []);
  const c = state.config;
  openModal(`${modalHead(firstRun ? 'Configurar este caixa' : 'Ajustes do caixa', 'Fica salvo neste computador', !firstRun)}
    <form class="fm" id="sf">
      <label>Endereço do ERP</label><div class="in"><input name="apiUrl" value="${esc(c.apiUrl || '')}" placeholder="https://seu-erp.run.app"></div>
      <span class="hint">O mesmo endereço que você usa para abrir o Consart ERP no navegador.</span>
      <label>Nome deste caixa</label><div class="in"><input name="terminal" value="${esc(c.terminal || 'CAIXA-01')}"></div>
      <label>Nome da loja (sai no cupom)</label><div class="in"><input name="storeName" value="${esc(c.storeName || 'BH3 DISTRIBUIDORA')}"></div>
      <label>CNPJ / endereço (sai no cupom)</label><div class="in"><input name="storeDoc" value="${esc(c.storeDoc || '')}"></div>
      <label>Impressora do cupom</label><div class="in"><select name="printer"><option value="">Perguntar ao imprimir</option>${printers.map((p) => `<option ${p.name === c.printer ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="err" id="serr"></div></form>
    <div class="mf">${firstRun ? '' : '<div class="btn" data-close>Cancelar</div>'}<div class="sp"></div><button class="btn pri big" form="sf">Salvar</button></div>`, { width: 600, lock: firstRun });
  $('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData($('#sf')).entries());
    data.apiUrl = String(data.apiUrl || '').trim().replace(/\/+$/, '');
    data.terminal = String(data.terminal || '').trim().toUpperCase() || 'CAIXA-01';
    if (!/^https?:\/\//.test(data.apiUrl)) { $('#serr').textContent = 'Informe o endereço completo, começando com https://'; return; }
    state.config = { ...state.config, ...data };
    await window.pdv.write('config', state.config);
    const r = await api('GET', '/api/pdv/health');
    if (!r.ok) { $('#serr').textContent = 'Salvo, mas o ERP não respondeu nesse endereço. Confira e tente de novo.'; return; }
    state.lockModal = false;
    closeModal();
    toast('Configuração salva.', 'ok');
    if (state.user) render(); else renderLogin();
  });
}

function logout() {
  state.user = null;
  state.token = null;
  state.summary = null;
  clearSale();
  closeModal();
  renderLogin();
}

setInterval(() => {
  if (state.user && state.token && state.queue.length) syncQueue();
  else if (state.user && state.token) api('GET', '/api/pdv/health').then(renderHeaderOnly);
}, SYNC_INTERVAL_MS);

window.pdv.info().then((i) => { state.version = i.version; }).catch(() => {});
boot();
