// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tecnoSpeedDFeApi.js — Integração DF-e PlugNotas (CONSART ERP | ESM) ║
// ║                                                                      ║
// ║ Consome a rota DF-e (Notas Destinadas) da PlugNotas:                 ║
// ║   GET https://api.plugnotas.com.br/nfe/destinada                     ║
// ║                                                                      ║
// ║ Funções principais:                                                  ║
// ║   - listDfe(params)        → lista DF-e (paginado)                   ║
// ║   - getByKey(chave)        → (stub simples usando listDfe)           ║
// ║   - normalizeListResponse  → normaliza o JSON bruto PlugNotas        ║
// ║   - mapNota(raw)           → reduz uma nota para um shape enxuto     ║
// ║                                                                      ║
// ║ ✅ Robustez adicionada:                                               ║
// ║   - retry/backoff para 429/502/503/504 + erros de rede               ║
// ║   - keepAlive agent                                                  ║
// ║   - logs de erro enxutos e úteis                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import axios from 'axios';
import https from 'https';

// ======================================================================
// Configuração PlugNotas DF-e
// ======================================================================

// Ambiente (só para escolher qual API key usar)
const NFE_AMBIENTE = process.env.NFE_AMBIENTE || 'homologacao';

// Base URL: você já deixou no .env
//   PLUGNOTAS_BASE_URL=https://api.plugnotas.com.br
const PLUGNOTAS_BASE_URL =
  process.env.PLUGNOTAS_BASE_URL || 'https://api.plugnotas.com.br';

// Token / x-api-key:
// - Em homolog você pode usar PLUGNOTAS_API_KEY_HOMOLOG
// - Em produção PLUGNOTAS_API_KEY
let PLUGNOTAS_API_KEY = process.env.PLUGNOTAS_API_KEY || '';

if (
  NFE_AMBIENTE === 'homologacao' &&
  process.env.PLUGNOTAS_API_KEY_HOMOLOG
) {
  PLUGNOTAS_API_KEY = process.env.PLUGNOTAS_API_KEY_HOMOLOG;
}

const NFE_LIST_DEBUG =
  String(process.env.NFE_LIST_DEBUG || '0').trim() === '1';

// CNPJ padrão da empresa (caso você não envie cpfCnpj no params)
const EMPRESA_CNPJ =
  (process.env.EMPRESA_CNPJ || '').replace(/\D/g, '') || '';

// ======================================================================
// Helpers internos (retry/backoff)
// ======================================================================

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetworkCode(code) {
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNABORTED'
  );
}

function axiosErrInfo(err) {
  return {
    message: err?.message,
    code: err?.code,
    status: err?.response?.status,
    statusText: err?.response?.statusText,
    url: err?.config?.baseURL
      ? `${err.config.baseURL}${err.config.url || ''}`
      : err?.config?.url,
  };
}

async function requestWithRetry(config, { retries = 5, baseDelayMs = 650 } = {}) {
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await http.request(config);
    } catch (err) {
      lastErr = err;

      const status = err?.response?.status;
      const code = err?.code;

      const retryable =
        (typeof status === 'number' && isRetryableStatus(status)) ||
        isRetryableNetworkCode(code);

      if (!retryable || attempt === retries) break;

      // backoff exponencial + jitter
      const jitter = Math.floor(Math.random() * 250);
      const waitMs = baseDelayMs * Math.pow(2, attempt) + jitter;

      console.warn('[PlugNotas][DF-e] retry', {
        attempt: attempt + 1,
        retries,
        waitMs,
        ...axiosErrInfo(err),
      });

      await sleep(waitMs);
    }
  }

  throw lastErr;
}

// ======================================================================
// Instância Axios (com keepAlive + interceptors)
// ======================================================================

// KeepAlive melhora estabilidade (muito comum evitar “conexão reaproveitada ruim”)
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

const http = axios.create({
  baseURL: PLUGNOTAS_BASE_URL,
  timeout: 60000,
  httpsAgent,
});

// Header x-api-key da PlugNotas
http.interceptors.request.use((config) => {
  config.headers = config.headers || {};

  if (PLUGNOTAS_API_KEY) {
    config.headers['x-api-key'] = PLUGNOTAS_API_KEY;
  }

  // garante accept
  if (!config.headers.Accept) {
    config.headers.Accept = 'application/json, text/plain, */*';
  }

  return config;
});

// ======================================================================
// Helpers internos de normalização
// ======================================================================

/**
 * Reduz a nota COMPLETA da PlugNotas para um formato mais enxuto,
 * ideal para inbox / grid.
 *
 * Baseado no JSON de exemplo enviado (campos principais).
 */
export function mapNota(raw = {}) {
  const emit = raw.emitente || {};
  const dest = raw.destinatario || {};
  const total = raw.total || {};
  const ultimaManifestacao =
    Array.isArray(raw.manifestacao) && raw.manifestacao.length
      ? raw.manifestacao[raw.manifestacao.length - 1]
      : null;

  return {
    // Campos chave
    idIntegracao: raw.idIntegracao || null,
    status: raw.status || null,
    chave: raw.chave || null,
    numero: raw.numero || null,
    serie: raw.serie ?? null,
    versaoManual: raw.versaoManual || null,
    finalidade: raw.finalidade || null,

    // Datas importantes
    dataEmissao: raw.dataEmissao || null,
    dataSaidaEntrada: raw.dataSaidaEntrada || null,
    dataAutorizacao: raw.dataAutorizacao || null,

    // Emissão / tipo
    saida: Boolean(raw.saida),
    presencial: raw.presencial || null,
    tipoImpressao: raw.tipoImpressao || null,
    tipoEmissao: raw.tipoEmissao || null,

    // Emitente
    emitente: {
      cpfCnpj: emit.cpfCnpj || null,
      razaoSocial: emit.razaoSocial || null,
      nomeFantasia: emit.nomeFantasia || null,
      inscricaoEstadual: emit.inscricaoEstadual || null,
      inscricaoMunicipal: emit.inscricaoMunicipal || null,
      email: emit.email || null,
      telefone: emit.telefone
        ? `${emit.telefone.ddd || ''}${emit.telefone.numero || ''}`.trim()
        : null,
      endereco: emit.endereco
        ? {
            logradouro: emit.endereco.logradouro || null,
            numero: emit.endereco.numero || null,
            bairro: emit.endereco.bairro || null,
            cep: emit.endereco.cep || null,
            codigoCidade: emit.endereco.codigoCidade || null,
            descricaoCidade: emit.endereco.descricaoCidade || null,
            estado: emit.endereco.estado || null,
          }
        : null,
    },

    // Destinatário
    destinatario: {
      cpfCnpj: dest.cpfCnpj || null,
      razaoSocial: dest.razaoSocial || null,
      nomeFantasia: dest.nomeFantasia || null,
      email: dest.email || null,
      telefone: dest.telefone
        ? `${dest.telefone.ddd || ''}${dest.telefone.numero || ''}`.trim()
        : null,
      inscricaoEstadual: dest.inscricaoEstadual || null,
      orgaoPublico: Boolean(dest.orgaoPublico),
      endereco: dest.endereco
        ? {
            logradouro: dest.endereco.logradouro || null,
            numero: dest.endereco.numero || null,
            bairro: dest.endereco.bairro || null,
            cep: dest.endereco.cep || null,
            codigoCidade: dest.endereco.codigoCidade || null,
            descricaoCidade: dest.endereco.descricaoCidade || null,
            estado: dest.endereco.estado || null,
          }
        : null,
    },

    // Totais principais
    totais: {
      valorNfe: total.valorNfe ?? null,
      valorProdutosServicos: total.valorProdutosServicos ?? null,
      valorFrete: total.valorFrete ?? null,
      valorDesconto: total.valorDesconto ?? null,
      valorIcms: total.valorIcms ?? null,
      valorIpi: total.valorIpi ?? null,
      valorPis: total.valorPis ?? null,
      valorCofins: total.valorCofins ?? null,
      valorOutros: total.valorOutros ?? null,
    },

    // Pagamento (primeiro registro)
    pagamento:
      Array.isArray(raw.pagamentos) && raw.pagamentos.length
        ? {
            meio: raw.pagamentos[0].meio || null,
            descricaoMeio: raw.pagamentos[0].descricaoMeio || null,
            valor: raw.pagamentos[0].valor ?? null,
            aVista: Boolean(raw.pagamentos[0].aVista),
          }
        : null,

    // Cobrança (duplicatas/parcelas)
    cobranca: raw.cobranca
      ? {
          numero: raw.cobranca.numero || null,
          valorTotal: raw.cobranca.valorTotal ?? null,
          valorDesconto: raw.cobranca.valorDesconto ?? null,
          valorLiquido: raw.cobranca.valorLiquido ?? null,
          parcelas: Array.isArray(raw.cobranca.parcelas)
            ? raw.cobranca.parcelas.map((p) => ({
                numero: p.numero || null,
                dataVencimento: p.dataVencimento || null,
                valor: p.valor ?? null,
              }))
            : [],
        }
      : null,

    // Última manifestação (se houver)
    manifestacao: ultimaManifestacao
      ? {
          data: ultimaManifestacao.data || null,
          operacao: ultimaManifestacao.operacao || null,
          status: ultimaManifestacao.status || null,
          respostaSefaz: ultimaManifestacao.respostaSefaz || null,
          cStat: ultimaManifestacao.cStat ?? null,
          retorno: ultimaManifestacao.retorno || null,
        }
      : null,

    // Flags
    xmlCompleto: Boolean(raw.xmlCompleto),
    enviaremail: Boolean(raw.enviaremail),

    // Campos extras se precisar
    raw, // mantém original caso você precise em telas mais detalhadas
  };
}

/**
 * Normaliza a resposta COMPLETA da listagem de DF-e,
 * baseada no JSON de exemplo.
 */
export function normalizeListResponse(body = {}) {
  const notasArray = Array.isArray(body.notas) ? body.notas : [];

  return {
    nextPageHash: body.hashProximaPagina || null,
    totalNotas: notasArray.length,
    notas: notasArray.map(mapNota),
    raw: body,
  };
}

// ======================================================================
// Funções de API — DF-e (Notas Destinadas)
// ======================================================================

/**
 * Lista DF-e via PlugNotas:
 *   GET /nfe/destinada
 */
export async function listDfe(params = {}) {
  const {
    cpfCnpj,
    cnpjDestinatario,
    manifestada,
    status,
    dataInicial,
    dataFinal,
    hashProximaPagina,
    resume,
  } = params;

  const cpfCnpjFinal =
    (cpfCnpj || cnpjDestinatario || EMPRESA_CNPJ || '').replace(/\D/g, '');

  if (!cpfCnpjFinal) {
    throw new Error(
      'cpfCnpj (ou EMPRESA_CNPJ no .env) é obrigatório para listDfe()'
    );
  }

  const query = { cpfCnpj: cpfCnpjFinal };

  if (typeof manifestada === 'boolean') query.manifestada = manifestada;
  if (status) query.status = status;
  if (dataInicial) query.dataInicial = dataInicial;
  if (dataFinal) query.dataFinal = dataFinal;
  if (hashProximaPagina) query.hashProximaPagina = hashProximaPagina;
  if (typeof resume === 'boolean') query.resume = resume;

  if (NFE_LIST_DEBUG) {
    console.log('🔍 [DF-e] GET /nfe/destinada', {
      baseURL: PLUGNOTAS_BASE_URL,
      query,
    });
  }

  try {
    const { data } = await requestWithRetry(
      {
        method: 'GET',
        url: '/nfe/destinada',
        params: query,
      },
      { retries: 5, baseDelayMs: 700 }
    );

    if (NFE_LIST_DEBUG) {
      console.log(
        '📥 [DF-e] Resposta bruta resumida:',
        `hashProximaPagina=${data?.hashProximaPagina || null}`,
        `qtdeNotas=${Array.isArray(data?.notas) ? data.notas.length : 0}`
      );
    }

    return normalizeListResponse(data);
  } catch (err) {
    // 🔥 log enxuto (não polui), mas útil
    console.error('listDfe() failed:', axiosErrInfo(err));

    // rethrow para o controller decidir status 502/500
    throw err;
  }
}

/**
 * getByKey(chave)
 *
 * STUB simples usando listDfe(), apenas para não quebrar seu teste.
 * Depois podemos evoluir para /nfe/sincronizarDestinada.
 */
export async function getByKey(chave, cpfCnpjInput) {
  if (!chave) {
    throw new Error('Chave de acesso é obrigatória para getByKey()');
  }

  const cpfCnpj =
    (cpfCnpjInput || EMPRESA_CNPJ || '').replace(/\D/g, '') || null;

  if (!cpfCnpj) {
    throw new Error(
      'cpfCnpj (ou EMPRESA_CNPJ no .env) é obrigatório para getByKey()'
    );
  }

  const page = await listDfe({
    cpfCnpj,
    resume: true,
  });

  const notaBruta =
    page.notas.map((n) => n.raw).find((n) => n.chave === chave) || null;

  if (!notaBruta) {
    return { nota: null, raw: null };
  }

  return { nota: mapNota(notaBruta), raw: notaBruta };
}

/**
 * downloadXmlByKey(chaveOuId)
 *
 * Baixa o XML da NF-e (destinatário) pelo ID da nota ou pela CHAVE (44 dígitos).
 *
 * Rota PlugNotas NF-e:
 *   GET /nfe/{idNotaorChave}/xml
 *
 * Observação:
 * - Para NF-e destinada, o XML completo pode depender de manifestação/conclusão do processo.
 * - Se não estiver disponível, retornamos null (para o controller devolver 404 XML_NOT_AVAILABLE).
 */
export async function downloadXmlByKey(chaveOuId) {
  if (!chaveOuId) throw new Error('downloadXmlByKey: chaveOuId é obrigatório');

  const idOrKey = String(chaveOuId).trim();

  try {
    const resp = await requestWithRetry(
      {
        method: 'GET',
        url: `/nfe/${encodeURIComponent(idOrKey)}/xml`,
        responseType: 'text', // <-- essencial: XML vem como texto
        headers: {
          Accept: 'application/xml, text/xml, application/json, text/plain, */*',
        },
      },
      { retries: 3, baseDelayMs: 700 }
    );

    const xmlText = typeof resp?.data === 'string' ? resp.data : '';

    // Se veio vazio, não temos XML
    if (!xmlText || !xmlText.trim()) return null;

    // Se a API respondeu JSON de erro (às vezes vem como texto), tratamos como "não disponível"
    const t = xmlText.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      // mantém comportamento do controller: "XML_NOT_AVAILABLE"
      return null;
    }

    // Heurística simples: XML normalmente começa com "<"
    if (!t.startsWith('<')) return null;

    return xmlText;
  } catch (err) {
    const status = err?.response?.status;

    // 404/400 comuns quando não existe XML disponível ainda
    if (status === 404 || status === 400) return null;

    // Deixa o controller tratar 429/502/503/504 como 502
    throw err;
  }
}


// ======================================================================
// Export default (padrão usado nos outros apis)
// ======================================================================

export default {
  http,
  listDfe,
  getByKey,
  downloadXmlByKey,   // ✅ ADD AQUI
  mapNota,
  normalizeListResponse,
};