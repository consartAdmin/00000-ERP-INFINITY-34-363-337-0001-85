// ╔══════════════════════════════════════════════════════════════════════╗
// ║ reportsProductsStock.dom.js — DOM helpers                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

export const qs = (s, el = document) => el.querySelector(s);
export const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

export function getEls() {
  return {
    txtBusca: qs('#txtBusca'),
    btnBuscar: qs('#btnBuscar'),
    btnLimpar: qs('#btnLimpar'),
    btnPdf: qs('#btnPdf'),
    btnExcel: qs('#btnExcel'),

    // Modal de filtros
    btnFiltros: qs('#btnFiltros'),
    filtersBadge: qs('#filtersBadge'),
    btnFiltrosLimpar: qs('#btnFiltrosLimpar'),
    btnFiltrosAplicar: qs('#btnFiltrosAplicar'),

    txtFornecedor: qs('#txtFornecedor'),
    dlFornecedores: qs('#dlFornecedores'),
    hidFornecedorId: qs('#hidFornecedorId'),

    selGrupo: qs('#selGrupo'),
    selSubgrupo: qs('#selSubgrupo'),
    selMarca: qs('#selMarca'),

    chkOnlyStock: qs('#chkOnlyStock'),
    selAtivo: qs('#selAtivo'),
    numCustoMin: qs('#numCustoMin'),
    numCustoMax: qs('#numCustoMax'),

    statusArea: qs('#statusArea'),
    tableBody: qs('#tableBody'),

    // Rodapé da tabela
    apTableInfo: qs('#apTableInfo'),
    apPageInfo: qs('#apPageInfo'),
    btnPreviousPage: qs('#btnPreviousPage'),
    btnNextPage: qs('#btnNextPage'),
    apRowsPerPage: qs('#apRowsPerPage'),

    // Custo total (registros filtrados) no rodapé
    sumCost: qs('#sumCost'),
  };
}