// ╔══════════════════════════════════════════════════════════════════════╗
// ║ voiceBudgetsRoutes.js — Orçamento por voz (app CONSART Orçamentos)   ║
// ║ POST /api/voice-budgets/interpret { text, history?, draft? }         ║
// ║   → rascunho do orçamento + resposta falada (conversa)              ║
// ║ Exige login (JWT): cada chamada usa a API paga do Claude.            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { interpretVoiceBudget, VoiceBudgetError } from '../services/voiceBudgetService.js';

const router = Router();

router.post('/interpret', requireAuth, async (req, res) => {
  const started = Date.now();
  try {
    const result = await interpretVoiceBudget({
      text: req.body?.text,
      history: req.body?.history,
      draft: req.body?.draft,
    });
    console.log(
      `[voice-budgets] user=${req.user?.user_id ?? '?'} items=${result.items.length} ` +
      `in=${result.usage.input_tokens} out=${result.usage.output_tokens} ms=${Date.now() - started}`,
    );
    return res.json(result);
  } catch (err) {
    if (err instanceof VoiceBudgetError) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    const status = Number(err?.status);
    console.error('[voice-budgets] erro', status || '', err?.message);
    if (status === 429 || status === 529) {
      return res.status(503).json({ ok: false, error: 'Claude ocupado. Tente de novo em instantes.' });
    }
    return res.status(502).json({ ok: false, error: 'Falha ao interpretar o orçamento por voz.' });
  }
});

export default router;
