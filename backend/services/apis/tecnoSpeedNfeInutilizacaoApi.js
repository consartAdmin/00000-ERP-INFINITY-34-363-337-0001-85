// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tecnoSpeedNfeInutilizacaoApi.js — PlugNotas NF-e Inutilização        ║
// ║ CONSART ERP | ESM                                                    ║
// ║ - POST /nfe/inutilizacao                                             ║
// ║ - GET  /nfe/inutilizacao/{protocol}/status                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import axios from 'axios';

function onlyDigits(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

function isNum(v) {
  return /^[0-9]+$/.test(String(v ?? ''));
}

function normalizeStatus(s) {
  return String(s || '').trim().toUpperCase();
}

function getBaseURL() {
  return (process.env.PLUGNOTAS_BASE_URL || 'https://api.plugnotas.com.br').replace(/\/+$/, '');
}

function getApiKey() {
  return (
    process.env.PLUGNOTAS_API_KEY ||
    process.env.PLUGNOTAS_API_KEY_REAL ||
    process.env.PLUGNOTAS_API_KEY_SANDBOX ||
    process.env.PLUGNOTAS_API_KEY_HOMOLOG ||
    null
  );
}

function isMock() {
  return String(process.env.PLUGNOTAS_MOCK || '0') === '1';
}

function client() {
  const baseURL = getBaseURL();
  const apiKey = getApiKey();

  const headers = {};
  // Em MOCK, você pode optar por não exigir a key no seu fluxo,
  // mas se tiver, enviamos igual.
  if (apiKey) headers['X-API-KEY'] = apiKey;

  return axios.create({
    baseURL,
    headers,
    timeout: Number(process.env.PLUGNOTAS_TIMEOUT_MS || 45000),
  });
}

function normAxiosError(err) {
  const status = err?.response?.status || 0;
  const data = err?.response?.data;
  const msg =
    (typeof data === 'string' && data) ||
    data?.message ||
    data?.erro ||
    err?.message ||
    'Erro inesperado';
  return { status, message: msg, data };
}

/**
 * Solicita inutilização de numeração.
 * Esperado: retorno com "protocol" (protocolo para consulta em /status).
 */
async function solicitarInutilizacao({
  cpfCnpj,
  ano,
  serie,
  inicial,
  final,
  justificativa,
} = {}) {
  try {
    // Validações básicas
    const doc = onlyDigits(cpfCnpj);
    if (!(doc.length === 11 || doc.length === 14)) {
      return { ok: false, status: 400, error: 'cpfCnpj inválido (11 ou 14 dígitos).' };
    }

    const _ano = Number(ano);
    const _serie = Number(serie);
    const _ini = Number(inicial);
    const _fim = Number(final);

    if (!Number.isFinite(_ano) || _ano < 2000 || _ano > 2100) {
      return { ok: false, status: 400, error: 'ano inválido.' };
    }
    if (!Number.isFinite(_serie) || _serie < 0) {
      return { ok: false, status: 400, error: 'serie inválida.' };
    }
    if (!Number.isFinite(_ini) || !Number.isFinite(_fim) || _ini <= 0 || _fim <= 0 || _fim < _ini) {
      return { ok: false, status: 400, error: 'Faixa inválida (inicial/final).' };
    }

    const just = String(justificativa || '').trim();
    if (just.length < 15) {
      return { ok: false, status: 400, error: 'Justificativa deve ter no mínimo 15 caracteres.' };
    }

    // Body (mantive nomes simples; se seu provedor exigir outros nomes, ajuste aqui)
    const payload = {
      cpfCnpj: doc,
      ano: _ano,
      serie: _serie,
      numeracao: { inicial: _ini, final: _fim },
      justificativa: just,
    };

    // MOCK (opcional): devolve um exemplo compatível com o seu JSON
    if (isMock()) {
      const protocol = 'mock-' + cryptoRandom();
      return {
        ok: true,
        status: 200,
        message: 'Solicitação de inutilização processada (MOCK)',
        data: {
          ...payload,
          protocol,
          data: new Date().toISOString(),
          status: 'PROCESSANDO',
        },
      };
    }

    const http = client();
    const resp = await http.post('/nfe/inutilizacao', payload);

    // Normalização: alguns retornos vêm em data.protocol, outros em data.data.protocol etc.
    const body = resp.data || {};
    const protocol = body?.protocol || body?.data?.protocol || null;

    return {
      ok: true,
      status: resp.status,
      message: body?.message || 'Solicitação de inutilização enviada',
      data: body?.data ?? body,
      protocol,
    };
  } catch (err) {
    const e = normAxiosError(err);
    return { ok: false, status: e.status || 502, error: e.message, detail: e.data };
  }
}

/**
 * Consulta status da inutilização via protocolo:
 * GET /nfe/inutilizacao/{protocol}/status
 */
async function consultarStatus(protocol) {
  try {
    const p = String(protocol || '').trim();
    if (!p) return { ok: false, status: 400, error: 'protocol não informado.' };

    if (isMock()) {
      return {
        ok: true,
        status: 200,
        message: 'Consulta de inutilização (MOCK)',
        data: {
          numeracao: { inicial: 14, final: 15 },
          retorno: { cStat: 102, mensagem: 'Inutilizacao de numero homologado', protocolo: '123456789012345' },
          serie: 1,
          ano: 2023,
          justificativa: 'Inutilização de numeração de NFe.',
          cpfCnpj: '12345678901234',
          protocol: p,
          data: new Date().toISOString(),
          status: 'CONCLUIDO',
        },
      };
    }

    const http = client();
    const resp = await http.get(`/nfe/inutilizacao/${encodeURIComponent(p)}/status`);
    const body = resp.data || {};

    // Garante status consistente no topo
    const data = body?.data ?? body;
    if (data?.status) data.status = normalizeStatus(data.status);

    return {
      ok: true,
      status: resp.status,
      message: body?.message || 'Status da inutilização consultado',
      data,
    };
  } catch (err) {
    const e = normAxiosError(err);
    return { ok: false, status: e.status || 502, error: e.message, detail: e.data };
  }
}

// Helpers: UUID simples para MOCK (sem depender de libs)
function cryptoRandom() {
  // fallback simples (não-críptico) só para MOCK
  return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
}

export default {
  solicitarInutilizacao,
  consultarStatus,
};
