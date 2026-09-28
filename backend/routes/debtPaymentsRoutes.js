/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: debtPaymentsRoutes.js                                         ║
   ║ MODULE: Debt Payments Routes                                        ║
   ║ DESCRIPTION: Express routes for debt payments                       ║
   ║ CONSART ERP · Express · ESM                                         ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { Router } from 'express';
import {
  listDebtPayments,
  getDebtPaymentById,
  createDebtPayment,
  deleteDebtPayment,
  getDebtPaymentsSummary
} from '../controllers/debtPaymentsController.js';

const router = Router();

/* ──────────────────────────────────────────────────────────────────────
 * Nested by debt
 * ────────────────────────────────────────────────────────────────────── */

// Listar pagamentos de uma dívida
router.get('/debts/:debtId/payments', listDebtPayments);

// Resumo dos pagamentos da dívida
router.get('/debts/:debtId/payments/summary', getDebtPaymentsSummary);

// Criar pagamento para a dívida
router.post('/debts/:debtId/payments', createDebtPayment);

/* ──────────────────────────────────────────────────────────────────────
 * Direct payment routes
 * ────────────────────────────────────────────────────────────────────── */

// Buscar pagamento por ID
router.get('/debt-payments/:id', getDebtPaymentById);

// Excluir pagamento
router.delete('/debt-payments/:id', deleteDebtPayment);

export default router;