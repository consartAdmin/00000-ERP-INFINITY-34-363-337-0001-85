// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsApi.js — Backend Products Service — ESM                    ║
// ║ CONSART ERP | PostgreSQL                                            ║
// ║ Sem req/res, window, fetch, FormData ou regras de apresentação      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../../config/db.js';

import {
    PRODUCTS_TABLE,
    PRODUCTS_SCHEMA,
    prepareProductInsert,
    prepareProductUpdate,
} from '../../../repositories/products/products.catalog.js';

const TABLE_STOCK = 'public."productsStock"';
const TABLE_PRICES = 'public."productsPrices"';
const TABLE_IMAGES = 'public."productsImages"';
const TABLE_BARCODES = 'public."productsBarCode"';
const TABLE_LOCATIONS = 'public."productsLocations"';
const TABLE_LOTS = 'public."productsStockLots"';
const TABLE_INBOUND_ITEMS = 'public."inboundInvoiceItems"';
const TABLE_FISCAL_V2 = 'public."productsFiscalV2"';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
const configuredRetailPriceId = Number(process.env.PRICE_TABLE_VAREJO_ID || 1);
const VAREJO_PRICE_ID = Number.isInteger(configuredRetailPriceId) && configuredRetailPriceId > 0
    ? configuredRetailPriceId
    : 1;

const SORT_COLUMNS = new Set(PRODUCTS_SCHEMA.selectColumns);

export class ProductsApiError extends Error {
    constructor(message, { code = 'PRODUCTS_API_ERROR', status = 500, details } = {}) {
        super(message);
        this.name = 'ProductsApiError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function requiredProductCode(value) {
    const code = String(value ?? '').trim();
    if (!code) {
        throw new ProductsApiError('product_code é obrigatório.', {
            code: 'INVALID_PRODUCT_CODE',
            status: 400,
        });
    }
    return code;
}

function positiveInteger(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeNumber(value) {
    if (value === undefined || value === null || value === '') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : value;

    const text = String(value).trim();
    if (!text) return value;

    const normalized = text.includes(',')
        ? text.replace(/\./g, '').replace(',', '.')
        : text;

    const number = Number(normalized);
    return Number.isFinite(number) ? number : value;
}

function normalizeInput(payload = {}) {
    return {
        ...payload,
        ...(Object.prototype.hasOwnProperty.call(payload, 'cost_price')
            ? { cost_price: normalizeNumber(payload.cost_price) }
            : {}),
    };
}

function normalizePgError(error) {
    if (error instanceof ProductsApiError) return error;

    if (error?.code === '23505') {
        return new ProductsApiError('O product_code informado já existe.', {
            code: 'PRODUCT_CODE_CONFLICT',
            status: 409,
            details: error.detail,
        });
    }

    if (error?.code === '23503') {
        return new ProductsApiError('Uma referência vinculada ao produto é inválida.', {
            code: 'PRODUCT_FOREIGN_KEY_ERROR',
            status: 409,
            details: error.detail,
        });
    }

    return error;
}

function throwValidation(errors) {
    throw new ProductsApiError('Dados do produto inválidos.', {
        code: 'PRODUCT_VALIDATION_ERROR',
        status: 400,
        details: errors,
    });
}

function buildLocationExpression(alias = 'pl') {
    return `
    NULLIF(
      CONCAT_WS(' / ',
        NULLIF(TRIM(${alias}.corredor), ''),
        NULLIF(TRIM(${alias}.prateleira), ''),
        NULLIF(TRIM(${alias}.bandeja), ''),
        NULLIF(TRIM(${alias}.box), '')
      ),
      ''
    )
  `;
}

function coreSelectSql(whereSql, orderSql, pageSql = '') {
    return `
    SELECT
      p.*,
      pi.image_url,
      pi.image_path,
      COALESCE(ps.stock_qty, 0) AS stock_qty,
      pp.sale_price AS price_varejo,
      loc.location_description,
      EXISTS (
        SELECT 1
        FROM ${TABLE_FISCAL_V2} pf
        WHERE pf.product_code = p.product_code
          AND pf.is_current IS TRUE
          AND pf.is_active IS TRUE
          AND pf.effective_from <= CURRENT_TIMESTAMP
          AND (pf.effective_to IS NULL OR pf.effective_to > CURRENT_TIMESTAMP)
      ) AS has_fiscal_product
    FROM ${PRODUCTS_TABLE} p
    LEFT JOIN ${TABLE_STOCK} ps
      ON ps.product_stock_id = p.product_stock_id
    LEFT JOIN ${TABLE_PRICES} pp
      ON pp.product_code = p.product_code
     AND pp.price_id = ${VAREJO_PRICE_ID}
    LEFT JOIN LATERAL (
      SELECT img.image_url, img.image_path
      FROM ${TABLE_IMAGES} img
      WHERE img.product_code = p.product_code
        AND img.is_active IS TRUE
      ORDER BY
        (img.barcode_id IS NULL) DESC,
        img.is_primary DESC,
        img.position ASC,
        img.product_image_id ASC
      LIMIT 1
    ) pi ON TRUE
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(
        DISTINCT ${buildLocationExpression('pl')},
        ' | ' ORDER BY ${buildLocationExpression('pl')}
      ) AS location_description
      FROM ${TABLE_LOCATIONS} pl
      WHERE pl.product_code = p.product_code
        AND pl.is_active IS TRUE
    ) loc ON TRUE
    ${whereSql}
    ${orderSql}
    ${pageSql}
  `;
}

export async function list(options = {}) {
    const page = positiveInteger(options.page, 1);
    const limit = Math.min(positiveInteger(options.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = (page - 1) * limit;
    const sort = SORT_COLUMNS.has(options.sort) ? options.sort : 'product_code';
    const direction = String(options.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const where = [];
    const values = [];
    const add = (sql, value) => {
        values.push(value);
        where.push(sql.replace('?', `$${values.length}`));
    };

    if (options.active === true || options.active === false) {
        add('p.is_active = ?', options.active);
    } else if (options.active === 'true' || options.active === 'false') {
        add('p.is_active = ?', options.active === 'true');
    }

    const status = String(options.status ?? '').trim().toLowerCase();
    if (status === 'ativo') where.push('p.is_active IS TRUE');
    if (status === 'inativo') where.push('p.is_active IS FALSE');

    const q = String(options.q ?? '').trim();
    if (q) {
        values.push(`%${q}%`);
        const placeholder = `$${values.length}`;
        where.push(`(
      p.product_code ILIKE ${placeholder}
      OR p.description ILIKE ${placeholder}
      OR p.barcode ILIKE ${placeholder}
      OR p.manufacturer_ref ILIKE ${placeholder}
      OR EXISTS (
        SELECT 1 FROM ${TABLE_BARCODES} pb
        WHERE pb.product_code = p.product_code
          AND pb.is_active IS TRUE
          AND pb.barcode ILIKE ${placeholder}
      )
    )`);
    }

    const filters = [
        ['manufacturer_id', 'p.manufacturer_id'],
        ['supplier_id', 'p.supplier_id'],
        ['group_id', 'p.product_group_id'],
        ['subgroup_id', 'p.product_subgroup_id'],
    ];

    for (const [input, column] of filters) {
        const value = positiveInteger(options[input]);
        if (value !== null) add(`${column} = ?`, value);
    }

    // stock=with → saldo > 0 | stock=without → saldo <= 0 (inclui negativos)
    // Subquery (e não o JOIN de ps) para valer também no countSql.
    const stock = String(options.stock ?? '').trim().toLowerCase();
    if (stock === 'with' || stock === 'without') {
        where.push(`COALESCE((
      SELECT ps_f.stock_qty FROM ${TABLE_STOCK} ps_f
      WHERE ps_f.product_stock_id = p.product_stock_id
    ), 0) ${stock === 'with' ? '>' : '<='} 0`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listSql = coreSelectSql(
        whereSql,
        `ORDER BY p.${sort} ${direction}`,
        `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    );
    const countSql = `SELECT COUNT(*)::int AS total FROM ${PRODUCTS_TABLE} p ${whereSql}`;

    const [rowsResult, countResult] = await Promise.all([
        pool.query(listSql, [...values, limit, offset]),
        pool.query(countSql, values),
    ]);

    return {
        page,
        limit,
        total: countResult.rows[0]?.total ?? 0,
        rows: rowsResult.rows,
    };
}

export async function search(options = {}) {
    return list({
        ...options,
        active: options.active ?? true,
    });
}

export async function getByCode(productCode, { client = pool } = {}) {
    const code = requiredProductCode(productCode);

    const { rows } = await client.query(
        `
      SELECT
        p.*,
        COALESCE(ps.stock_qty, 0) AS stock_qty,
        COALESCE(ps.stock_min, 0) AS stock_min,
        COALESCE(ps.stock_max, 0) AS stock_max,
        loc.location_description,
        COALESCE(lots_data.lots, '[]'::jsonb) AS lots
      FROM ${PRODUCTS_TABLE} p
      LEFT JOIN ${TABLE_STOCK} ps
        ON ps.product_stock_id = p.product_stock_id
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(
          DISTINCT ${buildLocationExpression('pl')},
          ' | ' ORDER BY ${buildLocationExpression('pl')}
        ) AS location_description
        FROM ${TABLE_LOCATIONS} pl
        WHERE pl.product_code = p.product_code
          AND pl.is_active IS TRUE
      ) loc ON TRUE
      LEFT JOIN LATERAL (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'lot_id', psl.lot_id,
            'product_stock_id', psl.product_stock_id,
            'product_grade_id', psl.product_grade_id,
            'lot_code', psl.lot_code,
            'expires_at', psl.expires_at,
            'qty_on_hand', psl.qty_on_hand,
            'qty_reserved', psl.qty_reserved,
            'qty_available', GREATEST(
              COALESCE(psl.qty_on_hand, 0) - COALESCE(psl.qty_reserved, 0), 0
            ),
            'cost_unit', psl.cost_unit,
            'supplier_id', psl.supplier_id,
            'nfe_key', psl.nfe_key,
            'nfe_item_seq', psl.nfe_item_seq,
            'is_active', psl.is_active,
            'created_at', psl.created_at,
            'updated_at', psl.updated_at,
            'inbound_item_id', inbound_data.inbound_item_id,
            'inbound_invoice_id', inbound_data.inbound_id,
            'inbound_quantity', inbound_data.quantity,
            'supplier_product_code', inbound_data.nf_product_code,
            'icms_cst', inbound_data.icms_cst,
            'icms_base', inbound_data.icms_base,
            'icms_rate', inbound_data.icms_rate,
            'icms_value', inbound_data.icms,
            'icms_st_base', inbound_data.icms_st_base,
            'icms_st_rate', inbound_data.icms_st_rate,
            'icms_st_value', inbound_data.icms_st_value
          ) ORDER BY psl.expires_at ASC NULLS LAST, psl.lot_id ASC
        ) AS lots
        FROM ${TABLE_LOTS} psl
        LEFT JOIN LATERAL (
          SELECT iii.*
          FROM ${TABLE_INBOUND_ITEMS} iii
          WHERE iii.lot_id = psl.lot_id
            AND iii.product_code = p.product_code
          ORDER BY iii.inbound_item_id DESC
          LIMIT 1
        ) inbound_data ON TRUE
        WHERE psl.product_stock_id = ps.product_stock_id
          AND psl.deleted_at IS NULL
      ) lots_data ON TRUE
      WHERE p.product_code = $1
      LIMIT 1
    `,
        [code],
    );

    if (!rows.length) {
        throw new ProductsApiError('Produto não encontrado.', {
            code: 'PRODUCT_NOT_FOUND',
            status: 404,
        });
    }

    return rows[0];
}

export async function create(payload = {}) {
    const prepared = prepareProductInsert(normalizeInput(payload));
    if (!prepared.valid) throwValidation(prepared.errors);

    const data = prepared.data;
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, index) => `$${index + 1}`);

    const sql = columns.length
        ? `
        INSERT INTO ${PRODUCTS_TABLE} (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING ${PRODUCTS_SCHEMA.selectProjection}
      `
        : `
        INSERT INTO ${PRODUCTS_TABLE} DEFAULT VALUES
        RETURNING ${PRODUCTS_SCHEMA.selectProjection}
      `;

    try {
        const { rows } = await pool.query(sql, values);
        return rows[0];
    } catch (error) {
        throw normalizePgError(error);
    }
}

async function upsertLocation(client, productCode, location = {}) {
    const fields = ['corredor', 'prateleira', 'bandeja', 'box'];
    const hasLocation = fields.some((field) => {
        const value = location[field];
        return value !== undefined && value !== null && String(value).trim() !== '';
    });

    if (!hasLocation) return null;

    const storeId = positiveInteger(location.store_id ?? location.local_id, 6);
    const values = fields.map((field) => {
        const value = location[field];
        return value === undefined || value === null || String(value).trim() === ''
            ? null
            : String(value).trim();
    });

    const existing = await client.query(
        `
      SELECT id
      FROM ${TABLE_LOCATIONS}
      WHERE product_code = $1
        AND store_id = $2
        AND COALESCE(corredor, '') = COALESCE($3, '')
        AND COALESCE(prateleira, '') = COALESCE($4, '')
        AND COALESCE(bandeja, '') = COALESCE($5, '')
        AND COALESCE(box, '') = COALESCE($6, '')
      ORDER BY is_active DESC, updated_at DESC
      LIMIT 1
    `,
        [productCode, storeId, ...values],
    );

    let locationId = existing.rows[0]?.id;

    if (!locationId) {
        const inserted = await client.query(
            `
        INSERT INTO ${TABLE_LOCATIONS}
          (product_code, store_id, corredor, prateleira, bandeja, box, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING id
      `,
            [productCode, storeId, ...values],
        );
        locationId = inserted.rows[0].id;
    }

    await client.query(
        `
      UPDATE ${TABLE_LOCATIONS}
      SET is_active = (id = $2),
          updated_at = NOW()
      WHERE product_code = $1
    `,
        [productCode, locationId],
    );

    await client.query(
        `
      UPDATE ${PRODUCTS_TABLE}
      SET product_location_id = $1,
          updated_at = NOW()
      WHERE product_code = $2
    `,
        [locationId, productCode],
    );

    return Number(locationId);
}

export async function updateByCode(currentProductCode, payload = {}) {
    const currentCode = requiredProductCode(currentProductCode);
    const prepared = prepareProductUpdate(normalizeInput(payload));
    if (!prepared.valid) throwValidation(prepared.errors);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const data = prepared.data;
        const columns = Object.keys(data);
        const values = Object.values(data);
        const setSql = columns.map((column, index) => `${column} = $${index + 1}`);
        setSql.push('updated_at = NOW()');
        values.push(currentCode);

        const { rows } = await client.query(
            `
        UPDATE ${PRODUCTS_TABLE}
        SET ${setSql.join(', ')}
        WHERE product_code = $${values.length}
        RETURNING ${PRODUCTS_SCHEMA.selectProjection}
      `,
            values,
        );

        if (!rows.length) {
            throw new ProductsApiError('Produto não encontrado.', {
                code: 'PRODUCT_NOT_FOUND',
                status: 404,
            });
        }

        const updated = rows[0];
        const locationId = await upsertLocation(client, updated.product_code, payload);

        await client.query('COMMIT');
        return locationId === null
            ? updated
            : { ...updated, product_location_id: locationId, realLocationId: locationId };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* noop */ }
        throw normalizePgError(error);
    } finally {
        client.release();
    }
}

export async function softDeleteByCode(productCode) {
    return setActiveByCode(productCode, false);
}

export async function restoreByCode(productCode) {
    return setActiveByCode(productCode, true);
}

async function setActiveByCode(productCode, isActive) {
    const code = requiredProductCode(productCode);
    const { rows } = await pool.query(
        `
      UPDATE ${PRODUCTS_TABLE}
      SET is_active = $1,
          updated_at = NOW()
      WHERE product_code = $2
      RETURNING ${PRODUCTS_SCHEMA.selectProjection}
    `,
        [isActive, code],
    );

    if (!rows.length) {
        throw new ProductsApiError('Produto não encontrado.', {
            code: 'PRODUCT_NOT_FOUND',
            status: 404,
        });
    }

    return rows[0];
}

export async function updateBarcodeByCode(productCode, barcode) {
    const code = requiredProductCode(productCode);
    const cleanBarcode = barcode === null || barcode === undefined
        ? null
        : String(barcode).trim().replace(/[^\d]/g, '');

    const { rows } = await pool.query(
        `
      UPDATE ${PRODUCTS_TABLE}
      SET barcode = $1,
          updated_at = NOW()
      WHERE product_code = $2
      RETURNING ${PRODUCTS_SCHEMA.selectProjection}
    `,
        [cleanBarcode || null, code],
    );

    if (!rows.length) {
        throw new ProductsApiError('Produto não encontrado.', {
            code: 'PRODUCT_NOT_FOUND',
            status: 404,
        });
    }

    return rows[0];
}

export async function getCostMap(codes = []) {
    const normalized = Array.isArray(codes)
        ? [...new Set(codes.map((value) => String(value).trim()).filter(Boolean))]
        : [];

    if (!normalized.length) return {};

    const { rows } = await pool.query(
        `
      SELECT product_code, cost_price
      FROM ${PRODUCTS_TABLE}
      WHERE product_code = ANY($1::text[])
    `,
        [normalized],
    );

    return Object.fromEntries(rows.map((row) => [
        String(row.product_code),
        Number(row.cost_price || 0),
    ]));
}

export const productsApi = Object.freeze({
    list,
    search,
    getByCode,
    create,
    updateByCode,
    softDeleteByCode,
    restoreByCode,
    updateBarcodeByCode,
    getCostMap,
});

export default productsApi;
