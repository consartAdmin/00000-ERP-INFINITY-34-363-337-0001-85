// ╔══════════════════════════════════════════════════════════════════════╗
// ║ appFeaturesAdmin.repository.js — CRUD das telas de Funcionalidades   ║
// ║ Tabelas: appFeatures / appFeatureOptions / appFeatureAssignments     ║
// ║ Usado por controllers/appFeaturesAdminController.js                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { TABLES } from './appFeatures.constants.js';
import { getDb } from './appFeaturesDb.repository.js';
import { normalizeCode, normalizeScopeId } from './appFeatures.sanitizers.js';
import { APP_FEATURES_VALUE_TYPES } from './appFeatures.catalog.js';

/* ==========================================================================
   Helpers
   ========================================================================== */

function validationError(message) {
    const error = new Error(message);
    error.code = 'VALIDATION_ERROR';
    return error;
}

function notFound(message) {
    const error = new Error(message);
    error.code = 'NOT_FOUND';
    return error;
}

function toId(value, fieldName) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw validationError(`${fieldName} inválido.`);
    }
    return id;
}

function toOptionalId(value, fieldName) {
    if (value === null || value === undefined || value === '') return null;
    return toId(value, fieldName);
}

function requiredText(value, fieldName, maxLength) {
    const text = String(value ?? '').trim();
    if (!text) throw validationError(`${fieldName} é obrigatório.`);
    if (maxLength && text.length > maxLength) {
        throw validationError(`${fieldName} aceita no máximo ${maxLength} caracteres.`);
    }
    return text;
}

function optionalText(value) {
    const text = String(value ?? '').trim();
    return text || null;
}

function code(value, fieldName, maxLength = 100) {
    const normalized = normalizeCode(value, fieldName);
    if (normalized.length > maxLength) {
        throw validationError(`${fieldName} aceita no máximo ${maxLength} caracteres.`);
    }
    return normalized;
}

function toBool(value, fallback = true) {
    if (value === undefined || value === null || value === '') return fallback;
    return value === true || String(value).toLowerCase() === 'true';
}

// jsonb: aceita qualquer valor JSON; undefined/'' viram NULL
function toJsonParam(value) {
    if (value === undefined || value === null || value === '') return null;
    return JSON.stringify(value);
}

function toTimestamp(value, fieldName) {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw validationError(`${fieldName} inválida.`);
    return date.toISOString();
}

function toInt(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n)) throw validationError('Ordem deve ser um número inteiro.');
    return n;
}

/* ==========================================================================
   appFeatures
   ========================================================================== */

function featurePayload(body = {}) {
    const valueType = String(body.value_type ?? 'OPTION').trim().toUpperCase();
    if (!APP_FEATURES_VALUE_TYPES.includes(valueType)) {
        throw validationError(`Tipo de valor inválido. Use: ${APP_FEATURES_VALUE_TYPES.join(', ')}.`);
    }

    return [
        code(body.feature_code, 'Código'),
        requiredText(body.feature_name, 'Nome', 150),
        optionalText(body.description),
        valueType,
        toJsonParam(body.default_value),
        toBool(body.is_active, true),
    ];
}

export async function listFeaturesAdmin({ includeInactive = false } = {}) {
    const { rows } = await getDb().query(
        `SELECT f.feature_id, f.feature_code, f.feature_name, f.description,
                f.value_type, f.default_value, f.is_active, f.created_at, f.updated_at,
                (SELECT COUNT(*)::int FROM ${TABLES.options} o WHERE o.feature_id = f.feature_id) AS options_count,
                (SELECT COUNT(*)::int FROM ${TABLES.assignments} a WHERE a.feature_id = f.feature_id) AS assignments_count
           FROM ${TABLES.features} f
          WHERE ($1::boolean = TRUE OR f.is_active = TRUE)
          ORDER BY f.feature_code, f.feature_id`,
        [Boolean(includeInactive)],
    );
    return rows.map((r) => ({ ...r, feature_id: Number(r.feature_id) }));
}

export async function createFeature(body) {
    const { rows } = await getDb().query(
        `INSERT INTO ${TABLES.features}
           (feature_code, feature_name, description, value_type, default_value, is_active)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING feature_id`,
        featurePayload(body),
    );
    return { feature_id: Number(rows[0].feature_id) };
}

export async function updateFeature(id, body) {
    const featureId = toId(id, 'ID da funcionalidade');
    const { rowCount } = await getDb().query(
        `UPDATE ${TABLES.features}
            SET feature_code = $1, feature_name = $2, description = $3,
                value_type = $4, default_value = $5::jsonb, is_active = $6,
                updated_at = NOW()
          WHERE feature_id = $7`,
        [...featurePayload(body), featureId],
    );
    if (!rowCount) throw notFound('Funcionalidade não encontrada.');
    return { feature_id: featureId };
}

export async function deleteFeature(id) {
    const featureId = toId(id, 'ID da funcionalidade');
    const { rowCount } = await getDb().query(
        `DELETE FROM ${TABLES.features} WHERE feature_id = $1`,
        [featureId],
    );
    if (!rowCount) throw notFound('Funcionalidade não encontrada.');
    return true;
}

/* ==========================================================================
   appFeatureOptions
   ========================================================================== */

function optionPayload(body = {}) {
    const config = body.option_config;
    if (config !== undefined && config !== null && (typeof config !== 'object' || Array.isArray(config))) {
        throw validationError('Configuração deve ser um objeto JSON, ex.: {"chave": "valor"}.');
    }

    return [
        toId(body.feature_id, 'Funcionalidade'),
        code(body.option_code, 'Código'),
        requiredText(body.option_name, 'Nome', 150),
        optionalText(body.description),
        JSON.stringify(config ?? {}),
        toInt(body.sort_order, 0),
        toBool(body.is_active, true),
    ];
}

export async function listOptionsAdmin({ featureId = null, includeInactive = false } = {}) {
    const { rows } = await getDb().query(
        `SELECT o.feature_option_id, o.feature_id, f.feature_code, f.feature_name,
                o.option_code, o.option_name, o.description, o.option_config,
                o.sort_order, o.is_active, o.created_at, o.updated_at,
                (SELECT COUNT(*)::int FROM ${TABLES.assignments} a
                  WHERE a.feature_option_id = o.feature_option_id) AS assignments_count
           FROM ${TABLES.options} o
           JOIN ${TABLES.features} f ON f.feature_id = o.feature_id
          WHERE ($1::bigint IS NULL OR o.feature_id = $1)
            AND ($2::boolean = TRUE OR o.is_active = TRUE)
          ORDER BY f.feature_code, o.sort_order, o.option_name, o.option_code`,
        [toOptionalId(featureId, 'Funcionalidade'), Boolean(includeInactive)],
    );
    return rows.map((r) => ({
        ...r,
        feature_option_id: Number(r.feature_option_id),
        feature_id: Number(r.feature_id),
    }));
}

export async function createOption(body) {
    const { rows } = await getDb().query(
        `INSERT INTO ${TABLES.options}
           (feature_id, option_code, option_name, description, option_config, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING feature_option_id`,
        optionPayload(body),
    );
    return { feature_option_id: Number(rows[0].feature_option_id) };
}

export async function updateOption(id, body) {
    const optionId = toId(id, 'ID da opção');
    const { rowCount } = await getDb().query(
        `UPDATE ${TABLES.options}
            SET feature_id = $1, option_code = $2, option_name = $3, description = $4,
                option_config = $5::jsonb, sort_order = $6, is_active = $7,
                updated_at = NOW()
          WHERE feature_option_id = $8`,
        [...optionPayload(body), optionId],
    );
    if (!rowCount) throw notFound('Opção não encontrada.');
    return { feature_option_id: optionId };
}

export async function deleteOption(id) {
    const optionId = toId(id, 'ID da opção');
    const { rowCount } = await getDb().query(
        `DELETE FROM ${TABLES.options} WHERE feature_option_id = $1`,
        [optionId],
    );
    if (!rowCount) throw notFound('Opção não encontrada.');
    return true;
}

/* ==========================================================================
   appFeatureAssignments
   ========================================================================== */

function assignmentPayload(body = {}) {
    const startsAt = toTimestamp(body.starts_at, 'Data de início');
    const endsAt = toTimestamp(body.ends_at, 'Data de fim');
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
        throw validationError('A data de fim deve ser depois da data de início.');
    }

    return [
        toId(body.feature_id, 'Funcionalidade'),
        toOptionalId(body.feature_option_id, 'Opção'),
        code(body.scope_type ?? 'GLOBAL', 'Escopo', 30),
        normalizeScopeId(body.scope_id ?? 1),
        toJsonParam(body.custom_value),
        toBool(body.is_enabled, true),
        startsAt,
        endsAt,
    ];
}

export async function listAssignmentsAdmin({ featureId = null } = {}) {
    const { rows } = await getDb().query(
        `SELECT a.feature_assignment_id, a.feature_id, f.feature_code, f.feature_name,
                a.feature_option_id, o.option_code, o.option_name,
                a.scope_type, a.scope_id, a.custom_value, a.is_enabled,
                a.starts_at, a.ends_at, a.updated_at
           FROM ${TABLES.assignments} a
           JOIN ${TABLES.features} f ON f.feature_id = a.feature_id
           LEFT JOIN ${TABLES.options} o ON o.feature_option_id = a.feature_option_id
          WHERE ($1::bigint IS NULL OR a.feature_id = $1)
          ORDER BY f.feature_code, a.scope_type, a.scope_id`,
        [toOptionalId(featureId, 'Funcionalidade')],
    );
    return rows.map((r) => ({
        ...r,
        feature_assignment_id: Number(r.feature_assignment_id),
        feature_id: Number(r.feature_id),
        feature_option_id: r.feature_option_id == null ? null : Number(r.feature_option_id),
        scope_id: Number(r.scope_id),
    }));
}

export async function createAssignment(body) {
    const { rows } = await getDb().query(
        `INSERT INTO ${TABLES.assignments}
           (feature_id, feature_option_id, scope_type, scope_id, custom_value, is_enabled, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz, $8::timestamptz)
         RETURNING feature_assignment_id`,
        assignmentPayload(body),
    );
    return { feature_assignment_id: Number(rows[0].feature_assignment_id) };
}

export async function updateAssignment(id, body) {
    const assignmentId = toId(id, 'ID da atribuição');
    const { rowCount } = await getDb().query(
        `UPDATE ${TABLES.assignments}
            SET feature_id = $1, feature_option_id = $2, scope_type = $3, scope_id = $4,
                custom_value = $5::jsonb, is_enabled = $6,
                starts_at = $7::timestamptz, ends_at = $8::timestamptz,
                updated_at = NOW()
          WHERE feature_assignment_id = $9`,
        [...assignmentPayload(body), assignmentId],
    );
    if (!rowCount) throw notFound('Atribuição não encontrada.');
    return { feature_assignment_id: assignmentId };
}

export async function deleteAssignmentById(id) {
    const assignmentId = toId(id, 'ID da atribuição');
    const { rowCount } = await getDb().query(
        `DELETE FROM ${TABLES.assignments} WHERE feature_assignment_id = $1`,
        [assignmentId],
    );
    if (!rowCount) throw notFound('Atribuição não encontrada.');
    return true;
}

/* ==========================================================================
   Modal único: funcionalidade + opções + atribuições numa transação
   body = { feature: {...}, options: [{ feature_option_id?, option_code, ... }],
            assignments: [{ feature_assignment_id?, option_code|null, scope_type, ... }] }
   Opções/atribuições que não vierem na lista são excluídas.
   As atribuições apontam para a opção pelo código (serve para opções novas).
   ========================================================================== */

function idSet(rows, key) {
    return new Set(rows.map((r) => Number(r[key])));
}

export async function saveFeatureFull(id, body = {}) {
    const featureId = id ? toId(id, 'ID da funcionalidade') : null;
    const options = Array.isArray(body.options) ? body.options : [];
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];

    // validação antes de abrir a transação
    const featureParams = featurePayload(body.feature);
    const codes = new Set();
    options.forEach((o) => {
        const c = code(o.option_code, 'Código da opção');
        if (codes.has(c)) throw validationError(`Código de opção repetido: ${c}.`);
        codes.add(c);
    });
    const scopes = new Set();
    assignments.forEach((a) => {
        const key = `${code(a.scope_type ?? 'GLOBAL', 'Escopo', 30)}#${normalizeScopeId(a.scope_id ?? 1)}`;
        if (scopes.has(key)) throw validationError(`Escopo repetido nas atribuições: ${key}.`);
        scopes.add(key);
        if (a.option_code && !codes.has(String(a.option_code).trim().toUpperCase())) {
            throw validationError(`A atribuição ${key} usa a opção ${a.option_code}, que não está na lista.`);
        }
    });

    const client = await getDb().connect();
    try {
        await client.query('BEGIN');

        // 1) funcionalidade
        let fid = featureId;
        if (fid) {
            const { rowCount } = await client.query(
                `UPDATE ${TABLES.features}
                    SET feature_code = $1, feature_name = $2, description = $3,
                        value_type = $4, default_value = $5::jsonb, is_active = $6,
                        updated_at = NOW()
                  WHERE feature_id = $7`,
                [...featureParams, fid],
            );
            if (!rowCount) throw notFound('Funcionalidade não encontrada.');
        } else {
            const { rows } = await client.query(
                `INSERT INTO ${TABLES.features}
                   (feature_code, feature_name, description, value_type, default_value, is_active)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6)
                 RETURNING feature_id`,
                featureParams,
            );
            fid = Number(rows[0].feature_id);
        }

        const current = {
            options: (await client.query(
                `SELECT feature_option_id FROM ${TABLES.options} WHERE feature_id = $1`, [fid])).rows,
            assignments: (await client.query(
                `SELECT feature_assignment_id FROM ${TABLES.assignments} WHERE feature_id = $1`, [fid])).rows,
        };
        const currentOptionIds = idSet(current.options, 'feature_option_id');
        const currentAssignmentIds = idSet(current.assignments, 'feature_assignment_id');

        // 2) atribuições removidas (antes das opções, por causa da FK)
        const keepAssignments = new Set(assignments
            .map((a) => Number(a.feature_assignment_id))
            .filter((n) => currentAssignmentIds.has(n)));
        for (const aid of currentAssignmentIds) {
            if (!keepAssignments.has(aid)) {
                await client.query(`DELETE FROM ${TABLES.assignments} WHERE feature_assignment_id = $1`, [aid]);
            }
        }

        // 3) opções: atualiza / insere
        const optionIdByCode = new Map();
        const keepOptions = new Set();
        for (const o of options) {
            const params = optionPayload({ ...o, feature_id: fid });
            const oid = Number(o.feature_option_id);
            if (currentOptionIds.has(oid)) {
                await client.query(
                    `UPDATE ${TABLES.options}
                        SET feature_id = $1, option_code = $2, option_name = $3, description = $4,
                            option_config = $5::jsonb, sort_order = $6, is_active = $7,
                            updated_at = NOW()
                      WHERE feature_option_id = $8`,
                    [...params, oid],
                );
                keepOptions.add(oid);
                optionIdByCode.set(params[1], oid);
            } else {
                const { rows } = await client.query(
                    `INSERT INTO ${TABLES.options}
                       (feature_id, option_code, option_name, description, option_config, sort_order, is_active)
                     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
                     RETURNING feature_option_id`,
                    params,
                );
                optionIdByCode.set(params[1], Number(rows[0].feature_option_id));
            }
        }

        // 4) atribuições: atualiza / insere (opção pelo código)
        for (const a of assignments) {
            const optionCode = a.option_code ? String(a.option_code).trim().toUpperCase() : null;
            const params = assignmentPayload({
                ...a,
                feature_id: fid,
                feature_option_id: optionCode ? optionIdByCode.get(optionCode) : null,
            });
            const aid = Number(a.feature_assignment_id);
            if (keepAssignments.has(aid)) {
                await client.query(
                    `UPDATE ${TABLES.assignments}
                        SET feature_id = $1, feature_option_id = $2, scope_type = $3, scope_id = $4,
                            custom_value = $5::jsonb, is_enabled = $6,
                            starts_at = $7::timestamptz, ends_at = $8::timestamptz,
                            updated_at = NOW()
                      WHERE feature_assignment_id = $9`,
                    [...params, aid],
                );
            } else {
                await client.query(
                    `INSERT INTO ${TABLES.assignments}
                       (feature_id, feature_option_id, scope_type, scope_id, custom_value, is_enabled, starts_at, ends_at)
                     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz, $8::timestamptz)`,
                    params,
                );
            }
        }

        // 5) opções removidas
        for (const oid of currentOptionIds) {
            if (!keepOptions.has(oid)) {
                await client.query(`DELETE FROM ${TABLES.options} WHERE feature_option_id = $1`, [oid]);
            }
        }

        await client.query('COMMIT');
        return { feature_id: fid };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
