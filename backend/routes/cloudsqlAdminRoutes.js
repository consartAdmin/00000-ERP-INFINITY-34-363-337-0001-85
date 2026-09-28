// ╔══════════════════════════════════════════════════════════════╗
// ║ cloudsqlAdminRoutes.js                                      ║
// ╚══════════════════════════════════════════════════════════════╝

import express from 'express';
import { sqlOn, sqlOff } from '../controllers/cloudsqlAdminController.js';

const router = express.Router();

router.post('/internal/cloudsql/on', sqlOn);
router.post('/internal/cloudsql/off', sqlOff);

export default router;