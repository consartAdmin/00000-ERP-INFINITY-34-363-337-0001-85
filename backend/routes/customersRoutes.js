// ╔════════════════════════════════════════════════════════════════════╗
/* ║ customersRoutes.js — Rotas Express (ESM)                          ║ */
// ╚════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import controller from '../controllers/customersController.js';

const router = Router();

// Dev/ops helper
router.post('/ensure', controller.ensureTable);

// 🔎 Busca leve (autocomplete/lookup)
router.get('/search', controller.search);

// ✅ RELATÓRIOS (PRECISAM VIR ANTES DO "/:id")
router.get('/report/pdf', controller.reportPdf);
router.get('/report/excel', controller.reportExcel);

// Listagem completa para grids
router.get('/', controller.list);

// This must appear before router.get('/:id', ...)
router.post('/sync-asaas', controller.syncAsaas);

// CRUD
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.updateById);
router.delete('/:id', controller.removeById);

export default router;
