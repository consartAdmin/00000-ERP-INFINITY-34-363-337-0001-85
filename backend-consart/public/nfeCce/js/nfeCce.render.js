/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.render.js                                             ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ║ Lista (actionIcons) + rodapé padrão + modal de detalhes.           ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { state } from './nfeCce.state.js';
import {
    $, escapeHtml, formatDateTime, formatNfeKey, getBestEventIdentifier, statusPillHtml,
} from './nfeCce.utils.js';

const COLUMNS = 9;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function messageRow(text) {
    return `<tr><td colspan="${COLUMNS}">${escapeHtml(text)}</td></tr>`;
}

function shortText(text, max = 90) {
    const value = String(text ?? '').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function currentPageRows() {
    const start = (state.page - 1) * state.pageSize;
    return state.filteredRows.slice(start, start + state.pageSize);
}

export function renderEventosTable(handlers) {
    const tbody = $('#tbodyEventosSalvos');
    if (!tbody) return;

    const rows = currentPageRows();
    if (!rows.length) {
        tbody.innerHTML = messageRow(
            state.allRows.length ? 'Nenhuma CC-e encontrada com esses filtros.' : 'Nenhuma carta de correção emitida.'
        );
        return;
    }

    tbody.innerHTML = '';
    rows.forEach((row) => {
        const hasDocs = Boolean(getBestEventIdentifier(row));
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td><b>${escapeHtml(row.numero_sequencia ?? '—')}</b></td>
      <td><b>${escapeHtml(row.nfe_number || '—')}</b>${row.order_id ? `<br><small>Pedido ${escapeHtml(row.order_id)}</small>` : ''}</td>
      <td class="td-left">${escapeHtml(row.customer_name || '—')}</td>
      <td class="td-left" title="${escapeHtml(row.correcao || '')}"><small>${escapeHtml(shortText(row.correcao) || '—')}</small></td>
      <td>${escapeHtml(row.protocolo || '—')}${row.cstat ? `<br><small>cStat ${escapeHtml(row.cstat)}</small>` : ''}</td>
      <td>${statusPillHtml(row.status_key)}</td>
      <td><small>${escapeHtml(row.created_by || '—')}</small></td>
      <td><small>${escapeHtml(formatDateTime(row.created_at))}</small></td>
      <td>${actionIconsHtml([
            { action: 'view', title: 'Ver detalhes', attrs: { 'data-action': 'view' } },
            { action: 'document', title: 'Abrir PDF', attrs: { 'data-action': 'pdf' }, disabled: !hasDocs },
            { action: 'code', title: 'Abrir XML', attrs: { 'data-action': 'xml' }, disabled: !hasDocs },
            { action: 'add', title: 'Nova CC-e desta NF-e', attrs: { 'data-action': 'new' } },
        ])}</td>`;

        tr.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (button?.disabled) return;
            const action = button?.dataset.action || 'view';
            if (button) event.stopPropagation();
            handlers.onAction(action, row);
        });
        tbody.appendChild(tr);
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
            : plural(total, 'registro encontrado', 'registros encontrados');
    }

    const pageInfo = $('#paginacaoInfo');
    if (pageInfo) pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
    if ($('#btnPrev')) $('#btnPrev').disabled = state.page <= 1;
    if ($('#btnNext')) $('#btnNext').disabled = state.page >= totalPages;

    // Selos contam tudo o que veio da API (não só a página/filtro de status).
    const count = (key) => state.allRows.filter((row) => row.status_key === key).length;
    const pills = [
        ['#sumRegistradas', count('registrada'), 'registrada', 'registradas', true],
        ['#sumProcessando', count('processando'), 'processando', 'processando', false],
        ['#sumRejeitadas', count('rejeitada'), 'rejeitada', 'rejeitadas', false],
    ];
    pills.forEach(([selector, n, one, many, alwaysVisible]) => {
        const pill = $(selector);
        if (!pill) return;
        pill.textContent = plural(n, one, many);
        // summary-pill ignora [hidden]: usar style.display
        pill.style.display = n || alwaysVisible ? '' : 'none';
    });
}

export function renderListLoading() {
    const tbody = $('#tbodyEventosSalvos');
    if (tbody) tbody.innerHTML = messageRow('Carregando cartas de correção...');
}

export function renderListError(message) {
    const tbody = $('#tbodyEventosSalvos');
    if (tbody) tbody.innerHTML = messageRow(`Erro ao carregar as cartas de correção: ${message || ''}`);
}

export function renderDetalhes(row) {
    const set = (selector, value) => { const el = $(selector); if (el) el.value = value ?? ''; };
    const title = $('#modalDetalhesEventoTitle');
    if (title) {
        title.textContent = `CC-e nº ${row.numero_sequencia ?? '—'} · NF-e ${row.nfe_number || '—'}`;
    }
    const status = $('#detStatus');
    if (status) status.innerHTML = statusPillHtml(row.status_key);

    set('#detNfeNumber', row.nfe_number || '—');
    set('#detOrderId', row.order_id || '—');
    set('#detCliente', row.customer_name || '—');
    set('#detNfeKey', formatNfeKey(row.nfe_key) || '—');
    set('#detPlugnotasId', row.nfe_plugnotas_id || '—');
    set('#detSequencia', row.numero_sequencia ?? '—');
    set('#detProtocolo', row.protocolo || '—');
    set('#detCstat', row.cstat || '—');
    set('#detCriado', `${row.created_by || '—'} · ${formatDateTime(row.created_at)}`);
    set('#detRespostaSefaz', row.resposta_sefaz || '—');
    set('#detCorrecao', row.correcao || '');

    const hasDocs = Boolean(getBestEventIdentifier(row));
    if ($('#btnAbrirPdfEvento')) $('#btnAbrirPdfEvento').disabled = !hasDocs;
    if ($('#btnAbrirXmlEvento')) $('#btnAbrirXmlEvento').disabled = !hasDocs;
}
