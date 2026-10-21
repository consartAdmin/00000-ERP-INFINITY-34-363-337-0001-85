// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tmsRoutes.js — Rotas Express (Módulo Transporte / TMS)               ║
// ║ CONSART LOGISTICS | ESM                                             ║
// ║ Base: /api/tms   (requer JWT)                                       ║
// ║                                                                      ║
// ║ Listas      GET  /lookups/:name?q=                                   ║
// ║ CT-e        POST /cte/:id/emit · /cte/:id/cancel · /cte/:id/insure   ║
// ║ MDF-e       POST /mdfe/:id/emit · /mdfe/:id/close · /mdfe/:id/cancel ║
// ║ Impressão   GET  /print/(cte|mdfe)/:id                               ║
// ║ Cotações    POST /quotes/calc · /quotes/:id/to-cte                   ║
// ║ Faturas     GET  /freightInvoices/open-ctes                          ║
// ║             POST /freightInvoices/:id/issue · /pay · /cancel         ║
// ║ EDI         POST /edi/export · /edi/import-notfis                    ║
// ║             GET  /edi/:id/download                                   ║
// ║ Carga       GET  /loadPlans/candidates · PATCH /loadPlans/:id/status ║
// ║ TAC         GET  /contracts/retentions?freight=&dependents=          ║
// ║ Relatórios  GET  /reports/trip-profit · /reports/fleet-alerts        ║
// ║ CRUD        GET/POST /:resource · GET/PUT/DELETE /:resource/:id      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import * as c from '../controllers/tmsController.js';

const router = Router();

router.use(requireAuth);
router.use(c.ensureReady);

// Listas
router.get('/lookups/:name', c.lookup);

// CT-e / MDF-e
router.post('/cte/:id/emit', c.emitCte);
router.post('/cte/:id/cancel', c.cancelCte);
router.post('/cte/:id/insure', c.insureCte);
router.post('/mdfe/:id/emit', c.emitMdfe);
router.post('/mdfe/:id/close', c.closeMdfe);
router.post('/mdfe/:id/cancel', c.cancelMdfe);
router.get('/print/:kind(cte|mdfe)/:id', c.printData);

// Comercial
router.post('/quotes/calc', c.calcQuote);
router.post('/quotes/:id/to-cte', c.quoteToCte);
router.get('/freightInvoices/open-ctes', c.openCtes);
router.post('/freightInvoices/:id/issue', c.issueInvoice);
router.post('/freightInvoices/:id/pay', c.payInvoice);
router.post('/freightInvoices/:id/cancel', c.cancelInvoice);
router.post('/edi/export', c.exportEdi);
router.post('/edi/import-notfis', c.importNotfis);
router.get('/edi/:id/download', c.downloadEdi);

// Operação / Gestão
router.get('/loadPlans/candidates', c.loadCandidates);
router.patch('/loadPlans/:id/status', c.setLoadPlanStatus);
router.get('/contracts/retentions', c.tacRetentions);
router.get('/reports/trip-profit', c.tripProfit);
router.get('/reports/fleet-alerts', c.fleetAlerts);

// CRUD genérico (por último: rotas fixas acima têm prioridade)
router.get('/:resource', c.list);
router.post('/:resource', c.create);
router.get('/:resource/:id', c.getOne);
router.put('/:resource/:id', c.update);
router.delete('/:resource/:id', c.remove);

export default router;
