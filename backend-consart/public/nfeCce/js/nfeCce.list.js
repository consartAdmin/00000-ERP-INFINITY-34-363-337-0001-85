/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.list.js                                               ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ║ Carrega o histórico, filtra/ordena/pagina na tela.                 ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { buscarHistorico } from './nfeCce.api.js';
import { readLocalFilters, readServerFilters } from './nfeCce.form.js';
import {
    renderEventosTable, renderFooter, renderListError, renderListLoading,
} from './nfeCce.render.js';
import { state } from './nfeCce.state.js';
import { notify, parseErrorMessage, pickFirst, resolveStatusKey, statusLabel } from './nfeCce.utils.js';

let rowHandlers = { onAction: () => {} };

export function setRowHandlers(handlers) {
    rowHandlers = handlers;
}

function normalizeEvent(row = {}) {
    const raw = row.raw_response || row.rawResponse || {};
    const status = pickFirst(
        row.status, raw?.status?.data?.status, raw?.status?.data?.situacao,
        raw?.status?.message, raw?.envio?.message,
    ) || '';
    const cstat = pickFirst(
        row.cstat, raw?.status?.data?.cStat, raw?.status?.data?.cstat, raw?.status?.data?.codigo,
    ) || '';
    const statusKey = resolveStatusKey(status, cstat);

    return {
        ...row,
        numero_sequencia: row.numero_sequencia ?? row.numeroSequencia ?? null,
        nfe_number: row.nfe_number || row.nfeNumber || '',
        nfe_key: row.nfe_key || row.nfeKey || '',
        nfe_plugnotas_id: row.nfe_plugnotas_id || row.nfePlugnotasId || '',
        order_id: row.order_id || row.orderId || '',
        customer_name: row.customer_name || row.customerName || '',
        created_by: row.created_by || row.createdBy || '',
        created_at: row.created_at || row.createdAt || '',
        resposta_sefaz: row.resposta_sefaz || row.respostaSefaz || '',
        status,
        cstat,
        status_key: statusKey,
        status_label: statusLabel(statusKey),
    };
}

function compare(a, b, column) {
    const x = a[column];
    const y = b[column];
    if (column === 'created_at') return new Date(x || 0) - new Date(y || 0);
    if (['numero_sequencia', 'nfe_number', 'order_id'].includes(column)) {
        return (Number(x) || 0) - (Number(y) || 0);
    }
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base', numeric: true });
}

function applyLocal() {
    const { search, status } = readLocalFilters();

    state.filteredRows = state.allRows.filter((row) => {
        if (status && row.status_key !== status) return false;
        if (!search) return true;
        return [row.customer_name, row.protocolo, row.correcao, row.nfe_number, row.created_by]
            .some((value) => String(value ?? '').toLowerCase().includes(search));
    });

    const direction = state.sortDirection === 'desc' ? -1 : 1;
    state.filteredRows.sort((a, b) => compare(a, b, state.sortColumn) * direction);

    const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
}

export function renderList() {
    applyLocal();
    renderEventosTable(rowHandlers);
    renderFooter();
}

export async function loadEventos() {
    if (state.loading) return;
    state.loading = true;
    renderListLoading();

    try {
        const data = await buscarHistorico(readServerFilters());
        const salvos = Array.isArray(data?.data?.salvos) ? data.data.salvos : [];
        state.allRows = salvos.map(normalizeEvent);
        state.page = 1;
        renderList();
    } catch (error) {
        state.allRows = [];
        state.filteredRows = [];
        const message = parseErrorMessage(error, 'Falha ao buscar as cartas de correção.');
        renderListError(message);
        renderFooter();
        notify(message, 'error');
    } finally {
        state.loading = false;
    }
}

/* ---------- filtros / paginação / ordenação ---------- */
let lastServerFilters = '';

export function applyFilters() {
    const serverFilters = JSON.stringify(readServerFilters());
    state.page = 1;
    if (serverFilters !== lastServerFilters) {
        lastServerFilters = serverFilters;
        return loadEventos();
    }
    renderList();
    return null;
}

export function rememberServerFilters() {
    lastServerFilters = JSON.stringify(readServerFilters());
}

export function goToPreviousPage() {
    if (state.page > 1) { state.page -= 1; renderList(); }
}

export function goToNextPage() {
    const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
    if (state.page < totalPages) { state.page += 1; renderList(); }
}

export function setPageSize(value) {
    state.pageSize = Number(value) || 50;
    state.page = 1;
    renderList();
}

export function setSort({ column, direction }) {
    state.sortColumn = column;
    state.sortDirection = direction;
    state.page = 1;
    renderList();
}
