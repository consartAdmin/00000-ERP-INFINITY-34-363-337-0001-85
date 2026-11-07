'use strict';

// Modais no padrão global (modals.css + modal.js): ESC, backdrop e
// [data-modal-close] já são tratados pelo Modal.setup().
import { Modal } from '/public/includes/js/modal.js';
import { dom } from './mobilized.state.js';
import { fillItem } from './mobilized.form.js';

let onItemImageRefresh = () => { };

export function configureModal({ refreshItemImage }) {
  onItemImageRefresh = refreshItemImage || onItemImageRefresh;
  Modal.setup();
}

export function openDetailsModal({ focusTitle = false } = {}) {
  Modal.open(dom.detailsModal, { focusSelector: focusTitle ? '#title' : '.modal__panel' });
}

export function closeDetailsModal() {
  Modal.close(dom.detailsModal);
}

export function openItemModal(row = null, { copy = false } = {}) {
  const data = row && copy ? { ...row, mobilized_item_id: '', serial_number: '' } : row;
  fillItem(data);
  if (dom.itemModalTitle) {
    dom.itemModalTitle.textContent = copy ? 'Duplicar item' : (row ? 'Editar item' : 'Novo item');
  }
  onItemImageRefresh();
  Modal.open(dom.itemModal, { focusSelector: copy ? '#item_serial_number' : '#item_description' });
}

export function closeItemModal() {
  Modal.close(dom.itemModal);
}

export function isDetailsOpen() {
  return Modal.isOpen(dom.detailsModal);
}

export function exposeDetailsApi() {
  window.mobilizedDetailsModal = Object.freeze({ open: openDetailsModal, close: closeDetailsModal, isOpen: isDetailsOpen });
}
