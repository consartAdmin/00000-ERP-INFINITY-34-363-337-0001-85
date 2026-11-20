// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.utils.js — Shared utilities (CONSART ERP)            ║
// ║ Path: backend/public/expenseEntries/expenseEntries.utils.js          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const $ = (selector) => document.querySelector(selector);

// Avisos da tela no centerAlertModal (sucesso some sozinho; erro espera o OK).
export function toast(message, type = 'info') {
  if (type === 'error') console.error(message);
  const text = String(message ?? '');
  const variant = type === 'error' ? 'error' : /✅/.test(text) ? 'success' : type;
  const html = escapeHtml(text.replace(/\s*✅/g, '').trim()).replace(/\n/g, '<br>');
  const title = type === 'error' ? 'Atenção' : variant === 'success' ? 'Pronto' : 'Aviso';
  showCenterModal({ variant, title, message: html, buttons: [{ label: 'OK', variant: 'ok' }] });
}

export function moneyBR(value) {
  const number = Number(value || 0);
  return number.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function toISODate(date) {
  if (!date) return '';
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export const STATUS_LABELS = Object.freeze({
  OPEN: { label: 'Aberta', tone: 'warning' },
  POSTED: { label: 'Lançada', tone: 'success' },
  CANCELED: { label: 'Cancelada', tone: 'danger' },
});

export function badge(status) {
  const normalized = String(status || 'OPEN').toUpperCase();
  const info = STATUS_LABELS[normalized] || { label: normalized, tone: 'info' };
  return `<span class="summary-pill summary-pill--${info.tone}">${escapeHtml(info.label)}</span>`;
}

export const DOCUMENT_TYPE_LABELS = Object.freeze({ NFE: 'NF-e', NFCE: 'NFC-e', MANUAL: 'Manual' });

export function documentTypeLabel(type) {
  const normalized = String(type || 'NFE').toUpperCase();
  return DOCUMENT_TYPE_LABELS[normalized] || normalized;
}

// AAAA-MM-DD → DD/MM/AAAA (sem fuso: lê só a parte da data)
export function dateBR(date) {
  const iso = toISODate(date);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

export function formatTaxId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(value || '');
}

export function canPost(status) {
  const normalized = String(status || 'OPEN').toUpperCase();
  return normalized !== 'POSTED' && normalized !== 'CANCELED';
}

export function canCancel(status) {
  return canPost(status);
}

export function canDelete(status) {
  return String(status || 'OPEN').toUpperCase() !== 'POSTED';
}

