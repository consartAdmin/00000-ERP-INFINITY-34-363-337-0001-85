// ╔══════════════════════════════════════════════════════════════════════╗
// ║ routes/gradesRoutes.js — Rotas /api/grades                            ║
// ║ CONSART ERP — ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import * as gradesController from '../controllers/gradesController.js';

const router = Router();

router.get('/api/grades', gradesController.list);
// Exportar PDF/Excel (antes de /:id) — ?format=pdf|xlsx&q=&is_active=
router.get('/api/grades/export', gradesController.exportList);
router.get('/api/grades/:id', gradesController.getById);
router.post('/api/grades', gradesController.create);
router.put('/api/grades/:id', gradesController.update);
router.delete('/api/grades/:id', gradesController.remove);

export default router;
