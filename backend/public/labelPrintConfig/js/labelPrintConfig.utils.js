// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: labelPrintConfig.utils.js                                     ║
// ║ MODULE: Parâmetros Etiqueta Localização — Utilitários e avisos      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const $ = (selector, root = document) => root.querySelector(selector);

export const state = {
  models: [],
  search: '',
  status: 'true',
  sortColumn: 'name',
  sortDirection: 'asc',
  editing: null,
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 60 → "60" · 62.5 → "62,5" */
export function formatMm(value) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** Avisos no centerAlertModal (padrão CONSART). */
export function notify(message, type = 'success') {
  const variant = ['error', 'warning', 'info'].includes(type) ? type : 'success';
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Etiqueta de Localização'),
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
