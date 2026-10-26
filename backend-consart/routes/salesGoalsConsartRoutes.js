// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: salesGoalsConsartRoutes.js                                     ║
// ║ MODULE: Metas de vendas (CONSART ERP)                                ║
// ║ BASE: /api/sales-goals-consart                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  getMonth, saveMonth, listSales, getHistory, getLeadsByState,
  getStatesMonth, saveStatesMonth, getPerformance,
} from '../controllers/salesGoalsConsartController.js';

const router = Router();

// Montado em /api/sales-goals-consart: protege só este módulo
router.use(requireAuth);

router.get('/', getMonth);              // ?year=2026&month=10[&seller_id=]
router.get('/sales', listSales);        // ?year=2026&month=10[&seller_id=]
router.get('/history', getHistory);     // ?year=2026&month=10[&months=12][&seller_id=]
router.get('/leads-by-state', getLeadsByState); // ?year=2026&month=10[&seller_id=]
router.get('/performance', getPerformance); // funil do CRM + desempenho por vendedor
router.put('/:year/:month', saveMonth); // body: { goals: [...] }

// Plano por estado (UF)
router.get('/states', getStatesMonth);              // ?year=2026&month=10
router.put('/states/:year/:month', saveStatesMonth); // body: { goals: [{ state, ... }] }

export default router;
