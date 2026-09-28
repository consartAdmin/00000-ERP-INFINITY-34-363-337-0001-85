// ╔══════════════════════════════════════════════════════════════════════╗
// ║ appFeaturesApi.js — Persistência e resolução de funcionalidades      ║
// ║ CONSART ERP | PostgreSQL | ESM                                      ║
// ║                                                                      ║
// ║ Schemas centralizados:                                               ║
// ║ - catalog_schema_appFeatures.js                                      ║
// ║ - catalog_schema_appFeatureOptions.js                                ║
// ║ - catalog_schema_appFeatureAssignments.js                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import appFeaturesSchema from '../appFeatures/catalog_schema/catalog_schema_appFeatures.js';
import appFeatureOptionsSchema from '../appFeatures/catalog_schema/catalog_schema_appFeatureOptions.js';
import appFeatureAssignmentsSchema from '../appFeatures/catalog_schema/catalog_schema_appFeatureAssignments.js';

/* ==========================================================================
   Catalog schemas
   ========================================================================== */

const SCHEMAS = Object.freeze({
    features: appFeaturesSchema,
    options: appFeatureOptionsSchema,
    assignments: appFeatureAssignmentsSchema,
});

const TABLES = Object.freeze({
    features: SCHEMAS.features.table,
    options: SCHEMAS.options.table,
    assignments: SCHEMAS.assignments.table,
});

function assertCatalogColumn(schema, columnName) {
    if (!schema?.columns?.[columnName]) {
        throw new Error(
            `Coluna ${columnName} não encontrada no catálogo ${schema?.table ?? 'desconhecido'}.`,
        );
    }

    return columnName;
}

function createColumns(schema, columnNames) {
    return Object.freeze(
        Object.fromEntries(
            columnNames.map((columnName) => [
                columnName,
                assertCatalogColumn(schema, columnName),
            ]),
        ),
    );
}

const FEATURE_COLUMNS = createColumns(SCHEMAS.features, [
    'feature_id',
    'feature_code',
    'feature_name',
    'description',
    'value_type',
    'default_value',
    'is_active',
    'created_at',
    'updated_at',
]);

const OPTION_COLUMNS = createColumns(SCHEMAS.options, [
    'feature_option_id',
    'feature_id',
    'option_code',
    'option_name',
    'description',
    'option_config',
    'sort_order',
    'is_active',
]);

const ASSIGNMENT_COLUMNS = createColumns(SCHEMAS.assignments, [
    'feature_assignment_id',
    'feature_id',
    'feature_option_id',
    'scope_type',
    'scope_id',
    'custom_value',
    'is_enabled',
    'starts_at',
    'ends_at',
    'updated_at',
]);

// Confirma também que as PKs declaradas pelos catálogos continuam compatíveis
// com esta camada. Se houver drift de schema, o erro aparece no startup/import.
if (SCHEMAS.features.primaryKey !== FEATURE_COLUMNS.feature_id) {
    throw new Error('Catálogo appFeatures incompatível: primaryKey inesperada.');
}

if (SCHEMAS.options.primaryKey !== OPTION_COLUMNS.feature_option_id) {
    throw new Error('Catálogo appFeatureOptions incompatível: primaryKey inesperada.');
}

if (SCHEMAS.assignments.primaryKey !== ASSIGNMENT_COLUMNS.feature_assignment_id) {
    throw new Error('Catálogo appFeatureAssignments incompatível: primaryKey inesperada.');
}

function qualified(alias, column) {
    return `${alias}.${column}`;
}

function selectColumns(alias, columns) {
    return columns.map((column) => qualified(alias, column)).join(',\n       ');
}

const FEATURE_SELECT_COLUMNS = Object.freeze([
    FEATURE_COLUMNS.feature_id,
    FEATURE_COLUMNS.feature_code,
    FEATURE_COLUMNS.feature_name,
    FEATURE_COLUMNS.description,
    FEATURE_COLUMNS.value_type,
    FEATURE_COLUMNS.default_value,
    FEATURE_COLUMNS.is_active,
    FEATURE_COLUMNS.created_at,
    FEATURE_COLUMNS.updated_at,
]);

/* ==========================================================================
   Database configuration
   ========================================================================== */

let database = null;

export function configureAppFeaturesDb(db) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('A conexão PostgreSQL deve possuir o método query().');
    }

    database = db;
}

function getDb() {
    if (!database) {
        throw new Error(
            'appFeaturesApi não configurada. Execute configureAppFeaturesDb(pool) no server.js.',
        );
    }

    return database;
}

/* ==========================================================================
   Normalizers
   ========================================================================== */

function normalizeCode(value, fieldName) {
    const normalized = String(value ?? '').trim().toUpperCase();

    if (!normalized) {
        const error = new Error(`${fieldName} é obrigatório.`);
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    return normalized;
}

function normalizeScopeId(value) {
    const normalized = Number(value);

    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        const error = new Error('scopeId deve ser um inteiro positivo.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    return normalized;
}

/* ==========================================================================
   Mappers
   ========================================================================== */

function mapFeature(row) {
    if (!row) return null;

    return {
        featureId: Number(row[FEATURE_COLUMNS.feature_id]),
        featureCode: row[FEATURE_COLUMNS.feature_code],
        featureName: row[FEATURE_COLUMNS.feature_name],
        description: row[FEATURE_COLUMNS.description],
        valueType: row[FEATURE_COLUMNS.value_type],
        defaultValue: row[FEATURE_COLUMNS.default_value],
        isActive: row[FEATURE_COLUMNS.is_active],
        createdAt: row[FEATURE_COLUMNS.created_at],
        updatedAt: row[FEATURE_COLUMNS.updated_at],
    };
}

function mapOption(row) {
    if (!row) return null;

    return {
        featureOptionId: Number(row[OPTION_COLUMNS.feature_option_id]),
        optionCode: row[OPTION_COLUMNS.option_code],
        optionName: row[OPTION_COLUMNS.option_name],
        description: row.option_description ?? row[OPTION_COLUMNS.description],
        config: row[OPTION_COLUMNS.option_config] ?? {},
        sortOrder: row[OPTION_COLUMNS.sort_order],
        isActive: row.option_is_active ?? row[OPTION_COLUMNS.is_active],
    };
}

/* ==========================================================================
   Feature queries
   ========================================================================== */

export async function listFeatures({ includeInactive = false } = {}) {
    const { rows } = await getDb().query(
        `SELECT
       ${selectColumns('f', FEATURE_SELECT_COLUMNS)}
     FROM ${TABLES.features} f
     WHERE ($1::boolean = TRUE OR ${qualified('f', FEATURE_COLUMNS.is_active)} = TRUE)
     ORDER BY
       ${qualified('f', FEATURE_COLUMNS.feature_name)},
       ${qualified('f', FEATURE_COLUMNS.feature_code)}`,
        [Boolean(includeInactive)],
    );

    return rows.map(mapFeature);
}

export async function getFeatureByCode(featureCode) {
    const code = normalizeCode(featureCode, 'featureCode');

    const { rows } = await getDb().query(
        `SELECT
       ${selectColumns('f', FEATURE_SELECT_COLUMNS)}
     FROM ${TABLES.features} f
     WHERE ${qualified('f', FEATURE_COLUMNS.feature_code)} = $1
     LIMIT 1`,
        [code],
    );

    return mapFeature(rows[0]);
}

export async function listFeatureOptions(
    featureCode,
    { includeInactive = false } = {},
) {
    const code = normalizeCode(featureCode, 'featureCode');

    const { rows } = await getDb().query(
        `SELECT
       ${qualified('o', OPTION_COLUMNS.feature_option_id)},
       ${qualified('o', OPTION_COLUMNS.option_code)},
       ${qualified('o', OPTION_COLUMNS.option_name)},
       ${qualified('o', OPTION_COLUMNS.description)} AS option_description,
       ${qualified('o', OPTION_COLUMNS.option_config)},
       ${qualified('o', OPTION_COLUMNS.sort_order)},
       ${qualified('o', OPTION_COLUMNS.is_active)} AS option_is_active
     FROM ${TABLES.options} o
     JOIN ${TABLES.features} f
       ON ${qualified('f', FEATURE_COLUMNS.feature_id)} = ${qualified('o', OPTION_COLUMNS.feature_id)}
     WHERE ${qualified('f', FEATURE_COLUMNS.feature_code)} = $1
       AND ($2::boolean = TRUE OR ${qualified('o', OPTION_COLUMNS.is_active)} = TRUE)
     ORDER BY
       ${qualified('o', OPTION_COLUMNS.sort_order)},
       ${qualified('o', OPTION_COLUMNS.option_name)},
       ${qualified('o', OPTION_COLUMNS.option_code)}`,
        [code, Boolean(includeInactive)],
    );

    return rows.map(mapOption);
}

/* ==========================================================================
   Feature resolution
   ========================================================================== */

export async function resolveFeature({
    featureCode,
    scopeType = 'GLOBAL',
    scopeId = 1,
} = {}) {
    const code = normalizeCode(featureCode, 'featureCode');
    const normalizedScopeType = normalizeCode(scopeType, 'scopeType');
    const normalizedScopeId = normalizeScopeId(scopeId);

    const { rows } = await getDb().query(
        `SELECT
       ${qualified('f', FEATURE_COLUMNS.feature_id)},
       ${qualified('f', FEATURE_COLUMNS.feature_code)},
       ${qualified('f', FEATURE_COLUMNS.feature_name)},
       ${qualified('f', FEATURE_COLUMNS.description)},
       ${qualified('f', FEATURE_COLUMNS.value_type)},
       ${qualified('f', FEATURE_COLUMNS.default_value)},
       ${qualified('f', FEATURE_COLUMNS.is_active)} AS feature_is_active,
       ${qualified('a', ASSIGNMENT_COLUMNS.feature_assignment_id)},
       ${qualified('a', ASSIGNMENT_COLUMNS.is_enabled)} AS assignment_is_enabled,
       ${qualified('a', ASSIGNMENT_COLUMNS.custom_value)},
       ${qualified('a', ASSIGNMENT_COLUMNS.starts_at)},
       ${qualified('a', ASSIGNMENT_COLUMNS.ends_at)},
       ${qualified('o', OPTION_COLUMNS.feature_option_id)},
       ${qualified('o', OPTION_COLUMNS.option_code)},
       ${qualified('o', OPTION_COLUMNS.option_name)},
       ${qualified('o', OPTION_COLUMNS.description)} AS option_description,
       ${qualified('o', OPTION_COLUMNS.option_config)},
       ${qualified('o', OPTION_COLUMNS.is_active)} AS option_is_active
     FROM ${TABLES.features} f
     LEFT JOIN ${TABLES.assignments} a
       ON ${qualified('a', ASSIGNMENT_COLUMNS.feature_id)} = ${qualified('f', FEATURE_COLUMNS.feature_id)}
      AND ${qualified('a', ASSIGNMENT_COLUMNS.scope_type)} = $2
      AND ${qualified('a', ASSIGNMENT_COLUMNS.scope_id)} = $3
      AND (${qualified('a', ASSIGNMENT_COLUMNS.starts_at)} IS NULL OR ${qualified('a', ASSIGNMENT_COLUMNS.starts_at)} <= NOW())
      AND (${qualified('a', ASSIGNMENT_COLUMNS.ends_at)} IS NULL OR ${qualified('a', ASSIGNMENT_COLUMNS.ends_at)} > NOW())
     LEFT JOIN ${TABLES.options} o
       ON ${qualified('o', OPTION_COLUMNS.feature_id)} = ${qualified('f', FEATURE_COLUMNS.feature_id)}
      AND ${qualified('o', OPTION_COLUMNS.feature_option_id)} = ${qualified('a', ASSIGNMENT_COLUMNS.feature_option_id)}
     WHERE ${qualified('f', FEATURE_COLUMNS.feature_code)} = $1
     LIMIT 1`,
        [code, normalizedScopeType, normalizedScopeId],
    );

    const row = rows[0];
    if (!row) return null;

    const hasAssignment = row[ASSIGNMENT_COLUMNS.feature_assignment_id] != null;
    const defaultOptionCode = row[FEATURE_COLUMNS.default_value]?.optionCode ?? null;
    const assignedOptionIsUsable =
        Boolean(row[OPTION_COLUMNS.option_code]) && row.option_is_active !== false;
    const optionCode = assignedOptionIsUsable
        ? row[OPTION_COLUMNS.option_code]
        : defaultOptionCode;

    let option = null;

    if (optionCode) {
        const optionResult = await getDb().query(
            `SELECT
         ${OPTION_COLUMNS.feature_option_id},
         ${OPTION_COLUMNS.option_code},
         ${OPTION_COLUMNS.option_name},
         ${OPTION_COLUMNS.description} AS option_description,
         ${OPTION_COLUMNS.option_config},
         ${OPTION_COLUMNS.sort_order},
         ${OPTION_COLUMNS.is_active} AS option_is_active
       FROM ${TABLES.options}
       WHERE ${OPTION_COLUMNS.feature_id} = $1
         AND ${OPTION_COLUMNS.option_code} = $2
         AND ${OPTION_COLUMNS.is_active} = TRUE
       LIMIT 1`,
            [row[FEATURE_COLUMNS.feature_id], optionCode],
        );

        if (optionResult.rows[0]) {
            option = mapOption(optionResult.rows[0]);
        }
    }

    return {
        featureId: Number(row[FEATURE_COLUMNS.feature_id]),
        featureCode: row[FEATURE_COLUMNS.feature_code],
        featureName: row[FEATURE_COLUMNS.feature_name],
        enabled:
            row.feature_is_active &&
            (!hasAssignment || row.assignment_is_enabled === true),
        valueType: row[FEATURE_COLUMNS.value_type],
        optionCode: option?.optionCode ?? optionCode,
        optionName: option?.optionName ?? null,
        config: option?.config ?? {},
        customValue: hasAssignment
            ? row[ASSIGNMENT_COLUMNS.custom_value]
            : row[FEATURE_COLUMNS.default_value],
        source: hasAssignment ? 'ASSIGNMENT' : 'DEFAULT',
        scopeType: normalizedScopeType,
        scopeId: normalizedScopeId,
    };
}

/* ==========================================================================
   Assignment writes
   ========================================================================== */

export async function upsertFeatureAssignment({
    featureCode,
    scopeType = 'GLOBAL',
    scopeId = 1,
    optionCode = null,
    customValue = null,
    isEnabled = true,
    startsAt = null,
    endsAt = null,
} = {}) {
    const code = normalizeCode(featureCode, 'featureCode');
    const normalizedScopeType = normalizeCode(scopeType, 'scopeType');
    const normalizedScopeId = normalizeScopeId(scopeId);
    const normalizedOptionCode = optionCode
        ? normalizeCode(optionCode, 'optionCode')
        : null;

    const { rows } = await getDb().query(
        `INSERT INTO ${TABLES.assignments} (
       ${ASSIGNMENT_COLUMNS.feature_id},
       ${ASSIGNMENT_COLUMNS.feature_option_id},
       ${ASSIGNMENT_COLUMNS.scope_type},
       ${ASSIGNMENT_COLUMNS.scope_id},
       ${ASSIGNMENT_COLUMNS.custom_value},
       ${ASSIGNMENT_COLUMNS.is_enabled},
       ${ASSIGNMENT_COLUMNS.starts_at},
       ${ASSIGNMENT_COLUMNS.ends_at}
     )
     SELECT
       ${qualified('f', FEATURE_COLUMNS.feature_id)},
       ${qualified('o', OPTION_COLUMNS.feature_option_id)},
       $2,
       $3,
       $5::jsonb,
       $6,
       $7::timestamptz,
       $8::timestamptz
     FROM ${TABLES.features} f
     LEFT JOIN ${TABLES.options} o
       ON ${qualified('o', OPTION_COLUMNS.feature_id)} = ${qualified('f', FEATURE_COLUMNS.feature_id)}
      AND ${qualified('o', OPTION_COLUMNS.option_code)} = $4
      AND ${qualified('o', OPTION_COLUMNS.is_active)} = TRUE
     WHERE ${qualified('f', FEATURE_COLUMNS.feature_code)} = $1
       AND ($4::text IS NULL OR ${qualified('o', OPTION_COLUMNS.feature_option_id)} IS NOT NULL)
     ON CONFLICT (
       ${ASSIGNMENT_COLUMNS.scope_type},
       ${ASSIGNMENT_COLUMNS.scope_id},
       ${ASSIGNMENT_COLUMNS.feature_id}
     )
     DO UPDATE SET
       ${ASSIGNMENT_COLUMNS.feature_option_id} = EXCLUDED.${ASSIGNMENT_COLUMNS.feature_option_id},
       ${ASSIGNMENT_COLUMNS.custom_value} = EXCLUDED.${ASSIGNMENT_COLUMNS.custom_value},
       ${ASSIGNMENT_COLUMNS.is_enabled} = EXCLUDED.${ASSIGNMENT_COLUMNS.is_enabled},
       ${ASSIGNMENT_COLUMNS.starts_at} = EXCLUDED.${ASSIGNMENT_COLUMNS.starts_at},
       ${ASSIGNMENT_COLUMNS.ends_at} = EXCLUDED.${ASSIGNMENT_COLUMNS.ends_at},
       ${ASSIGNMENT_COLUMNS.updated_at} = NOW()
     RETURNING ${ASSIGNMENT_COLUMNS.feature_assignment_id}`,
        [
            code,
            normalizedScopeType,
            normalizedScopeId,
            normalizedOptionCode,
            customValue == null ? null : JSON.stringify(customValue),
            Boolean(isEnabled),
            startsAt,
            endsAt,
        ],
    );

    if (!rows[0]) {
        const error = new Error('Funcionalidade ou opção não encontrada.');
        error.code = 'FEATURE_OR_OPTION_NOT_FOUND';
        throw error;
    }

    return resolveFeature({
        featureCode: code,
        scopeType: normalizedScopeType,
        scopeId: normalizedScopeId,
    });
}

export async function removeFeatureAssignment({
    featureCode,
    scopeType = 'GLOBAL',
    scopeId = 1,
} = {}) {
    const code = normalizeCode(featureCode, 'featureCode');
    const normalizedScopeType = normalizeCode(scopeType, 'scopeType');
    const normalizedScopeId = normalizeScopeId(scopeId);

    const result = await getDb().query(
        `DELETE FROM ${TABLES.assignments} a
     USING ${TABLES.features} f
     WHERE ${qualified('f', FEATURE_COLUMNS.feature_id)} = ${qualified('a', ASSIGNMENT_COLUMNS.feature_id)}
       AND ${qualified('f', FEATURE_COLUMNS.feature_code)} = $1
       AND ${qualified('a', ASSIGNMENT_COLUMNS.scope_type)} = $2
       AND ${qualified('a', ASSIGNMENT_COLUMNS.scope_id)} = $3`,
        [code, normalizedScopeType, normalizedScopeId],
    );

    return result.rowCount > 0;
}

/* ==========================================================================
   Exposed catalog metadata
   ========================================================================== */

// Optional export for repositories/tests that need to inspect the exact catalog
// objects used by this API without importing the three files again.
export const appFeaturesCatalogs = SCHEMAS;

export default {
    configureAppFeaturesDb,
    listFeatures,
    getFeatureByCode,
    listFeatureOptions,
    resolveFeature,
    upsertFeatureAssignment,
    removeFeatureAssignment,
    catalogs: appFeaturesCatalogs,
};
