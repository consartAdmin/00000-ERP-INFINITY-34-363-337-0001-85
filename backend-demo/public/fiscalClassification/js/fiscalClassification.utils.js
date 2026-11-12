// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.utils.js                                ║
// ║ MODULE: Fiscal Classification — Utilities                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

export function toNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

/** Aceita "0,1", "0.1", "1.234,5678" e números. */
export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  let normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

/** 0.1 → "0,1000" (casas fixas, vírgula decimal). */
export function formatDecimal(value, decimals = 4) {
  return toNumber(value).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  });
}

export const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

/** 39269090 → "3926.90.90" */
export function formatNcm(value) {
  const digits = onlyDigits(value);
  return digits.length === 8 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}` : String(value ?? '');
}

/** 1000500 → "10.005.00" */
export function formatCest(value) {
  const digits = onlyDigits(value);
  return digits.length === 7 ? `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}` : String(value ?? '');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function logError(context, error) {
  console.error(`[fiscalClassification] ${context}`, error);
}

/** Avisos no centerAlertModal (padrão CONSART). */
export function notify(message, type = 'success') {
  const variant = ['error', 'warning', 'info'].includes(type) ? type : 'success';
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Classificação Fiscal'),
    message: String(message ?? ''),
    timeoutMs: variant === 'success' ? 2500 : undefined,
  });
}

/** Confirmação no centerAlertModal. Resolve true/false. */
export async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Confirmar' } = {}) {
  const button = await showCenterModal({
    variant: 'warning',
    title,
    message: String(message ?? ''),
    timeoutMs: null,
    buttons: [
      { label: 'Cancelar', variant: 'cancel' },
      { label: confirmLabel, variant: 'confirm' },
    ],
  });
  return String(button?.variant || '').toLowerCase() === 'confirm';
}
