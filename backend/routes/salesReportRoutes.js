// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesReportRoutes.js — Rotas do Relatório de Vendas (ESM)         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import {
  handleGetSalesReport,
  handleGetSalesReportPdf,
  handleGetSalesReportExcel,
} from '../controllers/salesReportController.js';

const router = Router();

// Montagem esperada no server.js:
// app.use('/api/reports', salesReportRoutes);
router.get('/sales', handleGetSalesReport);
router.get('/sales/pdf', handleGetSalesReportPdf);
router.get('/sales/xlsx', handleGetSalesReportExcel);

export default router;
