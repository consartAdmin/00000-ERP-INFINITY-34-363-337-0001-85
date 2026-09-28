// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ customerSubSegmentsRoutes.js — Express Routes (ESM)                      ║
// ║ Rotas REST para public."customerSubSegments"                             ║
// ║ Base: /api/customer-subsegments                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import express from 'express';
import customerSubSegmentsController from '../controllers/customerSubSegmentsController.js';

const router = express.Router();

const {
  listHandler,
  getByIdHandler,
  createHandler,
  updateHandler,
  removeHandler
} = customerSubSegmentsController;

/* ──────────────────────────────────────────────────────────────
   Montagem das rotas
   (no server.js: app.use('/api/customer-subsegments', router))
────────────────────────────────────────────────────────────── */

// Listagem com filtros/paginação
router.get('/', listHandler);

// Detalhe por ID
router.get('/:id', getByIdHandler);

// Criar subsegmento
router.post('/', createHandler);

// Atualizar subsegmento
router.put('/:id', updateHandler);

// Remover (soft default, hard via ?hard=true)
router.delete('/:id', removeHandler);

export default router;
