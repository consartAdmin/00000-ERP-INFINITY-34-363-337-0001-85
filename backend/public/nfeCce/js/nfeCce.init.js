/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.init.js                                               ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ║ DESCRIPTION: Ponto de entrada do frontend CC-e                     ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { createSortableTable } from '/public/includes/js/sortableTable.js';
import {
    clearFilters, newCce, newCceFromEvent, onConsultarStatus, onEmitirCce, onRowAction,
    openConsultaDocument, openConsultaStatus, openEventDocument, reloadList,
} from './nfeCce.actions.js';
import { updateCorrecaoCounter } from './nfeCce.form.js';
import { onBuscarNfesEmitidas, onTabelaNfesEmitidasClick, renderNfesEmitidas } from './nfeCce.invoices.js';
import {
    applyFilters, goToNextPage, goToPreviousPage, setPageSize, setRowHandlers, setSort,
} from './nfeCce.list.js';
import { configureModals, openNfeEmitidaModal } from './nfeCce.modal.js';
import { state } from './nfeCce.state.js';
import { $ } from './nfeCce.utils.js';

function onEnter(selector, handler) {
    $(selector)?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); handler(); }
    });
}

function bindEvents() {
    // Lista
    $('#btnNovaCce')?.addEventListener('click', () => newCce());
    $('#btnAbrirConsultaStatus')?.addEventListener('click', openConsultaStatus);
    $('#btnRecarregar')?.addEventListener('click', reloadList);
    $('#btnBuscar')?.addEventListener('click', applyFilters);
    $('#btnLimparFiltros')?.addEventListener('click', clearFilters);
    $('#filtroStatus')?.addEventListener('change', applyFilters);
    ['#busca', '#filtroNfeNumber', '#filtroChave'].forEach((s) => onEnter(s, applyFilters));
    $('#btnPrev')?.addEventListener('click', goToPreviousPage);
    $('#btnNext')?.addEventListener('click', goToNextPage);
    $('#pageSize')?.addEventListener('change', (event) => setPageSize(event.target.value));

    // Nova CC-e + busca de NF-e (modal filho)
    $('#correcao')?.addEventListener('input', updateCorrecaoCounter);
    $('#formNovaCce')?.addEventListener('submit', onEmitirCce);
    $('#btnBuscarNfeEmitida')?.addEventListener('click', () => {
        openNfeEmitidaModal();
        void onBuscarNfesEmitidas();
    });
    $('#btnExecutarBuscaNfeEmitida')?.addEventListener('click', onBuscarNfesEmitidas);
    onEnter('#buscaNfeEmitida', onBuscarNfesEmitidas);
    $('#tbodyNfesEmitidas')?.addEventListener('click', onTabelaNfesEmitidasClick);

    // Detalhes
    $('#btnAbrirPdfEvento')?.addEventListener('click', () => openEventDocument(state.selectedEvent, 'pdf'));
    $('#btnAbrirXmlEvento')?.addEventListener('click', () => openEventDocument(state.selectedEvent, 'xml'));
    $('#btnNovaCceMesmaNfe')?.addEventListener('click', () => newCceFromEvent(state.selectedEvent));

    // Consultar status
    $('#formConsultaStatus')?.addEventListener('submit', onConsultarStatus);
    $('#btnConsultaPdf')?.addEventListener('click', () => openConsultaDocument('pdf'));
    $('#btnConsultaXml')?.addEventListener('click', () => openConsultaDocument('xml'));

    // Ctrl+Enter emite quando a Nova CC-e está aberta
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'Enter' && $('#modalNovaCce')?.classList.contains('is-open')) {
            event.preventDefault();
            void onEmitirCce();
        }
    });
}

async function bootNfeCce() {
    try {
        configureModals();
        setRowHandlers({ onAction: onRowAction });
        bindEvents();
        updateCorrecaoCounter();
        renderNfesEmitidas([]);

        createSortableTable({
            table: '#cceTable',
            defaultColumn: state.sortColumn,
            defaultDirection: state.sortDirection,
            allowedColumns: [
                'numero_sequencia', 'nfe_number', 'customer_name', 'correcao',
                'protocolo', 'status_label', 'created_by', 'created_at',
            ],
            onSort: setSort,
        });

        await reloadList();
    } catch (error) {
        console.error('[nfeCce] Falha na inicialização:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootNfeCce, { once: true });
} else {
    bootNfeCce();
}
