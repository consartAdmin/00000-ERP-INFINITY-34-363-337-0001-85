/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.utils.js                                              ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

export const $ = (selector) => document.querySelector(selector);

export function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function parseErrorMessage(error, fallback = 'Ocorreu um erro.') {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    return error.message || fallback;
}

export function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR');
}

export function formatMoney(value) {
    const number = Number(value);
    if (value === '' || value === null || !Number.isFinite(number)) return '—';
    return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Chave de 44 dígitos agrupada de 4 em 4 (mais fácil de conferir). */
export function formatNfeKey(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length === 44 ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : String(value ?? '');
}

export const isNfeKey = (value) => /^\d{44}$/.test(String(value ?? '').replace(/\s/g, ''));

export function pickFirst(...values) {
    return values.find(
        (value) => value !== undefined && value !== null && String(value).trim() !== ''
    ) ?? null;
}

/* ---------------------------------------------------------------------
   STATUS DA CC-e → registrada | processando | rejeitada
   cStat 135/136 = evento registrado e vinculado à NF-e.
--------------------------------------------------------------------- */
const STATUS_LABEL = {
    registrada: 'Registrada',
    processando: 'Processando',
    rejeitada: 'Rejeitada',
};
const STATUS_PILL = {
    registrada: 'summary-pill--success',
    processando: 'summary-pill--warning',
    rejeitada: 'summary-pill--danger',
};

export function resolveStatusKey(status, cstat) {
    const code = String(cstat ?? '').trim();
    const text = String(status ?? '').toUpperCase();
    if (code === '135' || code === '136') return 'registrada';
    if (/CONCLU|REGISTRAD|AUTORIZAD|VINCULAD|SUCESSO/.test(text)) return 'registrada';
    if (/REJEI|ERRO|FALHA|DENEG|CANCEL/.test(text)) return 'rejeitada';
    if (code && !['', '—'].includes(code) && Number(code) >= 200) return 'rejeitada';
    return 'processando';
}

export const statusLabel = (key) => STATUS_LABEL[key] || STATUS_LABEL.processando;

export function statusPillHtml(key) {
    const k = STATUS_PILL[key] ? key : 'processando';
    return `<span class="summary-pill ${STATUS_PILL[k]}">${STATUS_LABEL[k]}</span>`;
}

export function extractEventStatus(data = {}) {
    const root = data?.data ?? data ?? {};
    const item = Array.isArray(root) ? (root[0] || {}) : root;

    return {
        protocolo: pickFirst(item.protocolo, item.protocol, item.nProt, item.numeroProtocolo) || '—',
        numeroSequencia: pickFirst(item.numeroSequencia, item.sequencia, item.sequence, item.seqEvento) || '—',
        status: pickFirst(item.status, item.situacao, item.descricaoSituacao, item.resposta) || '—',
        cstat: pickFirst(item.cStat, item.cstat, item.codigo, item.statusCodigo) || '—',
        respostaSefaz: pickFirst(item.respostaSefaz, item.xMotivo, item.motivo, item.message, item.mensagem) || '—',
    };
}

export function openUrl(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
}

export function getBestEventIdentifier(row) {
    if (!row) return '';
    return String(
        row.nfe_plugnotas_id || row.nfePlugnotasId || row.protocolo || row.nfe_key || row.nfeKey || ''
    ).trim();
}

/* ---------------------------------------------------------------------
   AVISOS / CONFIRMAÇÕES — centerAlertModal (padrão CONSART)
--------------------------------------------------------------------- */
export function notify(message, type = 'success', title) {
    const variant = ['error', 'warning', 'info'].includes(type) ? type : 'success';
    return showCenterModal({
        variant,
        title: title || (variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Carta de Correção')),
        message: String(message ?? ''),
        timeoutMs: variant === 'success' ? 3500 : undefined,
    });
}

export async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Confirmar' } = {}) {
    const button = await showCenterModal({
        variant: 'warning',
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
