// ╔════════════════════════════════════════════════════════════════════╗
// ║ betterDateToBuy.index.js — ponto de entrada (Melhor Data de Compra)║
// ╚════════════════════════════════════════════════════════════════════╝

export {
  getAllBetterDates,
  getBetterDateById,
  getTodayAlerts,
  getPurchaseStats,
  getSuggestions,
  findByCustomer,
  SUGGESTION_LEAD_DAYS,
} from './betterDateToBuyQuery.repository.js';
export { createBetterDate, createBetterDatesBulk } from './betterDateToBuyCreate.repository.js';
export {
  updateBetterDate,
  markAlertSent,
  unmarkAlertSent,
  setBetterDateStatus,
} from './betterDateToBuyUpdate.repository.js';
export { deleteBetterDate } from './betterDateToBuyRemove.repository.js';
