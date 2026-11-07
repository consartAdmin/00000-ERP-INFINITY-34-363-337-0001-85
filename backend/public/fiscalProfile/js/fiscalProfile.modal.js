// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.modal.js                                         ║
// ║ MODULE: Fiscal Profile — Modal (modals.css + modal.js)             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

// ESC, backdrop e [data-modal-close] já são tratados pelo Modal.setup().
import { Modal } from '/public/includes/js/modal.js';

const MODAL_ID = 'profileModal';

export function configureModal() {
  Modal.setup();
}

export function openProfileModal() {
  Modal.open(MODAL_ID, { focusSelector: '#profile_name' });
}

export function closeProfileModal() {
  Modal.close(MODAL_ID);
}
