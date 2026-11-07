// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.api.js — Comunicação HTTP do módulo             ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { API_BASE, LIST_BATCH } from './nfeInutilizarEvents.config.js';

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok || data?.ok === false) {
    const message = (typeof data?.error === 'string' && data.error)
      || (typeof data?.message === 'string' && data.message)
      || (Array.isArray(data?.errors) ? data.errors.join(' ') : '')
      || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/** Carrega todas as inutilizações (lotes de 500). */
export async function listAllInutilizacoes() {
  const rows = [];
  for (let offset = 0; offset < 20000; offset += LIST_BATCH) {
    const result = await fetchJson(`${API_BASE}?limit=${LIST_BATCH}&offset=${offset}`);
    const batch = Array.isArray(result?.data) ? result.data : [];
    rows.push(...batch);
    if (batch.length < LIST_BATCH) break;
  }
  return rows;
}

export function getInutilizacaoById(id) {
  return fetchJson(`${API_BASE}/${encodeURIComponent(id)}`);
}

export function createInutilizacao(payload) {
  return fetchJson(API_BASE, { method: 'POST', body: JSON.stringify(payload) });
}

export function consultarInutilizacao(id) {
  return fetchJson(`${API_BASE}/${encodeURIComponent(id)}/consultar`);
}
