// ╔══════════════════════════════════════════════════════════════════╗
// ║ inboundQuickProductController.js — Notas de Entrada (Inbound)    ║
// ║ POST /api/inbound-invoices/quick-product                         ║
// ║ Cadastra o produto de um item da NF-e que ainda não existe       ║
// ║ CONSART ERP | ESM                                                ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';

import { createQuickProduct } from '../repositories/inboundInvoices/createQuickProduct.repository.js';
import { queueErrorEmail } from '../errorEmailReporter.js';

export async function createQuickProductCtrl(req, res) {
  const body = req.body || {};

  if (!String(body.description ?? '').trim()) {
    return res.status(400).json({ ok: false, error: 'Informe a descrição do produto.' });
  }

  try {
    const data = await createQuickProduct(body);
    return res.status(201).json({ ok: true, data });
  } catch (err) {
    const status = Number(err?.status || err?.statusCode) || 500;

    if (status >= 500) {
      console.error('[INBOUND][QUICK_PRODUCT][ERROR]', err);
      queueErrorEmail('INBOUND_QUICK_PRODUCT_ERROR', {
        module: 'controllers/inboundQuickProductController.js',
        status,
        err: { name: err?.name, message: err?.message, code: err?.code, stack: err?.stack },
      });
    }

    return res.status(status).json({
      ok: false,
      error: status >= 500 ? 'Erro ao cadastrar produto.' : err.message,
      code: err?.code,
      detail: status >= 500 ? err?.message : err?.details,
    });
  }
}

export default createQuickProductCtrl;
