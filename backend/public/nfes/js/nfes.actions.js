// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfes.actions.js                                                ║
// ║ MODULE: NF-es Actions                                                ║
// ║ CONSART ERP                                                          ║
// ║ Ações isoladas do grid                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { ROUTES } from './nfes.config.js';
import { fetchNfes } from './nfes.init.js';

export async function refreshRow(orderId, btn) {
  if (!orderId) return;

  try {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳';

    const r = await fetch(ROUTES.reconcile(orderId), {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    await r.json().catch(() => ({}));
    await fetchNfes();

    btn.textContent = original;
  } catch (err) {
    console.error('[NFES] reconcile EXC:', err);
  } finally {
    btn.disabled = false;
  }
}