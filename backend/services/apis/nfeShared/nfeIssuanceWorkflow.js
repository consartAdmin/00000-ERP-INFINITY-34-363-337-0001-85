// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeIssuanceWorkflow.js — Emissão e conciliação compartilhadas      ║
// ║ CONSART ERP | Budget + Order | Node.js ESM                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
    normalizeProviderResponse,
    resolveProviderReference,
    serializeProviderError,
} from './nfeProviderResponse.js';

function callback(value, name, required = true) {
    if (typeof value === 'function') return value;
    if (!required) return null;
    const error = new TypeError(`${name} deve ser uma função.`);
    error.code = 'INVALID_NFE_WORKFLOW_CALLBACK';
    throw error;
}

async function safelyMarkError(markError, payload) {
    try { await markError(payload); } catch (persistError) {
        console.error('[nfeIssuanceWorkflow][markError]', persistError);
    }
}

export async function issueNfe({
    sourceId,
    userId = null,
    loadDocument,
    createAttempt,
    reserveNumber,
    buildPayload,
    saveRequest,
    sendNfe,
    markProcessing,
    markRejected,
    markError,
} = {}) {
    const document = await callback(loadDocument, 'loadDocument')(sourceId);
    const attempt = await callback(createAttempt, 'createAttempt')({ sourceId, userId, document });
    if (!attempt?.attempt_id) throw new Error('A tentativa criada não retornou attempt_id.');

    const attemptId = attempt.attempt_id;
    const errorWriter = callback(markError, 'markError');
    try {
        const nfeNumber = await callback(reserveNumber, 'reserveNumber')(attemptId);
        const numberedDocument = {
            ...document,
            header: { ...(document?.header ?? {}), nfe_number: nfeNumber },
        };
        const payload = await callback(buildPayload, 'buildPayload')(numberedDocument, { attempt, nfeNumber });
        await callback(saveRequest, 'saveRequest')({ attemptId, attempt, nfeNumber, document: numberedDocument, payload });

        const response = await callback(sendNfe, 'sendNfe')(payload, { attempt, nfeNumber });
        if (!response?.ok) {
            await safelyMarkError(errorWriter, {
                attemptId,
                attempt,
                error: response?.error ?? response,
                serializedError: serializeProviderError(response?.error ?? response),
                response,
            });
            return { ...response, attempt_id: attemptId };
        }

        const provider = normalizeProviderResponse(response, { nfeNumber });
        if (provider.rejected && markRejected) {
            await markRejected({ attemptId, attempt, provider, response });
        } else {
            await callback(markProcessing, 'markProcessing')({ attemptId, attempt, provider, response });
        }

        return {
            ok: true,
            status: provider.rejected ? 200 : 202,
            pending: !provider.rejected,
            authorized: false,
            rejected: provider.rejected,
            attempt_id: attemptId,
            message: provider.message ?? (provider.rejected ? 'NF-e rejeitada.' : 'NF-e enviada para processamento.'),
            nfe: provider,
        };
    } catch (error) {
        await safelyMarkError(errorWriter, {
            attemptId,
            attempt,
            error,
            serializedError: serializeProviderError(error),
        });
        error.attempt_id = attemptId;
        throw error;
    }
}

export async function reconcileNfe({
    sourceId,
    loadDocument,
    getLatestAttempt,
    consultNfe,
    markAuthorized,
    markRejected,
    markProcessing,
    markConsultError,
    finalizeAuthorization,
} = {}) {
    const documentLoader = callback(loadDocument, 'loadDocument', false);
    const document = documentLoader ? await documentLoader(sourceId) : null;
    const attempt = await callback(getLatestAttempt, 'getLatestAttempt')(sourceId);
    const attemptId = attempt?.attempt_id ?? null;
    const reference = resolveProviderReference(attempt ?? {});

    if (!reference) {
        return { ok: false, status: 404, error: 'SEM_IDENTIFICADOR_NFE', attempt_id: attemptId };
    }

    const response = await callback(consultNfe, 'consultNfe')(reference, { attempt, document });
    if (!response?.ok) {
        const errorHandler = callback(markConsultError, 'markConsultError', false);
        if (errorHandler) {
            await errorHandler({ attemptId, attempt, response, serializedError: serializeProviderError(response?.error ?? response) });
        }
        return { ...response, attempt_id: attemptId };
    }

    const provider = normalizeProviderResponse(response, {
        providerId: attempt?.provider_id,
        integrationId: attempt?.integration_id,
        accessKey: attempt?.access_key,
        nfeNumber: attempt?.nfe_number,
        series: attempt?.nfe_series,
        environment: attempt?.nfe_environment,
        protocol: attempt?.protocol,
    });

    if (provider.authorized) {
        await callback(markAuthorized, 'markAuthorized')({ attemptId, attempt, provider, response });
    } else if (provider.rejected) {
        await callback(markRejected, 'markRejected')({ attemptId, attempt, provider, response });
    } else {
        await callback(markProcessing, 'markProcessing')({ attemptId, attempt, provider, response });
    }

    let finalization = null;
    if (provider.authorized) {
        finalization = await callback(finalizeAuthorization, 'finalizeAuthorization')({
            sourceId,
            attemptId,
            attempt,
            document,
            provider,
            response,
        });
    }

    return {
        ok: true,
        status: provider.authorized || provider.rejected ? 200 : 202,
        pending: provider.pending,
        authorized: provider.authorized,
        rejected: provider.rejected,
        attempt_id: attemptId,
        message: provider.message ?? (provider.authorized ? 'NF-e autorizada com sucesso.' : provider.rejected ? 'NF-e rejeitada.' : 'NF-e ainda está sendo processada.'),
        finalization,
        nfe: provider,
    };
}

export default { issueNfe, reconcileNfe };

