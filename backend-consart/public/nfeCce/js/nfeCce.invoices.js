/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.invoices.js                                           ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ║ DESCRIPTION: Seleção de NF-e emitida a partir de invoicesIssued    ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { listarNfesEmitidas } from './nfeCce.api.js';
import { fillNovaCceInvoice } from './nfeCce.form.js';
import { closeNfeEmitidaModal } from './nfeCce.modal.js';
import { state } from './nfeCce.state.js';
import {
    $, escapeHtml, formatDate, formatMoney, formatNfeKey, normalizeText, notify, parseErrorMessage,
} from './nfeCce.utils.js';

const COLUMNS = 7;

function pick(row, ...keys) {
    for (const key of keys) {
        const value = row?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
}

function normalizeInvoice(row) {
    return {
        invoice_id: pick(row, 'invoice_id', 'invoiceId', 'id'),
        order_id: pick(row, 'order_id', 'orderId'),
        nfe_number: pick(row, 'nfe_number', 'nfeNumber', 'numero'),
        nfe_key: pick(row, 'nfe_key', 'nfeKey', 'chave'),
        nfe_status: pick(row, 'nfe_status', 'nfeStatus', 'status'),
        customer_name: pick(row, 'customer_name', 'customerName', 'trade_name', 'company_name', 'recipient_name'),
        issued_at: pick(row, 'issued_at', 'issuedAt', 'issued_date', 'issuedDate'),
        total_amount: pick(row, 'total_amount', 'totalAmount', 'valorTotal'),
        nfe_provider_id: pick(
            row, 'nfe_provider_id', 'nfeProviderId', 'nfe_plugnotas_id', 'nfePlugnotasId', 'provider_id', 'providerId'
        ),
    };
}

function invoiceStatusPill(status) {
    const text = String(status || '').toUpperCase();
    if (!text) return '—';
    const variant = /AUTORIZ|CONCLU|EMITID/.test(text) ? 'success'
        : (/CANCEL|REJEI|DENEG|ERRO/.test(text) ? 'danger' : 'warning');
    return `<span class="summary-pill summary-pill--${variant}">${escapeHtml(status)}</span>`;
}

const isBlocked = (row) => /CANCEL|DENEG|INUTIL/.test(String(row.nfe_status || '').toUpperCase());

function setInfo(text) {
    const info = $('#nfesEmitidasInfo');
    if (info) info.textContent = text;
}

export function renderNfesEmitidas(rows = [], emptyText = 'Pesquise pelo número, chave ou pedido.') {
    const tbody = $('#tbodyNfesEmitidas');
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="${COLUMNS}">${escapeHtml(emptyText)}</td></tr>`;
        setInfo('0 NF-e encontradas');
        return;
    }

    tbody.innerHTML = rows.map((row, index) => {
        const blocked = isBlocked(row);
        return `
        <tr${blocked ? ' title="NF-e cancelada/denegada não aceita CC-e"' : ` data-select-invoice-index="${index}"`}>
            <td><b>${escapeHtml(row.nfe_number || '—')}</b></td>
            <td>${escapeHtml(row.order_id || '—')}</td>
            <td class="td-left"><small>${escapeHtml(formatNfeKey(row.nfe_key) || '—')}</small></td>
            <td>${invoiceStatusPill(row.nfe_status)}</td>
            <td>${escapeHtml(formatDate(row.issued_at))}</td>
            <td>${escapeHtml(formatMoney(row.total_amount))}</td>
            <td>${actionIconsHtml([
        blocked
            ? { action: 'confirm', title: 'NF-e cancelada/denegada não aceita CC-e', disabled: true }
            : { action: 'confirm', title: 'Usar esta NF-e', attrs: { 'data-select-invoice-index': index } },
    ])}</td>
        </tr>`;
    }).join('');

    setInfo(`${rows.length} NF-e encontrada${rows.length === 1 ? '' : 's'}`);
}

export async function onBuscarNfesEmitidas() {
    try {
        setInfo('Carregando...');
        const rows = await listarNfesEmitidas(normalizeText($('#buscaNfeEmitida')?.value));
        state.nfesEmitidas = rows.map(normalizeInvoice);
        renderNfesEmitidas(state.nfesEmitidas, 'Nenhuma NF-e emitida encontrada.');
    } catch (error) {
        state.nfesEmitidas = [];
        renderNfesEmitidas([], 'Não foi possível carregar as NF-e emitidas.');
        notify(parseErrorMessage(error, 'Falha ao carregar as NF-e emitidas.'), 'error');
    }
}

export function onTabelaNfesEmitidasClick(event) {
    const target = event.target.closest('[data-select-invoice-index]');
    if (!target) return;
    const invoice = state.nfesEmitidas[Number(target.dataset.selectInvoiceIndex)];
    if (!invoice) return;

    fillNovaCceInvoice(invoice);
    closeNfeEmitidaModal();
    $('#correcao')?.focus();
}
