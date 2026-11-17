// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesReport.sort.js — Ordenação das abas (sortableTable padrão)     ║
// ║ CONSART ERP                                                         ║
// ║ Os dados das três abas já vêm completos do backend, então a        ║
// ║ ordenação é feita no navegador e respeita a paginação da tela.     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import createSortableTable from '/public/includes/js/sortableTable.js';
import { state } from './salesReport.state.js';

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const text = (value) => {
  const s = String(value ?? '').trim();
  return s || null;
};

const productProfit = (item) => {
  const profit = Number(item.gross_profit);
  return Number.isFinite(profit)
    ? profit
    : Number(item.total_amount || 0) - Number(item.total_cost || 0);
};

// Coluna (data-sort-column) → valor usado na comparação.
// As chaves são o slug do rótulo, para manter as preferências salvas na ⚙️.
const SORT_ACCESSORS = Object.freeze({
  day: {
    data: (item) => (item.day ? new Date(item.day).getTime() : null),
    pedidos: (item) => num(item.orders_count),
    itens: (item) => num(item.total_items),
    'total-vendido': (item) => num(item.total_amount),
  },
  customer: {
    cliente: (item) => text(item.customer_name),
    id: (item) => num(item.customer_id) ?? text(item.customer_id),
    pedidos: (item) => num(item.orders_count),
    'total-vendido': (item) => num(item.total_amount),
  },
  product: {
    codigo: (item) => text(item.product_sku || item.product_code || item.product_id),
    descricao: (item) => text(item.product_description),
    'u-m': (item) => text(item.product_unit || item.unit),
    'qtde-vendida': (item) => num(item.total_items),
    'preco-med-venda': (item) => num(item.avg_unit_price),
    'custo-med-unit': (item) => num(item.avg_unit_cost ?? item.avg_cost_price),
    'total-vendido': (item) => num(item.total_amount),
    'custo-total': (item) => num(item.total_cost),
    'lucro-bruto': productProfit,
  },
});

// Mesma ordem que o backend já devolve.
const DEFAULT_SORT = Object.freeze({
  day: { column: 'data', direction: 'asc' },
  customer: { column: 'total-vendido', direction: 'desc' },
  product: { column: 'total-vendido', direction: 'desc' },
});

const DATA_KEYS = Object.freeze({
  day: 'byDay',
  customer: 'byCustomer',
  product: 'byProduct',
});

const TABLE_SELECTORS = Object.freeze({
  day: '#table-by-day',
  customer: '#table-by-customer',
  product: '#table-by-product',
});

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** Ordena os dados de uma aba conforme o estado salvo (vazios sempre no fim). */
export function sortTabRows(tab) {
  const key = DATA_KEYS[tab];
  const sort = state.sort[tab];
  const accessor = SORT_ACCESSORS[tab]?.[sort?.column];
  const rows = state.reportData[key];
  if (!accessor || !Array.isArray(rows) || rows.length < 2) return;

  const factor = sort.direction === 'desc' ? -1 : 1;
  state.reportData[key] = rows
    .map((item, index) => ({ item, index, value: accessor(item) }))
    .sort((a, b) => {
      const aEmpty = a.value === null || a.value === undefined;
      const bEmpty = b.value === null || b.value === undefined;
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? a.index - b.index : (aEmpty ? 1 : -1);
      return (compareValues(a.value, b.value) * factor) || (a.index - b.index);
    })
    .map(({ item }) => item);
}

export function sortAllTabs() {
  Object.keys(DATA_KEYS).forEach(sortTabRows);
}

/** @param {() => void} rerender Redesenha a aba ativa após ordenar. */
export function setupSortableTables(rerender) {
  Object.entries(TABLE_SELECTORS).forEach(([tab, selector]) => {
    const table = document.querySelector(selector);
    if (!table) return;

    state.sort[tab] = { ...DEFAULT_SORT[tab] };

    createSortableTable({
      table,
      defaultColumn: DEFAULT_SORT[tab].column,
      defaultDirection: DEFAULT_SORT[tab].direction,
      allowedColumns: Object.keys(SORT_ACCESSORS[tab]),
      onSort: ({ column, direction }) => {
        state.sort[tab] = { column, direction };
        sortTabRows(tab);
        if (state.activeTab === tab) state.page = 1;
        rerender?.();
      },
    });
  });
}
