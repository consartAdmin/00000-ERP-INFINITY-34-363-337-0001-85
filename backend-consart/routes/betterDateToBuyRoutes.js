// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/routes/betterDateToBuyRoutes.js                            ║
// ║ Melhor Data de Compra | CONSART ERP                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import express from 'express';
import * as controller from '../controllers/betterDateToBuyController.js';

const router = express.Router();

// Rotas fixas antes de "/:id"
router.get('/', controller.list);
router.get('/today-alerts', controller.todayAlerts);
router.get('/suggestions', controller.suggestions);
router.get('/purchase-profile/:customerId', controller.purchaseProfile);
router.post('/bulk', controller.createBulk);

router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.patch('/:id/mark-sent', controller.markSent);
router.patch('/:id/unmark-sent', controller.unmarkSent);
router.patch('/:id/status', controller.setStatus);
router.delete('/:id', controller.remove);

export default router;
