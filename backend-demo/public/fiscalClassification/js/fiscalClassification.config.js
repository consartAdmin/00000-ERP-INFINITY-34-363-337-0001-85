// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.config.js                               ║
// ║ MODULE: Fiscal Classification — Configuration                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const ROUTES = Object.freeze({
  fiscalClassifications: '/api/v2/fiscal-classifications',
  fiscalClassificationById: (id) =>
    `/api/v2/fiscal-classifications/${encodeURIComponent(id)}`,
  fiscalClassificationActive: (id) =>
    `/api/v2/fiscal-classifications/${encodeURIComponent(id)}/active`,
  fiscalProfiles: '/api/v2/fiscal-profiles',
});

export const DEFAULT_PAGE_SIZE = 50;

// A API aceita no máximo 500 por chamada; a lista é carregada inteira e
// filtrada/ordenada/paginada na tela (cadastro pequeno).
export const API_PAGE_LIMIT = 500;

// Ano-teste 2026 da Reforma Tributária (LC 214/2025): IBS 0,1% (UF) e CBS 0,9%.
export const RATES_2026 = Object.freeze({
  ibs_uf_rate: 0.1,
  ibs_municipal_rate: 0,
  cbs_rate: 0.9,
});
