// ╔══════════════════════════════════════════════════════════════════════╗
// ║ supplierReturns.state.js — Estado compartilhado do módulo            ║
// ║ CONSART ERP | Devolução ao Fornecedor                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const state = {
  page: 1,
  limit: 50,
  total: 0,
  q: '',
  status: '',
  importedHeader: null,
  importedItems: [],
};
