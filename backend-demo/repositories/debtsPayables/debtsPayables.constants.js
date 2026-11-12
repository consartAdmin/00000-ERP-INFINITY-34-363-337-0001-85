// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtsPayables.constants.js — Compromissos ↔ Contas a Pagar         ║
// ╚════════════════════════════════════════════════════════════════════╝

export const TB_DEBTS = 'public.debts';
export const TB_PAYMENTS = 'public.debt_payments';
export const TB_PLANS = 'public.debt_installment_plans';
export const TB_PAYABLE = 'public."accountsPayable"';
export const TB_SUPPLIERS = 'public.suppliers';

// Origem gravada no título (source_type) — o vínculo real é debt_id + parcela
export const SOURCE_TYPE = 'DEBT';
