// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarter.constants.js — Tabelas do PDV Consart Starter            ║
// ╚════════════════════════════════════════════════════════════════════╝

// Vendas e itens: as mesmas tabelas lidas pelo relatório de vendas PDV,
// painel de NFC-e e dashboard (pdvSalesReport, plugnotasNfceWebhook).
export const TB_SALES = 'public."pdvSales"';
export const TB_SALES_ITEMS = 'public."pdvSalesItems"';

// Caixa (abertura, sangria/suprimento, fechamento)
export const TB_CASH_SESSIONS = 'public."pdvCashSessions"';
export const TB_CASH_MOVEMENTS = 'public."pdvCashMovements"';

export const ORIGIN = 'CONSART_STARTER';

export const PAYMENT_METHODS = Object.freeze([
  { code: 'DINHEIRO', label: 'Dinheiro' },
  { code: 'PIX', label: 'PIX' },
  { code: 'DEBITO', label: 'Cartão de débito' },
  { code: 'CREDITO', label: 'Cartão de crédito' },
  { code: 'OUTROS', label: 'Crediário / Outros' },
]);

export const PAYMENT_CODES = new Set(PAYMENT_METHODS.map((m) => m.code));

export const CASH_MOVEMENT_TYPES = new Set(['SANGRIA', 'SUPRIMENTO']);
