// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.utils.js — Helpers DOM, texto e avisos          ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const $ = (selector, root = document) => root.querySelector(selector);

export const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

export function toInt(value, fallback = 0) {
  const n = Number.parseInt(onlyDigits(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export const normalize = (value) => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function formatCnpj(value) {
  const digits = onlyDigits(value).slice(0, 14);
  if (!digits) return '';
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function prettyJson(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function logError(context, error) {
  console.error(`[nfeInutilizarEvents] ${context}`, error);
}

/** centerAlertModal usa innerHTML: escapa e troca quebra de linha por <br>. */
const asHtml = (message) => escapeHtml(String(message ?? '')).replace(/\n/g, '<br>');

/** Avisos no centerAlertModal (padrão CONSART). */
export function notify(message, type = 'success') {
  const variant = ['error', 'warning', 'info'].includes(type) ? type : 'success';
  return showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Inutilizar NF-e'),
    message: asHtml(message),
    timeoutMs: variant === 'success' ? 2500 : undefined,
  });
}

/** Confirmação no centerAlertModal. Resolve true/false. */
export async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Confirmar' } = {}) {
  const button = await showCenterModal({
    variant: 'warning',
    title,
    message: asHtml(message),
    timeoutMs: null,
    buttons: [
      { label: 'Cancelar', variant: 'cancel' },
      { label: confirmLabel, variant: 'confirm' },
    ],
  });
  return String(button?.variant || '').toLowerCase() === 'confirm';
}
