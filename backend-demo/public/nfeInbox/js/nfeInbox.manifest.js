/* ╔══════════════════════════════════════════════════════════════════╗
 * ║ nfeInbox.manifest.js — Modal de manifestação | CONSART ERP (ESM) ║
 * ║ Ciência, Confirmação, Desconhecimento ou Operação não realizada  ║
 * ║ para a NF selecionada. Usa modals.css + modal.js (padrão global) ║
 * ║ e envia POST /api/nfe-inbox/:id/manifest { operacao, justif. }.  ║
 * ╚══════════════════════════════════════════════════════════════════╝ */
'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import * as api from './nfeInbox.api.js';
import { notify } from './nfeInbox.modal.js';
import { fillManifestPill, formatMoney, getManifestCode, MANIFEST_OPTIONS } from './nfeInbox.utils.js';
import { MANIFEST_REASON_MAX, validateManifest } from './nfeInbox.validation.js';

const MODAL_ID = 'nfi-manifest-modal';
const SEND_LABEL = 'Enviar à SEFAZ';

/** Próximo passo sugerido: sem manifestação → Ciência; com Ciência → Confirmação. */
function suggestedOperation(currentCode) {
  if (!currentCode) return 'CIENCIA';
  if (currentCode === 'CIENCIA') return 'CONFIRMACAO';
  return currentCode in MANIFEST_OPTIONS ? currentCode : 'CIENCIA';
}

export function createManifestModal(dom, { onDone } = {}) {
  let currentId = null;
  let sending = false;

  const setValue = (el, value) => { if (el) el.value = value || '-'; };

  function refreshOperation() {
    const operation = dom.$manifestSelect?.value || '';
    if (dom.$mfHelp) dom.$mfHelp.textContent = MANIFEST_OPTIONS[operation]?.help || '';
    const needsReason = operation === 'NAO_REALIZADA';
    if (dom.$mfReasonWrap) dom.$mfReasonWrap.hidden = !needsReason;
    refreshCount();
  }

  function refreshCount() {
    if (!dom.$mfReasonCount) return;
    const size = (dom.$mfReason?.value || '').trim().length;
    dom.$mfReasonCount.textContent = `${size} / ${MANIFEST_REASON_MAX}`;
  }

  function setSending(value) {
    sending = value;
    if (!dom.$mfConfirm) return;
    dom.$mfConfirm.disabled = value;
    const label = dom.$mfConfirm.querySelector('span');
    if (label) label.textContent = value ? 'Enviando…' : SEND_LABEL;
  }

  function open(id, item = {}) {
    currentId = id;
    setValue(dom.$mfNumero, item.numero);
    setValue(dom.$mfValor, formatMoney(item.valor_total));
    setValue(dom.$mfEmitente, item.emitente_razao || item.emitente_cnpj);
    setValue(dom.$mfChave, item.chave_nfe);
    fillManifestPill(dom.$mfAtual, item.manifestacao);

    if (dom.$manifestSelect) dom.$manifestSelect.value = suggestedOperation(getManifestCode(item.manifestacao));
    if (dom.$mfReason) dom.$mfReason.value = '';
    setSending(false);
    refreshOperation();

    Modal.open(MODAL_ID, { focusSelector: '#nfi-manifest-select' });
  }

  async function confirm() {
    if (sending || !currentId) return;

    const operation = dom.$manifestSelect?.value || '';
    const reason = (dom.$mfReason?.value || '').trim();
    const error = validateManifest(operation, reason);
    if (error) {
      notify(error, 'warning', 'Manifestação');
      return;
    }

    // Desconhecimento e Não realizada recusam a nota: pede uma segunda confirmação.
    if (operation === 'DESCONHECIMENTO' || operation === 'NAO_REALIZADA') {
      const ok = await showCenterModal({
        variant: 'warning',
        title: MANIFEST_OPTIONS[operation].label,
        message: `Enviar à SEFAZ <strong>"${dom.$manifestSelect.selectedOptions[0]?.textContent}"</strong> para esta NF-e?<br><br>`
          + 'Esta manifestação informa à SEFAZ que a empresa <strong>não aceita</strong> a nota.',
        okText: 'Enviar à SEFAZ',
        closeText: 'Voltar',
        timeoutMs: null,
      });
      if (ok !== true) return;
    }

    try {
      setSending(true);
      await api.postManifest(currentId, operation, operation === 'NAO_REALIZADA' ? reason : undefined);
      Modal.close(MODAL_ID);
      notify(`Manifestação "${MANIFEST_OPTIONS[operation].label}" registrada na SEFAZ.`, 'success');
      await onDone?.();
    } catch (sendError) {
      console.error('[nfeInbox] manifest:', sendError);
      notify(sendError.message || 'Erro ao enviar a manifestação.', 'error', 'Manifestação não enviada');
    } finally {
      setSending(false);
    }
  }

  Modal.setup();
  dom.$manifestSelect?.addEventListener('change', refreshOperation);
  dom.$mfReason?.addEventListener('input', refreshCount);
  dom.$mfConfirm?.addEventListener('click', confirm);

  return { open };
}
