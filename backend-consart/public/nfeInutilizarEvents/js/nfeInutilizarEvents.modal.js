// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.modal.js — Modais (modals.css + modal.js)       ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ESC, backdrop e [data-modal-close] já são tratados pelo Modal.setup().
import { Modal } from '/public/includes/js/modal.js';

export const NEW_MODAL_ID = 'novaInutilizacaoModal';
export const DETAILS_MODAL_ID = 'detalhesModal';

export function configureModals() {
  Modal.setup();
}

export const openNewModal = () => Modal.open(NEW_MODAL_ID, { focusSelector: '#companyCnpj' });
export const closeNewModal = () => Modal.close(NEW_MODAL_ID);
export const openDetailsModal = () => Modal.open(DETAILS_MODAL_ID);
export const closeDetailsModal = () => Modal.close(DETAILS_MODAL_ID);
