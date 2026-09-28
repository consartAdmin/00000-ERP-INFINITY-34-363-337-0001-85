// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cancelarNfeModal.js — Modal de Cancelamento de NF-e                 ║
// ║ Mostra dados da NF-e + motivo, chama rota /nfe/cancelar             ║
// ╚══════════════════════════════════════════════════════════════════════╝

export function openCancelarNfeModal({ orderId, nfeNumber, nfeKey, status, route }) {
  if (!orderId || !route) return;

  // Remove modal anterior, se existir
  const existing = document.querySelector('.nfes-cancel-modal-layer');
  if (existing) existing.remove();

  const layer = document.createElement('div');
  layer.className = 'nfes-cancel-modal-layer';
  layer.innerHTML = `
    <div class="nfes-cancel-modal-backdrop"></div>
    <div class="nfes-cancel-modal-card">
      <header class="nfes-cancel-modal-header">
        <h2>Cancelar NF-e</h2>
        <button class="nfes-cancel-modal-close" type="button" aria-label="Fechar">✕</button>
      </header>

      <section class="nfes-cancel-modal-body">
        <p class="nfes-cancel-modal-info">
          <strong>Pedido:</strong> ${orderId}<br>
          <strong>Nº NF-e:</strong> ${nfeNumber || '—'}<br>
          <strong>Chave:</strong> ${nfeKey || '—'}<br>
          <strong>Status atual:</strong> ${status || '—'}
        </p>

        <label class="nfes-cancel-modal-label">
          Motivo do cancelamento<br>
          <textarea id="nfesCancelMotivo" rows="4" placeholder="Descreva o motivo do cancelamento..."></textarea>
        </label>

        <p class="nfes-cancel-modal-alert">
          ⚠ O cancelamento definitivo dependerá da autorização da SEFAZ.
        </p>

        <div class="nfes-cancel-modal-message" id="nfesCancelMessage"></div>
      </section>

      <footer class="nfes-cancel-modal-footer">
        <button type="button" class="btn btn-flat" data-act="close">Fechar</button>
        <button type="button" class="btn btn-danger" data-act="confirm">Confirmar cancelamento</button>
      </footer>
    </div>
  `;

  document.body.appendChild(layer);

  const backdrop = layer.querySelector('.nfes-cancel-modal-backdrop');
  const btnClose = layer.querySelector('.nfes-cancel-modal-close');
  const btns = layer.querySelectorAll('button[data-act]');
  const txtMotivo = layer.querySelector('#nfesCancelMotivo');
  const msgBox = layer.querySelector('#nfesCancelMessage');

  function close() {
    layer.remove();
  }

  backdrop.addEventListener('click', close);
  btnClose.addEventListener('click', close);
  btns.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const act = e.currentTarget.dataset.act;
      if (act === 'close') {
        close();
        return;
      }
      if (act === 'confirm') {
        const motivo = (txtMotivo.value || '').trim();
        if (!motivo) {
          msgBox.textContent = 'Informe o motivo do cancelamento.';
          msgBox.className = 'nfes-cancel-modal-message error';
          return;
        }

        msgBox.textContent = 'Enviando cancelamento...';
        msgBox.className = 'nfes-cancel-modal-message loading';

        try {
          const resp = await fetch(route, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ motivo }),
          });

          const js = await resp.json().catch(() => ({}));

          if (!resp.ok) {
            const errMsg = js.error || js.message || 'Falha ao cancelar NF-e.';
            msgBox.textContent = errMsg;
            msgBox.className = 'nfes-cancel-modal-message error';
            return;
          }

          msgBox.textContent = 'Cancelamento enviado com sucesso.';
          msgBox.className = 'nfes-cancel-modal-message success';

          // avisa a tela de NF-e para recarregar
          window.dispatchEvent(new Event('nfes:reload'));

          setTimeout(() => close(), 800);
        } catch (err) {
          console.error('[NFES] cancel modal error:', err);
          msgBox.textContent = 'Erro ao comunicar com o servidor.';
          msgBox.className = 'nfes-cancel-modal-message error';
        }
      }
    });
  });
}

/* Estilos básicos via JS (caso ainda não existam no CSS global) */
const styleId = 'nfes-cancel-modal-style';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .nfes-cancel-modal-layer {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .nfes-cancel-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
    }
    .nfes-cancel-modal-card {
      position: relative;
      z-index: 1;
      background: #ffffff;
      border-radius: 12px;
      padding: 16px 18px;
      width: 420px;
      max-width: 95vw;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .nfes-cancel-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .nfes-cancel-modal-header h2 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 600;
      color: #0f172a;
    }
    .nfes-cancel-modal-close {
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 1rem;
      color: #64748b;
    }
    .nfes-cancel-modal-body {
      font-size: 0.9rem;
      color: #0f172a;
    }
    .nfes-cancel-modal-info {
      margin: 0 0 8px 0;
      line-height: 1.4;
    }
    .nfes-cancel-modal-label textarea {
      width: 100%;
      resize: vertical;
      padding: 6px 8px;
      font-size: 0.9rem;
      border-radius: 6px;
      border: 1px solid #cbd5f1;
      margin-top: 4px;
    }
    .nfes-cancel-modal-alert {
      margin: 6px 0 0 0;
      font-size: 0.8rem;
      color: #b45309;
    }
    .nfes-cancel-modal-footer {
      padding-top: 8px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .nfes-cancel-modal-message {
      margin-top: 6px;
      font-size: 0.85rem;
    }
    .nfes-cancel-modal-message.error { color: #b91c1c; }
    .nfes-cancel-modal-message.success { color: #166534; }
    .nfes-cancel-modal-message.loading { color: #0f172a; }
  `;
  document.head.appendChild(style);
}
