// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeApiClient.repository.js — Cliente HTTP da NF-e API própria        ║
// ║ ✔ NFE_PROVIDER / NFE_API_URL / NFE_API_KEY lidos em tempo de uso     ║
// ║ ✔ Ambiente da empresa na API conferido com NFE_AMBIENTE do ERP       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import axios from 'axios';

/* =========================================================================
 * 🔧 Configuração
 * ========================================================================= */

/** true quando o ERP deve emitir pela NF-e API própria em vez da TecnoSpeed. */
export function isNfeApiProvider() {
  return String(process.env.NFE_PROVIDER || 'tecnospeed').trim().toLowerCase() === 'nfe-api';
}

function getBaseUrl() {
  return String(process.env.NFE_API_URL || 'https://api.producao.consart.com.br').trim().replace(/\/+$/, '');
}

function getApiKey() {
  const key = String(process.env.NFE_API_KEY || '').trim();
  if (!key) throw new Error('[NfeApi] NFE_API_KEY ausente no .env.');
  return key;
}

export function getIssuerCnpj() {
  const cnpj = String(process.env.EMPRESA_CNPJ || '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('[NfeApi] EMPRESA_CNPJ ausente ou inválido no .env.');
  return cnpj;
}

export const NFE_API_TIMEOUT = Number(process.env.NFE_API_TIMEOUT || 90000);

/* =========================================================================
 * 🔐 Requisição
 * ========================================================================= */

/**
 * Chamada HTTP que nunca lança por status: 4xx/5xx voltam em { status, data }.
 * A NF-e API responde 422 com o registro da nota quando a SEFAZ rejeita,
 * então o status HTTP sozinho não diz se houve documento.
 */
export async function request(method, path, { data, responseType } = {}) {
  try {
    const res = await axios({
      method,
      url: `${getBaseUrl()}${path}`,
      data,
      responseType,
      timeout: NFE_API_TIMEOUT,
      headers: { 'x-api-key': getApiKey(), ...(data ? { 'Content-Type': 'application/json' } : {}) },
      validateStatus: () => true,
      ...(responseType === 'text' ? { transformResponse: [(raw) => raw] } : {}),
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    // Rede/timeout: o resultado é desconhecido, quem chamou decide o que fazer
    return { status: 503, data: { message: `NF-e API indisponível: ${err.message}` }, networkError: true };
  }
}

/** Mensagem legível de uma resposta de erro da NF-e API. */
export function errorMessageFrom(response) {
  const data = response?.data;
  if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
    try {
      return JSON.parse(Buffer.from(data).toString('utf8')).message;
    } catch {
      return `NF-e API respondeu HTTP ${response.status}`;
    }
  }
  const details = Array.isArray(data?.details) ? ` (${data.details.join('; ')})` : '';
  return `${data?.message || `NF-e API respondeu HTTP ${response?.status}`}${details}`;
}

/* =========================================================================
 * 🧭 Ambiente
 * ========================================================================= */

/** NFE_AMBIENTE do ERP (producao/homologacao/sandbox) → ambiente da NF-e API. */
export function expectedApiEnvironment() {
  return String(process.env.NFE_AMBIENTE || 'producao').toLowerCase() === 'producao' ? 'production' : 'homologation';
}

/** Ambiente da NF-e API → nomenclatura já gravada pelo ERP (NFE_AMBIENTE). */
export function toErpEnvironment(environment) {
  return environment === 'production' ? 'producao' : 'homologacao';
}

let companyCache = { at: 0, value: null };

/**
 * Impede emitir em um ambiente diferente do que o ERP acredita estar usando
 * (ex.: ERP em producao e empresa ainda em homologação na API).
 */
export async function assertCompanyEnvironment(cnpj) {
  if (!companyCache.value || companyCache.value.cnpj !== cnpj || Date.now() - companyCache.at > 60_000) {
    const res = await request('GET', `/v1/companies/${cnpj}`);
    if (res.status !== 200) {
      return { ok: false, status: res.status, message: `Empresa ${cnpj} não encontrada na NF-e API: ${errorMessageFrom(res)}` };
    }
    companyCache = { at: Date.now(), value: res.data };
  }

  const company = companyCache.value;
  const expected = expectedApiEnvironment();
  if (company.environment !== expected) {
    return {
      ok: false,
      status: 409,
      message:
        `Ambiente divergente: o ERP está em "${process.env.NFE_AMBIENTE || 'producao'}" e a empresa ` +
        `${cnpj} está em "${toErpEnvironment(company.environment)}" na NF-e API. Ajuste um dos dois antes de emitir.`,
    };
  }
  return { ok: true, company };
}
