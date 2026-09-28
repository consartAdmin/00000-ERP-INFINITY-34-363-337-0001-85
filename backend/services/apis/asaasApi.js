// ╔══════════════════════════════════════════════════════════════════════╗
// ║ asaasApi.js — Integração ASAAS (E-commerce BH3 SUPPLY + ERP)        ║
// ║ CONSART ERP | ESM                                                    ║
// ║ - Garante cliente no Asaas                                           ║
// ║ - Cria cobrança (PIX / BOLETO / etc.)                                ║
// ║ - Consulta cobrança (GET /payments/:id)                              ║
// ║ - Lista cobranças / recebidos / saldo para o painel de gestão        ║
// ║ OBS: NÃO envia fine/interest como número (corrige parse_error)       ║
// ║                                                                      ║
// ║ ✅ ADD (2026-02-23/24):                                               ║
// ║  - Download automático do BOLETO PDF ao criar cobrança BOLETO        ║
// ║  - Salva localmente em /backend/public/boletos                       ║
// ║  - Retorna data.boleto_pdf_url_local                                  ║
// ║  - Retorna data.boleto_pdf_abs_path (para res.download sem fetch)    ║
// ║  - getBoletoPdf(): resolve local → fallback Asaas → salva → retorna  ║
// ║  - Valida PDF por assinatura %PDF                                    ║
// ║  - Base URL validada, anti-HTML response                             ║
// ║  - Resiliência: fallback GET /payments/:id/pdf quando existir         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------------------------------------------------------------------- */
/* Paths (ESM)                                                            */
/* ---------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Este arquivo está em: backend/services/apis/...  -> ../../public = backend/public
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const BOLETOS_DIR = path.resolve(PUBLIC_DIR, 'boletos');

/* ---------------------------------------------------------------------- */
/* FS Helpers                                                             */
/* ---------------------------------------------------------------------- */
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[AsaasAPI] ensureDir falhou:', dir, e?.message || e);
  }
}

function safeFilename(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 180);
}

function sanitizeString(str) {
  if (!str) return undefined;
  const s = String(str).trim();
  return s || undefined;
}

function normalizeNumber(v, fallback = 0) {
  const n = Number(
    typeof v === 'string' ? v.replace(/\./g, '').replace(',', '.') : v
  );
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Converte um valor (percentual) no formato aceito pelo Asaas:
 *  - Se > 0  → { value: n }
 *  - Se <= 0 → undefined (campo NÃO é enviado)
 */
function toPercentField(v) {
  const n = normalizeNumber(v, 0);
  if (n > 0) return { value: n };
  return undefined;
}

function isProbablyHtml(buf, contentType = '') {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html')) return true;

  const head = Buffer.isBuffer(buf) ? buf.slice(0, 80).toString('utf8') : '';
  const h = head.toLowerCase();
  return h.includes('<!doctype html') || h.includes('<html') || h.includes('<head');
}

function logAsaasError(context, error) {
  const status = error?.response?.status;
  const data = error?.response?.data;

  console.error(`❌ [AsaasAPI Error - ${context}] STATUS:`, status || 'N/A');

  // Quando o Asaas (ou URL errada) devolve HTML, isso ajuda a enxergar.
  if (typeof data === 'string') {
    console.error(`❌ [AsaasAPI Error - ${context}] data (string):`, data.slice(0, 1000));
    return;
  }

  const errors = data?.errors;
  if (Array.isArray(errors) && errors.length) {
    console.error(`❌ [AsaasAPI Error - ${context}] errors:`, errors);
  } else if (data) {
    console.error(`❌ [AsaasAPI Error - ${context}] data:`, data);
  } else {
    console.error(`❌ [AsaasAPI Error - ${context}] raw:`, error?.message || error);
  }
}

/* ---------------------------------------------------------------------- */
/* PDF Download Helpers                                                   */
/* ---------------------------------------------------------------------- */
async function tryDownloadPdfBuffer(url, logger = console) {
  if (!url) return null;

  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-store',
      },
    });

    const buf = Buffer.from(resp.data || []);
    const ct = String(resp.headers?.['content-type'] || '').toLowerCase();

    if (isProbablyHtml(buf, ct)) {
      logger.warn?.('[AsaasAPI] URL retornou HTML (provável URL/base inválida).', {
        contentType: ct || null,
        url: String(url).slice(0, 180),
      });
      return null;
    }

    const sig = buf.slice(0, 4).toString(); // %PDF
    const isPdf = sig === '%PDF' || ct.includes('pdf');

    if (!isPdf || buf.length < 800) {
      logger.warn?.('[AsaasAPI] Conteúdo não é PDF válido ao baixar boleto.', {
        contentType: ct || null,
        signature: sig || null,
        size: buf.length || 0,
        url: String(url).slice(0, 180),
      });
      return null;
    }

    return buf;
  } catch (e) {
    logger.warn?.('[AsaasAPI] Falha ao baixar PDF do boleto:', e?.message || e);
    return null;
  }
}

/**
 * Salva o PDF do boleto em /backend/public/boletos e retorna:
 * - urlLocal: "/public/boletos/xxx.pdf"
 * - absPath : ".../backend/public/boletos/xxx.pdf"
 */
function saveBoletoToDisk(pdfBuffer, paymentId, invoiceNumber = null) {
  if (!pdfBuffer || !paymentId) return { urlLocal: null, absPath: null };

  ensureDir(BOLETOS_DIR);

  const base = invoiceNumber
    ? `boleto-${safeFilename(invoiceNumber)}-${safeFilename(paymentId)}.pdf`
    : `boleto-${safeFilename(paymentId)}.pdf`;

  const filename = safeFilename(base);
  const absPath = path.join(BOLETOS_DIR, filename);

  try {
    fs.writeFileSync(absPath, pdfBuffer);
    const urlLocal = `/public/boletos/${filename}`;
    return { urlLocal, absPath };
  } catch (e) {
    console.warn('[AsaasAPI] Falha ao salvar boleto em disco:', e?.message || e);
    return { urlLocal: null, absPath: null };
  }
}

/**
 * Converte uma URL pública "/public/boletos/x.pdf" para path absoluto em disco.
 * Serve para usar res.download(absPath) no controller sem fetch.
 */
export function resolveLocalBoletoPath(publicUrlPath) {
  const p = String(publicUrlPath || '').trim();
  if (!p.startsWith('/public/')) return null;

  // remove /public/ e junta com PUBLIC_DIR (que já é /backend/public)
  const rel = p.replace(/^\/public\//, '');
  const abs = path.join(PUBLIC_DIR, rel);

  return abs;
}

function fileExists(absPath) {
  try {
    if (!absPath) return false;
    return fs.existsSync(absPath);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Configuração Asaas                                                     */
/* ---------------------------------------------------------------------- */
function sanitizeBaseUrl(u) {
  const raw = String(u || '').trim().replace(/\/+$/, '');
  if (!raw) return 'https://api.asaas.com/v3';
  // Normaliza: se vier sem /v3, adiciona
  if (!/\/v3$/i.test(raw)) return `${raw}/v3`;
  return raw;
}

const ASAAS_BASE_URL = sanitizeBaseUrl(process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3');
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

if (!ASAAS_API_KEY) {
  console.warn('[AsaasAPI] ⚠️ ASAAS_API_KEY não definido no .env — verifique as credenciais.');
} else {
  console.log('[AsaasAPI] ✅ ASAAS_API_KEY carregado. Base URL:', ASAAS_BASE_URL);
}

const asaasClient = axios.create({
  baseURL: ASAAS_BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    access_token: ASAAS_API_KEY,
  },
});

/**
 * Fallback interno: algumas contas/ambientes expõem um endpoint de PDF (varia).
 * Tenta:
 *  - GET /payments/:id  -> pega bankSlipPdfUrl/bankSlipUrl/invoiceUrl
 *  - E opcionalmente tenta endpoints conhecidos quando URL não vier.
 */
async function tryFetchBoletoUrlFromPayment(paymentId, logger = console) {
  const payment = await getPayment(paymentId);

  let boletoUrl =
    payment?.bankSlipPdfUrl ||
    payment?.bankSlipUrl ||
    payment?.invoiceUrl ||
    null;

  if (boletoUrl) return { payment, boletoUrl };

  // Fallbacks comuns (nem sempre existem; se 404, ignora)
  const candidates = [
    `/payments/${paymentId}/pdf`,
    `/payments/${paymentId}/bankSlipPdf`,
    `/payments/${paymentId}/bankSlip/pdf`,
  ];

  for (const endpoint of candidates) {
    try {
      const { data } = await asaasClient.get(endpoint, { responseType: 'arraybuffer' });
      const buf = Buffer.from(data || []);
      const sig = buf.slice(0, 4).toString();
      if (sig === '%PDF' && buf.length > 800) {
        // não temos URL, mas temos o PDF direto
        return { payment, boletoUrl: null, directPdf: buf };
      }
    } catch (e) {
      const status = e?.response?.status;
      if (status && status !== 404) {
        logger.warn?.('[AsaasAPI] Fallback endpoint falhou:', endpoint, status);
      }
    }
  }

  return { payment, boletoUrl: null };
}

/* ---------------------------------------------------------------------- */
/* ensureAsaasCustomerForEcommerce                                        */
/* ---------------------------------------------------------------------- */
export async function ensureAsaasCustomerForEcommerce({
  name,
  email,
  cpfCnpj,
  phone,
  mobilePhone,
}) {
  const payload = {
    name: sanitizeString(name),
    email: sanitizeString(email),
    cpfCnpj: sanitizeString(cpfCnpj),
    phone: sanitizeString(phone),
    mobilePhone: sanitizeString(mobilePhone),
  };

  if (!payload.cpfCnpj && !payload.email) {
    throw new Error('[AsaasAPI] É necessário informar ao menos cpfCnpj ou email para criar/ localizar cliente.');
  }

  try {
    // 1) Tenta localizar cliente existente por cpfCnpj ou email
    const searchParams = new URLSearchParams();
    if (payload.cpfCnpj) searchParams.append('cpfCnpj', payload.cpfCnpj);
    if (payload.email) searchParams.append('email', payload.email);

    console.log('[AsaasAPI] 🔍 Buscando cliente no Asaas com:', searchParams.toString());

    const { data: searchData } = await asaasClient.get(`/customers?${searchParams.toString()}`);

    const found = Array.isArray(searchData?.data) ? searchData.data[0] : undefined;

    if (found?.id) {
      console.log('[AsaasAPI] ✅ Cliente encontrado no Asaas:', found.id);
      return found.id;
    }

    // 2) Não encontrou → cria novo cliente
    const createPayload = {
      name: payload.name || 'Cliente Loja Online',
      email: payload.email,
      cpfCnpj: payload.cpfCnpj,
      phone: payload.phone,
      mobilePhone: payload.mobilePhone,
    };

    console.log('[AsaasAPI] ➕ Criando cliente no Asaas...', createPayload);

    const { data: created } = await asaasClient.post('/customers', createPayload);

    if (!created?.id) {
      throw new Error('[AsaasAPI] Falha ao criar cliente no Asaas (sem ID retornado).');
    }

    console.log('[AsaasAPI] ✅ Cliente criado no Asaas:', created.id);
    return created.id;
  } catch (error) {
    logAsaasError('ensureCustomer', error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* createCharge                                                           */
/* ---------------------------------------------------------------------- */
export async function createCharge({
  customerId,
  billingType, // 'PIX', 'BOLETO', 'CREDIT_CARD', etc.
  value,
  description,
  dueDate, // 'YYYY-MM-DD'
  finePercent, // opcional, ex: 2
  interestPercent, // opcional, ex: 1
  externalReference, // recomenda: orderId, orderNumber, etc
}) {
  const payload = {
    customer: customerId,
    billingType,
    value: normalizeNumber(value),
    description: sanitizeString(description),
    dueDate: sanitizeString(dueDate),
    externalReference: sanitizeString(externalReference),
  };

  const fineField = toPercentField(finePercent);
  const interestField = toPercentField(interestPercent);

  if (fineField) payload.fine = fineField;
  if (interestField) payload.interest = interestField;

  console.log('[AsaasAPI] 💸 Criando cobrança no Asaas...', payload);

  try {
    const { data } = await asaasClient.post('/payments', payload);
    console.log('[AsaasAPI] ✅ Cobrança criada no Asaas:', data?.id);

    let boleto_pdf_url_local = null;
    let boleto_pdf_abs_path = null;

    // ✅ BOLETO: tenta baixar e salvar o PDF já aqui
    if (String(billingType || '').toUpperCase() === 'BOLETO' && data?.id) {
      const boletoUrl =
        data?.bankSlipPdfUrl ||
        data?.bankSlipUrl ||
        data?.invoiceUrl ||
        null;

      if (boletoUrl) {
        const pdf = await tryDownloadPdfBuffer(boletoUrl, console);

        if (pdf) {
          const saved = saveBoletoToDisk(pdf, data.id, data?.invoiceNumber || null);
          boleto_pdf_url_local = saved.urlLocal;
          boleto_pdf_abs_path = saved.absPath;

          if (boleto_pdf_url_local) {
            console.log('[AsaasAPI] 📄 Boleto salvo localmente:', boleto_pdf_url_local);
          }
        } else {
          console.warn('[AsaasAPI] ⚠️ Boleto URL retornou conteúdo não-PDF (não anexável).');
        }
      } else {
        // Mesmo que não venha no retorno do POST, pode vir no GET /payments/:id
        console.warn('[AsaasAPI] ⚠️ Asaas não retornou URL do boleto no createCharge. Tentando GET /payments/:id...');
        const fallback = await getBoletoPdf({
          paymentId: data.id,
          boleto_pdf_url_local: null,
          boleto_pdf_abs_path: null,
          logger: console,
        });

        if (fallback?.ok) {
          boleto_pdf_url_local = fallback.urlLocal;
          boleto_pdf_abs_path = fallback.absPath;
        }
      }
    }

    return {
      ...data,
      boleto_pdf_url_local,
      boleto_pdf_abs_path,
    };
  } catch (error) {
    logAsaasError('createCharge', error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* getPayment                                                             */
/* ---------------------------------------------------------------------- */
export async function getPayment(paymentId) {
  if (!paymentId) throw new Error('[AsaasAPI] getPayment: paymentId inválido.');

  console.log('[AsaasAPI] 🔎 Buscando pagamento no Asaas:', paymentId);

  try {
    const { data } = await asaasClient.get(`/payments/${paymentId}`);
    return data;
  } catch (error) {
    logAsaasError('getPayment', error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* getBoletoPdf                                                            */
/* ---------------------------------------------------------------------- */
/**
 * Resolve boleto PDF pronto para download no backend:
 *   1) Se houver arquivo local (urlLocal ou absPath) e existir -> retorna.
 *   2) Senão, consulta o Asaas (getPayment) e tenta baixar PDF.
 *   3) Se baixar, salva e retorna urlLocal + absPath.
 *
 * Retorno:
 *  { ok, status, error, urlLocal, absPath }
 */
export async function getBoletoPdf({
  paymentId,
  boleto_pdf_url_local = null,
  boleto_pdf_abs_path = null,
  logger = console,
} = {}) {
  if (!paymentId) {
    return {
      ok: false,
      status: 400,
      error: 'paymentId não informado.',
      urlLocal: null,
      absPath: null,
    };
  }

  // 1) Se já veio absPath e existe, retorna
  if (boleto_pdf_abs_path && fileExists(boleto_pdf_abs_path)) {
    return {
      ok: true,
      status: 200,
      urlLocal: boleto_pdf_url_local || null,
      absPath: boleto_pdf_abs_path,
    };
  }

  // 2) Se já veio url local, tenta resolver e verificar
  if (boleto_pdf_url_local) {
    const resolved = resolveLocalBoletoPath(boleto_pdf_url_local);
    if (resolved && fileExists(resolved)) {
      return {
        ok: true,
        status: 200,
        urlLocal: boleto_pdf_url_local,
        absPath: resolved,
      };
    }
  }

  // 3) Fallback: busca no Asaas e tenta baixar
  try {
    const { payment, boletoUrl, directPdf } = await tryFetchBoletoUrlFromPayment(paymentId, logger);

    // 3a) Se fallback retornou PDF direto por endpoint interno
    if (directPdf && Buffer.isBuffer(directPdf)) {
      const saved = saveBoletoToDisk(directPdf, paymentId, payment?.invoiceNumber || null);

      if (!saved?.absPath || !fileExists(saved.absPath)) {
        return {
          ok: false,
          status: 500,
          error: 'Falha ao salvar o PDF do boleto no disco.',
          urlLocal: null,
          absPath: null,
        };
      }

      return {
        ok: true,
        status: 200,
        urlLocal: saved.urlLocal,
        absPath: saved.absPath,
      };
    }

    if (!boletoUrl) {
      return {
        ok: false,
        status: 404,
        error: 'Asaas não retornou URL do boleto para este paymentId.',
        urlLocal: null,
        absPath: null,
      };
    }

    const pdf = await tryDownloadPdfBuffer(boletoUrl, logger);

    if (!pdf) {
      return {
        ok: false,
        status: 502,
        error: 'URL do Asaas retornou conteúdo não-PDF ou inválido.',
        urlLocal: null,
        absPath: null,
      };
    }

    const saved = saveBoletoToDisk(pdf, paymentId, payment?.invoiceNumber || null);

    if (!saved?.absPath || !fileExists(saved.absPath)) {
      return {
        ok: false,
        status: 500,
        error: 'Falha ao salvar o PDF do boleto no disco.',
        urlLocal: null,
        absPath: null,
      };
    }

    return {
      ok: true,
      status: 200,
      urlLocal: saved.urlLocal,
      absPath: saved.absPath,
    };
  } catch (e) {
    logger?.warn?.('[AsaasAPI] getBoletoPdf falhou:', e?.message || e);
    return {
      ok: false,
      status: 500,
      error: e?.message || 'Erro inesperado ao obter boleto.',
      urlLocal: null,
      absPath: null,
    };
  }
}

/* ---------------------------------------------------------------------- */
/* listCharges                                                             */
/* ---------------------------------------------------------------------- */
export async function listCharges({
  tipoData = 'dueDate',
  dataInicio,
  dataFim,
  status,        // ex: 'PENDING', 'RECEIVED', 'OVERDUE', etc
  billingType,   // ex: 'BOLETO', 'PIX'
  limit = 100,
  offset = 0,
  sort = 'dueDate', // orderBy
  order = 'asc',    // 'asc' | 'desc'
  externalReference,
  customer,
} = {}) {
  const params = new URLSearchParams();

  let dateField = 'dueDate';
  if (tipoData === 'paymentDate') dateField = 'paymentDate';
  if (tipoData === 'dateCreated') dateField = 'dateCreated';

  if (dataInicio) params.append(`${dateField}[ge]`, dataInicio);
  if (dataFim) params.append(`${dateField}[le]`, dataFim);

  if (status && status !== 'Todos' && status !== 'ALL') {
    params.append('status', status);
  }
  if (billingType) {
    params.append('billingType', billingType);
  }
  if (externalReference) {
    params.append('externalReference', String(externalReference));
  }
  if (customer) {
    params.append('customer', String(customer));
  }

  params.append('limit', String(limit));
  params.append('offset', String(offset));
  if (sort) params.append('orderBy', sort);
  if (order) params.append('sortDirection', String(order).toUpperCase());

  console.log('[AsaasAPI] 📃 Listando cobranças com filtros:', params.toString());

  try {
    const { data } = await asaasClient.get(`/payments?${params.toString()}`);
    return data;
  } catch (error) {
    logAsaasError('listCharges', error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* listPayments (alias)                                                   */
/* ---------------------------------------------------------------------- */
export async function listPayments(options = {}) {
  return listCharges(options);
}

/* ---------------------------------------------------------------------- */
/* listConfirmedPayments                                                  */
/* ---------------------------------------------------------------------- */
export async function listConfirmedPayments({
  tipoData = 'paymentDate',
  dataInicio,
  dataFim,
  billingType,
  limit = 100,
  offset = 0,
  sort = 'paymentDate',
  order = 'asc',
} = {}) {
  const params = new URLSearchParams();

  let dateField = 'paymentDate';
  if (tipoData === 'dueDate') dateField = 'dueDate';
  if (tipoData === 'dateCreated') dateField = 'dateCreated';

  if (dataInicio) params.append(`${dateField}[ge]`, dataInicio);
  if (dataFim) params.append(`${dateField}[le]`, dataFim);

  params.append('status', 'RECEIVED');

  if (billingType) params.append('billingType', billingType);

  params.append('limit', String(limit));
  params.append('offset', String(offset));
  if (sort) params.append('orderBy', sort);
  if (order) params.append('sortDirection', String(order).toUpperCase());

  console.log('[AsaasAPI] 📃 Listando pagamentos confirmados com filtros:', params.toString());

  try {
    const { data } = await asaasClient.get(`/payments?${params.toString()}`);
    return data;
  } catch (error) {
    logAsaasError('listConfirmedPayments', error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* getCustomer                                                             */
/* ---------------------------------------------------------------------- */
export async function getCustomer(customerId) {
  if (!customerId) throw new Error('[AsaasAPI] getCustomer: customerId não informado.');

  console.log('[AsaasAPI] 👤 Buscando cliente Asaas:', customerId);

  try {
    const { data } = await asaasClient.get(`/customers/${customerId}`);
    return data;
  } catch (error) {
    logAsaasError('getCustomer', error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* getBalance                                                              */
/* ---------------------------------------------------------------------- */
export async function getBalance() {
  console.log('[AsaasAPI] 💰 Buscando saldo da conta Asaas...');
  try {
    const { data } = await asaasClient.get('/finance/balance');
    return data;
  } catch (error) {
    logAsaasError('getBalance', error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* updatePayment — Atualiza vencimento e valor da cobrança                 */
/* PUT /payments/{id}                                                      */
/* ---------------------------------------------------------------------- */

export async function updatePayment(
  paymentId,
  {
    dueDate,
    value,
  } = {}
) {
  const normalizedPaymentId =
    String(paymentId || '').trim();

  const normalizedDueDate =
    String(dueDate || '').trim();

  const normalizedValue =
    Number(value);

  if (!normalizedPaymentId) {
    throw new Error(
      '[AsaasAPI] updatePayment: paymentId não informado.'
    );
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedDueDate
    )
  ) {
    throw new Error(
      '[AsaasAPI] updatePayment: vencimento inválido.'
    );
  }

  if (
    !Number.isFinite(normalizedValue) ||
    normalizedValue <= 0
  ) {
    throw new Error(
      '[AsaasAPI] updatePayment: valor inválido.'
    );
  }

  const payload = {
    billingType: 'BOLETO',
    dueDate: normalizedDueDate,
    value: normalizedValue,
  };

  console.log(
    '[AsaasAPI] ✏️ Atualizando boleto:',
    {
      paymentId: normalizedPaymentId,
      dueDate: normalizedDueDate,
      value: normalizedValue,
    }
  );

  try {
    const { data } =
      await asaasClient.put(
        `/payments/${encodeURIComponent(
          normalizedPaymentId
        )}`,
        payload
      );

    console.log(
      '[AsaasAPI] ✅ Boleto atualizado:',
      {
        paymentId:
          data?.id || normalizedPaymentId,
        dueDate:
          data?.dueDate || normalizedDueDate,
        value:
          data?.value ?? normalizedValue,
        status:
          data?.status || null,
      }
    );

    return data;
  } catch (error) {
    logAsaasError(
      'updatePayment',
      error
    );

    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* cancelPayment (DELETE /payments/{id})                                   */
/* ---------------------------------------------------------------------- */
export async function cancelPayment(paymentId) {
  if (!paymentId) throw new Error('[AsaasAPI] cancelPayment: paymentId inválido.');

  console.log('[AsaasAPI] 🗑 Excluindo/Cancelando cobrança no Asaas:', paymentId);

  try {
    const { data } = await asaasClient.delete(`/payments/${paymentId}`);
    console.log('[AsaasAPI] ✅ Cobrança removida no Asaas:', data);
    return data;
  } catch (error) {
    logAsaasError('cancelPayment', error);
    throw error;
  }
}



/* ---------------------------------------------------------------------- */
/* Export default — compatível com imports antigos                         */
/* ---------------------------------------------------------------------- */
const asaasApi = {
  createCharge,
  ensureAsaasCustomerForEcommerce,
  getPayment,

  // Atualização de boleto
  updatePayment,

  getBoletoPdf,
  resolveLocalBoletoPath,
  listCharges,
  listPayments,
  listConfirmedPayments,
  getCustomer,
  getBalance,
  cancelPayment,
};

export default asaasApi;
