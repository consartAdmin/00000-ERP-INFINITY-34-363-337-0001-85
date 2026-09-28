// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeNumberService.js — Reserva transacional do número da NF-e       ║
// ║ CONSART ERP | NF-e compartilhada | PostgreSQL | Node.js ESM        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const ALLOWED_ATTEMPT_TABLES = new Set([
    'public."budgetsNfeAttempts"',
    'public."ordersNfeAttempts"',
]);

function positiveId(value, field) {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
        const error = new Error(`${field} deve ser um inteiro positivo.`);
        error.status = 400;
        error.code = 'INVALID_ID';
        throw error;
    }
    return normalized;
}

function allowedTable(value) {
    if (!ALLOWED_ATTEMPT_TABLES.has(value)) {
        const error = new Error('Tabela de tentativas não permitida para reserva de NF-e.');
        error.status = 500;
        error.code = 'INVALID_NFE_ATTEMPT_TABLE';
        throw error;
    }
    return value;
}

export async function reserveNfeNumber({
    attemptTable,
    attemptId,
    sequenceTable = 'public.nfe',
} = {}) {
    const table = allowedTable(attemptTable);
    const id = positiveId(attemptId, 'attemptId');

    if (sequenceTable !== 'public.nfe') {
        const error = new Error('Tabela de sequência de NF-e não permitida.');
        error.status = 500;
        error.code = 'INVALID_NFE_SEQUENCE_TABLE';
        throw error;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const attemptResult = await client.query(
            `SELECT attempt_id, nfe_number FROM ${table} WHERE attempt_id = $1 FOR UPDATE`,
            [id],
        );
        if (!attemptResult.rowCount) {
            const error = new Error(`Tentativa ${id} não encontrada.`);
            error.status = 404;
            error.code = 'NFE_ATTEMPT_NOT_FOUND';
            throw error;
        }

        const existing = Number(attemptResult.rows[0].nfe_number);
        if (Number.isSafeInteger(existing) && existing > 0) {
            await client.query('COMMIT');
            return existing;
        }

        let sequenceResult = await client.query(
            `SELECT id FROM ${sequenceTable} WHERE is_active = TRUE ORDER BY id FOR UPDATE`,
        );
        if (sequenceResult.rowCount > 1) {
            const error = new Error('Existe mais de uma sequência ativa de NF-e.');
            error.status = 409;
            error.code = 'MULTIPLE_ACTIVE_NFE_SEQUENCES';
            throw error;
        }
        if (!sequenceResult.rowCount) {
            sequenceResult = await client.query(
                `INSERT INTO ${sequenceTable} (sequence_number, is_active) VALUES (0, TRUE) RETURNING id`,
            );
        }

        const numberResult = await client.query(
            `UPDATE ${sequenceTable}
                SET sequence_number = sequence_number + 1, updated_at = NOW()
              WHERE id = $1
              RETURNING sequence_number`,
            [sequenceResult.rows[0].id],
        );
        const nfeNumber = Number(numberResult.rows[0]?.sequence_number);
        if (!Number.isSafeInteger(nfeNumber) || nfeNumber <= 0) {
            const error = new Error('Não foi possível reservar o número da NF-e.');
            error.status = 500;
            error.code = 'NFE_NUMBER_RESERVATION_FAILED';
            throw error;
        }

        await client.query(
            `UPDATE ${table} SET nfe_number = $1, updated_at = NOW() WHERE attempt_id = $2`,
            [nfeNumber, id],
        );
        await client.query('COMMIT');
        return nfeNumber;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve original error. */ }
        throw error;
    } finally {
        client.release();
    }
}

export default { reserveNfeNumber };

