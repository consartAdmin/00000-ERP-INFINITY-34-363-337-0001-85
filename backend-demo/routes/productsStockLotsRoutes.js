// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsStockLotsRoutes.js — Routes (CONSART ERP | ESM)              ║
// ║ Base: /api/productsStockLots                                         ║
// ║ ✅ NOVO: /options (Inventário precisa lotes zerados também)          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import {
  ensure,
  list,
  fefo,
  getById,
  createOrAdd,
  update,
  remove,
  reserve,
  unreserve,
  consume,
  listAvailableByProduct,
  available,
  options,            // ✅ NEW
  listByProductCode,  // ✅ manter
} from '../controllers/productsStockLotsController.js';
import panelController from '../controllers/productsStockLotsPanelController.js';

const router = Router();

// ensure table (rodar uma vez ou no startup do server)
router.post('/ensure', ensure);

// ✅ AVAILABLE (o seu test chama esse endpoint)
// - Query: /available?product_stock_id=641
// - Param opcional: /available/641
router.get('/available', available);
router.get('/available/:product_stock_id', available);

// ✅ OPTIONS (Inventário usa esse endpoint)
// - Query: /options?product_stock_id=641
// - Param opcional: /options/641
router.get('/options', options);
router.get('/options/:product_stock_id', options);

// ✅ Painel de lotes e validades (tela Estoque por Lote)
router.get('/dashboard', panelController.dashboard);
router.get('/panel', panelController.panel);
router.get('/panel/export', panelController.exportPanel);
router.get('/product-lookup', panelController.productLookup);
router.get('/alert-settings', panelController.getAlertSettings);
router.put('/alert-settings', panelController.saveAlertSettings);
router.get('/:id/panel', panelController.lotPanel);
router.get('/:id/kardex', panelController.kardex);
router.put('/:id/extras', panelController.saveExtras);
router.post('/:id/block', panelController.block);
router.post('/:id/unblock', panelController.unblock);
router.post('/:id/move', panelController.move);

// list lots (query: product_stock_id, q, onlyAvailable, page, limit, orderBy, dir)
router.get('/', list);

// FEFO list (lotes disponíveis por validade)
router.get('/fefo/:product_stock_id', fefo);

// Legacy helpers
router.get('/by-product/:product_stock_id', listAvailableByProduct);
router.get('/by-product-code/:product_code', listByProductCode);

// CRUD
router.get('/:id', getById);
router.post('/', createOrAdd);
router.put('/:id', update);
router.delete('/:id', remove);

// reserva / desreserva / baixa (para orçamento/pedido)
router.post('/:id/reserve', reserve);
router.post('/:id/unreserve', unreserve);
router.post('/:id/consume', consume);

export default router;