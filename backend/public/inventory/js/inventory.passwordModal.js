// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inventory.passwordModal.js — Password modal                        ║
// ║ CONSART ERP | Inventário                                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

let cancelActiveModal = null;

export function askPasswordModal({
  title = 'Senha requerida',
  subtitle = 'Digite a senha para continuar.',
} = {}) {
  const modal = document.getElementById('passwordModal');
  const titleEl = document.getElementById('passwordModalTitle');
  const subtitleEl = document.getElementById('passwordModalSubtitle');
  const input = document.getElementById('passwordModalInput');
  const errorBox = document.getElementById('passwordModalError');
  const closeButton = document.getElementById('passwordModalClose');
  const cancelButton = document.getElementById('passwordModalCancel');
  const confirmButton = document.getElementById('passwordModalOk');

  if (
    !modal ||
    !input ||
    !closeButton ||
    !cancelButton ||
    !confirmButton
  ) {
    const password = window.prompt(subtitle);

    return Promise.resolve(
      password === null ? null : String(password).trim()
    );
  }

  if (typeof cancelActiveModal === 'function') {
    cancelActiveModal();
  }

  titleEl && (titleEl.textContent = title);
  subtitleEl && (subtitleEl.textContent = subtitle);

  return new Promise((resolve) => {
    let settled = false;

    const clearError = () => {
      if (!errorBox) return;
      errorBox.textContent = '';
      errorBox.style.display = 'none';
    };

    const showError = (message) => {
      if (!errorBox) return;
      errorBox.textContent = message;
      errorBox.style.display = 'block';
    };

    const close = () => {
      modal.classList.remove('is-open', 'open', 'show', 'active');
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');

      modal.style.removeProperty('display');
      modal.style.removeProperty('position');
      modal.style.removeProperty('inset');
      modal.style.removeProperty('align-items');
      modal.style.removeProperty('justify-content');
      modal.style.removeProperty('padding');
      modal.style.removeProperty('background');
      modal.style.removeProperty('z-index');

      document.body.classList.remove('modal-open');
    };

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      closeButton.removeEventListener('click', onCancel);
      cancelButton.removeEventListener('click', onCancel);
      confirmButton.removeEventListener('click', onConfirm);
      modal.removeEventListener('click', onBackdrop);
      input.removeEventListener('input', clearError);
    };

    const finish = (value) => {
      if (settled) return;

      settled = true;
      cleanup();
      close();

      if (cancelActiveModal === onCancel) {
        cancelActiveModal = null;
      }

      resolve(value);
    };

    function onCancel(event) {
      event?.preventDefault();
      event?.stopPropagation();
      finish(null);
    }

    function onConfirm(event) {
      event?.preventDefault();
      event?.stopPropagation();

      const password = String(input.value || '').trim();

      if (!password) {
        showError('Informe a senha para continuar.');
        input.focus();
        return;
      }

      finish(password);
    }

    function onBackdrop(event) {
      if (event.target === modal) {
        onCancel(event);
      }
    }

    function onKeyDown(event) {
      if (modal.hidden) return;

      if (event.key === 'Escape') {
        onCancel(event);
        return;
      }

      if (event.key === 'Enter') {
        onConfirm(event);
      }
    }

    cancelActiveModal = onCancel;

    clearError();
    input.value = '';

    closeButton.addEventListener('click', onCancel);
    cancelButton.addEventListener('click', onCancel);
    confirmButton.addEventListener('click', onConfirm);
    modal.addEventListener('click', onBackdrop);
    input.addEventListener('input', clearError);
    document.addEventListener('keydown', onKeyDown, true);

    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');

    modal.style.display = 'flex';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.padding = '20px';
    modal.style.background = 'rgba(15, 23, 42, 0.55)';
    modal.style.zIndex = '99999';

    document.body.classList.add('modal-open');

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}