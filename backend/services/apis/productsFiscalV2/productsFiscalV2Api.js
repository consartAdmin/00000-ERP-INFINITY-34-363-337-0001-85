// ===============================================================================
// backend/services/apis/productsFiscalV2/productsFiscalV2Api.js
// ===============================================================================

import db from '../../../config/db.js';
import {
  PRODUCTS_FISCAL_V2_TABLE as TABLE,
  PRODUCTS_FISCAL_V2_PRIMARY_KEY as PRIMARY_KEY,
  PRODUCTS_FISCAL_V2_SELECT_COLUMNS,
  PRODUCTS_FISCAL_V2_SELECT_SQL,
  PRODUCTS_FISCAL_V2_CURRENT_WHERE_SQL as CURRENT_WHERE,
  validateProductFiscalPayload,
} from './catalog_schema.productsFiscalV2.js';
import { FISCAL_CLASSIFICATION_V2_TABLE } from '../fiscalClassificationV2/catalog_schema.fiscalClassificationV2.js';
import { FISCAL_PROFILE_V2_TABLE } from '../fiscalProfileV2/catalog_schema.fiscalProfileV2.js';

// ============================================================================
// CATÁLOGO — COLUNAS E VALIDAÇÃO
// ============================================================================

// Lista explícita no lugar de RETURNING *, definida pelo catálogo.
const RETURNING = PRODUCTS_FISCAL_V2_SELECT_COLUMNS
  .map((column) => `"${column}"`)
  .join(', ');

function badRequest(message, errors = []) {
  return Object.assign(new Error(message), { status: 400, errors });
}

function parseBoolean(value, fieldName) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw badRequest(`${fieldName} deve ser booleano.`);
}

function normalizePagination(limit, offset, defaultLimit) {
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedOffset = Number.parseInt(offset, 10);

  return {
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 500)
      : defaultLimit,
    offset: Number.isFinite(parsedOffset)
      ? Math.max(parsedOffset, 0)
      : 0,
  };
}

// Valida o payload do upsert contra o catálogo (campos obrigatórios e
// check constraints). extra_payload nulo é permitido aqui: no upsert ele
// significa "manter o atual" ou "usar o padrão '{}'".
function assertValidUpsertPayload(payload = {}) {
  const productCode = String(payload?.product_code ?? '').trim();

  const data = {
    product_code: productCode,
    fiscal_classification_id: payload?.fiscal_classification_id,
  };

  if (payload?.extra_payload !== undefined && payload.extra_payload !== null) {
    data.extra_payload = payload.extra_payload;
  }

  const validation = validateProductFiscalPayload(data);

  if (!validation.valid) {
    throw badRequest('Payload de vínculo fiscal inválido.', validation.errors);
  }

  const fiscalClassificationId = Number(data.fiscal_classification_id);
  if (!Number.isInteger(fiscalClassificationId) || fiscalClassificationId <= 0) {
    throw badRequest('fiscal_classification_id deve ser um inteiro maior que zero.', [
      {
        field: 'fiscal_classification_id',
        message: 'fiscal_classification_id deve ser um inteiro maior que zero.',
      },
    ]);
  }

  return {
    ...payload,
    product_code: productCode,
    fiscal_classification_id: fiscalClassificationId,
  };
}

// ============================================================================
// CONSULTA COMPLETA DO VÍNCULO
// ============================================================================

const FULL_SELECT = `
  SELECT
    ${PRODUCTS_FISCAL_V2_SELECT_SQL},

    fc.classification_name,
    fc.description AS description_class,
    fc.ncm_code,
    fc.ncm_description,
    fc.cest_code,
    fc.cest_description,
    fc.is_cst,
    fc.is_classification,
    fc.is_rate,
    fc.is_specific_rate,
    fc.is_unit,
    fc.ibscbs_cst,
    fc.ibscbs_classification,
    fc.ibs_uf_rate,
    fc.ibs_municipal_rate,
    fc.cbs_rate,
    fc.donation_indicator,
    fc.tax_reform_details,

    fp.fiscal_profile_id,
    fp.profile_name,
    fp.description AS description_profile,
    fp.icms_cst,
    fp.icms_rate,
    fp.cfop_entry,
    fp.cfop_exit,
    fp.origin_code,
    fp.pis_cst,
    fp.pis_rate,
    fp.cofins_cst,
    fp.cofins_rate,
    fp.benefit_code

  FROM ${TABLE} pf

  JOIN ${FISCAL_CLASSIFICATION_V2_TABLE} fc
    ON fc.fiscal_classification_id = pf.fiscal_classification_id

  LEFT JOIN ${FISCAL_PROFILE_V2_TABLE} fp
    ON fp.fiscal_profile_id = fc.fiscal_profile_id
`;

// ============================================================================
// LISTAR VÍNCULOS FISCAIS
// ============================================================================

export async function list({
  productCode,
  current,
  active,
  limit = 100,
  offset = 0,
} = {}) {
  const values = [];
  const where = [];
  const pagination = normalizePagination(limit, offset, 100);

  const addCondition = (column, value) => {
    values.push(value);
    where.push(`${column} = $${values.length}`);
  };

  const normalizedProductCode = String(productCode ?? '').trim();
  if (normalizedProductCode) addCondition('pf.product_code', normalizedProductCode);
  if (current !== undefined && current !== null && current !== '') {
    addCondition('pf.is_current', parseBoolean(current, 'current'));
  }
  if (active !== undefined && active !== null && active !== '') {
    addCondition('pf.is_active', parseBoolean(active, 'active'));
  }

  values.push(pagination.limit);
  const limitPosition = values.length;

  values.push(pagination.offset);
  const offsetPosition = values.length;

  const result = await db.query(
    `
      ${FULL_SELECT}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pf.product_code, pf.version DESC
      LIMIT $${limitPosition}
      OFFSET $${offsetPosition}
    `,
    values
  );

  return result.rows;
}

// ============================================================================
// LISTAR PRODUTOS PARA A TELA DE VÍNCULO EM LOTE
// ============================================================================

export async function listBatchProducts({
  search,
  linked,
  limit = 20,
  offset = 0,
} = {}) {
  const values = [];
  const pagination = normalizePagination(limit, offset, 20);
  const where = [
    'p.is_active = true',
  ];

  const normalizedSearch = String(search ?? '').trim();
  if (normalizedSearch) {
    values.push(`%${normalizedSearch}%`);

    const position = values.length;

    where.push(`
      (
        p.product_code ILIKE $${position}
        OR p.description ILIKE $${position}
        OR COALESCE(p.barcode, '') ILIKE $${position}
        OR CAST(p.product_id AS TEXT) ILIKE $${position}
      )
    `);
  }

  const normalizedLinked =
    linked === undefined || linked === null || linked === ''
      ? undefined
      : parseBoolean(linked, 'linked');

  if (normalizedLinked === true) {
    where.push(
      'pf.products_fiscal_id IS NOT NULL'
    );
  }

  if (normalizedLinked === false) {
    where.push(
      'pf.products_fiscal_id IS NULL'
    );
  }

  const whereSql = `
    WHERE ${where.join(' AND ')}
  `;

  const countResult = await db.query(
    `
      SELECT
        COUNT(*)::integer AS total

      FROM public.products p

      LEFT JOIN ${TABLE} pf
        ON pf.product_code = p.product_code
       AND ${CURRENT_WHERE}

      ${whereSql}
    `,
    values
  );

  const listValues = [
    ...values,
    pagination.limit,
    pagination.offset,
  ];

  const limitPosition =
    listValues.length - 1;

  const offsetPosition =
    listValues.length;

  const rowsResult = await db.query(
    `
      SELECT
        p.product_id,
        p.product_code,
        p.description AS product_description,
        p.barcode,

        pf.products_fiscal_id,
        pf.fiscal_classification_id,
        pf.version AS fiscal_version,

        fc.classification_name,
        fc.ncm_code,
        fc.cest_code,

        fp.fiscal_profile_id,
        fp.profile_name,

        CASE
          WHEN pf.products_fiscal_id IS NOT NULL
          THEN true
          ELSE false
        END AS fiscal_is_linked

      FROM public.products p

      LEFT JOIN ${TABLE} pf
        ON pf.product_code = p.product_code
       AND ${CURRENT_WHERE}

      LEFT JOIN ${FISCAL_CLASSIFICATION_V2_TABLE} fc
        ON fc.fiscal_classification_id =
           pf.fiscal_classification_id

      LEFT JOIN ${FISCAL_PROFILE_V2_TABLE} fp
        ON fp.fiscal_profile_id =
           fc.fiscal_profile_id

      ${whereSql}

      ORDER BY p.product_code

      LIMIT $${limitPosition}
      OFFSET $${offsetPosition}
    `,
    listValues
  );

  return {
    rows: rowsResult.rows,
    total: Number(
      countResult.rows[0]?.total || 0
    ),
  };
}

// ============================================================================
// CONSULTAR VÍNCULO FISCAL ATUAL
// ============================================================================

export async function getCurrent(productCode) {
  const normalizedProductCode = String(productCode ?? '').trim();
  if (!normalizedProductCode) {
    throw badRequest('productCode é obrigatório.');
  }

  const result = await db.query(
    `
      ${FULL_SELECT}
      WHERE pf.product_code = $1
        AND ${CURRENT_WHERE}
    `,
    [normalizedProductCode]
  );

  return result.rows[0] ?? null;
}

// ============================================================================
// UPSERT INTERNO — USA UMA CONEXÃO/TRANSAÇÃO JÁ ABERTA
//
// updated_at é preenchido pelo trigger products_fiscal_v2_updated_at.
// ============================================================================

async function upsertCurrentWithClient(client, payload) {
  payload = assertValidUpsertPayload(payload);

  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [payload.product_code]
  );

  const currentResult = await client.query(
    `
      SELECT ${PRODUCTS_FISCAL_V2_SELECT_SQL}
      FROM ${TABLE} pf
      WHERE pf.product_code = $1
        AND ${CURRENT_WHERE}
      FOR UPDATE
    `,
    [payload.product_code]
  );

  const current = currentResult.rows[0] ?? null;

  if (
    current &&
    Number(current.fiscal_classification_id) ===
    Number(payload.fiscal_classification_id)
  ) {
    const result = await client.query(
      `
        UPDATE ${TABLE}
        SET source_system = COALESCE($1, source_system),
            source_reference = COALESCE($2, source_reference),
            extra_payload = COALESCE($3, extra_payload)
        WHERE ${PRIMARY_KEY} = $4
        RETURNING ${RETURNING}
      `,
      [
        payload.source_system,
        payload.source_reference,
        payload.extra_payload,
        current.products_fiscal_id,
      ]
    );

    return result.rows[0];
  }

  let nextVersion;

  if (current) {
    nextVersion = Number(current.version) + 1;

    await client.query(
      `
        UPDATE ${TABLE}
        SET is_current = false,
            effective_to = now()
        WHERE ${PRIMARY_KEY} = $1
      `,
      [current.products_fiscal_id]
    );
  } else {
    const versionResult = await client.query(
      `
        SELECT COALESCE(MAX(version), 0) AS version
        FROM ${TABLE}
        WHERE product_code = $1
      `,
      [payload.product_code]
    );

    nextVersion = Number(versionResult.rows[0].version) + 1;
  }

  const insertedResult = await client.query(
    `
      INSERT INTO ${TABLE} (
        product_code,
        fiscal_classification_id,
        version,
        source_system,
        source_reference,
        extra_payload
      )
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, '{}'::jsonb))
      RETURNING ${RETURNING}
    `,
    [
      payload.product_code,
      payload.fiscal_classification_id,
      nextVersion,
      payload.source_system,
      payload.source_reference,
      payload.extra_payload,
    ]
  );

  return insertedResult.rows[0];
}

// ============================================================================
// CRIAR OU ATUALIZAR VÍNCULO FISCAL ATUAL
// ============================================================================

export async function upsertCurrent(payload) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const data = await upsertCurrentWithClient(client, payload);
    await client.query('COMMIT');
    return data;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// CRIAR OU ATUALIZAR VÍNCULOS FISCAIS EM LOTE — TRANSAÇÃO ATÔMICA
// ============================================================================

export async function batchUpsertCurrent({
  productCodes,
  ...payload
} = {}) {
  if (!Array.isArray(productCodes) || productCodes.length === 0) {
    throw badRequest('productCodes deve ser um array não vazio.', [
      { field: 'productCodes', message: 'Informe ao menos um código de produto.' },
    ]);
  }

  const normalizedProductCodes = [
    ...new Set(productCodes.map((code) => String(code ?? '').trim())),
  ];

  if (normalizedProductCodes.some((code) => !code)) {
    throw badRequest('productCodes contém código vazio.', [
      { field: 'productCodes', message: 'Códigos de produto vazios não são permitidos.' },
    ]);
  }

  // Validate shared fields before opening a database transaction.
  assertValidUpsertPayload({
    ...payload,
    product_code: normalizedProductCodes[0],
  });

  const client = await db.connect();

  const startedAt = Date.now();
  const processedProductCodes = [];

  let currentProductCode = null;
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    console.info(
      '[ProductsFiscalV2Service] Iniciando vínculo fiscal em lote.',
      {
        product_count: normalizedProductCodes.length,
        product_codes: normalizedProductCodes,
        fiscal_classification_id:
          payload.fiscal_classification_id,
        source_system:
          payload.source_system || null,
      }
    );

    const data = [];

    for (const productCode of normalizedProductCodes) {
      currentProductCode =
        String(productCode || '').trim();

      try {
        const result =
          await upsertCurrentWithClient(client, {
            ...payload,
            product_code: currentProductCode,
          });

        data.push(result);
        processedProductCodes.push(
          currentProductCode
        );

        console.info(
          '[ProductsFiscalV2Service] Produto processado no lote.',
          {
            product_code:
              currentProductCode,

            fiscal_classification_id:
              payload.fiscal_classification_id,

            products_fiscal_id:
              result?.products_fiscal_id ||
              null,

            version:
              result?.version ||
              null,
          }
        );
      } catch (productError) {
        productError.failed_product_code =
          currentProductCode;

        productError.processed_product_codes =
          [...processedProductCodes];

        productError.product_position =
          processedProductCodes.length + 1;

        productError.product_count =
          normalizedProductCodes.length;

        throw productError;
      }
    }

    await client.query('COMMIT');
    transactionStarted = false;

    console.info(
      '[ProductsFiscalV2Service] Vínculo fiscal em lote concluído.',
      {
        product_count: data.length,
        product_codes:
          processedProductCodes,

        fiscal_classification_id:
          payload.fiscal_classification_id,

        duration_ms:
          Date.now() - startedAt,
      }
    );

    return data;
  } catch (error) {
    let rollbackError = null;

    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
        transactionStarted = false;
      } catch (caughtRollbackError) {
        rollbackError = caughtRollbackError;
      }
    }

    const originalMessage =
      error instanceof Error
        ? error.message
        : String(error);

    const detailedError = new Error(
      currentProductCode !== null
        ? `Falha ao vincular o produto ` +
        `${currentProductCode || '(código vazio)'}: ${originalMessage}`
        : `Falha ao iniciar o vínculo fiscal em lote: ` +
        originalMessage
    );

    detailedError.name =
      'ProductsFiscalBatchError';

    detailedError.status =
      error.status || 500;

    detailedError.code =
      error.code ||
      'PRODUCTS_FISCAL_BATCH_ERROR';

    detailedError.cause = error;

    // Erros de validação do catálogo ({ field, message }).
    detailedError.errors =
      error.errors || [];

    detailedError.failed_product_code =
      error.failed_product_code ||
      currentProductCode ||
      null;

    detailedError.product_position =
      error.product_position ||
      processedProductCodes.length + 1;

    detailedError.product_count =
      error.product_count ||
      normalizedProductCodes.length;

    detailedError.processed_product_codes =
      error.processed_product_codes ||
      [...processedProductCodes];

    detailedError.fiscal_classification_id =
      payload.fiscal_classification_id ||
      null;

    detailedError.duration_ms =
      Date.now() - startedAt;

    // Informações fornecidas pelo PostgreSQL.
    detailedError.database = {
      code: error.code || null,
      detail: error.detail || null,
      hint: error.hint || null,
      table: error.table || null,
      column: error.column || null,
      constraint: error.constraint || null,
      schema: error.schema || null,
      severity: error.severity || null,
      routine: error.routine || null,
    };

    if (rollbackError) {
      detailedError.rollback_error = {
        message:
          rollbackError.message || null,

        code:
          rollbackError.code || null,

        stack:
          rollbackError.stack || null,
      };
    }

    console.error(
      '[ProductsFiscalV2Service] Erro no vínculo fiscal em lote.',
      {
        message:
          detailedError.message,

        code:
          detailedError.code,

        failed_product_code:
          detailedError.failed_product_code,

        product_position:
          detailedError.product_position,

        product_count:
          detailedError.product_count,

        processed_product_codes:
          detailedError.processed_product_codes,

        fiscal_classification_id:
          detailedError.fiscal_classification_id,

        errors:
          detailedError.errors,

        duration_ms:
          detailedError.duration_ms,

        database:
          detailedError.database,

        rollback_error:
          detailedError.rollback_error ||
          null,

        stack:
          error.stack || null,
      }
    );

    throw detailedError;
  } finally {
    client.release();
  }
}
// ============================================================================
// ENCERRAR VÍNCULO FISCAL ATUAL
// ============================================================================

export async function closeCurrent(productCode) {
  const normalizedProductCode = String(productCode ?? '').trim();
  if (!normalizedProductCode) {
    throw badRequest('productCode é obrigatório.');
  }

  const result = await db.query(
    `
      UPDATE ${TABLE} pf
      SET is_current = false,
          effective_to = now()
      WHERE pf.product_code = $1
        AND ${CURRENT_WHERE}
      RETURNING ${RETURNING}
    `,
    [normalizedProductCode]
  );

  return result.rows[0] ?? null;
}
