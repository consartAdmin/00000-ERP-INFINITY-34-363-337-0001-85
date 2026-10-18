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
  create,
  importMenu,
  softwareList,
  softwareSave,
  softwareRemove,
} from '../controllers/moduleDocsConsartController.js';

const router = Router();

// Montado em /api/module-docs-consart: protege só este módulo
router.use(requireAuth);

router.get('/', list);
router.get('/modules', modules);
router.get('/pdf', pdf);
router.get('/software', softwareList);
router.post('/software', softwareSave);
router.put('/software/:id', softwareSave);
router.delete('/software/:id', softwareRemove);
router.post('/', create);
router.post('/import', importMenu);
router.get('/:id', getById);
router.put('/:id', save);
router.delete('/:id', remove);

export default router;
