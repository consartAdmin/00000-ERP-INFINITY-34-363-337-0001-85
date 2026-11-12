// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissionsRoutes.js — Routes | CONSART ERP (ESM)               ║
// ║ Base: app.use('/api/price-commissions', router)                      ║
// ║ Path: /backend/routes/priceCommissionsRoutes.js                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import {
  initPriceCommissionsController,
  listPriceCommissions,
  getPriceCommissionById,
  createPriceCommission,
  updatePriceCommission,
  deletePriceCommission,
  listPrices,
  listSellers,
  exportPriceCommissions,
} from '../controllers/priceCommissionsController.js';

const router = Router();

await initPriceCommissionsController?.();

// combos
router.get('/prices', listPrices);
router.get('/sellers', listSellers);

// relatórios (antes de /:id)
router.get('/export', exportPriceCommissions);

// crud
router.get('/', listPriceCommissions);
router.get('/:id', getPriceCommissionById);
router.post('/', createPriceCommission);
router.put('/:id', updatePriceCommission);
router.delete('/:id', deletePriceCommission);

export default router;
