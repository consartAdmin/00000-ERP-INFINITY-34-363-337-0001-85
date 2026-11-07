/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.state.js                                              ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

export const state = {
    allRows: [],          // eventos vindos da API (com status_key/status_label)
    filteredRows: [],     // após busca/status + ordenação
    page: 1,
    pageSize: 50,
    sortColumn: 'created_at',
    sortDirection: 'desc',
    loading: false,
    selectedEvent: null,
    nfesEmitidas: [],
    lastStatusIdentifier: '',
};
