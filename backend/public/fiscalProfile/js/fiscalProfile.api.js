// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.api.js                                           ║
// ║ MODULE: Fiscal Profile — API                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API_PAGE_LIMIT, ROUTES } from './fiscalProfile.config.js';

const ERROR_MESSAGES = Object.freeze({
  DUPLICATE_PROFILE: 'Já existe um perfil fiscal com esse nome.',
  PROFILE_NAME_REQUIRED: 'Informe o nome do perfil fiscal.',
  PROFILE_NOT_FOUND: 'Perfil fiscal não encontrado.',
});

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      ERROR_MESSAGES[data?.code] || data?.error || data?.message || `Erro ${response.status}`,
    );
  }
  return data;
}

async function sendJson(url, method, body = null) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? null : JSON.stringify(body),
  });
  return parseResponse(response);
}

/** Busca todos os perfis (ativos e inativos), em lotes de 500. */
export async function listAllFiscalProfiles() {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += API_PAGE_LIMIT) {
    const params = new URLSearchParams({ limit: String(API_PAGE_LIMIT), offset: String(offset) });
    const payload = await parseResponse(await fetch(`${ROUTES.fiscalProfiles}?${params}`));
    const batch = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
    rows.push(...batch);
    if (batch.length < API_PAGE_LIMIT) break;
  }
  return rows;
}

export const createFiscalProfile = (payload) => sendJson(ROUTES.fiscalProfiles, 'POST', payload);
export const updateFiscalProfile = (id, payload) => sendJson(ROUTES.fiscalProfileById(id), 'PUT', payload);
export const setFiscalProfileActive = (id, isActive) =>
  sendJson(ROUTES.fiscalProfileActive(id), 'PATCH', { is_active: !!isActive });
