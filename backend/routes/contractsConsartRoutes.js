// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: contractsConsartRoutes.js                                      ║
// ║ MODULE: Contratos de Serviços (CONSART ERP)                          ║
// ║ BASE: /api/contracts-consart                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  list,
  template,
  getById,
  create,
  fromProposal,
  update,
  remove,
  duplicate,
  pdf,
} from '../controllers/contractsConsartController.js';

const router = Router();

// Montado em /api/contracts-consart: protege só este módulo
router.use(requireAuth);

router.get('/', list);
router.get('/template', template);
router.get('/:id/pdf', pdf);
router.get('/:id', getById);
router.post('/', create);
router.post('/from-proposal/:proposalId', fromProposal);
router.post('/:id/duplicate', duplicate);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
