// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarter.utils.js — Helpers numéricos e de erro                   ║
// ╚════════════════════════════════════════════════════════════════════╝

export function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function toQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

export function cleanText(value, max = 255) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}

export function onlyDigits(value) {
  const s = String(value ?? '').replace(/\D+/g, '');
  return s || null;
}

export function pdvError(message, code, statusCode = 422, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
