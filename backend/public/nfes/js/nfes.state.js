// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.state.js                                                  ║
// ║ MODULE: NF-es Front State                                            ║
// ║ CONSART ERP                                                          ║
// ║ Estado central compartilhado do módulo                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const state = {
  list: [],
  total: 0,
  page: 1,
  limit: 20,
  q: '',
  status: '',
  dataIni: '',
  dataFim: '',
  sortBy: 'pedido',
  sortOrder: 'desc',
};