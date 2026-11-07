/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.actions.js                                            ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { consultarStatus, emitirCce } from './nfeCce.api.js';
import { ROUTES } from './nfeCce.config.js';
import {
    clearFilterFields, fillNovaCceInvoice, readConsultaStatusForm, readEmissaoForm, resetNovaCceForm,
} from './nfeCce.form.js';
import { renderNfesEmitidas } from './nfeCce.invoices.js';
import { applyFilters, loadEventos, rememberServerFilters } from './nfeCce.list.js';
import {
    closeDetalhesModal, closeNovaCceModal, openDetalhesModal, openNovaCceModal, openStatusModal,
} from './nfeCce.modal.js';
import { renderDetalhes } from './nfeCce.render.js';
import { state } from './nfeCce.state.js';
import {
    $, confirmCenter, extractEventStatus, getBestEventIdentifier, notify, openUrl, parseErrorMessage,
    resolveStatusKey, statusPillHtml,
} from './nfeCce.utils.js';
import { validateConsultaStatusForm, validateEmissaoForm } from './nfeCce.validation.js';

/* ---------------- NOVA CC-e ---------------- */
export function newCce(invoice = null) {
    resetNovaCceForm();
    renderNfesEmitidas([]);
    if (invoice) fillNovaCceInvoice(invoice);
    openNovaCceModal();
}

/** Nova CC-e já com a NF-e de uma CC-e da lista. */
export function newCceFromEvent(row) {
    if (!row) return;
    closeDetalhesModal();
    newCce({
        nfe_number: row.nfe_number,
        order_id: row.order_id,
        customer_name: row.customer_name,
        nfe_key: row.nfe_key,
        nfe_provider_id: row.nfe_plugnotas_id,
    });
}

export async function onEmitirCce(event) {
    event?.preventDefault?.();

    let payload;
    try {
        payload = validateEmissaoForm(readEmissaoForm());
    } catch (error) {
        notify(parseErrorMessage(error), 'warning');
        return;
    }

    const nfe = $('#nfeNumber')?.value || payload.nfeKey || payload.idOuChave;
    const ok = await confirmCenter(
        `Enviar a Carta de Correção da NF-e ${nfe} para a SEFAZ? O evento não pode ser cancelado depois de registrado.`,
        { title: 'Emitir CC-e', confirmLabel: 'Emitir CC-e' },
    );
    if (!ok) return;

    const button = $('#btnEmitirCce');
    if (button) button.disabled = true;

    try {
        const data = await emitirCce({
            idOuChave: payload.idOuChave || undefined,
            orderId: payload.orderId || undefined,
            nfeKey: payload.nfeKey || undefined,
            nfePlugnotasId: payload.nfePlugnotasId || undefined,
            correcao: payload.correcao,
        });

        const result = extractEventStatus(data?.data?.status || data?.data?.envio || data?.data || {});
        const key = resolveStatusKey(result.status, result.cstat);
        closeNovaCceModal();

        const lines = [
            `NF-e ${nfe}`,
            result.numeroSequencia !== '—' ? `Sequência: ${result.numeroSequencia}` : '',
            result.protocolo !== '—' ? `Protocolo: ${result.protocolo}` : '',
            key === 'processando' ? 'A SEFAZ ainda está processando; o status atualiza ao recarregar a lista.' : '',
        ].filter(Boolean).join('\n');
        notify(lines, key === 'rejeitada' ? 'error' : 'success',
            key === 'rejeitada' ? 'CC-e rejeitada' : 'CC-e enviada');

        await loadEventos();
    } catch (error) {
        notify(parseErrorMessage(error, 'Falha ao emitir CC-e.'), 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

/* ---------------- LISTA ---------------- */
export function openEventDocument(row, type) {
    const identifier = getBestEventIdentifier(row);
    if (!identifier) {
        notify('Esta CC-e não tem identificador para abrir o documento.', 'warning');
        return;
    }
    openUrl(type === 'pdf' ? ROUTES.pdf(identifier) : ROUTES.xml(identifier));
}

export function showDetalhes(row) {
    state.selectedEvent = row;
    renderDetalhes(row);
    openDetalhesModal();
}

export function onRowAction(action, row) {
    if (action === 'pdf') return openEventDocument(row, 'pdf');
    if (action === 'xml') return openEventDocument(row, 'xml');
    if (action === 'new') return newCceFromEvent(row);
    return showDetalhes(row);
}

export function clearFilters() {
    clearFilterFields();
    applyFilters();
}

export function reloadList() {
    rememberServerFilters();
    return loadEventos();
}

/* ---------------- CONSULTAR STATUS ---------------- */
function fillConsulta(result = null) {
    const set = (selector, value) => { const el = $(selector); if (el) el.value = value ?? ''; };
    set('#consultaSequencia', result?.numeroSequencia === '—' ? '' : result?.numeroSequencia);
    set('#consultaProtocolo', result?.protocolo === '—' ? '' : result?.protocolo);
    set('#consultaCstat', result?.cstat === '—' ? '' : result?.cstat);
    set('#consultaMotivo', result ? [result.status, result.respostaSefaz].filter((v) => v && v !== '—').join(' · ') : '');
    const pill = $('#consultaStatusPill');
    if (pill) pill.innerHTML = result ? statusPillHtml(resolveStatusKey(result.status, result.cstat)) : '';
    const hasId = Boolean(result && state.lastStatusIdentifier);
    if ($('#btnConsultaPdf')) $('#btnConsultaPdf').disabled = !hasId;
    if ($('#btnConsultaXml')) $('#btnConsultaXml').disabled = !hasId;
}

export function openConsultaStatus() {
    state.lastStatusIdentifier = '';
    fillConsulta(null);
    openStatusModal();
}

export async function onConsultarStatus(event) {
    event?.preventDefault?.();

    let payload;
    try {
        payload = validateConsultaStatusForm(readConsultaStatusForm());
    } catch (error) {
        notify(parseErrorMessage(error), 'warning');
        return;
    }

    const button = $('#btnConsultarStatus');
    if (button) button.disabled = true;
    try {
        const data = await consultarStatus(payload.identificador, payload.listaCce);
        state.lastStatusIdentifier = payload.identificador;
        fillConsulta(extractEventStatus(data?.data || data));
        await loadEventos();
    } catch (error) {
        state.lastStatusIdentifier = '';
        fillConsulta(null);
        notify(parseErrorMessage(error, 'Falha ao consultar status.'), 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

export function openConsultaDocument(type) {
    if (!state.lastStatusIdentifier) return;
    openUrl(type === 'pdf' ? ROUTES.pdf(state.lastStatusIdentifier) : ROUTES.xml(state.lastStatusIdentifier));
}
