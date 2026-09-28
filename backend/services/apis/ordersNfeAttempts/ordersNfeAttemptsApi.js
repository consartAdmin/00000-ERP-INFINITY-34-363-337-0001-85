// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ordersNfeAttemptsApi.js — Persistência das tentativas de NF-e      ║
// ║ CONSART ERP | PostgreSQL | ESM                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../../config/db.js';
import ordersApi from '../orders/ordersApi.js';
import tecnospeedNfeApi from '../../../repositories/tecnoSpeedNfe/tecnoSpeedNfe.index.js';
import invoicesIssuedApi from '../../../repositories/invoicesIssued/invoicesIssued.index.js';
import nfeAsaasSyncApi from '../../../repositories/nfeAsaasSync/nfeAsaasSync.index.js';
import * as stockFromOrdersService from '../../stockFromOrdersService.js';

import {
    ORDERS_NFE_ATTEMPTS_TABLE,
    ORDERS_NFE_ATTEMPT_ITEMS_TABLE,
    ORDER_NFE_ATTEMPT_INSERT_COLUMNS,
    ORDER_NFE_ATTEMPT_UPDATE_COLUMNS,
    ORDER_NFE_ATTEMPT_JSON_COLUMNS,
    ORDER_NFE_ATTEMPT_ITEM_INSERT_COLUMNS,
    ORDER_NFE_ATTEMPT_ITEM_JSON_COLUMNS,
} from '../../../repositories/ordersNfeAttempts/ordersNfeAttempts.catalog.js';

const ATTEMPT_INSERT = new Set(ORDER_NFE_ATTEMPT_INSERT_COLUMNS);
const ATTEMPT_UPDATE = new Set(ORDER_NFE_ATTEMPT_UPDATE_COLUMNS);
const ATTEMPT_JSON = new Set(ORDER_NFE_ATTEMPT_JSON_COLUMNS);
const ITEM_INSERT = new Set(ORDER_NFE_ATTEMPT_ITEM_INSERT_COLUMNS);
const ITEM_JSON = new Set(ORDER_NFE_ATTEMPT_ITEM_JSON_COLUMNS);

function positiveBigInt(value, field) {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
        const error = new Error(`${field} deve ser um inteiro positivo.`);
        error.status = 400;
        throw error;
    }
    return normalized;
}

function positiveInteger(value, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
        const error = new Error(`${field} deve ser um inteiro positivo.`);
        error.status = 400;
        throw error;
    }
    return number;
}

function pageSize(value, fallback = 50, maximum = 200) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return Math.min(number, maximum);
}

function offsetValue(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
}

function saoPauloDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const map = Object.fromEntries(
        parts.map(({ type, value: partValue }) => [type, partValue]),
    );

    return `${map.year}-${map.month}-${map.day}`;
}

function normalizeProviderDateTime(value) {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    const brazilian = raw.match(
        /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );

    if (brazilian) {
        const [, day, month, year, hour = '00', minute = '00', second = '00'] =
            brazilian;
        const parsed = new Date(
            `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`,
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeValue(column, value, jsonColumns) {
    if (!jsonColumns.has(column) || value === null || value === undefined) {
        return value;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function buildInsert(data, allowedColumns, jsonColumns, extra = {}) {
    const source = { ...data, ...extra };
    const columns = Object.keys(source).filter(
        (column) => allowedColumns.has(column) && source[column] !== undefined,
    );

    if (columns.length === 0) {
        throw new Error('Nenhum campo válido foi informado para inserção.');
    }

    return {
        columns,
        names: columns.map((column) => `"${column}"`).join(', '),
        placeholders: columns.map((_, index) => `$${index + 1}`).join(', '),
        values: columns.map((column) => serializeValue(
            column,
            source[column],
            jsonColumns,
        )),
    };
}

function buildUpdate(data) {
    const columns = Object.keys(data).filter(
        (column) => ATTEMPT_UPDATE.has(column) && data[column] !== undefined,
    );

    return {
        columns,
        setClause: columns
            .map((column, index) => `"${column}" = $${index + 1}`)
            .join(', '),
        values: columns.map((column) => serializeValue(
            column,
            data[column],
            ATTEMPT_JSON,
        )),
    };
}

async function transaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function ensureOrder(client, orderId) {
    const result = await client.query(
        `SELECT order_id FROM public.orders WHERE order_id = $1 FOR UPDATE`,
        [orderId],
    );
    if (result.rowCount === 0) {
        const error = new Error(`Pedido ${orderId} não encontrado.`);
        error.status = 404;
        throw error;
    }
}

async function insertItems(client, attemptId, items = []) {
    const rows = [];

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index] ?? {};
        const payload = {
            ...item,
            item_number: item.item_number ?? index + 1,
        };

        if (!String(payload.product_code ?? '').trim()) {
            const error = new Error(`Item ${index + 1}: product_code é obrigatório.`);
            error.status = 400;
            throw error;
        }
        if (!String(payload.description ?? '').trim()) {
            const error = new Error(`Item ${index + 1}: description é obrigatória.`);
            error.status = 400;
            throw error;
        }

        payload.item_number = positiveInteger(payload.item_number, 'item_number');
        const insert = buildInsert(payload, ITEM_INSERT, ITEM_JSON);
        const names = ['"attempt_id"', ...insert.columns.map(
            (column) => `"${column}"`,
        )].join(', ');
        const placeholders = ['$1', ...insert.columns.map(
            (_, position) => `$${position + 2}`,
        )].join(', ');

        const result = await client.query(
            `INSERT INTO ${ORDERS_NFE_ATTEMPT_ITEMS_TABLE} (${names})
       VALUES (${placeholders})
       RETURNING *`,
            [attemptId, ...insert.values],
        );
        rows.push(result.rows[0]);
    }

    return rows;
}

export async function createAttempt(data = {}, items = []) {
    const orderId = positiveBigInt(data.order_id, 'order_id');
    positiveInteger(data.nfe_status_id, 'nfe_status_id');

    return transaction(async (client) => {
        await ensureOrder(client, orderId);

        const sequenceResult = await client.query(
            `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
         FROM ${ORDERS_NFE_ATTEMPTS_TABLE}
        WHERE order_id = $1`,
            [orderId],
        );
        const attemptNumber = Number(sequenceResult.rows[0].attempt_number);

        const insert = buildInsert(
            { ...data, order_id: orderId },
            ATTEMPT_INSERT,
            ATTEMPT_JSON,
        );

        const result = await client.query(
            `INSERT INTO ${ORDERS_NFE_ATTEMPTS_TABLE}
         (${insert.names}, attempt_number)
       VALUES (${insert.placeholders}, $${insert.values.length + 1})
       RETURNING *`,
            [...insert.values, attemptNumber],
        );

        const attempt = result.rows[0];
        const savedItems = await insertItems(client, attempt.attempt_id, items);
        return { ...attempt, items: savedItems };
    });
}

export async function addItems(attemptId, items = []) {
    const id = positiveBigInt(attemptId, 'attempt_id');
    return transaction(async (client) => {
        const attempt = await client.query(
            `SELECT attempt_id
         FROM ${ORDERS_NFE_ATTEMPTS_TABLE}
        WHERE attempt_id = $1
        FOR UPDATE`,
            [id],
        );
        if (attempt.rowCount === 0) {
            const error = new Error(`Tentativa ${id} não encontrada.`);
            error.status = 404;
            throw error;
        }
        return insertItems(client, id, items);
    });
}

export async function replaceItems(attemptId, items = []) {
    const id = positiveBigInt(attemptId, 'attempt_id');
    return transaction(async (client) => {
        const attempt = await client.query(
            `SELECT attempt_id
         FROM ${ORDERS_NFE_ATTEMPTS_TABLE}
        WHERE attempt_id = $1
        FOR UPDATE`,
            [id],
        );
        if (attempt.rowCount === 0) {
            const error = new Error(`Tentativa ${id} não encontrada.`);
            error.status = 404;
            throw error;
        }
        await client.query(
            `DELETE FROM ${ORDERS_NFE_ATTEMPT_ITEMS_TABLE} WHERE attempt_id = $1`,
            [id],
        );
        return insertItems(client, id, items);
    });
}

export async function getById(attemptId, { includeItems = true } = {}) {
    const id = positiveBigInt(attemptId, 'attempt_id');
    const result = await pool.query(
        `SELECT a.*
       FROM ${ORDERS_NFE_ATTEMPTS_TABLE} a
      WHERE a.attempt_id = $1`,
        [id],
    );
    if (result.rowCount === 0) return null;
    if (!includeItems) return result.rows[0];

    const itemResult = await pool.query(
        `SELECT *
       FROM ${ORDERS_NFE_ATTEMPT_ITEMS_TABLE}
      WHERE attempt_id = $1
      ORDER BY item_number ASC, attempt_item_id ASC`,
        [id],
    );
    return { ...result.rows[0], items: itemResult.rows };
}

export async function getLatestByOrderId(orderId, options = {}) {
    const id = positiveBigInt(orderId, 'order_id');
    const result = await pool.query(
        `SELECT attempt_id
       FROM ${ORDERS_NFE_ATTEMPTS_TABLE}
      WHERE order_id = $1
      ORDER BY attempt_number DESC, attempt_id DESC
      LIMIT 1`,
        [id],
    );
    if (result.rowCount === 0) return null;
    return getById(result.rows[0].attempt_id, options);
}

export async function getLatestTrackableByOrderId(orderId, options = {}) {
    const id = positiveBigInt(orderId, 'order_id');
    const result = await pool.query(
        `SELECT *
           FROM ${ORDERS_NFE_ATTEMPTS_TABLE}
          WHERE order_id = $1
          ORDER BY attempt_number DESC, attempt_id DESC`,
        [id],
    );

    const attempt = result.rows.find((row) => {
        const storedDocument = providerDocument({ data: row.provider_response });
        return Boolean(
            String(row.provider_id ?? '').trim() ||
            String(row.access_key ?? '').trim() ||
            String(row.integration_id ?? '').trim() ||
            String(storedDocument?.id ?? '').trim() ||
            String(storedDocument?.chave ?? storedDocument?.chaveAcesso ?? '').trim() ||
            String(storedDocument?.idIntegracao ?? '').trim()
        );
    });

    if (!attempt) return null;
    if (!options.includeItems) return attempt;
    return getById(attempt.attempt_id, options);
}

export async function list({
    orderId,
    statusId,
    providerId,
    accessKey,
    limit = 50,
    offset = 0,
} = {}) {
    const where = [];
    const values = [];
    const add = (sql, value) => {
        values.push(value);
        where.push(sql.replace('?', `$${values.length}`));
    };

    if (orderId !== undefined && orderId !== null && orderId !== '') {
        add('a.order_id = ?', positiveBigInt(orderId, 'order_id'));
    }
    if (statusId !== undefined && statusId !== null && statusId !== '') {
        add('a.nfe_status_id = ?', positiveInteger(statusId, 'nfe_status_id'));
    }
    if (String(providerId ?? '').trim()) add('a.provider_id = ?', String(providerId).trim());
    if (String(accessKey ?? '').trim()) add('a.access_key = ?', String(accessKey).trim());

    const safeLimit = pageSize(limit);
    const safeOffset = offsetValue(offset);
    values.push(safeLimit, safeOffset);

    const result = await pool.query(
        `SELECT a.*, COUNT(*) OVER()::BIGINT AS total_count
       FROM ${ORDERS_NFE_ATTEMPTS_TABLE} a
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.requested_at DESC, a.attempt_id DESC
      LIMIT $${values.length - 1}
     OFFSET $${values.length}`,
        values,
    );

    return {
        rows: result.rows.map(({ total_count, ...row }) => row),
        total: Number(result.rows[0]?.total_count ?? 0),
        limit: safeLimit,
        offset: safeOffset,
    };
}

export async function updateAttempt(attemptId, changes = {}) {
    const id = positiveBigInt(attemptId, 'attempt_id');
    const update = buildUpdate(changes);
    if (update.columns.length === 0) {
        const error = new Error('Nenhum campo válido foi informado para atualização.');
        error.status = 400;
        throw error;
    }

    const result = await pool.query(
        `UPDATE ${ORDERS_NFE_ATTEMPTS_TABLE}
        SET ${update.setClause}, updated_at = NOW()
      WHERE attempt_id = $${update.values.length + 1}
      RETURNING *`,
        [...update.values, id],
    );
    return result.rows[0] ?? null;
}

export function markAuthorized(attemptId, data = {}) {
    return updateAttempt(attemptId, {
        ...data,
        authorized_at:
            normalizeProviderDateTime(data.authorized_at) ??
            new Date(),
        rejected_at: null,
        error_code: null,
        error_message: null,
        last_checked_at: data.last_checked_at ?? new Date(),
    });
}

export function markRejected(attemptId, data = {}) {
    return updateAttempt(attemptId, {
        ...data,
        authorized_at: null,
        rejected_at: data.rejected_at ?? new Date(),
        last_checked_at: data.last_checked_at ?? new Date(),
    });
}

export function markChecked(attemptId, data = {}) {
    return updateAttempt(attemptId, {
        ...data,
        last_checked_at: data.last_checked_at ?? new Date(),
    });
}

export function attachInvoice(attemptId, invoiceId) {
    return updateAttempt(attemptId, {
        invoice_id: positiveBigInt(invoiceId, 'invoice_id'),
    });
}

const NFE_STATUS_ID = Object.freeze({
    PENDING: 1,
    PROCESSING: 2,
    AUTHORIZED: 3,
    REJECTED: 4,
    DENIED: 5,
    CANCELLED: 6,
    VOIDED: 7,
    ERROR: 8,
});

function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalizeEnvironment(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === '1' || normalized.includes('PRODU')) return 'PRODUCAO';
    return 'HOMOLOGACAO';
}

function normalizeAccessKey(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length === 44 ? digits : null;
}

function providerDocument(response) {
    const data = response?.data;

    if (Array.isArray(data)) return data[0] ?? null;

    const documents = data?.documents ?? data?.documentos;
    if (Array.isArray(documents)) return documents[0] ?? null;
    if (documents && typeof documents === 'object') return documents;

    if (data?.id || data?.idIntegracao) return data;

    const nested = data?.data;
    if (Array.isArray(nested)) return nested[0] ?? null;
    if (nested?.id || nested?.idIntegracao) return nested;

    return null;
}

function errorPayload(value) {
    if (value == null) return {};
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            code: value.code ?? null,
            response: value.response?.data ?? null,
        };
    }
    return typeof value === 'object' ? value : { message: String(value) };
}

function providerItems(payload) {
    const root = Array.isArray(payload) ? payload[0] : payload;
    const items = root?.itens ?? root?.items ?? root?.produtos ?? [];
    return Array.isArray(items) ? items : [];
}

function snapshotItems(order, payload = null) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const sentItems = providerItems(payload);

    return items.map((item, index) => {
        const quantity = numberOrZero(item.quantity);
        const unitPrice = numberOrZero(item.unit_price);
        const discount = numberOrZero(item.discount_value);
        const gross = numberOrZero(item.gross_total ?? quantity * unitPrice);

        return {
            ...item,
            order_item_id: item.order_item_id ?? null,
            item_number: index + 1,
            product_code: item.product_code ?? item.sku,
            description: item.description ?? `Produto ${item.product_code ?? item.sku}`,
            commercial_unit: item.commercial_unit ?? item.unit ?? 'UN',
            taxable_unit: item.taxable_unit ?? item.unit ?? 'UN',
            is_unit: item.is_unit ?? item.unit ?? 'UN',
            quantity,
            taxable_quantity: numberOrZero(item.taxable_quantity ?? quantity),
            unit_price: unitPrice,
            taxable_unit_price: numberOrZero(item.taxable_unit_price ?? unitPrice),
            gross_total: gross,
            discount_amount: discount,
            freight_amount: numberOrZero(item.freight_amount),
            insurance_amount: numberOrZero(item.insurance_amount),
            other_expenses_amount: numberOrZero(item.other_expenses_amount),
            net_total: numberOrZero(item.net_total ?? Math.max(0, gross - discount)),
            included_in_invoice_total: item.included_in_invoice_total !== false,
            cfop_used: item.cfop_used ?? item.cfop_exit ?? item.cfop ?? null,
            ncm_code: item.ncm_code ?? item.ncm ?? null,
            cest_code: item.cest_code ?? item.cest ?? null,
            fiscal_profile_name: item.fiscal_profile_name ?? item.fiscal_profile ?? null,
            classification_name:
                item.classification_name ?? item.fiscal_classification ?? null,
            product_fiscal_snapshot: item.product_fiscal_snapshot ?? {},
            classification_snapshot: item.classification_snapshot ?? {},
            fiscal_profile_snapshot: item.fiscal_profile_snapshot ?? {},
            tax_reform_details: item.tax_reform_details ?? {},
            tax_calculation: item.tax_calculation ?? {},
            order_item_snapshot: item,
            provider_item_payload: sentItems[index] ?? {},
        };
    });
}

function remoteStatus(data = {}) {
    return String(
        data.situacao ?? data.situacaoNfe ?? data.statusNfe ?? data.status ?? 'PROCESSANDO',
    ).trim().toUpperCase();
}

function isAuthorized(status) {
    return ['AUTORIZADA',
        'AUTORIZADO',
        'CONCLUIDA',
        'CONCLUÍDA',
        'CONCLUIDO',
        'CONCLUÍDO']
        .includes(status);
}

function isRejected(status) {
    return ['REJEITADA',
        'REJEITADO',
        'DENEGADA',
        'DENEGADO']
        .includes(status);
}

function isCancelled(status) {
    return [
        'CANCELADA',
        'CANCELADO',
        'CANCELLED',
        'CANCELED',
    ].includes(status);
}

async function reserveNfeNumberForAttempt(attemptId) {
    const id = positiveBigInt(attemptId, 'attempt_id');

    return transaction(async (client) => {
        const attemptResult = await client.query(
            `
            SELECT attempt_id, order_id, nfe_number
            FROM ${ORDERS_NFE_ATTEMPTS_TABLE}
            WHERE attempt_id = $1
            FOR UPDATE
            `,
            [id],
        );

        if (attemptResult.rowCount === 0) {
            const error = new Error(
                `Tentativa ${id} não encontrada para reservar o número da NF-e.`,
            );
            error.status = 404;
            error.code = 'ORDER_NFE_ATTEMPT_NOT_FOUND';
            throw error;
        }

        const attempt = attemptResult.rows[0];
        const existingNumber = Number(attempt.nfe_number);

        // Reutiliza o número da própria tentativa.
        if (
            Number.isSafeInteger(existingNumber) &&
            existingNumber > 0
        ) {
            return existingNumber;
        }

        let sequenceResult = await client.query(
            `
            SELECT id, sequence_number
            FROM public.nfe
            WHERE is_active = TRUE
            ORDER BY id ASC
            LIMIT 1
            FOR UPDATE
            `,
        );

        if (sequenceResult.rowCount === 0) {
            sequenceResult = await client.query(
                `
                INSERT INTO public.nfe (
                    sequence_number,
                    is_active
                )
                VALUES (0, TRUE)
                RETURNING id, sequence_number
                `,
            );
        }

        const sequenceId = sequenceResult.rows[0].id;

        const numberResult = await client.query(
            `
            UPDATE public.nfe
            SET sequence_number = sequence_number + 1,
                updated_at = NOW()
            WHERE id = $1
            RETURNING sequence_number
            `,
            [sequenceId],
        );

        const nfeNumber = Number(
            numberResult.rows[0]?.sequence_number,
        );

        if (
            !Number.isSafeInteger(nfeNumber) ||
            nfeNumber <= 0
        ) {
            const error = new Error(
                'Não foi possível reservar o número da NF-e.',
            );
            error.status = 500;
            error.code = 'ORDER_NFE_NUMBER_RESERVATION_FAILED';
            throw error;
        }

        await client.query(
            `
            UPDATE ${ORDERS_NFE_ATTEMPTS_TABLE}
            SET nfe_number = $1,
                updated_at = NOW()
            WHERE attempt_id = $2
            `,
            [nfeNumber, id],
        );

        console.log(
            `[ordersNfeAttemptsApi] Tentativa ${id} reservou NF-e nº ${nfeNumber}.`,
        );

        return nfeNumber;
    });
}

export async function issueOrderNfe({ orderId, userId = null } = {}) {
    const id = positiveBigInt(orderId, 'order_id');
    const order = await ordersApi.getById(id);
    if (!order?.ok) {
        const error = new Error('Pedido não encontrado ou inválido para emissão de NF-e.');
        error.status = 404;
        throw error;
    }

    const header = order.header ?? {};
    let environment = process.env.NFE_ENVIRONMENT ?? null;
    try {
        environment = tecnospeedNfeApi.getEffectiveConfig?.()?.ambiente ?? environment;
    } catch {
        // Usa a configuração já disponível.
    }
    environment = normalizeEnvironment(environment);

    const emissionNow = new Date();
    const canonicalIssueDate = saoPauloDate(emissionNow);

    const attempt = await createAttempt({
        order_id: id,
        budget_id: header.budget_id ?? null,
        nfe_status_id: NFE_STATUS_ID.PENDING,
        nfe_environment: environment,
        operation_type_id: header.operation_type_id ?? null,
        customer_id: header.customer_id ?? null,
        customer_name: header.customer_name ?? header.nome_razao_social ?? null,
        customer_tax_id: header.customer_tax_id ?? header.cnpj_cpf ?? null,
        customer_email: header.customer_email ?? header.email ?? null,
        customer_phone: header.customer_phone ?? header.phone ?? null,
        issue_date: canonicalIssueDate,
        subtotal: numberOrZero(header.subtotal),
        discount_total: numberOrZero(header.total_discount),
        freight_value: numberOrZero(header.freight_value),
        total_amount: numberOrZero(header.total_amount),
        requested_by: userId,
    }, snapshotItems(order));

    const attemptId = attempt.attempt_id;

    try {
        const reservedNumber = await reserveNfeNumberForAttempt(
            attemptId,
        );

        // Passa o número reservado para o gerador do payload.
        order.header = {
            ...order.header,
            nfe_number: reservedNumber,
        };

        const payload = await tecnospeedNfeApi.buildNFeFromOrder(
            order,
        );

        await updateAttempt(attemptId, {
            nfe_number: reservedNumber,
            request_payload: payload,
        });

        await replaceItems(attemptId, snapshotItems(order, payload));

        const response = await tecnospeedNfeApi.emitirNFe(payload);
        if (!response?.ok) {
            await updateAttempt(attemptId, {
                nfe_status_id: NFE_STATUS_ID.ERROR,
                provider_response: errorPayload(response?.error ?? response),
                error_code: String(response?.status ?? response?.error?.code ?? ''),
                error_message:
                    response?.error?.message ?? response?.data?.message ?? 'Falha ao emitir NF-e.',
                rejected_at: new Date(),
                last_checked_at: new Date(),
            });
            return { ...response, attempt_id: attemptId };
        }

        const document = providerDocument(response);
        await updateAttempt(attemptId, {
            nfe_status_id: NFE_STATUS_ID.PROCESSING,
            provider_id: document?.id ?? null,
            integration_id: document?.idIntegracao ?? null,
            protocol: response.data?.protocol ?? null,
            provider_response: response.data ?? response,
            error_code: null,
            error_message: null,
            last_checked_at: new Date(),
        });

        return {
            ok: true,
            status: 202,
            pending: true,
            authorized: false,
            rejected: false,
            attempt_id: attemptId,
            message: response.data?.message ?? 'NF-e enviada para processamento.',
            nfe: {
                id: document?.id ?? null,
                idIntegracao: document?.idIntegracao ?? null,
                protocol: response.data?.protocol ?? null,
                status: 'PROCESSANDO',
                ambiente: environment,
            },
        };
    } catch (error) {
        await updateAttempt(attemptId, {
            nfe_status_id: NFE_STATUS_ID.ERROR,
            provider_response: errorPayload(error),
            error_code: error?.code ?? null,
            error_message: error?.message ?? 'Erro interno ao emitir NF-e.',
            rejected_at: new Date(),
            last_checked_at: new Date(),
        });
        error.attempt_id = attemptId;
        throw error;
    }
}

export async function cancelOrderNfe({
    orderId,
    justification,
} = {}) {
    const id = positiveBigInt(
        orderId,
        'order_id',
    );

    const normalizedJustification =
        String(justification ?? '').trim();

    if (
        normalizedJustification.length < 15 ||
        normalizedJustification.length > 255
    ) {
        const error = new Error(
            'A justificativa deve possuir entre 15 e 255 caracteres.',
        );

        error.status = 400;
        error.code =
            'INVALID_NFE_CANCELLATION_JUSTIFICATION';

        throw error;
    }

    const order = await ordersApi.getById(id);

    if (!order?.ok) {
        const error = new Error(
            'Pedido não encontrado.',
        );

        error.status = 404;
        error.code = 'ORDER_NOT_FOUND';

        throw error;
    }

    const attempt =
        await getLatestTrackableByOrderId(
            id,
            {
                includeItems: false,
            },
        );

    if (!attempt) {
        const error = new Error(
            'Nenhuma NF-e foi encontrada para o pedido.',
        );

        error.status = 404;
        error.code =
            'ORDER_NFE_ATTEMPT_NOT_FOUND';

        throw error;
    }

    const storedDocument = providerDocument({
        data: attempt.provider_response,
    });

    const providerId = [
        attempt.provider_id,
        storedDocument?.id,
        attempt.access_key,
        storedDocument?.chave,
        storedDocument?.chaveAcesso,
        attempt.integration_id,
        storedDocument?.idIntegracao,
    ].find(
        (value) =>
            String(value ?? '').trim(),
    ) ?? null;

    if (!providerId) {
        const error = new Error(
            'A NF-e do pedido não possui identificador no provedor.',
        );

        error.status = 404;
        error.code =
            'ORDER_NFE_PROVIDER_ID_NOT_FOUND';

        throw error;
    }

    let cancellationResponse;

    try {
        cancellationResponse =
            await tecnospeedNfeApi.cancelarNFe(
                providerId,
                normalizedJustification,
            );
    } catch (error) {
        /*
         * If PlugNotas reports that the NF-e is already cancelled,
         * continue with local reconciliation. This makes cancellation
         * idempotent and permits stock recovery after an interrupted sync.
         */
        const text = String(
            error?.message ??
            error?.response?.data?.message ??
            '',
        ).toUpperCase();

        const alreadyCancelled =
            text.includes('JÁ ESTÁ CANCELADA') ||
            text.includes('JA ESTA CANCELADA') ||
            text.includes('ALREADY CANCELLED') ||
            text.includes('ALREADY CANCELED');

        if (!alreadyCancelled) {
            throw error;
        }

        cancellationResponse = {
            ok: true,
            status: 200,
            cancelled: true,
            alreadyCancelled: true,
            message:
                'A NF-e já estava cancelada no provedor.',
        };
    }

    /*
     * Some provider adapters return { ok: false } instead of throwing.
     * Treat “already cancelled” as success and continue reconciliation.
     */
    if (!cancellationResponse?.ok) {
        const responseText = String(
            cancellationResponse?.message ??
            cancellationResponse?.error?.message ??
            cancellationResponse?.error ??
            '',
        ).toUpperCase();

        const alreadyCancelled =
            responseText.includes('JÁ ESTÁ CANCELADA') ||
            responseText.includes('JA ESTA CANCELADA') ||
            responseText.includes('ALREADY CANCELLED') ||
            responseText.includes('ALREADY CANCELED');

        if (!alreadyCancelled) {
            const error = new Error(
                cancellationResponse?.message ??
                cancellationResponse?.error?.message ??
                'Não foi possível cancelar a NF-e.',
            );

            error.status =
                Number(cancellationResponse?.status) ||
                502;

            error.code =
                'ORDER_NFE_CANCELLATION_FAILED';

            error.details =
                cancellationResponse;

            throw error;
        }

        cancellationResponse = {
            ...cancellationResponse,
            ok: true,
            status: 200,
            cancelled: true,
            alreadyCancelled: true,
        };
    }

    /*
     * Always reconcile after provider cancellation. This updates the
     * attempt and invoice and executes rollbackStockFromOrder().
     */
    const reconciliation =
        await reconcileOrderNfe({
            orderId: id,
        });

    return {
        ok: true,
        status: 200,
        cancelled:
            reconciliation?.cancelled === true,

        alreadyCancelled:
            cancellationResponse
                ?.alreadyCancelled === true,

        order_id: id,
        attempt_id:
            reconciliation?.attempt_id ??
            attempt.attempt_id,

        provider:
            cancellationResponse,

        reconciliation,

        stockRollback:
            reconciliation?.stockRollback ??
            null,

        message:
            reconciliation?.message ??
            cancellationResponse?.message ??
            'NF-e cancelada e sincronizada com o pedido.',
    };
}

export async function reconcileOrderNfe({ orderId } = {}) {
    const id = positiveBigInt(orderId, 'order_id');
    const order = await ordersApi.getById(id);
    if (!order?.ok) {
        const error = new Error('Pedido não encontrado.');
        error.status = 404;
        throw error;
    }

    const attempt = await getLatestTrackableByOrderId(
        id,
        { includeItems: false },
    );
    const attemptId = attempt?.attempt_id ?? null;
    const storedDocument = providerDocument({
        data: attempt?.provider_response,
    });
    const idConsulta = [
        attempt?.provider_id,
        attempt?.access_key,
        attempt?.integration_id,
        storedDocument?.id,
        storedDocument?.chave,
        storedDocument?.chaveAcesso,
        storedDocument?.idIntegracao,
    ].find((value) => String(value ?? '').trim()) ?? null;
    if (!idConsulta) {
        return { ok: false, status: 404, error: 'SEM_IDENTIFICADOR_NFE', attempt_id: attemptId };
    }

    const response = await tecnospeedNfeApi.consultarNFe(idConsulta);

    if (!response?.ok) {
        if (attemptId) {
            const temporary = [502, 503, 504].includes(Number(response?.status));
            await updateAttempt(attemptId, {
                nfe_status_id: temporary ? NFE_STATUS_ID.PROCESSING : NFE_STATUS_ID.ERROR,
                provider_response: errorPayload(response?.error ?? response),
                error_code: String(response?.status ?? ''),
                error_message: temporary ? null : 'Falha ao consultar NF-e na TecnoSpeed.',
                last_checked_at: new Date(),
            });
        }
        return { ...response, attempt_id: attemptId };
    }

    const data = Array.isArray(response.data) ? response.data[0] ?? {} : response.data ?? {};
    const status = remoteStatus(data);
    const authorized = isAuthorized(status);
    const rejected = isRejected(status);
    const cancelled = isCancelled(status);
    const denied =
        status === 'DENEGADA' ||
        status === 'DENEGADO';
    const cStat = data.cStat ?? data.cstat ?? data.codigoStatus ?? data.codigoRetorno ?? null;
    const message = data.mensagem ?? data.message ?? data.xMotivo ?? data.motivo ?? null;

    const environment = normalizeEnvironment(
        data.ambiente ?? data.environment ?? attempt?.nfe_environment,
    );

    if (attemptId) {
        const common = {
            provider_id: data.id ?? attempt.provider_id ?? null,
            integration_id: data.idIntegracao ?? attempt.integration_id ?? null,
            provider_response: data,
            protocol: data.protocolo ?? data.numeroProtocolo ?? null,
            nfe_number:
                data.numero ?? data.numeroNfe ?? attempt.nfe_number ?? null,
            nfe_series: data.serie ?? attempt.nfe_series ?? null,
            nfe_environment: environment,
            access_key: normalizeAccessKey(
                data.chave ?? data.chaveAcesso ?? data.chaveNfe,
            ) ?? attempt.access_key ?? null,
            generated_xml: data.xml ?? attempt.generated_xml ?? null,
            last_checked_at: new Date(),
        };
        if (authorized) {
            await markAuthorized(attemptId, {
                ...common,
                nfe_status_id:
                    NFE_STATUS_ID.AUTHORIZED,

                authorized_at:
                    normalizeProviderDateTime(data.dataAutorizacao) ??
                    attempt.authorized_at ??
                    new Date(),
            });
        } else if (cancelled) {
            await updateAttempt(attemptId, {
                ...common,

                nfe_status_id:
                    NFE_STATUS_ID.CANCELLED,

                cancelled_at:
                    attempt.cancelled_at ??
                    new Date(),

                error_code: null,
                error_message: null,
            });
        } else if (rejected) {
            await markRejected(attemptId, {
                ...common,

                nfe_status_id:
                    denied
                        ? NFE_STATUS_ID.DENIED
                        : NFE_STATUS_ID.REJECTED,

                error_code:
                    cStat != null
                        ? String(cStat)
                        : null,

                error_message:
                    message ??
                    'NF-e rejeitada.',
            });
        } else {
            await markChecked(attemptId, {
                ...common,
                nfe_status_id:
                    NFE_STATUS_ID.PROCESSING,
            });
        }
    }

    let stockSync = null;
    let stockRollback = null;
    let invoiceSync = null;
    let asaasSync = null;

    if (authorized) {
        invoiceSync = await invoicesIssuedApi.upsertFromOrder(id, {
            attemptId,
        });

        const invoiceId =
            invoiceSync?.invoice_id ??
            invoiceSync?.data?.invoice_id ??
            invoiceSync?.invoice?.invoice_id ??
            null;

        if (attemptId && invoiceId) {
            await attachInvoice(attemptId, invoiceId);
        }

        stockSync = await stockFromOrdersService.applyStockFromOrder(
            order,
            {
                attemptId,
            },
        );

        asaasSync = await nfeAsaasSyncApi.syncAuthorizedNfe({
            orderId: id,
            nfeNumber:
                data.numero ??
                data.numeroNfe ??
                attempt?.nfe_number ??
                null,
            nfeKey:
                data.chave ??
                data.chaveAcesso ??
                data.chaveNfe ??
                attempt?.access_key ??
                null,
        });
    }

    if (cancelled) {
        stockRollback =
            await stockFromOrdersService.rollbackStockFromOrder({
                attemptId,
            });

        invoiceSync = await pool.query(
            `
                UPDATE public."invoicesIssued"
                SET nfe_status_id = $2,
                    nfe_status = 'CANCELADO',
                    cancelled_at = COALESCE(cancelled_at, NOW()),
                    cancellation_reason = COALESCE($3, cancellation_reason),
                    updated_at = NOW()
                WHERE order_id = $1
                RETURNING *
            `,
            [
                id,
                NFE_STATUS_ID.CANCELLED,
                message ?? 'NF-e cancelada no provedor.',
            ],
        );

        invoiceSync = invoiceSync.rows[0] ?? null;
    }

    const finalized = authorized || rejected || cancelled;

    return {
        ok: true,
        status: finalized ? 200 : 202,
        pending: !finalized,
        authorized,
        rejected,
        cancelled,
        attempt_id: attemptId,
        message: message ?? (authorized
            ? 'NF-e autorizada com sucesso.'
            : cancelled
                ? 'NF-e cancelada com sucesso.'
                : rejected
                    ? 'NF-e rejeitada.'
                    : 'NF-e ainda está sendo processada.'),
        stockSync,
        stockRollback,
        invoiceSync,
        asaasSync,
        nfe: { ...data, status },
    };
}

export default {
    createAttempt,
    addItems,
    replaceItems,
    getById,
    getLatestByOrderId,
    getLatestTrackableByOrderId,
    list,
    updateAttempt,
    markAuthorized,
    markRejected,
    markChecked,
    attachInvoice,
    reserveNfeNumberForAttempt,
    issueOrderNfe,
    cancelOrderNfe,
    reconcileOrderNfe,
};
