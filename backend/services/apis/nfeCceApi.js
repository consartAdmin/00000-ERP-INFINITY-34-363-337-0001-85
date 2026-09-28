// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfeCceApi.js                                                  ║
// ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                  ║
// ║ DESCRIPTION: Serviços de emissão e consulta de CC-e (PlugNotas)     ║
// ║ CONSART ERP · Node.js · Axios · ESM                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import axios from 'axios';

/* =========================================================================
 * 🔧 CONFIG
 * ========================================================================= */

function getAmbiente() {
  return (process.env.NFE_AMBIENTE || 'producao').toLowerCase();
}

function getBaseUrl() {
  if (process.env.PLUGNOTAS_BASE_URL) {
    return process.env.PLUGNOTAS_BASE_URL;
  }

  return getAmbiente() === 'sandbox'
    ? 'https://api.sandbox.plugnotas.com.br'
    : 'https://api.plugnotas.com.br';
}

function getApiKey() {
  return (
    process.env.PLUGNOTAS_API_KEY ||
    process.env.PLUGNOTAS_API_KEY_REAL ||
    process.env.PLUGNOTAS_API_KEY_SANDBOX ||
    process.env.TECNOSPEED_TOKEN ||
    process.env.TECNOSPEED_TOKEN_SH
  );
}

const TIMEOUT = Number(process.env.PLUGNOTAS_TIMEOUT || 20000);

/* =========================================================================
 * 🔐 AXIOS
 * ========================================================================= */

const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

function refreshApiConfig() {
  api.defaults.baseURL = getBaseUrl();

  const key = getApiKey();
  api.defaults.headers['X-API-KEY'] = key;
  api.defaults.headers['x-api-key'] = key;
}

/* =========================================================================
 * 🧼 HELPERS
 * ========================================================================= */

function normalizeCorrecaoText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/* =========================================================================
 * 📤 EMITIR CC-e
 * ========================================================================= */

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

/* =========================================================================
 * 🔍 CONSULTAR STATUS CC-e
 * ========================================================================= */

export async function consultarStatusCCe(
  idOuChaveOuProtocolo,
  listaCce = false
) {
  refreshApiConfig();

  try {
    const res = await api.get(
      `/nfe/${encodeURIComponent(idOuChaveOuProtocolo)}/cce/status`,
      {
        params: listaCce ? { listaCce: true } : {},
      }
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

/* =========================================================================
 * 📄 PDF CC-e
 * ========================================================================= */

// nfeCceApi.js

export async function obterPdfCCe(idOuChaveOuProtocolo) {
  refreshApiConfig();

  const identifier = String(
    idOuChaveOuProtocolo || ''
  ).trim();

  if (!identifier) {
    return {
      ok: false,
      status: 400,
      error: 'Id, chave ou protocolo não informado.',
    };
  }

  try {
    /*
     * A rota /cce/pdf da PlugNotas espera o ID/chave da NF-e,
     * não necessariamente o protocolo da CC-e.
     *
     * A consulta de status aceita o protocolo e devolve a URL
     * correta do PDF vinculada à NF-e.
     */
    const statusResult = await consultarStatusCCe(
      identifier,
      false
    );

    if (!statusResult.ok) {
      return statusResult;
    }

    const statusPayload =
      statusResult.data?.data ??
      statusResult.data ??
      {};

    const statusItem =
      Array.isArray(statusPayload)
        ? statusPayload[0] || {}
        : statusPayload;

    const situacao = String(
      statusItem.status ||
      statusItem.situacao ||
      ''
    ).toUpperCase();

    const pdfUrl =
      statusItem.pdf ||
      statusItem.pdfUrl ||
      statusItem.urlPdf ||
      null;

    if (!pdfUrl) {
      const emProcessamento =
        situacao.includes('PROCESS');

      return {
        ok: false,
        status: emProcessamento ? 202 : 404,
        processing: emProcessamento,
        error: emProcessamento
          ? 'CC-e ainda em processamento.'
          : 'URL do PDF da CC-e não disponível.',
      };
    }

    const res = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT,
      headers: {
        Accept: 'application/pdf',
        'X-API-KEY': getApiKey(),
        'x-api-key': getApiKey(),
      },
      validateStatus: () => true,
    });

    const contentType = String(
      res.headers?.['content-type'] || ''
    ).toLowerCase();

    const buffer = Buffer.from(res.data || []);

    const isPdf =
      contentType.includes('application/pdf') ||
      buffer.subarray(0, 4).toString() === '%PDF';

    if (res.status >= 400 || !isPdf) {
      return {
        ok: false,
        status:
          res.status >= 400
            ? res.status
            : 502,
        error:
          buffer.toString('utf8') ||
          'A PlugNotas não retornou um PDF válido.',
      };
    }

    return {
      ok: true,
      status: res.status,
      buffer,
      contentType:
        contentType || 'application/pdf',
      pdfUrl,
    };
  } catch (err) {
    let error = err.response?.data || err.message;

    if (
      Buffer.isBuffer(error) ||
      error instanceof ArrayBuffer
    ) {
      error = Buffer.from(error).toString('utf8');
    }

    return {
      ok: false,
      status: err.response?.status || 500,
      error,
    };
  }
}

/* =========================================================================
 * 📄 XML CC-e
 * ========================================================================= */

export async function obterXmlCCe(idOuChaveOuProtocolo) {
  refreshApiConfig();

  try {
    const status = await consultarStatusCCe(idOuChaveOuProtocolo);

    if (!status.ok) return status;

    const xmlUrl =
      status?.data?.data?.xml ||
      status?.data?.xml ||
      null;

    if (!xmlUrl) {
      return {
        ok: false,
        status: 404,
        error: 'URL do XML da CC-e não disponível.',
      };
    }

    const res = await axios.get(xmlUrl, {
      responseType: 'text',
      headers: {
        'X-API-KEY': getApiKey(),
        'x-api-key': getApiKey(),
      },
      timeout: TIMEOUT,
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

/* =========================================================================
 * 📋 EXPORT DEFAULT
 * ========================================================================= */

const nfeCceApi = {
  emitirCCe,
  consultarStatusCCe,
  obterPdfCCe,
  obterXmlCCe,
};

export default nfeCceApi;