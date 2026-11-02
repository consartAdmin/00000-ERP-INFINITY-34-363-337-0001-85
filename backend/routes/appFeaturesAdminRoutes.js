// ╔══════════════════════════════════════════════════════════════════════╗
// ║ appFeaturesAdminRoutes.js — /api/app-features-admin (requireAuth)    ║
// ║   GET/POST        /features        PUT/DELETE /features/:id          ║
// ║   POST /features-full   PUT /features-full/:id  (modal único)        ║
// ║   GET/POST        /options         PUT/DELETE /options/:id           ║
// ║   GET/POST        /assignments     PUT/DELETE /assignments/:id       ║
// ║ Tela: /public/appFeatures/appFeatures.html                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import * as ctrl from '../controllers/appFeaturesAdminController.js';

const router = Router();

router.use(requireAuth);

router.get('/features', ctrl.listFeatures);
router.post('/features', ctrl.createFeature);
router.put('/features/:id', ctrl.updateFeature);
router.delete('/features/:id', ctrl.deleteFeature);

// modal único: salva funcionalidade + opções + atribuições de uma vez
router.post('/features-full', ctrl.createFeatureFull);
router.put('/features-full/:id', ctrl.updateFeatureFull);

router.get('/options', ctrl.listOptions);
router.post('/options', ctrl.createOption);
router.put('/options/:id', ctrl.updateOption);
router.delete('/options/:id', ctrl.deleteOption);

router.get('/assignments', ctrl.listAssignments);
router.post('/assignments', ctrl.createAssignment);
router.put('/assignments/:id', ctrl.updateAssignment);
router.delete('/assignments/:id', ctrl.deleteAssignment);

export default router;
