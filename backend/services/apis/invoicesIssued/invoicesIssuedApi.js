// ╔══════════════════════════════════════════════════════════════════════╗
// ║ invoicesIssuedApi.js — Barrel de compatibilidade (NF-e Emitidas)     ║
// ║ CONSART ERP | PostgreSQL | ESM                                       ║
// ║ A implementação vive em backend/repositories/invoicesIssued/         ║
// ║ Este arquivo existe apenas para não quebrar os imports atuais.       ║
// ╚══════════════════════════════════════════════════════════════════════╝

export * from '../../../repositories/invoicesIssued/index.js';
export { default } from '../../../repositories/invoicesIssued/index.js';
