// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.config.js                                        ║
// ║ MODULE: Fiscal Profile — Configuration                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const ROUTES = Object.freeze({
  fiscalProfiles: '/api/v2/fiscal-profiles',
  fiscalProfileById: (id) => `/api/v2/fiscal-profiles/${encodeURIComponent(id)}`,
  fiscalProfileActive: (id) => `/api/v2/fiscal-profiles/${encodeURIComponent(id)}/active`,
});

export const DEFAULT_PAGE_SIZE = 50;

// A API aceita no máximo 500 por chamada; a lista é carregada inteira e
// filtrada/ordenada/paginada na tela (cadastro pequeno).
export const API_PAGE_LIMIT = 500;

/** Origem da mercadoria (tabela A do CST ICMS). */
export const ORIGINS = Object.freeze({
  0: 'Nacional',
  1: 'Estrangeira, importação direta',
  2: 'Estrangeira, mercado interno',
  3: 'Nacional, importação 40–70%',
  4: 'Nacional, PPB',
  5: 'Nacional, importação ≤ 40%',
  6: 'Estrangeira direta, sem similar',
  7: 'Estrangeira interna, sem similar',
  8: 'Nacional, importação > 70%',
});
