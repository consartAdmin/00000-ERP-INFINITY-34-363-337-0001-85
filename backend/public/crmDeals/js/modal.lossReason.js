// ╔══════════════════════════════════════════════════════════════════════╗
// ║ modal.lossReason.js — CRM Deals (CONSART ERP)                       ║
// ║ Modal de Queda de Venda                                             ║
// ║                                                                      ║
// ║ ✅ Carrega crmLossReasons no select                                  ║
// ║ ✅ Retorna { loss_reason_id, note }                                  ║
// ║ ✅ Suporta ESC / clique no backdrop / cancelar                       ║
// ║ ✅ Evita bind duplicado                                              ║
// ║ ✅ Compatível com reason_label / reason_name / name                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { dom } from './dom.js';
import { state, setLossReasons } from './state.js';
import { loadLossReasons } from './loaders.js';
import { Modal } from '/public/includes/js/modal.js';

export {
  ensureLossReasonModalBindings,
  openLossReasonModal,
  closeLossReasonModal,
  fillLossReasonsSelect,
};

let lossReasonResolver = null;

/* --------------------------------------------------------------------- */
/* Render select                                                         */
/* --------------------------------------------------------------------- */
function fillLossReasonsSelect(listParam = null) {
  if (!dom.modalLossReasonSelect) return;

  const list = Array.isArray(listParam)
    ? listParam
    : Array.isArray(state.lossReasons)
      ? state.lossReasons
      : [];

  dom.modalLossReasonSelect.innerHTML =
    '<option value="">Selecione o motivo</option>';

  if (!list.length) return;

  list.forEach((item) => {
    if (!item || !item.id) return;

    const option = document.createElement('option');
    option.value = String(item.id);

    const label =
      item.reason_label ||
      item.reason_name ||
      item.reasonName ||
      item.name ||
      `Motivo #${item.id}`;

    option.textContent = String(label).trim();

    dom.modalLossReasonSelect.appendChild(option);
  });
}

/* --------------------------------------------------------------------- */
/* Close                                                                 */
/* --------------------------------------------------------------------- */
function closeLossReasonModal() {
  if (!dom.modalLossReason) return;

  Modal.close(dom.modalLossReason);

  if (dom.modalLossReasonSelect) {
    dom.modalLossReasonSelect.value = '';
  }

  if (dom.modalLossReasonNotes) {
    dom.modalLossReasonNotes.value = '';
  }
}

/* --------------------------------------------------------------------- */
/* Resolve modal promise                                                 */
/* --------------------------------------------------------------------- */
function resolveLossReasonModal(payload) {
  if (typeof lossReasonResolver === 'function') {
    lossReasonResolver(payload);
    lossReasonResolver = null;
  }
}

/* --------------------------------------------------------------------- */
/* Cancel                                                                */
/* --------------------------------------------------------------------- */
function cancelLossReasonModal() {
  closeLossReasonModal();
  resolveLossReasonModal(null);
}

/* --------------------------------------------------------------------- */
/* Confirm                                                               */
/* --------------------------------------------------------------------- */
function confirmLossReasonModal() {
  const lossReasonId = Number(dom.modalLossReasonSelect?.value || '');
  const note = String(dom.modalLossReasonNotes?.value || '').trim();

  if (!Number.isFinite(lossReasonId) || lossReasonId <= 0) {
    alert('Selecione um motivo da perda.');
    dom.modalLossReasonSelect?.focus();
    return;
  }

  // Resolve antes de fechar: o evento modal:close resolve como cancelado
  resolveLossReasonModal({
    loss_reason_id: lossReasonId,
    note: note || null,
  });

  closeLossReasonModal();
}

/* --------------------------------------------------------------------- */
/* Open modal                                                            */
/* --------------------------------------------------------------------- */
async function openLossReasonModal() {
  if (!dom.modalLossReason) return null;

  let list = Array.isArray(state.lossReasons) ? state.lossReasons : [];

  if (!list.length) {
    list = await loadLossReasons();
  }

  if (Array.isArray(list)) {
    setLossReasons(list);
  }

  fillLossReasonsSelect(list);

  Modal.setup();
  Modal.open(dom.modalLossReason, { focusSelector: '#crm-loss-reason-select' });

  if (dom.modalLossReasonSelect) {
    dom.modalLossReasonSelect.value = '';

    setTimeout(() => {
      dom.modalLossReasonSelect?.focus();
    }, 0);
  }

  if (dom.modalLossReasonNotes) {
    dom.modalLossReasonNotes.value = '';
  }

  return new Promise((resolve) => {
    lossReasonResolver = resolve;
  });
}

/* --------------------------------------------------------------------- */
/* Bindings                                                              */
/* --------------------------------------------------------------------- */
function ensureLossReasonModalBindings() {
  /* Fechou pelo X, backdrop ou ESC (modal.js) = cancelar */
  if (
    dom.modalLossReason &&
    dom.modalLossReason.dataset.boundLossReasonModal !== '1'
  ) {
    dom.modalLossReason.dataset.boundLossReasonModal = '1';

    dom.modalLossReason.addEventListener('modal:close', () => {
      resolveLossReasonModal(null);
    });
  }

  /* Confirm */
  if (
    dom.btnLossReasonConfirm &&
    dom.btnLossReasonConfirm.dataset.boundLossReasonConfirm !== '1'
  ) {
    dom.btnLossReasonConfirm.dataset.boundLossReasonConfirm = '1';

    dom.btnLossReasonConfirm.addEventListener(
      'click',
      confirmLossReasonModal
    );
  }

  /* Cancel */
  if (
    dom.btnLossReasonCancel &&
    dom.btnLossReasonCancel.dataset.boundLossReasonCancel !== '1'
  ) {
    dom.btnLossReasonCancel.dataset.boundLossReasonCancel = '1';

    dom.btnLossReasonCancel.addEventListener(
      'click',
      cancelLossReasonModal
    );
  }

}