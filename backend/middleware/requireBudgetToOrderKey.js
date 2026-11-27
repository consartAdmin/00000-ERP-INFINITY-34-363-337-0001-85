// ╔══════════════════════════════════════════════════════════════════════╗
// ║ requireBudgetToOrderKey.js — Middleware chave Orçamento → Pedido     ║
// ║ CONSART ERP | ESM                                                   ║
// ║ - Protege POST /api/budgets/:id/to-order                             ║
// ║ - Senha em Senhas de Módulos (public."modulePasswords"),             ║
// ║   módulo BUDGETS / ação TO_ORDER. Inativa ou sem senha → não pede.   ║
// ║ - A linha nasce com a senha do BUDGET_TO_ORDER_KEY (.env);           ║
// ║   sem linha na tabela → usa BUDGET_TO_ORDER_KEY direto               ║
// ║ - Header: x-budget-to-order-key  (preferido)                         ║
// ║ - Body:   { key } (fallback)                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { verifyModulePassword } from '../repositories/modulePasswords/modulePasswords.index.js';

export async function requireBudgetToOrderKey(req, res, next) {
  try {
    const provided =
      String(req.headers['x-budget-to-order-key'] ?? '').trim() ||
      String(req.body?.key ?? '').trim();

    const allowed = await verifyModulePassword('BUDGETS', 'TO_ORDER', provided, {
      fallback: process.env.BUDGET_TO_ORDER_KEY,
    });

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: provided ? 'INVALID_KEY' : 'KEY_REQUIRED',
        message: 'Senha obrigatória para transformar orçamento em pedido.',
      });
    }

    return next();
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'KEY_MIDDLEWARE_FAILED',
      message: String(err?.message || err || 'Erro'),
    });
  }
}
