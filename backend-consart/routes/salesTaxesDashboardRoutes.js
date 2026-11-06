// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesTaxesDashboardRoutes.js — Sales Taxes Dashboard Routes         ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';

import {
    requireAuth,
} from '../middleware/authMiddleware.js';

import {
    getSalesTaxesDashboard,
    getSalesTaxesHistory,
    exportSalesTaxes,
} from '../controllers/salesTaxesDashboardController.js';


const router =
    Router();


// ======================================================================
// SALES TAXES
// ======================================================================
//
// GET /api/dashboard/sales-taxes?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//
// ======================================================================

router.get(
    '/',
    requireAuth,
    getSalesTaxesDashboard
);

// GET /api/dashboard/sales-taxes/history?endDate=YYYY-MM-DD&months=6
router.get('/history', requireAuth, getSalesTaxesHistory);

// GET /api/dashboard/sales-taxes/export?format=xlsx|pdf&startDate=...&endDate=...
router.get('/export', requireAuth, exportSalesTaxes);


export default router;
