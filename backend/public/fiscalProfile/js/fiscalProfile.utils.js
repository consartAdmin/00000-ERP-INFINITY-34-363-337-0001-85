// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.utils.js                                         ║
// ║ MODULE: Fiscal Profile — Utilities                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function toNullableText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

/** Aceita "1,65", "1.65", "1.234,5678" e números. */
export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  let normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

/** Igual a toNumber, mas campo vazio → null (colunas opcionais de ST). */
export function toNullableNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  return toNumber(value, null);
}

/** 18 → "18,0000" (casas fixas, vírgula decimal). */
export function formatDecimal(value, decimals = 4) {
  return toNumber(value).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  });
}

/** Percentual curto para a lista: 18 → "18%", 1.65 → "1,65%". */
export function formatPercent(value) {
  if (value == null || value === '') return '—';
  return `${toNumber(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function logError(context, error) {
  console.error(`[fiscalProfile] ${context}`, error);
}

/** Avisos no centerAlertModal (padrão CONSART). */
export function notify(message, type = 'success') {
  const variant = ['error', 'warning', 'info'].includes(type) ? type : 'success';
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Perfil Fiscal'),
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
