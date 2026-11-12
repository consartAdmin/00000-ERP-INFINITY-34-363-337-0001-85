// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.api.js                                  ║
// ║ MODULE: Fiscal Classification — API                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { API_PAGE_LIMIT, ROUTES } from './fiscalClassification.config.js';

const ERROR_MESSAGES = Object.freeze({
  DUPLICATE_CLASSIFICATION: 'Já existe uma classificação com esses dados.',
  CLASSIFICATION_NAME_REQUIRED: 'Informe o nome da classificação.',
  CLASSIFICATION_NOT_FOUND: 'Classificação não encontrada.',
});

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      ERROR_MESSAGES[data?.code] ||
      data?.error ||
      data?.message ||
      `Erro ${response.status}`,
    );
  }
  return data;
}

export async function getJson(url) {
  const response = await fetch(url);
  return parseResponse(response);
}

export async function sendJson(url, method, body = null) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? null : JSON.stringify(body),
  });
  return parseResponse(response);
}

/** Busca todas as classificações (ativas e inativas), em lotes de 500. */
export async function listAllFiscalClassifications() {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += API_PAGE_LIMIT) {
    const params = new URLSearchParams({ limit: String(API_PAGE_LIMIT), offset: String(offset) });
    const payload = await getJson(`${ROUTES.fiscalClassifications}?${params}`);
    const batch = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
    rows.push(...batch);
    if (batch.length < API_PAGE_LIMIT) break;
  }
  return rows;
}

export const listFiscalProfiles = (url) => getJson(url);
export const createFiscalClassification = (payload) =>
  sendJson(ROUTES.fiscalClassifications, 'POST', payload);
export const updateFiscalClassification = (id, payload) =>
  sendJson(ROUTES.fiscalClassificationById(id), 'PUT', payload);
export const setFiscalClassificationActive = (id, isActive) =>
  sendJson(ROUTES.fiscalClassificationActive(id), 'PATCH', { is_active: !!isActive });
