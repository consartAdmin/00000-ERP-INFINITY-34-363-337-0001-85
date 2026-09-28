// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cancelarNfeApi.js — Cancelamento de NF-e via TecnoSpeed / PlugNotas ║
// ║ CONSART ERP — ESM                                                   ║
// ║ Funções: cancelar NF-e e consultar status antes do cancelamento     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_PATH || 'backend/.env' });

import axios from 'axios';

/* =========================================================================
 * 🔧 Helpers de ambiente / config
 * ========================================================================= */
function getAmbiente() {
  return (process.env.NFE_AMBIENTE || 'producao').toLowerCase();
}

function getBaseUrl() {
  const amb = getAmbiente();

  if (process.env.PLUGNOTAS_BASE_URL) {
    return process.env.PLUGNOTAS_BASE_URL;
  }

  if (amb === 'sandbox') {
    return 'https://api.sandbox.plugnotas.com.br';
  }

  return 'https://api.plugnotas.com.br';
}

function getApiKey() {
  const amb = getAmbiente();

  if (amb === 'sandbox') {
    return (
      process.env.PLUGNOTAS_API_KEY_SANDBOX ||
      process.env.PLUGNOTAS_API_KEY ||
      process.env.TECNOSPEED_TOKEN_SH ||
      process.env.TECNOSPEED_TOKEN ||
      ''
    );
  }

  return (
    process.env.PLUGNOTAS_API_KEY_REAL ||
    process.env.PLUGNOTAS_API_KEY ||
    process.env.TECNOSPEED_TOKEN_SH ||
    process.env.TECNOSPEED_TOKEN ||
    ''
  );
}

const PLUGNOTAS_TIMEOUT = Number(process.env.PLUGNOTAS_TIMEOUT || 20000);

const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: PLUGNOTAS_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

function ensureAuthHeader() {
  const key = getApiKey();
  api.defaults.headers['X-API-KEY'] = key;
  api.defaults.headers['x-api-key'] = key;
}

function refreshApiConfig() {
  api.defaults.baseURL = getBaseUrl();
  ensureAuthHeader();
}

function normalizeJustificativa(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractErrorMessage(errorData, fallback = 'Falha ao cancelar NF-e.') {
  if (!errorData) return fallback;

  if (typeof errorData === 'string') return errorData;

  return (
    errorData?.error?.message ||
    errorData?.message ||
    errorData?.mensagem ||
    fallback
  );
}

function normalizeConsultaData(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

/* =========================================================================
 * 🔍 Consultar resumo da NF-e
 * ========================================================================= */
export async function consultarResumoNFeParaCancelamento(idOuChave) {
  refreshApiConfig();

  const id = String(idOuChave || '').trim();

  if (!id) {
    return {
      ok: false,
      status: 400,
      message: 'Id, chave ou protocolo da NF-e não informado.',
    };
  }

  try {
    const res = await api.get(`/nfe/${encodeURIComponent(id)}/resumo`);
    const resumo = normalizeConsultaData(res.data);

    return {
      ok: true,
      status: res.status,
      data: resumo,
    };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status || 500,
      message: extractErrorMessage(
        err.response?.data,
        'Não foi possível consultar a NF-e antes do cancelamento.',
      ),
      error: err.response?.data || err.message,
    };
  }
}

/* =========================================================================
 * 🧭 Normalização do status de cancelamento
 * ========================================================================= */
export const CANCELAMENTO_STATUS = Object.freeze({
  PROCESSANDO: 'PROCESSANDO',
  CONCLUIDO: 'CONCLUIDO',
  REJEITADO: 'REJEITADO',
  ERRO: 'ERRO',
});

function pickFirst(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;

    const text = String(value).trim();
    if (text) return text;
  }

  return null;
}

/**
 * O PlugNotas devolve datas em dd/MM/yyyy. O frontend grava esse valor em
 * invoicesIssued.cancelled_at, entao normalizamos para ISO antes de responder.
 */
function toIsoDate(value) {
  const text = String(value || '').trim();

  if (!text) return null;

  const [datePart, timePart] = text.split(/[ T]/);
  const parts = String(datePart || '').split('/');

  if (parts.length !== 3) return text;

  const [dia, mes, ano] = parts;

  if (dia.length !== 2 || mes.length !== 2 || ano.length !== 4) return text;

  const iso = `${ano}-${mes}-${dia}`;

  return timePart ? `${iso}T${timePart}` : iso;
}

function extrairBlocoCancelamento(resumo) {
  if (!resumo || typeof resumo !== 'object') return null;

  const bloco =
    resumo.cancelamento ||
    resumo.eventoCancelamento ||
    resumo.cancelamentoNfe ||
    null;

  if (Array.isArray(bloco)) return bloco[0] || null;

  return bloco && typeof bloco === 'object' ? bloco : null;
}

/**
 * Classifica o texto de situação do EVENTO de cancelamento.
 * Não deve ser usado com a situação da NF-e: nesta API "CONCLUIDO"
 * na nota significa autorizada, e não cancelada.
 */
function classificarStatusCancelamento(texto) {
  const status = String(texto || '').trim().toUpperCase();

  if (!status) return null;

  if (status.includes('REJEIT')) {
    return CANCELAMENTO_STATUS.REJEITADO;
  }

  if (
    status.includes('DENEG') ||
    status.includes('ERRO') ||
    status.includes('FALHA')
  ) {
    return CANCELAMENTO_STATUS.ERRO;
  }

  if (
    status.includes('CANCEL') ||
    status.includes('HOMOLOG') ||
    status.includes('CONCLU') ||
    status.includes('AUTORIZ')
  ) {
    return CANCELAMENTO_STATUS.CONCLUIDO;
  }

  if (
    status.includes('PROCESS') ||
    status.includes('AGUARD') ||
    status.includes('PENDENT')
  ) {
    return CANCELAMENTO_STATUS.PROCESSANDO;
  }

  return null;
}

export function normalizarStatusCancelamento(resumo, idConsultado = null) {
  const bloco = extrairBlocoCancelamento(resumo);

  const situacaoNfe = pickFirst(
    resumo?.situacao,
    resumo?.status,
    resumo?.situacaoNfe,
    resumo?.descricaoSituacao,
  );

  const statusBloco = pickFirst(
    bloco?.status,
    bloco?.situacao,
    bloco?.statusCancelamento,
    bloco?.descricaoSituacao,
  );

  let statusCancelamento = classificarStatusCancelamento(statusBloco);

  if (
    !statusCancelamento &&
    String(situacaoNfe || '').toUpperCase().includes('CANCEL')
  ) {
    statusCancelamento = CANCELAMENTO_STATUS.CONCLUIDO;
  }

  if (!statusCancelamento) {
    statusCancelamento = CANCELAMENTO_STATUS.PROCESSANDO;
  }

  return {
    id:
      idConsultado ||
      pickFirst(resumo?.id, resumo?.idNota, resumo?.idIntegracao),

    statusCancelamento,

    cancellationCompleted:
      statusCancelamento === CANCELAMENTO_STATUS.CONCLUIDO,

    cancellationRejected:
      statusCancelamento === CANCELAMENTO_STATUS.REJEITADO,

    cancellationError:
      statusCancelamento === CANCELAMENTO_STATUS.ERRO,

    protocolo: pickFirst(
      bloco?.protocolo,
      bloco?.numeroProtocolo,
      bloco?.protocoloCancelamento,
      resumo?.protocoloCancelamento,
    ),

    respostaSefaz: pickFirst(
      bloco?.motivo,
      bloco?.xMotivo,
      bloco?.mensagem,
      bloco?.mensagemSefaz,
      bloco?.descricaoSituacao,
      resumo?.mensagemSefaz,
      resumo?.mensagem,
      resumo?.motivo,
      statusBloco,
    ),

    dataCancelamento: toIsoDate(pickFirst(
      bloco?.dataEvento,
      bloco?.dataHoraEvento,
      bloco?.dataCancelamento,
      bloco?.data,
      resumo?.dataCancelamento,
    )),

    justificativa: pickFirst(
      bloco?.justificativa,
      bloco?.motivoCancelamento,
      resumo?.justificativa,
    ),

    situacaoNfe,

    resumo: resumo || null,
  };
}

/* =========================================================================
 * 🔁 Consultar status do cancelamento (polling do frontend)
 * ========================================================================= */
export async function consultarStatusCancelamentoNFe(idOuChave) {
  const id = String(idOuChave || '').trim();

  const resumo = await consultarResumoNFeParaCancelamento(id);

  if (!resumo.ok) {
    return {
      ok: false,
      status: resumo.status,
      message: resumo.message,
      error: resumo.error,
    };
  }

  return {
    ok: true,
    status: 200,
    data: normalizarStatusCancelamento(resumo.data, id),
  };
}

/* =========================================================================
 * 🧠 Validação pré-cancelamento
 * ========================================================================= */
export function validarCancelamentoNFe({ justificativa, resumo } = {}) {
  const erros = [];

  const just = normalizeJustificativa(justificativa);

  if (!just) {
    erros.push('A justificativa do cancelamento é obrigatória.');
  }

  if (just.length < 15) {
    erros.push('A justificativa deve conter no mínimo 15 caracteres.');
  }

  const statusRaw =
    resumo?.situacao ||
    resumo?.status ||
    resumo?.situacaoNfe ||
    resumo?.descricaoSituacao ||
    '';

  const status = String(statusRaw || '').trim().toUpperCase();

  if (!status) {
    erros.push('Não foi possível identificar o status atual da NF-e.');
  }

  if (status.includes('CANCEL')) {
    erros.push('A NF-e já está cancelada.');
  }

  if (status.includes('REJEIT')) {
    erros.push(`A NF-e está rejeitada e não pode ser cancelada. Status atual: ${status}.`);
  }

  if (status.includes('PROCESS')) {
    erros.push(`A NF-e ainda está em processamento. Status atual: ${status}.`);
  }

  const statusValidoParaCancelar =
    status === 'CONCLUIDO' ||
    status === 'AUTORIZADO' ||
    status === 'AUTORIZADA' ||
    status.includes('AUTORIZ');

  if (
    status &&
    !status.includes('CANCEL') &&
    !status.includes('REJEIT') &&
    !status.includes('PROCESS') &&
    !statusValidoParaCancelar
  ) {
    erros.push(
      `A NF-e não está em situação válida para cancelamento. Status atual: ${status}.`,
    );
  }

  return {
    ok: erros.length === 0,
    erros,
    justificativa: just,
    statusAtual: status || null,
  };
}

/* =========================================================================
 * 🚫 Cancelar NF-e
 * ========================================================================= */
export async function cancelarNFe(
  idNota,
  justificativa = 'Cancelamento solicitado pelo emissor',
) {
  refreshApiConfig();

  const id = String(idNota || '').trim();
  const just = normalizeJustificativa(justificativa);

  if (!id) {
    return {
      ok: false,
      status: 400,
      message: 'Id, chave ou protocolo da NF-e não informado.',
    };
  }

  if (!just || just.length < 15) {
    return {
      ok: false,
      status: 400,
      message: 'A justificativa deve conter ao menos 15 caracteres.',
    };
  }

  const resumoAntes = await consultarResumoNFeParaCancelamento(id);

  if (!resumoAntes.ok) {
    return {
      ok: false,
      status: resumoAntes.status,
      message: resumoAntes.message,
      error: resumoAntes.error,
    };
  }

  const validacao = validarCancelamentoNFe({
    justificativa: just,
    resumo: resumoAntes.data,
  });

  if (!validacao.ok) {
    return {
      ok: false,
      status: 400,
      message: validacao.erros.join(' | '),
      erros: validacao.erros,
      resumo: resumoAntes.data,
    };
  }

  try {
    const res = await api.post(
      `/nfe/${encodeURIComponent(id)}/cancelamento`,
      { justificativa: just },
    );

    return {
      ok: true,
      status: res.status,
      data: res.data,
      resumoAntes: resumoAntes.data,
    };
  } catch (err) {
    const errorData = err.response?.data || null;

    return {
      ok: false,
      status: err.response?.status || 500,
      message: extractErrorMessage(errorData),
      error: errorData || err.message,
      resumoAntes: resumoAntes.data,
    };
  }
}

const cancelarNfeApi = {
  consultarResumoNFeParaCancelamento,
  validarCancelamentoNFe,
  cancelarNFe,
};

export default cancelarNfeApi;