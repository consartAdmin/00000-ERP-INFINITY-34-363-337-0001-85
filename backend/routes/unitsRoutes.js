  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ unitsRoutes.js — Rotas REST para `units` (Express ESM)               ║
  /* ║ Mount tip: app.use('/api', unitsRoutes)                              ║ */
  // ╚══════════════════════════════════════════════════════════════════════╝

  import { Router } from 'express';
  import {
    ensure, list, exportList, getById, create, upsert, update, deactivate, remove
  } from '../controllers/unitsController.js';

  const router = Router();

  // Ping opcional
  router.get('/__ping_units', (_req, res) => res.json({ ok: true }));

  // Ensure
  router.get('/units/ensure', ensure);

  // CRUD
  router.get   ('/units',           list);
  // Exportar PDF/Excel (antes de /:id) — ?format=pdf|xlsx&q=&onlyActive=
  router.get   ('/units/export',    exportList);
  router.get   ('/units/:id',       getById);
  router.post  ('/units',           create);
  router.post  ('/units/upsert',    upsert);
  router.put   ('/units/:id',       update);
  router.patch ('/units/:id/deactivate', deactivate);
  router.delete('/units/:id',       remove);

  export default router;
