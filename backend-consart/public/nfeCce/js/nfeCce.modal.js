/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: nfeCce.modal.js                                              ║
   ║ MODULE: NF-e | Carta de Correção Eletrônica (CC-e)                 ║
   ║ Modais no padrão CONSART (modals.css + modal.js).                  ║
   ║ ESC, backdrop e [data-modal-close] ficam com o Modal.setup();      ║
   ║ a busca de NF-e abre por cima da Nova CC-e (ESC fecha só ela).     ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { Modal } from '/public/includes/js/modal.js';

export const MODAL_IDS = Object.freeze({
    novaCce: 'modalNovaCce',
    nfeEmitida: 'modalBuscarNfeEmitida',
    detalhes: 'modalDetalhesEvento',
    status: 'modalConsultaStatus',
});

export function configureModals() {
    Modal.setup();
}

export const openNovaCceModal = () => Modal.open(MODAL_IDS.novaCce, { focusSelector: '#correcao' });
export const closeNovaCceModal = () => Modal.close(MODAL_IDS.novaCce);
export const openNfeEmitidaModal = () => Modal.open(MODAL_IDS.nfeEmitida, { focusSelector: '#buscaNfeEmitida' });
export const closeNfeEmitidaModal = () => Modal.close(MODAL_IDS.nfeEmitida);
export const openDetalhesModal = () => Modal.open(MODAL_IDS.detalhes, { focusSelector: '#btnAbrirPdfEvento' });
export const closeDetalhesModal = () => Modal.close(MODAL_IDS.detalhes);
export const openStatusModal = () => Modal.open(MODAL_IDS.status, { focusSelector: '#consultaIdentificador' });
