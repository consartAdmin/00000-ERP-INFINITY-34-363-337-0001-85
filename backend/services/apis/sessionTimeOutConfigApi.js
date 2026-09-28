// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ File: services/apis/sessionTimeOutConfigApi.js                           ║
// ║ Desc: API Client interno p/ sessionTimeOutConfig                         ║
// ║ Uso: abstrai chamadas HTTP p/ o controller, usado por scripts/testes     ║
// ║ Padrão: ESM — compatível c/ outros módulos da pasta services/apis        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import jfetch from '../helpers/jfetch.js'; // wrapper padrão usado no ERP (ou ajuste conforme seu projeto)
const BASE_URL = 'http://localhost:8080/api/session-config';

/**
 * Retorna a configuração atual de timeout de sessão.
 * @returns {Promise<object>} Configuração atual (ou defaults)
 */
export async function getSessionConfig() {
  const resp = await jfetch(`${BASE_URL}`, { method: 'GET' });
  return resp;
}

/**
 * Atualiza ou insere (upsert) a configuração.
 * @param {object} data Campos a atualizar. Ex: { idle_minutes: 15, warn_seconds: 30, enabled: true }
 * @returns {Promise<object>} Resultado completo da API
 */
export async function updateSessionConfig(data = {}) {
  const resp = await jfetch(`${BASE_URL}`, {
    method: 'PUT',
    body: data
  });
  return resp;
}

/**
 * Restaura valores padrão.
 * (Função opcional, útil p/ testes automatizados)
 */
export async function resetDefaults() {
  const defaults = {
    enabled: true,
    idle_minutes: 10,
    warn_seconds: 0,
    silent: true,
    redirect_url: '/public/login/login.html',
    updated_by: 'system'
  };
  return updateSessionConfig(defaults);
}

export default {
  getSessionConfig,
  updateSessionConfig,
  resetDefaults
};
