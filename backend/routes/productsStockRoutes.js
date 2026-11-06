// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 🏬 productsStockRoutes.js — Rotas Express                              ║
// ║ Base: /api/productsStock                                                ║
// ║ CONSART ERP | ESM                                                       ║
// ║ ✅ CRUD Estoque Min./Máx.                                               ║
// ║ ✅ Busca por product_code / SKU                                         ║
// ║ ✅ Compatibilidade com /by-code                                         ║
// ║ ✅ PDF Sugestão de Compra                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';

import ctrl from '../controllers/productsStockController.js';
import replenishment from '../controllers/productsStockReplenishmentController.js';

const router = Router();

/* ========================================================================
   Infra
======================================================================== */

router.post('/ensure', ctrl.ensure);

/* ========================================================================
   Relatórios
======================================================================== */

// Sugestão de compra agrupada por fabricante (ponto de pedido + pedido mínimo)
router.get(
    '/purchase-suggestion/pdf',
    replenishment.purchaseSuggestionPdf,
);

/* ========================================================================
   Reposição (mínimo, máximo, prazo do fabricante, pedido mínimo)
======================================================================== */

router.get('/replenishment', replenishment.list);
router.get('/replenishment/export', replenishment.exportExcel);
router.get('/replenishment/pdf', replenishment.purchaseSuggestionPdf);
router.get('/replenishment/settings', replenishment.getSettings);
router.put('/replenishment/settings', replenishment.saveSettings);
router.get('/replenishment/orders', replenishment.orders);
router.get('/replenishment/dashboard', replenishment.dashboard);
router.get('/replenishment/product/:productId(\\d+)', replenishment.getProduct);
router.get('/replenishment/product/:productId(\\d+)/movements', replenishment.productMovements);
router.put('/replenishment/params', replenishment.saveParams);

/* ========================================================================
   Filtros
======================================================================== */

router.get(
    '/filter-options',
    ctrl.filterOptions,
);

/* ========================================================================
   Estoque por SKU / product_code

   Endpoint principal:
   GET /api/productsStock/by-product-code/00004941

   Compatibilidade:
   GET /api/productsStock/by-code?product_code=00004941
======================================================================== */

router.get(
    '/by-product-code/:product_code',
    ctrl.getByCode,
);

router.get(
    '/by-code',
    ctrl.getByCode,
);

/* ========================================================================
   Listagem
======================================================================== */

router.get('/', ctrl.list);

/* ========================================================================
   CRUD
======================================================================== */

router.post('/', ctrl.create);

router.get(
    '/:id(\\d+)',
    ctrl.get,
);

router.put(
    '/:id(\\d+)',
    ctrl.update,
);

router.patch(
    '/:id(\\d+)/adjust',
    ctrl.adjust,
);

router.delete(
    '/:id(\\d+)',
    ctrl.remove,
);

export default router;