// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: salesGoalsConsartRoutes.js                                     ║
// ║ MODULE: Metas de vendas (CONSART ERP)                                ║
// ║ BASE: /api/sales-goals-consart                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { getMonth, saveMonth, listSales } from '../controllers/salesGoalsConsartController.js';

const router = Router();

// Montado em /api/sales-goals-consart: protege só este módulo
router.use(requireAuth);

router.get('/', getMonth);              // ?year=2026&month=10[&seller_id=]
router.get('/sales', listSales);        // ?year=2026&month=10[&seller_id=]
router.put('/:year/:month', saveMonth); // body: { goals: [...] }

export default router;
