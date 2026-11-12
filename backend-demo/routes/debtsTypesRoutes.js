/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: debtsTypesRoutes.js                                           ║
   ║ MODULE: Debts Types Routes                                          ║
   ║ DESCRIPTION: GET/POST /api/debts-types (?active=true)               ║
   ║ CONSART ERP · Express · ESM                                         ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { listTypes, createType } from '../controllers/debtsTypesController.js';

const router = Router();

router.get('/debts-types', requireAuth, listTypes);
router.post('/debts-types', requireAuth, createType);

export default router;
