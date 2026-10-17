// ╔════════════════════════════════════════════════════════════════════╗
// ║ customers.table.js — Qual tabela de clientes a request usa         ║
// ║ BH3     → public."customers"        (padrão)                       ║
// ║ CONSART → public."customersConsart" (clientes da Consart ERP)      ║
// ║ O customersRoutes escolhe pela empresa da tela (X-ERP-Company);    ║
// ║ quem chama o módulo fora dessas rotas usa sempre public.customers. ║
// ╚════════════════════════════════════════════════════════════════════╝

import { AsyncLocalStorage } from 'node:async_hooks';
import { TB } from './customers.constants.js';

export const TB_CONSART = 'public."customersConsart"';

const TABLE_BY_COMPANY = {
  BH3: TB,
  CONSART: TB_CONSART,
};

const store = new AsyncLocalStorage();

/** Tabela de clientes da request atual. */
export function tb() {
  return store.getStore() || TB;
}

/** Roda fn() com a tabela da empresa informada. */
export function runWithCustomersTable(company, fn) {
  return store.run(TABLE_BY_COMPANY[company] || TB, fn);
}
