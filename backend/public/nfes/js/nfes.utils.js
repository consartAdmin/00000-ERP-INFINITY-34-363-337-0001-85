// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.utils.js                                                  ║
// ║ MODULE: NF-es Front Utils                                            ║
// ║ CONSART ERP                                                          ║
// ║ Helpers utilitários do módulo                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { state } from './nfes.state.js';

export const $ = (s, r = document) => r.querySelector(s);

export const fmtMoney = (v) =>
  Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function two(n) {
  return String(n).padStart(2, '0');
}

export function formatDateTimeBR(value) {
  if (!value) return '';

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
      const [ymd, hm] = raw.split('T');
      const [y, m, da] = ymd.split('-');
      return `${da}/${m}/${y} ${hm.slice(0, 5)}`;
    }
    return raw.slice(0, 10);
  }

  const dia = two(d.getDate());
  const mes = two(d.getMonth() + 1);
  const ano = d.getFullYear();
  const hora = two(d.getHours());
  const min = two(d.getMinutes());

  return `${dia}/${mes}/${ano} ${hora}:${min}`;
}

export function formatDateBR(value) {
  if (!value) return '';

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [y, m, da] = raw.split('T')[0].split('-');
      return `${da}/${m}/${y}`;
    }
    return raw.slice(0, 10);
  }

  const dia = two(d.getDate());
  const mes = two(d.getMonth() + 1);
  const ano = d.getFullYear();

  return `${dia}/${mes}/${ano}`;
}

export function formatMoneyBR(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function statusToBadgeClass(status) {
  const s = String(status || '').toUpperCase().trim();

  if (s === 'AUTORIZADA' || s === 'CONCLUIDO' || s === 'CONCLUÍDO') {
    return 'badge--approved';
  }

  if (s === 'INUTILIZADO' || s.includes('INUTILIZ')) {
    return 'badge--open';
  }

  if (s === 'CANCELADO' || s.includes('CANCEL')) {
    return 'badge--canceled';
  }

  if (s === 'REJEITADA' || s === 'REJEITADO' || s.includes('REJEIT')) {
    return 'badge--canceled';
  }

  return 'badge--open';
}

export function formatAmbienteLabel(env) {
  const e = String(env || '').trim().toUpperCase();
  if (!e) return 'N/D';
  if (e.startsWith('PROD')) return 'PRODUÇÃO';
  if (e.startsWith('HOM')) return 'Homologação';
  return e;
}

export function ambienteToBadgeClass(env) {
  const e = String(env || '').trim().toUpperCase();
  if (e.startsWith('PROD')) return 'badge--approved';
  if (e.startsWith('HOM')) return 'badge--open';
  return 'badge--open';
}

export function getNfeNumber(nfe) {
  return (
    nfe?.nfe_number ??
    nfe?.nfe_numero ??
    nfe?.nfeNumero ??
    nfe?.numeroNfe ??
    nfe?.numero ??
    nfe?.numNfe ??
    null
  );
}

export function getNfeKey(nfe) {
  return (
    nfe?.nfe_key ??
    nfe?.nfe_chave ??
    nfe?.chaveAcesso ??
    nfe?.chave_acesso ??
    nfe?.chave ??
    nfe?.chaveNfe ??
    nfe?.chaveNFe ??
    null
  );
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function normText(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function getDisplayStatus(nfe) {
  const display =
    nfe?.display_status ||
    nfe?.nfe_display_status ||
    nfe?.nfe_status;

  return display
    ? String(display).toUpperCase()
    : (getNfeNumber(nfe) ? 'INICIADA' : 'SEM_NFE');
}

export function canIssueCce(status) {
  const s = String(status || '').toUpperCase().trim();
  return ['AUTORIZADA', 'CONCLUIDO', 'CONCLUÍDO'].includes(s);
}

export function hasValidNfeKey(key) {
  const value = String(key || '').trim();
  return /^\d{44}$/.test(value);
}

export function getComparableValue(nfe, sortBy) {
  switch (sortBy) {
    case 'pedido':
      return Number(nfe?.order_number ?? nfe?.order_id ?? 0);

    case 'emissao': {
      const raw = nfe?.issue_date || nfe?.created_at || nfe?.updated_at || '';
      const t = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    }

    case 'numero_nfe':
      return Number(getNfeNumber(nfe) || 0);

    case 'chave':
      return normText(getNfeKey(nfe) || '');

    case 'cliente':
      return normText(nfe?.customer_name || '');

    case 'documento':
      return normText(nfe?.customer_tax_id || '');

    case 'total':
      return Number(nfe?.total_amount || 0);

    case 'status':
      return normText(getDisplayStatus(nfe));

    case 'ambiente':
      return normText(nfe?.nfe_environment || nfe?.environment || '');

    default:
      return Number(nfe?.order_number ?? nfe?.order_id ?? 0);
  }
}

export function sortListLocally(list, sortBy, sortOrder) {
  const arr = Array.isArray(list) ? [...list] : [];
  const factor = sortOrder === 'asc' ? 1 : -1;

  arr.sort((a, b) => {
    const av = getComparableValue(a, sortBy);
    const bv = getComparableValue(b, sortBy);

    if (typeof av === 'number' && typeof bv === 'number') {
      if (av === bv) return 0;
      return av > bv ? factor : -factor;
    }

    const as = String(av ?? '');
    const bs = String(bv ?? '');
    const cmp = as.localeCompare(bs, 'pt-BR', {
      numeric: true,
      sensitivity: 'base',
    });

    return cmp * factor;
  });

  return arr;
}

export function updateSortIndicators() {
  document.querySelectorAll('#tblNfes thead th.sortable-th').forEach((th) => {
    const key = th.dataset.sort;
    const indicator = th.querySelector('.sort-indicator');
    const active = key === state.sortBy;

    th.classList.toggle('is-active', active);

    if (!indicator) return;
    indicator.textContent = active ? (state.sortOrder === 'asc' ? '▲' : '▼') : '';
  });

  const sortBySelect = $('#sortByNfes');
  const sortOrderSelect = $('#sortOrderNfes');

  if (sortBySelect) sortBySelect.value = state.sortBy;
  if (sortOrderSelect) sortOrderSelect.value = state.sortOrder;
}