// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtPayments.index.js — ponto de entrada do módulo pagamentos      ║
// ║ Mantém a mesma API pública do antigo debtPaymentsApi.js            ║
// ╚════════════════════════════════════════════════════════════════════╝

import { listByDebtId, getById, getSummaryByDebtId } from './debtPaymentsQuery.repository.js';
import { createPayment } from './debtPaymentsCreate.repository.js';
import { deletePayment } from './debtPaymentsRemove.repository.js';

export default {
  listByDebtId,
  getById,
  createPayment,
  deletePayment,
  getSummaryByDebtId
};
