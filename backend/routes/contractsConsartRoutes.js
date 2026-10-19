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
  listRepresentatives,
  createRepresentative,
  updateRepresentative,
  removeRepresentative,
} from '../controllers/contractsConsartController.js';

const router = Router();

// Montado em /api/contracts-consart: protege só este módulo
router.use(requireAuth);

router.get('/', list);
router.get('/template', template);

// Representantes / sócios do cliente
router.get('/customers/:customerId/representatives', listRepresentatives);
router.post('/customers/:customerId/representatives', createRepresentative);
router.put('/representatives/:id', updateRepresentative);
router.delete('/representatives/:id', removeRepresentative);

router.get('/:id/pdf', pdf);
router.get('/:id', getById);
router.post('/', create);
router.post('/from-proposal/:proposalId', fromProposal);
router.post('/:id/duplicate', duplicate);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
