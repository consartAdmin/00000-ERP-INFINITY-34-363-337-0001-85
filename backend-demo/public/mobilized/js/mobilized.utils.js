'use strict';

import { API_BASE, IMAGE_EXTENSIONS } from './mobilized.config.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const setDisabled = (element, value) => { if (element) element.disabled = Boolean(value); };
export const toNumber = (value) => {
  if (value == null || value === '') return 0;
  const number = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
};
export const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
export const formatBRL = (value) => toNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatNumber = (value, decimals = 2) => toNumber(value).toLocaleString('pt-BR', {
  minimumFractionDigits: 0, maximumFractionDigits: decimals,
});

/** dd/mm/aaaa hh:mm */
export function formatDateBR(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
}

/** valor para <input type="datetime-local"> (aaaa-mm-ddThh:mm, horário local) */
export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Avisos no centerAlertModal (padrão CONSART). */
export function notify(message, type = 'info') {
  const variant = type === 'error' ? 'error' : (type === 'warning' ? 'warning' : 'success');
  if (type === 'error') console.error('[mobilized]', message);
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Mobilizado'),
    message: String(message ?? ''),
    timeoutMs: variant === 'success' ? 2500 : undefined,
  });
}

/** Confirmação no centerAlertModal. Resolve true/false. */
export async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Excluir' } = {}) {
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

export const computeItemsTotal = (items = []) => items.reduce((sum, item) => sum + toNumber(item.total_value), 0);
export const countMissingPrice = (items = []) => items.filter((item) => toNumber(item.unit_price) === 0).length;
export const imageCandidates = (sku) => {
  const code = String(sku || '').trim();
  return code ? IMAGE_EXTENSIONS.map((ext) => `${API_BASE}/public/imagens/${encodeURIComponent(code)}.${ext}`) : [];
};
export function setImageWithFallback(image, urls = [], placeholder = '/public/imagens/brasaoConsartInfinity.png') {
  if (!image) return;
  const list = urls.filter(Boolean); let index = 0;
  const next = () => {
    if (index >= list.length) { image.onerror = null; image.src = placeholder; return; }
    image.onerror = () => { index += 1; next(); };
    image.src = list[index];
  };
  next();
}
