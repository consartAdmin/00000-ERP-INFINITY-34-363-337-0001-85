/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.form.js                                               ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { $, formatDate, formatMoney, formatNfeKey, isNfeKey, normalizeText } from './nfeCce.utils.js';

const val = (selector) => normalizeText($(selector)?.value);
const set = (selector, value) => { const el = $(selector); if (el) el.value = value ?? ''; };

export function readEmissaoForm() {
    return {
        idOuChave: val('#idOuChave'),
        orderId: val('#orderId'),
        nfeKey: val('#nfeKey').replace(/\s/g, ''),
        nfePlugnotasId: val('#nfePlugnotasId'),
        correcao: val('#correcao'),
    };
}

export function readConsultaStatusForm() {
    return {
        identificador: isNfeKey(val('#consultaIdentificador'))
            ? val('#consultaIdentificador').replace(/\s/g, '')
            : val('#consultaIdentificador'),
        listaCce: Boolean($('#consultaListaCce')?.checked),
    };
}

/** Filtros enviados à API (Nº NF-e e chave/ID). Busca e status filtram na tela. */
export function readServerFilters() {
    const chave = val('#filtroChave').replace(/\s/g, '');
    return {
        nfeNumber: val('#filtroNfeNumber'),
        nfeKey: isNfeKey(chave) ? chave : '',
        idOuChave: chave && !isNfeKey(chave) ? chave : '',
    };
}

export function readLocalFilters() {
    return {
        search: val('#busca').toLowerCase(),
        status: $('#filtroStatus')?.value || '',
    };
}

export function clearFilterFields() {
    ['#busca', '#filtroNfeNumber', '#filtroChave'].forEach((s) => set(s, ''));
    set('#filtroStatus', '');
}

export function updateCorrecaoCounter() {
    const length = ($('#correcao')?.value || '').length;
    const counter = $('#contadorCorrecao');
    if (!counter) return;
    counter.textContent = `${length} / 1000`;
    counter.classList.toggle('summary-pill--info', length >= 15);
    counter.classList.toggle('summary-pill--warning', length > 0 && length < 15);
}

/** Preenche a Nova CC-e com uma NF-e (da busca ou de uma CC-e da lista). */
export function fillNovaCceInvoice(invoice = {}) {
    const key = String(invoice.nfe_key || '').replace(/\s/g, '');
    set('#invoiceId', invoice.invoice_id);
    set('#nfeNumber', invoice.nfe_number);
    set('#orderId', invoice.order_id);
    set('#nfeCustomer', invoice.customer_name);
    set('#nfeIssuedAt', invoice.issued_at ? formatDate(invoice.issued_at) : '');
    set('#nfeTotal', invoice.total_amount !== undefined && invoice.total_amount !== '' ? formatMoney(invoice.total_amount) : '');
    set('#nfeKey', formatNfeKey(key));
    set('#nfePlugnotasId', invoice.nfe_provider_id);
    // O endpoint aceita idOuChave: prioriza o ID do provedor e usa a chave como reserva.
    set('#idOuChave', invoice.nfe_provider_id || key);
}

export function resetNovaCceForm() {
    $('#formNovaCce')?.reset();
    ['#invoiceId', '#nfePlugnotasId', '#idOuChave'].forEach((s) => set(s, ''));
    updateCorrecaoCounter();
}
