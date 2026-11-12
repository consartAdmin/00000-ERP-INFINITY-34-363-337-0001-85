// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: proposalsServicesConsartRoutes.js                              ║
// ║ MODULE: Propostas de Serviços (CONSART ERP)                          ║
// ║ BASE: /api/proposals-services-consart                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

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
} from '../controllers/proposalsServicesConsartController.js';

const router = Router();

// Montado em /api/proposals-services-consart: protege só este módulo
router.use(requireAuth);

router.get('/', list);
router.get('/:id/pdf', pdf);
router.get('/:id', getById);
router.post('/', create);
router.post('/:id/duplicate', duplicate);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
