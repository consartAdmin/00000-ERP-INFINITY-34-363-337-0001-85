/* ╔══════════════════════════════════════════════════════════════════════╗
 * ║ nfesModalSend.js — Modal Enviar NF-e por E-mail (CONSART ERP)        ║
 * ║ Path: backend/public/nfes/nfesModalSend.js                           ║
 * ║ Export: openNfeSendEmailModal(options)                               ║
 * ║ ✅ Stack robusto (multi-modais)                                      ║
 * ║ ✅ ESC fecha / click no X                                            ║
 * ║ ✅ Validação + POST /api/nfes/:id/email                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

const STACK_KEY = '__consartNfesMailModalStack__';

function getStack(){
  if (!window[STACK_KEY]) window[STACK_KEY] = [];
  return window[STACK_KEY];
}

function escHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;',
  }[m]));
}

function normalizeApiBase(apiBase){
  const base = String(apiBase || window.apiBase || window.API_BASE || window.location.origin || '').trim();
  return base.replace(/\/$/, '');
}

function splitEmails(str){
  const raw = String(str || '').trim();
  if (!raw) return [];
  return raw
    .split(/[;, \n\r\t]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function isValidEmail(email){
  // suficiente para UI; backend valida de verdade
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function buildModalHtml(){
  return `
    <div class="consart-modal nfes-mail" role="dialog" aria-modal="true" aria-labelledby="nfesMailTitle">
      <header class="nfes-mail__header">
        <div>
          <h3 id="nfesMailTitle" class="nfes-mail__title">✉️ Enviar NF-e por E-mail</h3>
          <div class="nfes-mail__subtitle">Anexos: DANFE (PDF) + XML</div>
        </div>

        <button class="btn btn-flat btn-sm nfes-mail__close" data-close="1" title="Fechar">✖</button>
      </header>

      <div class="nfes-mail__body">
        <div class="nfes-mail__grid">
          <label class="nfes-mail__field">
            <span class="nfes-mail__label">Para (to) *</span>
            <input id="nfesMailTo" class="nfes-mail__input" type="email" placeholder="cliente@dominio.com" />
            <small class="nfes-mail__hint">Você pode informar 1 e-mail.</small>
          </label>

          <label class="nfes-mail__field">
            <span class="nfes-mail__label">Assunto</span>
            <input id="nfesMailSubject" class="nfes-mail__input" type="text" placeholder="NF-e ... (AUTORIZADA) — chave" />
          </label>

          <label class="nfes-mail__field">
            <span class="nfes-mail__label">CC</span>
            <input id="nfesMailCc" class="nfes-mail__input" type="text" placeholder="email1@dominio.com; email2@dominio.com" />
          </label>

          <label class="nfes-mail__field">
            <span class="nfes-mail__label">BCC</span>
            <input id="nfesMailBcc" class="nfes-mail__input" type="text" placeholder="email@dominio.com; ..." />
          </label>
        </div>

        <label class="nfes-mail__field" style="margin-top:10px;">
          <span class="nfes-mail__label">Mensagem</span>
          <textarea id="nfesMailMessage" class="nfes-mail__textarea" rows="5" placeholder="Escreva uma mensagem opcional..."></textarea>
        </label>

        <div id="nfesMailError" class="nfes-mail__error"></div>

        <div class="nfes-mail__footer">
          <div class="nfes-mail__meta" id="nfesMailMeta"></div>

          <div class="nfes-mail__actions">
            <button class="btn btn-flat" id="nfesMailCancel">Cancelar</button>
            <button class="btn btn-primary" id="nfesMailSend">📨 Enviar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Abre o modal de envio.
 * @param {Object} options
 * @param {string} [options.apiBase]
 * @param {string|number} options.orderId
 * @param {string} [options.nfeNumber]
 * @param {string} [options.nfeKey]
 * @param {string} [options.status]
 * @param {string} [options.customerName]
 * @param {string} [options.customerDoc]
 * @param {string} [options.defaultTo]  // e-mail inicial
 * @returns {Promise<{ok:boolean, emailId?:string, message?:string}>}
 */
export function openNfeSendEmailModal(options = {}){
  return new Promise((resolve) => {
    const apiBase = normalizeApiBase(options.apiBase);
    const orderId = String(options.orderId ?? '').trim();

    if (!orderId){
      alert('Pedido/ID inválido para envio.');
      resolve({ ok:false, message:'orderId inválido' });
      return;
    }

    const nfeNumber = String(options.nfeNumber ?? '').trim();
    const nfeKey = String(options.nfeKey ?? '').trim();
    const status = String(options.status ?? '').trim().toUpperCase();
    const customerName = String(options.customerName ?? '').trim();
    const customerDoc = String(options.customerDoc ?? '').trim();

    // Backdrop (overlay)
    const backdrop = document.createElement('div');
    backdrop.className = 'consart-modal-backdrop nfes-mail';
    backdrop.innerHTML = buildModalHtml();

    document.body.appendChild(backdrop);

    const stack = getStack();
    stack.push(backdrop);

    // show
    backdrop.style.display = 'flex';

    const $ = (sel) => backdrop.querySelector(sel);

    const elTo = $('#nfesMailTo');
    const elCc = $('#nfesMailCc');
    const elBcc = $('#nfesMailBcc');
    const elSubject = $('#nfesMailSubject');
    const elMessage = $('#nfesMailMessage');
    const elError = $('#nfesMailError');
    const elMeta = $('#nfesMailMeta');

    function setError(msg){
      if (!elError) return;
      if (!msg){
        elError.style.display = 'none';
        elError.textContent = '';
        return;
      }
      elError.style.display = 'block';
      elError.textContent = msg;
    }

    const safeKey = (nfeKey && nfeKey !== '— —') ? nfeKey : (orderId ? `PEDIDO ${orderId}` : '');
    const st = status || 'NFE';
    const subjectDefault =
      (nfeNumber && nfeNumber !== '— —')
        ? `NF-e ${nfeNumber} (${st}) — ${safeKey}`
        : `NF-e (${st}) — ${safeKey}`;

    if (elTo) elTo.value = String(options.defaultTo || '').trim();
    if (elSubject) elSubject.value = subjectDefault;

    if (elMeta){
      const parts = [];
      parts.push(`Pedido: ${orderId}`);
      if (nfeNumber && nfeNumber !== '— —') parts.push(`NF-e: ${nfeNumber}`);
      if (nfeKey && nfeKey !== '— —') parts.push(`Chave: ${nfeKey}`);
      if (customerName) parts.push(`Cliente: ${customerName}`);
      if (customerDoc) parts.push(`Doc: ${customerDoc}`);
      elMeta.textContent = parts.join(' • ');
    }

    // lock scroll
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    let closed = false;

    function close(result){
      if (closed) return;
      closed = true;

      // pop stack
      const st = getStack();
      const idx = st.lastIndexOf(backdrop);
      if (idx >= 0) st.splice(idx, 1);

      backdrop.remove();
      document.documentElement.style.overflow = prevOverflow;

      resolve(result || { ok:false, message:'closed' });
    }

    // Close handlers
    backdrop.addEventListener('click', (e) => {
      const closeAttr = e.target?.getAttribute?.('data-close');
      if (closeAttr === '1') close({ ok:false, message:'closed' });
    });

    const btnCancel = $('#nfesMailCancel');
    btnCancel?.addEventListener('click', () => close({ ok:false, message:'cancel' }));

    // ESC (somente o topo fecha)
    function onKeyDown(e){
      if (e.key !== 'Escape') return;
      const st = getStack();
      if (st[st.length - 1] !== backdrop) return;
      close({ ok:false, message:'esc' });
    }
    window.addEventListener('keydown', onKeyDown);

    // Focus
    setTimeout(() => elTo?.focus(), 0);

    // Send
    const btnSend = $('#nfesMailSend');

    async function send(){
      setError('');

      const to = String(elTo?.value || '').trim();
      if (!to || !isValidEmail(to)){
        setError('Informe um e-mail válido no campo "Para (to)".');
        elTo?.focus();
        return;
      }

      const ccList = splitEmails(String(elCc?.value || ''));
      const bccList = splitEmails(String(elBcc?.value || ''));

      const invalidCc = ccList.find((x) => !isValidEmail(x));
      if (invalidCc){
        setError(`E-mail inválido em CC: ${invalidCc}`);
        elCc?.focus();
        return;
      }

      const invalidBcc = bccList.find((x) => !isValidEmail(x));
      if (invalidBcc){
        setError(`E-mail inválido em BCC: ${invalidBcc}`);
        elBcc?.focus();
        return;
      }

      const subject = String(elSubject?.value || '').trim();
      const message = String(elMessage?.value || '').trim();

      const url = `${apiBase}/api/nfes/${encodeURIComponent(orderId)}/email`;

      const original = btnSend?.textContent || '📨 Enviar';
      try{
        if (btnSend){
          btnSend.disabled = true;
          btnSend.textContent = '⏳ Enviando...';
        }

        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            to,
            cc: ccList.length ? ccList.join('; ') : undefined,
            bcc: bccList.length ? bccList.join('; ') : undefined,
            subject: subject || undefined,
            message: message || undefined,
          }),
        });

        const text = await r.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = { ok:false, raw:text }; }

        if (!r.ok || json?.ok === false){
          setError(json?.error || json?.message || `Falha ao enviar e-mail (HTTP ${r.status}).`);
          return;
        }

        window.alert(`✅ Enviado com sucesso!\nEmail ID: ${json?.emailId ?? 'OK'}`);
        close({ ok:true, emailId: json?.emailId, message: json?.message || 'ok' });
      } catch (err){
        console.error('[NFES][MAIL] send EXC:', err);
        setError(err?.message || String(err));
      } finally{
        if (btnSend){
          btnSend.disabled = false;
          btnSend.textContent = original;
        }
      }
    }

    btnSend?.addEventListener('click', send);

    // Enter no "to" envia
    elTo?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){
        e.preventDefault();
        send();
      }
    });

    // cleanup listeners if removed unexpectedly
    const obs = new MutationObserver(() => {
      if (!document.body.contains(backdrop)){
        window.removeEventListener('keydown', onKeyDown);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList:true, subtree:true });
  });
}
