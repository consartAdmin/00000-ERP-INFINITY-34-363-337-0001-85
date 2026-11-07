// menuConsart.js — Menu Global PRODNEX ERP (ESM)
// Busca mostra somente links existentes e não bloqueados no menu.
// O script de permissões deve marcar links bloqueados com hidden=true,
// style.display='none' ou class='modulo-bloqueado'.
// Itens com `feature` ficam ocultos quando a appFeature correspondente está desativada.

import { initProductLocationsFeature } from './productLocationsFeature.js';

// O menu vem da tabela public."moduleSystem" (tela "Criação de Módulos").
// Formato de cada item: { type: 'dropdown'|'submenu'|'link', id, htmlId,
// label, href, className, feature, external, children }.
// id = id do módulo (userModules); itens públicos vêm com id null.
const MENU_API_URL = '/api/module-system/menu';
const MENU_CACHE_KEY = 'consart:menu-config';

let MENU_CONFIG = [];

// Tema visual do menu: 'dock' (cápsula flutuante) ou 'light' (barra branca).
const MENU_THEME = window.CONSART_MENU_THEME || 'dock';

function readMenuCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || 'null');
    return Array.isArray(cached) ? cached : null;
  } catch {
    return null;
  }
}

function writeMenuCache(menu) {
  try { localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(menu)); } catch { }
}

// Busca o menu na API; se a API falhar, usa a última versão salva no navegador.
async function loadMenuConfig() {
  try {
    const response = await fetch(MENU_API_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false || !Array.isArray(payload.data)) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    writeMenuCache(payload.data);
    return payload.data;
  } catch (error) {
    const cached = readMenuCache();
    console.warn('[MENU] Falha ao carregar o menu da API' +
      (cached ? '; usando a última versão salva.' : '.'), error);
    return cached || [];
  }
}

// Separa o emoji do início do nome (vem da tela "Criação de Módulos") e tira as
// setas antigas (▹ ▸) do fim: o ícone vai num quadrinho próprio e o texto alinha.
const LEADING_EMOJI_RE = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|⃣|\p{Emoji_Modifier}|‍(?:\p{Extended_Pictographic}|️)+)*)\s*/u;

function splitLabel(label = '') {
  const text = String(label);
  const match = text.match(LEADING_EMOJI_RE);
  const icon = match ? match[1] : '';
  const rest = (match ? text.slice(match[0].length) : text).replace(/[\s▹▸›>]+$/u, '').trim();
  return { icon, text: rest || text.trim() };
}

// Ícones de linha monocromáticos (estilo "outline"), escolhidos pelo nome do
// menu. O emoji do cadastro continua no banco; aqui ele só vira fallback.
const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M6 6V4h11v2"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4"/><path d="M12 16V8"/><path d="M16 16v-6"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  badge: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0"/><path d="M14 10h4M14 14h3"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  file: '<path d="M14 3H6v18h12V7l-4-4Z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};

// Ordem importa: o primeiro termo encontrado no nome (sem acento) vence.
const ICON_RULES = [
  ['inicio', 'home'], ['suporte', 'chat'], ['e-commerce', 'cart'], ['ecommerce', 'cart'],
  ['gestao erp', 'layers'], ['comercial', 'briefcase'], ['vendas', 'trend'],
  ['logistica', 'truck'], ['transportadora', 'truck'], ['financeiro', 'wallet'],
  ['relatorio', 'chart'], ['contabilidade', 'calculator'], ['configurac', 'settings'],
  ['ferramenta', 'wrench'], ['cliente', 'users'], ['produto', 'package'],
  ['ajustes em lote', 'sliders'], ['lote', 'sliders'], ['secundario', 'list'],
  ['fiscal', 'receipt'], ['imposto', 'receipt'], ['estoque', 'archive'],
  ['despesa', 'card'], ['caixa', 'cash'], ['moviment', 'cash'], ['r.h', 'badge'],
  ['rh', 'badge'], ['colaborador', 'badge'], ['auxiliar', 'database'], ['cadastro', 'database'],
  ['nota', 'file'], ['documento', 'file'],
];

function normalizeText(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function iconFor(text) {
  const norm = normalizeText(text);
  const rule = ICON_RULES.find(([term]) => norm.includes(term));
  return rule ? rule[1] : null;
}

function svgIcon(name, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.dot}</svg>`;
}

// mode: 'svg' → ícone de linha (topo, títulos de coluna); 'none' → só o texto.
function labelNodes(label, { mode = 'svg', size = 16 } = {}) {
  const { text } = splitLabel(label);
  const nodes = [];
  if (mode === 'svg') {
    const ico = document.createElement('span');
    ico.className = 'menu-ico';
    ico.innerHTML = svgIcon(iconFor(text) || 'dot', size);
    nodes.push(ico);
  }
  const span = document.createElement('span');
  span.className = 'menu-label';
  span.textContent = text;
  nodes.push(span);
  return nodes;
}

const CHEVRON_SVG = '<svg class="menu-chevron" viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function isCurrentPage(href) {
  if (!href || href === '#') return false;
  try {
    const url = new URL(href, location.href);
    return url.origin === location.origin && url.pathname === location.pathname;
  } catch {
    return false;
  }
}

function createLink(item, extraClass = '', { topLevel = false } = {}) {
  const a = document.createElement('a');
  a.append(...labelNodes(item.label, { mode: topLevel ? 'svg' : 'none' }));
  a.title = splitLabel(item.label).text;
  a.href = (item.href || '#').trim();
  if (item.id != null) a.dataset.moduloId = String(item.id);
  if (item.feature) a.dataset.feature = item.feature;
  if (extraClass) a.classList.add(extraClass);
  if (isCurrentPage(a.getAttribute('href'))) a.classList.add('is-current');
  if (item.external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Suporte via WhatsApp: (31) 9 8923-0220';
  }
  return a;
}

// Coluna do painel (mega menu): título do submenu + seus links.
function createMegaColumn(title, links) {
  const col = document.createElement('div');
  col.classList.add('mega-col');
  const head = document.createElement('div');
  head.classList.add('mega-col-title');
  head.append(...labelNodes(title, { size: 14 }));
  col.appendChild(head);
  links.forEach(child => col.appendChild(createLink(child)));
  return col;
}

function linkVisivel(link) {
  return !link.hidden && link.style.display !== 'none' &&
    !link.classList.contains('modulo-bloqueado') && !link.hasAttribute('data-bloqueado');
}

// Esconde colunas do painel sem nenhum link liberado (permissões/appFeatures).
function refreshMegaColumns(content) {
  const cols = [...content.querySelectorAll('.mega-col')];
  if (!cols.length) return;
  let visiveis = 0;
  cols.forEach(col => {
    const ok = [...col.querySelectorAll('a')].some(linkVisivel);
    col.hidden = !ok;
    if (ok) visiveis++;
  });
  content.style.setProperty('--mega-cols', String(Math.max(1, Math.min(visiveis, 4))));
}

const openDropdowns = new Set();

function closeAllDropdowns(except) {
  openDropdowns.forEach(close => { if (close !== except) close(); });
}

function createDropdown(item) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('dropdown');
  if (item.id != null) wrapper.dataset.moduloId = String(item.id);
  if (item.htmlId) wrapper.id = item.htmlId;

  const btn = document.createElement('div');
  btn.classList.add('menu-item');
  btn.tabIndex = 0;
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.append(...labelNodes(item.label));
  btn.title = splitLabel(item.label).text;
  btn.insertAdjacentHTML('beforeend', CHEVRON_SVG);

  const content = document.createElement('div');
  content.classList.add('dropdown-content');
  const children = item.children || [];
  const isMega = children.some(child => child.type === 'submenu');

  if (isMega) {
    // Painel com uma coluna por submenu (tudo à vista, sem submenu lateral).
    content.classList.add('mega-menu');
    const soltos = children.filter(child => child.type === 'link');
    if (soltos.length) content.appendChild(createMegaColumn(item.label, soltos));
    children.filter(child => child.type === 'submenu')
      .forEach(sub => content.appendChild(createMegaColumn(sub.label, sub.children || [])));
  } else {
    children.filter(child => child.type === 'link')
      .forEach(child => content.appendChild(createLink(child)));
  }
  wrapper.append(btn, content);

  if (content.querySelector('a.is-current')) wrapper.classList.add('is-active');

  let openTimeout;
  let closeTimeout;
  const open = () => {
    closeAllDropdowns(close);
    if (isMega) refreshMegaColumns(content);
    content.style.left = '';
    content.style.right = '';
    content.classList.add('open');
    wrapper.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    openDropdowns.add(close);
    if (!isMega) {
      const rect = content.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        content.style.left = 'auto';
        content.style.right = '0';
      }
    }
  };
  function close() {
    clearTimeout(openTimeout);
    content.classList.remove('open');
    wrapper.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    openDropdowns.delete(close);
  }

  // Mouse: abre ao passar; toque (tablet) e teclado: abre/fecha no clique/Enter.
  wrapper.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(closeTimeout);
    openTimeout = setTimeout(open, 120);
  });
  wrapper.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(openTimeout);
    closeTimeout = setTimeout(close, 220);
  });
  btn.addEventListener('click', () => {
    clearTimeout(openTimeout);
    if (content.classList.contains('open')) close();
    else open();
  });
  btn.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      open();
      content.querySelector('a:not([hidden])')?.focus();
    }
  });
  return wrapper;
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAllDropdowns();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest?.('.menu-principal .dropdown')) closeAllDropdowns();
});

function flattenMenu(items, parentPath = '') {
  return items.flatMap(item => {
    const path = parentPath ? `${parentPath} › ${item.label}` : item.label;
    const current = item.type === 'link' ? [{
      id: item.id != null ? String(item.id) : null, label: item.label, href: item.href.trim(), path,
    }] : [];
    return item.children ? current.concat(flattenMenu(item.children, path)) : current;
  });
}

function mountMenuSearch(menuElement) {
  const searchWrapper = document.createElement('div');
  searchWrapper.classList.add('menu-search-wrapper');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Buscar módulos...';
  input.classList.add('menu-search-input');
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Buscar módulos');
  searchWrapper.insertAdjacentHTML('afterbegin',
    '<svg class="menu-search-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">' +
    '<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="m13 13 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');
  const kbd = document.createElement('kbd');
  kbd.classList.add('menu-search-kbd');
  kbd.textContent = 'Ctrl K';
  kbd.title = 'Atalho: Ctrl + K';
  const resultsBox = document.createElement('div');
  resultsBox.classList.add('menu-search-results');
  resultsBox.hidden = true;
  const flatIndex = flattenMenu(MENU_CONFIG);
  let activeIndex = -1;
  let currentResults = [];

  // Não usa getClientRects/offsetParent: dropdown fechado não significa bloqueado.
  function moduloEstaLiberado(moduloId, href) {
    const links = menuElement.querySelectorAll('a[data-modulo-id]');
    return Array.from(links).some(link => {
      if (link.dataset.moduloId !== String(moduloId)) return false;
      if (href && link.getAttribute('href')?.trim() !== href.trim()) return false;
      const style = getComputedStyle(link);
      return link.isConnected && !link.hidden &&
        link.style.display !== 'none' && style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !link.classList.contains('modulo-bloqueado');
    });
  }

  const closeResults = () => {
    resultsBox.hidden = true;
    resultsBox.replaceChildren();
    activeIndex = -1;
    currentResults = [];
  };
  const setActive = index => {
    const rows = [...resultsBox.querySelectorAll('.menu-search-item')];
    rows.forEach(row => row.classList.remove('active'));
    if (rows[index]) {
      rows[index].classList.add('active');
      rows[index].scrollIntoView({ block: 'nearest' });
    }
  };
  const goToActive = () => {
    const item = currentResults[activeIndex];
    if (item?.href) location.assign(item.href);
  };

  input.addEventListener('input', () => {
    const value = input.value.trim().toLocaleLowerCase('pt-BR');
    if (!value) return closeResults();
    currentResults = flatIndex.filter(item => {
      const match = item.label.toLocaleLowerCase('pt-BR').includes(value) ||
        item.path.toLocaleLowerCase('pt-BR').includes(value);
      return match && moduloEstaLiberado(item.id, item.href);
    }).slice(0, 12);
    resultsBox.replaceChildren();
    activeIndex = -1;
    if (!currentResults.length) {
      const empty = document.createElement('div');
      empty.classList.add('no-results');
      empty.textContent = 'Nenhum módulo encontrado';
      resultsBox.appendChild(empty);
    } else {
      currentResults.forEach((item, index) => {
        const row = document.createElement('div');
        row.classList.add('menu-search-item');
        const parts = item.path.split(' › ');
        const { text } = splitLabel(parts[parts.length - 1]);
        const ico = document.createElement('span');
        ico.className = 'menu-ico';
        ico.innerHTML = svgIcon(parts.slice(0, -1).reverse().map(iconFor).find(Boolean) || iconFor(text) || 'dot', 15);
        const body = document.createElement('span');
        body.className = 'menu-search-text';
        const title = document.createElement('strong');
        title.textContent = text;
        const trail = document.createElement('small');
        trail.textContent = parts.slice(0, -1).map(p => splitLabel(p).text).join(' › ');
        body.append(title, trail);
        row.append(ico, body);
        row.tabIndex = 0;
        row.addEventListener('mouseenter', () => {
          activeIndex = index;
          setActive(index);
        });
        row.addEventListener('click', () => location.assign(item.href));
        resultsBox.appendChild(row);
      });
    }
    resultsBox.hidden = false;
  });

  input.addEventListener('keydown', event => {
    const count = resultsBox.querySelectorAll('.menu-search-item').length;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeResults();
      input.blur();
      return;
    }
    if (!count) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % count;
      setActive(activeIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + count) % count;
      setActive(activeIndex);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      goToActive();
    }
  });

  document.addEventListener('click', event => {
    if (!searchWrapper.contains(event.target)) closeResults();
  });
  // Ctrl+K (ou Cmd+K) foca a busca de qualquer tela.
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      closeAllDropdowns();
      input.focus();
      input.select();
    }
  });
  searchWrapper.append(input, kbd, resultsBox);
  menuElement.prepend(searchWrapper);
}

let menuBuildStarted = false;

async function buildMenuPrincipal() {
  if (menuBuildStarted || document.querySelector('.menu-principal')) return;
  menuBuildStarted = true;
  MENU_CONFIG = await loadMenuConfig();
  const menu = document.createElement('div');
  menu.classList.add('menu-principal');
  menu.dataset.theme = MENU_THEME;
  Object.assign(menu.style, {
    height: 'auto', minHeight: '0', bottom: 'auto', pointerEvents: 'none',
  });
  mountMenuSearch(menu);
  MENU_CONFIG.forEach(item => {
    if (item.type === 'link') menu.appendChild(createLink(item, item.className || '', { topLevel: true }));
    else if (item.type === 'dropdown') menu.appendChild(createDropdown(item));
  });
  [...menu.children].forEach(child => { child.style.pointerEvents = 'auto'; });
  const mount = document.getElementById('menuConsartMount') ||
    document.getElementById('menu-consart-mount');
  if (mount) mount.appendChild(menu);
  else document.body.prepend(menu);

  // appFeature PRODUCT_LOCATIONS: LOCATIONS_DISABLED → oculta os links de localização
  initProductLocationsFeature({ root: menu }).catch(() => { });

  // Dispara somente depois que todos os links existem no DOM.
  try {
    window.CONSART_MENU_CONFIG = MENU_CONFIG;
    window.dispatchEvent(new CustomEvent('consart:menu-ready', {
      detail: { MENU_CONFIG, menuElement: menu },
    }));
  } catch (error) {
    console.warn('[MENU] Não foi possível emitir consart:menu-ready:', error);
  }
  console.log('[MENU] Menu principal gerado e fixado no topo.');
}

function initMenuConsart() {
  buildMenuPrincipal()
    .catch(error => console.error('[MENU] Erro ao montar menu:', error));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMenuConsart, { once: true });
} else {
  initMenuConsart();
}
