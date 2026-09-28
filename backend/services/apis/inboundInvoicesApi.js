// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ inboundInvoicesApi.js — Barrel de compatibilidade (Notas de Entrada)    ║
// ║ CONSART ERP | ESM                                                        ║
// ║ A implementação vive em backend/repositories/inboundInvoices/            ║
// ║ Este arquivo existe apenas para não quebrar os imports atuais.           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

export * from '../../repositories/inboundInvoices/index.js';
export { default } from '../../repositories/inboundInvoices/index.js';
