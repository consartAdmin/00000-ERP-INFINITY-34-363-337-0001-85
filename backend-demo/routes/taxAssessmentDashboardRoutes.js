// ╔══════════════════════════════════════════════════════════════════════╗
// ║ taxAssessmentDashboardRoutes.js — Apuração (débito × crédito)       ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';

import { requireAuth } from '../middleware/authMiddleware.js';
import {
    getTaxAssessmentDashboard,
    exportTaxAssessment,
    getTaxAssessmentHistory,
} from '../controllers/taxAssessmentDashboardController.js';

const router = Router();

// GET /api/dashboard/tax-assessment?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/', requireAuth, getTaxAssessmentDashboard);

// GET /api/dashboard/tax-assessment/export?format=xlsx|pdf&startDate=...&endDate=...
router.get('/export', requireAuth, exportTaxAssessment);

// GET /api/dashboard/tax-assessment/history?endDate=YYYY-MM-DD&months=6
router.get('/history', requireAuth, getTaxAssessmentHistory);

export default router;
