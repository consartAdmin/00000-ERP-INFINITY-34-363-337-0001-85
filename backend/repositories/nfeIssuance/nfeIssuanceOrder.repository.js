// ╔═══════════════════════════════════════════════════╗
// ║ nfeIssuanceOrder.repository.js — pedidos (Order)  ║
// ║ entradas públicas compatíveis → ordersNfeAttempts ║
// ╚═══════════════════════════════════════════════════╝

import {
  issueOrderNfe as issueOrderNfeFromAttempts,
  reconcileOrderNfe as reconcileOrderNfeFromAttempts,
} from '../../services/apis/ordersNfeAttempts/ordersNfeAttemptsApi.js';

// ============================================================================
// ORDER — ENTRADAS PÚBLICAS COMPATÍVEIS
// ============================================================================

export function issueOrderNfe(options = {}) {
  return issueOrderNfeFromAttempts(options);
}

export function reconcileOrderNfe(options = {}) {
  return reconcileOrderNfeFromAttempts(options);
}
