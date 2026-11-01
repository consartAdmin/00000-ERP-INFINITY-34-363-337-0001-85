// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarter.index.js — ponto de entrada do módulo                    ║
// ╚════════════════════════════════════════════════════════════════════╝

export { ensureSchema } from './pdvStarterSchema.repository.js';
export { listCatalog } from './pdvStarterCatalog.repository.js';
export {
  getOpenSession,
  getSession,
  getLastClosed,
  openSession,
  addMovement,
  getSummary,
  closeSession,
} from './pdvStarterCash.repository.js';
export { createSale, listSales } from './pdvStarterSales.repository.js';
export { PAYMENT_METHODS } from './pdvStarter.constants.js';
