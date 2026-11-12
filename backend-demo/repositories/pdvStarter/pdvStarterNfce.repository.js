// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarterNfce.repository.js — NFC-e (modelo 65) das vendas do PDV  ║
// ║ ✔ Emite pela api-consart-fiscal (POST /v1/nfce)                     ║
// ║ ✔ Dados fiscais do produto: productsFiscalV2 → fiscalClassificationV2║
// ║   → fiscalProfileV2 (os mesmos da NF-e)                              ║
// ║ ✔ Nunca emite duas vezes a mesma venda: trava por venda e busca na   ║
// ║   API pelo externalId antes de reenviar uma tentativa sem resposta   ║
// ╚════════════════════════════════════════════════════════════════════╝

import bwipjs from 'bwip-js';
import pool from '../../config/db.js';
import { TB_SALES, TB_SALES_ITEMS } from './pdvStarter.constants.js';
import { toMoney, pdvError } from './pdvStarter.utils.js';
import {
  request as apiRequest,
  errorMessageFrom,
  getIssuerCnpj,
  getBaseUrl,
  toErpEnvironment,
} from '../nfeApi/nfeApiClient.repository.js';

/* =========================================================================
 * 🔧 Configuração
 * ========================================================================= */

/** NFC-e ligada quando a NF-e API própria está configurada (desligue com PDV_NFCE=off). */
export function isNfceEnabled() {
  const flag = String(process.env.PDV_NFCE || '').trim().toLowerCase();
  if (['off', 'false', '0', 'nao', 'não'].includes(flag)) return false;
  return Boolean(String(process.env.NFE_API_KEY || '').trim());
}

const PAYMENT_TPAG = { DINHEIRO: '01', CREDITO: '03', DEBITO: '04', PIX: '17', OUTROS: '99' };

const STATUS = {
  authorized: 'AUTORIZADA',
  rejected: 'REJEITADA',
  denied: 'DENEGADA',
  cancelled: 'CANCELADA',
  processing: 'PROCESSANDO',
  unknown: 'PROCESSANDO',
  signed: 'PROCESSANDO',
};

const externalIdOf = (sale) => `PDV-${sale.pdv_uuid}`;
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const round4 = (v) => Math.round(Number(v || 0) * 10000) / 10000;

/* =========================================================================
 * 🔎 Dados fiscais
 * ========================================================================= */

async function loadFiscalByProductCode(codes) {
  const { rows } = await pool.query(
    `SELECT TRIM(p.product_code) AS product_code,
            pf.products_fiscal_id,
            fc.ncm_code, fc.cest_code,
            fp.icms_cst, fp.icms_rate, fp.cfop_exit, fp.origin_code,
            fp.pis_cst, fp.pis_rate, fp.cofins_cst, fp.cofins_rate
       FROM public.products p
       LEFT JOIN public."productsFiscalV2" pf
         ON pf.product_code = p.product_code AND pf.is_current = TRUE AND pf.is_active = TRUE
       LEFT JOIN public."fiscalClassificationV2" fc
         ON fc.fiscal_classification_id = pf.fiscal_classification_id AND fc.is_active = TRUE
       LEFT JOIN public."fiscalProfileV2" fp
         ON fp.fiscal_profile_id = fc.fiscal_profile_id AND fp.is_active = TRUE
      WHERE TRIM(p.product_code) = ANY($1::text[])`,
    [codes],
  );
  return Object.fromEntries(rows.map((r) => [r.product_code, r]));
}

/** ICMS-ST retido na última entrada do produto (CST 60). Opcional na NFC-e. */
async function loadRetainedStByProductCode(codes) {
  if (!codes.length) return {};
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (TRIM(product_code))
              TRIM(product_code) AS product_code,
              quantity AS inbound_quantity,
              icms AS icms_value,
              icms_st_base, icms_st_rate, icms_st_value
         FROM public."inboundInvoiceItems"
        WHERE TRIM(product_code) = ANY($1::text[])
          AND quantity > 0
          AND icms_st_base IS NOT NULL AND icms_st_rate IS NOT NULL AND icms_st_value IS NOT NULL
        ORDER BY TRIM(product_code), inbound_item_id DESC`,
      [codes],
    );
    return Object.fromEntries(rows.map((r) => [r.product_code, r]));
  } catch (error) {
    console.warn('[pdvStarterNfce] ICMS-ST de entrada indisponível:', error.message);
    return {};
  }
}

/* =========================================================================
 * 🧾 Montagem do corpo do POST /v1/nfce
 * ========================================================================= */

/** Desconto da venda (fora dos itens) rateado pelos itens, sem perder centavos. */
function itemDiscounts(sale, items) {
  const own = items.map((it) => toMoney(it.discount));
  const saleLevel = toMoney(Number(sale.discount || 0) - own.reduce((s, v) => s + v, 0));
  if (saleLevel <= 0) return own;
  const net = items.map((it, i) => toMoney(Number(it.quantity) * Number(it.unit_price) - own[i]));
  const base = net.reduce((s, v) => s + v, 0);
  let left = saleLevel;
  return own.map((d, i) => {
    const share = i === items.length - 1 ? left : toMoney(base > 0 ? (saleLevel * net[i]) / base : 0);
    left = toMoney(left - share);
    return toMoney(d + share);
  });
}

function buildIcms(fiscal, item, netValue, retained) {
  const code = String(fiscal.icms_cst ?? '').trim();
  const icms = code.length === 3 ? { csosn: code } : { cst: code.padStart(2, '0') };

  if (['00', '20'].includes(icms.cst)) {
    icms.rate = round4(fiscal.icms_rate);
    icms.baseValue = toMoney(netValue);
  }

  if (icms.cst === '60' && retained) {
    const soldUnits = Number(item.quantity) * (Number(item.unit_factor) || 1);
    const ratio = soldUnits / Number(retained.inbound_quantity);
    if (Number.isFinite(ratio) && ratio > 0) {
      const part = (v) => Math.round(Math.round(Number(v || 0) * 100) * ratio) / 100;
      icms.retained = {
        baseValue: part(retained.icms_st_base),
        rate: round4(retained.icms_st_rate),
        substituteValue: part(retained.icms_value),
        value: part(retained.icms_st_value),
      };
    }
  }
  return icms;
}

function buildPisCofins(cst, rate, netValue) {
  const code = String(cst).padStart(2, '0');
  if (['04', '05', '06', '07', '08', '09', '99'].includes(code)) return { cst: code };
  return { cst: code, rate: round4(rate), baseValue: toMoney(netValue) };
}

export async function buildNfcePayload(sale, items) {
  const codes = [...new Set(items.map((it) => String(it.product_code).trim()))];
  const fiscalMap = await loadFiscalByProductCode(codes);
  const stMap = await loadRetainedStByProductCode(codes);

  const missing = [];
  const discounts = itemDiscounts(sale, items);

  const apiItems = items.map((it, i) => {
    const code = String(it.product_code).trim();
    const fiscal = fiscalMap[code];
    const ncm = digits(fiscal?.ncm_code);
    let cfop = digits(fiscal?.cfop_exit).slice(0, 4);
    if (cfop.startsWith('6')) cfop = `5${cfop.slice(1)}`; // NFC-e é sempre operação interna

    if (!fiscal?.products_fiscal_id || ncm.length !== 8 || cfop.length !== 4 || !fiscal.icms_cst || !fiscal.pis_cst || !fiscal.cofins_cst) {
      missing.push(code);
      return null;
    }

    const quantity = Number(it.quantity);
    const unitPrice = Number(it.unit_price);
    const discount = discounts[i];
    const netValue = toMoney(quantity * unitPrice - discount);
    const ean = digits(it.barcode);
    const cest = digits(fiscal.cest_code);

    return {
      code,
      ...([8, 12, 13, 14].includes(ean.length) ? { ean } : {}),
      description: String(it.description || code).replace(/\s+/g, ' ').trim().slice(0, 120),
      ncm,
      ...(cest.length === 7 ? { cest } : {}),
      cfop,
      unit: String(it.unit || 'UN').slice(0, 6),
      quantity,
      unitPrice,
      ...(discount > 0 ? { discount } : {}),
      origin: Number(fiscal.origin_code ?? 0) || 0,
      icms: buildIcms(fiscal, it, netValue, stMap[code]),
      pis: buildPisCofins(fiscal.pis_cst, fiscal.pis_rate, netValue),
      cofins: buildPisCofins(fiscal.cofins_cst, fiscal.cofins_rate, netValue),
    };
  });

  if (missing.length) {
    throw pdvError(
      `Produto(s) sem dados fiscais completos (NCM, CFOP de saída e CST no Perfil Fiscal V2): ${missing.join(', ')}.`,
      'NFCE_FISCAL_DATA_MISSING',
      422,
      { products: missing },
    );
  }

  const payments = (Array.isArray(sale.payments) ? sale.payments : []).map((p) => ({
    method: PAYMENT_TPAG[p.method] || '99',
    amount: toMoney(p.amount),
    ...(PAYMENT_TPAG[p.method] ? {} : { description: 'Outros' }),
  }));

  const doc = digits(sale.customer_doc);
  const name = String(sale.customer_name || '').trim();
  const customer = doc.length === 11 || doc.length === 14
    ? {
        ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }),
        ...(name && !/^CONSUMIDOR FINAL$/i.test(name) && name.length >= 2 ? { name: name.slice(0, 60) } : {}),
      }
    : undefined;

  return {
    issuerCnpj: getIssuerCnpj(),
    externalId: externalIdOf(sale),
    operationNature: 'VENDA AO CONSUMIDOR',
    presence: 1,
    ...(customer ? { customer } : {}),
    items: apiItems,
    payments,
    ...(Number(sale.troco) > 0 ? { change: toMoney(sale.troco) } : {}),
  };
}

/* =========================================================================
 * 📡 Emissão e consulta
 * ========================================================================= */

function extractTag(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].trim() : null;
}

function qrSvg(text) {
  if (!text) return null;
  try {
    return bwipjs.toSVG({ bcid: 'qrcode', text, eclevel: 'M', scale: 2 });
  } catch (error) {
    console.warn('[pdvStarterNfce] Falha ao gerar o QR Code:', error.message);
    return null;
  }
}

/** QR Code e URL de consulta ficam no XML (infNFeSupl). */
async function fetchQrData(accessKey) {
  const res = await apiRequest('GET', `/v1/nfce/${accessKey}/xml`, { responseType: 'text' });
  if (res.status !== 200) return { qrCode: null, urlChave: null };
  return { qrCode: extractTag(res.data, 'qrCode'), urlChave: extractTag(res.data, 'urlChave') };
}

async function saveResult(saleId, record, extra = {}) {
  const status = STATUS[record.status] ?? String(record.status || 'PROCESSANDO').toUpperCase();
  const message = record.statusCode ? `${record.statusCode} - ${record.statusReason}` : (record.lastError ?? null);
  const urls = ['authorized', 'cancelled'].includes(record.status)
    ? { xml: `${getBaseUrl()}/v1/nfce/${record.accessKey}/xml`, pdf: `${getBaseUrl()}/v1/nfce/${record.accessKey}/pdf` }
    : { xml: null, pdf: null };

  const { rows } = await pool.query(
    `UPDATE ${TB_SALES}
        SET nfce_status = $2, nfce_id = $3, nfce_key = $3, nfce_number = $4, nfce_series = $5,
            nfce_protocol = $6, nfce_message = $7, nfce_environment = $8, nfce_issued_at = $9,
            nfce_authorized_at = $10, nfce_xml_url = $11, nfce_pdf_url = $12,
            nfce_qrcode = COALESCE($13, nfce_qrcode), nfce_url_chave = COALESCE($14, nfce_url_chave)
      WHERE sale_id = $1
      RETURNING *`,
    [
      saleId, status, record.accessKey ?? null, record.number != null ? String(record.number) : null,
      record.series != null ? String(record.series) : null, record.protocolNumber ?? null, message,
      record.environment ? toErpEnvironment(record.environment) : null, record.issuedAt ?? null,
      record.authorizedAt ?? null, urls.xml, urls.pdf, extra.qrCode ?? null, extra.urlChave ?? null,
    ],
  );
  return rows[0];
}

async function saveError(saleId, status, message) {
  const { rows } = await pool.query(
    `UPDATE ${TB_SALES} SET nfce_status = $2, nfce_message = $3 WHERE sale_id = $1 RETURNING *`,
    [saleId, status, String(message || '').slice(0, 1000)],
  );
  return rows[0];
}

/** Registro já existente na API para esta venda (tentativa anterior sem resposta). */
async function findPreviousRecord(sale) {
  const res = await apiRequest(
    'GET',
    `/v1/companies/${getIssuerCnpj()}/invoices?document=nfce&search=${encodeURIComponent(externalIdOf(sale))}&limit=5`,
  );
  if (res.status !== 200) return null;
  return (res.data?.invoices ?? []).find((r) => r.externalId === externalIdOf(sale)) ?? null;
}

async function applyRecord(sale, record) {
  const extra = record.status === 'authorized' ? await fetchQrData(record.accessKey) : {};
  return saveResult(sale.sale_id, record, extra);
}

async function emitLocked(sale) {
  if (sale.nfce_status === 'AUTORIZADA' || sale.nfce_status === 'CANCELADA') return sale;

  await pool.query(`UPDATE ${TB_SALES} SET nfce_attempts = COALESCE(nfce_attempts, 0) + 1 WHERE sale_id = $1`, [sale.sale_id]);

  // Já tem chave e o resultado ficou em aberto: consulta na SEFAZ em vez de emitir de novo
  if (sale.nfce_key && sale.nfce_status === 'PROCESSANDO') {
    const res = await apiRequest('POST', `/v1/nfce/${sale.nfce_key}/sync`);
    if (res.status === 200 && res.data?.accessKey) return applyRecord(sale, res.data);
    return saveError(sale.sale_id, 'PROCESSANDO', errorMessageFrom(res));
  }

  // Tentativa anterior sem resposta: a API pode ter registrado a nota
  if (Number(sale.nfce_attempts) > 0) {
    const previous = await findPreviousRecord(sale);
    if (previous && previous.status !== 'rejected') {
      if (['unknown', 'processing', 'signed'].includes(previous.status)) {
        const res = await apiRequest('POST', `/v1/nfce/${previous.accessKey}/sync`);
        return applyRecord(sale, res.status === 200 && res.data?.accessKey ? res.data : previous);
      }
      return applyRecord(sale, previous);
    }
  }

  const { rows: items } = await pool.query(
    `SELECT * FROM ${TB_SALES_ITEMS} WHERE sale_id = $1 ORDER BY item_number NULLS LAST, product_code`,
    [sale.sale_id],
  );

  let payload;
  try {
    payload = await buildNfcePayload(sale, items);
  } catch (error) {
    if (error.code === 'NFCE_FISCAL_DATA_MISSING' || error.statusCode === 422) return saveError(sale.sale_id, 'ERRO', error.message);
    throw error;
  }

  const res = await apiRequest('POST', '/v1/nfce', { data: payload });
  if (res.data?.accessKey) return applyRecord(sale, res.data);
  // Rede/timeout: a nota pode ter saído; a próxima tentativa procura pelo externalId
  if (res.networkError || res.status >= 500) return saveError(sale.sale_id, 'PENDENTE', errorMessageFrom(res));
  return saveError(sale.sale_id, 'ERRO', errorMessageFrom(res));
}

/**
 * Emite (ou consulta) a NFC-e de uma venda. Uma venda nunca é emitida duas vezes ao mesmo tempo:
 * quem não pega a trava recebe a venda como está.
 */
export async function emitSaleNfce(saleId) {
  const client = await pool.connect();
  try {
    const { rows: lock } = await client.query(
      `SELECT pg_try_advisory_lock(hashtext('pdvSales.nfce'), $1::int) AS ok`,
      [Number(saleId) % 2147483647],
    );
    const { rows } = await client.query(`SELECT * FROM ${TB_SALES} WHERE sale_id = $1`, [saleId]);
    const sale = rows[0];
    if (!sale) throw pdvError('Venda não encontrada.', 'SALE_NOT_FOUND', 404);
    if (!lock[0].ok) return sale;
    try {
      return await emitLocked(sale);
    } catch (error) {
      console.error('[pdvStarterNfce] Erro ao emitir NFC-e da venda', saleId, error);
      return saveError(sale.sale_id, 'PENDENTE', error.message);
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext('pdvSales.nfce'), $1::int)`, [Number(saleId) % 2147483647]);
    }
  } finally {
    client.release();
  }
}

/** Dados da NFC-e que o caixa precisa para imprimir o DANFE NFC-e. */
export function nfceView(sale) {
  if (!sale) return null;
  return {
    status: sale.nfce_status || 'PENDENTE',
    key: sale.nfce_key || null,
    number: sale.nfce_number || null,
    series: sale.nfce_series || null,
    protocol: sale.nfce_protocol || null,
    environment: sale.nfce_environment || null,
    issued_at: sale.nfce_issued_at || null,
    authorized_at: sale.nfce_authorized_at || null,
    message: sale.nfce_message || null,
    url_chave: sale.nfce_url_chave || null,
    qr_code: sale.nfce_qrcode || null,
    qr_svg: sale.nfce_status === 'AUTORIZADA' ? qrSvg(sale.nfce_qrcode) : null,
  };
}

/* =========================================================================
 * 🏢 Emitente (cabeçalho do DANFE NFC-e)
 * ========================================================================= */

let issuerCache = { at: 0, data: null };

export async function getIssuerForReceipt() {
  if (issuerCache.data && Date.now() - issuerCache.at < 10 * 60 * 1000) return issuerCache.data;
  const res = await apiRequest('GET', `/v1/companies/${getIssuerCnpj()}`);
  if (res.status !== 200) return issuerCache.data;
  const c = res.data || {};
  const a = c.address || {};
  issuerCache = {
    at: Date.now(),
    data: {
      name: c.name || null,
      trade_name: c.tradeName || null,
      cnpj: c.cnpj || null,
      ie: c.stateRegistration || null,
      address: [a.street, a.number, a.complement, a.district].filter(Boolean).join(', '),
      city: [a.city, a.state].filter(Boolean).join(' - '),
      environment: toErpEnvironment(c.environment),
      has_csc: Boolean(c.nfce?.hasCsc),
    },
  };
  return issuerCache.data;
}
