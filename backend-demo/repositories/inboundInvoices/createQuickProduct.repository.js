// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ createQuickProduct.repository.js — CONSART ERP | Notas de Entrada       ║
// ║ Cadastro rápido de produto a partir de um item da NF-e                   ║
// ║ Numa transação: produto + estoque + lote inicial + vínculo productsLmRef ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

import { pool, TB_PRODUCTS_LM_REF } from './_shared.js';
import {
  PRODUCTS_TABLE,
  prepareProductInsert,
} from '../products/products.catalog.js';

const TB_STOCK = 'public."productsStock"';
const TB_LOTS = 'public."productsStockLots"';
const DEFAULT_LOT_CODE = 'LOTE PADRÃO';

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function httpError(status, code, message, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

async function resolveSupplierId(client, { supplierId, issuerTaxId }) {
  const direct = positiveInteger(supplierId);
  if (direct) return direct;

  const taxId = onlyDigits(issuerTaxId);
  if (!taxId) return null;

  const { rows } = await client.query(
    `
      SELECT supplier_id
        FROM public."suppliers"
       WHERE regexp_replace(tax_id, '\\D', '', 'g') = $1
       LIMIT 1
    `,
    [taxId],
  );

  return rows[0]?.supplier_id ?? null;
}

// EAN já usado por outro produto: o certo é vincular pela lupa.
async function assertBarcodeFree(client, barcode) {
  const digits = onlyDigits(barcode);
  if (!digits) return;

  const { rows } = await client.query(
    `
      SELECT product_code, description
        FROM ${PRODUCTS_TABLE}
       WHERE regexp_replace(COALESCE(barcode, ''), '\\D', '', 'g') = $1
         AND is_active IS TRUE
       LIMIT 1
    `,
    [digits],
  );

  if (rows[0]) {
    throw httpError(
      409,
      'QUICK_PRODUCT_BARCODE_IN_USE',
      `O código de barras ${digits} já pertence ao produto ${rows[0].product_code} — ${rows[0].description}. Use a lupa para vincular.`,
      { product_code: rows[0].product_code },
    );
  }
}

async function upsertLmRef(client, { supplierId, nfProductCode, productCode, description }) {
  const { rows: existing } = await client.query(
    `
      SELECT product_lm_ref_id
        FROM ${TB_PRODUCTS_LM_REF}
       WHERE supplier_id = $1
         AND BTRIM(nf_product_code) = $2
       ORDER BY is_active DESC, product_lm_ref_id DESC
       LIMIT 1
       FOR UPDATE
    `,
    [supplierId, nfProductCode],
  );

  if (existing[0]) {
    const { rows } = await client.query(
      `
        UPDATE ${TB_PRODUCTS_LM_REF}
           SET product_code = $2,
               description = $3,
               is_active = TRUE,
               updated_at = NOW()
         WHERE product_lm_ref_id = $1
         RETURNING product_lm_ref_id
      `,
      [existing[0].product_lm_ref_id, productCode, description],
    );
    return rows[0]?.product_lm_ref_id ?? null;
  }

  const { rows } = await client.query(
    `
      INSERT INTO ${TB_PRODUCTS_LM_REF} (
        supplier_id, nf_product_code, product_code, description, is_active
      )
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING product_lm_ref_id
    `,
    [supplierId, nfProductCode, productCode, description],
  );
  return rows[0]?.product_lm_ref_id ?? null;
}

/**
 * Cria o produto vindo de um item da NF-e de entrada.
 *
 * @param {object} payload
 *   Produto: description, barcode, manufacturer_ref, cost_price,
 *            product_group_id, product_subgroup_id, manufacturer_id
 *   Fornecedor: supplier_id ou issuer_tax_id (CNPJ do emitente)
 *   Vínculo:  nf_product_code (cProd do fornecedor)
 *   Lote:     create_lot, lot_code, expires_at, nfe_key, nfe_item_seq
 */
export async function createQuickProduct(payload = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const supplierId = await resolveSupplierId(client, {
      supplierId: payload.supplier_id,
      issuerTaxId: payload.issuer_tax_id,
    });

    const prepared = prepareProductInsert({
      description: textOrNull(payload.description),
      barcode: textOrNull(payload.barcode),
      manufacturer_ref: textOrNull(payload.manufacturer_ref),
      cost_price: numberOrNull(payload.cost_price) ?? 0,
      product_group_id: positiveInteger(payload.product_group_id),
      product_subgroup_id: positiveInteger(payload.product_subgroup_id),
      manufacturer_id: positiveInteger(payload.manufacturer_id),
      supplier_id: supplierId,
      is_active: true,
    });

    if (!prepared.valid) {
      throw httpError(
        400,
        'QUICK_PRODUCT_VALIDATION',
        prepared.errors.map(({ message }) => message).join('; '),
        prepared.errors,
      );
    }

    await assertBarcodeFree(client, prepared.data.barcode);

    // product_code omitido → gerado por trg_products_autogen_code.
    const columns = Object.keys(prepared.data);
    const values = Object.values(prepared.data);
    const { rows: productRows } = await client.query(
      `
        INSERT INTO ${PRODUCTS_TABLE} (${columns.join(', ')})
        VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})
        RETURNING product_id, product_code, description, barcode,
                  manufacturer_ref, cost_price, supplier_id
      `,
      values,
    );
    const product = productRows[0];

    const { rows: stockRows } = await client.query(
      `
        INSERT INTO ${TB_STOCK} (stock_qty, stock_min, stock_max)
        VALUES (0, 0, 0)
        RETURNING product_stock_id
      `,
    );
    const productStockId = stockRows[0].product_stock_id;

    await client.query(
      `
        UPDATE ${PRODUCTS_TABLE}
           SET product_stock_id = $1,
               updated_at = NOW()
         WHERE product_id = $2
      `,
      [productStockId, product.product_id],
    );

    // Lote vazio (saldo 0): a postagem da NF-e é quem dá entrada na quantidade.
    let lot = null;
    if (payload.create_lot) {
      const { rows: lotRows } = await client.query(
        `
          INSERT INTO ${TB_LOTS} (
            product_stock_id,
            product_grade_id,
            lot_code,
            expires_at,
            qty_on_hand,
            qty_reserved,
            cost_unit,
            nfe_key,
            nfe_item_seq,
            is_active,
            deleted_at
          )
          VALUES ($1, NULL, $2, $3::date, 0, 0, $4, $5, $6, TRUE, NULL)
          RETURNING lot_id, lot_code, expires_at
        `,
        [
          productStockId,
          textOrNull(payload.lot_code) || DEFAULT_LOT_CODE,
          textOrNull(payload.expires_at)?.slice(0, 10) || null,
          numberOrNull(payload.cost_price),
          textOrNull(payload.nfe_key),
          positiveInteger(payload.nfe_item_seq),
        ],
      );
      lot = lotRows[0] || null;
    }

    // Próximas NF-e desse fornecedor já chegam com o produto vinculado.
    const nfProductCode = textOrNull(payload.nf_product_code);
    const productLmRefId = supplierId && nfProductCode
      ? await upsertLmRef(client, {
        supplierId,
        nfProductCode,
        productCode: product.product_code,
        description: product.description,
      })
      : null;

    await client.query('COMMIT');

    return {
      ...product,
      product_stock_id: productStockId,
      lot_id: lot?.lot_id ?? null,
      lot_code: lot?.lot_code ?? null,
      expires_at: lot?.expires_at ?? null,
      product_lm_ref_id: productLmRefId,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export default createQuickProduct;
