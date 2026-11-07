// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.config.js — Configuração do módulo              ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const API_BASE = '/api/nfes/inutilizar';

/** A API devolve no máximo 500 por chamada: carregamos em lotes e filtramos na tela. */
export const LIST_BATCH = 500;

export const RULES = Object.freeze({
  CNPJ_LENGTH: 14,
  MIN_YEAR: 2000,
  MIN_JUSTIFICATION: 15,
  MAX_JUSTIFICATION: 255,
});

export const MODEL_LABELS = Object.freeze({ 55: 'NF-e', 65: 'NFC-e' });
