// ╔══════════════════════════════════════════════════════════════════════╗
// ║ reportsProductsStock.summary.js — Resumo lateral (filtros aplicados) ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { getEls } from './reportsProductsStock.dom.js';
import { fmtMoney, fmtNumber, sanitize } from './reportsProductsStock.utils.js';
import { state } from './reportsProductsStock.state.js';

const selectedText = (sel) => (sel && sel.value ? sel.options[sel.selectedIndex]?.text || '' : '');

function activeFilters() {
  const els = getEls();
  const out = [];

  if (state.q) out.push(`Busca: ${state.q}`);
  if (state.supplier_id && els.txtFornecedor?.value) out.push(`Fornecedor: ${els.txtFornecedor.value}`);
  if (state.group_id) out.push(`Grupo: ${selectedText(els.selGrupo)}`);
  if (state.subgroup_id) out.push(`Subgrupo: ${selectedText(els.selSubgrupo)}`);
  if (state.brand_id) out.push(`Marca: ${selectedText(els.selMarca)}`);
  if (state.only_stock) out.push('Estoque > 0');
  if (state.active === '1') out.push('Somente ativos');
  if (state.active === '0') out.push('Somente inativos');
  if (state.cost_min !== '' && state.cost_min !== null) out.push(`Custo ≥ ${fmtMoney(state.cost_min)}`);
  if (state.cost_max !== '' && state.cost_max !== null) out.push(`Custo ≤ ${fmtMoney(state.cost_max)}`);

  return out;
}

export function setSummary(summary = null) {
  const els = getEls();
  const set = (el, txt) => { if (el) el.textContent = txt; };

  if (!summary) {
    [els.sumItems, els.sumWithStock, els.sumWithoutStock, els.sumStock,
      els.sumCost, els.sumAvgCost, els.sumWithoutCost].forEach(el => set(el, '—'));
    return;
  }

  const sumStock = Number(summary.sum_stock) || 0;
  const sumCost = Number(summary.sum_cost) || 0;

  set(els.sumItems, fmtNumber(summary.total ?? 0));
  set(els.sumWithStock, fmtNumber(summary.with_stock ?? 0));
  set(els.sumWithoutStock, fmtNumber(summary.without_stock ?? 0));
  set(els.sumStock, fmtNumber(sumStock));
  set(els.sumCost, fmtMoney(sumCost));
  set(els.sumAvgCost, sumStock > 0 ? fmtMoney(sumCost / sumStock) : '—');
  set(els.sumWithoutCost, fmtNumber(summary.without_cost ?? 0));

  if (els.sumFilters) {
    const list = activeFilters();
    els.sumFilters.innerHTML = list.length
      ? list.map(f => `<span class="rps-chip">${sanitize(f)}</span>`).join('')
      : '<span class="rps-chip rps-chip--muted">Sem filtros</span>';
  }
}
