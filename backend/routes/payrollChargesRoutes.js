// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: payrollChargesRoutes.js                                        ║
// ║ MODULE: Encargos e Rescisões (CONSART ERP)                           ║
// ║ BASE: /api/payroll-charges                                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  options,
  saveSettings,
  saveTaxTable,
  month,
  monthPdf,
  monthExcel,
  employees,
  simulate,
  simulatePdf,
  listTerminations,
  getTermination,
  saveTermination,
  confirmTermination,
  removeTermination,
  terminationPdf,
} from '../controllers/payrollChargesController.js';

const router = Router();

// Montado em /api/payroll-charges: protege só este módulo
router.use(requireAuth);

// Tabelas INSS/IRRF e alíquotas da empresa
router.get('/options', options);
router.put('/settings', saveSettings);
router.put('/tables/:year', saveTaxTable);

// Encargos do mês (?competence=AAAA-MM&department=)
router.get('/month', month);
router.get('/month/pdf', monthPdf);
router.get('/month/excel', monthExcel);

// Rescisão
router.get('/employees', employees);
router.post('/terminations/simulate', simulate);
router.post('/terminations/simulate/pdf', simulatePdf);
router.get('/terminations', listTerminations);
router.post('/terminations', saveTermination);
router.get('/terminations/:id/pdf', terminationPdf);
router.get('/terminations/:id', getTermination);
router.post('/terminations/:id/confirm', confirmTermination);
router.delete('/terminations/:id', removeTermination);

export default router;
