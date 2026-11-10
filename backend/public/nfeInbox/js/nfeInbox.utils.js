/* ╔══════════════════════════════════════════════════════════════════╗
 * ║ nfeInbox.utils.js — Utilitários | CONSART ERP (ESM)             ║
 * ╚══════════════════════════════════════════════════════════════════╝ */
'use strict';

export function formatDate(value, dateOnly = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateOnly ? date.toLocaleDateString('pt-BR') : date.toLocaleString('pt-BR');
}

export const formatDateOnly = (value) => formatDate(value, true);

export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseMoney(value = '') {
  const normalized = String(value).replace(/[R$\s.]/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

export function shortenKey(key = '') {
  const value = String(key);
  return value.length <= 20 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

/**
 * Manifestações do destinatário. A chave é a operação gravada em
 * nfeInbox.manifestacao.operacao (POST /api/nfe-inbox/:id/manifest e sync DF-e).
 */
export const MANIFEST_OPTIONS = Object.freeze({
  CIENCIA: {
    label: 'Ciência',
    pill: 'summary-pill--info',
    help: 'Registra que a empresa tomou conhecimento da nota e libera o XML completo. '
      + 'Não confirma nem recusa a operação; depois ainda é preciso Confirmar, Desconhecer ou informar Não realizada.',
  },
  CONFIRMACAO: {
    label: 'Confirmada',
    pill: 'summary-pill--success',
    help: 'Confirma que a operação aconteceu e a mercadoria foi recebida. É a manifestação conclusiva mais comum.',
  },
  DESCONHECIMENTO: {
    label: 'Desconhecida',
    pill: 'summary-pill--danger',
    help: 'A empresa não reconhece esta nota (não fez o pedido). Use quando a NF-e foi emitida indevidamente contra o seu CNPJ.',
  },
  NAO_REALIZADA: {
    label: 'Não realizada',
    pill: 'summary-pill--warning',
    help: 'A operação foi combinada, mas não aconteceu (ex.: mercadoria devolvida na entrega). Exige justificativa.',
  },
});

/** Normaliza a manifestação gravada (string ou JSONB) para uma chave de MANIFEST_OPTIONS. */
export function getManifestCode(manifestacao) {
  if (!manifestacao) return null;
  const raw = typeof manifestacao === 'string'
    ? manifestacao
    : typeof manifestacao === 'object'
      ? (manifestacao.operacao || manifestacao.tipo || manifestacao.evento || manifestacao.codigo)
      : null;
  if (!raw) return typeof manifestacao === 'object' ? 'MANIFESTADA' : null;

  const upper = String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (upper.includes('CIEN')) return 'CIENCIA';
  if (upper.includes('CONF')) return 'CONFIRMACAO';
  if (upper.includes('DESC')) return 'DESCONHECIMENTO';
  if (upper.includes('NAO')) return 'NAO_REALIZADA';
  return upper;
}

/** Rótulo pt-BR da manifestação (ou null quando nunca foi manifestada). */
export function getManifestLabel(manifestacao) {
  const code = getManifestCode(manifestacao);
  if (!code) return null;
  if (code === 'MANIFESTADA') return 'Manifestada';
  return MANIFEST_OPTIONS[code]?.label || code;
}

/** Selo (summary-pill) da manifestação para a tabela e o modal. */
export function fillManifestPill(element, manifestacao) {
  if (!element) return;
  const code = getManifestCode(manifestacao);
  element.className = 'summary-pill';
  if (!code) {
    element.textContent = 'Sem manifestação';
    return;
  }
  element.textContent = getManifestLabel(manifestacao);
  const variant = MANIFEST_OPTIONS[code]?.pill;
  if (variant) element.classList.add(variant);
}

export function getFilenameFromDisposition(disposition = '') {
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const quoted = disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*([^;]+)/i)?.[1];
  const value = encoded || quoted || plain;
  if (!value) return null;
  try { return decodeURIComponent(value.trim()); } catch { return value.trim(); }
}

export function downloadBlob(blob, filename = 'download.bin') {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Adia `fn` até parar de ser chamada por `delay` ms.
 * A função devolvida expõe `.cancel()` para descartar um disparo pendente
 * quando a mesma ação já foi executada por outro caminho (ex.: Enter).
 */
export function debounce(fn, delay = 300) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}
