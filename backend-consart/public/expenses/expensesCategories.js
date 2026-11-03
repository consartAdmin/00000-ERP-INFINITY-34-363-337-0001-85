// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expensesCategories.js — Categorias das despesas = Categorias do Caixa║
// ║ Path: public/expenses/expensesCategories.js                         ║
// ║ Fonte: GET /api/caixa/categorias (mesma lista do Caixa, Contas a    ║
// ║ Pagar/Receber e Compromissos). Grava o NOME em Expenses.category.   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

let cache = null;

function apiBase() {
  try { if (typeof window.getApiBase === 'function') return window.getApiBase(); } catch {}
  return window.API_BASE || window.apiBase || window.API || '';
}

/** Lista (cacheada) dos nomes das categorias ativas do Caixa */
export async function loadCashCategoryNames() {
  if (cache) return cache;
  cache = (async () => {
    try {
      const res = await fetch(`${apiBase()}/api/caixa/categorias?incluirInativos=false`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => []);
      const rows = Array.isArray(data) ? data : (data?.rows || data?.data || []);
      return rows
        .filter((r) => r && r.is_active !== false)
        .map((r) => String(r.nome ?? r.name ?? '').trim())
        .filter(Boolean);
    } catch (err) {
      console.warn('[expenses] categorias do caixa', err);
      return [];
    }
  })();
  return cache;
}

/**
 * Preenche um <select> com as categorias do Caixa.
 * @param {HTMLSelectElement} select
 * @param {{placeholder?: string}} opts
 */
export async function fillCategorySelect(select, { placeholder = 'Selecione...' } = {}) {
  if (!select) return;
  const names = await loadCashCategoryNames();
  const current = select.value;
  select.replaceChildren(new Option(placeholder, ''));
  names.forEach((name) => select.appendChild(new Option(name, name)));
  if (current) setCategoryValue(select, current);
}

/**
 * Seleciona um valor; se a despesa tiver uma categoria antiga que não
 * existe no Caixa, ela aparece como "(antiga)" para não se perder.
 */
export function setCategoryValue(select, value) {
  if (!select) return;
  const v = String(value ?? '').trim();
  select.querySelectorAll('option[data-legacy]').forEach((o) => o.remove());
  if (!v) { select.value = ''; return; }
  const match = [...select.options].find((o) => o.value.toLowerCase() === v.toLowerCase());
  if (match) { select.value = match.value; return; }
  const legacy = new Option(`${v} (antiga)`, v);
  legacy.dataset.legacy = 'true';
  select.appendChild(legacy);
  select.value = v;
}
