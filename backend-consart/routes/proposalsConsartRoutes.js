// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: proposalsConsartRoutes.js                              ║
// ║ MODULE: Propostas comerciais (CONSART ERP)                   ║
// ║ BASE: /api/proposals-consart                                 ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  list,
  getById,
  create,
  update,
  remove,
  duplicate,
  pdf,
} from '../controllers/proposalsConsartController.js';

const router = Router();

// Montado em /api/proposals-consart: protege só este módulo
router.use(requireAuth);

router.get('/', list);
router.get('/:id/pdf', pdf);
router.get('/:id', getById);
router.post('/', create);
router.post('/:id/duplicate', duplicate);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
