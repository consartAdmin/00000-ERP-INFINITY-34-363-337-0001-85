// ╔══════════════════════════════════════════════════════════════════════╗
// ║ usoConsumoRoutes.js — Routes Uso e Consumo                          ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';

import {
  list,
  getById,
  finishBudget,
  emitNfe,
  refreshNfeStatus,
  retryNfe,
  printDanfe,
  productInfo,
  create,
  update,
  finish,
  remove,
} from '../controllers/usoConsumoController.js';

const router = Router();

/* =========================================================================
 * 📋 Listagem
 *
 * GET /api/uso-consumo
 * ========================================================================= */

router.get(
  '/',
  list
);

/* =========================================================================
 * 📦 Uso e Consumo direto (sem orçamento)
 *
 * GET    /api/uso-consumo/product-info/:productCode
 * POST   /api/uso-consumo            (rascunho; finish:true baixa o estoque)
 * PUT    /api/uso-consumo/:id        (edita rascunho; finish:true baixa)
 * POST   /api/uso-consumo/:id/finish
 * DELETE /api/uso-consumo/:id        (rascunho, ou estorno sem NF-e válida)
 * ========================================================================= */

router.get('/product-info/:productCode', productInfo);
router.post('/', create);
router.put('/:id', update);
router.post('/:id/finish', finish);
router.delete('/:id', remove);

/* =========================================================================
 * ✅ Finalizar orçamento
 *
 * POST /api/uso-consumo/finish-budget/1064
 * ========================================================================= */

router.post(
  '/finish-budget/:budgetId',
  finishBudget
);

router.post(
  '/:id/nfe/retry',
  retryNfe
);

/* =========================================================================
 * 🧾 Emitir NF-e
 *
 * POST /api/uso-consumo/1/emit-nfe
 * ========================================================================= */

router.post(
  '/:id/emit-nfe',
  emitNfe
);

/* =========================================================================
 * 🔄 Consultar e atualizar status da NF-e
 *
 * GET /api/uso-consumo/1/nfe/status
 * ========================================================================= */

router.get(
  '/:id/nfe/status',
  refreshNfeStatus
);

router.get(
  '/:id/nfe/danfe-consart',
  printDanfe
);

/* =========================================================================
 * 🔎 Buscar registro
 *
 * GET /api/uso-consumo/1
 *
 * A rota dinâmica simples fica por último.
 * ========================================================================= */

router.get(
  '/:id',
  getById
);

export default router;