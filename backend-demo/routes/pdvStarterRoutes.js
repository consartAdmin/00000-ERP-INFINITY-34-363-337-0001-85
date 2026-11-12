/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ pdvStarterRoutes.js — Rotas do caixa Consart Starter (Windows)      ║
   ║ CONSART ERP                                                          ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { Router } from 'express';
import { requirePdvAuth } from '../middleware/requirePdvAuth.js';
import {
  login,
  getConfig,
  getCatalog,
  getCurrentSession,
  openCash,
  createCashMovement,
  getCashSummary,
  closeCash,
  postSale,
  getSales,
  getSaleNfce,
  postSaleNfce,
} from '../controllers/pdvStarterController.js';

const router = Router();

// POST /api/pdv/auth/login  { username, password, terminal }
router.post('/auth/login', login);

// GET /api/pdv/health
router.get('/health', (req, res) => res.json({ success: true, service: 'pdv-starter' }));

router.use(requirePdvAuth);

// GET /api/pdv/config
router.get('/config', getConfig);

// GET /api/pdv/catalogo?limit=2000&offset=0
router.get('/catalogo', getCatalog);

// GET /api/pdv/caixa/atual?terminal=CAIXA-01
router.get('/caixa/atual', getCurrentSession);

// POST /api/pdv/caixa/abrir  { terminal, opening_amount, notes }
router.post('/caixa/abrir', openCash);

// POST /api/pdv/caixa/:id/movimentos  { type: SANGRIA|SUPRIMENTO, amount, reason }
router.post('/caixa/:id/movimentos', createCashMovement);

// GET /api/pdv/caixa/:id/resumo
router.get('/caixa/:id/resumo', getCashSummary);

// POST /api/pdv/caixa/:id/fechar  { counted: { DINHEIRO: 0, ... }, notes }
router.post('/caixa/:id/fechar', closeCash);

// POST /api/pdv/vendas  (idempotente por pdv_uuid)
router.post('/vendas', postSale);

// GET /api/pdv/vendas?session_id=&limit=
router.get('/vendas', getSales);

// GET /api/pdv/vendas/:uuid/nfce  — situação da NFC-e (com QR Code)
router.get('/vendas/:uuid/nfce', getSaleNfce);

// POST /api/pdv/vendas/:uuid/nfce — emite ou consulta de novo a NFC-e da venda
router.post('/vendas/:uuid/nfce', postSaleNfce);

export default router;
