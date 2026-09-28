// ╔══════════════════════════════════════════════════════════════════╗
// ║ plugnotasNfceApi.js — Cliente NFC-e PlugNotas (CONSART ERP)     ║
// ║ - Consulta RESUMO da NFC-e                                      ║
// ║ - Baixa XML da NFC-e                                            ║
// ║ - Baixa PDF (DANFE) da NFC-e                                    ║
// ║ - Endpoints usados:                                             ║
// ║    • GET /nfce/{idNotaOrChaveOrProtocol}/resumo                 ║
// ║    • GET /nfce/{idNotaOrChaveOrProtocol}/xml                    ║
// ║    • GET /nfce/{idNotaOrChaveOrProtocol}/pdf                    ║
// ╚══════════════════════════════════════════════════════════════════╝

import axios from 'axios';

const PLUGNOTAS_BASE_URL =
  (process.env.PLUGNOTAS_BASE_URL || 'https://api.plugnotas.com.br').replace(
    /\/$/,
    ''
  );
const PLUGNOTAS_API_KEY = process.env.PLUGNOTAS_API_KEY;

if (!PLUGNOTAS_API_KEY) {
  console.warn(
    '[plugnotasNfceApi] Atenção: PLUGNOTAS_API_KEY não está definida no ambiente.'
  );
}

const http = axios.create({
  baseURL: PLUGNOTAS_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-API-KEY': PLUGNOTAS_API_KEY, // maiúsculo, igual à documentação
  },
  timeout: 30000,
});

/* ------------------------------------------------------------------ */
/* Normalização do retorno do /resumo (às vezes array, às vezes obj)  */
/* ------------------------------------------------------------------ */

function normalizeResumoResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

/**
 * Consulta RESUMO da NFC-e na PlugNotas.
 * Aceita: id da nota, chave ou protocolo.
 */
export async function getNfceResumo(idNotaOrChaveOrProtocol) {
  if (!idNotaOrChaveOrProtocol) {
    throw new Error('idNotaOrChaveOrProtocol é obrigatório');
  }

  const path = `/nfce/${encodeURIComponent(idNotaOrChaveOrProtocol)}/resumo`;

  try {
    const { data } = await http.get(path);
    const list = normalizeResumoResponse(data);

    console.log(
      '[plugnotasNfceApi.getNfceResumo] OK:',
      idNotaOrChaveOrProtocol,
      `→ ${list.length} item(ns)`
    );

    return list;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;

    console.error(
      '[plugnotasNfceApi.getNfceResumo] ERRO:',
      'id/chave =',
      idNotaOrChaveOrProtocol,
      '| status =',
      status,
      '| data =',
      body || err.message
    );

    throw err;
  }
}

/**
 * Baixa o XML da NFC-e direto da PlugNotas.
 */
export async function getNfceXml(idNotaOrChaveOrProtocol) {
  if (!idNotaOrChaveOrProtocol) {
    throw new Error('idNotaOrChaveOrProtocol é obrigatório');
  }

  const path = `/nfce/${encodeURIComponent(idNotaOrChaveOrProtocol)}/xml`;

  try {
    const { data } = await http.get(path, { responseType: 'text' });

    console.log(
      '[plugnotasNfceApi.getNfceXml] OK:',
      idNotaOrChaveOrProtocol,
      '→ XML recebido'
    );

    return data;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;

    console.error(
      '[plugnotasNfceApi.getNfceXml] ERRO:',
      'id/chave =',
      idNotaOrChaveOrProtocol,
      '| status =',
      status,
      '| data =',
      body || err.message
    );

    throw err;
  }
}

/**
 * Baixa o PDF (DANFE) da NFC-e direto da PlugNotas.
 * Retorna um Buffer para ser enviado ao navegador.
 */
export async function getNfcePdf(idNotaOrChaveOrProtocol) {
  if (!idNotaOrChaveOrProtocol) {
    throw new Error('idNotaOrChaveOrProtocol é obrigatório');
  }

  const path = `/nfce/${encodeURIComponent(idNotaOrChaveOrProtocol)}/pdf`;

  try {
    const response = await http.get(path, {
      responseType: 'arraybuffer', // importante para binário
    });

    console.log(
      '[plugnotasNfceApi.getNfcePdf] OK:',
      idNotaOrChaveOrProtocol,
      '→ PDF recebido (bytes:',
      response.data?.byteLength ?? 'N/A',
      ')'
    );

    return Buffer.from(response.data);
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;

    console.error(
      '[plugnotasNfceApi.getNfcePdf] ERRO:',
      'id/chave =',
      idNotaOrChaveOrProtocol,
      '| status =',
      status,
      '| data =',
      body || err.message
    );

    throw err;
  }
}

export default {
  getNfceResumo,
  getNfceXml,
  getNfcePdf,
};
