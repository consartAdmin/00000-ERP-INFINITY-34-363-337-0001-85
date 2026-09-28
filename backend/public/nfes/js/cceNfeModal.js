// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cceNfeModal.js — Modal de Carta de Correção Eletrônica (CC-e)       ║
// ║ CONSART ERP — Integrado ao backend POST /api/nfe/cce                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function normalizeErrorMessage(payload) {
  if (!payload) return 'Falha ao enviar CC-e.';
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }
  if (typeof payload.error?.message === 'string' && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  return 'Falha ao enviar CC-e.';
}

function extractSuccessInfo(payload) {
  const saved = payload?.data?.saved || null;
  const status = payload?.data?.status || null;
  const statusData = status?.data || status || {};
  const protocolo =
    saved?.protocolo ||
    statusData?.protocolo ||
    statusData?.nProt ||
    statusData?.numeroProtocolo ||
    null;

  const sequencia =
    saved?.numero_sequencia ||
    statusData?.numeroSequencia ||
    statusData?.sequencia ||
    statusData?.seqEvento ||
    null;

  return { protocolo, sequencia };
}

export function openCceNfeModal({
  orderId,
  nfeNumber,
  nfeKey,
  status,
  route = '/api/nfe/cce',
  createdBy = null,
}) {
  if (!route) return;

  const existing = document.querySelector('.nfes-cce-modal-layer');
  if (existing) existing.remove();

  const safeOrderId = escapeHtml(orderId ?? '—');
  const safeNfeNumber = escapeHtml(nfeNumber ?? '—');
  const safeNfeKey = escapeHtml(nfeKey ?? '—');
  const safeStatus = escapeHtml(status ?? '—');

  const layer = document.createElement('div');
  layer.className = 'nfes-cce-modal-layer';
  layer.innerHTML = `
    <div class="nfes-cce-modal-backdrop"></div>
    <div class="nfes-cce-modal-card" role="dialog" aria-modal="true" aria-labelledby="nfesCceModalTitle">
      <header class="nfes-cce-modal-header">
        <h2 id="nfesCceModalTitle">Enviar Carta de Correção (CC-e)</h2>
        <button class="nfes-cce-modal-close" type="button" aria-label="Fechar">✕</button>
      </header>

      <section class="nfes-cce-modal-body">
        <p class="nfes-cce-modal-info">
          <strong>Pedido:</strong> ${safeOrderId}<br>
          <strong>Nº NF-e:</strong> ${safeNfeNumber}<br>
          <strong>Chave:</strong> ${safeNfeKey}<br>
          <strong>Status atual:</strong> ${safeStatus}
        </p>

        <label class="nfes-cce-modal-label" for="nfesCceTexto">
          Texto da correção
        </label>

        <textarea
          id="nfesCceTexto"
          rows="6"
          placeholder="Descreva a correção conforme regras da SEFAZ..."
          maxlength="1000"
        ></textarea>

        <div class="nfes-cce-modal-counter">
          <span id="nfesCceCounter">0</span>/1000
        </div>

        <p class="nfes-cce-modal-alert">
          ⚠ A CC-e não pode alterar valores, impostos, data de emissão, remetente/destinatário ou dados que mudem a tributação da NF-e.
        </p>

        <div class="nfes-cce-modal-message" id="nfesCceMessage" aria-live="polite"></div>
      </section>

      <footer class="nfes-cce-modal-footer">
        <button type="button" class="btn btn-flat" data-act="close">Fechar</button>
        <button type="button" class="btn btn-primary" data-act="confirm">Enviar CC-e</button>
      </footer>
    </div>
  `;

  document.body.appendChild(layer);

  const backdrop = layer.querySelector('.nfes-cce-modal-backdrop');
  const btnClose = layer.querySelector('.nfes-cce-modal-close');
  const btnCloseFooter = layer.querySelector('button[data-act="close"]');
  const btnConfirm = layer.querySelector('button[data-act="confirm"]');
  const txtTexto = layer.querySelector('#nfesCceTexto');
  const msgBox = layer.querySelector('#nfesCceMessage');
  const counter = layer.querySelector('#nfesCceCounter');

  let isSending = false;

  function updateCounter() {
    counter.textContent = String((txtTexto.value || '').length);
  }

  function setMessage(text, type = '') {
    msgBox.textContent = text || '';
    msgBox.className = `nfes-cce-modal-message${type ? ` ${type}` : ''}`;
  }

  function setBusy(busy) {
    isSending = !!busy;
    btnConfirm.disabled = busy;
    btnClose.disabled = busy;
    btnCloseFooter.disabled = busy;
    txtTexto.disabled = busy;

    if (busy) {
      btnConfirm.textContent = 'Enviando...';
    } else {
      btnConfirm.textContent = 'Enviar CC-e';
    }
  }

  function close() {
    if (isSending) return;
    document.removeEventListener('keydown', onKeyDown);
    layer.remove();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') close();
  }

  async function onConfirm() {
    const texto = normalizeText(txtTexto.value);

    if (!texto) {
      setMessage('Informe o texto da carta de correção.', 'error');
      txtTexto.focus();
      return;
    }

    if (texto.length < 15) {
      setMessage('Descreva a correção com mais detalhes.', 'error');
      txtTexto.focus();
      return;
    }

    setBusy(true);
    setMessage('Enviando CC-e...', 'loading');

    try {
      const payload = {
        orderId: Number(orderId) || null,
        nfeKey: normalizeText(nfeKey) || null,
        idOuChave: normalizeText(nfeKey) || null,
        correcao: texto,
        createdBy: normalizeText(createdBy) || null,
      };

      const resp = await fetch(route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const js = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setMessage(normalizeErrorMessage(js), 'error');
        setBusy(false);
        return;
      }

      const info = extractSuccessInfo(js);
      let successMsg = 'CC-e enviada com sucesso.';

      if (info.sequencia || info.protocolo) {
        successMsg += ` ${
          [
            info.sequencia ? `Sequência: ${info.sequencia}` : null,
            info.protocolo ? `Protocolo: ${info.protocolo}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        }`;
      }

      setMessage(successMsg, 'success');

      window.dispatchEvent(new Event('nfes:reload'));

      setTimeout(() => {
        close();
      }, 1200);
    } catch (err) {
      console.error('[NFES] cce modal error:', err);
      setMessage('Erro ao comunicar com o servidor.', 'error');
      setBusy(false);
    }
  }

  backdrop.addEventListener('click', close);
  btnClose.addEventListener('click', close);
  btnCloseFooter.addEventListener('click', close);
  btnConfirm.addEventListener('click', onConfirm);
  txtTexto.addEventListener('input', updateCounter);

  document.addEventListener('keydown', onKeyDown);

  updateCounter();
  txtTexto.focus();
}

const styleId = 'nfes-cce-modal-style';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .nfes-cce-modal-layer {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .nfes-cce-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
    }

    .nfes-cce-modal-card {
      position: relative;
      z-index: 1;
      background: #ffffff;
      border-radius: 14px;
      padding: 18px 18px 16px;
      width: 520px;
      max-width: 95vw;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .nfes-cce-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      gap: 10px;
    }

    .nfes-cce-modal-header h2 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      color: #0f172a;
    }

    .nfes-cce-modal-close {
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 1rem;
      color: #64748b;
      width: 34px;
      height: 34px;
      border-radius: 8px;
    }

    .nfes-cce-modal-close:hover {
      background: #f1f5f9;
    }

    .nfes-cce-modal-body {
      font-size: 0.92rem;
      color: #0f172a;
    }

    .nfes-cce-modal-info {
      margin: 0 0 10px 0;
      line-height: 1.5;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 12px;
    }

    .nfes-cce-modal-label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.88rem;
      font-weight: 600;
      color: #0f172a;
    }

    .nfes-cce-modal-body textarea {
      width: 100%;
      resize: vertical;
      min-height: 130px;
      padding: 10px 12px;
      font-size: 0.92rem;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      outline: none;
      transition: border-color .15s ease, box-shadow .15s ease;
      box-sizing: border-box;
    }

    .nfes-cce-modal-body textarea:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }

    .nfes-cce-modal-body textarea:disabled {
      background: #f8fafc;
      cursor: not-allowed;
    }

    .nfes-cce-modal-counter {
      margin-top: 6px;
      text-align: right;
      font-size: 0.8rem;
      color: #64748b;
    }

    .nfes-cce-modal-alert {
      margin: 10px 0 0 0;
      font-size: 0.82rem;
      line-height: 1.45;
      color: #b45309;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      padding: 9px 10px;
    }

    .nfes-cce-modal-footer {
      padding-top: 10px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .nfes-cce-modal-message {
      margin-top: 10px;
      font-size: 0.87rem;
      line-height: 1.4;
      min-height: 20px;
    }

    .nfes-cce-modal-message.error {
      color: #b91c1c;
    }

    .nfes-cce-modal-message.success {
      color: #166534;
    }

    .nfes-cce-modal-message.loading {
      color: #0f172a;
    }

    .nfes-cce-modal-footer button:disabled,
    .nfes-cce-modal-close:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}