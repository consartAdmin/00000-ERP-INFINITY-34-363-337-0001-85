// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsFiscalOriginsApi.js — Origem fiscal do produto               ║
// ║ CONSART ERP — ESM                                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// Persiste os valores fiscais calculados pela regra fiscal do produto para
// que a emissão de NF-e não dependa de "inboundInvoiceItems".
//
// A única fonte de cálculo é calculateForProduct(), que resolve a hierarquia
// "productsFiscalV2" -> "fiscalClassificationV2" -> "fiscalProfileV2" e
// nunca consulta NF-e de entrada.

'use strict';

import pool from '../../../config/db.js';
import { calculateForProduct } from '../productFiscalCostRules/productFiscalCostRulesApi.js';

import PRODUCTS_FISCAL_ORIGINS_SCHEMA, {
  PRODUCTS_FISCAL_ORIGINS_TABLE,
  PRODUCTS_FISCAL_ORIGINS_ST_COLUMNS,
  PRODUCTS_FISCAL_ORIGINS_NULL_SCOPE,
  DDL,
  DDL_INDEXES,
} from './catalog_schema.productsFiscalOrigins.js';

const TB = PRODUCTS_FISCAL_ORIGINS_TABLE;
const SELECT_COLUMNS = PRODUCTS_FISCAL_ORIGINS_SCHEMA.selectProjection;
const ST_PROJECTION = PRODUCTS_FISCAL_ORIGINS_ST_COLUMNS.join(',\n      ');

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function clean(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function toNullableNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeCst(value) {
  const text = clean(value);
  if (!text) return null;

  const digits = text.replace(/\D/g, '');
  if (!digits) return null;

  // CST de ICMS tem 2 dígitos; CSOSN tem 3. Preserva o que veio da regra.
  return digits.length <= 2 ? digits.padStart(2, '0') : digits.slice(0, 3);
}

/* ========================================================================== */
/* DDL                                                                        */
/* ========================================================================== */

let ensured = false;

export async function ensureProductsFiscalOriginsTable(client = pool) {
  await client.query(DDL);

  for (const statement of DDL_INDEXES) {
    await client.query(statement);
  }
}

/**
 * Garante a tabela uma única vez por processo.
 * Em caso de falha o flag não é marcado, para que a próxima chamada tente
 * novamente em vez de quebrar silenciosamente.
 */
async function ensureOnce(client = pool) {
  if (ensured) return;

  await ensureProductsFiscalOriginsTable(client);
  ensured = true;
}

/* ========================================================================== */
/* Leitura                                                                    */
/* ========================================================================== */

export async function getById(fiscalOriginId, client = pool) {
  const id = positiveInteger(fiscalOriginId);
  if (!id) throw new Error('fiscal_origin_id inválido.');

  await ensureOnce(client);

  const { rows } = await client.query(
    `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TB}
      WHERE fiscal_origin_id = $1
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function getByProduct(productCode, client = pool) {
  const code = clean(productCode);
  if (!code) throw new Error('product_code é obrigatório.');

  await ensureOnce(client);

  const { rows } = await client.query(
    `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TB}
      WHERE TRIM(product_code) = $1
        AND is_active = TRUE
      ORDER BY
        lot_id NULLS LAST,
        product_grade_id NULLS LAST,
        calculated_at DESC
    `,
    [code],
  );

  return rows;
}

/**
 * Origem fiscal aplicável a um item, na ordem de especificidade:
 *
 *   1) lote + grade exatos
 *   2) lote, qualquer grade
 *   3) sem lote + grade exata   (padrão do produto para aquela grade)
 *   4) sem lote, qualquer grade (padrão do produto)
 *
 * O item 3/4 é o que atende STOCK_SIMPLE, onde não existe lot_id.
 *
 * As colunas retornadas têm exatamente os mesmos nomes de
 * "inboundInvoiceItems", de modo que nfeIssuanceApi possa reaproveitar
 * normalizeInboundIcmsSt() sobre esta linha.
 */
export async function resolveForItem(
  {
    productCode,
    lotId = null,
    productGradeId = null,
  } = {},
  client = pool,
) {
  const code = clean(productCode);
  if (!code) throw new Error('product_code é obrigatório.');

  await ensureOnce(client);

  const lot = positiveInteger(lotId);
  const grade = positiveInteger(productGradeId);

  const { rows } = await client.query(
    `
      SELECT
        ${ST_PROJECTION}
      FROM ${TB}
      WHERE TRIM(product_code) = $1
        AND is_active = TRUE
        AND (lot_id IS NULL OR lot_id = $2::integer)
      ORDER BY
        -- Mais específico primeiro: o lote exato ganha da origem padrão.
        CASE WHEN lot_id IS NOT NULL THEN 0 ELSE 1 END,

        /*
         * A grade é PREFERÊNCIA, nunca filtro — mesma convenção do
         * resolvedor de inboundInvoiceItems.
         *
         * Os itens do orçamento carregam grade_id (catálogo de grades),
         * não product_grade_id (vínculo produto x grade), então filtrar por
         * product_grade_id descartaria origens válidas.
         */
        CASE
          WHEN $3::integer IS NOT NULL
           AND product_grade_id = $3::integer
          THEN 0
          WHEN product_grade_id IS NULL
          THEN 1
          ELSE 2
        END,

        -- Origens com ICMS-ST completo vêm à frente.
        CASE
          WHEN icms_st_base IS NOT NULL
           AND icms_st_rate IS NOT NULL
           AND icms_st_value IS NOT NULL
          THEN 0
          ELSE 1
        END,

        calculated_at DESC,
        fiscal_origin_id DESC
      LIMIT 1
    `,
    [code, lot, grade],
  );

  return rows[0] || null;
}

/* ========================================================================== */
/* Gravação                                                                   */
/* ========================================================================== */

/**
 * Calcula a origem fiscal pela regra do produto e grava (upsert) na tabela.
 *
 * Os valores são gravados POR UNIDADE (quantity = 1), independentemente da
 * quantidade do lote: a proporção para a quantidade vendida é aplicada na
 * emissão, por calculateRetainedIcmsSt().
 */
export async function upsertFromFiscalRule(
  {
    productCode,
    lotId = null,
    productGradeId = null,
    productId = null,
    unit = null,
    unitCost = null,
    notes = null,
    userId = null,
  } = {},
  client = pool,
) {
  const code = clean(productCode);
  if (!code) throw new Error('product_code é obrigatório.');

  await ensureOnce(client);

  // quantity = 1 -> calculateForProduct devolve os valores unitários já nos
  // campos totais, que é exatamente a convenção desta tabela.
  const calculation = await calculateForProduct(
    code,
    {
      unitCost,
      quantity: 1,
    },
    client,
  );

  if (!calculation?.ok) {
    throw new Error(
      `SKU ${code}: não foi possível calcular a origem fiscal pela regra do produto.`,
    );
  }

  const perUnit = calculation.fiscal_per_unit || {};

  const payload = {
    source: 'PRODUCT_FISCAL_RULE',
    source_label: calculation.source_label ?? 'Regra fiscal do produto',
    calculated_from: 'productsFiscalV2',
    calculation,
  };

  const values = [
    code,                                                   // $1
    positiveInteger(productId),                             // $2
    positiveInteger(productGradeId),                        // $3
    positiveInteger(lotId),                                 // $4
    clean(unit),                                            // $5
    toNullableNumber(calculation.unit_cost),                // $6
    normalizeCst(calculation.inbound_cst),                  // $7
    toNullableNumber(perUnit.icms_base ?? calculation.icms_base),     // $8
    toNullableNumber(calculation.icms_rate),                // $9
    toNullableNumber(perUnit.icms_value ?? calculation.icms_value),   // $10
    toNullableNumber(calculation.mva_pct),                  // $11
    toNullableNumber(perUnit.icms_st_base ?? calculation.icms_st_base),   // $12
    toNullableNumber(calculation.icms_st_rate),             // $13
    toNullableNumber(perUnit.icms_st_value ?? calculation.icms_st_value), // $14
    toNullableNumber(calculation.ipi_rate),                 // $15
    toNullableNumber(calculation.pis_rate),                 // $16
    toNullableNumber(calculation.cofins_rate),              // $17
    positiveInteger(calculation.rule_id),                   // $18
    clean(calculation.rule_source),                         // $19
    clean(calculation.calculation_mode),                    // $20
    positiveInteger(calculation.products_fiscal_id),        // $21
    positiveInteger(calculation.fiscal_classification_id),  // $22
    positiveInteger(calculation.fiscal_profile_id),         // $23
    JSON.stringify(payload),                                // $24
    clean(notes),                                           // $25
    positiveInteger(userId),                                // $26
  ];

  const { rows } = await client.query(
    `
      INSERT INTO ${TB} AS target (
        product_code,
        product_id,
        product_grade_id,
        lot_id,
        unit,
        quantity,
        conversion_factor,
        unit_cost,
        icms_cst,
        icms_base,
        icms_rate,
        icms_value,
        icms_st_mva_rate,
        icms_st_base,
        icms_st_rate,
        icms_st_value,
        ipi_rate,
        pis_rate,
        cofins_rate,
        source,
        rule_id,
        rule_source,
        calculation_mode,
        products_fiscal_id,
        fiscal_classification_id,
        fiscal_profile_id,
        raw_tax_payload,
        notes,
        is_active,
        calculated_at,
        user_id
      )
      VALUES (
        $1, $2, $3, $4, $5,
        1, 1,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17,
        'PRODUCT_FISCAL_RULE',
        $18, $19, $20, $21, $22, $23,
        $24::jsonb, $25,
        TRUE, NOW(), $26
      )
      ON CONFLICT (
        product_code,
        COALESCE(lot_id, ${PRODUCTS_FISCAL_ORIGINS_NULL_SCOPE}),
        COALESCE(product_grade_id, ${PRODUCTS_FISCAL_ORIGINS_NULL_SCOPE})
      )
      WHERE is_active = TRUE
      DO UPDATE SET
        product_id               = EXCLUDED.product_id,
        unit                     = EXCLUDED.unit,
        quantity                 = EXCLUDED.quantity,
        conversion_factor        = EXCLUDED.conversion_factor,
        unit_cost                = EXCLUDED.unit_cost,
        icms_cst                 = EXCLUDED.icms_cst,
        icms_base                = EXCLUDED.icms_base,
        icms_rate                = EXCLUDED.icms_rate,
        icms_value               = EXCLUDED.icms_value,
        icms_st_mva_rate         = EXCLUDED.icms_st_mva_rate,
        icms_st_base             = EXCLUDED.icms_st_base,
        icms_st_rate             = EXCLUDED.icms_st_rate,
        icms_st_value            = EXCLUDED.icms_st_value,
        ipi_rate                 = EXCLUDED.ipi_rate,
        pis_rate                 = EXCLUDED.pis_rate,
        cofins_rate              = EXCLUDED.cofins_rate,
        source                   = EXCLUDED.source,
        rule_id                  = EXCLUDED.rule_id,
        rule_source              = EXCLUDED.rule_source,
        calculation_mode         = EXCLUDED.calculation_mode,
        products_fiscal_id       = EXCLUDED.products_fiscal_id,
        fiscal_classification_id = EXCLUDED.fiscal_classification_id,
        fiscal_profile_id        = EXCLUDED.fiscal_profile_id,
        raw_tax_payload          = EXCLUDED.raw_tax_payload,
        notes                    = COALESCE(EXCLUDED.notes, target.notes),
        calculated_at            = EXCLUDED.calculated_at,
        updated_at               = NOW(),
        user_id                  = COALESCE(EXCLUDED.user_id, target.user_id)
      RETURNING
        ${SELECT_COLUMNS}
    `,
    values,
  );

  return {
    ok: true,
    row: rows[0] || null,
    calculation,
  };
}

/** Soft delete: libera o escopo para uma nova origem ativa. */
export async function remove(fiscalOriginId, client = pool) {
  const id = positiveInteger(fiscalOriginId);
  if (!id) throw new Error('fiscal_origin_id inválido.');

  await ensureOnce(client);

  const { rows } = await client.query(
    `
      UPDATE ${TB}
         SET is_active  = FALSE,
             updated_at = NOW()
       WHERE fiscal_origin_id = $1
         AND is_active = TRUE
      RETURNING
        ${SELECT_COLUMNS}
    `,
    [id],
  );

  return rows[0] || null;
}

export default {
  ensureProductsFiscalOriginsTable,
  getById,
  getByProduct,
  resolveForItem,
  upsertFromFiscalRule,
  remove,
};
