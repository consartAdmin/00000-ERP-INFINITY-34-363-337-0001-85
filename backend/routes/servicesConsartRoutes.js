// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: servicesConsartRoutes.js                               ║
// ║ MODULE: Cadastro de serviços (CONSART ERP)                   ║
// ║ BASE: /api/services-consart                                  ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  list,
  categories,
  getById,
  create,
  update,
  remove,
} from '../controllers/servicesConsartController.js';

const router = Router();

// Montado em /api/services-consart: protege só este módulo
router.use(requireAuth);

router.get('/', list);
router.get('/categories', categories);
router.get('/:id', getById);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
