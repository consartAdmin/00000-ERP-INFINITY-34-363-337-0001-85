// ╔════════════════════════════════════════════════════════════════════╗
// ║ payrollCharges.chartAccounts.js — Encargos × Plano de Contas       ║
// ║ CONSART ERP                                                        ║
// ║                                                                    ║
// ║ • Uma conta de public."chartOfAccounts" por despesa da folha,      ║
// ║   guardada em payrollChargesSettings.chart_accounts (JSONB).       ║
// ║ • "Gerar contas a pagar" grava a conta no título; ao pagar, a      ║
// ║   saída no Caixa já vem com a conta.                               ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_SETTINGS, ensurePayrollChargesTables } from './payrollCharges.schema.js';

const TB_COA = 'public."chartOfAccounts"';

// Despesas da folha (mesma ordem da tela); column = coluna da tabela de encargos
export const EXPENSES = Object.freeze([
  { key: 'SALARY', group: 'Salários e benefícios', label: 'Salário líquido', column: 'Líquido', used: 'Título de salário (por colaborador ou folha única)' },
  { key: 'BENEFITS', group: 'Salários e benefícios', label: 'Benefícios', column: 'Benefícios', used: 'Título de benefícios' },
  { key: 'INSS_EMPLOYEE', group: 'Guia DCTFWeb (INSS)', label: 'INSS descontado do colaborador', column: 'INSS (desc.)', used: 'Guia INSS' },
  { key: 'INSS_PATRONAL', group: 'Guia DCTFWeb (INSS)', label: 'INSS patronal', column: 'INSS patronal', used: 'Guia INSS' },
  { key: 'RAT_THIRD', group: 'Guia DCTFWeb (INSS)', label: 'RAT + Terceiros', column: 'RAT + Terc.', used: 'Guia INSS' },
  { key: 'FGTS', group: 'FGTS e IRRF', label: 'FGTS', column: 'FGTS', used: 'Guia FGTS Digital' },
  { key: 'IRRF', group: 'FGTS e IRRF', label: 'IRRF descontado do colaborador', column: 'IRRF (desc.)', used: 'DARF IRRF 0561' },
  { key: 'PROV_13', group: 'Provisões', label: '13º salário', column: 'Prov. 13º', used: 'Pagamento do 13º / rescisão' },
  { key: 'PROV_VACATION', group: 'Provisões', label: 'Férias + 1/3', column: 'Prov. Férias + 1/3', used: 'Pagamento de férias / rescisão' },
  { key: 'PROV_CHARGES', group: 'Provisões', label: 'Encargos sobre provisões', column: 'Enc. s/ prov.', used: 'Pagamento do 13º/férias / rescisão' },
]);

const KEYS = new Set(EXPENSES.map((item) => item.key));

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function toIdOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** { CHAVE: chart_account_id } salvo nas configurações. */
export async function accountMap() {
  await ensurePayrollChargesTables();
  const { rows } = await pool.query(`SELECT chart_accounts FROM ${TB_SETTINGS} WHERE id = 1`);
  const saved = rows[0]?.chart_accounts || {};
  return Object.fromEntries(EXPENSES.map((item) => [item.key, toIdOrNull(saved[item.key])]));
}

/** Código e descrição das contas (Map id → conta). */
export async function accountsByIds(ids) {
  const list = [...new Set(ids.filter(Boolean).map(Number))];
  if (!list.length) return new Map();
  const { rows } = await pool.query(
    `SELECT id, code, description, allows_posting, is_active FROM ${TB_COA} WHERE id = ANY($1::bigint[])`,
    [list],
  );
  return new Map(rows.map((row) => [Number(row.id), row]));
}

export function accountLabel(account) {
  return account ? [account.code, account.description].filter(Boolean).join(' — ') : null;
}

/** Lista das despesas com a conta vinculada (tela "Plano de Contas"). */
export async function list() {
  const map = await accountMap();
  const accounts = await accountsByIds(Object.values(map));
  return EXPENSES.map((item) => {
    const account = accounts.get(Number(map[item.key])) || null;
    return {
      ...item,
      chart_account_id: account ? Number(account.id) : null,
      chart_account_code: account?.code || null,
      chart_account_description: account?.description || null,
    };
  });
}

/** Salva { accounts: { CHAVE: id|null } }; só contas analíticas (aceitam lançamento) e ativas. */
export async function save(input = {}) {
  const current = await accountMap();
  const incoming = input.accounts && typeof input.accounts === 'object' ? input.accounts : {};
  const next = { ...current };
  Object.entries(incoming).forEach(([key, value]) => {
    if (KEYS.has(key)) next[key] = toIdOrNull(value);
  });

  const accounts = await accountsByIds(Object.values(next));
  const problems = [];
  EXPENSES.forEach((item) => {
    const id = next[item.key];
    if (!id) return;
    const account = accounts.get(id);
    if (!account) problems.push(`${item.label}: conta ${id} não existe no Plano de Contas.`);
    else if (account.allows_posting === false) problems.push(`${item.label}: a conta ${account.code} é sintética (não aceita lançamento).`);
    else if (account.is_active === false) problems.push(`${item.label}: a conta ${account.code} está inativa.`);
  });
  if (problems.length) throw httpError(400, problems.join('\n'));

  await pool.query(
    `UPDATE ${TB_SETTINGS} SET chart_accounts = $1::jsonb, updated_at = NOW() WHERE id = 1`,
    [JSON.stringify(next)],
  );
  return list();
}
