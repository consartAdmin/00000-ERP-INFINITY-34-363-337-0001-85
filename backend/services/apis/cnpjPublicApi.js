// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cnpjPublicApi.js — Cliente da API Pública de CNPJ                   ║
// ║ CONSART ERP / CONSART-PJ                                            ║
// ║ - Consulta dados cadastrais básicos pelo CNPJ                       ║
// ║ - Usa API pública (sem autenticação)                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import axios from 'axios';

/**
 * Base da API pública de CNPJ.
 * Deixe em .env para poder trocar se precisar:
 *   CNPJ_PUBLIC_API_BASE=https://publica.cnpj.ws/cnpj
 */
const CNPJ_PUBLIC_API_BASE =
  process.env.CNPJ_PUBLIC_API_BASE || 'https://publica.cnpj.ws/cnpj';

/**
 * Normaliza CNPJ: remove tudo que não for dígito.
 */
function sanitizeCnpj(cnpj) {
  if (!cnpj) return '';
  return String(cnpj).replace(/\D/g, '');
}

/**
 * Valida formato básico do CNPJ (apenas tamanho 14).
 * Se quiser, depois você coloca uma validação mais rígida.
 */
function isValidCnpj(cnpjDigits) {
  return cnpjDigits.length === 14;
}

/**
 * Consulta CNPJ na API pública.
 * Retorna os dados brutos da API (ou lança erro).
 */
export async function consultarCnpjPublic(cnpjInput) {
  const cnpj = sanitizeCnpj(cnpjInput);

  if (!isValidCnpj(cnpj)) {
    const err = new Error('CNPJ inválido. Informe 14 dígitos.');
    err.statusCode = 400;
    throw err;
  }

  const url = `${CNPJ_PUBLIC_API_BASE}/${cnpj}`;

  try {
    const response = await axios.get(url, {
      timeout: 10000, // 10s
      headers: {
        // Caso a API exija algum header específico no futuro, você adiciona aqui
        Accept: 'application/json'
      }
    });

    // Aqui você pode fazer um "map" para o formato padrão do CONSART,
    // mas por enquanto vamos devolver o payload original.
    return response.data;
  } catch (error) {
    // Tratamento básico de erro vindo da API externa
    console.error('[cnpjPublicApi] Erro ao consultar CNPJ:', {
      cnpj,
      message: error.message
    });

    // Se a API externa responder com status, repassa ou adapta
    if (error.response) {
      const status = error.response.status;

      if (status === 404) {
        const err = new Error('CNPJ não encontrado na base pública.');
        err.statusCode = 404;
        throw err;
      }

      const err = new Error(
        `Erro na API pública de CNPJ (status ${status}). Tente novamente.`
      );
      err.statusCode = 502; // Bad Gateway (erro em serviço externo)
      throw err;
    }

    // Timeout, problema de rede, etc.
    const err = new Error(
      'Não foi possível conectar à API pública de CNPJ. Verifique a conexão ou tente mais tarde.'
    );
    err.statusCode = 502;
    throw err;
  }
}
