// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.modal.js                                ║
// ║ MODULE: Fiscal Classification — Modal (modals.css + modal.js)      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

// ESC, backdrop e [data-modal-close] já são tratados pelo Modal.setup().
import { Modal } from '/public/includes/js/modal.js';

const MODAL_ID = 'classificationModal';

export function configureModal() {
  Modal.setup();
}

export function openClassificationModal() {
  Modal.open(MODAL_ID, { focusSelector: '#classification_name' });
}

export function closeClassificationModal() {
  Modal.close(MODAL_ID);
}
