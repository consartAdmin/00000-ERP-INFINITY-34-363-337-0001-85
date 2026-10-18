// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: moduleDocsConsartRoutes.js                             ║
// ║ MODULE: Documentação dos módulos (CONSART ERP)               ║
// ║ BASE: /api/module-docs-consart                               ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  list,
  modules,
  pdf,
  getById,
  save,
  remove,
} from '../controllers/moduleDocsConsartController.js';

const router = Router();

// Montado em /api/module-docs-consart: protege só este módulo
router.use(requireAuth);

router.get('/', list);
router.get('/modules', modules);
router.get('/pdf', pdf);
router.get('/:id', getById);
router.put('/:id', save);
router.delete('/:id', remove);

export default router;
