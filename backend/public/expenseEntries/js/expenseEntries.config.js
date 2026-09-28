// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.config.js — Configuration (CONSART ERP)              ║
// ║ Path: backend/public/expenseEntries/expenseEntries.config.js         ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const apiBase = window.apiBase || window.location.origin;
export const API = `${apiBase}/api/expense-entries`;
export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_ORDER_BY = 'issueDate desc';

