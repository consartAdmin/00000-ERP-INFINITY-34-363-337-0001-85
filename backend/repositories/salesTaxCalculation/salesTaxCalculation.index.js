// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesTaxCalculation.index.js — ponto de entrada (cálculo tributos) ║
// ║ Mantém a mesma API pública do antigo salesTaxCalculationApi.js     ║
// ╚════════════════════════════════════════════════════════════════════╝

export { fetchOrderFiscalData } from './salesTaxCalculationQuery.repository.js';
export { insertSalesTaxCalculation } from './salesTaxCalculationCreate.repository.js';
