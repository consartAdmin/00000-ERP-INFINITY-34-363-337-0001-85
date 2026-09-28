// ╔══════════════════════════════════════════════════════════════╗
// ║ cloudrunAdminRoutes.js — Rotas internas Cloud Run           ║
// ║ CONSART ERP | Backend (ESM)                                 ║
// ╚══════════════════════════════════════════════════════════════╝

import express from 'express';
import {
  handleTurnOn,
  handleTurnOff,
  handleCloudRunStatus
} from '../controllers/cloudrunAdminController.js';

const router = express.Router();
const INTERNAL_TOKEN = process.env.CONSART_ADMIN_TOKEN || '';

function authMiddleware(req, res, next) {
  const token =
    req.header('x-consart-token') ||
    req.header('x-consart-admin-token') ||
    '';

  if (!INTERNAL_TOKEN || token !== INTERNAL_TOKEN) {
    return res.status(403).json({
      ok: false,
      error: 'unauthorized'
    });
  }

  next();
}

/* =========================================================
   STATUS
========================================================= */
router.get('/internal/cloudrun/status', authMiddleware, handleCloudRunStatus);
router.get('/internal/cloudrun/scheduler/status', authMiddleware, handleCloudRunStatus);

/* =========================================================
   TURN ON
========================================================= */
router.post('/internal/cloudrun/on', authMiddleware, handleTurnOn);
router.post('/internal/cloudrun/scheduler/on', authMiddleware, handleTurnOn);

/* =========================================================
   TURN OFF
========================================================= */
router.post('/internal/cloudrun/off', authMiddleware, handleTurnOff);
router.post('/internal/cloudrun/scheduler/off', authMiddleware, handleTurnOff);

export default router;