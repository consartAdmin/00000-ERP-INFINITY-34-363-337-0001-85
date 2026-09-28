// ╔════════════════════════════════════════════════════════════════════╗
// ║ batcheProductsPrices.utils.js — Helpers numéricos                  ║
// ╚════════════════════════════════════════════════════════════════════╝

// Helpers numéricos
export const isFiniteNum = (v) => Number.isFinite(Number(v));
export const toNum       = (v, fb = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
