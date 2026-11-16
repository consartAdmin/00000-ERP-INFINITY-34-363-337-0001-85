// ╔════════════════════════════════════════════════════════════════════╗
// ║ userShortcutsRoutes.js — /api/user-shortcuts (Meus atalhos)        ║
// ╚════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  getShortcutsOptions,
  listMyShortcuts,
  createMyShortcut,
  updateMyShortcut,
  toggleMyShortcut,
  deleteMyShortcut,
} from '../controllers/userShortcutsController.js';

const router = Router();

router.use(requireAuth);

router.get('/options', getShortcutsOptions);          // ações e teclas permitidas
router.get('/', listMyShortcuts);                      // ?active=true → só ativos (Home)
router.post('/', createMyShortcut);
router.put('/:id', updateMyShortcut);
router.patch('/:id/active', toggleMyShortcut);         // { is_active: true|false }
router.delete('/:id', deleteMyShortcut);

export default router;
