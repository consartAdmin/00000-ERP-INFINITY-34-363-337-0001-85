// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/services/apis/productFiscalCostRulesApi.js                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../../config/db.js';
import PRODUCT_FISCAL_COST_RULES_SCHEMA, {
  PRODUCT_FISCAL_COST_RULES_TABLE,
  PRODUCT_FISCAL_COST_RULES_INSERT_COLUMNS,
  PRODUCT_FISCAL_COST_RULES_UPDATE_COLUMNS,
  prepareProductFiscalCostRuleInsert,
  prepareProductFiscalCostRuleUpdate,
} from '../../../repositories/productFiscalCostRules/productFiscalCostRules.catalog.js';

const TB = PRODUCT_FISCAL_COST_RULES_TABLE;
const SELECT_COLUMNS = PRODUCT_FISCAL_COST_RULES_SCHEMA.selectProjection;

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

function clean(value) {
  if (value == null) return null;

  const text = String(value).trim();
  return text === '' ? null : text;
}

function toNullableNumber(value) {
  if (value === '' || value == null) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

function toBoolean(value, defaultValue = true) {
  if (value == null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();

  if (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'sim' ||
    normalized === 's'
  ) {
    return true;
  }

  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'no' ||
    normalized === 'não' ||
    normalized === 'nao' ||
    normalized === 'n'
  ) {
    return false;
  }

  return defaultValue;
}

function round(value, decimals = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  const factor = 10 ** decimals;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function normalizePercent(value, fallback = 0) {
  const number = toNullableNumber(value);
  return number == null ? fallback : number;
}

function normalizeCalculationQuantity(value) {
  const quantity = toNullableNumber(value);

  if (quantity == null || quantity <= 0) {
    return 1;
  }

  return quantity;
}

function normalizeUnitCost(value, fallback = null) {
  const direct = toNullableNumber(value);

  if (direct != null && direct >= 0) {
    return direct;
  }

  const fallbackValue = toNullableNumber(fallback);

  if (fallbackValue != null && fallbackValue >= 0) {
    return fallbackValue;
  }

  return null;
}

function normalizeCst(value) {
  const raw = clean(value);
  if (!raw) return null;

  const digits = raw.replace(/\D+/g, '');
  if (!digits) return raw.toUpperCase();

  return digits.length >= 2
    ? digits.padStart(2, '0')
    : digits.padStart(2, '0');
}

function assertPrepared(prepared) {
  if (prepared?.valid) return prepared.data;

  const message = (prepared?.errors || [])
    .map((error) => error.message)
    .filter(Boolean)
    .join(' ');

  throw new Error(
    message || 'Payload da regra de custo fiscal inválido.',
  );
}

function assertReference(rule = {}) {
  const hasReference =
    PRODUCT_FISCAL_COST_RULES_SCHEMA.requiredReference
      .some((column) => {
        const value = rule[column];
        return value != null && String(value).trim() !== '';
      });

  if (!hasReference) {
    throw new Error(
      'Informe product_code, fiscal_classification_id ou fiscal_profile_id.',
    );
  }
}

/* ========================================================================== */
/* Get by ID                                                                  */
/* ========================================================================== */

export async function getById(
  ruleId,
  client = pool,
) {
  const id = Number(ruleId);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const { rows } = await client.query(
    `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TB}
      WHERE rule_id = $1
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

/* ========================================================================== */
/* Get by Fiscal Classification                                               */
/* ========================================================================== */

export async function getByClassification(
  classificationId,
  client = pool,
) {
  const id = Number(classificationId);

  if (!Number.isInteger(id) || id <= 0) {
    return [];
  }

  const { rows } = await client.query(
    `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TB}
      WHERE fiscal_classification_id = $1
        AND is_active = TRUE
      ORDER BY rule_id DESC
    `,
    [id],
  );

  return rows;
}

/* ========================================================================== */
/* Get by Fiscal Profile                                                      */
/* ========================================================================== */

export async function getByProfile(
  fiscalProfileId,
  client = pool,
) {
  const id = Number(fiscalProfileId);

  if (!Number.isInteger(id) || id <= 0) {
    return [];
  }

  const { rows } = await client.query(
    `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TB}
      WHERE fiscal_profile_id = $1
        AND is_active = TRUE
      ORDER BY rule_id DESC
    `,
    [id],
  );

  return rows;
}

/* ========================================================================== */
/* Get by Product                                                             */
/* ========================================================================== */

export async function getByProduct(
  productCode,
  client = pool,
) {
  const code = clean(productCode);

  if (!code) {
    return [];
  }

  const { rows } = await client.query(
    `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TB}
      WHERE product_code = $1
        AND is_active = TRUE
      ORDER BY rule_id DESC
    `,
    [code],
  );

  return rows;
}

/* ========================================================================== */
/* Create                                                                     */
/* ========================================================================== */

export async function create(
  input,
  client = pool,
) {
  const prepared = assertPrepared(
    prepareProductFiscalCostRuleInsert(input),
  );

  const value = normalize(prepared);
  assertReference(value);

  const columns = PRODUCT_FISCAL_COST_RULES_INSERT_COLUMNS
    .filter((column) =>
      Object.prototype.hasOwnProperty.call(value, column),
    );

  const parameters = columns
    .map((_, index) => `$${index + 1}`)
    .join(', ');

  const values = columns.map(
    (column) => value[column],
  );

  const { rows } = await client.query(
    `
      INSERT INTO ${TB}
      (
        ${columns.join(', ')}
      )
      VALUES
      (
        ${parameters}
      )
      RETURNING
        ${SELECT_COLUMNS}
    `,
    values,
  );

  return rows[0];
}

/* ========================================================================== */
/* Update                                                                     */
/* ========================================================================== */

export async function update(
  ruleId,
  input,
  client = pool,
) {
  const id = Number(ruleId);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const current = await getById(
    id,
    client,
  );

  if (!current) {
    return null;
  }

  const prepared = assertPrepared(
    prepareProductFiscalCostRuleUpdate({
      ...current,
      ...input,
    }),
  );

  const value = normalize(prepared);
  assertReference(value);

  const columns = PRODUCT_FISCAL_COST_RULES_UPDATE_COLUMNS
    .filter((column) =>
      Object.prototype.hasOwnProperty.call(value, column),
    );

  const setSql = columns
    .map(
      (column, index) =>
        `${column} = $${index + 1}`,
    )
    .join(', ');

  const values = columns.map(
    (column) => value[column],
  );

  values.push(id);

  const { rows } = await client.query(
    `
      UPDATE ${TB}
      SET
        ${setSql},
        updated_at = NOW()
      WHERE rule_id = $${values.length}
      RETURNING
        ${SELECT_COLUMNS}
    `,
    values,
  );

  return rows[0] || null;
}

/* ========================================================================== */
/* Soft Delete                                                                */
/* ========================================================================== */

export async function remove(
  ruleId,
  client = pool,
) {
  const id = Number(ruleId);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const { rows } = await client.query(
    `
      UPDATE ${TB}
      SET
        is_active = FALSE,
        updated_at = NOW()
      WHERE rule_id = $1
      RETURNING
        ${SELECT_COLUMNS}
    `,
    [id],
  );

  return rows[0] || null;
}

/* ========================================================================== */
/* Resolve Product Fiscal Cost Rule                                           */
/*                                                                            */
/* Priority:                                                                  */
/*   1. Product-specific rule                                                 */
/*   2. Fiscal Classification rule                                            */
/*   3. Fiscal Profile rule                                                   */
/* ========================================================================== */

export async function resolve(
  productCode,
  client = pool,
) {
  const code = clean(productCode);

  if (!code) {
    return null;
  }

  const { rows } = await client.query(
    `
      SELECT

        /* ================================================================ */
        /* Product                                                          */
        /* ================================================================ */

        p.product_code AS product_code,
        p.description AS description,
        p.cost_price AS cost_price,

        /* ================================================================ */
        /* Product Fiscal                                                   */
        /* ================================================================ */

        pf.products_fiscal_id
          AS products_fiscal_id,

        pf.fiscal_classification_id
          AS fiscal_classification_id,

        /* ================================================================ */
        /* Fiscal Classification                                            */
        /* ================================================================ */

        fc.fiscal_profile_id
          AS fiscal_profile_id,

        fc.classification_name
          AS classification_name,

        fc.ncm_code
          AS ncm_code,

        fc.cest_code
          AS cest_code,

        /* ================================================================ */
        /* Fiscal Profile                                                   */
        /* ================================================================ */

        fp.profile_name
          AS profile_name,

        fp.icms_cst
          AS profile_icms_cst,

        fp.icms_rate
          AS profile_icms_rate,

        fp.cfop_entry
          AS cfop_entry,

        fp.cfop_exit
          AS cfop_exit,

        fp.pis_cst
          AS pis_cst,

        fp.pis_rate
          AS profile_pis_rate,

        fp.cofins_cst
          AS cofins_cst,

        fp.cofins_rate
          AS profile_cofins_rate,

        /* ================================================================ */
        /* Selected Rule                                                    */
        /* ================================================================ */

        r.rule_id
          AS rule_id,

        r.product_code
          AS rule_product_code,

        r.fiscal_classification_id
          AS rule_fiscal_classification_id,

        r.fiscal_profile_id
          AS rule_fiscal_profile_id,

        r.price_id
          AS price_id,

        r.inbound_cst
          AS inbound_cst,

        r.icms_base_pct
          AS icms_base_pct,

        r.icms_rate
          AS icms_rate,

        r.mva_pct
          AS mva_pct,

        r.icms_st_base_pct
          AS icms_st_base_pct,

        r.icms_st_rate
          AS icms_st_rate,

        r.icms_st_ret_base_pct
          AS icms_st_ret_base_pct,

        r.icms_st_ret_rate
          AS icms_st_ret_rate,

        r.ipi_rate
          AS ipi_rate,

        r.pis_rate
          AS pis_rate,

        r.cofins_rate
          AS cofins_rate,

        r.calculation_mode
          AS calculation_mode,

        r.notes
          AS notes,

        r.is_active
          AS rule_is_active,

        r.created_at
          AS rule_created_at,

        r.updated_at
          AS rule_updated_at,

        r.user_id
          AS rule_user_id,

        /* ================================================================ */
        /* Rule Source                                                      */
        /* ================================================================ */

        CASE
          WHEN r.rule_id IS NULL
            THEN 'NONE'

          WHEN r.product_code = p.product_code
            THEN 'PRODUCT_RULE'

          WHEN
            r.product_code IS NULL
            AND
            r.fiscal_classification_id =
              pf.fiscal_classification_id
            THEN 'CLASSIFICATION_RULE'

          WHEN
            r.product_code IS NULL
            AND
            r.fiscal_classification_id IS NULL
            AND
            r.fiscal_profile_id =
              fc.fiscal_profile_id
            THEN 'PROFILE_RULE'

          ELSE 'NONE'
        END AS rule_source

      FROM public.products p

      /* ================================================================== */
      /* Current product fiscal association                                 */
      /* ================================================================== */

      LEFT JOIN public."productsFiscalV2" pf
        ON pf.product_code = p.product_code
       AND pf.is_current = TRUE
       AND pf.is_active = TRUE

      /* ================================================================== */
      /* Fiscal classification                                              */
      /* ================================================================== */

      LEFT JOIN public."fiscalClassificationV2" fc
        ON fc.fiscal_classification_id =
           pf.fiscal_classification_id
       AND fc.is_active = TRUE

      /* ================================================================== */
      /* Fiscal profile                                                     */
      /* ================================================================== */

      LEFT JOIN public."fiscalProfileV2" fp
        ON fp.fiscal_profile_id =
           fc.fiscal_profile_id
       AND fp.is_active = TRUE

      /* ================================================================== */
      /* Best matching fiscal fallback rule                                 */
      /* ================================================================== */

      LEFT JOIN LATERAL (

        SELECT
          x.*

        FROM ${TB} x

        WHERE
          x.is_active = TRUE

          AND (

            x.product_code =
              p.product_code

            OR

            (
              x.product_code IS NULL

              AND
              x.fiscal_classification_id =
                pf.fiscal_classification_id
            )

            OR

            (
              x.product_code IS NULL

              AND
              x.fiscal_classification_id IS NULL

              AND
              x.fiscal_profile_id =
                fc.fiscal_profile_id
            )
          )

        ORDER BY

          CASE

            WHEN x.product_code =
                 p.product_code
              THEN 1

            WHEN
              x.product_code IS NULL
              AND
              x.fiscal_classification_id =
                pf.fiscal_classification_id
              THEN 2

            WHEN
              x.product_code IS NULL
              AND
              x.fiscal_classification_id IS NULL
              AND
              x.fiscal_profile_id =
                fc.fiscal_profile_id
              THEN 3

            ELSE 99

          END,

          x.rule_id DESC

        LIMIT 1

      ) r ON TRUE

      WHERE p.product_code = $1

      LIMIT 1
    `,
    [code],
  );

  return rows[0] || null;
}

/* ========================================================================== */
/* Calculate Product Fiscal Cost                                              */
/*                                                                            */
/* Purpose:                                                                   */
/*   - centralized backend calculation for the "Atualizar dados fiscais"     */
/*     action in Products / Stock Lot;                                        */
/*   - does NOT claim the calculated values came from an inbound NF-e;        */
/*   - source is always PRODUCT_FISCAL_RULE.                                  */
/*                                                                            */
/* The calculation uses the resolved rule hierarchy from resolve().           */
/* ========================================================================== */

export async function calculateForProduct(
  productCode,
  {
    unitCost = null,
    quantity = 1,
  } = {},
  client = pool,
) {
  const code = clean(productCode);

  if (!code) {
    throw new Error('product_code é obrigatório.');
  }

  const resolved = await resolve(code, client);

  if (!resolved) {
    throw new Error(`SKU ${code}: produto não encontrado.`);
  }

  if (!resolved.rule_id || resolved.rule_source === 'NONE') {
    throw new Error(
      `SKU ${code}: nenhuma regra de custo fiscal ativa foi encontrada.`,
    );
  }

  const cost = normalizeUnitCost(
    unitCost,
    resolved.cost_price,
  );

  if (cost == null) {
    throw new Error(
      `SKU ${code}: informe um custo unitário válido para calcular os dados fiscais.`,
    );
  }

  const qty = normalizeCalculationQuantity(quantity);
  const cst = normalizeCst(
    resolved.inbound_cst ??
    resolved.profile_icms_cst,
  );

  const icmsBasePct = normalizePercent(
    resolved.icms_base_pct,
    100,
  );

  const icmsRate = normalizePercent(
    resolved.icms_rate ??
    resolved.profile_icms_rate,
    0,
  );

  const stBasePct = normalizePercent(
    resolved.icms_st_ret_base_pct ??
    resolved.icms_st_base_pct,
    100,
  );

  const stRate = normalizePercent(
    resolved.icms_st_ret_rate ??
    resolved.icms_st_rate,
    0,
  );

  const mvaPct = toNullableNumber(
    resolved.mva_pct,
  );

  const calculationMode =
    clean(resolved.calculation_mode) ||
    'PERCENTUAL';

  const icmsBasePerUnit = round(
    cost * (icmsBasePct / 100),
    4,
  );

  const icmsValuePerUnit = round(
    icmsBasePerUnit * (icmsRate / 100),
    4,
  );

  /*
   * Current rule semantics:
   *   icms_st_base_pct defines the effective ST base percentage.
   *
   * mva_pct remains exposed in the response for the UI/audit, but it is not
   * applied a second time here because the rule already stores the configured
   * ST base percentage. This avoids double-increasing the base.
   */
  const icmsStBasePerUnit = round(
    cost * (stBasePct / 100),
    4,
  );

  const icmsStValuePerUnit = round(
    icmsStBasePerUnit * (stRate / 100),
    4,
  );

  const icmsBaseTotal = round(
    icmsBasePerUnit * qty,
    2,
  );

  const icmsValueTotal = round(
    icmsValuePerUnit * qty,
    2,
  );

  const icmsStBaseTotal = round(
    icmsStBasePerUnit * qty,
    2,
  );

  const icmsStValueTotal = round(
    icmsStValuePerUnit * qty,
    2,
  );

  return {
    ok: true,

    source: 'PRODUCT_FISCAL_RULE',
    source_label: 'Regra fiscal do produto',

    product_code: code,
    description: resolved.description ?? null,

    rule_id: Number(resolved.rule_id),
    rule_source: resolved.rule_source,
    calculation_mode: calculationMode,

    products_fiscal_id:
      toNullableNumber(resolved.products_fiscal_id),

    fiscal_classification_id:
      toNullableNumber(resolved.fiscal_classification_id),

    fiscal_profile_id:
      toNullableNumber(resolved.fiscal_profile_id),

    classification_name:
      resolved.classification_name ?? null,

    profile_name:
      resolved.profile_name ?? null,

    inbound_cst: cst,

    unit_cost: round(cost, 6),
    quantity: qty,

    /* ------------------------------------------------------------------ */
    /* Values used by the upper "Origem fiscal" panel                    */
    /* ------------------------------------------------------------------ */

    icms_base_pct: icmsBasePct,
    icms_rate: icmsRate,
    icms_base: icmsBaseTotal,
    icms_value: icmsValueTotal,

    mva_pct: mvaPct,

    icms_st_base_pct: stBasePct,
    icms_st_rate: stRate,
    icms_st_base: icmsStBaseTotal,
    icms_st_value: icmsStValueTotal,

    /* ------------------------------------------------------------------ */
    /* Unit values used by "Fração fiscal por unidade"                    */
    /* ------------------------------------------------------------------ */

    fiscal_per_unit: {
      icms_base: icmsBasePerUnit,
      icms_value: icmsValuePerUnit,
      icms_st_base: icmsStBasePerUnit,
      icms_st_value: icmsStValuePerUnit,
    },

    /* ------------------------------------------------------------------ */
    /* Proportional preview for the operation quantity                    */
    /* ------------------------------------------------------------------ */

    proportional: {
      quantity: qty,
      icms_base: icmsBaseTotal,
      icms_value: icmsValueTotal,
      icms_st_base: icmsStBaseTotal,
      icms_st_value: icmsStValueTotal,
    },

    /* ------------------------------------------------------------------ */
    /* Other rule rates                                                    */
    /* ------------------------------------------------------------------ */

    ipi_rate:
      toNullableNumber(resolved.ipi_rate),

    pis_rate:
      toNullableNumber(
        resolved.pis_rate ??
        resolved.profile_pis_rate,
      ),

    cofins_rate:
      toNullableNumber(
        resolved.cofins_rate ??
        resolved.profile_cofins_rate,
      ),

    notes:
      resolved.notes ?? null,
  };
}

export async function generateProductRule(productCode, options = {}, client = pool) {
  const code = String(productCode ?? '').trim();

  if (!code) {
    throw new Error('product_code é obrigatório.');
  }

  const force = toBoolean(options.force, false);

  /*
   * Fonte ÚNICA da regra automática:
   *   "productsFiscalV2" atual (pf)
   *     -> "fiscalClassificationV2" (fc)
   *       -> "fiscalProfileV2" (fp)
   *
   * Não consulta inboundInvoiceItems e não usa histórico de NF-e.
   *
   * Os campos ST são lidos de forma tolerante via to_jsonb(...), portanto
   * esta API continua funcionando mesmo se algum desses campos ainda não
   * existir em uma das tabelas atuais. Quando não houver configuração ST
   * suficiente para um CST que exige ST, a geração é bloqueada com mensagem
   * explícita, em vez de inventar uma alíquota.
   */
  const { rows } = await client.query(
    `
      SELECT
        p.product_id,
        p.product_code,
        p.description,
        p.cost_price,

        pf.products_fiscal_id,
        pf.fiscal_classification_id,

        fc.classification_name,
        fc.ncm_code,
        fc.cest_code,
        fc.fiscal_profile_id,

        fp.profile_name,
        fp.icms_cst,
        fp.icms_rate,
        fp.pis_cst,
        fp.pis_rate,
        fp.cofins_cst,
        fp.cofins_rate,
        fp.cfop_entry,
        fp.cfop_exit,

        fp.icms_base_pct AS current_icms_base_pct,
        fp.mva_pct AS current_mva_pct,
        fp.icms_st_base_pct AS current_icms_st_base_pct,
        fp.icms_st_rate AS current_icms_st_rate,
        fp.icms_st_ret_base_pct AS current_icms_st_ret_base_pct,
        fp.icms_st_ret_rate AS current_icms_st_ret_rate,
        fp.ipi_rate AS current_ipi_rate

      FROM public.products p

      INNER JOIN public."productsFiscalV2" pf
        ON pf.product_code = p.product_code
       AND pf.is_current = TRUE
       AND pf.is_active = TRUE

      INNER JOIN public."fiscalClassificationV2" fc
        ON fc.fiscal_classification_id = pf.fiscal_classification_id
       AND fc.is_active = TRUE

      INNER JOIN public."fiscalProfileV2" fp
        ON fp.fiscal_profile_id = fc.fiscal_profile_id
       AND fp.is_active = TRUE

      WHERE p.product_code = $1
      LIMIT 1
    `,
    [code],
  );

  const fiscal = rows[0];

  if (!fiscal) {
    throw new Error(
      `SKU ${code}: produto não encontrado ou não possui vínculo fiscal atual completo ` +
      '("productsFiscalV2" -> classificação -> perfil).',
    );
  }

  if (!fiscal.fiscal_classification_id) {
    throw new Error(`Produto ${code} não possui classificação fiscal atual vinculada.`);
  }

  if (!fiscal.fiscal_profile_id) {
    throw new Error(`Produto ${code} não possui perfil fiscal atual vinculado.`);
  }

  const existing = await client.query(
    `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TB}
      WHERE product_code = $1
        AND is_active = TRUE
      ORDER BY rule_id DESC
      LIMIT 1
    `,
    [code],
  );

  if (existing.rows[0] && !force) {
    return {
      created: false,
      rule: existing.rows[0],
      fiscal,
      rule_source: 'PRODUCT_RULE',
      config_source: 'CURRENT_PRODUCT_FISCAL',
    };
  }

  const inboundCst = clean(options.inbound_cst ?? fiscal.icms_cst);
  const normalizedCst = String(inboundCst ?? '').padStart(2, '0');

  const stCsts = new Set(['10', '30', '60', '70', '90']);
  const requiresSt = stCsts.has(normalizedCst);

  const profileIcmsRate = toNullableNumber(fiscal.icms_rate);
  const explicitIcmsRate = toNullableNumber(options.icms_rate);

  let resolvedIcmsRate =
    explicitIcmsRate != null
      ? explicitIcmsRate
      : profileIcmsRate;

  if (normalizedCst === '60' && resolvedIcmsRate == null) {
    resolvedIcmsRate = 0;
  }

  const configuredStRate = toNullableNumber(fiscal.current_icms_st_rate);
  const explicitStRate = toNullableNumber(options.icms_st_rate);

  const resolvedStRate =
    explicitStRate != null && explicitStRate > 0
      ? explicitStRate
      : configuredStRate != null && configuredStRate > 0
        ? configuredStRate
        : null;

  if (requiresSt && resolvedStRate == null) {
    throw new Error(
      `SKU ${code}: CST ${normalizedCst} exige ICMS-ST, mas a alíquota ST não está ` +
      'configurada no vínculo fiscal atual ("productsFiscalV2" / classificação / perfil). ' +
      'Configure icms_st_rate no perfil fiscal atual ou envie icms_st_rate explicitamente.',
    );
  }

  const configuredIcmsBasePct = toNullableNumber(fiscal.current_icms_base_pct);
  const configuredStBasePct = toNullableNumber(fiscal.current_icms_st_base_pct);

  const icmsBasePct =
    toNullableNumber(options.icms_base_pct) ??
    configuredIcmsBasePct ??
    100;

  const stBasePct = requiresSt
    ? (
      toNullableNumber(options.icms_st_base_pct) ??
      configuredStBasePct ??
      100
    )
    : (
      toNullableNumber(options.icms_st_base_pct) ??
      configuredStBasePct ??
      null
    );

  const payload = {
    product_code: code,
    fiscal_classification_id: Number(fiscal.fiscal_classification_id),
    fiscal_profile_id: Number(fiscal.fiscal_profile_id),
    price_id: toNullableNumber(options.price_id),

    inbound_cst: inboundCst,
    icms_base_pct: icmsBasePct,
    icms_rate: resolvedIcmsRate,

    mva_pct:
      toNullableNumber(options.mva_pct) ??
      toNullableNumber(fiscal.current_mva_pct),

    icms_st_base_pct: stBasePct,
    icms_st_rate: requiresSt
      ? resolvedStRate
      : (
        explicitStRate ??
        configuredStRate
      ),

    icms_st_ret_base_pct:
      toNullableNumber(options.icms_st_ret_base_pct) ??
      toNullableNumber(fiscal.current_icms_st_ret_base_pct),

    icms_st_ret_rate:
      toNullableNumber(options.icms_st_ret_rate) ??
      toNullableNumber(fiscal.current_icms_st_ret_rate),

    ipi_rate:
      toNullableNumber(options.ipi_rate) ??
      toNullableNumber(fiscal.current_ipi_rate),

    pis_rate:
      toNullableNumber(options.pis_rate ?? fiscal.pis_rate),

    cofins_rate:
      toNullableNumber(options.cofins_rate ?? fiscal.cofins_rate),

    calculation_mode:
      clean(options.calculation_mode) ||
      'PERCENTUAL',

    notes:
      clean(options.notes) ||
      `Regra gerada automaticamente para SKU ${code} usando somente o vínculo fiscal atual: ` +
      `"productsFiscalV2" ${fiscal.products_fiscal_id}, classificação fiscal ` +
      `${fiscal.fiscal_classification_id} e perfil fiscal ${fiscal.fiscal_profile_id}. ` +
      `Nenhum histórico de inboundInvoiceItems foi utilizado; os percentuais ICMS/ST vêm do perfil fiscal atual.`,

    is_active: true,
    user_id: toNullableNumber(options.user_id),
  };

  const ownsTransaction = client === pool;
  const db = ownsTransaction ? await pool.connect() : client;

  try {
    if (ownsTransaction) {
      await db.query('BEGIN');
    }

    if (existing.rows[0] && force) {
      await db.query(
        `
          UPDATE ${TB}
          SET is_active = FALSE,
              updated_at = NOW()
          WHERE product_code = $1
            AND is_active = TRUE
        `,
        [code],
      );
    }

    const created = await create(payload, db);

    if (ownsTransaction) {
      await db.query('COMMIT');
    }

    return {
      created: true,
      rule: created,
      fiscal: {
        ...fiscal,
        cost_price:
          fiscal.cost_price == null
            ? null
            : Number(fiscal.cost_price),
      },
      config_source: {
        source: 'CURRENT_PRODUCT_FISCAL',
        products_fiscal_id: Number(fiscal.products_fiscal_id),
        fiscal_classification_id: Number(fiscal.fiscal_classification_id),
        fiscal_profile_id: Number(fiscal.fiscal_profile_id),
        icms_st_rate: resolvedStRate,
      },
      history_source: null,
      rule_source: 'PRODUCT_RULE',
    };
  } catch (error) {
    if (ownsTransaction) {
      try {
        await db.query('ROLLBACK');
      } catch {
        // Preserve original error.
      }
    }

    throw error;
  } finally {
    if (ownsTransaction) {
      db.release();
    }
  }
}

/* ========================================================================== */
/* Internal normalize                                                         */
/* ========================================================================== */

function normalize(input = {}) {
  return {
    product_code: clean(input.product_code),

    fiscal_classification_id: toNullableNumber(
      input.fiscal_classification_id,
    ),

    fiscal_profile_id: toNullableNumber(
      input.fiscal_profile_id,
    ),

    price_id: toNullableNumber(input.price_id),

    inbound_cst: clean(input.inbound_cst),

    icms_base_pct: toNullableNumber(
      input.icms_base_pct,
    ),

    icms_rate: toNullableNumber(
      input.icms_rate,
    ),

    mva_pct: toNullableNumber(
      input.mva_pct,
    ),

    icms_st_base_pct: toNullableNumber(
      input.icms_st_base_pct,
    ),

    icms_st_rate: toNullableNumber(
      input.icms_st_rate,
    ),

    icms_st_ret_base_pct: toNullableNumber(
      input.icms_st_ret_base_pct,
    ),

    icms_st_ret_rate: toNullableNumber(
      input.icms_st_ret_rate,
    ),

    ipi_rate: toNullableNumber(
      input.ipi_rate,
    ),

    pis_rate: toNullableNumber(
      input.pis_rate,
    ),

    cofins_rate: toNullableNumber(
      input.cofins_rate,
    ),

    calculation_mode:
      clean(input.calculation_mode) ||
      'PERCENTUAL',

    notes: clean(input.notes),

    is_active: toBoolean(
      input.is_active,
      true,
    ),

    user_id: toNullableNumber(
      input.user_id,
    ),
  };
}

/* ========================================================================== */
/* Export                                                                     */
/* ========================================================================== */

export default {
  getById,
  getByClassification,
  getByProfile,
  getByProduct,
  generateProductRule,
  calculateForProduct,
  create,
  update,
  remove,
  resolve,
};
