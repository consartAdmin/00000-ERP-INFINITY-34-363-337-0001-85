// ╔══════════════════════════════════════════════════════════════════════╗
// ║ employeesCatalogsRoutes.js — Departamentos e Cargos (R.H)            ║
// ║ Montado em /api:                                                     ║
// ║   GET/POST        /api/employees-departments                         ║
// ║   GET/PUT/DELETE  /api/employees-departments/:id                     ║
// ║   GET/POST        /api/employees-positions                           ║
// ║   GET/PUT/DELETE  /api/employees-positions/:id                       ║
// ║ Filtros do GET: ?q=texto&active=true|false|(vazio = todos)           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { list, getById, create, update, remove } from '../controllers/employeesCatalogsController.js';

function catalogRouter(kind) {
  const router = Router();
  router.use(requireAuth, (req, _res, next) => {
    req.catalogKind = kind;
    next();
  });

  router.get('/', list);
  router.get('/:id', getById);
  router.post('/', create);
  router.put('/:id', update);
  router.delete('/:id', remove);
  return router;
}

const r = Router();
r.use('/employees-departments', catalogRouter('departments'));
r.use('/employees-positions', catalogRouter('positions'));

export default r;
