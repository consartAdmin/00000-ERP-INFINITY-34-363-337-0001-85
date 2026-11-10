// ╔════════════════════════════════════════════════════════════╗
// ║ pcp.common.js — Utilitários compartilhados das telas do PCP ║
// ╚════════════════════════════════════════════════════════════╝

import { apiFetch } from '/public/includes/js/apiFetch.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const API = '/api/pcp';

export const STATUS_LABEL = {
  PLANEJADA: 'Planejada',
  LIBERADA: 'Liberada',
  EM_PRODUCAO: 'Em produção',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

/** Chama a API do PCP e devolve apenas o "data" da resposta. */
export async function pcpApi(path, { method = 'GET', body } = {}) {
  const res = await apiFetch(`${API}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res?.data;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function fmtNum(value, max = 3, min = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
}

export function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtDate(value) {
  if (!value) return '—';
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split('-');
  return d ? `${d}/${m}/${y}` : s;
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function toInputDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

// Selo de status no padrão do design system (summary-pill).
const STATUS_PILL = {
  PLANEJADA: 'info',
  LIBERADA: 'primary',
  EM_PRODUCAO: 'warning',
  CONCLUIDA: 'success',
  CANCELADA: 'danger',
};

export function statusBadge(status) {
  const tone = STATUS_PILL[status] || 'info';
  return `<span class="summary-pill summary-pill--${tone}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`;
}

export function activeBadge(active, { on = 'Ativo', off = 'Inativo' } = {}) {
  return active
    ? `<span class="summary-pill summary-pill--success">${escapeHtml(on)}</span>`
    : `<span class="summary-pill summary-pill--danger">${escapeHtml(off)}</span>`;
}

/** Linha de vazio / erro / carregando da tabela. */
export function messageRow(colspan, text) {
  return `<tr><td colspan="${colspan}" class="table-empty-state">${escapeHtml(text)}</td></tr>`;
}

/** Aviso central do ERP (centerAlertModal.js): erro, sucesso, aviso ou info. */
export function showMessage(_el, text, kind = 'error') {
  if (!text) return;
  const variant = kind === 'success' ? 'success' : (kind === 'warning' ? 'warning' : (kind === 'info' ? 'info' : 'error'));
  const lines = Array.isArray(text) ? text : [text];
  const title = variant === 'error' ? 'Atenção' : (variant === 'warning' ? 'Atenção' : lines[0]);
  const message = variant === 'success' || variant === 'info' ? lines.slice(1).join('\n') : lines.join('\n');
  showCenterModal({ variant, title, message, timeoutMs: variant === 'success' ? 2500 : undefined });
}

/** Aviso global do ERP (window.Alert do core.js), com fallback. */
export function notify(kind, title, message = '') {
  const variant = kind === 'warn' ? 'warning' : kind;
  showCenterModal({ variant, title, message: String(message ?? ''), timeoutMs: variant === 'success' ? 2500 : undefined });
}

/** Confirmação no centerAlertModal (substitui o confirm() do navegador). */
export async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Confirmar', variant = 'warning' } = {}) {
  const button = await showCenterModal({
    variant,
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

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Liga um <input> a um <datalist> com a busca de produtos do PCP.
 * O valor digitado/selecionado fica no formato "CODIGO — Descrição";
 * use productCodeOf() para extrair o código.
 */
export function attachProductSearch(input, datalist) {
  const search = debounce(async () => {
    const q = input.value.split(' — ')[0].trim();
    if (q.length < 2) return;
    try {
      const rows = await pcpApi(`/products?q=${encodeURIComponent(q)}`);
      datalist.innerHTML = (rows || [])
        .map((p) => `<option value="${escapeHtml(`${p.product_code} — ${p.description || ''}`)}"></option>`)
        .join('');
    } catch {
      /* busca silenciosa */
    }
  });
  input.addEventListener('input', search);
}

export function productCodeOf(value) {
  return String(value || '').split(' — ')[0].trim();
}

export function productLabel(code, description) {
  if (!code) return '';
  return description ? `${code} — ${description}` : code;
}

/** Paginação simples no padrão das telas do ERP. */
export function paginate(rows, state) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  return { slice: rows.slice(start, start + state.pageSize), total, pages };
}

export function bindPagination(state, ids, render) {
  const $ = (id) => document.getElementById(id);
  $(ids.prev)?.addEventListener('click', () => { if (state.page > 1) { state.page--; render(); } });
  $(ids.next)?.addEventListener('click', () => { state.page++; render(); });
  $(ids.size)?.addEventListener('change', (e) => { state.pageSize = Number(e.target.value) || 50; state.page = 1; render(); });
}

export function renderPagination(ids, { total, pages }, state, noun = 'registros') {
  const $ = (id) => document.getElementById(id);
  if ($(ids.info)) $(ids.info).textContent = `${total} ${noun}`;
  if ($(ids.pageInfo)) $(ids.pageInfo).textContent = `Página ${state.page} de ${pages}`;
  if ($(ids.prev)) $(ids.prev).disabled = state.page <= 1;
  if ($(ids.next)) $(ids.next).disabled = state.page >= pages;
}
