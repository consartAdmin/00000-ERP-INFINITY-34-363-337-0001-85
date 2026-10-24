// ╔══════════════════════════════════════════════════════════════════════╗
// ║ compactSelect.js — Lista do <select> com altura limitada (ESM)      ║
// ║ CONSART ERP                                                         ║
// ║ - A lista nativa do navegador abre até o fim da tela e não aceita   ║
// ║   CSS de altura. Aqui o clique abre uma lista própria com rolagem. ║
// ║ - O <select> continua sendo a fonte do valor (form, required,       ║
// ║   change, setas do teclado e código que preenche as options).       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const ROW_HEIGHT = 24;
const OPEN_KEYS = new Set([' ', 'Enter', 'F4']);

let openState = null;

function closePanel({ focusSelect = false } = {}) {
  if (!openState) return;

  const { select, panel, abort } = openState;
  abort.abort();
  panel.remove();
  select.setAttribute('aria-expanded', 'false');
  openState = null;

  if (focusSelect) select.focus({ preventScroll: true });
}

function choose(select, value) {
  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  closePanel({ focusSelect: true });
}

function positionPanel(select, panel, maxRows) {
  const rect = select.getBoundingClientRect();
  const maxHeight = maxRows * ROW_HEIGHT + 8;
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const openUp = spaceBelow < Math.min(maxHeight, 160) && spaceAbove > spaceBelow;
  const height = Math.min(maxHeight, openUp ? spaceAbove : spaceBelow);

  panel.style.left = `${Math.round(rect.left)}px`;
  panel.style.minWidth = `${Math.round(rect.width)}px`;
  panel.style.maxHeight = `${Math.max(height, ROW_HEIGHT * 3)}px`;

  if (openUp) {
    panel.style.top = '';
    panel.style.bottom = `${Math.round(window.innerHeight - rect.top + 2)}px`;
  } else {
    panel.style.bottom = '';
    panel.style.top = `${Math.round(rect.bottom + 2)}px`;
  }
}

function setActive(panel, index) {
  const items = [...panel.querySelectorAll('.compact-select__option:not(.is-disabled)')];
  if (!items.length) return;

  const next = Math.max(0, Math.min(index, items.length - 1));
  items.forEach((item, i) => item.classList.toggle('is-active', i === next));
  items[next].scrollIntoView({ block: 'nearest' });
}

function getActiveIndex(panel) {
  const items = [...panel.querySelectorAll('.compact-select__option:not(.is-disabled)')];
  return items.findIndex((item) => item.classList.contains('is-active'));
}

function openPanel(select, maxRows) {
  closePanel();
  if (select.disabled) return;

  const panel = document.createElement('div');
  panel.className = 'compact-select__panel';
  panel.setAttribute('role', 'listbox');

  [...select.options].forEach((option) => {
    const item = document.createElement('div');
    item.className = 'compact-select__option';
    item.setAttribute('role', 'option');
    item.dataset.value = option.value;
    item.textContent = option.textContent.trim();

    if (option.disabled) item.classList.add('is-disabled');
    if (option.selected) {
      item.classList.add('is-selected', 'is-active');
      item.setAttribute('aria-selected', 'true');
    }

    panel.appendChild(item);
  });

  document.body.appendChild(panel);
  positionPanel(select, panel, maxRows);
  select.setAttribute('aria-expanded', 'true');

  panel.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });

  const abort = new AbortController();
  const { signal } = abort;

  panel.addEventListener('mousedown', (event) => event.preventDefault(), { signal });

  panel.addEventListener('click', (event) => {
    const item = event.target.closest('.compact-select__option');
    if (!item || item.classList.contains('is-disabled')) return;
    choose(select, item.dataset.value);
  }, { signal });

  // Fora da lista fecha; ESC fecha só a lista (captura: não fecha o modal de baixo)
  document.addEventListener('mousedown', (event) => {
    if (event.target === select || panel.contains(event.target)) return;
    closePanel();
  }, { capture: true, signal });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
      closePanel({ focusSelect: event.key === 'Escape' });
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setActive(panel, getActiveIndex(panel) + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const active = panel.querySelector('.compact-select__option.is-active');
      if (active) choose(select, active.dataset.value);
    }
  }, { capture: true, signal });

  // Rolar o modal ou redimensionar a tela fecha (a lista é fixa na tela)
  window.addEventListener('resize', () => closePanel(), { signal });
  document.addEventListener('scroll', (event) => {
    if (panel.contains(event.target)) return;
    closePanel();
  }, { capture: true, signal });

  openState = { select, panel, abort };
}

/**
 * Faz o <select> abrir uma lista com no máximo `maxRows` linhas visíveis.
 *
 * @param {HTMLSelectElement|string} selectOrId
 * @param {{ maxRows?: number }} [options]
 */
export function enhanceCompactSelect(selectOrId, { maxRows = 15 } = {}) {
  const select = typeof selectOrId === 'string'
    ? document.getElementById(selectOrId.replace(/^#/, ''))
    : selectOrId;

  if (!(select instanceof HTMLSelectElement) || select.dataset.compactSelect) return;
  select.dataset.compactSelect = 'true';
  select.setAttribute('aria-haspopup', 'listbox');
  select.setAttribute('aria-expanded', 'false');

  // Impede a lista nativa e abre a lista com altura limitada
  select.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || select.disabled) return;
    event.preventDefault();
    select.focus({ preventScroll: true });

    if (openState?.select === select) closePanel();
    else openPanel(select, maxRows);
  });

  select.addEventListener('keydown', (event) => {
    if (openState?.select === select) return;
    const altDown = event.altKey && event.key === 'ArrowDown';
    if (!OPEN_KEYS.has(event.key) && !altDown) return;

    event.preventDefault();
    openPanel(select, maxRows);
  });
}

export default enhanceCompactSelect;
