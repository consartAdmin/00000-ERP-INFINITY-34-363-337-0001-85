// ╔══════════════════════════════════════════════════════════════════════╗
// ║ products.columns.js — Engrenagem ⚙️: colunas da Lista de Produtos    ║
// ║ CONSART ERP | ESM                                                   ║
// ║                                                                      ║
// ║ Por coluna: visível, largura e alinhamento (título e dados).         ║
// ║ Salvo por USUÁRIO no banco (/api/user-table-preferences/products.list)║
// ║ — não se perde ao limpar o navegador ou trocar de computador.        ║
// ║ O localStorage fica só como cache para aplicar o layout sem piscar.  ║
// ║ Aplicado por um <style> gerado: sobrevive a cada re-render da tabela.║
// ╚══════════════════════════════════════════════════════════════════════╝

import { qs, sanitize } from './products.utils.js';
import { apiFetch } from '/public/includes/js/apiFetch.js';

const TABLE_KEY = 'products.list';
const PREFS_URL = `/api/user-table-preferences/${TABLE_KEY}`;
const CACHE_KEY = 'consart.products.columns.v1'; // mesma chave antiga → migra o que já existia
const MIN_WIDTH = 40;
const MAX_WIDTH = 1200;

const ALIGNS = [
  { value: '', label: 'Padrão' },
  { value: 'left', label: '⬅ Esquerda' },
  { value: 'center', label: '↔ Centro' },
  { value: 'right', label: '➡ Direita' },
];
const ALIGN_VALUES = new Set(['left', 'center', 'right']);

// Código, Descrição e Ações são colunas congeladas (table-freeze-*): sempre visíveis.
const BASE_COLUMNS = [
  { key: 'code', cls: 'col-code', label: 'Código', width: 70, locked: true },
  { key: 'descricao', cls: 'col-descricao', label: 'Descrição', width: 420, locked: true },
  { key: 'codbarras', cls: 'col-codbarras', label: 'Cód. Barras', width: 120 },
  { key: 'ref', cls: 'col-ref', label: 'Ref. Fab.', width: 100 },
  { key: 'preco-custo', cls: 'col-preco-custo', label: 'Preço de Custo', width: 130 },
  { key: 'preco-varejo', cls: 'col-preco-varejo', label: 'Preço Varejo', width: 130 },
  // preços adicionais entram aqui (dinâmicos, vindos da API)
  { key: 'estoque', cls: 'col-estoque', label: 'Estoque', width: 100 },
  { key: 'local', cls: 'col-local', label: 'Localização', width: 100, locationsOnly: true },
  { key: 'ativo', cls: 'col-ativo', label: 'Status', width: 100 },
  { key: 'fiscal', cls: 'col-fiscal', label: 'Prod. Fiscal', width: 120 },
  { key: 'img', cls: 'col-img', label: 'Imagem', width: 150, imageOnly: true },
  { key: 'actions', cls: 'col-actions', label: 'Ações', width: 140, locked: true },
];

const PRICES_INSERT_AT = BASE_COLUMNS.findIndex((c) => c.key === 'estoque');

let additionalPrices = [];
let showImages = true;
let showLocations = true;
let prefs = readCache();

/** Classe CSS da coluna de um preço adicional (a chave vem da API). */
export function priceColumnClass(priceKey) {
  const slug = String(priceKey ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `col-price-${slug || 'x'}`;
}

/* ------------------------------------------------------------ persistência */

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // modo privado / armazenamento bloqueado: o banco continua valendo
  }
}

function setStatus(text, kind = '') {
  const el = qs('#productsColumnsStatus');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

// Edições no modal são só pré-visualização até clicar em "Salvar".
// savedPrefs = último layout salvo; Fechar sem salvar volta para ele.
let savedPrefs = clone(prefs);
let dirty = false;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function markDirty() {
  dirty = true;
  setStatus('● Alterações não salvas', 'dirty');
  const btn = qs('[data-pc-save]');
  if (btn) btn.disabled = false;
}

function markClean(text = '', kind = '') {
  dirty = false;
  setStatus(text, kind);
  const btn = qs('[data-pc-save]');
  if (btn) btn.disabled = true;
}

async function savePrefs() {
  const btn = qs('[data-pc-save]');
  if (btn) btn.disabled = true;
  setStatus('Salvando…');

  try {
    // layout vazio = padrão → apaga o registro em vez de guardar {}
    if (Object.keys(prefs).length) {
      await apiFetch(PREFS_URL, { method: 'PUT', body: JSON.stringify({ prefs }) });
    } else {
      await apiFetch(PREFS_URL, { method: 'DELETE' });
    }
    savedPrefs = clone(prefs);
    writeCache();
    markClean('✓ Salvo no seu usuário', 'ok');
  } catch (err) {
    console.warn('[products.columns] falha ao salvar preferências:', err);
    setStatus('Não foi possível salvar. Tente novamente.', 'error');
    if (btn) btn.disabled = false;
  }
}

/** Descarta a pré-visualização e volta ao último layout salvo. */
function discardChanges() {
  prefs = clone(savedPrefs);
  applyStyles();
  markClean();
}

/** Busca o layout do usuário no banco; na 1ª vez, migra o que estava no navegador. */
async function loadServerPrefs() {
  try {
    const data = await apiFetch(PREFS_URL);
    if (data?.prefs && typeof data.prefs === 'object') {
      if (dirty) return; // usuário já está editando: não sobrescreve
      prefs = data.prefs;
      savedPrefs = clone(prefs);
      writeCache();
      applyStyles();
      if (isModalOpen()) renderModal();
    } else if (Object.keys(prefs).length) {
      // ainda não existe no banco, mas há layout antigo neste navegador → envia
      await apiFetch(PREFS_URL, { method: 'PUT', body: JSON.stringify({ prefs }) });
    }
  } catch (err) {
    console.warn('[products.columns] preferências do servidor indisponíveis, usando cache local:', err);
  }
}

/* ---------------------------------------------------------------- colunas */

function getColumns() {
  const prices = additionalPrices.map(({ key, label }) => ({
    key: `price:${key}`,
    cls: priceColumnClass(key),
    label,
    width: 130,
  }));

  const columns = [...BASE_COLUMNS];
  columns.splice(PRICES_INSERT_AT, 0, ...prices);
  return columns
    .filter((c) => !c.imageOnly || showImages)
    .filter((c) => !c.locationsOnly || showLocations);
}

const isVisible = (col) => col.locked || prefs[col.key]?.hidden !== true;

function widthOf(col) {
  const width = Number(prefs[col.key]?.width);
  return Number.isFinite(width) && width >= MIN_WIDTH ? Math.min(width, MAX_WIDTH) : null;
}

function alignOf(col, part) {
  const value = prefs[col.key]?.[part];
  return ALIGN_VALUES.has(value) ? value : '';
}

/** Gera as regras CSS a partir das preferências salvas. */
function applyStyles() {
  let style = document.getElementById('productsColumnsStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'productsColumnsStyle';
    document.head.appendChild(style);
  }

  const rules = [];

  getColumns().forEach((col) => {
    const th = `.page .table th.${col.cls}`;
    const td = `.page .table td.${col.cls}`;

    if (!isVisible(col)) {
      rules.push(`${th}, ${td} { display: none !important; }`);
      return;
    }

    const width = widthOf(col);
    if (width) {
      rules.push(`${th}, ${td} { width: ${width}px !important; min-width: ${width}px !important; max-width: ${width}px !important; overflow: hidden; text-overflow: ellipsis; }`);
    }

    const headAlign = alignOf(col, 'alignHead');
    if (headAlign) rules.push(`${th} { text-align: ${headAlign} !important; }`);

    const cellAlign = alignOf(col, 'alignCell');
    if (cellAlign) rules.push(`${td} { text-align: ${cellAlign} !important; }`);
  });

  // Código e Descrição são congeladas: o deslocamento sticky depende da largura delas.
  const code = widthOf(BASE_COLUMNS[0]);
  const desc = widthOf(BASE_COLUMNS[1]);
  if (code || desc) {
    rules.push(`.page .table.table-freeze-left-3 {${code ? ` --table-freeze-col-2-width: ${code}px;` : ''}${desc ? ` --table-freeze-col-3-width: ${desc}px;` : ''} }`);
  }

  style.textContent = rules.join('\n');
}

/** Chamado pelo render a cada carga: informa as colunas dinâmicas e reaplica. */
export function syncColumns({
  additionalPriceColumns = [],
  showImages: images = true,
  showLocations: locations = true,
} = {}) {
  additionalPrices = additionalPriceColumns;
  showImages = images;
  showLocations = locations;
  applyStyles();
  if (isModalOpen()) renderModal();
}

/* ------------------------------------------------------------------ modal */

let modal = null;
let trigger = null;

const isModalOpen = () => Boolean(modal?.classList.contains('is-open'));

function alignSelect(col, part, label) {
  const current = alignOf(col, part);
  const options = ALIGNS.map((a) =>
    `<option value="${a.value}" ${a.value === current ? 'selected' : ''}>${a.label}</option>`).join('');
  return `<select class="pc-align" data-pc-align="${part}" aria-label="${sanitize(label)}">${options}</select>`;
}

function renderModal() {
  const tbody = qs('#productsColumnsTbody');
  if (!tbody) return;

  tbody.innerHTML = getColumns().map((col) => {
    const width = widthOf(col);
    const name = sanitize(col.label);
    return `
      <tr data-key="${sanitize(col.key)}" class="${isVisible(col) ? '' : 'is-hidden'}">
        <td class="pc-col-show">
          <input type="checkbox" data-pc-visible aria-label="Mostrar ${name}"
            ${isVisible(col) ? 'checked' : ''} ${col.locked ? 'disabled title="Coluna fixa da tabela"' : ''}>
        </td>
        <td class="pc-col-name">${name}${col.locked ? ' <small class="pc-locked">fixa</small>' : ''}</td>
        <td class="pc-col-width">
          <input type="number" class="pc-width" data-pc-width min="${MIN_WIDTH}" max="${MAX_WIDTH}" step="10"
            placeholder="${col.width}" value="${width ?? ''}" aria-label="Largura de ${name}"
            title="Largura em px (vazio = padrão ${col.width}px)">
        </td>
        <td class="pc-col-align">${alignSelect(col, 'alignHead', `Alinhamento do título de ${col.label}`)}</td>
        <td class="pc-col-align">${alignSelect(col, 'alignCell', `Alinhamento dos dados de ${col.label}`)}</td>
      </tr>`;
  }).join('');
}

function openModal() {
  renderModal();
  markClean();
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  trigger?.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => modal.querySelector('.modal__close')?.focus());
}

/** Fecha o modal; com alterações não salvas, pergunta antes de descartar. */
function closeModal() {
  if (!modal) return;
  if (dirty) {
    if (!confirm('Há alterações não salvas nas colunas. Descartar e fechar?')) return;
    discardChanges();
  }
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.focus();
}

function updatePref(key, patch) {
  const next = { ...(prefs[key] || {}), ...patch };
  Object.keys(next).forEach((k) => (next[k] == null || next[k] === '') && delete next[k]);

  if (Object.keys(next).length) prefs[key] = next;
  else delete prefs[key];

  applyStyles(); // pré-visualiza na tabela
  markDirty();
}

/** Restaurar padrão: pré-visualiza o layout original; vale ao clicar em Salvar. */
function resetPrefs() {
  prefs = {};
  applyStyles();
  renderModal();
  markDirty();
}

export function bindColumnsSettings() {
  trigger = qs('#btnColumnsSettings');
  modal = qs('#productsColumnsModal');
  if (!trigger || !modal) return;

  applyStyles();
  loadServerPrefs();

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isModalOpen()) closeModal();
    else openModal();
  });

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-pc-close]')) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-pc-reset]')) resetPrefs();
    if (event.target.closest('[data-pc-save]')) savePrefs();
  });

  modal.addEventListener('change', (event) => {
    const row = event.target.closest('tr[data-key]');
    const key = row?.dataset.key;
    if (!key) return;

    if (event.target.matches('[data-pc-visible]')) {
      updatePref(key, { hidden: event.target.checked ? null : true });
      row.classList.toggle('is-hidden', !event.target.checked);
    } else if (event.target.matches('[data-pc-align]')) {
      updatePref(key, { [event.target.dataset.pcAlign]: event.target.value || null });
    }
  });

  modal.addEventListener('input', (event) => {
    const key = event.target.closest('tr[data-key]')?.dataset.key;
    if (!key || !event.target.matches('[data-pc-width]')) return;

    const raw = String(event.target.value).trim();
    const width = Number(raw);

    // vazio = volta ao padrão; valores fora da faixa são ignorados até ficarem válidos
    if (!raw) updatePref(key, { width: null });
    else if (Number.isFinite(width) && width >= MIN_WIDTH && width <= MAX_WIDTH) updatePref(key, { width: Math.round(width) });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isModalOpen()) closeModal();
  });
}
