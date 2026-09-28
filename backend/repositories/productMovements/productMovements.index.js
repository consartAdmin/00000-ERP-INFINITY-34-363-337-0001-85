// ╔══════════════════════════════════════════════════════════════╗
// ║ productMovements.index.js — ponto de entrada do módulo      ║
// ║ Mantém a mesma API pública do antigo productMovementsApi.js ║
// ╚══════════════════════════════════════════════════════════════╝

import { listByProductCode } from './productMovementsQuery.repository.js';

export { listByProductCode };

export default {
  listByProductCode,
};
