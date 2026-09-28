// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeAuthorizationWorkflow.js — Pós-autorização compartilhada        ║
// ║ CONSART ERP | Estoque | Fatura | Financeiro | Node.js ESM          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

function requiredFunction(value, name) {
    if (typeof value !== 'function') {
        const error = new TypeError(`${name} deve ser uma função.`);
        error.code = 'INVALID_NFE_AUTHORIZATION_CALLBACK';
        throw error;
    }
    return value;
}

function invoiceIdFrom(result) {
    return result?.invoice_id ?? result?.data?.invoice_id ?? result?.invoice?.invoice_id ?? null;
}

export async function finalizeAuthorizedNfe({
    context = {},
    movesStock = false,
    generatesReceivable = false,
    wasFinalized,
    markFinalized,
    applyStock,
    createInvoice,
    attachInvoice,
    markSourceAuthorized,
    syncReceivable,
} = {}) {
    requiredFunction(createInvoice, 'createInvoice');

    if (wasFinalized && await wasFinalized(context)) {
        return { alreadyFinalized: true, stockResult: null, invoiceResult: null, invoiceId: null, receivableResult: null };
    }

    let stockResult = null;
    if (movesStock === true) {
        stockResult = await requiredFunction(applyStock, 'applyStock')(context);
    }

    const invoiceResult = await createInvoice(context);
    const invoiceId = invoiceIdFrom(invoiceResult);
    if (invoiceId && attachInvoice) await attachInvoice(invoiceId, context);
    if (markSourceAuthorized) await markSourceAuthorized({ ...context, invoiceId, invoiceResult });

    let receivableResult = null;
    if (generatesReceivable === true) {
        receivableResult = await requiredFunction(syncReceivable, 'syncReceivable')({
            ...context,
            invoiceId,
            invoiceResult,
        });
    }

    const result = { alreadyFinalized: false, stockResult, invoiceResult, invoiceId, receivableResult };
    if (markFinalized) await markFinalized({ ...context, ...result });
    return result;
}

export default { finalizeAuthorizedNfe };

