// ╔══════════════════════════════════════════════════════════════════════╗
// ║ reportsProductsStock.pagination.js — Paginação e footer             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { getEls } from './reportsProductsStock.dom.js';
import { fmtInt } from './reportsProductsStock.utils.js';
import { state } from './reportsProductsStock.state.js';

export function setFooter({ total = null, page = null, pages = null } = {}) {
  const els = getEls();
  const hasTotal = total !== null && Number.isFinite(Number(total));
  const hasPages = page !== null && pages !== null && Number.isFinite(Number(page)) && Number.isFinite(Number(pages));

  if (els.apTableInfo) {
    const n = Number(total);
    els.apTableInfo.textContent = hasTotal
      ? `${n.toLocaleString('pt-BR')} ${n === 1 ? 'registro encontrado' : 'registros encontrados'}`
      : 'Carregando...';
  }

  if (els.apPageInfo) {
    els.apPageInfo.textContent = hasPages
      ? `Página ${Number(page)} de ${Number(pages)}`
      : 'Página — de —';
  }

  if (els.btnPreviousPage) els.btnPreviousPage.disabled = !hasPages || Number(page) <= 1;
  if (els.btnNextPage) els.btnNextPage.disabled = !hasPages || Number(page) >= Number(pages);
}

export function renderPagination({ total, page, limit }) {
  state.page = page;
  state.limit = limit;
  state.pages = Math.max(Math.ceil((Number(total) || 0) / (limit || 1)), 1);

  setFooter({ total: Number(total) || 0, page: state.page, pages: state.pages });
}

// Liga Anterior / Próxima / Mostrar N linhas uma única vez.
export function bindPagination(loadFn) {
  const els = getEls();

  els.btnPreviousPage?.addEventListener('click', () => {
    if (state.loading || state.page <= 1) return;
    state.page -= 1;
    loadFn();
  });

  els.btnNextPage?.addEventListener('click', () => {
    if (state.loading || state.page >= (state.pages || 1)) return;
    state.page += 1;
    loadFn();
  });

  if (els.apRowsPerPage) els.apRowsPerPage.value = String(state.limit);

  els.apRowsPerPage?.addEventListener('change', () => {
    state.limit = fmtInt(els.apRowsPerPage.value, 50);
    state.page = 1;
    loadFn();
  });
}
