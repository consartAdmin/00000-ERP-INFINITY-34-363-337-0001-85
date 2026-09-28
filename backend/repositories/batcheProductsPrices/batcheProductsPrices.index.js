// ╔════════════════════════════════════════════════════════════════════╗
// ║ batcheProductsPrices.index.js — ponto de entrada (preços em lote)  ║
// ║ Mantém a mesma API pública do antigo batcheProductsPricesApi.js    ║
// ╚════════════════════════════════════════════════════════════════════╝

import { batchAdjust } from './batcheProductsPricesAdjust.repository.js';
import { batchUpsert } from './batcheProductsPricesUpsert.repository.js';

export { batchAdjust, batchUpsert };

// Export default (se quiser importar como objeto)
export default {
  batchAdjust,
  batchUpsert
};
