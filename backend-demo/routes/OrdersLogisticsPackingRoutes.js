// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ OrdersLogisticsPackingRoutes.js — Montar Pedido para Despacho           ║
// ║ Path: backend/routes/OrdersLogisticsPackingRoutes.js                    ║
// ║ CONSART ERP | ESM | Express                                             ║
// ║ server.js: app.use('/api/packing', ordersLogisticsPackingRoutes);        ║
// ║                                                                          ║
// ║ :source = ORDER (pedido) | BUDGET (orçamento)                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import {
  searchSources,
  getSummary,
  getPackingPdf,
  getPackingLabelsPdf,
  createVolume,
  updateVolume,
  deleteVolume,
  addItemToVolume,
  allocateRemaining,
  updateVolumeItem,
  deleteVolumeItem,
  moveVolumeItem,
} from '../controllers/OrdersLogisticsPackingController.js';

const router = Router();

/* 🔎 Pesquisa de pedidos e orçamentos
   GET /api/packing/search?q=&source=ALL|ORDER|BUDGET&situation=PENDING|ALL */
router.get('/search', searchSources);

/* 📦 Pedido ou orçamento: itens + volumes + totais */
router.get('/sources/:source/:id/summary', getSummary);
router.get('/sources/:source/:id/pdf', getPackingPdf);
router.get('/sources/:source/:id/labels', getPackingLabelsPdf);
router.post('/sources/:source/:id/volumes', createVolume);

/* Compatibilidade (rotas antigas = pedido) */
router.get('/orders/:orderId/summary', getSummary);
router.get('/orders/:orderId/pdf', getPackingPdf);
router.post('/orders/:orderId/volumes', createVolume);

/* ✏️ Volume */
router.patch('/volumes/:volumeId', updateVolume);
router.delete('/volumes/:volumeId', deleteVolume);

/* 📥 Itens no volume */
router.post('/volumes/:volumeId/items', addItemToVolume);
router.post('/volumes/:volumeId/allocate-remaining', allocateRemaining);
router.patch('/volume-items/:volumeItemId', updateVolumeItem);
router.delete('/volume-items/:volumeItemId', deleteVolumeItem);
router.patch('/volume-items/:volumeItemId/move', moveVolumeItem);

export default router;
