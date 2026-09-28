// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: backend/routes/databaseRoutes.js                              ║
// ║ MODULE: Database Viewer / Editor                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import express from 'express';

import {
  listDatabaseTables,
  getDatabaseTableColumns,
  getDatabaseTableRows,
  createDatabaseRow,
  updateDatabaseRow,
  deleteDatabaseRow,
} from '../controllers/databaseController.js';

const router = express.Router();

router.get('/tables', listDatabaseTables);
router.get('/tables/:table/columns', getDatabaseTableColumns);
router.get('/tables/:table/rows', getDatabaseTableRows);

router.post('/tables/:table/rows', createDatabaseRow);
router.put('/tables/:table/rows', updateDatabaseRow);
router.delete('/tables/:table/rows', deleteDatabaseRow);

export default router;