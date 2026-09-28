// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.config.js                                                 ║
// ║ MODULE: NF-es Front Config                                           ║
// ║ CONSART ERP                                                          ║
// ║ Configurações centrais de rotas e API base                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const API_BASE = (window.apiBase || window.API_BASE || window.location.origin).replace(/\/$/, '');

export const ROUTES = Object.freeze({
  nfesSearch: (q, status, limit, offset, dataIni, dataFim, sortBy, sortOrder) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('nfeStatus', status);
    if (dataIni) params.set('dataIni', dataIni);
    if (dataFim) params.set('dataFim', dataFim);
    params.set('includeStarted', '1');
    params.set('limit', limit || 20);
    params.set('offset', offset || 0);
    params.set('sortBy', sortBy || 'pedido');
    params.set('sortOrder', sortOrder || 'desc');
    return `${API_BASE}/api/nfes/search?${params.toString()}`;
  },

  nfesSearchAll: (q, status, dataIni, dataFim, sortBy, sortOrder) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('nfeStatus', status);
    if (dataIni) params.set('dataIni', dataIni);
    if (dataFim) params.set('dataFim', dataFim);
    params.set('includeStarted', '1');
    params.set('limit', '10000');
    params.set('offset', '0');
    params.set('sortBy', sortBy || 'pedido');
    params.set('sortOrder', sortOrder || 'desc');
    return `${API_BASE}/api/nfes/search?${params.toString()}`;
  },

  reconcile: (orderId) => `${API_BASE}/api/nfes/reconcile/${encodeURIComponent(orderId)}`,
  danfePdf: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/danfe`,
  xml: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/xml`,
  cancel: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/cancelar`,
  cce: () => `${API_BASE}/api/nfe/cce`,
  cceStatus: (idOuChaveOuProtocolo) =>
    `${API_BASE}/api/nfe/cce/status/${encodeURIComponent(idOuChaveOuProtocolo)}`,
  cceEventosByOrder: (orderId) =>
    `${API_BASE}/api/nfe/cce/order/${encodeURIComponent(orderId)}`,
  ccePdf: (idOuChave) =>
    `${API_BASE}/api/nfe/cce/pdf/${encodeURIComponent(idOuChave)}`,
  cceXml: (idOuChaveOuProtocolo) =>
    `${API_BASE}/api/nfe/cce/xml/${encodeURIComponent(idOuChaveOuProtocolo)}`,
  details: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/nfe/details`,
  billing: (orderId) => `${API_BASE}/api/orders/${encodeURIComponent(orderId)}/billing`,
  xmlLote: (params) => `${API_BASE}/api/nfes/xml/lote?${params}`,
  inutilizar: `${API_BASE}/api/nfes/inutilizar`,
});