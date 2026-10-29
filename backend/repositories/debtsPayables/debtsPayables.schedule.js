// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtsPayables.schedule.js — Parcelas de um Compromisso             ║
// ║ Mesmo cálculo do modal Pagamentos (public/debts/js/debts.payments) ║
// ╚════════════════════════════════════════════════════════════════════╝

export function roundMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

/** Coluna DATE do pg (Date local) ou texto → 'YYYY-MM-DD' */
export function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

function addMonthsKeepingDueDay(baseDate, index, dueDay = 31) {
  const [year, month] = baseDate.split('-').map(Number);
  const total = (month - 1) + index;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(Number(dueDay || 31), lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function amountByPlans(number, plans, fallback) {
  const plan = plans.find((p) =>
    number >= Number(p.start_installment || 0) && number <= Number(p.end_installment || 0));
  return plan ? roundMoney(plan.installment_amount) : fallback;
}

/** true quando a dívida tem cronograma de parcelas (1 linha em debts, N parcelas) */
export function hasSchedule(debt) {
  // Parcelas antigas geradas em linhas separadas (parent_debt_id) contam como título único
  if (debt.parent_debt_id != null && debt.installment_number != null) return false;
  return Number(debt.installment_total || 0) > 0;
}

/**
 * Lista os títulos que o Compromisso deve ter em Contas a Pagar.
 * @returns {{ number:number, total:number, due_date:string, amount:number }[]}
 */
export function buildDebtSchedule(debt, plans = []) {
  if (!hasSchedule(debt)) {
    const due = dateOnly(debt.due_date) || dateOnly(debt.issue_date);
    if (!due) return [];
    const amount = roundMoney(
      debt.updated_amount != null ? debt.updated_amount : debt.original_amount
    );
    return [{ number: 1, total: 1, due_date: due, amount }];
  }

  const total = Number(debt.installment_total);
  const first = dateOnly(debt.first_installment_due_at) ||
    dateOnly(debt.due_date) ||
    dateOnly(debt.issue_date);
  if (!first) return [];

  const dueDay = Number(debt.due_day || 31);
  const fallback = roundMoney(Number(debt.original_amount || 0) / total);

  const rows = [];
  for (let number = 1; number <= total; number += 1) {
    rows.push({
      number,
      total,
      due_date: addMonthsKeepingDueDay(first, number - 1, dueDay),
      amount: amountByPlans(number, plans, fallback)
    });
  }
  return rows;
}

export function installmentLabel(number, total) {
  return `${String(number).padStart(3, '0')}/${String(total).padStart(3, '0')}`;
}
