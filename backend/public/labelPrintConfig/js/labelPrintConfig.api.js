// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: labelPrintConfig.api.js                                       ║
// ║ MODULE: Parâmetros Etiqueta Localização — API dos modelos           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { LABEL_MODELS_URL } from '/public/includes/js/locationLabelPrint.js';

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Erro ${response.status} na API.`);
  return data;
}

export const listModels = () => request(`${LABEL_MODELS_URL}?includeInactive=true`);

export const createModel = (payload) =>
  request(LABEL_MODELS_URL, { method: 'POST', body: JSON.stringify(payload) });

export const updateModel = (id, payload) =>
  request(`${LABEL_MODELS_URL}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });

export const setDefaultModel = (id) =>
  request(`${LABEL_MODELS_URL}/${encodeURIComponent(id)}/default`, { method: 'POST' });

export const deleteModel = (id) =>
  request(`${LABEL_MODELS_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
