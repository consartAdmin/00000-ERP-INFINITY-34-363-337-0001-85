// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/routes/meRoutes.js — Rotas “Me” (ESM) — CONSART ERP          ║
// ║ ✅ GET /api/me/seller (requerAuth)                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { getMySeller } from '../controllers/meController.js';

const router = Router();

router.get('/api/me/seller', requireAuth, getMySeller);

export default router;