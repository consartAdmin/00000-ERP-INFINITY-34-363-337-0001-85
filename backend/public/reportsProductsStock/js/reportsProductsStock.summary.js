// ╔══════════════════════════════════════════════════════════════════════╗
// ║ reportsProductsStock.summary.js — Custo total no rodapé              ║
// ║ Soma de TODOS os registros filtrados (não só a página).              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { getEls } from './reportsProductsStock.dom.js';
import { fmtMoney } from './reportsProductsStock.utils.js';

export function setSummary(summary = null) {
  const els = getEls();
  if (!els.sumCost) return;

  els.sumCost.textContent = summary ? fmtMoney(Number(summary.sum_cost) || 0) : '—';
}
