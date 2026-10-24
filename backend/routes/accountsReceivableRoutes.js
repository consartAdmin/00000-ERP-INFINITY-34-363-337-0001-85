// ╔══════════════════════════════════════════════════════════════════╗
// ║ accountsReceivableRoutes.js — Rotas REST                        ║
// ║ CONSART ERP — /api/accounts-receivable                          ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';

import express from 'express';
import multer from 'multer';

import * as ctrl
   from '../controllers/accountsReceivableController.js';

const router = express.Router();

// Anexos: arquivo em memória e enviado ao bucket (máx. 50MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/* ------------------------------------------------------------------
   LISTA
------------------------------------------------------------------ */

router.get('/', ctrl.list);

/* ------------------------------------------------------------------
   ROTAS FIXAS — devem vir antes de /:id
------------------------------------------------------------------ */

router.get('/bank-accounts', ctrl.bankAccounts);
router.get('/cash-categories', ctrl.cashCategories);
router.get('/cash-subcategories', ctrl.cashSubcategories);
router.get('/cash-document-types', ctrl.cashDocumentTypes);
router.get('/chart-of-accounts', ctrl.chartOfAccounts);
router.get('/export/pdf', ctrl.exportPdf);
router.get('/export/excel', ctrl.exportExcel);
router.post('/sync-asaas', ctrl.syncAsaasHandler);

/* ------------------------------------------------------------------
   BOLETO
------------------------------------------------------------------ */

router.get('/:id/boleto', ctrl.downloadBoleto);
router.patch('/:id/boleto', ctrl.updateBoleto);
router.delete('/:id/boleto', ctrl.cancelBoleto);

/* ------------------------------------------------------------------
   CRUD
------------------------------------------------------------------ */

router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);

/* ------------------------------------------------------------------
   RECEBIMENTO
------------------------------------------------------------------ */

router.post('/:id/receive', ctrl.receive);

/* ------------------------------------------------------------------
   ANEXOS (bucket do projeto)
------------------------------------------------------------------ */

router.get('/:id/attachments', ctrl.listAttachmentsHandler);
router.post('/:id/attachments', upload.single('arquivo'), ctrl.addAttachmentHandler);
router.get('/:id/attachments/:attachmentId/download', ctrl.downloadAttachmentHandler);
router.delete('/:id/attachments/:attachmentId', ctrl.deleteAttachmentHandler);

export default router;