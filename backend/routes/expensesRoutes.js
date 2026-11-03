// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expensesRoutes.js — Routes (Express)                                 ║
// ║ Base: /api/expenses                                                  ║
// ║ CONSART ERP | ESM                                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Router } from 'express';
import multer from 'multer';
import {
  getExpenses,
  getExpense,
  createExpenseHandler,
  updateExpenseHandler,
  patchExpenseStatusHandler,
  deleteExpenseHandler,
  getExpensesPdf, // ✅ ADD
  getExpensesExcel,
  deleteExpensesBatchHandler,
  updateExpensesBatchHandler,
  sendExpensesToPayableHandler,
  listExpenseAttachmentsHandler,
  addExpenseAttachmentHandler,
  downloadExpenseAttachmentHandler,
  deleteExpenseAttachmentHandler,
} from '../controllers/expensesController.js';

const router = Router();

// Anexos (contratos e documentos): até 50 MB por arquivo, em memória → bucket
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ✅ MUITO IMPORTANTE: antes de "/:id"
router.get('/pdf', getExpensesPdf);
router.get('/excel', getExpensesExcel);
router.post('/batch-delete', deleteExpensesBatchHandler);
router.post('/batch-update', updateExpensesBatchHandler);
router.post('/to-accounts-payable', sendExpensesToPayableHandler);

// Anexos da despesa
router.get('/:id/attachments', listExpenseAttachmentsHandler);
router.post('/:id/attachments', upload.single('arquivo'), addExpenseAttachmentHandler);
router.get('/:id/attachments/:attachmentId/download', downloadExpenseAttachmentHandler);
router.delete('/:id/attachments/:attachmentId', deleteExpenseAttachmentHandler);

router.get('/', getExpenses);
router.get('/:id', getExpense);
router.post('/', createExpenseHandler);
router.put('/:id', updateExpenseHandler);
router.patch('/:id/status', patchExpenseStatusHandler);
router.delete('/:id', deleteExpenseHandler);

export default router;