// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsBarCodeApi.js — Data Access (ESM) | CONSART ERP            ║
// ║ Path: backend/services/apis/productsBarCodeApi.js                  ║
// ║ Table controlled by: catalog_schema.productsBarCode.js             ║
// ║ ✅ Dimensions stored in public."productsBarCode"                    ║
// ║ ✅ No dependency on products_dimensions/product_dimension_id       ║
// ║ ✅ Insert/update payload validated by the catalog                   ║
// ║ ✅ Resolve only active barcode + active product                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import productsBarCodeSchema, {
  PRODUCTS_BAR_CODE_TABLE,
  PRODUCTS_BAR_CODE_PRIMARY_KEY,
  PRODUCTS_BAR_CODE_TYPES,
  prepareProductsBarCodeInsert,
  prepareProductsBarCodeUpdate,
} from '../../../repositories/productsBarCode/productsBarCode.catalog.js';

const TB_PRODUCTS_BAR_CODE = PRODUCTS_BAR_CODE_TABLE;
const PK_PRODUCTS_BAR_CODE = PRODUCTS_BAR_CODE_PRIMARY_KEY;
const SELECT_COLUMNS = Object.freeze([...productsBarCodeSchema.selectColumns]);

function selectProjection(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return SELECT_COLUMNS.map((column) => `${prefix}${column}`).join(',\n        ');
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function normalizeBarcode(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  return value.replace(/\D+/g, '');
}

function detectBarcodeType(raw) {
  const digits = normalizeBarcode(raw);

  if (/^\d{13}$/.test(digits)) return 'GTIN13';
  if (/^\d{14}$/.test(digits)) return 'GTIN14';

  return 'OTHER';
}

function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;

  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function toPositiveIntegerOrNull(value) {
  const number = toNumberOrNull(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'sim', 's', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'nao', 'não', 'n', 'off'].includes(normalized)) return false;

  return fallback;
}

function validationError(errors) {
  const error = new Error(
    errors.map(({ message }) => message).filter(Boolean).join('; ') ||
    'Invalid productsBarCode payload'
  );

  error.status = 400;
  error.code = 'INVALID_PRODUCTS_BARCODE_PAYLOAD';
  error.details = errors;
  return error;
}

function normalizeWritePayload(payload = {}, { insert = false } = {}) {
  const prepared = insert
    ? prepareProductsBarCodeInsert(payload)
    : prepareProductsBarCodeUpdate(payload);

  if (!prepared.valid) throw validationError(prepared.errors);

  const data = { ...prepared.data };

  if (Object.prototype.hasOwnProperty.call(data, 'barcode')) {
    data.barcode = normalizeBarcode(data.barcode);
    if (!data.barcode) {
      throw validationError([{ field: 'barcode', message: 'barcode is required' }]);
    }
    data.barcode_type = detectBarcodeType(data.barcode);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'barcode_type') && data.barcode_type) {
    data.barcode_type = String(data.barcode_type).trim().toUpperCase();
    if (!PRODUCTS_BAR_CODE_TYPES.includes(data.barcode_type)) {
      throw validationError([
        {
          field: 'barcode_type',
          message: `barcode_type must be one of: ${PRODUCTS_BAR_CODE_TYPES.join(', ')}`,
        },
      ]);
    }
  }

  for (const field of ['product_unit_id', 'unit_id']) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    data[field] = toPositiveIntegerOrNull(data[field]);
  }

  for (const field of ['fator', 'width_cm', 'length_cm', 'height_cm', 'weight_kg']) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    data[field] = toNumberOrNull(data[field]);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'is_active')) {
    data.is_active = toBoolean(data.is_active, insert ? true : null);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'standard')) {
    data.standard = toBoolean(data.standard, insert ? false : null);
  }

  return data;
}

/* ------------------------------------------------------------------ */
/* API                                                                */
/* ------------------------------------------------------------------ */
export const productsBarCodeApi = {
  schema: productsBarCodeSchema,
  normalizeBarcode,
  detectBarcodeType,

  /* ================================================================ */
  /* GET BY UNIT ID                                                   */
  /* ================================================================ */
  async getByUnitId(pgPool, product_code, product_unit_id) {
    const { rows } = await pgPool.query(
      `
      SELECT
        ${selectProjection()}
      FROM ${TB_PRODUCTS_BAR_CODE}
      WHERE product_code = $1
        AND product_unit_id = $2
      ORDER BY
        standard DESC NULLS LAST,
        is_active DESC,
        fator ASC NULLS LAST,
        updated_at DESC NULLS LAST,
        created_at DESC
      `,
      [product_code, product_unit_id]
    );

    return rows;
  },

  /* ================================================================ */
  /* GET ACTIVE BY UNIT ID                                            */
  /* ================================================================ */
  async getActiveByUnitId(pgPool, product_code, product_unit_id) {
    const { rows } = await pgPool.query(
      `
      SELECT
        ${selectProjection()}
      FROM ${TB_PRODUCTS_BAR_CODE}
      WHERE product_code = $1
        AND product_unit_id = $2
        AND is_active IS TRUE
      ORDER BY
        standard DESC NULLS LAST,
        fator ASC NULLS LAST,
        updated_at DESC NULLS LAST,
        created_at DESC
      LIMIT 1
      `,
      [product_code, product_unit_id]
    );

    return rows[0] || null;
  },

  /* ================================================================ */
  /* GET BY PRODUCT CODE                                              */
  /* ================================================================ */
  async getByProductCode(pgPool, product_code) {
    const { rows } = await pgPool.query(
      `
      SELECT
        ${selectProjection()}
      FROM ${TB_PRODUCTS_BAR_CODE}
      WHERE product_code = $1
      ORDER BY
        is_active DESC,
        standard DESC NULLS LAST,
        fator ASC NULLS LAST,
        updated_at DESC NULLS LAST,
        created_at DESC
      `,
      [product_code]
    );

    return rows;
  },

  /* ================================================================ */
  /* RESOLVE BARCODE                                                  */
  /* ================================================================ */
  async resolve(pgPool, barcodeRaw) {
    const barcode = normalizeBarcode(barcodeRaw);
    if (!barcode) return null;

    const { rows } = await pgPool.query(
      `
      SELECT
        ${selectProjection('b')},
        b.description AS unit_description,
        p.product_id,
        p.description AS product_description,
        p.cost_price,
        p.sale_price,
        p.is_active AS product_is_active
      FROM ${TB_PRODUCTS_BAR_CODE} b
      JOIN public.products p
        ON p.product_code = b.product_code
      WHERE regexp_replace(b.barcode::text, '\\D', '', 'g') = $1
        AND b.is_active IS TRUE
        AND p.is_active IS TRUE
      ORDER BY
        b.standard DESC NULLS LAST,
        b.updated_at DESC NULLS LAST,
        b.created_at DESC
      LIMIT 1
      `,
      [barcode]
    );

    if (!rows[0]) return null;

    // Compatibility: existing consumers expect product description in `description`.
    return {
      ...rows[0],
      description: rows[0].product_description,
    };
  },

  /* ================================================================ */
  /* UPSERT                                                           */
  /* ================================================================ */
  async upsertForUnit(pgPool, payload = {}) {
    const data = normalizeWritePayload(
      {
        ...payload,
        is_active: payload.is_active ?? true,
        standard: payload.standard ?? false,
        fator: payload.fator ?? 1,
      },
      { insert: true }
    );

    if (!data.product_unit_id) {
      throw validationError([
        { field: 'product_unit_id', message: 'product_unit_id is required' },
      ]);
    }

    const client = await pgPool.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `
        SELECT
          ${PK_PRODUCTS_BAR_CODE},
          product_code,
          product_unit_id
        FROM ${TB_PRODUCTS_BAR_CODE}
        WHERE regexp_replace(barcode::text, '\\D', '', 'g') = $1
        LIMIT 1
        FOR UPDATE
        `,
        [data.barcode]
      );

      if (existing.rows.length > 0) {
        const current = existing.rows[0];

        if (
          String(current.product_code) !== String(data.product_code) ||
          Number(current.product_unit_id) !== Number(data.product_unit_id)
        ) {
          const error = new Error(
            `Barcode ${data.barcode} is already linked to another product or unit`
          );

          error.status = 409;
          error.code = 'BARCODE_ALREADY_LINKED';
          error.current = {
            barcode_id: current.barcode_id,
            product_code: current.product_code,
            product_unit_id: current.product_unit_id,
          };

          throw error;
        }

        const { rows } = await client.query(
          `
          UPDATE ${TB_PRODUCTS_BAR_CODE}
             SET product_code = $2,
                 product_unit_id = $3,
                 barcode = $4,
                 barcode_type = $5,
                 is_active = $6,
                 unit = COALESCE(NULLIF($7, ''), unit),
                 fator = COALESCE($8, fator),
                 description = COALESCE(NULLIF($9, ''), description),
                 standard = COALESCE($10, standard),
                 unit_id = COALESCE($11, unit_id),
                 width_cm = COALESCE($12, width_cm),
                 length_cm = COALESCE($13, length_cm),
                 height_cm = COALESCE($14, height_cm),
                 weight_kg = COALESCE($15, weight_kg),
                 updated_at = NOW()
           WHERE ${PK_PRODUCTS_BAR_CODE} = $1
           RETURNING *
          `,
          [
            current.barcode_id,
            data.product_code,
            data.product_unit_id,
            data.barcode,
            data.barcode_type,
            data.is_active,
            data.unit ?? null,
            data.fator ?? null,
            data.description ?? null,
            data.standard ?? null,
            data.unit_id ?? null,
            data.width_cm ?? null,
            data.length_cm ?? null,
            data.height_cm ?? null,
            data.weight_kg ?? null,
          ]
        );

        await client.query('COMMIT');
        return { success: true, updated: true, ...rows[0] };
      }

      const { rows } = await client.query(
        `
        INSERT INTO ${TB_PRODUCTS_BAR_CODE}
        (
          product_code,
          product_unit_id,
          barcode,
          barcode_type,
          is_active,
          unit,
          fator,
          description,
          standard,
          unit_id,
          width_cm,
          length_cm,
          height_cm,
          weight_kg
        )
        VALUES
        (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14
        )
        RETURNING *
        `,
        [
          data.product_code,
          data.product_unit_id,
          data.barcode,
          data.barcode_type,
          data.is_active,
          data.unit ?? null,
          data.fator ?? 1,
          data.description ?? null,
          data.standard ?? false,
          data.unit_id ?? null,
          data.width_cm ?? null,
          data.length_cm ?? null,
          data.height_cm ?? null,
          data.weight_kg ?? null,
        ]
      );

      await client.query('COMMIT');
      return { success: true, created: true, ...rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[productsBarCodeApi.upsertForUnit]', error);
      throw error;
    } finally {
      client.release();
    }
  },

  /* ================================================================ */
  /* UPDATE BY ID                                                     */
  /* ================================================================ */
  async updateById(pgPool, payload = {}) {
    const barcode_id = toPositiveIntegerOrNull(payload.barcode_id ?? payload.id);
    if (!barcode_id) {
      throw validationError([{ field: 'barcode_id', message: 'barcode_id is required' }]);
    }

    const data = normalizeWritePayload(payload, { insert: false });

    const { rows } = await pgPool.query(
      `
      UPDATE ${TB_PRODUCTS_BAR_CODE}
         SET product_code = COALESCE(NULLIF($2, ''), product_code),
             product_unit_id = COALESCE($3, product_unit_id),
             barcode = COALESCE(NULLIF($4, ''), barcode),
             barcode_type = COALESCE(NULLIF($5, ''), barcode_type),
             is_active = COALESCE($6, is_active),
             unit = COALESCE(NULLIF($7, ''), unit),
             fator = COALESCE($8, fator),
             description = COALESCE(NULLIF($9, ''), description),
             standard = COALESCE($10, standard),
             unit_id = COALESCE($11, unit_id),
             width_cm = COALESCE($12, width_cm),
             length_cm = COALESCE($13, length_cm),
             height_cm = COALESCE($14, height_cm),
             weight_kg = COALESCE($15, weight_kg),
             updated_at = NOW()
       WHERE ${PK_PRODUCTS_BAR_CODE} = $1
       RETURNING *
      `,
      [
        barcode_id,
        data.product_code ?? null,
        data.product_unit_id ?? null,
        data.barcode ?? null,
        data.barcode_type ?? null,
        data.is_active ?? null,
        data.unit ?? null,
        data.fator ?? null,
        data.description ?? null,
        data.standard ?? null,
        data.unit_id ?? null,
        data.width_cm ?? null,
        data.length_cm ?? null,
        data.height_cm ?? null,
        data.weight_kg ?? null,
      ]
    );

    return rows[0] || null;
  },

  /* ================================================================ */
  /* SET ACTIVE                                                       */
  /* ================================================================ */
  async setActive(pgPool, { barcode_id, is_active }) {
    const id = toPositiveIntegerOrNull(barcode_id);
    if (!id) {
      throw validationError([{ field: 'barcode_id', message: 'barcode_id is required' }]);
    }

    const activeValue = toBoolean(is_active, true);

    const { rows } = await pgPool.query(
      `
      UPDATE ${TB_PRODUCTS_BAR_CODE}
         SET is_active = $2,
             updated_at = NOW()
       WHERE ${PK_PRODUCTS_BAR_CODE} = $1
       RETURNING
         ${selectProjection()}
      `,
      [id, activeValue]
    );

    return rows[0] || null;
  },

  /* ================================================================ */
  /* ACTIVE UNITS BY PRODUCT                                          */
  /* ================================================================ */
  async getActiveUnitsByProductCode(pgPool, product_code) {
    const { rows } = await pgPool.query(
      `
      SELECT
        ${selectProjection('b')},
        b.description AS unit_description,
        p.product_id,
        p.description AS product_description,
        p.is_active AS product_is_active
      FROM ${TB_PRODUCTS_BAR_CODE} b
      JOIN public.products p
        ON p.product_code = b.product_code
      WHERE b.product_code = $1
        AND b.is_active IS TRUE
        AND p.is_active IS TRUE
      ORDER BY
        b.standard DESC NULLS LAST,
        b.fator ASC NULLS LAST,
        b.unit ASC NULLS LAST
      `,
      [product_code]
    );

    return rows.map((row) => ({
      ...row,
      description: row.product_description,
    }));
  },

  /* ================================================================ */
  /* DELETE BY ID                                                     */
  /* ================================================================ */
  async deleteById(pgPool, barcode_id) {
    const { rows } = await pgPool.query(
      `
    DELETE FROM ${TB_PRODUCTS_BAR_CODE}
    WHERE ${PK_PRODUCTS_BAR_CODE} = $1
    RETURNING *
    `,
      [barcode_id]
    );

    return rows[0] || null;
  },

  /* ================================================================ */
  /* FACTORS BY PRODUCT CODES                                         */
  /* ================================================================ */
  async getFactorsByProductCodes(pgPool, productCodes = []) {
    if (!Array.isArray(productCodes) || !productCodes.length) {
      return [];
    }

    const { rows } = await pgPool.query(
      `
    SELECT DISTINCT ON (
      product_code,
      COALESCE(unit, '')
    )
      product_code,
      product_code AS sku,
      COALESCE(unit, '') AS unit,
      COALESCE(fator, 1) AS factor,
      COALESCE(fator, 1) AS fator,
      COALESCE(standard, FALSE) AS standard
    FROM ${TB_PRODUCTS_BAR_CODE}
    WHERE is_active IS TRUE
      AND product_code = ANY($1::text[])
    ORDER BY
      product_code,
      COALESCE(unit, ''),
      COALESCE(standard, FALSE) DESC,
      barcode_id ASC
    `,
      [productCodes]
    );

    return rows;
  },
};

export default productsBarCodeApi;