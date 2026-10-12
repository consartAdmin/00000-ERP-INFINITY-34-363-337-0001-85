// ╔══════════════════════════════════════════════════════════════════════╗
// ║ customerFinancialDefaults.js — Classificação Financeira Padrão      ║
// ║ CONSART ERP | compartilhado: customersEdit + customersRegistration  ║
// ║ Plano de Contas / Categoria / Subcategoria do cliente, importados   ║
// ║ automaticamente na Movimentação de Caixa ao selecionar o cliente.   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { openChartAccountsModalSearch } from '/public/modalsSearch/chartAccountsModalSearch.js';

const API_BASE =
  (typeof window !== 'undefined' && (window.apiBase || window.API_BASE)) ||
  (typeof window !== 'undefined' ? window.location.origin : '');

const ROUTES = Object.freeze({
  categorias: `${API_BASE}/api/caixa/categorias`,
  subcategorias: (categoriaId) =>
    `${API_BASE}/api/caixa/subcategorias?categoria_id=${encodeURIComponent(categoriaId)}`,
  chartAccountById: (id) =>
    `${API_BASE}/api/chart-of-accounts/${encodeURIComponent(id)}`,
});

const byId = (id) => document.getElementById(id);

const els = () => ({
  accountId: byId('default_chart_account_id'),
  accountLabel: byId('default_chart_account_label'),
  btnAccount: byId('btnDefaultChartAccount'),
  btnClearAccount: byId('btnClearDefaultChartAccount'),
  category: byId('default_cash_category_id'),
  subcategory: byId('default_cash_subcategory_id'),
});

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  return r.json();
}

function fillSelect(select, rows) {
  if (!select) return;

  select.innerHTML = '<option value="">— Nenhuma —</option>';

  for (const row of rows) {
    const op = document.createElement('option');
    op.value = row.id;
    op.textContent = row.nome ?? row.name ?? '';
    select.appendChild(op);
  }
}

function accountLabel(conta) {
  return `${conta.code ?? ''} - ${conta.description ?? ''}`;
}

async function loadSubcategories(categoryId) {
  const { subcategory } = els();

  if (!categoryId) {
    fillSelect(subcategory, []);
    return;
  }

  const rows = await fetchJson(ROUTES.subcategorias(categoryId));
  fillSelect(subcategory, Array.isArray(rows) ? rows : []);
}

// ---------------------------------------------------------------------
// Init — carrega categorias e liga eventos (antes de loadCustomer)
// ---------------------------------------------------------------------
export async function initFinancialDefaults() {
  const e = els();
  if (!e.category) return;

  try {
    const rows = await fetchJson(ROUTES.categorias);
    fillSelect(e.category, Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('[customersEdit] categorias:', err);
  }

  e.category.addEventListener('change', () => {
    loadSubcategories(e.category.value).catch((err) =>
      console.error('[customersEdit] subcategorias:', err)
    );
  });

  async function pickAccount() {
    const conta = await openChartAccountsModalSearch({
      onlyPosting: true,
      onlyActive: true,
    });

    if (!conta) return;

    e.accountId.value = conta.id ?? '';
    e.accountLabel.value = accountLabel(conta);
  }

  e.btnAccount?.addEventListener('click', pickAccount);
  e.accountLabel?.addEventListener('dblclick', pickAccount);

  e.btnClearAccount?.addEventListener('click', () => {
    e.accountId.value = '';
    e.accountLabel.value = '';
  });
}

// ---------------------------------------------------------------------
// Fill — preenche a partir do cliente carregado
// ---------------------------------------------------------------------
export async function fillFinancialDefaults(c = {}) {
  const e = els();
  if (!e.category) return;

  const accountId = c.default_chart_account_id ?? '';
  e.accountId.value = accountId;
  e.accountLabel.value = '';

  if (accountId) {
    try {
      const js = await fetchJson(ROUTES.chartAccountById(accountId));
      const conta = js?.data ?? js;
      e.accountLabel.value = conta?.id ? accountLabel(conta) : `#${accountId}`;
    } catch (err) {
      console.error('[customersEdit] conta contábil:', err);
      e.accountLabel.value = `#${accountId}`;
    }
  }

  const categoryId = c.default_cash_category_id ?? '';
  e.category.value = String(categoryId);

  try {
    await loadSubcategories(e.category.value);
  } catch (err) {
    console.error('[customersEdit] subcategorias:', err);
  }

  e.subcategory.value = String(c.default_cash_subcategory_id ?? '');
}

// ---------------------------------------------------------------------
// Read — chaves para o payload do PUT /api/customers/:id
// ---------------------------------------------------------------------
export function readFinancialDefaults() {
  const e = els();
  if (!e.category) return {};

  const toId = (v) => (v ? Number(v) : null);

  return {
    default_chart_account_id: toId(e.accountId?.value),
    default_cash_category_id: toId(e.category?.value),
    default_cash_subcategory_id: e.category?.value ? toId(e.subcategory?.value) : null,
  };
}
