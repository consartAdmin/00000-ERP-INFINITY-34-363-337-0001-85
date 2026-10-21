// ╔════════════════════════════════════════════════════════════════════╗
// ║ tms.index.js — ponto de entrada do módulo Transporte (TMS)         ║
// ╚════════════════════════════════════════════════════════════════════╝

export { ensureTmsTables } from './tms.schema.js';
export { ensureTmsMenu, registerTmsMenu } from './tms.menu.js';
export { list, get, create, update, remove, getResource } from './tmsCrud.repository.js';
export { calcFreight } from './tmsFreight.calc.js';
export { calcTacRetentions, TAC_RULES } from './tms.resources.js';
export {
  emitCte, cancelCte, insureCte, quoteToCte, emitMdfe, closeMdfe, cancelMdfe, printData,
} from './tmsDocuments.repository.js';
export {
  openCtesForBilling, issueInvoice, payInvoice, cancelInvoice, loadPlanCandidates, setLoadPlanStatus, lookup,
} from './tmsOperations.repository.js';
export { exportEdi, importNotfis, getEdiFile, parseNotfis } from './tmsEdi.repository.js';
export { tripProfit, fleetAlerts } from './tmsReports.repository.js';
