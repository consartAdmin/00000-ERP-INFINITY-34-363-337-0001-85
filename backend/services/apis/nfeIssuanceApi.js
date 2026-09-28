// backend/services/apis/nfeIssuanceApi.js
// Adapter for DANFE previews and direct NF-e issuance from budgets.
// Budget items are enriched with the same fiscal V2 joins used by Orders.
// CST 60 items get their ICMS-ST origin from inboundInvoiceItems according to
// PRODUCT_STOCK_MODE: STOCK_SIMPLE -> product_code; STOCK_WITH_LOT -> lot_id + product_code.
// Resolution order for the retained ICMS-ST:
//   1) inboundInvoiceItems (the real supplier NF-e, always preferred);
//   2) productsFiscalOrigins (stored rule-based origin, marked PRODUCT_FISCAL_ORIGIN);
//   3) LOTE-INICIAL legacy fallback using the live productFiscalCostRules
//      calculation, explicitly marked as PRODUCT_FISCAL_RULE.

import { getBudgetObjectById } from '../../controllers/budgetsController.js';
import pool from '../../config/db.js';
import customersApi from '../../repositories/customers/customers.index.js';
import * as tecnospeedNfeApi from './tecnoSpeedNfeApi.js';
import invoicesIssuedApi from '../../repositories/invoicesIssued/invoicesIssued.index.js';
import {
  issueOrderNfe as issueOrderNfeFromAttempts,
  reconcileOrderNfe as reconcileOrderNfeFromAttempts,
} from './ordersNfeAttempts/ordersNfeAttemptsApi.js';

import {
  syncAuthorizedBudgetNfe,
} from './nfeAsaasSyncApi.js';

import * as stockFromBudgetsService
  from '../stockFromBudgetsService.js';

import {
  resolveFeature,
} from './appFeatures/appFeaturesApi.js';

import {
  calculateForProduct as calculateProductFiscalCostRule,
} from './productFiscalCostRules/productFiscalCostRulesApi.js';

import {
  resolveForItem as resolveStoredProductFiscalOrigin,
} from './productsFiscalOrigins/productsFiscalOriginsApi.js';

async function resolveActiveStockMode() {
  const feature = await resolveFeature({
    featureCode: 'PRODUCT_STOCK_MODE',
    scopeType: 'GLOBAL',
    scopeId: 1,
  });

  if (!feature) {
    throw new Error(
      '[BUDGET NFE] Feature PRODUCT_STOCK_MODE não cadastrada.'
    );
  }

  if (!feature.enabled) {
    throw new Error(
      '[BUDGET NFE] Feature PRODUCT_STOCK_MODE desativada.'
    );
  }

  const mode = String(
    feature.optionCode || ''
  )
    .trim()
    .toUpperCase();

  const isSimple =
    mode === 'STOCK_SIMPLE';

  const isWithLot =
    mode === 'STOCK_WITH_LOT';

  if (!isSimple && !isWithLot) {
    throw new Error(
      `[BUDGET NFE] PRODUCT_STOCK_MODE inválido: "${mode}".`
    );
  }

  return {
    mode,
    isSimple,
    isWithLot,
    requireLot: isWithLot,
    feature,
  };
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function digits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Normaliza CST/CSOSN vindos de fontes diferentes (colunas do banco, XML de
 * entrada, payloads de terceiros) para a forma canônica usada nas comparações.
 * CST de ICMS tem 2 dígitos ('60') e CSOSN tem 3 ('500'); zeros à esquerda
 * excedentes são removidos para que '060' e 60 sejam tratados como '60'.
 */
function normalizeCst(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const onlyDigits = raw.replace(/\D+/g, '');
  if (!onlyDigits) return raw.toUpperCase();

  const withoutLeadingZeros = onlyDigits.replace(/^0+(?=\d{2,})/, '');

  return withoutLeadingZeros.length >= 2
    ? withoutLeadingZeros
    : onlyDigits.padStart(2, '0');
}

/**
 * Primeiro valor não vazio de uma lista (aceita 0 e false como vazios apenas
 * quando a representação em texto for vazia).
 */
function firstNonEmpty(...values) {
  for (const value of values) {
    if (String(value ?? '').trim() !== '') return value;
  }
  return null;
}

/**
 * Executa um mapeamento assíncrono com concorrência limitada.
 * O pool de conexões tem no máximo PGPOOL_MAX conexões (10 por padrão) e um
 * timeout de aquisição (PG_CONNECT_TIMEOUT_MS, 8s), portanto um Promise.all
 * sobre todos os itens de um orçamento grande poderia estourar o pool.
 */
async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;

  const workerCount = Math.max(1, Math.min(limit, values.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index], index);
      }
    }),
  );

  return results;
}

function unwrapCustomer(value) {
  return value?.data?.customer || value?.data || value?.customer || value || {};
}

async function getSelectedFiscalOperation(operationTypeId, customerState) {
  const id = positiveInteger(operationTypeId);
  if (!id) {
    const error = new Error('Selecione a operação fiscal do orçamento antes de emitir a NF-e.');
    error.status = 422;
    error.code = 'BUDGET_OPERATION_TYPE_REQUIRED';
    throw error;
  }

  const { rows } = await pool.query(
    `
      SELECT operation_type_id, code, name, nature_operation,
             cfop_internal, cfop_interstate,
             generates_receivable, moves_stock, active
      FROM public."nfeOperationTypes"
      WHERE operation_type_id = $1
        AND active = TRUE
      LIMIT 1
    `,
    [id],
  );

  const operation = rows[0];
  if (!operation) {
    const error = new Error('A operação fiscal selecionada não existe ou está inativa.');
    error.status = 422;
    error.code = 'BUDGET_OPERATION_TYPE_INVALID';
    throw error;
  }

  const issuerState = String(
    process.env.NFE_EMPRESA_UF || process.env.EMPRESA_UF || '',
  ).trim().toUpperCase();
  const destinationState = String(customerState || '').trim().toUpperCase();

  if (!issuerState) {
    const error = new Error('Configure NFE_EMPRESA_UF no .env para selecionar o CFOP da operação.');
    error.status = 500;
    error.code = 'NFE_ISSUER_STATE_NOT_CONFIGURED';
    throw error;
  }

  const isInternal = issuerState === destinationState;
  const cfop = isInternal ? operation.cfop_internal : operation.cfop_interstate;
  const code = String(operation.code || '').trim().toUpperCase();
  const forceCfop = ['BONUS', 'DEVOLUCAO', 'TRANSFERENCIA', 'REMESSA'].some(
    (prefix) => code === prefix || code.startsWith(`${prefix}_`),
  );

  if (forceCfop && !/^\d{4}$/.test(String(cfop || ''))) {
    const error = new Error(
      `A operação ${operation.code} não possui CFOP ${isInternal ? 'interno' : 'interestadual'} configurado.`,
    );
    error.status = 422;
    error.code = 'BUDGET_OPERATION_CFOP_MISSING';
    throw error;
  }

  return {
    operation_type_id: Number(operation.operation_type_id),
    code: operation.code,
    name: operation.name,
    nature_operation: operation.nature_operation,
    cfop: cfop || null,
    cfop_internal: operation.cfop_internal,
    cfop_interstate: operation.cfop_interstate,
    force_cfop: forceCfop,
    generates_receivable: Boolean(operation.generates_receivable),
    moves_stock: Boolean(operation.moves_stock),
  };
}

function findIbgeCode(...sources) {
  const keys = [
    'ibge_city_code',
    'city_ibge_code',
    'ibge_code',
    'codigo_ibge',
    'code_ibge',
    'city_ibge',
    'municipio_ibge',
    'ibge',
  ];

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    for (const key of keys) {
      const code = digits(source[key]);
      if (code.length === 7) return code;
    }
  }

  return null;
}

async function getCustomerFiscalData(customerId) {
  const id = positiveInteger(customerId);
  if (!id) return {};

  let customer = {};

  try {
    customer = unwrapCustomer(await customersApi.getById(id));
  } catch (error) {
    console.warn('[nfeIssuanceApi][budgetCustomer]', error?.message || error);
  }

  let ibgeData = {};

  try {
    const { rows } = await pool.query(
      `
        SELECT to_jsonb(ci) AS data
          FROM public."customersIbge" ci
         WHERE ci.customer_id = $1
         LIMIT 1
      `,
      [id],
    );
    ibgeData = rows[0]?.data || {};
  } catch (error) {
    // Some installations return IBGE directly from customersApi and do not
    // have the auxiliary table. In that case the API result remains valid.
    if (error?.code !== '42P01') {
      console.warn('[nfeIssuanceApi][budgetCustomerIbge]', error?.message || error);
    }
  }

  const ibgeCode = findIbgeCode(customer, ibgeData);

  return {
    customer_id: id,
    customer_legal_name: customer.legal_name || null,
    customer_name: customer.legal_name || customer.trade_name || null,
    customer_tax_id: customer.tax_id || null,
    customer_email: customer.email || null,
    customer_phone: customer.mobile_number || customer.phone_number || null,
    customer_mobile: customer.mobile_number || null,
    customer_zip: customer.postal_code || null,
    customer_street_type: customer.street_type || null,
    customer_street: customer.street_name || null,
    customer_number: customer.street_number || null,
    customer_complement: customer.address_complement || null,
    customer_neighborhood: customer.neighborhood || null,
    customer_city: customer.city || null,
    customer_state: customer.state || null,
    state_registration: customer.state_registration || null,
    ibge_code: ibgeCode,
    customer_ibge_code: ibgeCode,
    ibge_city_code: ibgeCode,
  };
}

export async function getBudgetIssuedData(budgetId) {
  const id = positiveInteger(budgetId);

  if (!id) {
    const error = new Error('ID de orçamento inválido.');
    error.status = 400;
    throw error;
  }

  const budget = await getBudgetObjectById(id);

  if (!budget) {
    const error = new Error('Orçamento não encontrado.');
    error.status = 404;
    throw error;
  }

  const customer = await getCustomerFiscalData(budget.customer_id);
  const operation = await getSelectedFiscalOperation(
    budget.operation_type_id,
    customer.customer_state || budget.customer_state,
  );

  return {
    ...budget,
    ...Object.fromEntries(
      Object.entries(customer).filter(([, value]) => value !== null && value !== ''),
    ),
    budget_id: Number(budget.budget_id ?? budget.id ?? id),
    operation_type_id: operation.operation_type_id,
    fiscal_operation: operation,
    operation_cfop: operation.cfop,
    nature_operation: operation.nature_operation,
    generates_receivable: operation.generates_receivable,
    moves_stock: operation.moves_stock,
    items: Array.isArray(budget.items) ? budget.items : [],
    payments: Array.isArray(budget.payments) ? budget.payments : [],
    payment_installments: Array.isArray(budget.payment_installments)
      ? budget.payment_installments
      : [],
    shipping: budget.shipping || null,
  };
}

function rowToFiscalBudgetItem(row) {
  if (!row) return null;

  const ncm = row.ncm ?? row.ncm_code ?? null;
  const cest = row.cest ?? row.cest_code ?? null;
  const profileName = row.profile_name ?? null;
  const classificationName = row.classification_name ?? null;

  return {
    budget_item_id: row.budget_item_id,
    budget_id: row.budget_id,
    sku: row.product_code ?? row.sku,
    product_code: row.product_code ?? row.sku,
    barcode_id: row.barcode_id ?? null,
    barcode: row.barcode ?? null,
    description: row.description,
    manufacturer_ref: row.manufacturer_ref ?? null,
    grade_id: row.grade_id ?? null,
    lot_id: row.lot_id ?? null,
    lot_code: row.lot_code ?? null,
    lot_number: row.lot_code ?? null,
    grade: row.grade ?? null,
    unit: row.unit_code ?? row.unit,
    unit_code: row.unit_code ?? row.unit,
    conversion_factor: Number(row.conversion_factor || 1),
    quantity: Number(row.quantity || 0),
    unit_price: Number(row.unit_price || 0),
    discount_value: Number(row.discount_value || 0),
    product_id: row.product_id ?? null,
    product_stock_id: row.product_stock_id ?? null,

    products_fiscal_id: row.products_fiscal_id ?? null,
    fiscal_classification_id: row.fiscal_classification_id ?? null,
    fiscal_profile_id: row.fiscal_profile_id ?? null,
    fiscal_version: row.fiscal_version ?? null,
    fiscal_effective_from: row.fiscal_effective_from ?? null,
    fiscal_effective_to: row.fiscal_effective_to ?? null,
    fiscal_source_system: row.fiscal_source_system ?? null,
    fiscal_source_reference: row.fiscal_source_reference ?? null,
    product_fiscal_extra_payload: row.product_fiscal_extra_payload ?? {},
    fiscal_profile: profileName,
    tax_profile_name: profileName,
    profile_name: profileName,
    profile_description: row.profile_description ?? null,
    fiscal_classification: classificationName,
    classification_name: classificationName,
    classification_description: row.classification_description ?? null,

    ncm,
    ncm_code: ncm,
    ncm_description: row.ncm_description ?? null,
    cest,
    cest_code: cest,
    cest_description: row.cest_description ?? null,
    ex_tipi: row.ex_tipi ?? null,

    cfop: row.cfop_exit ?? null,
    cfop_entry: row.cfop_entry ?? null,
    cfop_exit: row.cfop_exit ?? null,
    origin_code: row.origin_code ?? null,
    origem_mercadoria: row.origin_code ?? null,

    icms_cst: row.icms_cst ?? null,
    cst_icms: row.icms_cst ?? null,
    icms_rate: Number(row.icms_rate ?? 0),
    aliquota_icms: Number(row.icms_rate ?? 0),

    pis_cst: row.pis_cst ?? null,
    pis_rate: Number(row.pis_rate ?? 0),
    pis_aliquota: Number(row.pis_rate ?? 0),
    cofins_cst: row.cofins_cst ?? null,
    cofins_rate: Number(row.cofins_rate ?? 0),
    cofins_aliquota: Number(row.cofins_rate ?? 0),
    benefit_code: row.benefit_code ?? null,

    is_cst: row.is_cst ?? null,
    is_classification: row.is_classification ?? null,
    is_rate: Number(row.is_rate ?? 0),
    is_specific_rate: Number(row.is_specific_rate ?? 0),
    is_unit: row.is_unit ?? 'UN',
    ibscbs_cst: row.ibscbs_cst ?? null,
    ibscbs_classification: row.ibscbs_classification ?? null,
    ibs_uf_rate: Number(row.ibs_uf_rate ?? 0),
    ibs_municipal_rate: Number(row.ibs_municipal_rate ?? 0),
    cbs_rate: Number(row.cbs_rate ?? 0),
    donation_indicator: row.donation_indicator ?? 1,
    tax_reform_details: row.tax_reform_details ?? {},
  };
}

// ============================================================================
// ICMS-ST RETIDO ANTERIORMENTE (CST 60)
//
// A origem do ICMS-ST é localizada em inboundInvoiceItems conforme o modo:
//   STOCK_SIMPLE   -> product_code
//   STOCK_WITH_LOT -> lot_id + product_code
//
// Fontes, nesta ordem de prioridade:
//   1) colunas icms_st_base / icms_st_rate / icms_st_value (e fcp_st_*);
//   2) raw_tax_payload normalizado (chaves planas, como icms_st_base);
//   3) raw_tax_payload no formato XML/xml2js (ICMS10, ICMS60, ICMSSN500 etc.).
//
// Os valores da entrada referem-se à quantidade total daquela entrada, por
// isso são convertidos para valor por unidade base e aplicados à quantidade
// vendida no orçamento.
// ============================================================================

const ICMS_ST_RETAINED_SOURCE_CSTS = new Set(['60', '500']);
const ICMS_ST_CANDIDATE_LIMIT = 25;

// Itens enriquecidos em paralelo, com folga em relação ao PGPOOL_MAX (10).
const ITEM_ENRICHMENT_CONCURRENCY = 4;

function firstNode(value) {
  return Array.isArray(value) ? value[0] : value;
}

function xmlText(node, key) {
  const raw = firstNode(node?.[key]);
  if (raw === undefined || raw === null) return null;

  if (typeof raw === 'object') {
    const inner = raw._ ?? raw['#text'] ?? null;
    if (inner === null || inner === undefined) return null;
    const innerText = String(inner).trim();
    return innerText || null;
  }

  const text = String(raw).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = toNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function roundTo(value, decimals) {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return null;
  const factor = 10 ** decimals;
  return Math.round((parsed + Number.EPSILON) * factor) / factor;
}

function parseJsonPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Extrai o grupo ICMS (ICMS00, ICMS10, ICMS60, ICMSSN500...) do
 * raw_tax_payload no formato xml2js.
 */
function extractIcmsGroup(rawTaxPayload) {
  const payload = parseJsonPayload(rawTaxPayload);
  const icmsRoot = firstNode(payload?.ICMS);

  if (!icmsRoot || typeof icmsRoot !== 'object') return null;

  for (const [groupName, groupValue] of Object.entries(icmsRoot)) {
    const group = firstNode(groupValue);
    if (group && typeof group === 'object') {
      return { groupName, group };
    }
  }

  return null;
}

/**
 * Quantidade da entrada na unidade base de estoque.
 * Premissa: inboundInvoiceItems.quantity × conversion_factor.
 */
function inboundBaseQuantity(row) {
  const quantity = toNumberOrNull(row?.quantity);
  const factor = toNumberOrNull(row?.conversion_factor);

  if (quantity === null || quantity <= 0) return null;
  return quantity * (factor !== null && factor > 0 ? factor : 1);
}

/**
 * Quantidade vendida na unidade base de estoque.
 * Premissa: budgetsItems.quantity × conversion_factor.
 */
function budgetItemBaseQuantity(item) {
  const quantity = toNumberOrNull(item?.quantity);
  const factor = toNumberOrNull(item?.conversion_factor);

  if (quantity === null || quantity <= 0) return null;
  return quantity * (factor !== null && factor > 0 ? factor : 1);
}

function normalizeInboundIcmsSt(row) {
  const payload = parseJsonPayload(row?.raw_tax_payload) || {};
  const icmsGroup = extractIcmsGroup(payload);
  const group = icmsGroup?.group || {};

  // raw_tax_payload exists in two shapes in the database:
  // 1) normalized/flat JSON (icms_cst, icms_st_base, ...);
  // 2) XML/xml2js JSON (ICMS -> ICMS10/ICMS60/ICMSSN500 -> ...).
  const sourceCst = normalizeCst(
    firstNonEmpty(
      row?.icms_cst,
      payload?.icms_cst,
      payload?.cst_icms,
      payload?.CST,
      payload?.CSOSN,
      xmlText(group, 'CST'),
      xmlText(group, 'CSOSN'),
    ),
  );

  const flatPayloadIsRetained =
    firstNumber(
      payload?.icms_st_base_retained,
      payload?.vBCSTRet,
      payload?.icms_st_value_retained,
      payload?.vICMSSTRet,
    ) !== null;

  const xmlPayloadIsRetained =
    xmlText(group, 'vBCSTRet') !== null ||
    xmlText(group, 'vICMSSTRet') !== null;

  const isRetainedSource =
    flatPayloadIsRetained ||
    xmlPayloadIsRetained ||
    ICMS_ST_RETAINED_SOURCE_CSTS.has(sourceCst);

  const stBase = firstNumber(
    row?.icms_st_base,
    payload?.icms_st_base,
    payload?.icms_st_base_retained,
    payload?.vBCST,
    payload?.vBCSTRet,
    xmlText(group, 'vBCST'),
    xmlText(group, 'vBCSTRet'),
  );

  const stRate = firstNumber(
    row?.icms_st_rate,
    payload?.icms_st_rate,
    payload?.icms_st_rate_retained,
    payload?.pICMSST,
    payload?.pST,
    xmlText(group, 'pICMSST'),
    xmlText(group, 'pST'),
  );

  const stValue = firstNumber(
    row?.icms_st_value,
    payload?.icms_st_value,
    payload?.icms_st_value_retained,
    payload?.vICMSST,
    payload?.vICMSSTRet,
    xmlText(group, 'vICMSST'),
    xmlText(group, 'vICMSSTRet'),
  );

  const fcpStBase = firstNumber(
    row?.fcp_st_base,
    payload?.fcp_st_base,
    payload?.fcp_st_base_retained,
    payload?.vBCFCPST,
    payload?.vBCFCPSTRet,
    xmlText(group, 'vBCFCPST'),
    xmlText(group, 'vBCFCPSTRet'),
  );

  const fcpStRate = firstNumber(
    row?.fcp_st_rate,
    payload?.fcp_st_rate,
    payload?.fcp_st_rate_retained,
    payload?.pFCPST,
    payload?.pFCPSTRet,
    xmlText(group, 'pFCPST'),
    xmlText(group, 'pFCPSTRet'),
  );

  const fcpStValue = firstNumber(
    row?.fcp_st_value,
    payload?.fcp_st_value,
    payload?.fcp_st_value_retained,
    payload?.vFCPST,
    payload?.vFCPSTRet,
    xmlText(group, 'vFCPST'),
    xmlText(group, 'vFCPSTRet'),
  );

  const ownIcmsValue = isRetainedSource
    ? firstNumber(
      payload?.icms_substitute_value,
      payload?.vICMSSubstituto,
      xmlText(group, 'vICMSSubstituto'),
    )
    : firstNumber(
      row?.icms_value,
      payload?.icms_value,
      payload?.vICMS,
      xmlText(group, 'vICMS'),
    );

  const mvaRate = firstNumber(
    row?.icms_st_mva_rate,
    payload?.icms_st_mva_rate,
    payload?.pMVAST,
    xmlText(group, 'pMVAST'),
  );

  const baseQuantity = inboundBaseQuantity(row);

  let consumerRate = null;
  if (stRate !== null) {
    consumerRate = isRetainedSource ? stRate : stRate + (fcpStRate ?? 0);
  }

  const complete =
    stBase !== null &&
    stRate !== null &&
    stValue !== null &&
    baseQuantity !== null;

  function valueOrigin(columnValue, flatValues, xmlValues) {
    if (toNumberOrNull(columnValue) !== null) return 'columns';
    if (firstNumber(...flatValues) !== null) return 'raw_tax_payload_flat';
    if (firstNumber(...xmlValues) !== null) return 'raw_tax_payload_xml';
    return null;
  }

  const valueOrigins = {
    st_base: valueOrigin(
      row?.icms_st_base,
      [payload?.icms_st_base, payload?.icms_st_base_retained, payload?.vBCST, payload?.vBCSTRet],
      [xmlText(group, 'vBCST'), xmlText(group, 'vBCSTRet')],
    ),
    st_rate: valueOrigin(
      row?.icms_st_rate,
      [payload?.icms_st_rate, payload?.icms_st_rate_retained, payload?.pICMSST, payload?.pST],
      [xmlText(group, 'pICMSST'), xmlText(group, 'pST')],
    ),
    st_value: valueOrigin(
      row?.icms_st_value,
      [payload?.icms_st_value, payload?.icms_st_value_retained, payload?.vICMSST, payload?.vICMSSTRet],
      [xmlText(group, 'vICMSST'), xmlText(group, 'vICMSSTRet')],
    ),
  };

  const nonNullOrigins = Object.values(valueOrigins).filter(Boolean);
  const distinctOrigins = new Set(nonNullOrigins);
  const valuesFrom = distinctOrigins.size === 1
    ? [...distinctOrigins][0]
    : distinctOrigins.size > 1
      ? 'mixed'
      : null;

  return {
    complete,

    inbound_item_id: row?.inbound_item_id ?? null,
    inbound_id: row?.inbound_id ?? null,
    nfe_key: row?.nfe_key ?? null,
    nfe_item_seq: row?.nfe_item_seq ?? null,
    entry_created_at: row?.created_at ?? null,

    product_code: row?.product_code ?? null,
    product_id: row?.product_id ?? null,
    product_grade_id: row?.product_grade_id ?? null,
    grade_id: row?.grade_id ?? null,

    source_cst: sourceCst || null,
    source_icms_group: icmsGroup?.groupName ?? null,
    source_is_retained: isRetainedSource,
    source_values_from: valuesFrom,
    source_value_origins: valueOrigins,

    entry_unit: row?.unit ?? null,
    entry_quantity: toNumberOrNull(row?.quantity),
    entry_conversion_factor: toNumberOrNull(row?.conversion_factor) ?? 1,
    entry_base_quantity: baseQuantity,

    mva_rate: mvaRate,
    st_base: stBase,
    st_rate: stRate,
    st_value: stValue,
    consumer_rate: consumerRate,
    own_icms_value: ownIcmsValue,
    fcp_st_base: fcpStBase,
    fcp_st_rate: fcpStRate,
    fcp_st_value: fcpStValue,
  };
}

function calculateRetainedIcmsSt(origin, item) {
  const saleBaseQuantity = budgetItemBaseQuantity(item);

  if (!origin?.complete || saleBaseQuantity === null) return null;

  const ratio = saleBaseQuantity / origin.entry_base_quantity;
  const hasFcp = origin.fcp_st_value !== null && origin.fcp_st_value > 0;

  return {
    sale_base_quantity: saleBaseQuantity,
    entry_base_quantity: origin.entry_base_quantity,
    proportion: roundTo(ratio, 8),

    // ratio > 1: a venda é maior que a entrada usada como origem, ou seja o
    // ICMS-ST retido por unidade foi multiplicado pela quantidade vendida
    // (prática usual para CST 60). Sinalizado para auditoria, não bloqueia.
    extrapolated: ratio > 1,

    vBCSTRet: roundTo(origin.st_base * ratio, 2),
    pST: roundTo(origin.consumer_rate, 4),
    vICMSSubstituto: origin.own_icms_value === null
      ? null
      : roundTo(origin.own_icms_value * ratio, 2),
    vICMSSTRet: roundTo(origin.st_value * ratio, 2),

    vBCFCPSTRet: hasFcp
      ? roundTo((origin.fcp_st_base ?? origin.st_base) * ratio, 2)
      : null,
    pFCPSTRet: hasFcp ? roundTo(origin.fcp_st_rate, 4) : null,
    vFCPSTRet: hasFcp ? roundTo(origin.fcp_st_value * ratio, 2) : null,
  };
}

async function resolveBudgetItemIcmsStOrigin(
  item,
  stockMode,
) {
  const productCode = String(
    item?.product_code ||
    item?.sku ||
    '',
  ).trim();

  if (!productCode) {
    console.warn(
      '[BUDGET NFE][ICMS-ST ORIGIN][PRODUCT_CODE_REQUIRED]',
      {
        item,
      },
    );

    return null;
  }

  const gradeId =
    positiveInteger(item?.grade_id);

  /*
   * ================================================================
   * STOCK_WITH_LOT
   * ================================================================
   *
   * A origem fiscal deve pertencer:
   *
   *   - ao mesmo product_code;
   *   - ao mesmo lot_id selecionado no orçamento.
   *
   * IMPORTANTE:
   * O SQL NÃO filtra previamente os campos de ICMS-ST.
   *
   * Primeiro buscamos todas as possíveis entradas fiscais do lote.
   * Depois normalizeInboundIcmsSt() decide se a origem possui:
   *
   *   - colunas normalizadas;
   *   - payload JSON normalizado;
   *   - payload XML/xml2js;
   *
   * com ICMS-ST completo.
   * ================================================================
   */
  if (stockMode?.isWithLot) {
    const lotId =
      positiveInteger(item?.lot_id);

    if (!lotId) {
      console.warn(
        '[BUDGET NFE][ICMS-ST ORIGIN][LOT_REQUIRED]',
        {
          stock_mode:
            stockMode?.mode || null,

          product_code:
            productCode,

          lot_id:
            item?.lot_id ?? null,

          lot_code:
            item?.lot_code ??
            item?.lot_number ??
            null,

          grade_id:
            gradeId,
        },
      );

      return null;
    }

    const { rows } = await pool.query(
      `
        SELECT
          ii.inbound_item_id,
          ii.inbound_id,
          ii.nfe_key,
          ii.nfe_item_seq,
          ii.created_at,

          ii.product_code,
          ii.product_id,
          ii.product_grade_id,
          pg.grade_id,

          ii.lot_id,

          ii.unit,
          ii.quantity,
          ii.conversion_factor,

          ii.icms_cst,
          ii.icms_value,

          ii.icms_st_mva_rate,
          ii.icms_st_base,
          ii.icms_st_rate,
          ii.icms_st_value,

          ii.fcp_st_base,
          ii.fcp_st_rate,
          ii.fcp_st_value,

          ii.raw_tax_payload

        FROM public."inboundInvoiceItems" ii

        LEFT JOIN public."productsGrades" pg
          ON pg.product_grade_id =
             ii.product_grade_id

        WHERE ii.lot_id = $1
          AND TRIM(ii.product_code) = $2

        ORDER BY
          CASE
            WHEN $3::integer IS NOT NULL
             AND pg.grade_id = $3::integer
            THEN 0
            ELSE 1
          END,

          /*
           * Candidatos que já possuem as três colunas ST
           * ficam à frente dos demais.
           */
          CASE
            WHEN ii.icms_st_base IS NOT NULL
             AND ii.icms_st_rate IS NOT NULL
             AND ii.icms_st_value IS NOT NULL
            THEN 0
            ELSE 1
          END,

          ii.created_at DESC,
          ii.inbound_item_id DESC

        LIMIT $4
      `,
      [
        lotId,
        productCode,
        gradeId,
        ICMS_ST_CANDIDATE_LIMIT,
      ],
    );

    /*
     * ==============================================================
     * DIAGNÓSTICO
     * ==============================================================
     *
     * Muito importante para sabermos exatamente quais entradas
     * fiscais foram encontradas para o lote.
     */
    console.log(
      '[BUDGET NFE][ICMS-ST ORIGIN][LOT][CANDIDATES]',
      {
        stock_mode:
          stockMode?.mode || null,

        product_code:
          productCode,

        lot_id:
          lotId,

        lot_code:
          item?.lot_code ??
          item?.lot_number ??
          null,

        grade_id:
          gradeId,

        candidates_count:
          rows.length,

        candidates:
          rows.map(
            (row) => ({
              inbound_item_id:
                row.inbound_item_id,

              inbound_id:
                row.inbound_id,

              product_code:
                row.product_code,

              lot_id:
                row.lot_id,

              product_grade_id:
                row.product_grade_id,

              grade_id:
                row.grade_id,

              quantity:
                row.quantity,

              conversion_factor:
                row.conversion_factor,

              icms_cst:
                row.icms_cst,

              icms_st_base:
                row.icms_st_base,

              icms_st_rate:
                row.icms_st_rate,

              icms_st_value:
                row.icms_st_value,

              has_raw_tax_payload:
                Boolean(
                  row.raw_tax_payload &&
                  Object.keys(
                    typeof row.raw_tax_payload === 'object'
                      ? row.raw_tax_payload
                      : {},
                  ).length,
                ),

              nfe_key:
                row.nfe_key,

              nfe_item_seq:
                row.nfe_item_seq,
            }),
          ),
      },
    );

    /*
     * ==============================================================
     * NORMALIZAÇÃO DOS CANDIDATOS
     * ==============================================================
     */
    for (const row of rows) {
      const origin =
        normalizeInboundIcmsSt(row);

      console.log(
        '[BUDGET NFE][ICMS-ST ORIGIN][LOT][NORMALIZED]',
        {
          product_code:
            productCode,

          lot_id:
            lotId,

          inbound_item_id:
            row.inbound_item_id,

          inbound_id:
            row.inbound_id,

          source_cst:
            origin?.source_cst ??
            null,

          source_values_from:
            origin?.source_values_from ??
            null,

          entry_base_quantity:
            origin?.entry_base_quantity ??
            null,

          st_base:
            origin?.st_base ??
            null,

          st_rate:
            origin?.st_rate ??
            null,

          st_value:
            origin?.st_value ??
            null,

          complete:
            Boolean(origin?.complete),
        },
      );

      if (origin?.complete) {
        console.log(
          '[BUDGET NFE][ICMS-ST ORIGIN][LOT][SELECTED]',
          {
            product_code:
              productCode,

            lot_id:
              lotId,

            inbound_item_id:
              origin.inbound_item_id,

            inbound_id:
              origin.inbound_id,

            source_cst:
              origin.source_cst,

            source_values_from:
              origin.source_values_from,

            st_base:
              origin.st_base,

            st_rate:
              origin.st_rate,

            st_value:
              origin.st_value,
          },
        );

        return origin;
      }
    }

    if (rows.length) {
      console.warn(
        '[BUDGET NFE][ICMS-ST ORIGIN][LOT] Entradas encontradas sem ST completo.',
        {
          stock_mode:
            stockMode?.mode || null,

          product_code:
            productCode,

          lot_id:
            lotId,

          lot_code:
            item?.lot_code ??
            item?.lot_number ??
            null,

          inbound_item_ids:
            rows.map(
              (row) =>
                row.inbound_item_id,
            ),
        },
      );
    } else {
      console.warn(
        '[BUDGET NFE][ICMS-ST ORIGIN][LOT] Nenhuma entrada encontrada para o lote.',
        {
          stock_mode:
            stockMode?.mode || null,

          product_code:
            productCode,

          lot_id:
            lotId,

          lot_code:
            item?.lot_code ??
            item?.lot_number ??
            null,

          grade_id:
            gradeId,
        },
      );
    }

    return null;
  }

  /*
   * ================================================================
   * STOCK_SIMPLE
   * ================================================================
   *
   * Não usa:
   *
   *   - product_id;
   *   - lot_id.
   *
   * A chave canônica do ERP é:
   *
   *   product_code
   *
   * Assim como em STOCK_WITH_LOT, não fazemos um filtro prematuro
   * do ICMS-ST no SQL.
   * ================================================================
   */

  if (!stockMode?.isSimple) {
    console.warn(
      '[BUDGET NFE][ICMS-ST ORIGIN][INVALID_STOCK_MODE]',
      {
        stock_mode:
          stockMode?.mode ?? null,

        product_code:
          productCode,
      },
    );

    return null;
  }

  const { rows } = await pool.query(
    `
      SELECT
        ii.inbound_item_id,
        ii.inbound_id,
        ii.nfe_key,
        ii.nfe_item_seq,
        ii.created_at,

        ii.product_code,
        ii.product_id,
        ii.product_grade_id,
        pg.grade_id,

        ii.lot_id,

        ii.unit,
        ii.quantity,
        ii.conversion_factor,

        ii.icms_cst,
        ii.icms_value,

        ii.icms_st_mva_rate,
        ii.icms_st_base,
        ii.icms_st_rate,
        ii.icms_st_value,

        ii.fcp_st_base,
        ii.fcp_st_rate,
        ii.fcp_st_value,

        ii.raw_tax_payload

      FROM public."inboundInvoiceItems" ii

      LEFT JOIN public."productsGrades" pg
        ON pg.product_grade_id =
           ii.product_grade_id

      WHERE TRIM(ii.product_code) = $1

      ORDER BY
        CASE
          WHEN $2::integer IS NOT NULL
           AND pg.grade_id = $2::integer
          THEN 0
          ELSE 1
        END,

        /*
         * Entradas que já possuem ICMS-ST normalizado
         * têm preferência.
         */
        CASE
          WHEN ii.icms_st_base IS NOT NULL
           AND ii.icms_st_rate IS NOT NULL
           AND ii.icms_st_value IS NOT NULL
          THEN 0
          ELSE 1
        END,

        ii.created_at DESC,
        ii.inbound_item_id DESC

      LIMIT $3
    `,
    [
      productCode,
      gradeId,
      ICMS_ST_CANDIDATE_LIMIT,
    ],
  );

  console.log(
    '[BUDGET NFE][ICMS-ST ORIGIN][SIMPLE][CANDIDATES]',
    {
      stock_mode:
        stockMode?.mode || null,

      product_code:
        productCode,

      grade_id:
        gradeId,

      candidates_count:
        rows.length,

      candidates:
        rows.map(
          (row) => ({
            inbound_item_id:
              row.inbound_item_id,

            inbound_id:
              row.inbound_id,

            product_code:
              row.product_code,

            lot_id:
              row.lot_id,

            product_grade_id:
              row.product_grade_id,

            grade_id:
              row.grade_id,

            quantity:
              row.quantity,

            conversion_factor:
              row.conversion_factor,

            icms_cst:
              row.icms_cst,

            icms_st_base:
              row.icms_st_base,

            icms_st_rate:
              row.icms_st_rate,

            icms_st_value:
              row.icms_st_value,

            has_raw_tax_payload:
              Boolean(
                row.raw_tax_payload &&
                Object.keys(
                  typeof row.raw_tax_payload === 'object'
                    ? row.raw_tax_payload
                    : {},
                ).length,
              ),

            nfe_key:
              row.nfe_key,

            nfe_item_seq:
              row.nfe_item_seq,
          }),
        ),
    },
  );

  for (const row of rows) {
    const origin =
      normalizeInboundIcmsSt(row);

    console.log(
      '[BUDGET NFE][ICMS-ST ORIGIN][SIMPLE][NORMALIZED]',
      {
        product_code:
          productCode,

        inbound_item_id:
          row.inbound_item_id,

        inbound_id:
          row.inbound_id,

        source_cst:
          origin?.source_cst ??
          null,

        source_values_from:
          origin?.source_values_from ??
          null,

        entry_base_quantity:
          origin?.entry_base_quantity ??
          null,

        st_base:
          origin?.st_base ??
          null,

        st_rate:
          origin?.st_rate ??
          null,

        st_value:
          origin?.st_value ??
          null,

        complete:
          Boolean(origin?.complete),
      },
    );

    if (origin?.complete) {
      console.log(
        '[BUDGET NFE][ICMS-ST ORIGIN][SIMPLE][SELECTED]',
        {
          product_code:
            productCode,

          inbound_item_id:
            origin.inbound_item_id,

          inbound_id:
            origin.inbound_id,

          source_cst:
            origin.source_cst,

          source_values_from:
            origin.source_values_from,

          st_base:
            origin.st_base,

          st_rate:
            origin.st_rate,

          st_value:
            origin.st_value,
        },
      );

      return origin;
    }
  }

  if (rows.length) {
    console.warn(
      '[BUDGET NFE][ICMS-ST ORIGIN][SIMPLE] Entradas encontradas sem ST completo.',
      {
        stock_mode:
          stockMode?.mode || null,

        product_code:
          productCode,

        inbound_item_ids:
          rows.map(
            (row) =>
              row.inbound_item_id,
          ),
      },
    );
  } else {
    console.warn(
      '[BUDGET NFE][ICMS-ST ORIGIN][SIMPLE] Nenhuma entrada encontrada para o produto.',
      {
        stock_mode:
          stockMode?.mode || null,

        product_code:
          productCode,

        grade_id:
          gradeId,
      },
    );
  }

  return null;
}

/**
 * Origem fiscal gravada em "productsFiscalOrigins".
 *
 * Usada quando o produto não possui NF-e de entrada capaz de fornecer o
 * ICMS-ST retido. A linha é calculada exclusivamente pela regra fiscal do
 * produto ("productsFiscalV2" -> classificação -> perfil) e gravada pelo
 * botão "Atualizar dados fiscais".
 *
 * IMPORTANTE:
 * - NUNCA tem prioridade sobre inboundInvoiceItems: só é consultada depois
 *   que a busca na NF-e de entrada não devolveu uma origem completa;
 * - vale nos dois modos de estoque — em STOCK_WITH_LOT procura pelo lote e
 *   cai para a origem padrão do produto; em STOCK_SIMPLE usa direto a
 *   origem padrão (lot_id NULL);
 * - a origem é marcada como PRODUCT_FISCAL_ORIGIN e nunca é apresentada
 *   como se tivesse vindo de uma NF-e de fornecedor.
 *
 * As colunas de "productsFiscalOrigins" espelham as de inboundInvoiceItems,
 * por isso normalizeInboundIcmsSt() é reaproveitada sem adaptação.
 */
async function resolveStoredFiscalOriginIcmsSt(
  item,
  stockMode,
) {
  const productCode = String(
    item?.product_code ||
    item?.sku ||
    '',
  ).trim();

  if (!productCode) return null;

  // Em STOCK_SIMPLE não existe lote: busca apenas a origem padrão do produto.
  const lotId = stockMode?.isWithLot
    ? positiveInteger(item?.lot_id)
    : null;

  const productGradeId = positiveInteger(item?.product_grade_id);

  let row;

  try {
    row = await resolveStoredProductFiscalOrigin({
      productCode,
      lotId,
      productGradeId,
    });
  } catch (error) {
    console.warn(
      '[BUDGET NFE][ICMS-ST STORED FISCAL ORIGIN][FAILED]',
      {
        product_code: productCode,
        lot_id: lotId,
        error: error?.message || String(error),
      },
    );

    return null;
  }

  if (!row) return null;

  const normalized = normalizeInboundIcmsSt(row);

  if (!normalized?.complete) {
    console.warn(
      '[BUDGET NFE][ICMS-ST STORED FISCAL ORIGIN][INCOMPLETE]',
      {
        product_code: productCode,
        lot_id: lotId,
        fiscal_origin_id: row.fiscal_origin_id ?? null,
        icms_st_base: row.icms_st_base ?? null,
        icms_st_rate: row.icms_st_rate ?? null,
        icms_st_value: row.icms_st_value ?? null,
      },
    );

    return null;
  }

  const origin = {
    ...normalized,

    source_type: 'PRODUCT_FISCAL_ORIGIN',
    source_label: 'Origem fiscal do produto',
    source_values_from: 'productsFiscalOrigins',

    // Sem NF-e de entrada por definição desta origem.
    inbound_item_id: null,
    inbound_id: null,
    nfe_key: null,
    nfe_item_seq: null,

    fiscal_origin_id: row.fiscal_origin_id ?? null,
    fiscal_origin_scope: row.lot_id ? 'LOT' : 'PRODUCT',
    rule_id: row.rule_id ?? null,
    rule_source: row.rule_source ?? null,
    calculated_at: row.calculated_at ?? null,
  };

  const retained = calculateRetainedIcmsSt(origin, item);

  if (!retained) return null;

  console.log(
    '[BUDGET NFE][ICMS-ST STORED FISCAL ORIGIN][SELECTED]',
    {
      product_code: productCode,
      lot_id: lotId,
      stock_mode: stockMode?.mode || null,
      fiscal_origin_id: origin.fiscal_origin_id,
      fiscal_origin_scope: origin.fiscal_origin_scope,
      rule_source: origin.rule_source,
      vBCSTRet: retained.vBCSTRet,
      pST: retained.pST,
      vICMSSTRet: retained.vICMSSTRet,
    },
  );

  return { origin, retained };
}

/**
 * Fallback fiscal controlado para estoque legado de abertura.
 *
 * IMPORTANTE:
 * - só é permitido em STOCK_WITH_LOT;
 * - só é permitido para o lote sentinela LOTE-INICIAL;
 * - só é permitido quando NÃO existe nenhum inboundInvoiceItems para
 *   lot_id + product_code;
 * - a origem é marcada explicitamente como PRODUCT_FISCAL_RULE;
 * - nunca é apresentada como se tivesse vindo de uma NF-e de fornecedor.
 */
async function resolveInitialLotProductFiscalRuleIcmsSt(
  item,
  stockMode,
) {
  if (!stockMode?.isWithLot) return null;

  const productCode = String(
    item?.product_code ||
    item?.sku ||
    '',
  ).trim();

  const lotId = positiveInteger(item?.lot_id);
  const lotCode = String(
    item?.lot_code ||
    item?.lot_number ||
    '',
  )
    .trim()
    .toUpperCase();

  if (!productCode || !lotId || lotCode !== 'LOTE-INICIAL') {
    return null;
  }

  /*
   * Não mascarar uma origem fiscal real/incompleta.
   * Se existe qualquer entrada vinculada ao lote, ela continua sendo a fonte
   * fiscal obrigatória e o fallback por regra de produto NÃO é usado.
   */
  const inboundCheck = await pool.query(
    `
      SELECT 1
      FROM public."inboundInvoiceItems" ii
      WHERE ii.lot_id = $1
        AND TRIM(ii.product_code) = $2
      LIMIT 1
    `,
    [lotId, productCode],
  );

  if (inboundCheck.rowCount > 0) {
    return null;
  }

  const saleBaseQuantity = budgetItemBaseQuantity(item);
  if (saleBaseQuantity === null) {
    return null;
  }

  let calculated;

  try {
    calculated = await calculateProductFiscalCostRule(
      productCode,
      {
        // null faz a API usar products.cost_price como base, exatamente como
        // a regra de custo fiscal do produto foi desenhada para funcionar.
        unitCost: null,
        quantity: saleBaseQuantity,
      },
      pool,
    );
  } catch (error) {
    console.warn(
      '[BUDGET NFE][ICMS-ST PRODUCT RULE FALLBACK][FAILED]',
      {
        product_code: productCode,
        lot_id: lotId,
        lot_code: lotCode,
        error: error?.message || String(error),
      },
    );

    return null;
  }

  const sourceCst = normalizeCst(calculated?.inbound_cst);
  const stBase = toNumberOrNull(calculated?.icms_st_base);
  const stRate = toNumberOrNull(calculated?.icms_st_rate);
  const stValue = toNumberOrNull(calculated?.icms_st_value);

  if (
    sourceCst !== '60' ||
    stBase === null ||
    stRate === null ||
    stValue === null
  ) {
    console.warn(
      '[BUDGET NFE][ICMS-ST PRODUCT RULE FALLBACK][INCOMPLETE]',
      {
        product_code: productCode,
        lot_id: lotId,
        lot_code: lotCode,
        rule_id: calculated?.rule_id ?? null,
        inbound_cst: calculated?.inbound_cst ?? null,
        icms_st_base: calculated?.icms_st_base ?? null,
        icms_st_rate: calculated?.icms_st_rate ?? null,
        icms_st_value: calculated?.icms_st_value ?? null,
      },
    );

    return null;
  }

  const origin = {
    complete: true,

    source_type: 'PRODUCT_FISCAL_RULE',
    source_label: calculated?.source_label || 'Regra fiscal do produto',
    source_values_from: 'productFiscalCostRules',
    source_cst: sourceCst,
    source_is_retained: false,

    // Sem NF-e de entrada por definição deste fallback.
    inbound_item_id: null,
    inbound_id: null,
    nfe_key: null,
    nfe_item_seq: null,
    entry_created_at: null,

    product_code: productCode,
    product_id: item?.product_id ?? null,
    product_grade_id: null,
    grade_id: item?.grade_id ?? null,

    lot_id: lotId,
    lot_code: item?.lot_code ?? item?.lot_number ?? 'LOTE-INICIAL',

    rule_id: calculated?.rule_id ?? null,
    rule_source: calculated?.rule_source ?? null,
    fiscal_classification_id:
      calculated?.fiscal_classification_id ?? null,
    fiscal_profile_id:
      calculated?.fiscal_profile_id ?? null,

    // A regra já foi calculada para exatamente a quantidade da operação.
    entry_unit: item?.unit_code ?? item?.unit ?? null,
    entry_quantity: saleBaseQuantity,
    entry_conversion_factor: 1,
    entry_base_quantity: saleBaseQuantity,

    mva_rate: toNumberOrNull(calculated?.mva_pct),
    st_base: stBase,
    st_rate: stRate,
    st_value: stValue,
    consumer_rate: stRate,
    own_icms_value: null,
    fcp_st_base: null,
    fcp_st_rate: null,
    fcp_st_value: null,
  };

  const retained = {
    sale_base_quantity: saleBaseQuantity,
    entry_base_quantity: saleBaseQuantity,
    proportion: 1,
    extrapolated: false,

    vBCSTRet: roundTo(stBase, 2),
    pST: roundTo(stRate, 4),
    vICMSSubstituto: null,
    vICMSSTRet: roundTo(stValue, 2),

    vBCFCPSTRet: null,
    pFCPSTRet: null,
    vFCPSTRet: null,
  };

  console.warn(
    '[BUDGET NFE][ICMS-ST PRODUCT RULE FALLBACK][SELECTED]',
    {
      product_code: productCode,
      lot_id: lotId,
      lot_code: lotCode,
      source_type: origin.source_type,
      rule_id: origin.rule_id,
      rule_source: origin.rule_source,
      source_cst: origin.source_cst,
      sale_base_quantity: saleBaseQuantity,
      vBCSTRet: retained.vBCSTRet,
      pST: retained.pST,
      vICMSSTRet: retained.vICMSSTRet,
      detail:
        'Lote inicial sem NF-e de entrada vinculada. Os valores foram calculados '
        + 'pela regra fiscal ativa do produto e mantêm origem explícita '
        + 'PRODUCT_FISCAL_RULE.',
    },
  );

  return {
    origin,
    retained,
  };
}

function applyRetainedIcmsSt(item, origin, retained) {
  const { complete, ...originData } = origin;

  item.icms_st_origin = originData;
  item.icms_st_retained = retained;
  item.icms_st_origin_inbound_item_id = origin.inbound_item_id;

  // Nomes do layout NF-e (grupo ICMS60).
  item.vBCSTRet = retained.vBCSTRet;
  item.pST = retained.pST;
  item.vICMSSubstituto = retained.vICMSSubstituto;
  item.vICMSSTRet = retained.vICMSSTRet;
  item.vBCFCPSTRet = retained.vBCFCPSTRet;
  item.pFCPSTRet = retained.pFCPSTRet;
  item.vFCPSTRet = retained.vFCPSTRet;

  // Aliases snake_case para o builder e para o snapshot da tentativa.
  item.icms_st_base_retained = retained.vBCSTRet;
  item.icms_st_rate_retained = retained.pST;
  item.icms_substitute_value = retained.vICMSSubstituto;
  item.icms_st_value_retained = retained.vICMSSTRet;
  item.fcp_st_base_retained = retained.vBCFCPSTRet;
  item.fcp_st_rate_retained = retained.pFCPSTRet;
  item.fcp_st_value_retained = retained.vFCPSTRet;

  item.tax_calculation = {
    ...(item.tax_calculation || {}),
    icms_st_origin: originData,
    icms_st_retained: retained,
  };

  return item;
}

async function enrichBudgetItemForNfe(
  item,
  stockMode,
) {
  const sku = String(item?.sku || item?.product_code || '').trim();
  if (!sku) return item;

  /*
   * Não existe fallback ao Fiscal V2 aqui: o SELECT principal
   * (getBudgetFiscalItems) usa exatamente os mesmos predicados de
   * productsFiscalV2Api.getCurrent (product_code + is_current + is_active).
   * Quando products_fiscal_id / fiscal_classification_id vêm nulos, getCurrent
   * também retornaria nulo — a ausência de configuração fiscal é validada em
   * assertBudgetItemsAreIssuable, antes da emissão.
   */
  const merged = { ...item, sku, product_code: sku };

  const cst = normalizeCst(merged.cst_icms ?? merged.icms_cst ?? '');

  // Somente CST 60 precisa da origem do ICMS-ST retido anteriormente.
  if (cst !== '60') return merged;

  let origin =
    await resolveBudgetItemIcmsStOrigin(
      merged,
      stockMode,
    );

  let retained = origin ? calculateRetainedIcmsSt(origin, merged) : null;

  /*
   * Muitos produtos não possuem mais a NF-e do fornecedor. Quando a entrada
   * não forneceu uma origem ST completa, usamos a origem fiscal gravada em
   * "productsFiscalOrigins", calculada a partir de "productsFiscalV2".
   *
   * Vem depois da NF-e de entrada de propósito: a entrada real continua
   * sendo a fonte preferencial do ICMS-ST retido.
   */
  if (!origin || !retained) {
    const stored =
      await resolveStoredFiscalOriginIcmsSt(
        merged,
        stockMode,
      );

    if (stored) {
      origin = stored.origin;
      retained = stored.retained;
    }
  }

  /*
   * LOTE-INICIAL é estoque legado/de abertura e pode não possuir uma NF-e de
   * entrada histórica. Somente nesse cenário, e somente quando não existe
   * qualquer inboundInvoiceItems para o lote + SKU, usamos a regra fiscal do
   * produto como origem calculada explícita (PRODUCT_FISCAL_RULE).
   */
  if (!origin || !retained) {
    const fallback =
      await resolveInitialLotProductFiscalRuleIcmsSt(
        merged,
        stockMode,
      );

    if (fallback) {
      origin = fallback.origin;
      retained = fallback.retained;
    }
  }

  if (!origin || !retained) {
    const reason = !origin
      ? stockMode.isWithLot
        ? String(merged.lot_code || merged.lot_number || '').trim().toUpperCase() === 'LOTE-INICIAL'
          ? 'o lote inicial não possui entrada fiscal vinculada e nenhuma regra fiscal '
          + 'de produto CST 60 completa pôde ser aplicada'
          : 'nenhuma entrada do lote selecionado possui ICMS-ST completo '
          + '(colunas, payload normalizado ou XML: vBCST/pICMSST/vICMSST '
          + 'ou vBCSTRet/pST/vICMSSTRet) e não há origem fiscal gravada '
          + 'para o produto — use "Atualizar dados fiscais" no lote'
        : 'nenhuma nota de entrada do produto possui ICMS-ST completo '
        + '(colunas, payload normalizado ou XML: vBCST/pICMSST/vICMSST '
        + 'ou vBCSTRet/pST/vICMSSTRet) e não há origem fiscal gravada '
        + 'para o produto — use "Atualizar dados fiscais" no lote'
      : 'a quantidade do item do orçamento é inválida para o rateio do ICMS-ST';

    console.warn('[BUDGET NFE][ICMS-ST ORIGIN NOT RESOLVED]', {
      sku,
      cst,
      stock_mode: stockMode.mode,
      lot_id: merged.lot_id ?? null,
      lot_code: merged.lot_code ?? null,
      product_id: merged.product_id ?? null,
      grade_id: merged.grade_id ?? null,
      quantity: merged.quantity ?? null,
      conversion_factor: merged.conversion_factor ?? null,
      reason,
    });

    const error = new Error(
      `[NFE] SKU ${sku}: CST 60 exige a origem do ICMS-ST, mas ${reason}.`,
    );
    error.status = 422;
    error.code = 'BUDGET_ITEM_ICMS_ST_ORIGIN_NOT_FOUND';
    error.details = {
      sku,
      stock_mode: stockMode.mode,
      lot_id: merged.lot_id ?? null,
      lot_code: merged.lot_code ?? null,
      product_id: merged.product_id ?? null,
      grade_id: merged.grade_id ?? null,
      reason,
    };
    throw error;
  }

  applyRetainedIcmsSt(merged, origin, retained);

  if (retained.extrapolated && (origin.source_type || 'INBOUND_NFE') === 'INBOUND_NFE') {
    console.warn('[BUDGET NFE][ICMS-ST EXTRAPOLADO]', {
      sku,
      cst,
      inbound_item_id: origin.inbound_item_id,
      inbound_id: origin.inbound_id,
      entry_base_quantity: origin.entry_base_quantity,
      sale_base_quantity: retained.sale_base_quantity,
      proportion: retained.proportion,
      detail:
        'A quantidade vendida excede a quantidade da nota de entrada usada '
        + 'como origem. O ICMS-ST retido foi calculado por unidade e '
        + 'multiplicado pela quantidade vendida.',
    });
  }

  console.log('[BUDGET NFE][ICMS-ST ORIGIN RESOLVED]', {
    sku,
    cst,
    source_type: origin.source_type || 'INBOUND_NFE',
    inbound_item_id: origin.inbound_item_id ?? null,
    inbound_id: origin.inbound_id ?? null,
    rule_id: origin.rule_id ?? null,
    source_cst: origin.source_cst,
    source_values_from: origin.source_values_from,
    entry_base_quantity: origin.entry_base_quantity,
    sale_base_quantity: retained.sale_base_quantity,
    vBCSTRet: retained.vBCSTRet,
    pST: retained.pST,
    vICMSSubstituto: retained.vICMSSubstituto,
    vICMSSTRet: retained.vICMSSTRet,
    vFCPSTRet: retained.vFCPSTRet,
  });

  return merged;
}

async function getBudgetFiscalItems(budgetId) {
  const { rows } = await pool.query(
    `
      SELECT
        bi.budget_item_id,
        bi.budget_id,
        bi.product_code,
        bi.barcode_id,
        pbc.barcode,
        bi.description,
        bi.manufacturer_ref,
        bi.grade_id,
        bi.lot_id,
        psl.lot_code,
        g.grade,
        bi.unit_code,
        bi.conversion_factor,
        bi.quantity,
        bi.unit_price,
        bi.discount_value,

        p.product_id,
        p.product_stock_id,

        pf.products_fiscal_id,
        pf.fiscal_classification_id,
        pf.version AS fiscal_version,
        pf.effective_from AS fiscal_effective_from,
        pf.effective_to AS fiscal_effective_to,
        pf.source_system AS fiscal_source_system,
        pf.source_reference AS fiscal_source_reference,
        pf.extra_payload AS product_fiscal_extra_payload,

        fc.classification_name,
        fc.description AS classification_description,
        fc.ncm_code AS ncm,
        fc.ncm_description,
        fc.ex_tipi,
        fc.cest_code AS cest,
        fc.cest_description,

        fp.fiscal_profile_id,
        fp.profile_name,
        fp.description AS profile_description,
        fp.icms_cst,
        fp.icms_rate,
        fp.cfop_entry,
        fp.cfop_exit,
        fp.origin_code,
        fp.pis_cst,
        fp.pis_rate,
        fp.cofins_cst,
        fp.cofins_rate,
        fp.benefit_code,

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
        fc.tax_reform_details

      FROM public."budgetsItems" bi

      LEFT JOIN public.grades g
        ON g.grade_id = bi.grade_id

      /*
       * Número do lote para o snapshot da tentativa.
       * productsStockLots.lot_code é text e a PK é lot_id (bigint), do mesmo
       * tipo de budgetsItems.lot_id — confirmado no schema em 16/09/2026.
       */
      LEFT JOIN public."productsStockLots" psl
        ON psl.lot_id = bi.lot_id

      LEFT JOIN public.products p
        ON p.product_code = bi.product_code

      LEFT JOIN public."productsBarCode" pbc
        ON pbc.barcode_id = bi.barcode_id
       AND pbc.product_code = bi.product_code

      /*
       * LATERAL com LIMIT 1: se houver mais de um vínculo marcado como
       * is_current para o mesmo product_code, um LEFT JOIN simples duplicaria
       * o item na NF-e (e nos totais). Mesmo padrão já usado em budgetsApi.
       */
      LEFT JOIN LATERAL (
        SELECT pf_current.*
        FROM public."productsFiscalV2" pf_current
        WHERE pf_current.product_code = bi.product_code
          AND pf_current.is_current = TRUE
          AND pf_current.is_active = TRUE
        ORDER BY pf_current.version DESC, pf_current.products_fiscal_id DESC
        LIMIT 1
      ) pf ON TRUE

      LEFT JOIN public."fiscalClassificationV2" fc
        ON fc.fiscal_classification_id = pf.fiscal_classification_id
       AND fc.is_active = TRUE

      LEFT JOIN public."fiscalProfileV2" fp
        ON fp.fiscal_profile_id = fc.fiscal_profile_id
       AND fp.is_active = TRUE

      WHERE bi.budget_id = $1
      ORDER BY bi.budget_item_id ASC
    `,
    [budgetId],
  );

  const baseItems =
    rows
      .map(rowToFiscalBudgetItem)
      .filter(Boolean);

  const stockMode =
    await resolveActiveStockMode();

  console.log(
    '[BUDGET NFE][STOCK_MODE]',
    {
      mode:
        stockMode.mode,

      isSimple:
        stockMode.isSimple,

      isWithLot:
        stockMode.isWithLot,

      source:
        stockMode.feature?.source,
    },
  );

  /*
   * A ordem continua preservada,
   * importante para nItem da NF-e.
   */
  return mapWithConcurrency(
    baseItems,
    ITEM_ENRICHMENT_CONCURRENCY,

    (item) =>
      enrichBudgetItemForNfe(
        item,
        stockMode,
      ),
  );
}

/**
 * Validações obrigatórias antes de montar o payload da NF-e.
 * Usada tanto pelo preview (getBudgetNfePreparedData) quanto pela emissão
 * (issueBudgetNfe) para que as duas rotas nunca divirjam.
 */
function assertBudgetItemsAreIssuable(items) {
  if (!items.length) {
    const error = new Error('O orçamento não possui itens para emitir a NF-e.');
    error.status = 422;
    error.code = 'BUDGET_WITHOUT_ITEMS';
    throw error;
  }

  const itemsWithoutFiscalConfiguration = items.filter(
    (item) => !item.products_fiscal_id || !item.fiscal_classification_id,
  );

  if (itemsWithoutFiscalConfiguration.length) {
    const skus = itemsWithoutFiscalConfiguration.map((item) => item.sku);

    const error = new Error(
      `Produto(s) sem configuração fiscal ativa: ${skus.join(', ')}.`,
    );
    error.status = 422;
    error.code = 'BUDGET_ITEMS_WITHOUT_FISCAL_CONFIGURATION';
    error.details = { skus };
    throw error;
  }

  return items;
}

// ============================================================================
// PREPARA ORÇAMENTO COMPLETO PARA NF-e / PREVIEW
// ============================================================================

export async function getBudgetNfePreparedData(budgetId) {
  const budget = await getBudgetIssuedData(budgetId);

  const items = await getBudgetFiscalItems(
    budget.budget_id,
  );

  assertBudgetItemsAreIssuable(items);

  return {
    ...budget,

    // IMPORTANTE:
    // substitui os itens crus pelos itens fiscais/enriquecidos.
    items,
  };
}

function providerDocument(data) {
  if (!data) return {};

  if (Array.isArray(data)) {
    return providerDocument(data[0]);
  }

  if (Array.isArray(data.documents)) {
    return data.documents[0] || {};
  }

  if (Array.isArray(data.data)) {
    return providerDocument(data.data);
  }

  if (data.data && typeof data.data === 'object') {
    return providerDocument(data.data);
  }

  if (Array.isArray(data.resumo)) {
    return data.resumo[0] || {};
  }

  if (data.resumo && typeof data.resumo === 'object') {
    return data.resumo;
  }

  return data;
}

function providerDocuments(data) {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data.flatMap((entry) => providerDocuments(entry));
  }

  if (Array.isArray(data.documents)) {
    return providerDocuments(data.documents);
  }

  if (Array.isArray(data.data)) {
    return providerDocuments(data.data);
  }

  if (Array.isArray(data.resumo)) {
    return providerDocuments(data.resumo);
  }

  if (data.data && typeof data.data === 'object') {
    return providerDocuments(data.data);
  }

  if (data.resumo && typeof data.resumo === 'object') {
    return providerDocuments(data.resumo);
  }

  if (typeof data === 'object') return [data];

  return [];
}

function firstProviderValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }

  return null;
}

function providerIdFrom(document, data) {
  return firstProviderValue(
    document?.id,
    document?._id,
    document?.documentId,
    document?.document_id,
    document?.idDocumento,
    data?.id,
    data?._id,
    data?.documentId,
    data?.document_id,
    data?.idDocumento,
  );
}

function providerProtocolFrom(document, data) {
  return firstProviderValue(
    document?.protocolo,
    document?.protocol,
    document?.numeroProtocolo,
    document?.numero_protocolo,
    data?.protocolo,
    data?.protocol,
    data?.numeroProtocolo,
    data?.numero_protocolo,
  );
}

function providerStatusFrom(document, data) {
  return String(
    firstProviderValue(
      document?.status,
      document?.situacao,
      document?.state,
      data?.status,
      data?.situacao,
      data?.state,
    ) || '',
  ).trim().toUpperCase();
}

function providerMessageFrom(document, data) {
  return firstProviderValue(
    document?.mensagem,
    document?.message,
    document?.motivo,
    data?.mensagem,
    data?.message,
    data?.motivo,
  );
}

function providerAccessKeyFrom(document, data) {
  return firstProviderValue(
    document?.chave,
    document?.chaveAcesso,
    document?.chave_acesso,
    document?.accessKey,
    data?.chave,
    data?.chaveAcesso,
    data?.chave_acesso,
    data?.accessKey,
  );
}

/**
 * Localiza, na resposta de tecnospeedNfeApi.listarNFe, o documento que
 * pertence EXATAMENTE ao idIntegracao informado.
 *
 * Por que isto é obrigatório: listarNFe não é um lookup. Quando o endpoint
 * direto (/nfe/{cnpj}/{idIntegracao}/resumo) devolve 404 — o caso normal de uma
 * tentativa nova — ele cai na consulta por período dos últimos 90 dias e
 * filtra com matchQ, que compara por SUBSTRING e também por "somente dígitos"
 * do termo buscado. Para idIntegracao 'BUD-1-A1' o termo em dígitos é '11',
 * então qualquer NF-e do período cujo número ou CNPJ do destinatário contenha
 * '11' é retornada. Usar o primeiro documento da lista faria a emissão adotar
 * a NF-e de outro orçamento e nunca transmitir a real.
 *
 * Também protege contra colisão de prefixo: 'BUD-1-A1' é substring de
 * 'BUD-1-A10', 'BUD-1-A11' e dos ids de recuperação 'BUD-1-A1-R<timestamp>'.
 */
function findProviderDocumentByIntegrationId(response, integrationId) {
  if (!response?.ok) return null;

  const expected = String(integrationId ?? '').trim();
  if (!expected) return null;

  const documents = providerDocuments(response.data);
  if (!documents.length) return null;

  // Caminho do lookup direto: o próprio provedor resolveu o idIntegracao pela
  // URL, então o documento retornado é, por construção, o correto — mesmo que
  // o corpo do /resumo não repita o campo idIntegracao.
  if (String(response.meta?.directIdIntegracao ?? '').trim() === expected) {
    return documents[0];
  }

  return (
    documents.find(
      (document) => String(
        document?.idIntegracao ?? document?.idintegracao ?? '',
      ).trim() === expected,
    ) || null
  );
}

function normalizeProviderStatus(document, data) {
  const rawStatus = providerStatusFrom(document, data);
  const message = String(providerMessageFrom(document, data) || '').trim();

  if (
    ['AUTORIZADA', 'AUTORIZADO', 'CONCLUIDO', 'CONCLUÍDO'].includes(rawStatus) ||
    /autorizado\s+o\s+uso|autorizada/i.test(message)
  ) {
    return 'AUTORIZADA';
  }

  if (['REJEITADA', 'REJEITADO'].includes(rawStatus) || /rejei[cç][aã]o/i.test(message)) {
    return 'REJEITADA';
  }

  if (['CANCELADA', 'CANCELADO'].includes(rawStatus)) return 'CANCELADA';
  if (['DENEGADA', 'DENEGADO'].includes(rawStatus)) return 'DENEGADA';

  if (
    ['PROCESSANDO', 'PROCESSAMENTO', 'ENVIANDO', 'PENDENTE'].includes(rawStatus) ||
    /processamento|processando/i.test(message)
  ) {
    return 'PROCESSANDO';
  }

  return rawStatus || null;
}

function logProviderResult(label, result) {
  try {
    console.log(label, JSON.stringify(result, null, 2));
  } catch {
    console.log(label, result);
  }
}

const ATTEMPTS_TABLE = 'public."budgetsNfeAttempts"';
const ATTEMPT_ITEMS_TABLE = 'public."budgetsNfeAttemptItems"';
const STATUS_TABLE = 'public."nfeStatusMap"';

const STATUS_ALIASES = Object.freeze({
  ENVIANDO: ['ENVIANDO', 'SENDING', 'PROCESSANDO', 'PROCESSING', 'PENDENTE', 'PENDING'],
  PROCESSANDO: ['PROCESSANDO', 'PROCESSING', 'ENVIANDO', 'SENDING', 'PENDENTE', 'PENDING'],
  AUTORIZADA: ['AUTORIZADA', 'AUTORIZADO', 'AUTHORIZED'],
  REJEITADA: ['REJEITADA', 'REJEITADO', 'REJECTED'],
  DENEGADA: ['DENEGADA', 'DENEGADO', 'DENIED'],
  CANCELADA: ['CANCELADA', 'CANCELADO', 'CANCELLED', 'CANCELED'],
  ERRO: ['ERRO', 'ERROR'],
});

// Status finais que permitem uma nova tentativa de emissão para o orçamento.
const RETRYABLE_ATTEMPT_STATUS_CODES = new Set([
  'ERRO', 'ERROR',
  'REJEITADA', 'REJEITADO', 'REJECTED',
  'DENEGADA', 'DENEGADO', 'DENIED',
]);

// Subconjunto em que o número de NF-e reservado pode ser reaproveitado: a NF-e
// nunca passou a existir na SEFAZ. DENEGADA fica de fora de propósito — o
// número é consumido e precisa de inutilização de numeração.
const REUSABLE_NFE_NUMBER_STATUS_CODES = new Set([
  'ERRO', 'ERROR',
  'REJEITADA', 'REJEITADO', 'REJECTED',
]);

async function resolveNfeStatus(client, rawStatus) {
  const normalized = String(rawStatus || 'PROCESSANDO').trim().toUpperCase();
  const candidates = STATUS_ALIASES[normalized] || [normalized];
  const { rows } = await client.query(
    `
      SELECT nfe_status_id, code, name, is_final, is_authorized
      FROM ${STATUS_TABLE}
      WHERE is_active = TRUE
        AND (UPPER(code) = ANY($1::text[]) OR UPPER(name) = ANY($1::text[]))
      ORDER BY array_position($1::text[], UPPER(code)) NULLS LAST,
               nfe_status_id
      LIMIT 1
    `,
    [candidates],
  );
  if (!rows[0]) {
    const error = new Error(`Mapeamento de status NF-e não encontrado: ${normalized}.`);
    error.status = 500;
    error.code = 'NFE_STATUS_MAP_MISSING';
    throw error;
  }
  return rows[0];
}

function fiscalItemSnapshot(item, attemptId, itemNumber) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  const discount = Number(item.discount_value || 0);
  const gross = quantity * unitPrice;
  const net = Math.max(0, gross - discount);
  return {
    attempt_id: attemptId,
    budget_item_id: item.budget_item_id ?? null,
    item_number: itemNumber,
    product_id: item.product_id ?? null,
    product_code: String(item.product_code || item.sku || '').trim(),
    barcode: item.barcode ?? null,
    description: item.description,
    products_fiscal_id: item.products_fiscal_id ?? null,
    fiscal_classification_id: item.fiscal_classification_id ?? null,
    fiscal_profile_id: item.fiscal_profile_id ?? null,
    fiscal_version: item.fiscal_version ?? null,
    fiscal_effective_from: item.fiscal_effective_from ?? null,
    fiscal_effective_to: item.fiscal_effective_to ?? null,
    fiscal_source_system: item.fiscal_source_system ?? null,
    fiscal_source_reference: item.fiscal_source_reference ?? null,
    classification_name: item.classification_name ?? null,
    classification_description: item.classification_description ?? null,
    ncm_code: item.ncm_code ?? item.ncm ?? null,
    ncm_description: item.ncm_description ?? null,
    ex_tipi: item.ex_tipi ?? null,
    cest_code: item.cest_code ?? item.cest ?? null,
    cest_description: item.cest_description ?? null,
    commercial_unit: item.unit_code ?? item.unit ?? null,
    taxable_unit: item.taxable_unit ?? item.unit_code ?? item.unit ?? null,
    is_unit: item.is_unit ?? null,
    quantity,
    taxable_quantity: Number(item.taxable_quantity ?? quantity),
    unit_price: unitPrice,
    taxable_unit_price: Number(item.taxable_unit_price ?? unitPrice),
    gross_total: gross,
    discount_amount: discount,
    net_total: net,
    product_stock_id: item.product_stock_id ?? null,
    lot_id: item.lot_id ?? null,
    lot_number: item.lot_number ?? item.lot_code ?? null,
    fiscal_profile_name: item.profile_name ?? item.fiscal_profile ?? null,
    fiscal_profile_description: item.profile_description ?? null,
    origin_code: item.origin_code ?? null,
    icms_cst: item.icms_cst ?? null,
    icms_rate: Number(item.icms_rate || 0),
    cfop_entry: item.cfop_entry ?? null,
    cfop_exit: item.cfop_exit ?? null,
    cfop_used: item.cfop ?? item.cfop_used ?? null,
    pis_cst: item.pis_cst ?? null,
    pis_rate: Number(item.pis_rate || 0),
    cofins_cst: item.cofins_cst ?? null,
    cofins_rate: Number(item.cofins_rate || 0),
    benefit_code: item.benefit_code ?? null,
    is_cst: item.is_cst ?? null,
    is_classification: item.is_classification ?? null,
    is_rate: Number(item.is_rate || 0),
    is_specific_rate: Number(item.is_specific_rate || 0),
    ibscbs_cst: item.ibscbs_cst ?? null,
    ibscbs_classification: item.ibscbs_classification ?? null,
    ibs_uf_rate: Number(item.ibs_uf_rate || 0),
    ibs_municipal_rate: Number(item.ibs_municipal_rate || 0),
    cbs_rate: Number(item.cbs_rate || 0),
    donation_indicator: Number(item.donation_indicator ?? 1),
    product_fiscal_snapshot: item.product_fiscal_extra_payload || {},
    classification_snapshot: {
      classification_name: item.classification_name ?? null,
      ncm_code: item.ncm_code ?? item.ncm ?? null,
      cest_code: item.cest_code ?? item.cest ?? null,
    },
    fiscal_profile_snapshot: {
      profile_name: item.profile_name ?? null,
      icms_cst: item.icms_cst ?? null,
      icms_rate: Number(item.icms_rate || 0),
      pis_cst: item.pis_cst ?? null,
      pis_rate: Number(item.pis_rate || 0),
      cofins_cst: item.cofins_cst ?? null,
      cofins_rate: Number(item.cofins_rate || 0),
    },
    tax_reform_details: item.tax_reform_details || {},
    tax_calculation: item.tax_calculation || {},
    budget_item_snapshot: item,
    provider_item_payload: {},
  };
}

async function insertAttemptItem(client, data) {
  const columns = Object.keys(data);
  await client.query(
    `INSERT INTO ${ATTEMPT_ITEMS_TABLE} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    columns.map((column) => data[column]),
  );
}

async function claimBudgetForIssuance(budget, items, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT budget_id FROM public.budgets WHERE budget_id = $1 FOR UPDATE',
      [budget.budget_id],
    );
    if (!locked.rowCount) {
      const error = new Error('Orçamento não encontrado.');
      error.status = 404;
      error.code = 'BUDGET_NOT_FOUND';
      throw error;
    }

    const latest = await client.query(
      `SELECT a.*, s.code AS status_code, s.is_final, s.is_authorized FROM ${ATTEMPTS_TABLE} a JOIN ${STATUS_TABLE} s ON s.nfe_status_id = a.nfe_status_id WHERE a.budget_id = $1 ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE OF a`,
      [budget.budget_id],
    );
    const previous = latest.rows[0];
    const previousCode = String(previous?.status_code || '').trim().toUpperCase();
    const retryable = RETRYABLE_ATTEMPT_STATUS_CODES.has(previousCode);
    if (previous && (previous.is_authorized || (!previous.is_final && !retryable))) {
      const error = new Error(
        previous.is_authorized
          ? 'Este orçamento já possui uma NF-e autorizada.'
          : 'A NF-e deste orçamento já está sendo enviada ou processada.',
      );
      error.status = 409;
      error.code = 'BUDGET_NFE_ALREADY_ISSUED';
      error.details = previous;
      throw error;
    }

    /*
     * NUMERAÇÃO DA NF-e
     *
     * Uma NF-e rejeitada ou que falhou no envio nunca foi autorizada pela
     * SEFAZ, portanto o número reservado para ela pode ser reaproveitado na
     * nova tentativa — evitando lacunas que exigiriam inutilização de
     * numeração. DENEGADA e CANCELADA NÃO entram aqui: nesses casos o número
     * já foi registrado na SEFAZ e precisa ser queimado.
     *
     * Quando não há número reaproveitável, public.nfe (que guarda o último
     * número reservado) é incrementado dentro desta mesma transação, impedindo
     * que duas emissões simultâneas recebam o mesmo número.
     */
    const previousNfeNumber = positiveInteger(previous?.nfe_number);
    const canReusePreviousNumber =
      previousNfeNumber !== null
      && REUSABLE_NFE_NUMBER_STATUS_CODES.has(previousCode);

    let reservedNfeNumber = canReusePreviousNumber ? previousNfeNumber : null;

    if (reservedNfeNumber === null) {
      const reservedNumberResult = await client.query(
        `
          WITH active_sequence AS (
            SELECT id
            FROM public.nfe
            WHERE is_active = TRUE
            ORDER BY id
            LIMIT 1
            FOR UPDATE
          )
          UPDATE public.nfe seq
          SET sequence_number = seq.sequence_number + 1,
              updated_at = NOW()
          FROM active_sequence selected
          WHERE seq.id = selected.id
          RETURNING seq.sequence_number AS reserved_nfe_number
        `,
      );

      reservedNfeNumber = positiveInteger(
        reservedNumberResult.rows[0]?.reserved_nfe_number,
      );

      if (!reservedNfeNumber) {
        const error = new Error('Nenhuma sequência ativa de NF-e foi configurada.');
        error.status = 422;
        error.code = 'NFE_ACTIVE_SEQUENCE_NOT_FOUND';
        throw error;
      }

      if (previousNfeNumber !== null) {
        console.warn('[BUDGET NFE][NUMERO QUEIMADO]', {
          budget_id: budget.budget_id,
          previous_attempt_id: previous?.attempt_id ?? null,
          previous_status: previousCode || null,
          burned_nfe_number: previousNfeNumber,
          new_nfe_number: reservedNfeNumber,
          detail:
            'O número da tentativa anterior não pode ser reaproveitado neste '
            + 'status e exige inutilização de numeração junto à SEFAZ.',
        });
      }
    } else {
      console.log('[BUDGET NFE][NUMERO REAPROVEITADO]', {
        budget_id: budget.budget_id,
        previous_attempt_id: previous?.attempt_id ?? null,
        previous_status: previousCode || null,
        nfe_number: reservedNfeNumber,
      });
    }

    const status = await resolveNfeStatus(client, 'ENVIANDO');
    const attemptNumber = Number(previous?.attempt_number || 0) + 1;
    const integrationId = `BUD-${budget.budget_id}-A${attemptNumber}`;
    const inserted = await client.query(
      `
        INSERT INTO ${ATTEMPTS_TABLE} (
          budget_id, attempt_number, nfe_status_id, nfe_environment,
          operation_type_id, customer_id, customer_name, customer_tax_id,
          customer_email, customer_phone, issue_date, subtotal,
          discount_total, freight_value, total_amount, integration_id,
          requested_by, request_payload
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb
        ) RETURNING *
      `,
      [
        budget.budget_id, attemptNumber, status.nfe_status_id,
        process.env.NFE_AMBIENTE || null, budget.operation_type_id || null,
        budget.customer_id || null, budget.customer_name || null,
        budget.customer_tax_id || null,
        budget.customer_email || budget.email || null,
        budget.customer_phone || budget.phone || null,
        budget.issue_date || new Date(), Number(budget.subtotal || 0),
        Number(budget.total_discount || 0),
        Number(budget.shipping?.freight_value || budget.freight_value || 0),
        Number(budget.total_amount || budget.total || 0), integrationId,
        userId || null, JSON.stringify({ budget_id: budget.budget_id }),
      ],
    );
    const attemptWithNumber = await client.query(
      `
        UPDATE ${ATTEMPTS_TABLE}
        SET nfe_number = $2,
            updated_at = NOW()
        WHERE attempt_id = $1
        RETURNING *
      `,
      [inserted.rows[0].attempt_id, reservedNfeNumber],
    );

    const attempt = attemptWithNumber.rows[0];
    for (let index = 0; index < items.length; index += 1) {
      await insertAttemptItem(client, fiscalItemSnapshot(items[index], attempt.attempt_id, index + 1));
    }
    await client.query('COMMIT');
    return attempt;
  } catch (error) {
    // O ROLLBACK não pode mascarar o erro original (se a conexão já estiver
    // inutilizável, ele próprio lança).
    await client.query('ROLLBACK').catch((rollbackError) => {
      console.error(
        '[nfeIssuanceApi][claimBudgetForIssuance][rollback]',
        rollbackError?.message || rollbackError,
      );
    });
    throw error;
  } finally {
    client.release();
  }
}

async function persistIssueResult(attemptId, values) {
  // Duas consultas independentes, sem transação: o pool resolve por si e não
  // há risco de vazar conexão.
  const status = await resolveNfeStatus(pool, values.status);
  await pool.query(
    `UPDATE ${ATTEMPTS_TABLE} SET nfe_status_id = $2, provider_id = $3, integration_id = $4, protocol = $5, nfe_environment = $6, provider_response = $7::jsonb, error_code = NULL, error_message = NULL, last_checked_at = NOW(), authorized_at = CASE WHEN $8 THEN COALESCE(authorized_at, NOW()) ELSE authorized_at END, rejected_at = CASE WHEN $9 THEN COALESCE(rejected_at, NOW()) ELSE rejected_at END, updated_at = NOW() WHERE attempt_id = $1`,
    [attemptId, status.nfe_status_id, values.providerId, values.idIntegracao,
      values.protocol, values.environment, JSON.stringify(values.providerResponse || {}),
      Boolean(status.is_authorized), Boolean(status.is_final && !status.is_authorized)],
  );
}

async function persistIssueError(attemptId, error) {
  const status = await resolveNfeStatus(
    pool,
    error?.code === 'NFE_REJECTED' ? 'REJEITADA' : 'ERRO',
  );
  await pool.query(
    `UPDATE ${ATTEMPTS_TABLE} SET nfe_status_id = $2, error_code = $3, error_message = LEFT($4, 2000), provider_response = $5::jsonb, last_checked_at = NOW(), updated_at = NOW() WHERE attempt_id = $1`,
    [attemptId, status.nfe_status_id, error?.code || 'NFE_ISSUE_ERROR',
      String(error?.message || error || 'Erro desconhecido'),
      JSON.stringify(error?.details || {})],
  );
}

export async function issueBudgetNfe(budgetId, { userId } = {}) {
  const budget = await getBudgetIssuedData(budgetId);

  const items = await getBudgetFiscalItems(budget.budget_id);

  assertBudgetItemsAreIssuable(items);

  const attempt = await claimBudgetForIssuance(budget, items, userId);

  try {
    const payload = await tecnospeedNfeApi.buildNFeFromOrder({
      header: {
        ...budget,
        id: null,
        order_id: null,
        budget_id: budget.budget_id,
        numero: attempt.nfe_number,
        nfe_number: attempt.nfe_number,

        // The authorized production NF-e used indFinal=1. Do not derive
        // consumidorFinal from the existence of a state registration:
        // taxpayer status (indIEDest) and final-consumer status (indFinal)
        // are independent fiscal concepts. This flag applies only to the
        // direct Budget issuance flow and does not modify Orders.
        consumidor_final: true,
        consumidorFinal: true,

        shipping: budget.shipping || null,
      },
      items,
    });

    let idIntegracao = attempt.integration_id;
    payload.idIntegracao = idIntegracao;
    // Enforce the atomically reserved number even if the generic builder
    // receives another legacy/default sequence value.
    payload.numero = attempt.nfe_number;

    // Recovery path: if a previous HTTP call reached the provider but the
    // local persistence failed, reuse the provider document instead of
    // transmitting another NF-e.
    const existing = await tecnospeedNfeApi.listarNFe({ q: idIntegracao });
    logProviderResult('[BUDGET NFE][CONSULTA PROVIDER]', existing);

    let result;

    const existingDocument = findProviderDocumentByIntegrationId(
      existing,
      idIntegracao,
    );
    const existingStatus = String(existingDocument?.status || '').toUpperCase();

    if (existingDocument && !['REJEITADA', 'REJEITADO', 'ERRO'].includes(existingStatus)) {
      result = { ok: true, data: existingDocument, recovered: true };
    } else {
      if (existingDocument) {
        idIntegracao = `${attempt.integration_id}-R${Date.now()}`;
        payload.idIntegracao = idIntegracao;
      }

      console.log('[BUDGET NFE][ANTES DO ENVIO]', {
        budgetId: budget.budget_id,
        idIntegracao,
        ambiente: process.env.NFE_AMBIENTE || null,
        consumidorFinal: payload.consumidorFinal,
      });

      result = await tecnospeedNfeApi.emitirNFe(payload);
      logProviderResult('[BUDGET NFE][RESPOSTA COMPLETA]', result);
    }

    await pool.query(
      `UPDATE ${ATTEMPTS_TABLE} SET integration_id = $2, request_payload = $3::jsonb, updated_at = NOW() WHERE attempt_id = $1`,
      [attempt.attempt_id, idIntegracao, JSON.stringify(payload)],
    );

    if (!result?.ok) {
      const message =
        result?.error?.message?.message ||
        result?.error?.message ||
        result?.message ||
        result?.error ||
        'O provedor recusou a emissão da NF-e.';

      const error = new Error(String(message));
      error.status = Number(result?.status) || 502;
      error.code = 'NFE_PROVIDER_ERROR';
      error.details = result?.error || null;
      throw error;
    }

    const document = providerDocument(result.data);
    const providerId = providerIdFrom(document, result.data);
    const protocol = providerProtocolFrom(document, result.data);
    let status = normalizeProviderStatus(document, result.data);

    if (!providerId) {
      const error = new Error(
        'A API fiscal não retornou o identificador da NF-e. O envio não pôde ser confirmado.',
      );
      error.status = 502;
      error.code = 'NFE_PROVIDER_ID_MISSING';
      error.details = result.data || result;
      throw error;
    }

    if (!status && providerId) status = 'PROCESSANDO';

    if (['REJEITADA', 'REJEITADO', 'ERRO'].includes(status)) {
      const error = new Error(
        providerMessageFrom(document, result.data) ||
        'A NF-e foi rejeitada pelo provedor fiscal.',
      );
      error.status = 422;
      error.code = 'NFE_REJECTED';
      error.details = document;
      throw error;
    }
    const environment =
      document.ambiente || result.data?.ambiente ||
      process.env.NFE_AMBIENTE || null;

    await persistIssueResult(attempt.attempt_id, {
      status,
      providerId,
      idIntegracao,
      protocol,
      environment,
      providerResponse: result.data || {},
    });

    return {
      budget_id: budget.budget_id,
      attempt_id: attempt.attempt_id,
      provider_id: providerId,
      id_integracao: idIntegracao,
      protocol,
      status,
      environment,
      recovered: !!result.recovered,
    };
  } catch (error) {
    await persistIssueError(attempt.attempt_id, error).catch((persistError) => {
      console.error('[nfeIssuanceApi][persistBudgetIssueError]', persistError);
    });
    throw error;
  }
}

async function getBudgetNfeReference(budgetId) {
  const id = positiveInteger(budgetId);

  if (!id) {
    const error = new Error('ID de orçamento inválido.');
    error.status = 400;
    error.code = 'INVALID_BUDGET_ID';
    throw error;
  }

  const { rows } = await pool.query(
    `
      SELECT
        a.attempt_id,
        a.budget_id,
        a.provider_id AS nfe_provider_id,
        a.integration_id AS nfe_id_integracao,
        s.code AS nfe_issue_status,
        a.protocol AS nfe_protocol,
        a.nfe_environment,
        a.requested_at AS nfe_issued_at,
        a.nfe_number,
        a.access_key,
        a.invoice_id
      FROM ${ATTEMPTS_TABLE} a
      JOIN ${STATUS_TABLE} s
        ON s.nfe_status_id = a.nfe_status_id
      WHERE a.budget_id = $1
      ORDER BY a.attempt_number DESC, a.attempt_id DESC
      LIMIT 1
    `,
    [id],
  );

  const row = rows[0];
  if (!row) {
    const budgetExists = await pool.query(
      'SELECT 1 FROM public.budgets WHERE budget_id = $1 LIMIT 1',
      [id],
    );
    const error = new Error(
      budgetExists.rowCount
        ? 'Este orçamento ainda não possui tentativa de emissão de NF-e.'
        : 'Orçamento não encontrado.',
    );
    error.status = 404;
    error.code = budgetExists.rowCount ? 'BUDGET_NFE_NOT_FOUND' : 'BUDGET_NOT_FOUND';
    throw error;
  }

  if (!row.nfe_provider_id && !row.nfe_id_integracao) {
    const error = new Error('Este orçamento ainda não possui NF-e vinculada.');
    error.status = 404;
    error.code = 'BUDGET_NFE_NOT_FOUND';
    throw error;
  }

  return row;
}

async function resolveProviderId(reference) {
  if (reference.nfe_provider_id) return String(reference.nfe_provider_id);

  const listed = await tecnospeedNfeApi.listarNFe({
    q: reference.nfe_id_integracao,
  });

  if (!listed?.ok) {
    const error = new Error('Não foi possível localizar a NF-e no provedor.');
    error.status = Number(listed?.status) || 502;
    error.code = 'NFE_PROVIDER_LOOKUP_FAILED';
    error.details = listed?.error || null;
    throw error;
  }

  const exact = findProviderDocumentByIntegrationId(
    listed,
    reference.nfe_id_integracao,
  );

  const providerId = providerIdFrom(exact, exact);
  if (!providerId) {
    const error = new Error('A NF-e vinculada não foi encontrada no provedor.');
    error.status = 404;
    error.code = 'NFE_PROVIDER_DOCUMENT_NOT_FOUND';
    throw error;
  }

  return String(providerId);
}

export async function reconcileBudgetNfe(budgetId) {
  const reference = await getBudgetNfeReference(budgetId);
  const providerId = await resolveProviderId(reference);
  const response = await tecnospeedNfeApi.consultarNFe(providerId);

  logProviderResult('[BUDGET NFE][RECONCILIACAO]', response);

  if (!response?.ok) {
    const error = new Error('Falha ao consultar a situação da NF-e no provedor.');
    error.status = Number(response?.status) || 502;
    error.code = 'NFE_PROVIDER_STATUS_FAILED';
    error.details = response?.error || null;
    throw error;
  }

  const document = providerDocument(response.data);
  const status = normalizeProviderStatus(document, response.data) ||
    reference.nfe_issue_status || 'PROCESSANDO';
  const protocol = providerProtocolFrom(document, response.data) || reference.nfe_protocol || null;
  const accessKey = providerAccessKeyFrom(document, response.data);
  const message = providerMessageFrom(document, response.data);
  const issueError = ['REJEITADA', 'DENEGADA', 'ERRO'].includes(status)
    ? String(message || 'NF-e não autorizada pelo provedor.')
    : null;

  const statusMap = await resolveNfeStatus(pool, status);
  const isCancelled = status === 'CANCELADA';

  await pool.query(
    `
      UPDATE ${ATTEMPTS_TABLE}
      SET provider_id = $2,
          nfe_status_id = $3,
          protocol = $4,
          access_key = COALESCE($5, access_key),
          nfe_number = COALESCE($6, nfe_number),
          provider_response = $7::jsonb,
          error_code = CASE WHEN $8::text IS NULL THEN NULL ELSE 'NFE_PROVIDER_STATUS' END,
          error_message = $8,
          last_checked_at = NOW(),
          authorized_at = CASE
            WHEN $9::boolean THEN COALESCE(authorized_at, NOW())
            ELSE authorized_at
          END,
          rejected_at = CASE
            WHEN $10::boolean THEN COALESCE(rejected_at, NOW())
            ELSE rejected_at
          END,
          updated_at = NOW()
      WHERE attempt_id = $1
    `,
    [
      reference.attempt_id,
      providerId,
      statusMap.nfe_status_id,
      protocol,
      accessKey,
      document?.numero ? Number(document.numero) : null,
      JSON.stringify(response.data || {}),
      issueError,
      Boolean(statusMap.is_authorized),
      Boolean(statusMap.is_final && !statusMap.is_authorized),
    ],
  );

  // ============================================================================
  // ORÇAMENTO → NF-e CANCELADA → SINCRONIZAÇÃO LOCAL
  // ============================================================================
  let cancellationSync = null;
  let stockRollback = null;

  if (isCancelled) {
    const cancellationDateText = String(
      document?.dataCancelamento || '',
    ).trim();

    const cancellationDateMatch =
      cancellationDateText.match(
        /^(\d{2})\/(\d{2})\/(\d{4})$/,
      );

    const cancelledAt = cancellationDateMatch
      ? `${cancellationDateMatch[3]}-${cancellationDateMatch[2]}-${cancellationDateMatch[1]}`
      : new Date();

    const cancellationProtocol =
      document?.protocoloCancelamento ||
      null;

    const cancellationMessage =
      document?.mensagem ||
      'NF-e cancelada no provedor.';

    const cancellationReason =
      cancellationProtocol
        ? `${cancellationMessage} Protocolo: ${cancellationProtocol}`
        : cancellationMessage;

    await pool.query(
      `
        UPDATE ${ATTEMPTS_TABLE}
        SET cancelled_at = COALESCE(cancelled_at, $2::timestamptz),
            updated_at = NOW()
        WHERE attempt_id = $1
      `,
      [reference.attempt_id, cancelledAt],
    );

    const cancellationResult = await pool.query(
      `
        UPDATE public."invoicesIssued"
        SET nfe_status_id = $2,
            nfe_status = $3,
            cancelled_at = COALESCE(cancelled_at, $4::timestamptz),
            cancellation_reason = $5,
            updated_at = NOW()
        WHERE budget_id = $1
           OR (
                -- Fallback para notas antigas sem budget_id preenchido.
                -- Precisa do ambiente: a sequência de numeração é a mesma para
                -- homologação e produção, então casar apenas por nfe_number
                -- poderia cancelar a nota do outro ambiente.
                budget_id IS NULL
                AND source_type = 'BUDGET'
                AND nfe_number = $6
                AND nfe_environment IS NOT DISTINCT FROM $7::text
              )
        RETURNING *
      `,
      [
        reference.budget_id,
        statusMap.nfe_status_id,
        statusMap.code,
        cancelledAt,
        cancellationReason,
        document?.numero
          ? Number(document.numero)
          : reference.nfe_number,
        document?.ambiente
        || reference.nfe_environment
        || process.env.NFE_AMBIENTE
        || null,
      ],
    );

    await pool.query(
      `
        UPDATE public.budgets
        SET status = 'CANCELADO',
            updated_at = NOW()
        WHERE budget_id = $1
      `,
      [reference.budget_id],
    );

    // ========================================================================
    // ORÇAMENTO → NF-e CANCELADA → ESTORNO IDEMPOTENTE DO ESTOQUE
    // ========================================================================
    stockRollback =
      await stockFromBudgetsService
        .rollbackStockFromBudget({
          attemptId:
            reference.attempt_id,
        });

    cancellationSync = {
      ok: cancellationResult.rowCount > 0,
      invoice: cancellationResult.rows[0] || null,
      protocol: cancellationProtocol,
      cancelled_at: cancelledAt,
      reason: cancellationReason,
      stockRollback,
    };
  }

  let stockSync = null;
  let invoicesIssued = null;
  let boletoSync = null;

  if (status === 'AUTORIZADA') {
    const budget = await getBudgetIssuedData(reference.budget_id);

    // ========================================================================
    // ORÇAMENTO → NF-e AUTORIZADA → ESTOQUE
    // ========================================================================
    stockSync =
      await stockFromBudgetsService
        .applyStockFromBudget(
          budget,
          {
            attemptId:
              reference.attempt_id,
          },
        );

    const authorizationDate = String(
      document?.dataAutorizacao || document?.emissao || '',
    ).trim();
    const dateMatch = authorizationDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const issuedDate = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : null;

    const sync = await invoicesIssuedApi.upsertFromBudget({
      budget_id: Number(reference.budget_id),

      nfe_number:
        document?.numero
          ? Number(document.numero)
          : reference.nfe_number ?? null,

      nfe_key:
        accessKey ||
        reference.access_key ||
        null,

      // Important: provider's internal document ID
      nfe_provider_id: providerId,

      nfe_status: status,

      nfe_protocol:
        protocol ||
        reference.nfe_protocol ||
        null,

      nfe_environment:
        document?.ambiente ||
        reference.nfe_environment ||
        process.env.NFE_AMBIENTE ||
        null,

      xml_url:
        `/api/budgets-issued/${reference.budget_id}/xml`,

      danfe_url:
        `/api/budgets-issued/${reference.budget_id}/danfe.pdf`,

      issued_at:
        reference.nfe_issued_at ||
        new Date(),

      issued_date: issuedDate,

      total_amount: Number(
        budget.total_amount ??
        budget.total ??
        document?.valor ??
        0
      ),

      customer_name:
        budget.customer_legal_name ||
        budget.customer_name ||
        null,

      customer_tax_id:
        budget.customer_tax_id ||
        null,

      customer_email:
        budget.customer_email ||
        budget.email ||
        null,
    });

    if (!sync?.ok) {
      const error = new Error(
        sync?.error || 'Não foi possível sincronizar a NF-e em invoicesIssued.',
      );
      error.status = 500;
      error.code = 'INVOICES_ISSUED_SYNC_FAILED';
      throw error;
    }

    invoicesIssued = sync.invoice || null;

    const linkedInvoiceId =
      invoicesIssued?.invoice_id ??
      sync?.invoice_id ??
      null;

    if (linkedInvoiceId) {
      await pool.query(
        `UPDATE ${ATTEMPTS_TABLE} SET invoice_id = $2, updated_at = NOW() WHERE attempt_id = $1`,
        [reference.attempt_id, linkedInvoiceId],
      );
    }

    // O orçamento só se torna FATURADO depois que estoque e invoicesIssued
    // terminam com sucesso. Operações com moves_stock=false são marcadas pelo
    // serviço de estoque como ignoradas, sem gerar baixa.
    await pool.query(
      `
        UPDATE public.budgets
        SET status = 'FATURADO',
            updated_at = NOW()
        WHERE budget_id = $1
      `,
      [reference.budget_id],
    );

    // ============================================================================
    // ORÇAMENTO → NF-e AUTORIZADA → ASAAS → BOLETOS
    // ============================================================================

    try {
      boletoSync =
        await syncAuthorizedBudgetNfe({
          budgetId:
            Number(reference.budget_id),

          nfeNumber:
            document?.numero ||
            null,

          nfeKey:
            accessKey ||
            null,
        });

      console.log(
        '[BUDGET NFE][ASAAS][SYNC]',
        boletoSync,
      );
    } catch (error) {
      console.error(
        '[BUDGET NFE][ASAAS][SYNC ERROR]',
        {
          budgetId:
            reference.budget_id,

          nfeNumber:
            document?.numero ||
            null,

          nfeKey:
            accessKey ||
            null,

          error:
            error?.message ||
            error,
        },
      );

      boletoSync = {
        ok: false,
        error:
          error?.message ||
          'Falha ao gerar boletos.',
      };
    }
  }

  return {
    budget_id: Number(reference.budget_id),
    provider_id: providerId,
    id_integracao: reference.nfe_id_integracao,
    status,
    protocol,
    access_key: accessKey || null,
    message: message || null,
    cancelled: isCancelled,
    environment: reference.nfe_environment || process.env.NFE_AMBIENTE || null,
    xml_url: status === 'AUTORIZADA'
      ? `/api/budgets-issued/${reference.budget_id}/xml`
      : null,
    danfe_url: ['AUTORIZADA', 'CANCELADA'].includes(status)
      ? `/api/budgets-issued/${reference.budget_id}/danfe.pdf`
      : null,
    stock_sync: stockSync,
    stock_rollback: stockRollback,
    invoices_issued: invoicesIssued,
    cancellation_sync: cancellationSync,
    boleto_sync: boletoSync,
  };
}

export async function getBudgetNfeXml(budgetId) {
  const reference = await getBudgetNfeReference(budgetId);
  const providerId = await resolveProviderId(reference);
  const response = await tecnospeedNfeApi.obterXml(providerId);

  if (!response?.ok || !response.xml) {
    const error = new Error('Não foi possível obter o XML da NF-e.');
    error.status = Number(response?.status) || 502;
    error.code = 'BUDGET_NFE_XML_FAILED';
    error.details = response?.error || null;
    throw error;
  }

  return { xml: response.xml, providerId };
}

export async function getBudgetNfeDanfe(budgetId) {
  const reference = await getBudgetNfeReference(budgetId);
  const providerId = await resolveProviderId(reference);
  const response = await tecnospeedNfeApi.obterPdf(providerId);

  if (!response?.ok || !response.buffer) {
    const error = new Error('Não foi possível obter o DANFE da NF-e.');
    error.status = Number(response?.status) || 502;
    error.code = 'BUDGET_NFE_DANFE_FAILED';
    error.details = response?.error || null;
    throw error;
  }

  return { buffer: Buffer.from(response.buffer), providerId };
}

// ============================================================================
// ORDER — ENTRADAS PÚBLICAS COMPATÍVEIS
// ============================================================================

export function issueOrderNfe(options = {}) {
  return issueOrderNfeFromAttempts(options);
}

export function reconcileOrderNfe(options = {}) {
  return reconcileOrderNfeFromAttempts(options);
}

export default {
  getBudgetIssuedData,
  getBudgetNfePreparedData,
  issueBudgetNfe,
  reconcileBudgetNfe,
  getBudgetNfeXml,
  getBudgetNfeDanfe,
  issueOrderNfe,
  reconcileOrderNfe,
};