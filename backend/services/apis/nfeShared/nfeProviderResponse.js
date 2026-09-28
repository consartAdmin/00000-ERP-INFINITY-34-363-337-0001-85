// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeProviderResponse.js — Normalização das respostas do provedor    ║
// ║ CONSART ERP | NF-e compartilhada | Node.js ESM                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const AUTHORIZED = new Set(['AUTORIZADA', 'AUTORIZADO', 'AUTHORIZED', 'CONCLUIDA', 'CONCLUÍDA', 'CONCLUIDO', 'CONCLUÍDO']);
const REJECTED = new Set(['REJEITADA', 'REJEITADO', 'REJECTED']);
const DENIED = new Set(['DENEGADA', 'DENEGADO', 'DENIED']);
const CANCELLED = new Set(['CANCELADA', 'CANCELADO', 'CANCELED', 'CANCELLED']);
const ERROR = new Set(['ERRO', 'ERROR', 'FALHA', 'FAILED']);

function text(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

function first(...values) {
    return values.find((value) => value !== null && value !== undefined && value !== '') ?? null;
}

export function normalizeEnvironment(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === '1' || normalized.includes('PRODU')) return 'PRODUCAO';
    if (normalized === '2' || normalized.includes('HOMOLOG')) return 'HOMOLOGACAO';
    return normalized || null;
}

export function normalizeAccessKey(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length === 44 ? digits : null;
}

export function normalizeStatus(value) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (AUTHORIZED.has(raw)) return 'AUTHORIZED';
    if (REJECTED.has(raw)) return 'REJECTED';
    if (DENIED.has(raw)) return 'DENIED';
    if (CANCELLED.has(raw)) return 'CANCELLED';
    if (ERROR.has(raw)) return 'ERROR';
    return 'PROCESSING';
}

export function providerDocuments(response) {
    const root = response?.data ?? response;
    if (!root) return [];
    if (Array.isArray(root)) return root;
    for (const candidate of [root.documents, root.documentos, root.data, root.resumo]) {
        if (Array.isArray(candidate)) return candidate;
        if (candidate && typeof candidate === 'object') return [candidate];
    }
    return typeof root === 'object' ? [root] : [];
}

export function providerDocument(response) {
    return providerDocuments(response)[0] ?? {};
}

export function resolveProviderReference(attempt = {}) {
    const stored = providerDocument({ data: attempt.provider_response });
    return first(
        text(attempt.provider_id),
        normalizeAccessKey(attempt.access_key),
        text(attempt.integration_id),
        text(stored.id),
        normalizeAccessKey(first(stored.chave, stored.chaveAcesso, stored.chaveNfe)),
        text(stored.idIntegracao),
    );
}

export function normalizeProviderResponse(response, fallback = {}) {
    const document = providerDocument(response);
    const rawStatus = first(
        document.situacao,
        document.situacaoNfe,
        document.statusNfe,
        document.status,
        fallback.status,
        'PROCESSANDO',
    );
    const status = normalizeStatus(rawStatus);
    const authorized = status === 'AUTHORIZED';
    const rejected = status === 'REJECTED' || status === 'DENIED';

    return {
        status,
        rawStatus: text(rawStatus),
        authorized,
        rejected,
        denied: status === 'DENIED',
        cancelled: status === 'CANCELLED',
        error: status === 'ERROR',
        pending: !authorized && !rejected && !['CANCELLED', 'ERROR'].includes(status),
        providerId: text(first(document.id, document.providerId, fallback.providerId)),
        integrationId: text(first(document.idIntegracao, document.integrationId, fallback.integrationId)),
        accessKey: normalizeAccessKey(first(document.chave, document.chaveAcesso, document.chaveNfe, fallback.accessKey)),
        protocol: text(first(document.protocolo, document.numeroProtocolo, response?.data?.protocol, fallback.protocol)),
        nfeNumber: first(document.numero, document.numeroNfe, fallback.nfeNumber),
        series: first(document.serie, fallback.series),
        environment: normalizeEnvironment(first(document.ambiente, document.environment, fallback.environment)),
        authorizedAt: first(document.dataAutorizacao, document.dataAutorizada, fallback.authorizedAt),
        cStat: first(document.cStat, document.cstat, document.codigoStatus, document.codigoRetorno),
        message: text(first(document.mensagem, document.message, document.xMotivo, document.motivo, response?.message)),
        generatedXml: first(document.xml, fallback.generatedXml),
        document,
        raw: response?.data ?? response ?? {},
    };
}

export function serializeProviderError(value) {
    if (value == null) return {};
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            code: value.code ?? null,
            status: value.status ?? value.response?.status ?? null,
            details: value.details ?? value.response?.data ?? null,
        };
    }
    return typeof value === 'object' ? value : { message: String(value) };
}

export default {
    normalizeEnvironment,
    normalizeAccessKey,
    normalizeStatus,
    providerDocuments,
    providerDocument,
    resolveProviderReference,
    normalizeProviderResponse,
    serializeProviderError,
};

