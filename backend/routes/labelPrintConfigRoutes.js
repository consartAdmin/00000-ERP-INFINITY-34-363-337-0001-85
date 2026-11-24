// ╔══════════════════════════════════════════════════════════════════════╗
// ║ labelPrintConfigRoutes.js — Routes Label Print Config               ║
// ║ CONSART ERP | ESM                                                   ║
// ║ Montado em server.js: app.use('/api/label-print-config', router)    ║
// ║ → os caminhos aqui são RELATIVOS (antes repetiam o prefixo e a      ║
// ║   API respondia em /api/label-print-config/api/label-print-config). ║
// ╚══════════════════════════════════════════════════════════════════════╝

import express from 'express';

import {
  getLabelConfig,
  updateLabelConfig,
  resetLabelConfig,
  listLabelModels,
  getDefaultLabelModel,
  getLabelModel,
  createLabelModel,
  updateLabelModel,
  setDefaultLabelModel,
  deleteLabelModel,
} from '../controllers/labelPrintConfigController.js';

const router = express.Router();

// Modelos de etiqueta de Localização (vários, nomeados)
router.get('/models', listLabelModels);
router.get('/models/default', getDefaultLabelModel);
router.get('/models/:id', getLabelModel);
router.post('/models', createLabelModel);
router.put('/models/:id', updateLabelModel);
router.post('/models/:id/default', setDefaultLabelModel);
router.delete('/models/:id', deleteLabelModel);

// Configuração única antiga (mantida por compatibilidade)
router.get('/', getLabelConfig);
router.put('/', updateLabelConfig);
router.post('/reset', resetLabelConfig);

export default router;
