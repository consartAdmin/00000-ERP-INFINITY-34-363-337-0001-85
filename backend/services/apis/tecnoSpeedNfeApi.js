// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tecnoSpeedNfeApi.js — Integração com API TecnoSpeed / PlugNotas NFe  ║
// ║ CONSART ERP — Emissão, consulta, listagem e cancelamento de NF-e     ║
// ║ Módulo ESM • Refresh dinâmico de BASE_URL e API KEY + Diagnósticos   ║
// ║ ✅ Desconto por item via valorDesconto                               ║
// ║ ✅ Total líquido consistente (bruto - desconto + frete)              ║
// ║ ✅ Validação fiscal completa pré-envio                               ║
// ║ ✅ Importa observação + pagamentos do orçamento                      ║
// ║ ✅ Importa duplicatas / vencimentos para info complementar           ║
// ║ ✅ Monta pagamentos/cobrança reais a partir do orçamento             ║
// ║ ✅ Corrige DANFE para exibir duplicatas corretamente quando houver   ║
// ╚══════════════════════════════════════════════════════════════════════╝

/* =========================================================================
 * 🔧 Carregamento de variáveis de ambiente ANTES de tudo (força backend/.env)
 * ========================================================================= */
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_PATH || 'backend/.env' });

import axios from 'axios';
import pool from '../../config/db.js';
import paymentMethodsApi from '../../repositories/paymentMethods/paymentMethods.index.js';
import customersApi from '../../repositories/customers/customers.index.js';
import * as stockFromOrdersService from '../stockFromOrdersService.js';
import { cancelarNFe } from './cancelarNfeApi.js';

import {
  resolveFeature,
} from './appFeatures/appFeaturesApi.js';

/* =========================================================================
 * 🔧 Helpers gerais
 * ========================================================================= */
async function resolveActiveStockMode() {
  const feature = await resolveFeature({
    featureCode: 'PRODUCT_STOCK_MODE',
    scopeType: 'GLOBAL',
    scopeId: 1,
  });

  if (!feature) {
    throw new Error(
      '[NFE] Feature STOCK_MODE não cadastrada.'
    );
  }

  if (!feature.enabled) {
    throw new Error(
      '[NFE] Feature STOCK_MODE desativada.'
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
      `[NFE] STOCK_MODE inválido: "${mode}".`
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

function formatLocalISODate(date) {
  const d = parseDateOrNull(date);
  if (!d) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function round4(v) {
  return Math.round(Number(v || 0) * 10000) / 10000;
}

function money(v) {
  return round2(Number(v || 0));
}

function nearlyEqual(a, b, tolerance = 0.01) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
}

function sum(arr, getter) {
  return (Array.isArray(arr) ? arr : []).reduce(
    (acc, item) => acc + Number(getter(item) || 0),
    0,
  );
}

function onlyDigits(v) {
  return (v ?? '').toString().replace(/\D+/g, '');
}

function toUpperSafe(v) {
  return String(v || '').trim().toUpperCase();
}

function toStr(v) {
  return v == null ? '' : String(v);
}

/* =========================================================================
 * Reforma Tributária — grupos IS e IBS/CBS (PlugNotas)
 * ========================================================================= */
function buildReformaTributariaFromFiscal(
  fiscal = {},
  baseCalculo = 0,
  quantidade = 0,
) {
  const ibscbsCst = onlyDigits(fiscal.ibscbs_cst);
  const ibscbsClassification = onlyDigits(
    fiscal.ibscbs_classification,
  );

  if (ibscbsCst.length !== 3) {
    throw new Error(
      '[NFE] CST IBS/CBS ausente ou inválido na Classificação Fiscal V2.',
    );
  }

  if (ibscbsClassification.length !== 6) {
    throw new Error(
      '[NFE] Classificação IBS/CBS ausente ou inválida na Classificação Fiscal V2.',
    );
  }

  if (ibscbsClassification === '000000') {
    throw new Error(
      '[NFE] Classificação IBS/CBS 000000 não existe. Configure um cClassTrib válido na Classificação Fiscal V2.',
    );
  }

  if (!ibscbsClassification.startsWith(ibscbsCst)) {
    throw new Error(
      `[NFE] Classificação IBS/CBS ${ibscbsClassification} incompatível com o CST ${ibscbsCst}.`,
    );
  }

  const base = round2(baseCalculo);
  const qtd = round4(quantidade);
  const isRate = round4(fiscal.is_rate ?? 0);
  const isSpecificRate = Number(fiscal.is_specific_rate ?? 0);
  const ibsUfRate = round4(fiscal.ibs_uf_rate ?? 0);
  const ibsMunicipalRate = round4(fiscal.ibs_municipal_rate ?? 0);
  const cbsRate = round4(fiscal.cbs_rate ?? 0);

  const details =
    fiscal.tax_reform_details &&
      typeof fiscal.tax_reform_details === 'object' &&
      !Array.isArray(fiscal.tax_reform_details)
      ? fiscal.tax_reform_details
      : {};
  const detailsIs = details.is || {};
  const detailsIbsCbs = details.ibscbs || {};
  const detailsIbsUf = detailsIbsCbs.uf || {};
  const detailsIbsMunicipio = detailsIbsCbs.municipio || {};
  const detailsCbs = detailsIbsCbs.cbs || {};
  const {
    reducao: _ignoredIbsUfReduction,
    ...detailsIbsUfWithoutReduction
  } = detailsIbsUf;
  const {
    reducao: _ignoredIbsMunicipalReduction,
    ...detailsIbsMunicipioWithoutReduction
  } = detailsIbsMunicipio;
  const {
    reducao: _ignoredCbsReduction,
    ...detailsCbsWithoutReduction
  } = detailsCbs;

  /*
   * O CST 200 exige o grupo de reducao quando o cClassTrib possuir esse
   * indicador. O cadastro pode fornecer os percentuais por colunas proprias
   * ou por tax_reform_details. Para o cClassTrib 200035, a tabela oficial
   * determina reducao de 60% para IBS e CBS; o fallback abaixo mantem as
   * emissoes corretas enquanto os novos campos nao existirem no cadastro.
   */
  const reductionByClassification = {
    '200035': { ibsUf: 60, ibsMunicipio: 60, cbs: 60 },
  };
  const classificationReduction =
    reductionByClassification[ibscbsClassification] || {};

  const readReductionRate = (...values) => {
    const raw = values.find(
      (value) => value !== undefined && value !== null && value !== '',
    );
    const rate = round4(raw ?? 0);

    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new Error(
        `[NFE] Percentual de reducao IBS/CBS invalido: ${raw}. Informe um valor entre 0 e 100.`,
      );
    }

    return rate;
  };

  const ibsUfReductionRate = readReductionRate(
    fiscal.ibs_uf_reduction_rate,
    fiscal.ibs_uf_reduction,
    detailsIbsUf.reducao?.aliquota,
    classificationReduction.ibsUf,
  );
  const ibsMunicipalReductionRate = readReductionRate(
    fiscal.ibs_municipal_reduction_rate,
    fiscal.ibs_municipal_reduction,
    detailsIbsMunicipio.reducao?.aliquota,
    classificationReduction.ibsMunicipio,
  );
  const cbsReductionRate = readReductionRate(
    fiscal.cbs_reduction_rate,
    fiscal.cbs_reduction,
    detailsCbs.reducao?.aliquota,
    classificationReduction.cbs,
  );

  const effectiveRate = (nominalRate, reductionRate) =>
    round4(nominalRate * (1 - reductionRate / 100));

  const ibsUfEffectiveRate = effectiveRate(
    ibsUfRate,
    ibsUfReductionRate,
  );
  const ibsMunicipalEffectiveRate = effectiveRate(
    ibsMunicipalRate,
    ibsMunicipalReductionRate,
  );
  const cbsEffectiveRate = effectiveRate(cbsRate, cbsReductionRate);

  const isValue = round2(
    (base * isRate) / 100 + (qtd * isSpecificRate),
  );
  const ibsUfValue = round2((base * ibsUfEffectiveRate) / 100);
  const ibsMunicipalValue = round2(
    (base * ibsMunicipalEffectiveRate) / 100,
  );
  const cbsValue = round2((base * cbsEffectiveRate) / 100);
  const {
    indicadorDoacao: _ignoredDonationIndicator,
    ...detailsIbsCbsWithoutDonation
  } = detailsIbsCbs;

  const donationClassifications = new Set(['410003', '410026']);
  const mustSendDonationIndicator = donationClassifications.has(
    ibscbsClassification,
  );

  const isCst = onlyDigits(detailsIs.cst ?? fiscal.is_cst);
  const isClassification = onlyDigits(
    detailsIs.classificacao ?? fiscal.is_classification,
  );
  const hasValidIs =
    isCst.length === 3 &&
    isClassification.length === 6 &&
    isClassification !== '000000';

  return {
    ...(hasValidIs
      ? {
        is: {
          ...detailsIs,
          cst: isCst,
          classificacao: isClassification,
          baseCalculo: base,
          aliquota: isRate,
          aliquotaEspecifica: isSpecificRate,
          unidade: String(fiscal.is_unit || 'UN').toUpperCase(),
          quantidade: qtd,
          valor: isValue,
        },
      }
      : {}),
    ibscbs: {
      ...detailsIbsCbsWithoutDonation,
      cst: ibscbsCst,
      classificacao: ibscbsClassification,
      baseCalculo: base,
      valorIbs: round2(ibsUfValue + ibsMunicipalValue),
      ...(mustSendDonationIndicator
        ? {
          indicadorDoacao: Number(fiscal.donation_indicator ?? 1),
        }
        : {}),
      uf: {
        ...detailsIbsUfWithoutReduction,
        aliquota: ibsUfRate,
        ...(ibsUfReductionRate > 0 && ibsUfRate > 0
          ? {
            reducao: {
              aliquota: ibsUfReductionRate,
              aliquotaEfetiva: ibsUfEffectiveRate,
            },
          }
          : {}),
        valor: ibsUfValue,
      },
      municipio: {
        ...detailsIbsMunicipioWithoutReduction,
        aliquota: ibsMunicipalRate,
        ...(ibsMunicipalReductionRate > 0
          ? {
            reducao: {
              aliquota: ibsMunicipalReductionRate,
              aliquotaEfetiva: ibsMunicipalEffectiveRate,
            },
          }
          : {}),
        valor: ibsMunicipalValue,
      },
      cbs: {
        ...detailsCbsWithoutReduction,
        aliquota: cbsRate,
        ...(cbsReductionRate > 0 && cbsRate > 0
          ? {
            reducao: {
              aliquota: cbsReductionRate,
              aliquotaEfetiva: cbsEffectiveRate,
            },
          }
          : {}),
        valor: cbsValue,
      },
    },
  };
}

/*
 * Totalizadores RTC obrigatórios quando os itens possuem IBS/CBS.
 * A PlugNotas não calcula o IBSCBSTot: sem estes campos a SEFAZ rejeita
 * com 1119 ("Total de IBS e CBS não informado").
 */
function buildReformaTotals(nfe = {}, valorNota = 0) {
  const reformaTotals = (Array.isArray(nfe.itens) ? nfe.itens : []).reduce(
    (acc, item) => {
      const ibscbs = item?.tributos?.ibscbs || {};
      const impostoSeletivo = item?.tributos?.is || {};

      acc.baseCalculoIbsCbs += Number(ibscbs.baseCalculo || 0);
      acc.valorIbsUF += Number(ibscbs.uf?.valor || 0);
      acc.valorIbsMunicipio += Number(ibscbs.municipio?.valor || 0);
      acc.valorIbs += Number(ibscbs.valorIbs || 0);
      acc.valorCbs += Number(ibscbs.cbs?.valor || 0);
      acc.valorIs += Number(impostoSeletivo.valor || 0);

      return acc;
    },
    {
      baseCalculoIbsCbs: 0,
      valorIbsUF: 0,
      valorIbsMunicipio: 0,
      valorIbs: 0,
      valorCbs: 0,
      valorIs: 0,
    },
  );

  for (const key of Object.keys(reformaTotals)) {
    reformaTotals[key] = round2(reformaTotals[key]);
  }

  return {
    ...(nfe.total || {}),

    // Base total IBS/CBS
    baseCalculoIbsCbs: reformaTotals.baseCalculoIbsCbs,

    // IBS estadual
    valorDiferimentoIbsUF: 0,
    valorDevolucaoIbsUF: 0,
    valorIbsUF: reformaTotals.valorIbsUF,

    // IBS municipal
    valorDiferimentoIbsMunicipio: 0,
    valorDevolucaoIbsMunicipio: 0,
    valorIbsMunicipio: reformaTotals.valorIbsMunicipio,

    // Total IBS
    valorIbs: reformaTotals.valorIbs,
    valorIbsCreditoPresumindo: 0,
    valorIbsCreditoPresumidoSupensao: 0,

    // Total CBS
    valorCbsDiferimento: 0,
    valorCbsDevolucao: 0,
    valorCbs: reformaTotals.valorCbs,
    valorCbsCreditoPresumido: 0,
    valorCbsCreditoPresumidoSupensao: 0,

    /*
     * Em 2026, IBS e CBS não devem ser acrescentados ao valor cobrado
     * do cliente. vNFTot deve coincidir com a soma dos vItem.
     */
    valorIbsCbsIs: round2(valorNota),
  };
}

function normalizarIbscbsAntesDoEnvio(documento = {}) {
  return {
    ...documento,
    itens: (Array.isArray(documento.itens) ? documento.itens : []).map((item) => {
      const ibscbs = item?.tributos?.ibscbs;

      if (!ibscbs) return item;

      const cst = onlyDigits(ibscbs.cst).padStart(3, '0').slice(-3);
      const classificacao = onlyDigits(ibscbs.classificacao)
        .padStart(6, '0')
        .slice(-6);

      return {
        ...item,
        tributos: {
          ...item.tributos,
          ibscbs: {
            ...ibscbs,
            cst,
            classificacao,
          },
        },
      };
    }),
  };
}

/* =========================================================================
 * 🔧 Helpers de ENV e Config
 * ========================================================================= */
function getAmbiente() {
  return (process.env.NFE_AMBIENTE || 'producao').toLowerCase();
}

function getBaseUrl() {
  if (process.env.PLUGNOTAS_BASE_URL) {
    return process.env.PLUGNOTAS_BASE_URL.trim();
  }

  return getAmbiente() === 'sandbox'
    ? 'https://api.sandbox.plugnotas.com.br'
    : 'https://api.plugnotas.com.br';
}

function getApiKey() {
  const ambiente = getAmbiente();

  let apiKey;

  if (ambiente === 'producao') {
    apiKey =
      process.env.PLUGNOTAS_API_KEY_REAL ||
      process.env.PLUGNOTAS_API_KEY;
  } else if (ambiente === 'homologacao') {
    apiKey =
      process.env.PLUGNOTAS_API_KEY_HOMOLOG ||
      process.env.PLUGNOTAS_API_KEY;
  } else if (ambiente === 'sandbox') {
    apiKey =
      process.env.PLUGNOTAS_API_KEY_SANDBOX ||
      process.env.PLUGNOTAS_API_KEY_HOMOLOG ||
      process.env.PLUGNOTAS_API_KEY;
  } else {
    throw new Error(
      `[PlugNotasNFe] NFE_AMBIENTE inválido: "${ambiente}".`
    );
  }

  if (!apiKey) {
    throw new Error(
      `[PlugNotasNFe] API Key ausente para o ambiente "${ambiente}".`
    );
  }

  return String(apiKey).trim();
}

const PLUGNOTAS_TIMEOUT = Number(process.env.PLUGNOTAS_TIMEOUT || 20000);
const PLUGNOTAS_MOCK =
  process.env.PLUGNOTAS_MOCK === '1' || process.env.TECNOSPEED_MOCK === '1';

const NFE_DEBUG =
  process.env.NFE_DEBUG === '1' || process.env.NFE_DEBUG === 'true';

/* =========================================================================
 * 🔐 Cliente Axios
 * ========================================================================= */
const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: PLUGNOTAS_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

function ensureAuthHeader() {
  const key = getApiKey();
  api.defaults.headers['X-API-KEY'] = key;
  api.defaults.headers['x-api-key'] = key;
}

function refreshApiConfig() {
  const base = getBaseUrl();
  if (api.defaults.baseURL !== base) {
    console.log('[PlugNotasNFe] baseURL atualizado para:', base);
    api.defaults.baseURL = base;
  }
  ensureAuthHeader();
}

console.log('[PlugNotasNFe] Base URL (boot):', api.defaults.baseURL);

const configuredApiKey =
  getAmbiente() === 'sandbox'
    ? (
      process.env.PLUGNOTAS_API_KEY_SANDBOX ||
      process.env.PLUGNOTAS_API_KEY
    )
    : (
      process.env.PLUGNOTAS_API_KEY_REAL ||
      process.env.PLUGNOTAS_API_KEY
    );

if (!configuredApiKey) {
  console.warn(
    `[PlugNotasNFe] API Key ausente para o ambiente "${getAmbiente()}".`
  );
}

/* =========================================================================
 * 🧩 Sanitização / utilitários
 * ========================================================================= */
function sanitizeCpfCnpj(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
}

function splitPhone(value) {
  if (!value) return undefined;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10) return undefined;
  const ddd = digits.slice(0, 2);
  const numero = digits.slice(2);
  return { ddd, numero };
}

function sanitizeCep(value) {
  const d = onlyDigits(value);
  return d || null;
}

function normalizeUpperText(value) {
  return String(value || '').trim().toUpperCase();
}

function montarLogradouroNfe(tipoLogradouro, nomeLogradouro) {
  const tipo = normalizeUpperText(tipoLogradouro);
  const nome = normalizeUpperText(nomeLogradouro);

  if (!tipo && !nome) return '';
  if (!tipo) return nome;
  if (!nome) return tipo;

  if (nome.startsWith(`${tipo} `)) {
    return nome;
  }

  return `${tipo} ${nome}`.trim();
}

function isValidDateObj(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function parseDateOrNull(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    return isValidDateObj(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
    return isValidDateObj(d) ? d : null;
  }

  m = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (m) {
    const [, dd, mm, yyyy, hh = '12', mi = '00', ss = '00'] = m;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss)
    );
    return isValidDateObj(d) ? d : null;
  }

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, yyyy, mm, dd] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
    return isValidDateObj(d) ? d : null;
  }

  m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m) {
    const [, yyyy, mm, dd, hh = '12', mi = '00', ss = '00'] = m;
    const d = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss)
    );
    return isValidDateObj(d) ? d : null;
  }

  const d = new Date(raw);
  return isValidDateObj(d) ? d : null;
}

function addDays(date, days) {
  const base = parseDateOrNull(date);
  if (!base) return null;

  const d = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    12,
    0,
    0
  );

  d.setDate(d.getDate() + Number(days || 0));

  return isValidDateObj(d) ? d : null;
}

function nowSaoPauloISODate() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function formatDateBR(value) {
  const d = parseDateOrNull(value);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatMoneyBR(value) {
  return `R$ ${round2(value).toFixed(2).replace('.', ',')}`;
}

function formatMoneyBRComplete(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* =========================================================================
 * 🏙️ Código IBGE do Município
 * ========================================================================= */
function pickCodigoCidadeIbgeFromSources(customer = {}, header = {}) {
  const candidates = [
    customer.code_ibge,
    customer.ibge_code,
    customer.codigo_ibge,
    customer.customer_codigo_ibge,
    customer.city_ibge,
    customer.municipio_ibge,
    customer.ibge,

    header.code_ibge,
    header.ibge_code,
    header.codigo_ibge,
    header.customer_codigo_ibge,
    header.customer_ibge_code,
    header.customer_city_ibge,
    header.customer_municipio_ibge,
    header.customer_ibge,
    header.ibge,
  ];

  for (const v of candidates) {
    const d = onlyDigits(v);
    if (d && d.length === 7) return d;
  }
  return null;
}

function resolveCodigoCidadeIbge(uf, cidade, customer = {}, header = {}) {
  const fromData = pickCodigoCidadeIbgeFromSources(customer, header);

  if (!fromData) {
    throw new Error(
      `[NFE] Código IBGE do município ausente. Cidade=${cidade} UF=${uf}. Corrija o cadastro do cliente.`,
    );
  }

  return fromData;
}

/* =========================================================================
 * 🏢 Empresa
 * ========================================================================= */
function getEmpresaConfig() {
  return {
    EMPRESA_CNPJ: process.env.EMPRESA_CNPJ || '00000000000000',
    EMPRESA_RAZAO: process.env.EMPRESA_RAZAO || 'RAZAO SOCIAL PADRÃO',
    EMPRESA_FANTASIA: process.env.EMPRESA_FANTASIA || 'NOME FANTASIA PADRÃO',
    RESPONSAVEL_CNPJ:
      process.env.RESPONSAVEL_CNPJ ||
      process.env.EMPRESA_CNPJ ||
      '00000000000000',
    RESPONSAVEL_NOME:
      process.env.RESPONSAVEL_NOME ||
      process.env.EMPRESA_FANTASIA ||
      'RESPONSÁVEL PADRÃO',
    RESPONSAVEL_EMAIL:
      process.env.RESPONSAVEL_EMAIL ||
      process.env.EMPRESA_EMAIL ||
      'contato@consart.com.br',
    RESPONSAVEL_TELEFONE:
      process.env.RESPONSAVEL_TELEFONE ||
      process.env.EMPRESA_FONE ||
      null,
  };
}

/* =========================================================================
 * 🔢 Numeração NF-e
 * ========================================================================= */

async function getOrCreateBasicNfeRow(db = pool) {
  const { rows } = await db.query(`
    SELECT *
    FROM public.nfe
    WHERE is_active = TRUE
    ORDER BY id ASC
    LIMIT 1;
  `);

  if (rows[0]) return rows[0];

  const insert = await db.query(`
    INSERT INTO public.nfe (
      sequence_number,
      is_active
    )
    VALUES (0, TRUE)
    RETURNING *;
  `);

  return insert.rows[0];
}

async function incrementBasicNfeNumber(db = pool) {
  const row = await getOrCreateBasicNfeRow(db);

  const update = await db.query(
    `
      UPDATE public.nfe
      SET
        sequence_number = sequence_number + 1,
        updated_at = NOW()
      WHERE id = $1
      RETURNING sequence_number;
    `,
    [row.id],
  );

  const numero = Number(update.rows[0]?.sequence_number);

  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error(
      'Falha ao gerar número da NF-e (tabela public.nfe).',
    );
  }

  return numero;
}

async function getNextNfeNumberFromBasicTable() {
  return incrementBasicNfeNumber(pool);
}

/**
 * Returns the probable NF-e number for previews.
 *
 * IMPORTANT:
 * - Does not update public.nfe.
 * - Does not reserve a number in orders or budgets.
 * - If the document already has a reserved number, it reuses it.
 */
async function peekNextNfeNumber(header = {}) {
  const existing = Number(
    header.nfe_number ??
    header.nfeNumero ??
    header.numero_nfe ??
    NaN,
  );

  if (Number.isFinite(existing) && existing > 0) {
    return existing;
  }

  const { rows } = await pool.query(`
    SELECT sequence_number + 1 AS next_number
    FROM public.nfe
    WHERE is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
  `);

  const nextNumber = Number(
    rows[0]?.next_number ?? 1,
  );

  if (
    !Number.isSafeInteger(nextNumber) ||
    nextNumber <= 0
  ) {
    throw new Error(
      '[NFE PREVIEW] Não foi possível consultar o próximo número da NF-e.',
    );
  }

  return nextNumber;
}

/**
 * Resolve o ID do pedido sem confundir o ID genérico de um orçamento
 * com um order_id.
 */
function resolveOrderIdForNfe(header = {}) {
  if (header.order_id != null) {
    return header.order_id;
  }

  // Se existe budget_id, header.id não pode ser tratado como order_id.
  if (header.budget_id != null) {
    return null;
  }

  return header.id ?? null;
}

let budgetNfeNumberColumnReady = false;

/**
 * Garante que o orçamento possa guardar o número reservado da NF-e.
 */
async function ensureBudgetNfeNumberColumn() {
  if (budgetNfeNumberColumnReady) {
    return;
  }

  await pool.query(`
    ALTER TABLE public."budgets"
    ADD COLUMN IF NOT EXISTS nfe_number BIGINT;
  `);

  budgetNfeNumberColumnReady = true;
}

/**
 * Reserva ou recupera o número da NF-e.
 *
 * Regras:
 * - Pedido reutiliza public."orders".nfe_number.
 * - Orçamento reutiliza public."budgets".nfe_number.
 * - O incremento e a gravação acontecem na mesma transação.
 * - FOR UPDATE impede duas reservas simultâneas para o mesmo registro.
 */
async function getNextNfeNumberForOrder(header = {}) {
  const existing = Number(
    header.nfe_number ??
    header.nfeNumero ??
    header.numero_nfe ??
    NaN,
  );

  // Se o número já veio corretamente no payload, reutiliza.
  if (Number.isFinite(existing) && existing > 0) {
    return existing;
  }

  const orderId = resolveOrderIdForNfe(header);
  const budgetId = header.budget_id ?? null;

  /*
   * Fluxos que não pertencem a Pedido ou Orçamento continuam
   * utilizando diretamente a tabela public.nfe.
   */
  if (!orderId && !budgetId) {
    return getNextNfeNumberFromBasicTable();
  }

  if (budgetId) {
    await ensureBudgetNfeNumberColumn();
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
     * Bloqueia o Pedido ou Orçamento durante a reserva.
     * Assim, duas requisições simultâneas não consomem dois números.
     */
    const source = orderId
      ? await client.query(
        `
            SELECT nfe_number
            FROM public."orders"
            WHERE order_id = $1
            FOR UPDATE
          `,
        [orderId],
      )
      : await client.query(
        `
            SELECT nfe_number
            FROM public."budgets"
            WHERE budget_id = $1
            FOR UPDATE
          `,
        [budgetId],
      );

    if (!source.rowCount) {
      throw new Error(
        orderId
          ? `[NFE] Pedido ${orderId} não encontrado para reservar numeração.`
          : `[NFE] Orçamento ${budgetId} não encontrado para reservar numeração.`,
      );
    }

    /*
     * Se este documento já reservou um número anteriormente,
     * reutiliza esse número e não incrementa public.nfe.
     */
    const reserved = Number(source.rows[0]?.nfe_number);

    if (Number.isFinite(reserved) && reserved > 0) {
      await client.query('COMMIT');

      console.log(
        orderId
          ? `[NFE] Pedido ${orderId} reutilizou nfe_number = ${reserved}`
          : `[NFE] Orçamento ${budgetId} reutilizou nfe_number = ${reserved}`,
      );

      return reserved;
    }

    /*
     * Somente incrementa a sequência quando o documento ainda
     * não possui um número reservado.
     */
    const numeroGerado = await incrementBasicNfeNumber(client);

    if (orderId) {
      await client.query(
        `
          UPDATE public."orders"
          SET
            nfe_number = $1,
            updated_at = NOW()
          WHERE order_id = $2
        `,
        [numeroGerado, orderId],
      );
    } else {
      await client.query(
        `
          UPDATE public."budgets"
          SET
            nfe_number = $1,
            updated_at = NOW()
          WHERE budget_id = $2
        `,
        [numeroGerado, budgetId],
      );
    }

    await client.query('COMMIT');

    console.log(
      orderId
        ? `[NFE] Pedido ${orderId} reservou nfe_number = ${numeroGerado}`
        : `[NFE] Orçamento ${budgetId} reservou nfe_number = ${numeroGerado}`,
    );

    return numeroGerado;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        '[NFE] Falha ao desfazer reserva da numeração:',
        rollbackError?.message || rollbackError,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================================
 * 💳 Pagamentos
 * ========================================================================= */
function normalizePaymentType(type) {
  if (!type) return '';
  return type
    .toString()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

function deriveTpagFromMethodAndHeader({ metodo }) {
  const code = String(metodo?.nfe_tpag || '').padStart(2, '0');

  if (code && code !== '00' && code !== 'NaN') {
    return code;
  }

  console.warn('[NFE] nfe_tpag inválido, fallback para 99:', metodo);
  return '99';
}

function getDescricaoPadraoMeio(meio) {
  switch (String(meio || '')) {
    case '01':
      return 'DINHEIRO';
    case '02':
      return 'CHEQUE';
    case '03':
      return 'CARTÃO DE CRÉDITO';
    case '04':
      return 'CARTÃO DE DÉBITO';
    case '05':
      return 'CRÉDITO LOJA';
    case '10':
      return 'VALE ALIMENTAÇÃO';
    case '11':
      return 'VALE REFEIÇÃO';
    case '12':
      return 'VALE PRESENTE';
    case '13':
      return 'VALE COMBUSTÍVEL';
    case '15':
      return 'BOLETO BANCÁRIO';
    case '16':
      return 'DEPÓSITO BANCÁRIO';
    case '17':
      return 'PIX';
    case '18':
      return 'TRANSFERÊNCIA BANCÁRIA';
    case '19':
      return 'PROGRAMA FIDELIDADE';
    case '90':
      return 'SEM PAGAMENTO';
    default:
      return 'OUTROS MEIOS DE PAGAMENTO';
  }
}

const paymentMethodsCache = new Map();

async function getPaymentMethodByIdCached(termId) {
  const id = Number(termId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;

  if (paymentMethodsCache.has(id)) {
    return paymentMethodsCache.get(id);
  }

  try {
    const metodo = await paymentMethodsApi.getById(id);
    if (metodo) {
      paymentMethodsCache.set(id, metodo);
    }
    return metodo;
  } catch (e) {
    console.error(
      '[NFE] Falha ao carregar paymentMethods via API:',
      e.message || e,
    );
    return null;
  }
}

async function buildPagamentosFromOrderHeader(
  header,
  valorNotaCalculado,
  totalFaturaOverride,
) {
  const totalHeader = Number(header.total_amount ?? NaN);

  const valorTotal = Number.isFinite(totalFaturaOverride)
    ? Number(totalFaturaOverride)
    : Number.isFinite(totalHeader)
      ? totalHeader
      : Number(valorNotaCalculado || 0);

  let metodo = null;
  if (header.payment_term_id) {
    metodo = await getPaymentMethodByIdCached(header.payment_term_id);
  }

  const meio = deriveTpagFromMethodAndHeader({ metodo, header });

  const rawType = (metodo?.type || '').toString();
  const normType = normalizePaymentType(rawType);
  const aVista =
    normType === 'AVISTA' ||
    String(meio) === '90';

  let descricaoMeio = (
    metodo?.name ||
    metodo?.description ||
    metodo?.title ||
    metodo?.label ||
    header.payment_description ||
    header.payment_method_name ||
    header.payment_form_name ||
    header.payment_term_name ||
    ''
  )
    .toString()
    .trim();

  if (!descricaoMeio) {
    descricaoMeio = getDescricaoPadraoMeio(meio);
  }

  const pagamento = {
    aVista,
    meio,
    valor: round2(valorTotal),
  };

  if (descricaoMeio && meio === '99') {
    pagamento.descricaoMeio = descricaoMeio;
  }

  return [pagamento];
}

/* =========================================================================
 * 💳 Cobrança / Duplicatas
 * ========================================================================= */
function isBoletoManual(metodo) {
  if (!metodo) return false;
  const name = (metodo.name || metodo.nome || '').toString().toUpperCase();
  return name.includes('BOLETO MANUAL');
}

function pickManualDueDateFromHeader(header = {}) {
  return (
    parseDateOrNull(header.manual_due_date) ||
    parseDateOrNull(header.manualDueDate) ||
    parseDateOrNull(header.due_date) ||
    parseDateOrNull(header.dueDate) ||
    parseDateOrNull(header.first_due_date) ||
    parseDateOrNull(header.firstDueDate) ||
    parseDateOrNull(header.data_vencimento) ||
    parseDateOrNull(header.dataVencimento) ||
    parseDateOrNull(header.vencimento) ||
    parseDateOrNull(header.payment_due_date)
  );
}

function normalizeInstallmentNumber(v, fallback = 1) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeDueIso(v) {
  const d = parseDateOrNull(v);
  return d ? formatLocalISODate(d) : null;
}

function normalizeCobrancaToTotal(cobranca, total) {
  if (!cobranca) return null;

  const totalFinal = round2(Number(total || 0));
  if (!Number.isFinite(totalFinal) || totalFinal <= 0) return null;

  const parcelasOriginais = Array.isArray(cobranca.parcelas)
    ? cobranca.parcelas
    : [];

  if (!parcelasOriginais.length) {
    return {
      ...cobranca,
      valorTotal: totalFinal,
      valorLiquido: totalFinal,
      parcelas: [],
    };
  }

  const parcelas = parcelasOriginais.map((p, idx) => ({
    ...p,
    numero: String(p?.numero || idx + 1).padStart(3, '0'),
    valor: round2(Number(p?.valor || 0)),
  }));

  const parcelasBalanceadas = rebalanceParcelasToTotal(parcelas, totalFinal);

  return {
    ...cobranca,
    valorTotal: totalFinal,
    valorLiquido: totalFinal,
    parcelas: parcelasBalanceadas,
  };
}

function rebalanceParcelasToTotal(parcelas = [], total = 0) {
  if (!Array.isArray(parcelas) || !parcelas.length) return [];

  const cloned = parcelas.map((p) => ({
    ...p,
    valor: round2(Number(p.valor || 0)),
  }));

  const totalTarget = round2(total);
  const somaAtual = round2(cloned.reduce((s, p) => s + Number(p.valor || 0), 0));
  const diff = round2(totalTarget - somaAtual);

  if (Math.abs(diff) >= 0.01) {
    const last = cloned[cloned.length - 1];
    last.valor = round2(Number(last.valor || 0) + diff);
  }

  return cloned;
}

function isMeioAVistaByTpag(meio) {
  return ['01', '02', '03', '04', '17'].includes(String(meio || ''));
  // 01 dinheiro
  // 02 cheque
  // 03 cartão crédito
  // 04 cartão débito
  // 17 PIX
}

function isMetodoAVista(metodo) {
  if (!metodo) return false;

  const typeNorm = normalizePaymentType(metodo.type || '');
  const meio = deriveTpagFromMethodAndHeader({ metodo });

  const installments = Math.max(1, Number(metodo.installments || 1));

  if (typeNorm === 'AVISTA') return true;
  if (String(meio) === '90') return true; // sem pagamento
  if (installments <= 1 && isMeioAVistaByTpag(meio)) return true;

  return false;
}

function shouldGenerateCobranca({ metodo, parcelas = [] } = {}) {
  if (Array.isArray(parcelas) && parcelas.length > 1) return true;

  if (Array.isArray(parcelas) && parcelas.length === 1) {
    const p = parcelas[0];
    if (p?.dataVencimento) return true;
  }

  if (!metodo) return false;

  if (isMetodoAVista(metodo)) return false;

  const installments = Math.max(1, Number(metodo.installments || 1));
  if (installments > 1) return true;

  return isBoletoManual(metodo);
}

async function buildCobrancaFromOrderHeader(header, totalFallback, emissaoDateObj) {
  const totalHeader = Number(header.total_amount ?? NaN);
  const total = Number.isFinite(totalHeader)
    ? totalHeader
    : Number(totalFallback || 0);

  if (!Number.isFinite(total) || total <= 0) return null;

  const emissao = emissaoDateObj || new Date();

  let metodo = null;
  if (header.payment_term_id) {
    metodo = await getPaymentMethodByIdCached(header.payment_term_id);
  }

  // ✅ NOVO: não gerar cobrança para pagamento à vista
  if (!shouldGenerateCobranca({ metodo })) {
    return null;
  }

  const numeroFatura = String(header.order_id || header.number || '').padStart(3, '0');

  if (metodo && isBoletoManual(metodo)) {
    const dueFromHeader = pickManualDueDateFromHeader(header);

    if (!dueFromHeader) {
      console.warn(
        '[NFE] BOLETO MANUAL sem data de vencimento no header — usando fallback D+10.',
      );
    }

    const venc = dueFromHeader || addDays(emissao, 10);

    if (!isValidDateObj(venc)) {
      throw new Error(
        `[NFE] Vencimento inválido para BOLETO MANUAL. manual_due_date=${JSON.stringify(
          header.manual_due_date ||
          header.manualDueDate ||
          header.due_date ||
          header.dueDate ||
          header.first_due_date ||
          header.firstDueDate ||
          header.data_vencimento ||
          header.dataVencimento ||
          header.vencimento ||
          header.payment_due_date,
        )}`,
      );
    }

    return {
      numero: numeroFatura,
      valorTotal: round2(total),
      valorLiquido: round2(total),
      parcelas: [
        {
          numero: '001',
          dataVencimento: formatLocalISODate(venc),
          valor: round2(total),
        },
      ],
    };
  }

  if (!metodo) {
    // ✅ Sem método: por segurança, não monta cobrança automática
    return null;
  }

  const installments = Math.max(1, Number(metodo.installments || 1));

  const g1 = Number(metodo.gap_one || 0);
  const g2 = Number(metodo.gap_two || 0);
  const g3 = Number(metodo.gap_three || 0);
  const g4 = Number(metodo.gap_four || 0);

  const gapsConfigurados = [g1, g2, g3, g4].filter((d) => d > 0);
  const parcelasDias = [];

  if (!gapsConfigurados.length) {
    for (let i = 0; i < installments; i++) parcelasDias.push(0);
  } else if (gapsConfigurados.length >= installments) {
    for (let i = 0; i < installments; i++) parcelasDias.push(gapsConfigurados[i]);
  } else if (gapsConfigurados.length === 1) {
    const base = gapsConfigurados[0];
    for (let i = 1; i <= installments; i++) parcelasDias.push(base * i);
  } else {
    const last = gapsConfigurados[gapsConfigurados.length - 1];
    for (let i = 0; i < installments; i++) {
      parcelasDias.push(gapsConfigurados[i] ?? last);
    }
  }

  const parcelas = [];
  let soma = 0;
  const baseParcela = round2(total / installments);

  parcelasDias.forEach((dias, idx) => {
    const venc = addDays(emissao, dias);
    let valor = baseParcela;

    if (!isValidDateObj(venc)) {
      throw new Error(
        `[NFE] Data de vencimento inválida na parcela ${idx + 1}. emissao=${JSON.stringify(
          emissao instanceof Date ? emissao.toISOString?.() || String(emissao) : emissao,
        )}, dias=${JSON.stringify(dias)}, payment_term_id=${JSON.stringify(
          header.payment_term_id,
        )}`,
      );
    }

    const numero = String(idx + 1).padStart(3, '0');
    parcelas.push({
      numero,
      dataVencimento: formatLocalISODate(venc),
      valor,
    });
    soma += valor;
  });

  const diff = round2(total - soma);
  if (Math.abs(diff) >= 0.01) {
    const last = parcelas[parcelas.length - 1];
    last.valor = round2(last.valor + diff);
  }

  return {
    numero: numeroFatura,
    valorTotal: round2(total),
    valorLiquido: round2(total),
    parcelas,
  };
}

/* =========================================================================
 * 💳 Pagamentos reais do orçamento
 * ========================================================================= */
async function loadBudgetPaymentsForNfe(
  budgetId,
  totalFallback = 0,
  realIssueDateObj,
) {
  if (!budgetId) return null;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        bp.budget_payment_id,
        bp.payment_method_id,
        bp.amount,
        bp.notes,
        pm.name AS payment_method_name,
        pm.type AS payment_method_type,
        pm.nfe_tpag AS payment_method_nfe_tpag,
        pm.installments AS payment_method_installments,
        pm.gap_one,
        pm.gap_two,
        pm.gap_three,
        pm.gap_four,
        bpi.installment_number,
        bpi.amount AS installment_amount,
        bpi.due_date
      FROM public."budgetsPayments" bp
      LEFT JOIN public."paymentMethods" pm
        ON pm."paymentMethods_id" = bp.payment_method_id
      LEFT JOIN public."budgetsPaymentInstallments" bpi
        ON bpi.budget_payment_id = bp.budget_payment_id
      WHERE bp.budget_id = $1
      ORDER BY
        bp.budget_payment_id ASC,
        bpi.installment_number ASC NULLS LAST,
        bpi.due_date ASC NULLS LAST
      `,
      [budgetId],
    );

    if (!rows.length) return null;

    const grouped = new Map();

    for (const row of rows) {
      const paymentId = Number(row.budget_payment_id);

      if (!Number.isFinite(paymentId) || paymentId <= 0) continue;

      if (!grouped.has(paymentId)) {
        grouped.set(paymentId, {
          budget_payment_id: paymentId,
          payment_method_id: row.payment_method_id,
          payment_method_name: String(
            row.payment_method_name ||
            row.payment_method_type ||
            'FORMA NÃO INFORMADA',
          ).trim(),
          payment_method_type: String(row.payment_method_type || '').trim(),
          payment_method_nfe_tpag: row.payment_method_nfe_tpag,
          amount: round2(row.amount || 0),
          notes: String(row.notes || '').trim(),
          installments_expected: Math.max(
            0,
            Number(row.payment_method_installments || 0),
          ),
          gap_one: Number(row.gap_one || 0),
          gap_two: Number(row.gap_two || 0),
          gap_three: Number(row.gap_three || 0),
          gap_four: Number(row.gap_four || 0),
          installments: [],
        });
      }

      if (
        row.installment_number != null ||
        row.due_date != null ||
        row.installment_amount != null
      ) {
        grouped.get(paymentId).installments.push({
          installment_number: normalizeInstallmentNumber(
            row.installment_number,
            grouped.get(paymentId).installments.length + 1,
          ),
          due_date: row.due_date,
          amount: round2(row.installment_amount || 0),
        });
      }
    }

    const pagamentos = [];
    const parcelas = [];

    for (const [, payment] of grouped) {
      const metodoVirtual = {
        name: payment.payment_method_name,
        type: payment.payment_method_type,
        nfe_tpag: payment.payment_method_nfe_tpag,
        installments: payment.installments_expected,
        gap_one: payment.gap_one,
        gap_two: payment.gap_two,
        gap_three: payment.gap_three,
        gap_four: payment.gap_four,
      };

      const meio = deriveTpagFromMethodAndHeader({
        metodo: metodoVirtual,
        header: {},
      });

      const installmentsCount = Array.isArray(payment.installments)
        ? payment.installments.length
        : 0;

      const typeNorm = normalizePaymentType(payment.payment_method_type);
      const aVista =
        typeNorm === 'AVISTA' ||
        String(meio) === '90';

      const pagamento = {
        aVista,
        meio,
        valor: round2(payment.amount || 0),
      };

      if (meio === '99' && payment.payment_method_name) {
        pagamento.descricaoMeio = payment.payment_method_name;
      }

      pagamentos.push(pagamento);

      /* ---------------------------------------------------------------
       * Parcelas reais gravadas no orçamento
       * Regra: se a parcela já tem due_date no banco, usa EXATAMENTE ela.
       * Não recalcula em função de "hoje".
       * --------------------------------------------------------------- */
      if (installmentsCount > 0) {
        for (const inst of payment.installments) {
          const dueIso = normalizeDueIso(inst.due_date);

          parcelas.push({
            numero: '000', // será renumerado depois
            ...(dueIso ? { dataVencimento: dueIso } : {}),
            valor: round2(inst.amount || 0),
          });
        }
        continue;
      }

      /* ---------------------------------------------------------------
       * Fallback: pagamento a prazo sem parcelas salvas
       * Monta com base na configuração do método de pagamento
       * --------------------------------------------------------------- */
      const shouldCreateFallbackInstallments =
        !aVista &&
        Math.max(1, Number(payment.installments_expected || 0)) > 1;

      if (shouldCreateFallbackInstallments) {
        const installmentsExpected = Math.max(
          1,
          Number(payment.installments_expected || 1),
        );

        const gapsConfigurados = [
          Number(payment.gap_one || 0),
          Number(payment.gap_two || 0),
          Number(payment.gap_three || 0),
          Number(payment.gap_four || 0),
        ].filter((d) => d > 0);

        const parcelasDias = [];

        if (!gapsConfigurados.length) {
          for (let i = 0; i < installmentsExpected; i++) {
            parcelasDias.push(0);
          }
        } else if (gapsConfigurados.length >= installmentsExpected) {
          for (let i = 0; i < installmentsExpected; i++) {
            parcelasDias.push(gapsConfigurados[i]);
          }
        } else if (gapsConfigurados.length === 1) {
          const base = gapsConfigurados[0];
          for (let i = 1; i <= installmentsExpected; i++) {
            parcelasDias.push(base * i);
          }
        } else {
          const last = gapsConfigurados[gapsConfigurados.length - 1];
          for (let i = 0; i < installmentsExpected; i++) {
            parcelasDias.push(gapsConfigurados[i] ?? last);
          }
        }

        let somaParcelasFallback = 0;
        const valorBase = round2(payment.amount / installmentsExpected);

        parcelasDias.forEach((dias, idx) => {
          const venc = addDays(realIssueDateObj, dias);
          let valorParcela = valorBase;

          if (idx === installmentsExpected - 1) {
            valorParcela = round2(payment.amount - somaParcelasFallback);
          }

          somaParcelasFallback = round2(somaParcelasFallback + valorParcela);

          parcelas.push({
            numero: '000',
            ...(venc ? { dataVencimento: formatLocalISODate(venc) } : {}),
            valor: round2(valorParcela),
          });
        });
      }
    }

    const totalFallbackFinal = round2(totalFallback);
    const totalPagamentos = round2(sum(pagamentos, (p) => p.valor));

    const totalRef =
      totalFallbackFinal > 0
        ? totalFallbackFinal
        : totalPagamentos > 0
          ? totalPagamentos
          : 0;

    const existePagamentoAPrazo = pagamentos.some((p) => p?.aVista === false);

    let cobranca = null;

    if (parcelas.length && existePagamentoAPrazo) {
      const parcelasSequenciais = parcelas.map((p, index) => ({
        ...p,
        numero: String(index + 1).padStart(3, '0'),
        valor: round2(p.valor || 0),
      }));

      const parcelasBalanced = rebalanceParcelasToTotal(
        parcelasSequenciais,
        totalRef,
      );

      cobranca = {
        numero: String(budgetId).padStart(3, '0'),
        valorTotal: round2(totalRef),
        valorLiquido: round2(totalRef),
        parcelas: parcelasBalanced,
      };
    }

    if (pagamentos.length && totalRef > 0) {
      const somaPag = round2(sum(pagamentos, (p) => p.valor));
      const diffPag = round2(totalRef - somaPag);

      if (Math.abs(diffPag) >= 0.01) {
        pagamentos[pagamentos.length - 1].valor = round2(
          Number(pagamentos[pagamentos.length - 1].valor || 0) + diffPag,
        );
      }
    }

    return {
      pagamentos,
      cobranca,
    };
  } catch (err) {
    console.error(
      '[NFE] Erro ao carregar pagamentos reais do orçamento:',
      err.message || err,
    );
    return null;
  }
}

/* =========================================================================
 * 🧠 Unidades NF-e
 * ========================================================================= */
let UNITS_CACHE = null;

async function loadUnitsMap() {
  if (UNITS_CACHE) {
    return UNITS_CACHE;
  }

  const { rows } = await pool.query(`
    SELECT
      unit,
      description
    FROM public.units
    WHERE is_active = TRUE
  `);

  const map = {};

  const normalizeNfeUnitCode = (value) => {
    return String(value || '')
      .toUpperCase()
      .trim()
      .replace(/\./g, '')
      .replace(/\d+$/g, ''); // CX.25 -> CX / FD5 -> FD / CX25 -> CX
  };

  for (const row of rows) {
    const raw = String(row.unit || '')
      .toUpperCase()
      .trim();

    if (!raw) continue;

    const normalized = normalizeNfeUnitCode(raw);

    map[raw] = normalized;
    map[raw.replace(/\./g, '')] = normalized;

    if (row.description) {
      map[
        String(row.description)
          .toUpperCase()
          .trim()
      ] = normalized;
    }
  }

  UNITS_CACHE = map;

  console.log('[NFE] Units loaded:', Object.keys(map).length);

  return map;
}

/* =========================================================================
 * 🧠 Coluna SKU
 * ========================================================================= */
let PRODUCTS_SKU_COL = null;

async function resolveProductsSkuColumn() {
  if (PRODUCTS_SKU_COL) return PRODUCTS_SKU_COL;

  const candidates = [
    'codigo',
    'sku',
    'product_code',
    'codigo_produto',
    'codprod',
    'code',
  ];

  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name = ANY($1)
      LIMIT 1;
    `,
    [candidates],
  );

  if (!rows.length) {
    throw new Error(
      'Não foi possível detectar a coluna de SKU na tabela products.',
    );
  }

  PRODUCTS_SKU_COL = rows[0].column_name;
  console.log(
    `[NFE] Coluna de SKU detectada em public.products: ${PRODUCTS_SKU_COL}`,
  );
  return PRODUCTS_SKU_COL;
}

/* =========================================================================
 * 🔎 Fiscal por SKU
 * ========================================================================= */
async function loadFiscalBySku(skus = []) {
  const clean = Array.from(
    new Set((skus || []).map((s) => String(s).trim()).filter(Boolean)),
  );
  if (!clean.length) return {};

  const skuCol = await resolveProductsSkuColumn();
  const { rows } = await pool.query(
    `
      SELECT
        p."${skuCol}"::text AS sku,
        pf.products_fiscal_id,
        pf.product_code,
        pf.fiscal_classification_id,
        fc.classification_name,
        fc.ncm_code AS ncm,
        fc.ncm_code,
        fc.ncm_description,
        fc.ex_tipi,
        fc.cest_code AS cest,
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
        fp.description AS profile_description,
        fp.icms_cst,
        fp.icms_cst AS cst_icms,
        fp.icms_rate,
        fp.icms_rate AS aliquota_icms,
        fp.cfop_entry,
        fp.cfop_exit,
        fp.origin_code,
        fp.origin_code AS origem_mercadoria,
        fp.pis_cst,
        fp.pis_rate,
        fp.pis_rate AS pis_aliquota,
        fp.cofins_cst,
        fp.cofins_rate,
        fp.cofins_rate AS cofins_aliquota,
        fp.benefit_code
      FROM public.products p
      LEFT JOIN public."productsFiscalV2" pf
        ON pf.product_code = p.product_code
       AND pf.is_current = TRUE
       AND pf.is_active = TRUE
      LEFT JOIN public."fiscalClassificationV2" fc
        ON fc.fiscal_classification_id = pf.fiscal_classification_id
       AND fc.is_active = TRUE
      LEFT JOIN public."fiscalProfileV2" fp
        ON fp.fiscal_profile_id = fc.fiscal_profile_id
       AND fp.is_active = TRUE
      WHERE p."${skuCol}"::text = ANY($1::text[]);
    `,
    [clean],
  );

  const map = {};
  for (const row of rows) {
    if (row.products_fiscal_id) {
      map[String(row.sku)] = row;
    } else {
      console.warn(
        '[NFE] Nenhum vínculo fiscal V2 ativo encontrado para SKU:',
        row.sku,
        'product_code:',
        row.product_code,
      );
    }
  }

  return map;
}

async function loadProductUnitsBySku(skus = []) {
  const clean = Array.from(
    new Set((skus || []).map(s => String(s).trim()).filter(Boolean))
  );

  if (!clean.length) return {};

  const { rows } = await pool.query(`
    SELECT DISTINCT ON (pbc.product_code)
      pbc.product_code AS sku,
      pbc.unit AS unidade
    FROM public."productsBarCode" pbc
    WHERE pbc.product_code = ANY($1)
      AND pbc.is_active = TRUE
      AND NULLIF(TRIM(pbc.unit), '') IS NOT NULL
    ORDER BY
      pbc.product_code,
      COALESCE(pbc.standard, FALSE) DESC,
      COALESCE(pbc.fator, 1) DESC,
      pbc.updated_at DESC
  `, [clean]);

  const map = {};

  for (const row of rows) {
    map[String(row.sku).trim()] = String(row.unidade || '').trim();
  }

  console.log('[NFE][PRODUCT_UNITS_BY_SKU]', map);

  return map;
}

function distribuirDescontoGlobalNosItens(items = [], descontoGlobal = 0) {
  const itens = Array.isArray(items) ? items : [];
  const descontoTotal = round2(descontoGlobal);

  if (!itens.length || descontoTotal <= 0) {
    return itens.map((it) => ({
      ...it,
      _descontoRateado: round2(Number(it.discount_value ?? it.desconto_valor ?? 0)),
    }));
  }

  const totaisBrutos = itens.map((it) =>
    round2(Number(it.quantity || 0) * Number(it.unit_price || 0))
  );

  const somaBruta = round2(totaisBrutos.reduce((acc, v) => acc + v, 0));
  if (somaBruta <= 0) {
    return itens.map((it) => ({
      ...it,
      _descontoRateado: round2(Number(it.discount_value ?? it.desconto_valor ?? 0)),
    }));
  }

  let descontoAcumulado = 0;

  const rateados = itens.map((it, idx) => {
    const descontoItemOriginal = round2(
      Number(it.discount_value ?? it.desconto_valor ?? 0)
    );

    let descontoRateadoGlobal = 0;

    if (idx < itens.length - 1) {
      descontoRateadoGlobal = round2((totaisBrutos[idx] / somaBruta) * descontoTotal);
      descontoAcumulado += descontoRateadoGlobal;
    } else {
      descontoRateadoGlobal = round2(descontoTotal - descontoAcumulado);
    }

    return {
      ...it,
      _descontoRateado: round2(descontoItemOriginal + descontoRateadoGlobal),
    };
  });

  return rateados;
}

function buildPaymentDescriptionFromPayload(pagamentos = [], cobranca = null) {
  const partes = [];

  if (Array.isArray(pagamentos) && pagamentos.length) {
    const headers = pagamentos.map((p) => {
      const desc = p.descricaoMeio || getDescricaoPadraoMeio(p.meio);
      return `${desc} - ${formatMoneyBR(p.valor || 0)}`;
    });

    if (headers.length) {
      partes.push(`FORMA DE PAGAMENTO: ${headers.join(' | ')}`);
    }
  }

  const parcelas = Array.isArray(cobranca?.parcelas) ? cobranca.parcelas : [];
  if (parcelas.length) {
    const linhas = parcelas.map((p, idx) => {
      const parcela = String(p.numero || idx + 1).padStart(3, '0');
      const venc = formatDateBR(p.dataVencimento);
      const valor = formatMoneyBR(p.valor || 0);
      return `PARCELA ${parcela}${venc ? ` - VENC.: ${venc}` : ''} - VALOR: ${valor}`;
    });

    partes.push(`DUPLICATAS: ${linhas.join(' | ')}`);
  }

  return partes.join(' | ');
}

/* =========================================================================
 * 🧱 Helpers integração / destinatário / observação
 * ========================================================================= */
function buildIdIntegracaoFromOrder(header = {}) {
  const orderId = resolveOrderIdForNfe(header);
  const budgetId = header.budget_id ?? null;
  const bonusId = header.bonus_id ?? null;
  const orderNumber =
    header.number ??
    header.order_number ??
    null;

  const nfeStatus = toUpperSafe(
    header.nfe_status ??
    header.nfeStatus,
  );

  if (
    orderId &&
    ['REJEITADA', 'REJEITADO'].includes(nfeStatus)
  ) {
    return `ORD-${orderId}-R${Date.now()}`;
  }

  if (orderId) {
    return `ORD-${orderId}`;
  }

  if (budgetId) {
    return `BUD-${budgetId}`;
  }

  if (bonusId) {
    return `BON-${bonusId}`;
  }

  if (orderNumber) {
    return `ORDNUM-${orderNumber}`;
  }

  return `ERP${Date.now()}`;
}

async function buildDestinatarioFromOrderHeader(
  header,
  { docDest, ieRaw, isNaoContribuinte },
) {
  let customer = null;

  if (header.customer_id) {
    try {
      customer = await customersApi.getById(
        header.customer_id,
      );
    } catch (error) {
      console.error(
        '[NFE] Falha ao carregar customer via customersApi.getById:',
        error.message || error,
      );
    }
  }

  const c = customer || {};

  /*
   * Razão social:
   * 1. Legal name;
   * 2. Legal name saved in the order;
   * 3. Customer name saved in the order;
   * 4. Trade name only as fallback.
   */
  const razaoSocial = (
    c.legal_name ||
    header.customer_legal_name ||
    header.customer_name ||
    c.trade_name ||
    'CONSUMIDOR FINAL'
  )
    .toString()
    .trim()
    .toUpperCase();

  const ieDb = String(
    c.state_registration || '',
  ).trim();

  const ieFinalRaw = String(
    ieRaw || ieDb || '',
  ).trim();

  const ieValida =
    Boolean(ieFinalRaw) &&
    !/^ISENTO$/i.test(ieFinalRaw);

  const indicadorIEDestinatario = ieValida
    ? '1'
    : isNaoContribuinte
      ? '9'
      : '9';

  const tipoLogradouro =
    c.street_type ||
    c.address_type ||
    c.tipo_logradouro ||
    c.logradouro_tipo ||
    header.customer_street_type ||
    header.tipo_logradouro ||
    '';

  const nomeLogradouro =
    c.street_name ||
    c.address ||
    c.logradouro ||
    header.customer_street ||
    header.customer_address ||
    '';

  const logradouro =
    montarLogradouroNfe(
      tipoLogradouro,
      nomeLogradouro,
    ) || 'AVENIDA';

  const numero = String(
    c.street_number ||
    header.customer_number ||
    '0',
  )
    .trim()
    .toUpperCase();

  const bairro = String(
    c.neighborhood ||
    header.customer_neighborhood ||
    'CENTRO',
  )
    .trim()
    .toUpperCase();

  const cidade = String(
    c.city ||
    header.customer_city ||
    'BELO HORIZONTE',
  )
    .trim()
    .toUpperCase();

  const uf = String(
    c.state ||
    header.customer_state ||
    'MG',
  )
    .trim()
    .toUpperCase();

  const cep =
    sanitizeCep(
      c.postal_code ||
      header.customer_zip,
    ) || '30170012';

  const codigoCidade = resolveCodigoCidadeIbge(
    uf,
    cidade,
    c,
    header,
  );

  const telefoneSplit = splitPhone(
    c.mobile_number ||
    c.phone_number ||
    header.customer_mobile ||
    header.customer_phone ||
    '',
  );

  const destinatario = {
    cpfCnpj: docDest,
    razaoSocial,
    indicadorIEDestinatario,

    ...(ieValida
      ? {
        inscricaoEstadual:
          ieFinalRaw.replace(/\D/g, ''),
      }
      : {}),

    ...(telefoneSplit
      ? {
        telefone: telefoneSplit,
      }
      : {}),

    endereco: {
      logradouro,
      numero,
      bairro,
      codigoCidade,
      descricaoCidade: cidade,
      estado: uf,
      cep,
      codigoPais: '1058',
    },
  };

  /*
   * Diagnóstico temporário:
   * mostra a origem do nome e o destinatário montado
   * antes do envio para PlugNotas.
   */
  console.log(
    '[NFE][DESTINATARIO][ANTES DO ENVIO]',
    {
      customerId:
        header.customer_id ?? null,

      legalNameCadastro:
        c.legal_name ?? null,

      tradeNameCadastro:
        c.trade_name ?? null,

      legalNamePedido:
        header.customer_legal_name ?? null,

      customerNamePedido:
        header.customer_name ?? null,

      razaoSocialEnviada:
        destinatario.razaoSocial,

      cpfCnpjEnviado:
        destinatario.cpfCnpj,

      inscricaoEstadualEnviada:
        destinatario.inscricaoEstadual ?? null,

      ambiente:
        process.env.NODE_ENV ?? null,
    },
  );

  return destinatario;
}

async function loadBudgetObservation(budgetId) {
  if (!budgetId) return null;

  try {
    const { rows } = await pool.query(
      `
      SELECT COALESCE(notes, '') AS observation
      FROM public."budgets"
      WHERE budget_id = $1
      LIMIT 1
      `,
      [budgetId],
    );

    if (!rows.length) return null;

    const obs = String(rows[0].observation || '').trim();
    return obs || null;
  } catch (err) {
    console.error('[NFE] Erro ao buscar observação do orçamento:', err.message || err);
    return null;
  }
}

async function loadBudgetPaymentDescription(budgetId) {
  if (!budgetId) return null;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        bp.budget_payment_id,
        bp.amount,
        bp.notes,
        pm.name AS payment_method_name,
        pm.type AS payment_method_type,
        bpi.installment_number,
        bpi.amount AS installment_amount,
        bpi.due_date
      FROM public."budgetsPayments" bp
      LEFT JOIN public."paymentMethods" pm
        ON pm."paymentMethods_id" = bp.payment_method_id
      LEFT JOIN public."budgetsPaymentInstallments" bpi
        ON bpi.budget_payment_id = bp.budget_payment_id
      WHERE bp.budget_id = $1
      ORDER BY
        bp.budget_payment_id ASC,
        bpi.installment_number ASC NULLS LAST,
        bpi.due_date ASC NULLS LAST
      `,
      [budgetId],
    );

    if (!rows.length) return null;

    const grouped = new Map();

    for (const row of rows) {
      const paymentId = Number(row.budget_payment_id);

      if (!grouped.has(paymentId)) {
        grouped.set(paymentId, {
          methodName: String(
            row.payment_method_name ||
            row.payment_method_type ||
            'FORMA NÃO INFORMADA',
          ).trim(),
          amount: round2(row.amount || 0),
          notes: String(row.notes || '').trim(),
          installments: [],
        });
      }

      if (
        row.installment_number != null ||
        row.due_date != null ||
        row.installment_amount != null
      ) {
        grouped.get(paymentId).installments.push({
          installment_number:
            row.installment_number != null
              ? Number(row.installment_number)
              : null,
          due_date: row.due_date,
          amount: round2(row.installment_amount || 0),
        });
      }
    }

    const paymentHeaders = [];
    const installmentLines = [];

    for (const [, payment] of grouped) {
      let header = `${payment.methodName} - ${formatMoneyBR(payment.amount)}`;

      if (payment.notes) {
        header += ` (${payment.notes})`;
      }

      paymentHeaders.push(header);

      for (const inst of payment.installments) {
        const parcela = String(inst.installment_number || 1).padStart(3, '0');
        const venc = formatDateBR(inst.due_date);
        const valor = formatMoneyBR(inst.amount || 0);

        installmentLines.push(
          `PARCELA ${parcela}${venc ? ` - VENC.: ${venc}` : ''} - VALOR: ${valor}`,
        );
      }
    }

    const partes = [];

    if (paymentHeaders.length) {
      partes.push(`FORMA DE PAGAMENTO: ${paymentHeaders.join(' | ')}`);
    }

    if (installmentLines.length) {
      partes.push(`DUPLICATAS: ${installmentLines.join(' | ')}`);
    }

    return partes.join(' | ');
  } catch (err) {
    console.error(
      '[NFE] Erro ao buscar descrição dos pagamentos do orçamento:',
      err.message || err,
    );
    return null;
  }
}

/* =========================================================================
 * ✅ Validação fiscal completa pré-envio
 * ========================================================================= */
function validarNFeFiscalmente(nfe) {
  const erros = [];
  const avisos = [];
  const logs = [];

  const itens = Array.isArray(nfe?.itens) ? nfe.itens : [];
  const pagamentos = Array.isArray(nfe?.pagamentos) ? nfe.pagamentos : [];
  const parcelas = Array.isArray(nfe?.cobranca?.parcelas)
    ? nfe.cobranca.parcelas
    : [];

  if (!itens.length) {
    erros.push('NF-e sem itens.');
  }

  let somaProdutos = 0;
  let somaDescontos = 0;
  let somaLiquidaItens = 0;

  itens.forEach((item, idx) => {
    const nItem = idx + 1;

    const qtdCom = round4(item?.quantidade?.comercial);
    const qtdTrib = round4(item?.quantidade?.tributavel);

    const vUnCom = round4(item?.valorUnitario?.comercial);
    const vUnTrib = round4(item?.valorUnitario?.tributavel);

    const vProd = money(item?.valor);
    const vDesc = money(item?.valorDesconto || 0);

    const vBrutoEsperado = money(qtdCom * vUnCom);
    const vLiquido = money(vProd - vDesc);

    somaProdutos += vProd;
    somaDescontos += vDesc;
    somaLiquidaItens += vLiquido;

    if (!nearlyEqual(qtdCom, qtdTrib, 0.0001)) {
      avisos.push(
        `Item ${nItem}: quantidade comercial difere da tributável.`,
      );
    }

    if (!nearlyEqual(vUnCom, vUnTrib, 0.0001)) {
      avisos.push(
        `Item ${nItem}: valor unitário comercial difere do tributável.`,
      );
    }

    if (!nearlyEqual(vProd, vBrutoEsperado, 0.01)) {
      erros.push(
        `Item ${nItem}: valor bruto do item inválido. valor=${vProd} mas qCom×vUnCom=${vBrutoEsperado}.`,
      );
    }

    if (vDesc < 0) {
      erros.push(`Item ${nItem}: desconto negativo inválido.`);
    }

    if (vDesc > vProd) {
      erros.push(`Item ${nItem}: desconto maior que o valor bruto do item.`);
    }

    const icmsBase = money(item?.tributos?.icms?.baseCalculo?.valor);
    const pisBase = money(item?.tributos?.pis?.baseCalculo?.valor);
    const cofinsBase = money(item?.tributos?.cofins?.baseCalculo?.valor);
    const ipiBase = money(item?.tributos?.ipi?.baseCalculo?.valor);

    if (item?.tributos?.icms?.baseCalculo && !nearlyEqual(icmsBase, vLiquido)) {
      erros.push(
        `Item ${nItem}: base de ICMS inconsistente. base=${icmsBase} líquido=${vLiquido}.`,
      );
    }

    if (item?.tributos?.pis?.baseCalculo && !nearlyEqual(pisBase, vLiquido)) {
      erros.push(
        `Item ${nItem}: base de PIS inconsistente. base=${pisBase} líquido=${vLiquido}.`,
      );
    }

    if (
      item?.tributos?.cofins?.baseCalculo &&
      !nearlyEqual(cofinsBase, vLiquido)
    ) {
      erros.push(
        `Item ${nItem}: base de COFINS inconsistente. base=${cofinsBase} líquido=${vLiquido}.`,
      );
    }

    if (item?.tributos?.ipi?.baseCalculo && !nearlyEqual(ipiBase, vLiquido)) {
      avisos.push(
        `Item ${nItem}: base de IPI difere do líquido do item. base=${ipiBase} líquido=${vLiquido}.`,
      );
    }

    if (!item?.codigo) erros.push(`Item ${nItem}: código do produto ausente.`);
    if (!item?.descricao)
      erros.push(`Item ${nItem}: descrição do produto ausente.`);
    if (!item?.cfop) erros.push(`Item ${nItem}: CFOP ausente.`);
    if (!item?.ncm) avisos.push(`Item ${nItem}: NCM ausente.`);

    logs.push({
      item: nItem,
      codigo: item?.codigo,
      descricao: item?.descricao,
      quantidadeComercial: qtdCom,
      valorUnitarioComercial: vUnCom,
      valorBruto: vProd,
      valorDesconto: vDesc,
      valorLiquido: vLiquido,
      baseICMS: icmsBase,
      basePIS: pisBase,
      baseCOFINS: cofinsBase,
    });
  });

  somaProdutos = money(somaProdutos);
  somaDescontos = money(somaDescontos);
  somaLiquidaItens = money(somaLiquidaItens);

  const valorFrete = money(
    nfe?._meta?.valorFrete ??
    nfe?.total?.valorFrete ??
    0,
  );

  const valorNotaCalculado = money(somaProdutos - somaDescontos + valorFrete);
  const valorNotaEsperado = money(
    nfe?._meta?.valorNotaEsperado ?? valorNotaCalculado,
  );

  const somaPagamentos = money(sum(pagamentos, (p) => p?.valor));
  const somaParcelas = money(sum(parcelas, (p) => p?.valor));

  if (!nearlyEqual(valorNotaCalculado, valorNotaEsperado)) {
    erros.push(
      `Total da nota inconsistente. calculado=${valorNotaCalculado} esperado=${valorNotaEsperado}.`,
    );
  }

  if (
    nfe?._meta?.generatesReceivable !== false &&
    pagamentos.length &&
    !nearlyEqual(somaPagamentos, valorNotaEsperado)
  ) {
    erros.push(
      `Soma dos pagamentos diverge do total da nota. pagamentos=${somaPagamentos} nota=${valorNotaEsperado}.`,
    );
  }

  if (parcelas.length && !nearlyEqual(somaParcelas, valorNotaEsperado)) {
    erros.push(
      `Soma das duplicatas diverge do total da nota. duplicatas=${somaParcelas} nota=${valorNotaEsperado}.`,
    );
  }

  if (nfe?.cobranca && !parcelas.length) {
    erros.push('Bloco de cobrança enviado sem parcelas.');
  }

  if (parcelas.length) {
    const numerosParcelas = new Set();

    parcelas.forEach((p, idx) => {
      const numero = String(p?.numero || '').trim();

      if (!numero) {
        erros.push(`Parcela ${idx + 1}: número da parcela não informado.`);
        return;
      }

      if (numerosParcelas.has(numero)) {
        erros.push(
          `Parcela ${idx + 1}: número da parcela duplicado (${numero}).`,
        );
        return;
      }

      numerosParcelas.add(numero);
    });
  }

  const todosPagamentosAVista =
    pagamentos.length > 0 && pagamentos.every((p) => p?.aVista === true);

  if (todosPagamentosAVista && nfe?.cobranca) {
    erros.push(
      'Pagamento à vista com bloco de cobrança presente. Remova a cobrança para evitar rejeição 853.',
    );
  }

  const resumo = {
    totalProdutos: somaProdutos,
    totalDesconto: somaDescontos,
    totalLiquidoItens: somaLiquidaItens,
    valorFrete,
    valorNotaCalculado,
    valorNotaEsperado,
    somaPagamentos,
    somaParcelas,
    quantidadeItens: itens.length,
  };

  return {
    ok: erros.length === 0,
    erros,
    avisos,
    resumo,
    logs,
  };
}

function sameIsoDate(a, b) {
  const da = String(a || '').slice(0, 10);
  const db = String(b || '').slice(0, 10);
  return !!da && !!db && da === db;
}

function getParcelasFromCobranca(cobranca) {
  return Array.isArray(cobranca?.parcelas) ? cobranca.parcelas : [];
}

function isPagamentoAVistaReal(cobranca, emissaoISO) {
  const parcelas = getParcelasFromCobranca(cobranca);

  if (!parcelas.length) return true;

  if (parcelas.length === 1) {
    const venc = parcelas[0]?.dataVencimento || '';
    if (sameIsoDate(venc, emissaoISO)) return true;
  }

  return false;
}

function buildTransporteFromOrder(header = {}, totalFrete = 0, { strict = true } = {}) {
  const shipping =
    header.shipping ||
    header.delivery ||
    header.order_delivery ||
    header ||
    {};

  const text = (v) => String(v ?? '').trim();

  // Primeiro valor não vazio (aceita 0 como valor válido)
  const pick = (...values) => {
    for (const v of values) {
      const s = text(v);
      if (s) return s;
    }
    return '';
  };

  // Limites do layout da NF-e (xNome, xEnder, xMun = 60)
  const limit = (v, max) => text(v).slice(0, max);

  // ── Modalidade do frete ───────────────────────────────────────────────
  const modalidadeFrete = pick(shipping.freight_mode, shipping.modalidadeFrete) ||
    (Number(totalFrete || 0) > 0 ? '0' : '9');

  const transporte = {
    modalidadeFrete: String(modalidadeFrete),
  };

  // ── Transportador ─────────────────────────────────────────────────────
  // budgetsShipping usa carrier_state; ordersDelivery usa carrier_uf
  const nome = limit(pick(shipping.carrier_name, shipping.carrierName), 60);
  const doc = onlyDigits(pick(shipping.carrier_cnpj_cpf, shipping.carrier_doc));

  const ieRaw = pick(shipping.carrier_ie, shipping.carrierIe);
  const ie = /^ISENTO$/i.test(ieRaw) ? 'ISENTO' : onlyDigits(ieRaw);

  const uf = toUpperSafe(
    pick(shipping.carrier_state, shipping.carrier_uf, shipping.carrierState, shipping.carrierUf)
  ).slice(0, 2);

  const cidade = limit(pick(shipping.carrier_city, shipping.carrierCity), 60);

  const logradouro = pick(shipping.carrier_address);
  const numero = pick(shipping.carrier_number);
  const bairro = pick(shipping.carrier_district);

  const linhaLogradouro = logradouro
    ? (numero ? `${logradouro}, ${numero}` : logradouro)
    : numero;

  const enderecoTxt = limit(
    [linhaLogradouro, bairro].filter(Boolean).join(' - ').toUpperCase(),
    60
  );

  if (nome || doc) {
    // SEFAZ rejeita IE/município sem UF ("UF do Transportador nao informada")
    if ((ie || cidade) && !/^[A-Z]{2}$/.test(uf)) {
      const msg =
        'UF da transportadora não informada. Preencha o estado no cadastro ' +
        'da transportadora (ou no frete do orçamento) antes de emitir a NF-e.';

      if (strict) {
        const err = new Error(msg);
        err.status = 400;
        err.statusCode = 400;
        err.code = 'CARRIER_UF_REQUIRED';
        throw err;
      }

      console.warn(`[NFe][transporte] ${msg}`);
    }

    const transportador = {};

    if (doc.length === 14) transportador.cnpj = doc;
    else if (doc.length === 11) transportador.cpf = doc;

    if (nome) transportador.nome = nome;
    if (ie) transportador.inscricaoEstadual = ie;

    const endereco = {};
    if (enderecoTxt) endereco.logradouro = enderecoTxt;
    if (cidade) endereco.descricaoCidade = cidade;
    if (uf) endereco.uf = uf;

    if (Object.keys(endereco).length) {
      transportador.endereco = endereco;
    }

    transporte.transportador = transportador;
  }

  // ── Veículo ───────────────────────────────────────────────────────────
  const placa = toUpperSafe(pick(shipping.vehicle_plate))
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 7);

  if (placa) {
    const veiculo = { placa };

    const vehicleUF = toUpperSafe(
      pick(shipping.vehicle_state, shipping.vehicle_uf)
    ).slice(0, 2);

    const rntc = limit(pick(shipping.vehicle_rntc, shipping.antt_code), 20);

    if (vehicleUF) veiculo.uf = vehicleUF;
    if (rntc) veiculo.rntc = rntc;

    transporte.veiculo = veiculo;
  }

  // ── Volumes ───────────────────────────────────────────────────────────
  // volumes tem default 0 na tabela: usa o primeiro valor > 0
  const quantidade =
    [shipping.volumes, shipping.volume_quantity]
      .map((v) => Number(v))
      .find((n) => Number.isFinite(n) && n > 0) || 0;

  if (quantidade > 0) {
    const volume = {
      quantidade,
      pesoBruto: Number(shipping.gross_weight || 0),
      pesoLiquido: Number(shipping.net_weight || 0),
    };

    const especie = limit(shipping.volume_species, 60);
    const marca = limit(shipping.volume_brand, 60);
    const numeracao = limit(shipping.volume_numbering, 60);

    if (especie) volume.especie = especie;
    if (marca) volume.marca = marca;
    if (numeracao) volume.numeracao = numeracao;

    transporte.volumes = [volume];
  }

  console.log('[NFe][transporte] payload:', JSON.stringify(transporte));

  return transporte;
}

async function loadOrderDeliveryForNfe(orderId) {
  if (!orderId) return null;

  const { rows } = await pool.query(
    `
    SELECT *
    FROM public."ordersDelivery"
    WHERE order_id = $1
    LIMIT 1
    `,
    [orderId]
  );

  return rows[0] || null;
}

/* =========================================================================
 * 🧱 Monta JSON NFe (padrão TecnoSpeed / PlugNotas)
 * ========================================================================= */
export async function buildNFeFromOrder(
  orderInput,
  {
    preview = false,
  } = {},
) {
  const empresa = getEmpresaConfig();

  const header = orderInput?.header || orderInput || {};
  const items = Array.isArray(orderInput?.items) ? orderInput.items : [];

  const stockMode =
    await resolveActiveStockMode();

  console.log('[NFE][STOCK_MODE]', {
    mode: stockMode.mode,
    isSimple: stockMode.isSimple,
    isWithLot: stockMode.isWithLot,
    requireLot: stockMode.requireLot,
  });

  // ✅ SEMPRE usa a data/hora atual no momento da emissão da NF-e
  const realIssueDateObj = new Date();

  if (!isValidDateObj(realIssueDateObj)) {
    throw new Error('[NFE] Falha ao gerar data atual de emissão da NF-e.');
  }

  const realIssueDateISO = formatLocalISODate(realIssueDateObj);

  const orderId = resolveOrderIdForNfe(header);

  if (orderId && !header.shipping) {
    header.shipping = await loadOrderDeliveryForNfe(orderId);

    console.log('[NFE][SHIPPING LOADED DIRECT]', {
      order_id: orderId,
      shipping: header.shipping,
    });
  }

  if (orderId && !preview) {
    await persistOrderIssueDate(
      orderId,
      realIssueDateObj,
    );
  }

  const docDest = sanitizeCpfCnpj(
    header.customer_tax_id ||
    header.cnpj_cpf ||
    header.cpf_cnpj ||
    header.documento ||
    null,
  );

  const ieRaw = (
    header.ie ||
    header.inscricao_estadual ||
    header.state_registration ||
    header.ie_rg ||
    ''
  ).trim();

  const ieInformada = !!ieRaw && !/^ISENTO$/i.test(ieRaw);
  const isNaoContribuinte = !ieInformada;

  const consumidorFinalRaw =
    header.consumidor_final ??
    header.consumidorFinal ??
    header.final_consumer ??
    header.is_final_consumer;

  const consumidorFinalValue = String(consumidorFinalRaw ?? '')
    .trim()
    .toLowerCase();

  const consumidorFinal =
    consumidorFinalRaw === true ||
    consumidorFinalRaw === 1 ||
    ['1', 'true', 'sim', 's', 'yes'].includes(consumidorFinalValue);

  const destinatario = await buildDestinatarioFromOrderHeader(header, {
    docDest,
    ieRaw,
    isNaoContribuinte,
  });

  const skus = items.map((i) => i.sku);
  const fiscalBySku = await loadFiscalBySku(skus);

  const productUnitsBySku = await loadProductUnitsBySku(skus);

  const totalProdutos = round2(
    items.reduce(
      (s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0),
      0,
    ),
  );

  const totalDescontoItens = round2(
    items.reduce(
      (s, it) => s + Number(it.discount_value ?? it.desconto_valor ?? 0),
      0,
    ),
  );

  const totalFrete = round2(
    Number(
      header.freight_value ??
      header.freight ??
      header.shipping_value ??
      header.shipping_amount ??
      header.valor_frete ??
      header.frete ??
      0
    )
  );

  const totalPedidoInformado = round2(
    Number(
      header.total_amount ??
      header.total ??
      header.valor_total ??
      header.order_total ??
      0
    )
  );

  let totalDesconto = totalDescontoItens;

  if (totalPedidoInformado > 0) {
    const descontoCalculadoPeloHeader = round2(
      totalProdutos + totalFrete - totalPedidoInformado
    );

    if (descontoCalculadoPeloHeader >= 0) {
      totalDesconto = descontoCalculadoPeloHeader;
    }
  }

  const subtotalItens = round2(totalProdutos - totalDesconto);
  const valorNotaFinal = round2(subtotalItens + totalFrete);

  const descontoGlobalCalculado = round2(
    Math.max(0, totalDesconto - totalDescontoItens)
  );

  const itemsComDescontoNfe = distribuirDescontoGlobalNosItens(
    items,
    descontoGlobalCalculado,
  );

  const fiscalOperation = header.fiscal_operation || header.operation || {};
  const generatesReceivable =
    fiscalOperation.generates_receivable ??
    header.generates_receivable ??
    true;

  let pagamentos = [];
  let cobranca = null;

  const budgetPaymentData = header.budget_id && generatesReceivable
    ? await loadBudgetPaymentsForNfe(
      header.budget_id,
      valorNotaFinal,
      realIssueDateObj
    )
    : null;

  if (budgetPaymentData?.pagamentos?.length) {
    pagamentos = budgetPaymentData.pagamentos;
    cobranca = budgetPaymentData.cobranca;

    console.log(
      '[NFE] Pagamentos reais do orçamento carregados:',
      JSON.stringify(
        {
          budget_id: header.budget_id,
          pagamentos,
          cobranca,
        },
        null,
        2,
      ),
    );
  } else if (generatesReceivable) {
    cobranca = await buildCobrancaFromOrderHeader(
      {
        ...header,
        total_amount: valorNotaFinal,
      },
      valorNotaFinal,
      realIssueDateObj,
    );

    let totalFatura = NaN;
    if (cobranca) {
      const v1 = Number(cobranca.valorLiquido ?? NaN);
      const v2 = Number(cobranca.valorTotal ?? NaN);
      totalFatura = Number.isFinite(v1) ? v1 : v2;
    }

    pagamentos = await buildPagamentosFromOrderHeader(
      {
        ...header,
        total_amount: valorNotaFinal,
      },
      valorNotaFinal,
      Number.isFinite(totalFatura) ? totalFatura : undefined,
    );

    if (
      cobranca &&
      Array.isArray(pagamentos) &&
      pagamentos.length &&
      Number.isFinite(totalFatura)
    ) {
      pagamentos[0].valor = round2(totalFatura);
    }
  }

  if (orderId && cobranca?.parcelas?.length) {
    const firstDue = cobranca.parcelas[0].dataVencimento;
    if (firstDue) {
      await pool.query(
        `
          UPDATE public."orders"
          SET due_date = $1, updated_at = NOW()
          WHERE order_id = $2
        `,
        [firstDue, orderId],
      );
    }
  }

  const pagamentoAVistaReal = isPagamentoAVistaReal(
    cobranca,
    realIssueDateISO,
  );

  pagamentos = (Array.isArray(pagamentos) ? pagamentos : []).map((p) => ({
    ...p,
    aVista: pagamentoAVistaReal,
  }));

  let cobrancaFinal = pagamentoAVistaReal ? null : cobranca;

  if (pagamentoAVistaReal) {
    console.log(
      '[NFE] Pagamento à vista real detectado → removendo bloco de cobranca (fatura/duplicatas).',
    );
  }

  function nowLocalIsoDateTime(date = new Date()) {
    const d = date;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // ✅ SEMPRE usa a data/hora atual na emissão
  const dhSaiEnt = nowLocalIsoDateTime(realIssueDateObj);

  const serie = Number(process.env.NFE_SERIE || 1);
  const idIntegracao = buildIdIntegracaoFromOrder(header);

  /*
   * Preview only consults the probable next number.
   * Real issuance atomically reserves and persists the number.
   */
  const numero = preview
    ? await peekNextNfeNumber(header)
    : await getNextNfeNumberForOrder(header);

  let obs = null;
  let budgetPaymentInfo = null;

  if (header.budget_id) {
    obs = await loadBudgetObservation(header.budget_id);
    budgetPaymentInfo = await loadBudgetPaymentDescription(header.budget_id);
  }

  if (!obs) {
    obs =
      header.observation ||
      header.observacao ||
      header.obs ||
      header.notes ||
      header.additional_info ||
      null;
  }

  const obsParts = [
    String(obs || '').trim(),
    String(budgetPaymentInfo || '').trim(),
  ].filter(Boolean);

  const obsClean = obsParts.join(' | ');

  console.log('[NFE] pagamentos antes do ajuste final =', JSON.stringify(pagamentos, null, 2));
  console.log('[NFE] cobranca antes do ajuste final =', JSON.stringify(cobrancaFinal, null, 2));
  console.log('[NFE] informacoesComplementares =', obsClean);

  const totalPagamentosAntes = round2(sum(pagamentos, (p) => p.valor));
  const diffPagamentos = round2(valorNotaFinal - totalPagamentosAntes);

  if (pagamentos.length && Math.abs(diffPagamentos) >= 0.01) {
    pagamentos[pagamentos.length - 1].valor = round2(
      Number(pagamentos[pagamentos.length - 1].valor || 0) + diffPagamentos,
    );
  }

  let cobrancaAjustada = cobrancaFinal ?? null;

  if (cobrancaAjustada) {
    cobrancaAjustada = normalizeCobrancaToTotal(cobrancaAjustada, valorNotaFinal);

    /*
     * ✅ nFat = número da NF-e.
     *
     * O número da fatura precisa ser o mesmo número da nota (nNF),
     * e não o número do pedido/orçamento, para casar com o
     * "Nº Fatura" de Contas a Receber (nfe_number/parcela).
     */
    cobrancaAjustada = {
      ...cobrancaAjustada,
      numero: String(numero),
    };
  }

  const totalPagamentosFinal = round2(sum(pagamentos, (p) => p.valor));

  const valorTroco = round2(
    Math.max(0, totalPagamentosFinal - valorNotaFinal)
  );

  const pagamentosFinal = generatesReceivable
    ? (Array.isArray(pagamentos) ? pagamentos : [])
    : [{ aVista: true, meio: '90', valor: 0 }];
  const valorTrocoFinal = valorTroco;
  const cobrancaPayload = generatesReceivable
    ? cobrancaAjustada
    : null;

  const paymentInfoFinal = buildPaymentDescriptionFromPayload(
    pagamentosFinal,
    cobrancaPayload,
  );

  console.log('[NFE] pagamentos payload final =', JSON.stringify(pagamentosFinal, null, 2));
  console.log('[NFE] cobranca payload final =', JSON.stringify(cobrancaPayload, null, 2));

  const unitsMap = await loadUnitsMap();

  function normalizeNfeUnit(value) {
    const raw = String(value || 'UN')
      .toUpperCase()
      .trim();

    return (
      unitsMap[raw] ||
      unitsMap[raw.replace(/\./g, '')] ||
      raw.replace(/\./g, '') ||
      'UN'
    );
  }

  const codigoMunicipioIbs = onlyDigits(
    destinatario?.endereco?.codigoCidade,
  );

  if (codigoMunicipioIbs.length !== 7) {
    throw new Error(
      '[NFE] Código do município de consumo do IBS/CBS ausente ou inválido.',
    );
  }

  const lotIds = stockMode.isWithLot ? Array.from(
    new Set(
      itemsComDescontoNfe
        .map((item) => Number(item.lot_id))
        .filter(Number.isFinite),
    ),
  ) : [];

  const productCodes = stockMode.isSimple ? Array.from(
    new Set(
      itemsComDescontoNfe
        .map((item) => String(item.product_code || item.sku || '').trim())
        .filter(Boolean),
    ),
  ) : [];

  const { rows: entradasSt } = lotIds.length
    ? await pool.query(
      `
        SELECT DISTINCT ON (lot_id)
          lot_id,
          quantity AS inbound_quantity,
          icms AS icms_value,
          icms_st_base,
          icms_st_rate,
          icms_st_value
        FROM "inboundInvoiceItems"
        WHERE lot_id = ANY($1::bigint[])
          AND icms_st_base IS NOT NULL
          AND icms_st_rate IS NOT NULL
          AND icms_st_value IS NOT NULL
        ORDER BY lot_id, inbound_item_id DESC
      `,
      [lotIds],
    )
    : { rows: [] };

  const entradaStPorLote = Object.fromEntries(
    entradasSt.map((entrada) => [
      String(entrada.lot_id),
      entrada,
    ]),
  );

  console.log('[NFE][ICMS-ST POR LOTE]', entradaStPorLote);

  const { rows: entradasStPorProdutoRows } = productCodes.length
    ? await pool.query(
      `
        SELECT DISTINCT ON (TRIM(product_code))
          TRIM(product_code) AS product_code,
          quantity AS inbound_quantity,
          icms AS icms_value,
          icms_st_base,
          icms_st_rate,
          icms_st_value
        FROM public."inboundInvoiceItems"
        WHERE TRIM(product_code) = ANY($1::text[])
          AND quantity IS NOT NULL
          AND quantity > 0
          AND icms_st_base IS NOT NULL
          AND icms_st_rate IS NOT NULL
          AND icms_st_value IS NOT NULL
        ORDER BY TRIM(product_code), inbound_item_id DESC
      `,
      [productCodes],
    )
    : { rows: [] };

  const entradaStPorProduto = Object.fromEntries(
    entradasStPorProdutoRows.map((entrada) => [
      String(entrada.product_code).trim(),
      entrada,
    ]),
  );

  console.log('[NFE][ICMS-ST POR PRODUTO]', entradaStPorProduto);

  function getEntradaStForItem(item) {
    if (stockMode.isWithLot) {
      return entradaStPorLote[String(item.lot_id || '').trim()] || null;
    }

    const productCode = String(
      item.product_code || item.sku || '',
    ).trim();

    return entradaStPorProduto[productCode] || null;
  }

  const icmsStDetails = itemsComDescontoNfe
    .map((it) => {
      const fiscal = {
        ...it,
        ...(fiscalBySku[String(it.sku || '').trim()] || {}),
      };

      const cst = String(
        fiscal.cst_icms ||
        fiscal.icms_cst ||
        '',
      ).padStart(2, '0');

      // This complementary information applies to CST 60.
      if (cst !== '60') {
        return null;
      }

      const entradaSt = getEntradaStForItem(it);

      if (!entradaSt) {
        return null;
      }

      const quantidadeSaida = Number(
        it.quantity ??
        it.qtd ??
        it.qtd_comercial ??
        it.qtd_venda ??
        0
      );

      const quantidadeEntrada = Number(entradaSt.inbound_quantity);

      if (
        !Number.isFinite(quantidadeSaida) ||
        quantidadeSaida <= 0 ||
        !Number.isFinite(quantidadeEntrada) ||
        quantidadeEntrada <= 0
      ) {
        return null;
      }

      const proporcao = quantidadeSaida / quantidadeEntrada;

      const proporcionalizarDinheiro = (valor) => {
        const centavosEntrada = Math.round(Number(valor || 0) * 100);
        return Math.round(centavosEntrada * proporcao) / 100;
      };

      const baseStAnterior = proporcionalizarDinheiro(
        entradaSt.icms_st_base
      );

      const valorStAnterior = proporcionalizarDinheiro(
        entradaSt.icms_st_value
      );

      const codigoProduto = String(it.sku || '').trim();

      return [
        `CodProd: ${codigoProduto}`,
        `Base ST Ant.: ${formatMoneyBRComplete(baseStAnterior)}`,
        `Valor ST Ant.: ${formatMoneyBRComplete(valorStAnterior)}`,
      ].join(' / ');
    })
    .filter(Boolean);

  const icmsStInfo = icmsStDetails.length
    ? [
      'Imposto recolhido por ST nos termos do Anexo VII do RICMS/2023, Decreto nº 48.589.',
      ...icmsStDetails,
    ].join(' ')
    : '';

  // ================================================================
  // Nº FATURA / nFat nas Informações Complementares
  // ================================================================
  const numeroFaturaInfo = cobrancaPayload?.numero
    ? `Fatura: ${String(cobrancaPayload.numero).trim()}`
    : '';

  const informacoesComplementaresFinal = [
    String(obs || '').trim(),
    String(icmsStInfo || '').trim(),
    String(numeroFaturaInfo || '').trim(),
    String(paymentInfoFinal || '').trim(),
  ]
    .filter(Boolean)
    .join(' | ');

  console.log(
    '[NFE] Informações complementares finais:',
    informacoesComplementaresFinal,
  );

  const natureOperation = String(
    fiscalOperation.nature_operation ||
    header.nature_operation ||
    'VENDA DE MERCADORIAS'
  ).trim();

  const nfe = {
    idIntegracao,
    dataHoraSaidaEntrada: dhSaiEnt,
    numero,
    finalidade: '1',
    saida: true,
    presencial: '1',
    serie,
    consumidorFinal,
    codigoMunicipioFatoGeradorIbs: codigoMunicipioIbs,
    natureza: natureOperation,

    ...(informacoesComplementaresFinal
      ? {
        informacoesComplementares:
          informacoesComplementaresFinal,
      }
      : {}),

    emitente: {
      cpfCnpj: sanitizeCpfCnpj(empresa.EMPRESA_CNPJ),
      razaoSocial: empresa.EMPRESA_RAZAO,
      nomeFantasia: empresa.EMPRESA_FANTASIA,
    },

    destinatario,

    total: {
      valorFrete: round2(totalFrete),
    },

    transporte: buildTransporteFromOrder(header, totalFrete),

    itens: itemsComDescontoNfe.map((it, idx) => {
      const fiscal = {
        ...it,
        ...(fiscalBySku[String(it.sku || '').trim()] || {}),
      };

      if (!fiscal.fiscal_classification_id) {
        throw new Error(
          `[NFE] SKU ${it.sku}: vínculo fiscal V2 ativo não encontrado.`,
        );
      }
      if (!fiscal.fiscal_profile_id) {
        throw new Error(
          `[NFE] SKU ${it.sku}: a classificação não possui Perfil Fiscal V2 ativo.`,
        );
      }

      const qtdRaw = Number(
        it.quantity ?? it.qtd ?? it.qtd_comercial ?? it.qtd_venda ?? 0,
      );

      const vUnitRaw = Number(it.unit_price ?? it.preco_unitario ?? 0);
      const vDesc = round2(
        Number(it._descontoRateado ?? it.discount_value ?? it.desconto_valor ?? 0),
      );

      const qtd = round4(qtdRaw);
      const vUnitN = round4(vUnitRaw);
      const vBruto = round2(qtd * vUnitN);
      const vLiq = round2(Math.max(0, vBruto - vDesc));

      const skuKey = String(it.sku || '').trim();

      const rawUnidadeComercial =
        it.unidadeComercial ||
        it.unidade_comercial ||
        it.unit_display ||
        it.unit_lookup ||
        it.unit ||
        it.unit_com ||
        it.unit_name ||
        it.unidade ||
        it.unidade_venda ||
        it.uom ||
        productUnitsBySku[skuKey] ||
        'UN';

      const unidadeComercial = String(rawUnidadeComercial || 'UN')
        .toUpperCase()
        .trim();

      const unidadeTributavel = normalizeNfeUnit(
        it.unidadeTributavel ||
        it.unidade_tributavel ||
        it.unit_trib ||
        it.unidade_trib ||
        unidadeComercial
      );

      console.log('[NFE][ITEM_UNIT_XML]', {
        sku: it.sku,
        rawUnidadeComercial,
        unidadeComercial,
        unidadeTributavel,
        productUnitDb: productUnitsBySku[skuKey],
        rawKeys: Object.keys(it),
      });

      const ncm = onlyDigits(fiscal.ncm || fiscal.ncm_code).slice(0, 8);
      if (ncm.length !== 8) {
        throw new Error(`[NFE] SKU ${it.sku}: NCM V2 ausente ou inválido.`);
      }

      let cest = null;
      const cestSrc = fiscal.cest ?? fiscal.cest_code ?? null;
      if (cestSrc != null && cestSrc !== '') {
        const digits = String(cestSrc).replace(/\D/g, '');
        if (digits && digits.length === 7) {
          cest = digits;
        } else {
          console.warn(
            '[NFE] CEST inválido para SKU',
            it.sku,
            'valor:',
            cestSrc,
            '→ será ignorado (não enviado para a NFe).',
          );
        }
      }

      const operationCfop =
        it.operation_cfop ||
        fiscalOperation.cfop ||
        header.operation_cfop ||
        null;

      const operationForcesCfop = Boolean(
        fiscalOperation.force_cfop ??
        header.operation_forces_cfop ??
        false
      );

      const cfopSaidaRaw =
        (operationForcesCfop ? operationCfop : null) ||
        fiscal.cfop_exit ||
        (Array.isArray(fiscal.cfops_saida) && fiscal.cfops_saida.length
          ? fiscal.cfops_saida[0]
          : null) ||
        operationCfop;

      const cfop = onlyDigits(cfopSaidaRaw).slice(0, 4);
      if (cfop.length !== 4) {
        throw new Error(`[NFE] SKU ${it.sku}: CFOP de saída ausente ou inválido.`);
      }

      const origemVal =
        fiscal.origem_mercadoria ??
        (fiscal.origin_code != null ? Number(fiscal.origin_code) : null) ??
        0;

      const origem = String(origemVal);
      if (!fiscal.icms_cst || !fiscal.pis_cst || !fiscal.cofins_cst) {
        throw new Error(
          `[NFE] SKU ${it.sku}: CST de ICMS, PIS ou COFINS ausente no Perfil Fiscal V2.`,
        );
      }

      const cst = String(fiscal.cst_icms || fiscal.icms_cst);
      const icmsAliq = Number(fiscal.aliquota_icms ?? fiscal.icms_rate ?? 0);
      const vIcms = (vLiq * icmsAliq) / 100;

      const icms = { origem, cst };

      if (cst === '60') {
        if (stockMode.isWithLot && !it.lot_id) {
          throw new Error(
            `[NFE] SKU ${it.sku}: o lote é obrigatório porque ` +
            'o modo de estoque ativo é STOCK_WITH_LOT.',
          );
        }

        const retainedFromItem =
          it.icms_st_retained ||
          it.tax_calculation?.icms_st_retained ||
          null;

        if (retainedFromItem) {
          Object.assign(icms, {
            valor: Number(
              retainedFromItem.vICMSSubstituto ??
              it.vICMSSubstituto ??
              0,
            ),

            substituicaoTributaria: {
              baseCalculo: {
                valor: Number(
                  retainedFromItem.vBCSTRet ??
                  it.vBCSTRet ??
                  0,
                ),
              },

              aliquota: round4(
                retainedFromItem.pST ??
                it.pST ??
                0,
              ),

              valor: Number(
                retainedFromItem.vICMSSTRet ??
                it.vICMSSTRet ??
                0,
              ),

              ufDestino: {
                baseCalculo: {
                  valor: 0,
                },
                valor: 0,
              },
            },
          });

          console.log(
            '[NFE][ICMS-ST ITEM][PRE_RESOLVED]',
            {
              sku: it.sku,
              lote: it.lot_id,
              source:
                it.icms_st_origin?.source_type ??
                it.icms_st_origin?.source ??
                null,
              icms,
            },
          );
        } else {
          const entradaSt = getEntradaStForItem(it);

          if (!entradaSt) {
            throw new Error(
              stockMode.isWithLot
                ? `[NFE] SKU ${it.sku}: dados de ICMS-ST não encontrados para o lote ${it.lot_id}.`
                : `[NFE] SKU ${it.sku}: dados de ICMS-ST não encontrados no histórico fiscal do produto.`,
            );
          }

          const quantidadeEntrada = Number(entradaSt.inbound_quantity);
          const proporcao = qtd / quantidadeEntrada;

          if (
            !Number.isFinite(quantidadeEntrada) ||
            quantidadeEntrada <= 0 ||
            !Number.isFinite(proporcao) ||
            proporcao <= 0
          ) {
            throw new Error(
              `[NFE] SKU ${it.sku}: quantidade de entrada inválida ` +
              (stockMode.isWithLot
                ? `para o lote ${it.lot_id}.`
                : 'no histórico fiscal do produto.'),
            );
          }

          const proporcionalizarDinheiro = (valor) => {
            const centavosEntrada = Math.round(Number(valor || 0) * 100);
            return Math.round(centavosEntrada * proporcao) / 100;
          };

          Object.assign(icms, {
            // vICMSSubstituto
            valor: proporcionalizarDinheiro(
              entradaSt.icms_value,
            ),

            substituicaoTributaria: {
              // vBCSTRet
              baseCalculo: {
                valor: proporcionalizarDinheiro(
                  entradaSt.icms_st_base,
                ),
              },

              // pST
              aliquota: round4(
                entradaSt.icms_st_rate,
              ),

              // vICMSSTRet
              valor: proporcionalizarDinheiro(
                entradaSt.icms_st_value,
              ),

              // Exigido pelo schema atual da PlugNotas para esse objeto
              ufDestino: {
                baseCalculo: {
                  valor: 0,
                },
                valor: 0,
              },
            },
          });

          console.log('[NFE][ICMS-ST ITEM][LEGACY_INBOUND]', {
            sku: it.sku,
            modoEstoque: stockMode.mode,
            lote: stockMode.isWithLot ? it.lot_id : null,
            origemFiscal: stockMode.isWithLot
              ? 'LOTE'
              : 'PRODUCT_CODE',
            quantidadeEntrada,
            quantidadeSaida: qtd,
            proporcao,
            icms,
          });
        }
      } else {
        icms.baseCalculo = {
          modalidadeDeterminacao: 0,
          valor: round2(vLiq),
        };

        icms.aliquota = round4(icmsAliq);
        icms.valor = round2(vIcms);
      }

      const pisCst = String(fiscal.pis_cst);
      const pisAliq = Number(fiscal.pis_aliquota ?? fiscal.pis_rate ?? 0);

      const cofCst = String(fiscal.cofins_cst);
      const cofinsAliq = Number(
        fiscal.cofins_aliquota ?? fiscal.cofins_rate ?? 0,
      );

      const isNT = (c) =>
        ['04', '05', '06', '07', '08', '09', '99'].includes(String(c));

      const pis = isNT(pisCst)
        ? { cst: pisCst }
        : {
          cst: pisCst,
          baseCalculo: { valor: round2(vLiq) },
          aliquota: round4(pisAliq),
          valor: round2((vLiq * pisAliq) / 100),
        };

      const cofins = isNT(cofCst)
        ? { cst: cofCst }
        : {
          cst: cofCst,
          baseCalculo: { valor: round2(vLiq) },
          aliquota: round4(cofinsAliq),
          valor: round2((vLiq * cofinsAliq) / 100),
        };

      const ipiCst = fiscal.ipi_cst || null;
      const ipiAliq = Number(fiscal.ipi_aliquota || 0);

      let ipi;
      if (ipiCst) {
        ipi = { cst: ipiCst };
        if (ipiAliq > 0 && vLiq > 0) {
          ipi.baseCalculo = { valor: round2(vLiq) };
          ipi.aliquota = round4(ipiAliq);
          ipi.valor = round2((vLiq * ipiAliq) / 100);
        }
      }

      const tributos = {
        icms,
        pis,
        cofins,
        ...(ipi ? { ipi } : {}),
        ...buildReformaTributariaFromFiscal(fiscal, vLiq, qtd),
      };

      const freightItem = idx === 0 ? round2(totalFrete) : 0;

      const itemJson = {
        codigo: it.sku,
        descricao: it.description || it.descricao || '',
        ncm,
        ...(cest ? { cest } : {}),
        cfop,

        unidade: {
          comercial: unidadeComercial,
          tributavel: unidadeTributavel,
        },

        quantidade: {
          comercial: qtd,
          tributavel: qtd,
        },

        valorUnitario: {
          comercial: vUnitN,
          tributavel: vUnitN,
        },

        valor: vBruto,
        valorTotal: vLiq,
        compoeTotal: true,
        ...(vDesc > 0 ? { valorDesconto: vDesc } : {}),
        ...(freightItem > 0 ? { valorFrete: freightItem } : {}),

        tributos,
      };

      if (NFE_DEBUG) {
        const calcProd = round2(qtd * vUnitN);
        const diff = round2(vBruto - calcProd);

        console.log(
          '──────────────────────── ITEM NFE DEBUG (nItem:',
          idx + 1,
          ') ────────────────────────',
        );
        console.log('SKU..............:', itemJson.codigo);
        console.log('Descrição........:', itemJson.descricao);
        console.log('qCom / qtd.......:', qtd);
        console.log('vUnCom...........:', vUnitN);
        console.log('vProd (valor)....:', vBruto);
        console.log('qCom * vUnCom....:', calcProd);
        console.log('Diferença........:', diff);
        console.log('Desconto linha...:', vDesc);
        console.log(
          'ICMS aliq/valor..:',
          icmsAliq,
          '→',
          icms?.valor ?? '(sem icms.valor)',
        );
        console.log(
          'PIS  aliq/valor..:',
          pisAliq,
          '→',
          pis?.valor ?? '(sem pis.valor)',
        );
        console.log(
          'COFINS aliq/valor:',
          cofinsAliq,
          '→',
          cofins?.valor ?? '(sem cofins.valor)',
        );
        if (ipi) {
          console.log(
            'IPI  aliq/valor..:',
            ipiAliq,
            '→',
            ipi.valor ?? '(sem ipi.valor)',
          );
        }
        console.log(
          '───────────────────────────────────────────────────────────────────────────────',
        );
      }

      return itemJson;
    }),

    ...(pagamentosFinal.length ? { pagamentos: pagamentosFinal } : {}),
    ...(valorTrocoFinal > 0 ? { valorTroco: valorTrocoFinal } : {}),
    ...(cobrancaPayload ? { cobranca: cobrancaPayload } : {}),

    responsavelTecnico: {
      cpfCnpj: sanitizeCpfCnpj(empresa.RESPONSAVEL_CNPJ),
      nome: empresa.RESPONSAVEL_NOME,
      email: empresa.RESPONSAVEL_EMAIL,
      ...(splitPhone(empresa.RESPONSAVEL_TELEFONE)
        ? { telefone: splitPhone(empresa.RESPONSAVEL_TELEFONE) }
        : {}),
    },
  };

  nfe.total = buildReformaTotals(nfe, valorNotaFinal);

  const validacaoFiscal = validarNFeFiscalmente({
    ...nfe,
    _meta: {
      valorFrete: totalFrete,
      valorNotaEsperado: valorNotaFinal,
      generatesReceivable,
    },
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[NFE][VALIDAÇÃO FISCAL]');
  console.log(JSON.stringify(validacaoFiscal.resumo, null, 2));

  if (validacaoFiscal.avisos.length) {
    console.warn('[NFE][VALIDAÇÃO][AVISOS]');
    console.warn(JSON.stringify(validacaoFiscal.avisos, null, 2));
  }

  if (!validacaoFiscal.ok) {
    console.error('[NFE][VALIDAÇÃO][ERROS]');
    console.error(JSON.stringify(validacaoFiscal.erros, null, 2));
    throw new Error(
      `NF-e inválida fiscalmente: ${validacaoFiscal.erros.join(' | ')}`,
    );
  }

  if (NFE_DEBUG) {
    console.log('[NFE][VALIDAÇÃO][LOGS_ITENS]');
    console.log(JSON.stringify(validacaoFiscal.logs, null, 2));
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('[NFE][TOTAL][PAYLOAD_CHECK]', {
    valorNotaFinal,
    total: nfe.total,
    valorFrete: nfe.valorFrete,
    transporte: nfe.transporte,
    pagamentos: nfe.pagamentos,
    valorTroco: nfe.valorTroco,
  });

  return nfe;
}

/* =========================================================================
 * 📤 Emitir NF-e
 * ========================================================================= */
export async function emitirNFe(dadosNFe) {
  refreshApiConfig();

  if (PLUGNOTAS_MOCK) {
    return {
      ok: true,
      mock: true,
      message: 'Modo simulado (PLUGNOTAS_MOCK=1)',
      data: {
        documents: [
          {
            idIntegracao: Array.isArray(dadosNFe)
              ? dadosNFe[0]?.idIntegracao
              : dadosNFe?.idIntegracao,
            id: `mock-${Date.now()}`,
          },
        ],
      },
    };
  }

  async function postNfeWithRetry(payload, retries = 2) {
    let lastErr;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await api.post('/nfe', payload);
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;

        if (status !== 500 || attempt === retries) {
          throw err;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, 1200 * (attempt + 1))
        );
      }
    }

    throw lastErr;
  }

  try {
    const amb = getAmbiente();
    const producaoFlag = amb === 'producao';

    const arr = Array.isArray(dadosNFe) ? dadosNFe : [dadosNFe];
    const payload = arr.map((doc) => {
      const documentoNormalizado = normalizarIbscbsAntesDoEnvio(doc);

      return {
        ...documentoNormalizado,
        config: {
          ...(documentoNormalizado.config || {}),
          producao: producaoFlag,
        },
      };
    });

    console.log(
      '[NFE][IBSCBS ENVIADO]',
      payload.map((doc) =>
        (doc.itens || []).map((item, index) => ({
          item: index + 1,
          cst: item?.tributos?.ibscbs?.cst,
          classificacao: item?.tributos?.ibscbs?.classificacao,
        }))
      )
    );

    console.log('[NFE][PAYLOAD FINAL]', JSON.stringify(payload, null, 2));

    const res = await postNfeWithRetry(payload, 2);

    return { ok: true, status: res.status, data: res.data };
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;

    const plugMessage =
      data?.error?.message ||
      data?.mensagem ||
      data?.message ||
      'Falha na validação do JSON de NFe.';

    const detalhes = Array.isArray(data?.error?.data) ? data.error.data : [];

    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('[PlugNotasNFe.emitirNFe] ERRO HTTP DETALHADO');
    console.error('STATUS:', status);
    console.error('MESSAGE:', err.message);
    if (data) {
      console.error('DATA RAW:\n', JSON.stringify(data, null, 2));
      if (detalhes.length) {
        console.error(
          'VALIDATION ERRORS:\n',
          JSON.stringify(detalhes, null, 2),
        );
      }
    }
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (status === 409) {
      const current = data?.error?.data?.current || {};
      const id = current.id;
      return {
        ok: true,
        existed: true,
        status: 200,
        data: { id, resumo: current },
      };
    }

    return {
      ok: false,
      status: status || 400,
      message: plugMessage,
      detalhes,
      error: {
        message: plugMessage,
        code: data?.code || null,
        context: 'PlugNotasNFe.emitirNFe',
        raw: data || err,
      },
    };
  }
}

/* =========================================================================
 * 🔍 Consultar / XML / PDF
 * ========================================================================= */
export async function consultarNFe(idOuChave) {
  refreshApiConfig();

  try {
    const res = await api.get(
      `/nfe/${encodeURIComponent(idOuChave)}/resumo`,
    );

    return {
      ok: true,
      status: res.status,
      data: res.data,
    };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 500,
      error: err.response?.data || err.message,
    };
  }
}

export async function obterXml(idOuChave) {
  refreshApiConfig();

  try {
    const res = await api.get(
      `/nfe/${encodeURIComponent(idOuChave)}/xml`,
      {
        responseType: 'text',
        headers: {
          Accept: 'application/xml, text/xml, */*',
        },
        transformResponse: [(raw) => raw],
      },
    );

    const xml = typeof res.data === 'string'
      ? res.data
      : String(res.data || '');

    return {
      ok: true,
      status: res.status,
      xml,
      hasNfeNamespace:
        xml.includes('xmlns="http://www.portalfiscal.inf.br/nfe"'),
      hasSignatureNamespace:
        xml.includes('xmlns="http://www.w3.org/2000/09/xmldsig#"'),
    };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 500,
      error: err.response?.data || err.message,
    };
  }
}

export async function obterPdf(idOuChave) {
  refreshApiConfig();
  try {
    const res = await api.get(`/nfe/${encodeURIComponent(idOuChave)}/pdf`, {
      responseType: 'arraybuffer',
    });
    return { ok: true, buffer: res.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status,
      error: err.response?.data || err.message,
    };
  }
}

export function extrairTpAmb(xmlStr = '') {
  const m = String(xmlStr).match(/<tpAmb>(\d)<\/tpAmb>/);
  return m ? m[1] : null;
}

async function persistOrderIssueDate(orderId, issueDateObj) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) return;

  const issueDateISO = formatLocalISODate(issueDateObj);

  await pool.query(
    `
      UPDATE public."orders"
      SET nfe_issue_date = $1,
          nfe_issue_datetime = $2,
          updated_at = NOW()
      WHERE order_id = $3
    `,
    [issueDateISO, issueDateObj, id],
  );
}

/* =========================================================================
 * 📋 Listar NF-e
 * ========================================================================= */
export async function listarNFe({
  page = 1,
  pageSize = 20,
  q = '',
  dateFrom,
  dateTo,
} = {}) {
  refreshApiConfig();

  const cnpj = sanitizeCpfCnpj(process.env.EMPRESA_CNPJ);
  if (!cnpj) {
    return { ok: false, status: 400, error: 'EMPRESA_CNPJ ausente no .env' };
  }

  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const defTo = fmt(today);
  const dFrom = new Date(today);
  dFrom.setDate(dFrom.getDate() - 90);
  const defFrom = fmt(dFrom);

  const dataInicial = dateFrom || defFrom;
  const dataFinal = dateTo || defTo;

  const qTrim = String(q || '').trim();
  const qNorm = qTrim.toLowerCase();

  const digitsOnlyLocal = (v) => String(v || '').replace(/\D+/g, '');
  const safeStr = (v) => (v == null ? '' : String(v));
  const includesNorm = (v) => safeStr(v).toLowerCase().includes(qNorm);

  function matchQ(it) {
    if (!qNorm) return true;

    const idIntegracao = it?.idIntegracao ?? it?.idintegracao ?? it?.id ?? it?._id;
    const chave =
      it?.chaveAcesso ??
      it?.chave_acesso ??
      it?.chave ??
      it?.chaveNfe ??
      it?.chaveNFe ??
      it?.chaveNFE;

    const numero =
      it?.numero ??
      it?.numeroNfe ??
      it?.numeroNF ??
      it?.numNfe ??
      it?.nfeNumero ??
      it?.nfe_number;

    const protocolo =
      it?.protocolo ?? it?.protocoloAutorizacao ?? it?.protocoloSefaz;

    const dest = it?.destinatario || it?.cliente || it?.tomador || it?.dest || {};
    const cliNome =
      dest?.razaoSocial || dest?.nome || it?.clienteNome || it?.razaoSocial;
    const cliDoc =
      dest?.cpfCnpj || dest?.documento || it?.cpfCnpj || it?.cnpjCpf;

    const refPedido =
      it?.referencia?.numeroPedido ??
      it?.referencia?.pedido ??
      it?.numeroPedido ??
      it?.pedido ??
      it?.orderId ??
      it?.order_id;

    const qDigits = digitsOnlyLocal(qTrim);
    const cliDigits = digitsOnlyLocal(cliDoc);
    const chaveDigits = digitsOnlyLocal(chave);

    if (includesNorm(idIntegracao)) return true;
    if (includesNorm(chave)) return true;
    if (includesNorm(numero)) return true;
    if (includesNorm(protocolo)) return true;
    if (includesNorm(cliNome)) return true;
    if (includesNorm(cliDoc)) return true;
    if (includesNorm(refPedido)) return true;

    if (qDigits) {
      if (cliDigits && cliDigits.includes(qDigits)) return true;
      if (chaveDigits && chaveDigits.includes(qDigits)) return true;
      if (digitsOnlyLocal(numero).includes(qDigits)) return true;
      if (digitsOnlyLocal(refPedido).includes(qDigits)) return true;
      if (digitsOnlyLocal(idIntegracao).includes(qDigits)) return true;
    }

    return false;
  }

  const looksLikeIdIntegracao =
    qTrim &&
    (/^\d{6,}$/.test(qTrim) ||
      /^[a-f0-9]{24}$/i.test(qTrim) ||
      /^[A-Za-z0-9\-_]{8,}$/.test(qTrim)) &&
    !/[^\w\-]/.test(qTrim);

  if (looksLikeIdIntegracao) {
    try {
      const resResumo = await api.get(
        `/nfe/${cnpj}/${encodeURIComponent(qTrim)}/resumo`,
      );
      const doc = resResumo.data ? [resResumo.data] : [];
      return {
        ok: true,
        status: resResumo.status,
        data: doc,
        total: doc.length,
        meta: { directIdIntegracao: qTrim },
      };
    } catch (e) {
      const st = e.response?.status;
      if (st && st !== 404) {
        return { ok: false, status: st, error: e.response?.data || e.message };
      }
    }
  }

  try {
    const res = await api.get('/nfe/consulta/periodo', {
      params: {
        cpfCnpj: cnpj,
        dataInicial,
        dataFinal,
        page,
        pageSize,
        pagina: page,
        tamanhoPagina: pageSize,
        perPage: pageSize,
        limit: pageSize,
        offset: (Math.max(1, page) - 1) * Math.max(1, pageSize),
      },
    });

    let itens = Array.isArray(res.data?.itens)
      ? res.data.itens
      : Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.docs)
          ? res.data.docs
          : Array.isArray(res.data?.items)
            ? res.data.items
            : [];

    const apiTotal =
      Number(res.data?.total ?? res.data?.count ?? res.data?.totalRegistros ?? 0) ||
      0;

    if (qNorm) itens = itens.filter(matchQ);

    const total = apiTotal || itens.length;
    const start = (Math.max(1, page) - 1) * Math.max(1, pageSize);
    const end = start + Math.max(1, pageSize);
    const pageItems = itens.slice(start, end);

    return {
      ok: true,
      status: res.status,
      data: pageItems,
      total,
      meta: {
        dateFrom: dataInicial,
        dateTo: dataFinal,
        cnpj,
        paginated: true,
        filtered: !!qNorm,
      },
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || err.message;
    return { ok: false, status, error: data };
  }
}

/* =========================================================================
 * 🔁 Atualização de ORDERS com dados da NF-e
 * ========================================================================= */
function mapResumoToOrderNfeFields(resumo = {}, ambienteFallback = null) {
  const chave =
    resumo.chaveAcesso ??
    resumo.chave_acesso ??
    resumo.chave ??
    resumo.chaveNfe ??
    resumo.chaveNFe ??
    null;

  const numeroRaw =
    resumo.nfe_number ??
    resumo.nfeNumero ??
    resumo.numeroNfe ??
    resumo.numero ??
    null;

  const protocolo =
    resumo.protocolo ??
    resumo.protocoloAutorizacao ??
    resumo.protocoloAutorizacaoUso ??
    resumo.protocoloAutorizacaoNFe ??
    null;

  const statusRaw =
    resumo.situacao ??
    resumo.status ??
    resumo.situacaoNfe ??
    resumo.descricaoSituacao ??
    null;

  const tpAmbRaw = resumo.tpAmb ?? resumo.tipoAmbiente ?? null;

  let ambiente = ambienteFallback || null;
  if (tpAmbRaw != null) {
    const v = String(tpAmbRaw);
    ambiente = v === '1' ? 'PRODUCAO' : 'HOMOLOGACAO';
  }

  let numero = null;
  if (numeroRaw != null && numeroRaw !== '') {
    const n = Number(numeroRaw);
    if (Number.isFinite(n)) numero = n;
  }

  const status = statusRaw ? String(statusRaw).toUpperCase() : null;

  return { chave, numero, protocolo, status, ambiente };
}

async function updateOrderNfeInfo(orderId, resumo = {}, extra = {}) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) {
    console.warn('[NFE] updateOrderNfeInfo chamado com orderId inválido:', orderId);
    return;
  }

  const ambienteFallback = extra.ambiente || null;
  const { chave, numero, protocolo, status, ambiente } =
    mapResumoToOrderNfeFields(resumo, ambienteFallback);

  const plugnotasId = extra.plugnotasId || resumo.id || resumo.idNota || null;
  const xmlUrl = extra.xmlUrl || null;
  const danfeUrl = extra.danfeUrl || null;

  const sets = [];
  const args = [];
  let ai = 1;

  if (status) {
    sets.push(`nfe_status = $${ai++}`);
    args.push(status);
  }
  if (chave) {
    sets.push(`nfe_key = $${ai++}`);
    args.push(chave);
  }
  if (numero != null) {
    sets.push(`nfe_number = $${ai++}`);
    args.push(numero);
  }
  if (protocolo) {
    sets.push(`nfe_protocol = $${ai++}`);
    args.push(protocolo);
  }
  if (ambiente) {
    sets.push(`nfe_environment = $${ai++}`);
    args.push(ambiente);
  }
  if (plugnotasId) {
    sets.push(`nfe_plugnotas_id = $${ai++}`);
    args.push(String(plugnotasId));
  }
  if (xmlUrl) {
    sets.push(`nfe_xml_url = $${ai++}`);
    args.push(xmlUrl);
  }
  if (danfeUrl) {
    sets.push(`nfe_danfe_url = $${ai++}`);
    args.push(danfeUrl);
  }

  if (!sets.length) {
    console.log('[NFE] updateOrderNfeInfo: nada para atualizar (sem campos válidos).');
    return;
  }

  const sql = `
    UPDATE public."orders"
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE order_id = $${ai}
  `;
  args.push(id);

  try {
    await pool.query(sql, args);
    console.log(
      `[NFE] Pedido ${id} atualizado com info da NF-e (status=${status || 'N/D'
      }, numero=${numero || 'N/D'})`,
    );
  } catch (e) {
    console.error(
      '[NFE] Falha ao atualizar orders com dados da NFe:',
      e.message || e,
    );
  }
}

export async function reconcileOrderNfe(orderId) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: 'orderId inválido' };
  }

  const { rows } = await pool.query(
    `
      SELECT order_id, nfe_plugnotas_id, nfe_key, nfe_environment
      FROM public."orders"
      WHERE order_id = $1
    `,
    [id],
  );

  if (!rows.length) {
    return { ok: false, error: 'PEDIDO_NAO_ENCONTRADO' };
  }

  const row = rows[0];
  const idConsulta = row.nfe_plugnotas_id || row.nfe_key;

  if (!idConsulta) {
    return { ok: false, error: 'SEM_IDENTIFICADOR_NFE' };
  }

  const res = await consultarNFe(idConsulta);
  if (!res.ok) {
    return res;
  }

  const ambiente = row.nfe_environment || null;
  const remote = Array.isArray(res.data) ? res.data[0] : res.data || {};

  await updateOrderNfeInfo(id, remote, {
    plugnotasId: row.nfe_plugnotas_id || null,
    ambiente,
  });

  const statusRemoto =
    remote?.situacao ||
    remote?.status ||
    remote?.statusNfe ||
    remote?.situacaoNfe ||
    '';

  if (toUpperSafe(statusRemoto) === 'AUTORIZADA') {
    try {
      if (typeof stockFromOrdersService.applyStockFromOrder === 'function') {
        const r = await stockFromOrdersService.applyStockFromOrder(id);
        console.log('[NFE] Estoque atualizado para pedido', id, r);
      } else {
        console.warn(
          '[NFE] applyStockFromOrder não encontrado em stockFromOrdersService.js',
        );
      }
    } catch (e) {
      console.error('[NFE] Falha ao ajustar estoque:', e);
    }
  }

  return { ok: true, data: res.data };
}

/* =========================================================================
 * 🔎 Config efetiva
 * ========================================================================= */
export function getEffectiveConfig() {
  refreshApiConfig();

  const key = getApiKey() || '';
  const masked = key
    ? `${key.slice(0, 4)}…${key.slice(-4)}`
    : null;

  const ambienteConfigurado = getAmbiente();

  return {
    baseURL: api.defaults.baseURL,
    ambiente:
      ambienteConfigurado === 'producao'
        ? 'PRODUCAO'
        : 'HOMOLOGACAO',
    producao: ambienteConfigurado === 'producao',
    empresaCnpj: sanitizeCpfCnpj(process.env.EMPRESA_CNPJ),
    hasApiKey: Boolean(key),
    apiKeyMasked: masked,
  };
}

/* =========================================================================
 * 📝 CC-e
 * ========================================================================= */
function normalizeCorrecaoText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function emitirCCe(idOuChave, correcao) {
  refreshApiConfig();

  const id = String(idOuChave || '').trim();
  const texto = normalizeCorrecaoText(correcao);

  if (!id) {
    return {
      ok: false,
      status: 400,
      error: 'Id, chave ou protocolo da NF-e não informado.',
    };
  }

  if (!texto) {
    return {
      ok: false,
      status: 400,
      error: 'Texto da carta de correção não informado.',
    };
  }

  try {
    const res = await api.post(`/nfe/${encodeURIComponent(id)}/cce`, {
      correcao: texto,
    });

    return {
      ok: true,
      status: res.status,
      data: res.data,
    };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 400,
      error: err.response?.data || err.message,
    };
  }
}

export async function consultarStatusCCe(
  idOuChaveOuProtocolo,
  listaCce = false,
) {
  refreshApiConfig();

  try {
    const res = await api.get(
      `/nfe/${encodeURIComponent(idOuChaveOuProtocolo)}/cce/status`,
      {
        params: listaCce ? { listaCce: true } : {},
      },
    );

    return {
      ok: true,
      status: res.status,
      data: res.data,
    };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 400,
      error: err.response?.data || err.message,
    };
  }
}

export async function obterPdfCCe(idOuChave) {
  refreshApiConfig();

  try {
    const res = await api.get(`/nfe/${encodeURIComponent(idOuChave)}/cce/pdf`, {
      responseType: 'arraybuffer',
    });

    return { ok: true, buffer: res.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status,
      error: err.response?.data || err.message,
    };
  }
}

export async function obterXmlCCe(idOuChaveOuProtocolo) {
  refreshApiConfig();

  try {
    const status = await consultarStatusCCe(idOuChaveOuProtocolo, false);

    if (!status.ok) {
      return status;
    }

    const xmlUrl = status?.data?.data?.xml || status?.data?.xml || null;

    if (!xmlUrl) {
      return {
        ok: false,
        status: 404,
        error: 'URL do XML da CC-e não disponível no status retornado.',
      };
    }

    const res = await axios.get(xmlUrl, {
      responseType: 'text',
      headers: {
        'X-API-KEY': getApiKey(),
        'x-api-key': getApiKey(),
      },
      timeout: PLUGNOTAS_TIMEOUT,
    });

    return { ok: true, xml: res.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 400,
      error: err.response?.data || err.message,
    };
  }
}

// ╔════════════════════════════════════════════════════════════╗
// ║ INUTILIZAR NUMERAÇÃO NF-e                                 ║
// ╚════════════════════════════════════════════════════════════╝
export async function inutilizarNumeracao(payload = {}) {
  refreshApiConfig();

  try {
    const body = {
      justificativa: String(payload.justification || '')
        .trim()
        .replace(/^"+|"+$/g, ''),
      ano: Number(payload.year),
      serie: Number(payload.serie),
      numeracao: {
        inicial: Number(payload.numberStart),
        final: Number(payload.numberEnd),
      },
      cpfCnpj: sanitizeCpfCnpj(payload.companyCnpj),
    };

    if (!body.cpfCnpj || body.cpfCnpj.length !== 14) {
      return {
        success: false,
        status: 400,
        error: 'cpfCnpj inválido para inutilização.',
      };
    }

    if (!body.justificativa || body.justificativa.length < 15) {
      return {
        success: false,
        status: 400,
        error: 'Justificativa deve conter ao menos 15 caracteres.',
      };
    }

    if (
      !Number.isFinite(body.serie) ||
      !Number.isFinite(body.numeracao.inicial) ||
      !Number.isFinite(body.numeracao.final) ||
      body.serie < 0 ||
      body.numeracao.inicial <= 0 ||
      body.numeracao.final <= 0 ||
      body.numeracao.final < body.numeracao.inicial
    ) {
      return {
        success: false,
        status: 400,
        error: 'Faixa de inutilização inválida.',
      };
    }

    console.log('[NFE][INUTILIZAR][REQUEST]', JSON.stringify(body, null, 2));

    const response = await api.post('/nfe/inutilizacao', body);

    console.log(
      '[NFE][INUTILIZAR][RESPONSE]',
      JSON.stringify(response.data, null, 2),
    );

    return {
      success: true,
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    const status = error?.response?.status || 500;
    const errorData = error?.response?.data || error.message;

    console.error(
      '[NFE][INUTILIZAR][ERROR]',
      JSON.stringify(errorData, null, 2),
    );

    return {
      success: false,
      status,
      error: errorData,
    };
  }
}

// ╔════════════════════════════════════════════════════════════╗
// ║ CONSULTAR STATUS DA INUTILIZAÇÃO NF-e                     ║
// ╚════════════════════════════════════════════════════════════╝
export async function consultarInutilizacao(idOuProtocolo) {
  return {
    success: true,
    status: 200,
    message: 'Consulta de inutilização não suportada pela API PlugNotas.',
    data: null,
  };
}

export async function emitirNFeSupplierReturn(draft = {}) {
  const supplierReturn = draft.supplier_return || {};
  const items = Array.isArray(draft.items) ? draft.items : [];
  const empresa = getEmpresaConfig();

  if (!supplierReturn.original_nfe_key || String(supplierReturn.original_nfe_key).length !== 44) {
    throw new Error('[NFE DEVOLUÇÃO] Chave da NF-e original inválida.');
  }

  if (!items.length) {
    throw new Error('[NFE DEVOLUÇÃO] Nenhum item informado para devolução.');
  }

  /*
   * IBS/CBS vem da Classificação Fiscal V2 do produto do ERP, igual à
   * emissão de venda. Itens sem produto vinculado não têm essa origem.
   */
  const fiscalBySku = await loadFiscalBySku(
    items.filter((item) => item.product_id).map((item) => item.product_code),
  );

  const itemsWithoutFiscal = items.filter(
    (item) => !fiscalBySku[String(item.product_code || '').trim()],
  );

  if (itemsWithoutFiscal.length) {
    throw new Error(
      '[NFE DEVOLUÇÃO] Itens sem produto do ERP com classificação fiscal V2 ativa: ' +
      itemsWithoutFiscal
        .map((item) => `${item.xml_item_no || '?'} - ${item.product_code || ''} ${item.description || ''}`.trim())
        .join('; ') +
      '. Cadastre o código de barras do item em um produto e reimporte o XML.',
    );
  }

  const numero = await getNextNfeNumberFromBasicTable();

  const roundTax = (v) => round2(Number(v || 0));

  const pick = (...values) => {
    for (const v of values) {
      if (v !== null && v !== undefined && String(v).trim() !== '') return v;
    }
    return '';
  };

  const supplierJson =
    supplierReturn.supplier_json ||
    draft.destinatario?.supplier_json ||
    {};

  const supplierAddress =
    supplierJson.address ||
    draft.destinatario?.address ||
    {};

  const supplierIE = onlyDigits(
    supplierReturn.supplier_ie ||
    supplierReturn.ie ||
    supplierJson.ie ||
    ''
  );

  const supplierCity = pick(
    supplierAddress.city,
    supplierAddress.xMun,
    supplierReturn.supplier_city,
    draft.destinatario?.city,
    'BELO HORIZONTE'
  );

  const supplierUf = pick(
    supplierAddress.uf,
    supplierAddress.UF,
    supplierReturn.supplier_uf,
    draft.destinatario?.uf,
    'MG'
  ).toUpperCase();

  const supplierCep = onlyDigits(
    pick(
      supplierAddress.cep,
      supplierAddress.CEP,
      supplierAddress.postal_code,
      '30170012'
    )
  );

  const supplierCityCode = onlyDigits(
    pick(
      supplierAddress.city_code,
      supplierAddress.cMun,
      supplierAddress.codigoCidade,
      '3106200'
    )
  );

  const totalFrete = round2(
    Number(
      supplierReturn.totals_json?.vFrete ??
      draft.total?.valorFrete ??
      0
    )
  );

  const buildItemTributos = (item = {}) => {
    const snapshot = item.xml_snapshot || {};
    const taxes = item.taxes || item.taxes_json || snapshot.taxes || {};

    const originalQty = Number(
      snapshot.quantity_original ||
      snapshot.quantity_return ||
      item.quantity ||
      0
    );

    const returnQty = Number(item.quantity || 0);

    const ratio =
      originalQty > 0 && returnQty > 0
        ? returnQty / originalQty
        : 1;

    const proportional = (v) => round2(Number(v || 0) * ratio);

    const icms = taxes.icms || {};
    const pis = taxes.pis || {};
    const cofins = taxes.cofins || {};
    const ipi = taxes.ipi || {};

    const cstIcms = String(
      item.cst_icms ||
      icms.CST ||
      icms.cst ||
      icms.CSOSN ||
      '00'
    );

    const cstExigeCest = [
      '10',
      '30',
      '60',
      '70',
    ].includes(cstIcms);

    const cest = onlyDigits(item.cest || snapshot.cest || '');

    if (cstExigeCest && cest.length !== 7) {
      throw new Error(
        `[NFE DEVOLUÇÃO] Produto ${item.product_code || item.xml_item_no}: ` +
        `CEST obrigatório para o CST ${cstIcms}.`
      );
    }

    const cstPis = String(
      item.cst_pis ||
      pis.CST ||
      pis.cst ||
      '49'
    );

    const cstCofins = String(
      item.cst_cofins ||
      cofins.CST ||
      cofins.cst ||
      '49'
    );

    const tributos = {
      icms: {
        origem: String(icms.orig || icms.origem || '0'),
        cst: cstIcms,
        baseCalculo: {
          modalidadeDeterminacao: Number(icms.modBC || icms.modalidadeDeterminacao || 0),
          valor: proportional(icms.vBC ?? icms.baseCalculo?.valor ?? 0),
          ...(cstIcms === '20'
            ? {
              percentualReducao: roundTax(
                icms.pRedBC ??
                icms.baseCalculo?.percentualReducao ??
                0
              ),
            }
            : {}),
        },
        aliquota: roundTax(icms.pICMS ?? icms.aliquota ?? 0),
        valor: proportional(icms.vICMS ?? icms.valor ?? 0),
      },

      pis: {
        cst: cstPis,
        baseCalculo: {
          valor: proportional(pis.vBC ?? pis.baseCalculo?.valor ?? 0),
        },
        aliquota: roundTax(pis.pPIS ?? pis.aliquota ?? 0),
        valor: proportional(pis.vPIS ?? pis.valor ?? 0),
      },

      cofins: {
        cst: cstCofins,
        baseCalculo: {
          valor: proportional(cofins.vBC ?? cofins.baseCalculo?.valor ?? 0),
        },
        aliquota: roundTax(cofins.pCOFINS ?? cofins.aliquota ?? 0),
        valor: proportional(cofins.vCOFINS ?? cofins.valor ?? 0),
      },

      ...buildReformaTributariaFromFiscal(
        fiscalBySku[String(item.product_code || '').trim()],
        round2(item.total_value || returnQty * Number(item.unit_value || 0)),
        returnQty,
      ),
    };

    /*
     * O grupo IPI do XML do fornecedor não é repassado: a BH3 não é
     * contribuinte de IPI e a PlugNotas responde HTTP 500 quando ele é
     * enviado (testado em homologação em 24/09/2026). O IPI destacado
     * na compra, quando devolvido, pertence a impostoDevol/vIPIDevol.
     */
    return tributos;
  };

  const nfe = {
    idIntegracao: `SUPRET-${supplierReturn.return_id}-${Date.now()}`,
    numero,
    presencial: '1',
    serie: Number(process.env.NFE_SERIE || 1),

    natureza: 'DEVOLUCAO DE COMPRA',
    finalidade: '4',
    saida: true,
    // Fornecedor com IE é contribuinte, não consumidor final.
    consumidorFinal: !supplierIE,
    // Local de consumo do IBS/CBS = município do destinatário, como na venda.
    codigoMunicipioFatoGeradorIbs: supplierCityCode,

    documentosReferenciados: [
      {
        modelo: '55',
        chave: supplierReturn.original_nfe_key,
      },
    ],

    emitente: {
      cpfCnpj: sanitizeCpfCnpj(empresa.EMPRESA_CNPJ),
      razaoSocial: empresa.EMPRESA_RAZAO,
      nomeFantasia: empresa.EMPRESA_FANTASIA,
    },

    destinatario: {
      cpfCnpj: sanitizeCpfCnpj(
        supplierReturn.supplier_document ||
        supplierJson.tax_id
      ),

      razaoSocial: String(
        supplierJson.legal_name ||
        supplierReturn.supplier_legal_name ||
        supplierReturn.supplier_name ||
        supplierJson.trade_name ||
        'FORNECEDOR'
      )
        .trim()
        .toUpperCase(),

      indicadorIEDestinatario: supplierIE ? '1' : '9',

      ...(supplierIE ? { inscricaoEstadual: supplierIE } : {}),

      endereco: {
        logradouro: String(
          pick(
            supplierAddress.street,
            supplierAddress.xLgr,
            supplierAddress.logradouro,
            'NAO INFORMADO'
          )
        ).toUpperCase(),

        numero: String(
          pick(
            supplierAddress.number,
            supplierAddress.nro,
            supplierAddress.numero,
            '0'
          )
        ).toUpperCase(),

        ...(pick(supplierAddress.complement, supplierAddress.xCpl)
          ? {
            complemento: String(
              pick(supplierAddress.complement, supplierAddress.xCpl)
            ).toUpperCase(),
          }
          : {}),

        bairro: String(
          pick(
            supplierAddress.district,
            supplierAddress.xBairro,
            supplierAddress.bairro,
            'NAO INFORMADO'
          )
        ).toUpperCase(),

        codigoCidade: supplierCityCode || '3106200',
        descricaoCidade: String(supplierCity || 'BELO HORIZONTE').toUpperCase(),
        estado: supplierUf || 'MG',
        cep: supplierCep || '30170012',
        codigoPais: String(pick(supplierAddress.country_code, supplierAddress.cPais, '1058')),
        descricaoPais: String(pick(supplierAddress.country, supplierAddress.xPais, 'Brasil')),
      },
    },

    transporte: {
      modalidadeFrete: String(
        supplierReturn.transport_json?.freight_mode ||
        draft.transport?.freight_mode ||
        '9'
      ),
    },

    total: {
      valorFrete: totalFrete,
    },

    pagamentos: [
      {
        aVista: true,
        meio: '90',
        valor: 0,
      },
    ],

    informacoesComplementares: [
      `NF-e de devolução referente à chave ${supplierReturn.original_nfe_key}.`,
      supplierReturn.return_reason ? `Motivo: ${supplierReturn.return_reason}` : '',
    ].filter(Boolean).join(' '),

    itens: items.map((item, index) => {
      const snapshot = item.xml_snapshot || {};

      const qtd = round4(item.quantity || 0);
      const vUnit = round4(item.unit_value || snapshot.unit_value || 0);
      const vProd = round2(item.total_value || qtd * vUnit);

      const originalQty = Number(
        snapshot.quantity_original ||
        snapshot.quantity_return ||
        qtd ||
        0
      );

      const originalTribQty = Number(
        snapshot.quantity_trib ||
        snapshot.quantity_original ||
        originalQty ||
        0
      );

      const ratio =
        originalQty > 0 && qtd > 0
          ? qtd / originalQty
          : 1;

      const qtdTrib = round4(originalTribQty * ratio);

      const unitCom = String(
        item.unit ||
        snapshot.unit ||
        'UN'
      ).toUpperCase();

      const unitTrib = String(
        snapshot.unit_trib ||
        item.unit ||
        unitCom
      ).toUpperCase();

      return {
        codigo: String(item.product_code || item.product_id || index + 1),
        descricao: String(item.description || 'PRODUTO DEVOLVIDO').toUpperCase(),
        ncm: onlyDigits(item.ncm || snapshot.ncm || '').slice(0, 8),
        ...(item.cest || snapshot.cest
          ? { cest: onlyDigits(item.cest || snapshot.cest).slice(0, 10) }
          : {}),

        cfop: String(item.cfop || '5202'),

        // Obrigatório na devolução (rejeição 321): item da NF-e original.
        dfeReferenciado: {
          chaveAcesso: supplierReturn.original_nfe_key,
          numero: Number(item.xml_item_no || index + 1),
        },

        unidade: {
          comercial: unitCom,
          tributavel: unitTrib,
        },

        quantidade: {
          comercial: qtd,
          tributavel: qtdTrib || qtd,
        },

        valorUnitario: {
          comercial: vUnit,
          tributavel: round4(snapshot.unit_value_trib || vUnit),
        },

        valor: vProd,
        valorTotal: vProd,
        compoeTotal: true,

        ...(snapshot.discount_value
          ? { valorDesconto: round2(Number(snapshot.discount_value || 0) * ratio) }
          : {}),

        tributos: buildItemTributos(item),
      };
    }),

    responsavelTecnico: {
      cpfCnpj: sanitizeCpfCnpj(empresa.RESPONSAVEL_CNPJ),
      nome: empresa.RESPONSAVEL_NOME,
      email: empresa.RESPONSAVEL_EMAIL,
      ...(splitPhone(empresa.RESPONSAVEL_TELEFONE)
        ? { telefone: splitPhone(empresa.RESPONSAVEL_TELEFONE) }
        : {}),
    },
  };

  nfe.total = buildReformaTotals(
    nfe,
    nfe.itens.reduce((acc, it) => acc + Number(it.valorTotal || 0), 0) + totalFrete,
  );

  console.log('[NFE DEVOLUÇÃO][SUPPLIER ADDRESS USED]', JSON.stringify(supplierAddress, null, 2));
  console.log('[NFE DEVOLUÇÃO][PAYLOAD]', JSON.stringify(nfe, null, 2));

  const result = await emitirNFe(nfe);

  console.log(
    '[NFE DEVOLUÇÃO][EMITIR NFE RESULT]',
    JSON.stringify(result, null, 2)
  );

  return result;
}

/* =========================================================================
 * 🧾 Emitir NF-e de Uso e Consumo
 * ========================================================================= */
export async function emitirNFeUsoConsumo(
  usoConsumoId,
  options = {}
) {
  const id = Number(usoConsumoId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('[NFE USO E CONSUMO] usoConsumoId inválido.');
  }

  const retry = options.retry === true;
  const requestedNfeNumber = Number(options.nfeNumber);
  const requestedIntegrationId = String(
    options.idIntegracao || ''
  ).trim();

  const empresa = getEmpresaConfig();

  /*
   * Carrega o cabeçalho e verifica se já existe uma NF-e vinculada.
   */
  const headerResult = await pool.query(
    `
      SELECT
        uc.*,
        ii.nfe_number,
        ii.nfe_key,
        ii.nfe_status,
        ii.nfe_protocol
      FROM public."usoConsumo" uc
      LEFT JOIN public."invoicesIssued" ii
        ON ii.invoice_id = uc.invoice_id
      WHERE uc.uso_consumo_id = $1
      LIMIT 1
    `,
    [id]
  );

  const usoConsumo = headerResult.rows[0];

  if (!usoConsumo) {
    throw new Error(
      `[NFE USO E CONSUMO] Registro ${id} não encontrado.`
    );
  }

  if (usoConsumo.invoice_id && !retry) {
    throw new Error(
      `[NFE USO E CONSUMO] Este registro já possui uma NF-e vinculada. ` +
      `NF-e: ${usoConsumo.nfe_number || 'em processamento'}; ` +
      `status: ${usoConsumo.nfe_status || 'PENDENTE'}.`
    );
  }

  if (retry) {
    if (!usoConsumo.invoice_id) {
      throw new Error(
        '[NFE USO E CONSUMO] Não existe NF-e vinculada para reenvio.'
      );
    }

    if (
      String(usoConsumo.nfe_status || '').toUpperCase() !== 'REJEITADA'
    ) {
      throw new Error(
        '[NFE USO E CONSUMO] Somente uma NF-e rejeitada pode ser reenviada.'
      );
    }

    if (
      !Number.isInteger(requestedNfeNumber) ||
      requestedNfeNumber <= 0
    ) {
      throw new Error(
        '[NFE USO E CONSUMO] Número da NF-e inválido para reenvio.'
      );
    }

    if (!requestedIntegrationId) {
      throw new Error(
        '[NFE USO E CONSUMO] Novo idIntegracao é obrigatório para reenvio.'
      );
    }
  }

  if (String(usoConsumo.status || '').toUpperCase() !== 'FINALIZADO') {
    throw new Error(
      '[NFE USO E CONSUMO] Somente registros finalizados podem emitir NF-e.'
    );
  }

  const itemsResult = await pool.query(
    `
      SELECT uci.*
      FROM public."usoConsumoItems" uci
      WHERE uci.uso_consumo_id = $1
      ORDER BY uci.uso_consumo_item_id ASC
    `,
    [id]
  );

  if (!itemsResult.rows.length) {
    throw new Error(
      '[NFE USO E CONSUMO] O registro não possui itens.'
    );
  }

  /*
   * Cadastro fiscal V2: "productsFiscalV2" -> "fiscalClassificationV2"
   * -> "fiscalProfileV2", igual à emissão de venda.
   */
  const fiscalBySku = await loadFiscalBySku(
    itemsResult.rows.map((item) => item.product_code),
  );

  const items = itemsResult.rows.map((item) => ({
    ...item,
    fiscal: fiscalBySku[String(item.product_code || '').trim()] || null,
  }));

  const itemsWithoutFiscal = items.filter((item) => !item.fiscal);

  if (itemsWithoutFiscal.length) {
    throw new Error(
      '[NFE USO E CONSUMO] Produtos sem classificação fiscal V2 ativa: ' +
      itemsWithoutFiscal
        .map((item) => `${item.product_code || '?'} ${item.description || ''}`.trim())
        .join('; ') +
      '.'
    );
  }

  const companyCnpj = sanitizeCpfCnpj(empresa.EMPRESA_CNPJ);
  const companyIe = onlyDigits(process.env.EMPRESA_IE);
  const companyCep = onlyDigits(process.env.EMPRESA_CEP);
  const companyCityCode = onlyDigits(process.env.EMPRESA_CODIGO_IBGE);

  if (!companyCnpj || companyCnpj.length !== 14) {
    throw new Error(
      '[NFE USO E CONSUMO] EMPRESA_CNPJ ausente ou inválido no .env.'
    );
  }

  if (!companyIe) {
    throw new Error(
      '[NFE USO E CONSUMO] EMPRESA_IE não configurada no .env.'
    );
  }

  if (!companyCep || companyCep.length !== 8) {
    throw new Error(
      '[NFE USO E CONSUMO] EMPRESA_CEP ausente ou inválido no .env.'
    );
  }

  if (!companyCityCode || companyCityCode.length !== 7) {
    throw new Error(
      '[NFE USO E CONSUMO] EMPRESA_CODIGO_IBGE inválido no .env.'
    );
  }

  const isPisCofinsSemBase = (cst) =>
    ['04', '05', '06', '07', '08', '09', '49', '99']
      .includes(String(cst || ''));

  const nfeItems = items.map((item, index) => {
    const fiscal = item.fiscal || {};

    const codigo = String(item.product_code || '').trim();
    const descricao = String(item.description || '').trim().toUpperCase();
    const ncm = onlyDigits(item.ncm || fiscal.ncm || fiscal.ncm_code)
      .slice(0, 8);

    const cest = onlyDigits(
      item.cest ||
      fiscal.cest ||
      fiscal.cest_code ||
      fiscal.codigo_cest
    ).slice(0, 7);

    const quantidade = round4(item.quantity);
    const valorUnitario = round4(item.cost_price);
    const valorProduto = round2(quantidade * valorUnitario);

    const unidade = String(item.unit || 'UN')
      .trim()
      .toUpperCase();

    const cfop = onlyDigits(item.cfop || usoConsumo.cfop || '5949');

    const origem = String(
      fiscal.origem_mercadoria ??
      fiscal.origin_code ??
      0
    );

    const cstIcms = String(
      item.cst_icms ||
      fiscal.cst_icms ||
      fiscal.icms_cst ||
      ''
    ).padStart(2, '0');

    const aliquotaIcms = round4(
      fiscal.aliquota_icms ??
      fiscal.icms_rate ??
      0
    );

    const cstPis = String(
      fiscal.pis_cst ||
      fiscal.cst_pis ||
      '49'
    ).padStart(2, '0');

    const aliquotaPis = round4(
      fiscal.pis_aliquota ??
      fiscal.pis_rate ??
      0
    );

    const cstCofins = String(
      fiscal.cofins_cst ||
      fiscal.cst_cofins ||
      '49'
    ).padStart(2, '0');

    const aliquotaCofins = round4(
      fiscal.cofins_aliquota ??
      fiscal.cofins_rate ??
      0
    );

    if (!codigo) {
      throw new Error(
        `[NFE USO E CONSUMO] Item ${index + 1}: código do produto ausente.`
      );
    }

    if (!descricao) {
      throw new Error(
        `[NFE USO E CONSUMO] Item ${index + 1}: descrição ausente.`
      );
    }

    if (ncm.length !== 8) {
      throw new Error(
        `[NFE USO E CONSUMO] Produto ${codigo}: NCM inválido ou ausente.`
      );
    }

    if (cfop.length !== 4) {
      throw new Error(
        `[NFE USO E CONSUMO] Produto ${codigo}: CFOP inválido.`
      );
    }

    if (quantidade <= 0) {
      throw new Error(
        `[NFE USO E CONSUMO] Produto ${codigo}: quantidade inválida.`
      );
    }

    if (valorUnitario < 0) {
      throw new Error(
        `[NFE USO E CONSUMO] Produto ${codigo}: custo inválido.`
      );
    }

    if (!cstIcms) {
      throw new Error(
        `[NFE USO E CONSUMO] Produto ${codigo}: CST do ICMS ausente.`
      );
    }

    if (!Number.isFinite(valorProduto) || valorProduto <= 0) {
      throw new Error(
        `[NFE USO E CONSUMO] Produto ${codigo}: base de cálculo IBS/CBS inválida.`
      );
    }

    const icms = {
      origem,
      cst: cstIcms,
    };

    /*
     * CST 40, 41, 50 e 60 normalmente não recebem cálculo comum
     * de base/aliquota neste formato.
     */
    const icmsSemCalculo = ['40', '41', '50', '60'].includes(cstIcms);

    if (!icmsSemCalculo) {
      icms.baseCalculo = {
        modalidadeDeterminacao: 0,
        valor: valorProduto,
      };

      icms.aliquota = aliquotaIcms;
      icms.valor = round2(valorProduto * aliquotaIcms / 100);
    }

    const pis = isPisCofinsSemBase(cstPis)
      ? {
        cst: cstPis,
      }
      : {
        cst: cstPis,
        baseCalculo: {
          valor: valorProduto,
        },
        aliquota: aliquotaPis,
        valor: round2(valorProduto * aliquotaPis / 100),
      };

    const cofins = isPisCofinsSemBase(cstCofins)
      ? {
        cst: cstCofins,
      }
      : {
        cst: cstCofins,
        baseCalculo: {
          valor: valorProduto,
        },
        aliquota: aliquotaCofins,
        valor: round2(valorProduto * aliquotaCofins / 100),
      };

    return {
      codigo,
      descricao,
      ncm,

      ...(cest
        ? {
          cest,
        }
        : {}),

      cfop,

      unidade: {
        comercial: unidade,
        tributavel: unidade,
      },

      quantidade: {
        comercial: quantidade,
        tributavel: quantidade,
      },

      valorUnitario: {
        comercial: valorUnitario,
        tributavel: valorUnitario,
      },

      valor: valorProduto,

      tributos: {
        icms,
        pis,
        cofins,
        ...buildReformaTributariaFromFiscal(fiscal, valorProduto, quantidade),
      },
    };
  });

  const numero = retry
    ? requestedNfeNumber
    : await getNextNfeNumberFromBasicTable();
  const serie = Number(process.env.NFE_SERIE || 1);

  const totalProdutos = round2(
    nfeItems.reduce(
      (total, item) => total + Number(item.valor || 0),
      0
    )
  );

  const observacao = [
    'RETIRADA DE MERCADORIAS PARA USO E CONSUMO INTERNO.',
    `CONTROLE INTERNO: ${usoConsumo.number || id}.`,
    `DEPARTAMENTO: ${usoConsumo.department || 'NÃO INFORMADO'}.`,
    `RESPONSÁVEL: ${usoConsumo.responsible || 'NÃO INFORMADO'}.`,
    usoConsumo.reason
      ? `MOTIVO: ${String(usoConsumo.reason).trim()}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const nfe = {
    idIntegracao: retry
      ? requestedIntegrationId
      : `USOCONSUMO-${id}`,

    numero,
    serie,

    natureza: 'USO E CONSUMO INTERNO',
    finalidade: '1',
    consumidorFinal: true,
    presencial: '9',
    intermediador: 0,

    codigoMunicipioFatoGeradorIbs: companyCityCode,

    emitente: {
      cpfCnpj: companyCnpj,
      razaoSocial: empresa.EMPRESA_RAZAO,
      nomeFantasia: empresa.EMPRESA_FANTASIA,
    },

    /*
     * Destinatário é a própria BH3.
     */
    destinatario: {
      cpfCnpj: companyCnpj,
      razaoSocial: empresa.EMPRESA_RAZAO,
      nomeFantasia: empresa.EMPRESA_FANTASIA,
      indicadorIEDestinatario: '1',
      inscricaoEstadual: companyIe,

      endereco: {
        logradouro: montarLogradouroNfe(
          process.env.EMPRESA_TIPO_LOGRADOURO,
          process.env.EMPRESA_NOME_LOGRADOURO
        ),
        numero: String(process.env.EMPRESA_NUMERO_LOGRADOURO || 'S/N'),
        bairro: String(process.env.EMPRESA_BAIRRO || '').trim().toUpperCase(),
        codigoCidade: companyCityCode,
        descricaoCidade: String(
          process.env.EMPRESA_MUNICIPIO || ''
        ).trim().toUpperCase(),
        estado: String(process.env.EMPRESA_UF || 'MG')
          .trim()
          .toUpperCase(),
        cep: companyCep,
        codigoPais: '1058',
        descricaoPais: 'BRASIL',
      },
    },

    transporte: {
      modalidadeFrete: '9',
    },

    total: {
      valorFrete: 0,
    },

    pagamentos: [
      {
        aVista: true,
        meio: '90',
        valor: 0,
      },
    ],

    informacoesComplementares: observacao,

    itens: nfeItems,

    responsavelTecnico: {
      cpfCnpj: sanitizeCpfCnpj(empresa.RESPONSAVEL_CNPJ),
      nome: empresa.RESPONSAVEL_NOME,
      email: empresa.RESPONSAVEL_EMAIL,

      ...(splitPhone(empresa.RESPONSAVEL_TELEFONE)
        ? {
          telefone: splitPhone(
            empresa.RESPONSAVEL_TELEFONE
          ),
        }
        : {}),
    },
  };

  nfe.total = buildReformaTotals(nfe, totalProdutos);

  console.log('[NFE USO E CONSUMO][PAYLOAD]', {
    uso_consumo_id: id,
    retry,
    idIntegracao: nfe.idIntegracao,
    numero,
    serie,
    totalProdutos,
    quantidadeItens: nfeItems.length,
    ambiente: getAmbiente(),
  });

  if (NFE_DEBUG) {
    console.log(
      '[NFE USO E CONSUMO][PAYLOAD COMPLETO]',
      JSON.stringify(nfe, null, 2)
    );
  }

  const result = await emitirNFe(nfe);

  if (!result?.ok) {
    throw new Error(
      result?.message ||
      result?.error?.message ||
      '[NFE USO E CONSUMO] A PlugNotas recusou a emissão.'
    );
  }

  const responseData = result.data || {};

  const document =
    responseData.documents?.[0] ||
    responseData.documentos?.[0] ||
    responseData.data?.documents?.[0] ||
    responseData.data?.documentos?.[0] ||
    responseData;

  const plugnotasId =
    document?.id ||
    document?.idDocumento ||
    responseData?.id ||
    null;

  if (!plugnotasId && !result.mock) {
    console.warn(
      '[NFE USO E CONSUMO] Emissão aceita, mas o ID da PlugNotas não foi localizado.',
      JSON.stringify(responseData)
    );
  }

  return {
    ok: true,
    uso_consumo_id: id,
    retry,
    id_integracao: nfe.idIntegracao,
    nfe_number: numero,
    nfe_series: serie,
    nfe_environment: getAmbiente(),
    plugnotas_id: plugnotasId,
    total_amount: totalProdutos,
    provider_response: responseData,
  };
}

/* =========================================================================
 * 📦 Export default
 * ========================================================================= */
const tecnospeedNfeApi = {
  buildNFeFromOrder,
  emitirNFe,
  emitirNFeUsoConsumo,
  consultarNFe,
  cancelarNFe,
  listarNFe,
  obterXml,
  obterPdf,
  extrairTpAmb,
  getEffectiveConfig,
  reconcileOrderNfe,
  emitirCCe,
  consultarStatusCCe,
  obterPdfCCe,
  obterXmlCCe,
  inutilizarNumeracao,
  consultarInutilizacao,
  emitirNFeSupplierReturn,
};

export default tecnospeedNfeApi;
