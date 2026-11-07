// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.render.js — Lista, rodapé e detalhes            ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { MODEL_LABELS } from './nfeInutilizarEvents.config.js';
import { currentPageRows } from './nfeInutilizarEvents.filters.js';
import { state } from './nfeInutilizarEvents.state.js';
import {
  canConsult, messageText, statusInfo, statusKey,
} from './nfeInutilizarEvents.status.js';
import {
  $, escapeHtml, formatCnpj, formatDateTime, plural, prettyJson,
} from './nfeInutilizarEvents.utils.js';

const COLUMNS = 9;

const rangeTotal = (row) => {
  const total = Number(row.numberEnd) - Number(row.numberStart) + 1;
  return Number.isFinite(total) && total > 0 ? total : 0;
};

const rangeText = (row) => (Number(row.numberStart) === Number(row.numberEnd)
  ? String(row.numberStart ?? '—')
  : `${row.numberStart ?? '—'} a ${row.numberEnd ?? '—'}`);

const modelText = (row) => `${row.model ?? '—'}${MODEL_LABELS[row.model] ? ` - ${MODEL_LABELS[row.model]}` : ''}`;

const statusPill = (row) => {
  const info = statusInfo(row);
  return `<span class="summary-pill ${info.pill}">${escapeHtml(info.label)}</span>`;
};

function messageRow(text) {
  return `<tr><td colspan="${COLUMNS}">${escapeHtml(text)}</td></tr>`;
}

export function renderTable(handlers) {
  const tableBody = $('#bodyTable');
  if (!tableBody) return;

  const rows = currentPageRows();
  if (!rows.length) {
    tableBody.innerHTML = messageRow(state.allRows.length
      ? 'Nenhuma inutilização encontrada com esses filtros.'
      : 'Nenhuma inutilização registrada.');
    return;
  }

  tableBody.innerHTML = '';
  rows.forEach((row) => {
    const message = messageText(row);
    const total = rangeTotal(row);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.id ?? '')}</td>
      <td>${statusPill(row)}</td>
      <td>${escapeHtml(formatCnpj(row.companyCnpj) || '—')}</td>
      <td>${escapeHtml(modelText(row))}<br><small>Série ${escapeHtml(row.serie ?? '—')}</small></td>
      <td><b>${escapeHtml(rangeText(row))}</b><br><small>${plural(total, 'número', 'números')}</small></td>
      <td>${escapeHtml(row.year ?? '—')}</td>
      <td class="td-left" title="${escapeHtml(message)}">${escapeHtml(message || '—')}${row.protocol
        ? `<br><small>Protocolo ${escapeHtml(row.protocol)}</small>` : ''}</td>
      <td>${escapeHtml(formatDateTime(row.createdAt))}</td>
      <td>${actionIconsHtml([
        { action: 'view', title: 'Detalhes', attrs: { 'data-action': 'view' } },
        canConsult(row)
          ? { action: 'search', title: 'Consultar na SEFAZ', attrs: { 'data-action': 'consult' } }
          : null,
        { action: 'copy', title: 'Usar como modelo para nova inutilização', attrs: { 'data-action': 'copy' } },
      ])}</td>`;

    tr.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      const action = button?.dataset.action || 'view';
      if (button) event.stopPropagation();
      if (action === 'consult') handlers.onConsult(row, button);
      else if (action === 'copy') handlers.onCopy(row);
      else handlers.onView(row);
    });
    tableBody.appendChild(tr);
  });
}

export function renderFooter() {
  const total = state.filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  const start = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const end = Math.min(total, state.page * state.pageSize);

  const info = $('#apTableInfo');
  if (info) {
    info.textContent = total > state.pageSize
      ? `${start}–${end} de ${plural(total, 'registro', 'registros')}`
      : plural(total, 'registro', 'registros');
  }

  const pageInfo = $('#paginacaoInfo');
  if (pageInfo) pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  if ($('#btnPrev')) $('#btnPrev').disabled = state.page <= 1;
  if ($('#btnNext')) $('#btnNext').disabled = state.page >= totalPages;

  // Selos: contam todas as inutilizações
  const count = (keys) => state.allRows.filter((row) => keys.includes(statusKey(row))).length;
  const done = count(['done']);
  const processing = count(['processing', 'pending']);
  const errors = count(['error', 'rejected']);

  const set = (id, text, visible = true) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.style.display = visible ? '' : 'none'; // summary-pill ignora [hidden]
  };
  set('#sumDone', plural(done, 'inutilizada', 'inutilizadas'));
  set('#sumProcessing', `${processing} em processamento`, processing > 0);
  set('#sumError', `${errors} com erro`, errors > 0);
}

export function renderListLoading() {
  const tableBody = $('#bodyTable');
  if (tableBody) tableBody.innerHTML = messageRow('Carregando inutilizações...');
}

export function renderListError(message) {
  const tableBody = $('#bodyTable');
  if (tableBody) tableBody.innerHTML = messageRow(`Erro ao carregar inutilizações: ${message || ''}`);
}

/* =======================================================================
 * Modal de detalhes
 * ======================================================================= */
function field(label, value, span = '') {
  return `
    <div class="fields fields-h-6 fields-w-full fields-font-3 ${span}">
      <label>${escapeHtml(label)}</label>
      <input type="text" readonly value="${escapeHtml(value ?? '—')}">
    </div>`;
}

function textBlock(label, value, rows = 3) {
  return `
    <div class="fields fields-w-full fields-font-3 modal-field--span-full">
      <label>${escapeHtml(label)}</label>
      <textarea readonly rows="${rows}"
        class="textarea textarea-border-1 textarea-radius-4 textarea-w-10 textarea-resize-vertical">${escapeHtml(value || '—')}</textarea>
    </div>`;
}

function section(title, extra = '') {
  return `
    <div class="summary summary--between summary-gap-8 modal-field--span-full">
      <h4>${escapeHtml(title)}</h4>${extra}
    </div>`;
}

const DIVIDER = '<div class="modal-divider modal-divider--soft modal-field--span-full"></div>';

export function renderDetails(row) {
  const body = $('#detalhesBody');
  if (!body) return;

  const title = $('#detalhesTitulo');
  if (title) title.textContent = `Inutilização #${row.id} · ${modelText(row)} série ${row.serie ?? '—'}`;

  const total = rangeTotal(row);
  const technical = [
    ['Envio ao provedor (JSON)', prettyJson(row.requestPayload)],
    ['Retorno do provedor (JSON)', prettyJson(row.responsePayload)],
    ['XML enviado', row.xmlRequest],
    ['XML de retorno', row.xmlResponse],
  ].filter(([, value]) => value);

  body.innerHTML = `
    <div class="modal-form-grid modal-form-grid--6 fields-value-bold">
      ${section('Situação', statusPill(row))}
      ${field('Retorno SEFAZ', messageText(row) || '—', 'modal-field--span-4')}
      ${field('Protocolo', row.protocol || '—', 'modal-field--span-2')}
      ${field('Criado em', formatDateTime(row.createdAt), 'modal-field--span-3')}
      ${field('Atualizado em', formatDateTime(row.updatedAt), 'modal-field--span-3')}

      ${DIVIDER}
      ${section('Faixa inutilizada', `<div class="summary-pill summary-pill--primary">${plural(total, 'número', 'números')}</div>`)}
      ${field('CNPJ', formatCnpj(row.companyCnpj) || '—', 'modal-field--span-2')}
      ${field('Modelo', modelText(row))}
      ${field('Série', row.serie)}
      ${field('Ano', row.year)}
      ${field('Faixa', rangeText(row))}
      ${textBlock('Justificativa', row.justification, 2)}

      ${technical.length ? `
        ${DIVIDER}
        <details class="modal-field--span-full">
          <summary><b>Dados técnicos</b> <small>(JSON e XML trocados com o provedor/SEFAZ)</small></summary>
          <div class="modal-form-grid modal-form-grid--6">
            ${technical.map(([label, value]) => textBlock(label, value, 8)).join('')}
          </div>
        </details>` : ''}
    </div>`;

  const consult = $('#btnConsultar');
  if (consult) consult.style.display = canConsult(row) ? '' : 'none';
}
