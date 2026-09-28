/* ╔══════════════════════════════════════════════════════════════════════╗
 * ║ budgetsNfeAttemptsApi.js — DAL de tentativas de emissão NF-e       ║
 * ║ CONSART ERP · PostgreSQL · ESM                                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../../config/db.js';

import {
    BUDGETS_NFE_ATTEMPTS_TABLE as TB_ATTEMPTS,
    BUDGETS_NFE_ATTEMPTS_INSERT_COLUMNS,
    BUDGETS_NFE_ATTEMPTS_UPDATE_COLUMNS,
} from './catalog_schema.budgetsNfeAttempts.js';

import {
    BUDGETS_NFE_ATTEMPT_ITEMS_TABLE as TB_ITEMS,
    BUDGETS_NFE_ATTEMPT_ITEMS_INSERT_COLUMNS,
} from './catalog_schema.budgetsNfeAttemptItems.js';

import {
    BUDGETS_TABLE as TB_BUDGETS,
} from './../budgets/catalog_schema.budgets.js';

const TB_STATUS = 'public."nfeStatusMap"';
const TB_SHIPPING = 'public."budgetsShipping"';
const TB_INVOICES = 'public."invoicesIssued"';

const ATTEMPT_WRITABLE = Object.freeze(
    BUDGETS_NFE_ATTEMPTS_UPDATE_COLUMNS.filter(
        (column) => !['budget_id', 'attempt_number'].includes(column),
    ),
);

const ITEM_WRITABLE = Object.freeze(
    BUDGETS_NFE_ATTEMPT_ITEMS_INSERT_COLUMNS.filter(
        (column) => column !== 'attempt_id',
    ),
);

const JSON_FIELDS = new Set([
    'request_payload',
    'provider_response',
    'product_fiscal_snapshot',
    'classification_snapshot',
    'fiscal_profile_snapshot',
    'tax_reform_details',
    'tax_calculation',
    'budget_item_snapshot',
    'provider_item_payload',
]);

function saoPauloDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const map = Object.fromEntries(
        parts.map(({ type, value: partValue }) => [type, partValue]),
    );
    return `${map.year}-${map.month}-${map.day}`;
}

function normalizeProviderDateTime(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const raw = String(value).trim();
    const br = raw.match(
        /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (br) {
        const [, day, month, year, hour = '00', minute = '00', second = '00'] = br;
        const parsed = new Date(
            `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`,
        );
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const MONEY_FIELDS = new Set([
    'subtotal', 'discount_total', 'freight_value', 'total_amount',
    'quantity', 'taxable_quantity', 'unit_price', 'taxable_unit_price',
    'gross_total', 'discount_amount', 'freight_amount', 'insurance_amount',
    'other_expenses_amount', 'net_total', 'icms_rate', 'pis_rate',
    'cofins_rate', 'icms_base', 'icms_base_reduction_pct',
    'icms_effective_rate', 'icms_value', 'icms_st_mva_pct',
    'icms_st_base_reduction_pct', 'icms_st_base', 'icms_st_rate',
    'icms_st_value', 'icms_st_retained_base', 'icms_st_retained_rate',
    'icms_st_retained_value', 'fcp_base', 'fcp_rate', 'fcp_value',
    'fcp_st_base', 'fcp_st_rate', 'fcp_st_value', 'pis_base',
    'pis_effective_rate', 'pis_value', 'cofins_base',
    'cofins_effective_rate', 'cofins_value', 'is_rate', 'is_specific_rate',
    'is_base', 'is_quantity', 'is_value', 'ibs_uf_rate',
    'ibs_municipal_rate', 'cbs_rate', 'ibscbs_base',
    'ibs_uf_effective_rate', 'ibs_uf_value',
    'ibs_municipal_effective_rate', 'ibs_municipal_value',
    'ibs_total_value', 'cbs_effective_rate', 'cbs_value',
]);

function toId(value, name = 'id', nullable = false) {
    if (nullable && (value === null || value === undefined || value === '')) return null;

    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        const error = new Error(`${name} inválido.`);
        error.status = 400;
        error.code = 'INVALID_ID';
        throw error;
    }

    return id;
}

function toJsonObject(value) {
    if (value == null || value === '') return {};

    if (typeof value === 'string') {
        let parsed;

        try {
            parsed = JSON.parse(value);
        } catch {
            const error = new Error('O campo JSON contém JSON inválido.');
            error.status = 400;
            error.code = 'INVALID_JSON';
            throw error;
        }

        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            const error = new Error('O campo JSON deve ser um objeto.');
            error.status = 400;
            error.code = 'INVALID_JSON_OBJECT';
            throw error;
        }

        return parsed;
    }

    if (Array.isArray(value) || typeof value !== 'object') {
        const error = new Error('O campo JSON deve ser um objeto.');
        error.status = 400;
        error.code = 'INVALID_JSON_OBJECT';
        throw error;
    }

    return value;
}

function normalizeValue(column, value) {
    if (JSON_FIELDS.has(column)) return toJsonObject(value);

    if (MONEY_FIELDS.has(column)) {
        if (value === null || value === undefined || value === '') return null;

        const number = Number(value);

        if (!Number.isFinite(number)) {
            const error = new Error(`${column} inválido.`);
            error.status = 400;
            error.code = 'INVALID_NUMBER';
            throw error;
        }

        return number;
    }

    return value === '' ? null : value;
}

function pickWritable(source = {}, columns = []) {
    const out = {};

    for (const column of columns) {
        if (Object.prototype.hasOwnProperty.call(source, column)) {
            out[column] = normalizeValue(column, source[column]);
        }
    }

    return out;
}

function buildInsert(table, data, returning = '*') {
    const columns = Object.keys(data);

    if (!columns.length) {
        const error = new Error('Nenhum campo para inserir.');
        error.status = 400;
        error.code = 'EMPTY_INSERT';
        throw error;
    }

    return {
        text: `
            INSERT INTO ${table}
                (${columns.map((column) => `"${column}"`).join(', ')})
            VALUES
                (${columns.map((_, index) => `$${index + 1}`).join(', ')})
            RETURNING ${returning}
        `,
        values: columns.map((column) => data[column]),
    };
}

function buildUpdate(table, data, idColumn, id, returning = '*') {
    const columns = Object.keys(data);

    if (!columns.length) return null;

    return {
        text: `
            UPDATE ${table}
            SET
                ${columns.map((column, index) => `"${column}" = $${index + 1}`).join(', ')},
                updated_at = NOW()
            WHERE "${idColumn}" = $${columns.length + 1}
            RETURNING ${returning}
        `,
        values: [
            ...columns.map((column) => data[column]),
            id,
        ],
    };
}

async function resolveStatus(client, { nfe_status_id, status_code } = {}) {
    if (nfe_status_id != null && nfe_status_id !== '') {
        const id = toId(nfe_status_id, 'nfe_status_id');

        const result = await client.query(
            `
                SELECT *
                FROM ${TB_STATUS}
                WHERE nfe_status_id = $1
                  AND is_active = TRUE
                LIMIT 1
            `,
            [id],
        );

        if (result.rowCount) return result.rows[0];
    }

    const code = String(status_code || '').trim().toUpperCase();

    if (code) {
        const result = await client.query(
            `
                SELECT *
                FROM ${TB_STATUS}
                WHERE UPPER(code) = $1
                  AND is_active = TRUE
                LIMIT 1
            `,
            [code],
        );

        if (result.rowCount) return result.rows[0];
    }

    const error = new Error('Status de NF-e inexistente ou inativo.');
    error.status = 400;
    error.code = 'NFE_STATUS_NOT_FOUND';
    throw error;
}

async function getAttemptForUpdate(client, attemptId) {
    const result = await client.query(
        `
            SELECT
                a.*,
                s.code AS status_code,
                s.is_final,
                s.is_authorized
            FROM ${TB_ATTEMPTS} a
            JOIN ${TB_STATUS} s
              ON s.nfe_status_id = a.nfe_status_id
            WHERE a.attempt_id = $1
            FOR UPDATE OF a
        `,
        [attemptId],
    );

    return result.rows[0] || null;
}

function ensureMutable(row) {
    if (!row) {
        const error = new Error('Tentativa de NF-e não encontrada.');
        error.status = 404;
        error.code = 'ATTEMPT_NOT_FOUND';
        throw error;
    }

    if (row.is_final) {
        const error = new Error(
            `A tentativa está finalizada com status ${row.status_code}.`,
        );
        error.status = 409;
        error.code = 'ATTEMPT_IS_FINAL';
        throw error;
    }
}

async function getByIdWithClient(client, attemptId) {
    const header = await client.query(
        `
            SELECT
                a.*,
                s.code AS status_code,
                s.name AS status_name,
                s.description AS status_description,
                s.is_final,
                s.is_authorized
            FROM ${TB_ATTEMPTS} a
            JOIN ${TB_STATUS} s
              ON s.nfe_status_id = a.nfe_status_id
            WHERE a.attempt_id = $1
            LIMIT 1
        `,
        [attemptId],
    );

    if (!header.rowCount) return null;

    const items = await client.query(
        `
            SELECT *
            FROM ${TB_ITEMS}
            WHERE attempt_id = $1
            ORDER BY item_number, attempt_item_id
        `,
        [attemptId],
    );

    return {
        ...header.rows[0],
        items: items.rows,
    };
}

export async function list({
    budget_id,
    invoice_id,
    nfe_status_id,
    status_code,
    is_final,
    is_authorized,
    date_from,
    date_to,
    page = 1,
    page_size = 20,
} = {}) {
    const where = [];
    const values = [];

    const add = (sql, value) => {
        values.push(value);
        where.push(sql.replace('?', `$${values.length}`));
    };

    if (budget_id) {
        add('a.budget_id = ?', toId(budget_id, 'budget_id'));
    }

    if (invoice_id) {
        add('a.invoice_id = ?', toId(invoice_id, 'invoice_id'));
    }

    if (nfe_status_id) {
        add('a.nfe_status_id = ?', toId(nfe_status_id, 'nfe_status_id'));
    }

    if (status_code) {
        add('UPPER(s.code) = UPPER(?)', String(status_code).trim());
    }

    if (is_final !== undefined) {
        add('s.is_final = ?', Boolean(is_final));
    }

    if (is_authorized !== undefined) {
        add('s.is_authorized = ?', Boolean(is_authorized));
    }

    if (date_from) {
        add('a.requested_at >= ?::timestamptz', date_from);
    }

    if (date_to) {
        add('a.requested_at <= ?::timestamptz', date_to);
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(100, Math.max(1, Number(page_size) || 20));
    const offset = (safePage - 1) * safeSize;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const count = await pool.query(
        `
            SELECT COUNT(*)::bigint AS total
            FROM ${TB_ATTEMPTS} a
            JOIN ${TB_STATUS} s
              ON s.nfe_status_id = a.nfe_status_id
            ${whereSql}
        `,
        values,
    );

    const rows = await pool.query(
        `
            SELECT
                a.*,
                s.code AS status_code,
                s.name AS status_name,
                s.is_final,
                s.is_authorized,
                COUNT(i.attempt_item_id)::int AS items_count
            FROM ${TB_ATTEMPTS} a
            JOIN ${TB_STATUS} s
              ON s.nfe_status_id = a.nfe_status_id
            LEFT JOIN ${TB_ITEMS} i
              ON i.attempt_id = a.attempt_id
            ${whereSql}
            GROUP BY
                a.attempt_id,
                s.nfe_status_id
            ORDER BY
                a.requested_at DESC,
                a.attempt_id DESC
            LIMIT $${values.length + 1}
            OFFSET $${values.length + 2}
        `,
        [...values, safeSize, offset],
    );

    return {
        rows: rows.rows,
        total: Number(count.rows[0]?.total || 0),
        page: safePage,
        page_size: safeSize,
    };
}

export async function getById(attemptId) {
    const id = toId(attemptId, 'attempt_id');
    return getByIdWithClient(pool, id);
}

export async function listByBudget(budgetId) {
    return list({
        budget_id: toId(budgetId, 'budget_id'),
        page_size: 100,
    });
}

export async function create(
    { header = {}, items = [], status_code } = {},
    ctx = {},
) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const budgetId = toId(header.budget_id, 'budget_id');

        const budget = await client.query(
            `
                SELECT
                    b.*,
                    COALESCE(bs.freight_value, 0) AS resolved_freight_value
                FROM ${TB_BUDGETS} b
                LEFT JOIN ${TB_SHIPPING} bs
                  ON bs.budget_shipping_id = b.budget_shipping_id
                WHERE b.budget_id = $1
                FOR UPDATE OF b
            `,
            [budgetId],
        );

        if (!budget.rowCount) {
            const error = new Error('Orçamento não encontrado.');
            error.status = 404;
            error.code = 'BUDGET_NOT_FOUND';
            throw error;
        }

        const source = budget.rows[0];

        const status = await resolveStatus(client, {
            nfe_status_id: header.nfe_status_id,
            status_code: status_code || header.status_code || 'PENDING',
        });

        // The budget row is already locked above, so attempts for the same
        // budget are serialized and the unique (budget_id, attempt_number)
        // constraint remains protected against concurrent creation.
        const numberResult = await client.query(
            `
                SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_number
                FROM ${TB_ATTEMPTS}
                WHERE budget_id = $1
            `,
            [budgetId],
        );

        const data = pickWritable(header, ATTEMPT_WRITABLE);

        Object.assign(data, {
            budget_id: budgetId,
            attempt_number: Number(numberResult.rows[0].next_number),
            nfe_status_id: status.nfe_status_id,

            operation_type_id:
                data.operation_type_id ?? source.operation_type_id,

            customer_id:
                data.customer_id ?? source.customer_id,

            customer_name:
                data.customer_name ?? source.customer_name,

            customer_tax_id:
                data.customer_tax_id ?? source.customer_tax_id,

            customer_email:
                data.customer_email ?? source.customer_email,

            customer_phone:
                data.customer_phone ?? source.customer_phone,

            issue_date: saoPauloDate(),

            subtotal:
                data.subtotal ?? Number(source.subtotal || 0),

            discount_total:
                data.discount_total ?? Number(source.total_discount || 0),

            freight_value:
                data.freight_value ??
                Number(source.resolved_freight_value || 0),

            total_amount:
                data.total_amount ?? Number(source.total_amount || 0),

            requested_by:
                data.requested_by ?? ctx.userId ?? null,
        });

        const allowedAttemptInsert = new Set(
            BUDGETS_NFE_ATTEMPTS_INSERT_COLUMNS,
        );

        const insertData = Object.fromEntries(
            Object.entries(data).filter(
                ([column]) => allowedAttemptInsert.has(column),
            ),
        );

        const inserted = await client.query(
            buildInsert(TB_ATTEMPTS, insertData),
        );

        const attempt = inserted.rows[0];

        if (!Array.isArray(items)) {
            const error = new Error('items deve ser um array.');
            error.status = 400;
            error.code = 'INVALID_ITEMS';
            throw error;
        }

        for (let index = 0; index < items.length; index += 1) {
            const raw = items[index] || {};
            const item = pickWritable(raw, ITEM_WRITABLE);

            item.attempt_id = attempt.attempt_id;
            item.item_number = Number(item.item_number || index + 1);
            item.product_code = String(item.product_code || '').trim();
            item.description = String(item.description || '').trim();

            if (
                !Number.isSafeInteger(item.item_number) ||
                item.item_number <= 0
            ) {
                const error = new Error(
                    `Item ${index + 1}: item_number inválido.`,
                );
                error.status = 400;
                error.code = 'INVALID_ATTEMPT_ITEM_NUMBER';
                throw error;
            }

            if (!item.product_code || !item.description) {
                const error = new Error(
                    `Item ${index + 1}: product_code e description são obrigatórios.`,
                );
                error.status = 400;
                error.code = 'INVALID_ATTEMPT_ITEM';
                throw error;
            }

            const allowedItemInsert = new Set(
                BUDGETS_NFE_ATTEMPT_ITEMS_INSERT_COLUMNS,
            );

            const insertItem = Object.fromEntries(
                Object.entries(item).filter(
                    ([column]) => allowedItemInsert.has(column),
                ),
            );

            await client.query(
                buildInsert(
                    TB_ITEMS,
                    insertItem,
                    'attempt_item_id',
                ),
            );
        }

        const result = await getByIdWithClient(
            client,
            attempt.attempt_id,
        );

        await client.query('COMMIT');

        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the original error.
        }

        throw error;
    } finally {
        client.release();
    }
}

export async function update(attemptId, changes = {}) {
    const id = toId(attemptId, 'attempt_id');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const current = await getAttemptForUpdate(client, id);
        ensureMutable(current);

        const data = pickWritable(changes, ATTEMPT_WRITABLE);

        // Status transitions must always use setStatus().
        delete data.nfe_status_id;

        const query = buildUpdate(
            TB_ATTEMPTS,
            data,
            'attempt_id',
            id,
        );

        if (query) {
            await client.query(query);
        }

        const result = await getByIdWithClient(client, id);

        await client.query('COMMIT');

        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the original error.
        }

        throw error;
    } finally {
        client.release();
    }
}

export async function setStatus(attemptId, payload = {}, ctx = {}) {
    const id = toId(attemptId, 'attempt_id');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const current = await getAttemptForUpdate(client, id);

        if (!current) {
            ensureMutable(current);
        }

        const status = await resolveStatus(client, payload);

        const isCancellation =
            current.is_authorized &&
            [
                'CANCELLED',
                'CANCELED',
                'CANCELADA',
                'CANCELADO',
            ].includes(
                String(status.code || '').trim().toUpperCase(),
            );

        if (current.is_final && !isCancellation) {
            ensureMutable(current);
        }

        const now = new Date().toISOString();
        const data = pickWritable(payload, ATTEMPT_WRITABLE);

        data.nfe_status_id = status.nfe_status_id;
        data.last_checked_at = data.last_checked_at ?? now;

        if (status.is_authorized) {
            data.authorized_at =
                normalizeProviderDateTime(data.authorized_at) ?? now;
            data.rejected_at = null;
            data.error_code = null;
            data.error_message = null;
        } else if (status.is_final) {
            data.rejected_at = data.rejected_at ?? now;
        }

        if (ctx.userId && data.requested_by == null) {
            data.requested_by = current.requested_by;
        }

        const query = buildUpdate(
            TB_ATTEMPTS,
            data,
            'attempt_id',
            id,
        );

        if (query) {
            await client.query(query);
        }

        const result = await getByIdWithClient(client, id);

        await client.query('COMMIT');

        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the original error.
        }

        throw error;
    } finally {
        client.release();
    }
}

export async function linkInvoice(attemptId, invoiceId) {
    const id = toId(attemptId, 'attempt_id');
    const invoice = toId(invoiceId, 'invoice_id');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const current = await getAttemptForUpdate(client, id);

        if (!current) {
            const error = new Error('Tentativa de NF-e não encontrada.');
            error.status = 404;
            error.code = 'ATTEMPT_NOT_FOUND';
            throw error;
        }

        const invoiceResult = await client.query(
            `
                SELECT
                    invoice_id,
                    budget_id
                FROM ${TB_INVOICES}
                WHERE invoice_id = $1
                LIMIT 1
            `,
            [invoice],
        );

        if (!invoiceResult.rowCount) {
            const error = new Error('NF-e emitida não encontrada.');
            error.status = 404;
            error.code = 'INVOICE_NOT_FOUND';
            throw error;
        }

        const invoiceRow = invoiceResult.rows[0];

        if (
            invoiceRow.budget_id != null &&
            Number(invoiceRow.budget_id) !== Number(current.budget_id)
        ) {
            const error = new Error(
                'A NF-e não pertence ao orçamento desta tentativa.',
            );
            error.status = 409;
            error.code = 'INVOICE_BUDGET_MISMATCH';
            throw error;
        }

        await client.query(
            `
                UPDATE ${TB_ATTEMPTS}
                SET
                    invoice_id = $1,
                    updated_at = NOW()
                WHERE attempt_id = $2
            `,
            [invoice, id],
        );

        const result = await getByIdWithClient(client, id);

        await client.query('COMMIT');

        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the original error.
        }

        throw error;
    } finally {
        client.release();
    }
}

export async function remove(attemptId) {
    const id = toId(attemptId, 'attempt_id');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const current = await getAttemptForUpdate(client, id);
        ensureMutable(current);

        if (current.invoice_id) {
            const error = new Error(
                'Não é possível excluir uma tentativa vinculada a uma NF-e.',
            );
            error.status = 409;
            error.code = 'ATTEMPT_HAS_INVOICE';
            throw error;
        }

        await client.query(
            `
                DELETE FROM ${TB_ATTEMPTS}
                WHERE attempt_id = $1
            `,
            [id],
        );

        await client.query('COMMIT');

        return {
            deleted: true,
            attempt_id: id,
        };
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Preserve the original error.
        }

        throw error;
    } finally {
        client.release();
    }
}

export default {
    list,
    getById,
    listByBudget,
    create,
    update,
    setStatus,
    linkInvoice,
    remove,
};
