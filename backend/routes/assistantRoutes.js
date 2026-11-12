// ╔══════════════════════════════════════════════════════════════════════╗
// ║ assistantRoutes.js — Consart, assistente de IA por voz (app Consart) ║
// ║ POST /api/assistant/chat { text, history? }                          ║
// ║   → { reply, highlights, sources, action? } (consulta; e-mail só     ║
// ║     como rascunho em action)                                         ║
// ║ POST /api/assistant/send-email { customer_id, to, subject, body }    ║
// ║   → envia o e-mail de cobrança que o usuário CONFIRMOU no app        ║
// ║ Exige login (JWT): cada pergunta usa a API paga do Claude e as       ║
// ║ consultas internas usam o mesmo token e a empresa (X-ERP-Company).   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  askAssistant, checkDailyLimit, sendCollectionEmail, AssistantError,
} from '../services/assistantService.js';

const router = Router();

router.post('/chat', requireAuth, async (req, res) => {
  const started = Date.now();
  try {
    checkDailyLimit(req.user?.user_id);
    const result = await askAssistant(
      { text: req.body?.text, history: req.body?.history },
      erpContext(req),
    );
    console.log(
      `[assistant] user=${req.user?.user_id ?? '?'} tools=${result.tools.join(',') || '-'} ` +
      `in=${result.usage.input_tokens} out=${result.usage.output_tokens} ms=${Date.now() - started}`,
    );
    return res.json(result);
  } catch (err) {
    if (err instanceof AssistantError) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    const status = Number(err?.status);
    console.error('[assistant] erro', status || '', err?.message);
    if (status === 429 || status === 529) {
      return res.status(503).json({ ok: false, error: 'A Consart está ocupada. Tente de novo em instantes.' });
    }
    return res.status(502).json({ ok: false, error: 'Falha ao consultar a assistente.' });
  }
});

function erpContext(req) {
  return {
    authorization: req.get('authorization') || (req.get('x-access-token') ? `Bearer ${req.get('x-access-token')}` : ''),
    company: req.get('x-erp-company') || req.query?.company || '',
    userName: req.user?.name,
  };
}

router.post('/send-email', requireAuth, async (req, res) => {
  try {
    const out = await sendCollectionEmail(req.body ?? {}, erpContext(req));
    console.log(`[assistant] email user=${req.user?.user_id ?? '?'} customer=${req.body?.customer_id} to=${out.to}`);
    return res.json(out);
  } catch (err) {
    const status = err instanceof AssistantError ? err.status : 502;
    console.error('[assistant] send-email erro', err?.message);
    return res.status(status).json({ ok: false, error: err?.message || 'Falha ao enviar o e-mail.' });
  }
});

export default router;
