// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inventory.utils.js — Helpers (parse, focus, format, barcode)         ║
// ║ CONSART ERP | Inventário                                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export function toNumOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function isNumericId(v) {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s);
}

export function normalizeUnitText(v) {
  return String(v || '').toUpperCase().replace(/\s+/g, '').replace(/[.\-]/g, '');
}

export function isBarcodeLike(v) {
  const s = String(v || '').trim();
  return /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(s);
}

/* ──────────────────────────────────────────────────────────────
   Page detection (UX focus)
────────────────────────────────────────────────────────────── */
export const IS_INVENTORY_PAGE =
  /\/inventory\//i.test(location.pathname) ||
  /inventory\.html/i.test(location.pathname) ||
  document.documentElement?.dataset?.page === 'inventory';

export function focusCountedQty(els) {
  if (!IS_INVENTORY_PAGE) return;
  const el = els?.itemCountedQty;
  if (!el) return;
  requestAnimationFrame(() => { el.focus(); try { el.select?.(); } catch {} });
}

export function focusProductField(els) {
  if (!IS_INVENTORY_PAGE) return;
  const el = els?.itemProductCode;
  if (!el) return;
  requestAnimationFrame(() => { el.focus(); try { el.select?.(); } catch {} });
}

export function fmtQty3(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function fmtDatePt(d) {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('pt-BR');
}
/* ──────────────────────────────────────────────────────────────
   Rótulos em português + selos (summary-pill do design system)
────────────────────────────────────────────────────────────── */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const INVENTORY_STATUS = {
  OPEN: ['Aberto', 'info'],
  COUNTING: ['Em contagem', 'warning'],
  FINALIZED: ['Finalizado', 'success'],
  CANCELLED: ['Cancelado', 'danger'],
};

const INVENTORY_TYPE = { GENERAL: 'Geral', PARTIAL: 'Parcial', CYCLE: 'Cíclico' };

const ITEM_STATUS = {
  PENDING: ['Pendente', 'warning'],
  COUNTED: ['Contado', 'info'],
  ADJUSTED: ['Ajustado', 'success'],
};

function pill([label, tone]) {
  return `<span class="summary-pill summary-pill--${tone}">${escapeHtml(label)}</span>`;
}

export function inventoryStatusPill(status) {
  const s = String(status || '').toUpperCase();
  return INVENTORY_STATUS[s] ? pill(INVENTORY_STATUS[s]) : escapeHtml(s);
}

export function inventoryTypeLabel(type) {
  const t = String(type || '').toUpperCase();
  return INVENTORY_TYPE[t] || t;
}

export function itemStatusPill(status) {
  const s = String(status || '').toUpperCase();
  return ITEM_STATUS[s] ? pill(ITEM_STATUS[s]) : escapeHtml(s);
}
