// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashCategorySelects.js — Categoria + Subcategoria do Caixa           ║
// ║ Path: public/includes/js/cashCategorySelects.js                      ║
// ║ Mesma lista do Caixa (cashCategories / cashSubcategories) para todo  ║
// ║ o Financeiro: Despesas, Compromissos Financeiros...                  ║
// ║ Fontes: GET /api/caixa/categorias                                    ║
// ║         GET /api/caixa/subcategorias?categoria_id=#                  ║
// ║ Grava: cash_category_id, cash_subcategory_id e category (nome)       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

let categoriesCache = null;
const subcategoriesCache = new Map();

function apiBase() {
  try { if (typeof window.getApiBase === 'function') return window.getApiBase(); } catch {}
  return window.API_BASE || window.apiBase || window.API || '';
}

function authHeaders() {
  const headers = { Accept: 'application/json' };
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token')
      || localStorage.getItem('auth_token') || sessionStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {}
  return headers;
}

async function getRows(path) {
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
    const data = await res.json().catch(() => []);
    const rows = Array.isArray(data) ? data : (data?.rows || data?.data || []);
    return rows
      .filter((r) => r && r.is_active !== false)
      .map((r) => ({ id: Number(r.id), nome: String(r.nome ?? r.name ?? '').trim() }))
      .filter((r) => r.id > 0 && r.nome);
  } catch (err) {
    console.warn('[cashCategorySelects]', path, err);
    return [];
  }
}

/** Categorias ativas do Caixa [{id, nome}] (cacheado) */
export function loadCashCategories() {
  if (!categoriesCache) categoriesCache = getRows('/api/caixa/categorias?incluirInativos=false');
  return categoriesCache;
}

/** Subcategorias ativas de uma categoria [{id, nome}] (cacheado por categoria) */
export function loadCashSubcategories(categoryId) {
  const id = Number(categoryId);
  if (!id) return Promise.resolve([]);
  if (!subcategoriesCache.has(id)) {
    subcategoriesCache.set(id, getRows(`/api/caixa/subcategorias?categoria_id=${id}`));
  }
  return subcategoriesCache.get(id);
}

/**
 * Filtro por NOME (o texto em "category" existe em todos os registros,
 * inclusive os antigos sem ID).
 */
export async function fillCategoryNameSelect(select, { placeholder = 'Todas' } = {}) {
  if (!select) return;
  const rows = await loadCashCategories();
  const current = select.value;
  select.replaceChildren(new Option(placeholder, ''));
  rows.forEach((r) => select.appendChild(new Option(r.nome, r.nome)));
  if (current) select.value = current;
}

/**
 * Liga um par de selects Categoria → Subcategoria (valores = IDs do Caixa).
 *
 * @param {{categorySelect: HTMLSelectElement, subcategorySelect?: HTMLSelectElement,
 *          categoryPlaceholder?: string, subcategoryPlaceholder?: string}} opts
 */
export function createCashCategoryPair({
  categorySelect,
  subcategorySelect = null,
  categoryPlaceholder = 'Selecione...',
  subcategoryPlaceholder = 'Selecione...',
} = {}) {
  const cat = categorySelect;
  const sub = subcategorySelect;
  let legacyName = '';

  async function fillCategories() {
    if (!cat) return;
    const rows = await loadCashCategories();
    const current = cat.value;
    cat.replaceChildren(new Option(categoryPlaceholder, ''));
    rows.forEach((r) => cat.appendChild(new Option(r.nome, String(r.id))));
    if (current) cat.value = current;
  }

  async function fillSubcategories(categoryId, selectedId = '') {
    if (!sub) return;
    sub.replaceChildren(new Option(categoryId ? subcategoryPlaceholder : '— escolha a categoria —', ''));
    sub.disabled = !categoryId;
    if (!categoryId) return;
    const rows = await loadCashSubcategories(categoryId);
    // a categoria pode ter mudado enquanto carregava
    if (String(cat?.value || '') !== String(categoryId)) return;
    rows.forEach((r) => sub.appendChild(new Option(r.nome, String(r.id))));
    if (selectedId) sub.value = String(selectedId);
  }

  function removeLegacy() {
    cat?.querySelectorAll('option[data-legacy]').forEach((o) => o.remove());
    legacyName = '';
  }

  const ready = fillCategories().then(() => fillSubcategories(cat?.value || ''));

  cat?.addEventListener('change', () => {
    if (!cat.selectedOptions[0]?.dataset.legacy) removeLegacy();
    const id = cat.selectedOptions[0]?.dataset.legacy ? '' : cat.value;
    fillSubcategories(id);
  });

  /**
   * Preenche no editar. Sem ID (registro antigo): tenta achar pelo nome;
   * se não existir no Caixa, mostra "Nome (antiga)" para não se perder.
   */
  async function setValue({ categoryId = null, subcategoryId = null, categoryName = '' } = {}) {
    await ready;
    if (!cat) return;
    removeLegacy();
    let id = categoryId ? String(categoryId) : '';
    const name = String(categoryName ?? '').trim();

    if (id && ![...cat.options].some((o) => o.value === id)) id = '';
    if (!id && name) {
      const match = [...cat.options].find((o) => o.value && o.text.toLowerCase() === name.toLowerCase());
      if (match) id = match.value;
    }

    if (id) {
      cat.value = id;
      await fillSubcategories(id, subcategoryId || '');
      return;
    }

    if (name) {
      const legacy = new Option(`${name} (antiga)`, `legacy:${name}`);
      legacy.dataset.legacy = 'true';
      cat.appendChild(legacy);
      cat.value = legacy.value;
      legacyName = name;
    } else {
      cat.value = '';
    }
    await fillSubcategories('');
  }

  /** {cash_category_id, cash_subcategory_id, category} para o payload */
  function getPayload() {
    const opt = cat?.selectedOptions?.[0];
    if (!opt || !opt.value) {
      return { cash_category_id: null, cash_subcategory_id: null, category: null };
    }
    if (opt.dataset.legacy) {
      return { cash_category_id: null, cash_subcategory_id: null, category: legacyName || null };
    }
    return {
      cash_category_id: Number(opt.value),
      cash_subcategory_id: sub?.value ? Number(sub.value) : null,
      category: opt.text.trim() || null,
    };
  }

  function hasValue() {
    return Boolean(cat?.value);
  }

  function reset() {
    removeLegacy();
    if (cat) cat.value = '';
    fillSubcategories('');
  }

  return { ready, setValue, getPayload, hasValue, reset };
}
