// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.init.js                                                   ║
// ║ MODULE: NF-es Init                                                   ║
// ║ CONSART ERP                                                          ║
// ║ Bootstrap, binds e carregamento                                      ║
// ║ ✅ Paginação integrada ao padrão do table-footer                     ║
// ║ ✅ Exportação Excel/CSV integrada                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { ROUTES } from './nfes.config.js';
import { state } from './nfes.state.js';
import {
    $,
    sortListLocally,
    updateSortIndicators,
} from './nfes.utils.js';

import {
    applyFiltersFromUI,
    exportarRelatorioNfesCsv,
} from './nfes.filters.js';

import { renderNfes } from './nfes.render.js';

/* ===================================================================== */
/* HELPERS                                                                */
/* ===================================================================== */

/**
 * Retorna a quantidade total de páginas.
 */
function getTotalPages() {
    const total = Number(state.total) || 0;
    const limit = Number(state.limit) || 20;

    return Math.max(1, Math.ceil(total / limit));
}

/**
 * Sincroniza o limite do estado com o seletor do rodapé.
 */
function syncPageSizeFromUI() {
    const rowsPerPage = $('#apRowsPerPage');

    if (!rowsPerPage) return;

    const limit = Number(rowsPerPage.value);

    if (Number.isFinite(limit) && limit > 0) {
        state.limit = limit;
    } else {
        state.limit = 20;
        rowsPerPage.value = '20';
    }
}

/* ===================================================================== */
/* BINDS UI                                                               */
/* ===================================================================== */

export function bindUI() {
    /* ================================================================= */
    /* 🔎 BUSCAR                                                        */
    /* ================================================================= */

    $('#btnBuscarNfes')?.addEventListener('click', () => {
        applyFiltersFromUI();
        syncPageSizeFromUI();

        state.page = 1;

        fetchNfes();
    });

    $('#qNfes')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;

        event.preventDefault();

        applyFiltersFromUI();
        syncPageSizeFromUI();

        state.page = 1;

        fetchNfes();
    });

    /* ================================================================= */
    /* 📅 DATAS                                                         */
    /* ================================================================= */

    $('#dataIniNfes')?.addEventListener('change', () => {
        state.dataIni = $('#dataIniNfes')?.value || '';
        state.page = 1;
    });

    $('#dataFimNfes')?.addEventListener('change', () => {
        state.dataFim = $('#dataFimNfes')?.value || '';
        state.page = 1;
    });

    /* ================================================================= */
    /* 📊 QUANTIDADE DE LINHAS                                          */
    /* ================================================================= */

    $('#apRowsPerPage')?.addEventListener('change', (event) => {
        const selectedLimit = Number(event.currentTarget.value);

        state.limit =
            Number.isFinite(selectedLimit) && selectedLimit > 0
                ? selectedLimit
                : 20;

        state.page = 1;

        fetchNfes();
    });

    /* ================================================================= */
    /* 📌 STATUS                                                        */
    /* ================================================================= */

    $('#statusNfe')?.addEventListener('change', () => {
        state.status = $('#statusNfe')?.value || '';
        state.page = 1;

        fetchNfes();
    });

    /* ================================================================= */
    /* 🔀 ORDENAÇÃO PELOS SELECTS                                       */
    /* ================================================================= */

    $('#sortByNfes')?.addEventListener('change', () => {
        state.sortBy = $('#sortByNfes')?.value || 'pedido';
        state.page = 1;

        updateSortIndicators();
        fetchNfes();
    });

    $('#sortOrderNfes')?.addEventListener('change', () => {
        state.sortOrder = $('#sortOrderNfes')?.value || 'desc';
        state.page = 1;

        updateSortIndicators();
        fetchNfes();
    });

    /* ================================================================= */
    /* 🔀 ORDENAÇÃO PELO CABEÇALHO DA TABELA                            */
    /* ================================================================= */

    document
        .querySelectorAll('#tblNfes thead th.sortable-th')
        .forEach((th) => {
            th.addEventListener('click', () => {
                const clickedSort = th.dataset.sort;

                if (!clickedSort) return;

                if (state.sortBy === clickedSort) {
                    state.sortOrder =
                        state.sortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortBy = clickedSort;

                    state.sortOrder =
                        clickedSort === 'cliente' ||
                            clickedSort === 'status' ||
                            clickedSort === 'ambiente'
                            ? 'asc'
                            : 'desc';
                }

                const sortBySelect = $('#sortByNfes');
                const sortOrderSelect = $('#sortOrderNfes');

                if (sortBySelect) {
                    sortBySelect.value = state.sortBy;
                }

                if (sortOrderSelect) {
                    sortOrderSelect.value = state.sortOrder;
                }

                state.page = 1;

                updateSortIndicators();
                fetchNfes();
            });
        });

    /* ================================================================= */
    /* ⬅️ PÁGINA ANTERIOR                                               */
    /* ================================================================= */

    $('#pagAnterior')?.addEventListener('click', () => {
        if (state.page <= 1) return;

        state.page -= 1;

        fetchNfes();
    });

    /* ================================================================= */
    /* ➡️ PRÓXIMA PÁGINA                                                */
    /* ================================================================= */

    $('#pagProxima')?.addEventListener('click', () => {
        const totalPages = getTotalPages();

        if (state.page >= totalPages) return;

        state.page += 1;

        fetchNfes();
    });

    /* ================================================================= */
    /* 🔄 RECARREGAR                                                    */
    /* ================================================================= */

    $('#btnRecarregarNfes')?.addEventListener('click', () => {
        applyFiltersFromUI();
        syncPageSizeFromUI();

        fetchNfes();
    });

    /* ================================================================= */
    /* 📦 XML EM LOTE                                                   */
    /* ================================================================= */

    $('#btnDownloadXmlLote')?.addEventListener('click', () => {
        applyFiltersFromUI();

        const params = new URLSearchParams();

        if (state.q) {
            params.set('q', state.q);
        }

        if (state.status) {
            params.set('nfeStatus', state.status);
        }

        if (state.dataIni) {
            params.set('dataIni', state.dataIni);
        }

        if (state.dataFim) {
            params.set('dataFim', state.dataFim);
        }

        params.set('sortBy', state.sortBy || 'pedido');
        params.set('sortOrder', state.sortOrder || 'desc');

        const url = ROUTES.xmlLote(params.toString());

        console.debug('[NFES] XML LOTE →', url);

        window.open(url, '_blank');
    });

    /* ================================================================= */
    /* 📄 EXPORTAÇÃO PELO BOTÃO DO HTML                                 */
    /* ================================================================= */

    $('#btnExportarRelatorioNfes')?.addEventListener(
        'click',
        async (event) => {
            await exportarRelatorioNfesCsv(event.currentTarget);
        },
    );

    /* ================================================================= */
    /* 📊 EXCEL — COMPATIBILIDADE COM BOTÃO ALTERNATIVO                 */
    /* ================================================================= */

    $('#btnExcel')?.addEventListener('click', () => {
        try {
            applyFiltersFromUI();

            const params = new URLSearchParams();

            if (state.q) {
                params.set('q', state.q);
            }

            if (state.status) {
                params.set('nfeStatus', state.status);
            }

            if (state.dataIni) {
                params.set('dataIni', state.dataIni);
            }

            if (state.dataFim) {
                params.set('dataFim', state.dataFim);
            }

            params.set('sortBy', state.sortBy || 'pedido');
            params.set('sortOrder', state.sortOrder || 'desc');

            const queryString = params.toString();

            const url = ROUTES.nfesReportExcel
                ? ROUTES.nfesReportExcel(queryString)
                : `/api/nfes/report/excel?${queryString}`;

            console.debug('[NFES] EXCEL →', url);

            window.open(url, '_blank');
        } catch (error) {
            console.error('[NFES][EXCEL] erro:', error);
            alert('Erro ao gerar relatório Excel.');
        }
    });

    updateSortIndicators();
}

/* ===================================================================== */
/* FETCH                                                                  */
/* ===================================================================== */

export async function fetchNfes() {
    const limit = Number(state.limit) || 20;
    const page = Math.max(1, Number(state.page) || 1);
    const offset = (page - 1) * limit;

    state.limit = limit;
    state.page = page;

    const url = ROUTES.nfesSearch(
        state.q,
        state.status,
        state.limit,
        offset,
        state.dataIni,
        state.dataFim,
        state.sortBy,
        state.sortOrder,
    );

    console.debug('[NFES] fetch:', url);

    let responseData;

    try {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
            },
        });

        const text = await response.text();

        try {
            responseData = text ? JSON.parse(text) : {};
        } catch (parseError) {
            console.error(
                '[NFES] resposta inválida recebida da API:',
                parseError,
                text,
            );

            responseData = {
                ok: false,
                rows: [],
                total: 0,
                error: 'A API retornou uma resposta inválida.',
            };
        }

        if (!response.ok) {
            console.error(
                '[NFES] HTTP',
                response.status,
                responseData,
            );

            responseData = {
                ok: false,
                rows: [],
                total: 0,
                error:
                    responseData?.error ||
                    `HTTP ${response.status}`,
            };
        }
    } catch (error) {
        console.error('[NFES] erro ao buscar:', error);

        responseData = {
            ok: false,
            rows: [],
            total: 0,
            error: String(error?.message || error),
        };
    }

    const rows = Array.isArray(responseData?.rows)
        ? responseData.rows
        : Array.isArray(responseData?.data)
            ? responseData.data
            : [];

    const total = Number(
        responseData?.total ?? rows.length,
    );

    state.list = sortListLocally(
        rows,
        state.sortBy,
        state.sortOrder,
    );

    state.total =
        Number.isFinite(total) && total >= 0
            ? total
            : rows.length;

    /*
     * Se uma exclusão ou mudança de filtro deixar a página atual acima
     * da última página disponível, volta para a última página válida.
     */
    const totalPages = getTotalPages();

    if (state.page > totalPages) {
        state.page = totalPages;

        return fetchNfes();
    }

    console.debug(
        '[NFES] rows:',
        state.list.length,
        'total:',
        state.total,
        'source:',
        responseData?.source,
        'ok:',
        responseData?.ok,
        'page:',
        state.page,
        'limit:',
        state.limit,
        'sortBy:',
        state.sortBy,
        'sortOrder:',
        state.sortOrder,
    );

    renderNfes();
}

/* ===================================================================== */
/* BOOT                                                                   */
/* ===================================================================== */

export function bootNfes() {
    applyFiltersFromUI();
    syncPageSizeFromUI();

    state.page = Math.max(1, Number(state.page) || 1);

    updateSortIndicators();
    fetchNfes();
}