// ╔════════════════════════════════════════════════════════════════════╗
// ║ payrollCharges.calc.js — Encargos da folha e rescisão (cálculo)    ║
// ║ CONSART ERP                                                        ║
// ║                                                                    ║
// ║ Funções puras (sem banco):                                         ║
// ║  • inssEmployee   → INSS progressivo do empregado                  ║
// ║  • irrfMonthly    → IRRF mensal (dependentes × desconto            ║
// ║                     simplificado + redução da Lei 15.270/2025)     ║
// ║  • monthCharges   → encargos do mês por colaborador                ║
// ║  • terminationCalc→ verbas rescisórias + custo da empresa          ║
// ║                                                                    ║
// ║ Mês comercial de 30 dias. Estimativa gerencial: não substitui a    ║
// ║ folha do contador.                                                 ║
// ╚════════════════════════════════════════════════════════════════════╝

export const REGIMES = Object.freeze({
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  SIMPLES: 'Simples Nacional (CPP no DAS)',
  SIMPLES_ANEXO_IV: 'Simples Nacional — Anexo IV',
});

export const REASONS = Object.freeze({
  SEM_JUSTA_CAUSA: 'Dispensa sem justa causa',
  PEDIDO_DEMISSAO: 'Pedido de demissão',
  JUSTA_CAUSA: 'Dispensa por justa causa',
  ACORDO: 'Acordo (art. 484-A da CLT)',
  TERMINO_EXPERIENCIA: 'Término do contrato de experiência',
});

export const NOTICE_TYPES = Object.freeze({
  INDENIZADO: 'Indenizado',
  TRABALHADO: 'Trabalhado',
  DISPENSADO: 'Dispensado',
  NAO_CUMPRIDO: 'Não cumprido (desconto)',
});

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ======================================================================
// DATAS
// ======================================================================

/** 'YYYY-MM-DD' | Date → { y, m (1-12), d } (sem fuso). */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    // node-pg devolve DATE como meia-noite local
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function toUtc({ y, m, d }) {
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  const date = new Date(ms);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

export function formatIso(date) {
  if (!date) return null;
  return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

function addDays(date, days) {
  return fromUtc(toUtc(date) + days * 86400000);
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function cmp(a, b) {
  return toUtc(a) - toUtc(b);
}

/** Mesmo dia/mês somando anos (29/02 vira 28/02). */
function addYears(date, years) {
  const y = date.y + years;
  return { y, m: date.m, d: Math.min(date.d, daysInMonth(y, date.m)) };
}

function addMonths(date, months) {
  const total = date.m - 1 + months;
  const y = date.y + Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

/** Anos completos entre a e b. */
function fullYears(a, b) {
  let years = b.y - a.y;
  if (cmp(addYears(a, years), b) > 0) years -= 1;
  return Math.max(0, years);
}

/**
 * Avos (1/12) entre start e end (inclusive): cada mês completo conta 1 e a
 * fração final conta 1 se tiver 15 dias ou mais. Usado nas férias.
 */
function avosByPeriod(start, end) {
  if (cmp(end, start) < 0) return 0;
  let avos = 0;
  let cursor = start;
  while (avos < 12) {
    const next = addMonths(cursor, 1);
    if (cmp(addDays(next, -1), end) > 0) break;
    avos += 1;
    cursor = next;
  }
  if (avos < 12) {
    const restDays = Math.round((toUtc(end) - toUtc(cursor)) / 86400000) + 1;
    if (restDays >= 15) avos += 1;
  }
  return Math.min(12, avos);
}

/** Avos do 13º no ano de `end`: mês civil com 15 dias ou mais trabalhados. */
function avos13(admission, end) {
  let avos = 0;
  for (let m = 1; m <= end.m; m += 1) {
    const first = { y: end.y, m, d: 1 };
    const last = { y: end.y, m, d: daysInMonth(end.y, m) };
    const from = cmp(admission, first) > 0 ? admission : first;
    const to = cmp(end, last) < 0 ? end : last;
    if (cmp(to, from) < 0) continue;
    const days = Math.round((toUtc(to) - toUtc(from)) / 86400000) + 1;
    if (days >= 15) avos += 1;
  }
  return avos;
}

// ======================================================================
// TABELAS
// ======================================================================

/** INSS progressivo. brackets = [{ limit, rate(%) }], último limite = teto. */
export function inssEmployee(base, table) {
  const brackets = table?.inss_brackets || [];
  let tax = 0;
  let previous = 0;
  const value = Math.max(0, num(base));
  for (const bracket of brackets) {
    const limit = num(bracket.limit);
    if (value <= previous) break;
    tax += (Math.min(value, limit) - previous) * (num(bracket.rate) / 100);
    previous = limit;
  }
  return round2(tax);
}

function irrfByTable(base, table) {
  if (base <= 0) return 0;
  for (const bracket of table?.irrf_brackets || []) {
    const limit = bracket.limit == null ? Infinity : num(bracket.limit);
    if (base <= limit) return Math.max(0, base * (num(bracket.rate) / 100) - num(bracket.deduction));
  }
  return 0;
}

/**
 * IRRF mensal: usa a dedução mais vantajosa (INSS + dependentes ou desconto
 * simplificado) e aplica a redução da Lei 15.270/2025 sobre o rendimento
 * bruto tributável do mês.
 */
export function irrfMonthly(gross, inss, dependents, table) {
  const income = Math.max(0, num(gross));
  if (!income) return { tax: 0, base: 0, reduction: 0, simplified: false };

  const legalBase = income - num(inss) - num(dependents) * num(table?.irrf_dependent);
  const simplifiedValue = num(table?.irrf_simplified);
  const simplifiedBase = simplifiedValue > 0 ? income - simplifiedValue : legalBase;

  const legalTax = irrfByTable(legalBase, table);
  const simplifiedTax = irrfByTable(simplifiedBase, table);
  const simplified = simplifiedTax < legalTax;
  const tax = simplified ? simplifiedTax : legalTax;

  let reduction = 0;
  const red = table?.irrf_reduction;
  if (red && tax > 0) {
    if (income <= num(red.full_limit)) reduction = tax;
    else if (income <= num(red.partial_limit)) reduction = Math.max(0, num(red.a) - num(red.b) * income);
  }

  return {
    tax: round2(Math.max(0, tax - reduction)),
    base: round2(simplified ? simplifiedBase : legalBase),
    reduction: round2(Math.min(tax, reduction)),
    simplified,
  };
}

// ======================================================================
// ALÍQUOTAS DA EMPRESA
// ======================================================================

/** Alíquotas patronais (%) conforme o regime. */
export function employerRates(settings = {}) {
  const regime = settings.regime || 'LUCRO_PRESUMIDO';
  const fgts = num(settings.fgts_rate ?? 8);
  const rat = num(settings.rat_fap_rate ?? 2);
  const third = num(settings.third_rate ?? 5.8);
  const patronal = num(settings.patronal_rate ?? 20);

  if (regime === 'SIMPLES') return { regime, fgts, patronal: 0, rat: 0, third: 0 };
  if (regime === 'SIMPLES_ANEXO_IV') return { regime, fgts, patronal, rat, third: 0 };
  return { regime, fgts, patronal, rat, third };
}

// ======================================================================
// ENCARGOS DO MÊS
// ======================================================================

/** Dias trabalhados na competência (mês comercial de 30 dias). */
function workedDays(employee, year, month) {
  const admission = parseDate(employee.admission_date);
  const termination = parseDate(employee.termination_date);
  const lastDay = daysInMonth(year, month);
  const from = admission && admission.y === year && admission.m === month ? admission.d : 1;
  const to = termination && termination.y === year && termination.m === month ? termination.d : lastDay;

  if (from === 1 && to === lastDay) return 30;
  return Math.max(0, Math.min(30, to - from + 1));
}

export function monthCharges(employee, { year, month, table, settings }) {
  const salary = num(employee.salary_base);
  const dependents = Math.max(0, Math.trunc(num(employee.dependents)));
  const rates = employerRates(settings);
  const days = workedDays(employee, year, month);
  const gross = round2((salary / 30) * days);

  const inss = inssEmployee(gross, table);
  const irrf = irrfMonthly(gross, inss, dependents, table).tax;
  const net = round2(gross - inss - irrf);

  const fgts = round2(gross * rates.fgts / 100);
  const patronal = round2(gross * rates.patronal / 100);
  const ratThird = round2(gross * (rates.rat + rates.third) / 100);

  const prov13 = round2((salary / 12) * (days / 30));
  const provVacation = round2((salary / 12) * (4 / 3) * (days / 30));
  // Encargos que incidem sobre as provisões (FGTS + INSS patronal/RAT/terceiros)
  const provCharges = round2((prov13 + provVacation) * (rates.fgts + rates.patronal + rates.rat + rates.third) / 100);

  const benefits = round2(
    num(employee.transport_benefit) + num(employee.food_benefit)
    + num(employee.meal_benefit) + num(employee.health_benefit),
  );

  const totalCost = round2(gross + fgts + patronal + ratThird + prov13 + provVacation + provCharges + benefits);

  const warnings = [];
  if (!salary) warnings.push('Sem salário base no cadastro');
  const admission = parseDate(employee.admission_date);
  if (!admission || admission.y < 1950) warnings.push('Data de admissão inválida');

  return {
    employee_id: employee.employee_id,
    full_name: employee.full_name,
    position: employee.position,
    department: employee.department,
    salary_base: round2(salary),
    days,
    gross,
    dependents,
    inss,
    irrf,
    net,
    fgts,
    patronal,
    rat_third: ratThird,
    prov_13: prov13,
    prov_vacation: provVacation,
    prov_charges: provCharges,
    benefits,
    total_cost: totalCost,
    warnings,
  };
}

export function sumMonth(rows) {
  const keys = ['salary_base', 'gross', 'dependents', 'inss', 'irrf', 'net', 'fgts', 'patronal', 'rat_third',
    'prov_13', 'prov_vacation', 'prov_charges', 'benefits', 'total_cost'];
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  rows.forEach((row) => keys.forEach((key) => { totals[key] += num(row[key]); }));
  keys.forEach((key) => { totals[key] = round2(totals[key]); });

  return {
    totals,
    guides: {
      inss: round2(totals.inss + totals.patronal + totals.rat_third),
      fgts: totals.fgts,
      irrf: totals.irrf,
      net_payroll: totals.net,
      total_cost: totals.total_cost,
    },
  };
}

// ======================================================================
// RESCISÃO
// ======================================================================

/**
 * input: {
 *   termination_date, reason, notice_type, vacation_periods (vencidos),
 *   fgts_balance (saldo do extrato, opcional), other_discounts
 * }
 */
export function terminationCalc(employee, input, { table, table13, settings }) {
  const salary = num(employee.salary_base);
  const dependents = Math.max(0, Math.trunc(num(employee.dependents)));
  const rates = employerRates(settings);
  const admission = parseDate(employee.admission_date);
  const end = parseDate(input.termination_date);

  if (!admission) throw Object.assign(new Error('Colaborador sem data de admissão válida.'), { status: 400 });
  if (!end) throw Object.assign(new Error('Informe a data de desligamento.'), { status: 400 });
  if (cmp(end, admission) < 0) {
    throw Object.assign(new Error('O desligamento é anterior à admissão.'), { status: 400 });
  }
  if (!salary) throw Object.assign(new Error('Colaborador sem salário base no cadastro.'), { status: 400 });

  const reason = REASONS[input.reason] ? input.reason : 'SEM_JUSTA_CAUSA';
  let noticeType = NOTICE_TYPES[input.notice_type] ? input.notice_type : 'INDENIZADO';
  const years = fullYears(admission, end);
  const daily = salary / 30;

  // ── Aviso prévio ─────────────────────────────────────────────
  let noticeDays = 0;
  let noticePaidDays = 0;
  let noticeDiscountDays = 0;

  if (reason === 'SEM_JUSTA_CAUSA' || reason === 'ACORDO') {
    if (noticeType === 'NAO_CUMPRIDO' || noticeType === 'DISPENSADO') noticeType = 'INDENIZADO';
    noticeDays = Math.min(90, 30 + 3 * years);
    if (noticeType === 'INDENIZADO') {
      noticePaidDays = reason === 'ACORDO' ? noticeDays / 2 : noticeDays;
    }
  } else if (reason === 'PEDIDO_DEMISSAO') {
    if (noticeType === 'INDENIZADO') noticeType = 'TRABALHADO';
    noticeDays = 30;
    if (noticeType === 'NAO_CUMPRIDO') noticeDiscountDays = 30;
  } else {
    noticeType = null;
  }

  // Aviso indenizado projeta o contrato (13º e férias)
  const projectedEnd = noticeType === 'INDENIZADO' && noticeDays ? addDays(end, noticeDays) : end;

  // ── Saldo de salário ─────────────────────────────────────────
  const lastDay = daysInMonth(end.y, end.m);
  let balanceDays = end.d >= lastDay ? 30 : Math.min(30, end.d);
  if (admission.y === end.y && admission.m === end.m) balanceDays = Math.min(30, end.d - admission.d + 1);
  const salaryBalance = round2(daily * balanceDays);

  // ── 13º proporcional ─────────────────────────────────────────
  const has13 = reason !== 'JUSTA_CAUSA';
  const thirteenthAvos = has13 ? avos13(admission, projectedEnd) : 0;
  // aviso indenizado que projeta para o ano seguinte: avos do ano corrente
  const thirteenthAvosUsed = projectedEnd.y > end.y ? avos13(admission, { y: end.y, m: 12, d: 31 }) : thirteenthAvos;
  const thirteenth = round2((salary / 12) * thirteenthAvosUsed);

  // ── Férias ───────────────────────────────────────────────────
  const vacationPeriods = Math.max(0, Math.trunc(num(input.vacation_periods)));
  const vacationDue = round2(salary * vacationPeriods);

  let periodStart = addYears(admission, fullYears(admission, projectedEnd));
  if (cmp(periodStart, projectedEnd) > 0) periodStart = admission;
  const vacationAvos = reason === 'JUSTA_CAUSA' ? 0 : avosByPeriod(periodStart, projectedEnd);
  const vacationProp = round2((salary / 12) * vacationAvos);
  const vacationThird = round2((vacationDue + vacationProp) / 3);

  // ── Aviso indenizado ─────────────────────────────────────────
  const noticeValue = round2(daily * noticePaidDays);

  // ── Descontos ────────────────────────────────────────────────
  const inssBalance = inssEmployee(salaryBalance, table);
  const inss13 = inssEmployee(thirteenth, table13 || table);
  const irrfBalance = irrfMonthly(salaryBalance, inssBalance, dependents, table).tax;
  const irrf13 = irrfMonthly(thirteenth, inss13, dependents, table13 || table).tax;
  const noticeDiscount = round2(daily * noticeDiscountDays);
  const otherDiscounts = round2(Math.max(0, num(input.other_discounts)));

  const earnings = [
    { key: 'salary_balance', label: 'Saldo de salário', ref: `${balanceDays} dias`, value: salaryBalance },
  ];
  if (noticeValue) {
    earnings.push({
      key: 'notice',
      label: reason === 'ACORDO' ? 'Aviso prévio indenizado (50% — acordo)' : 'Aviso prévio indenizado',
      ref: `${noticePaidDays} dias`,
      value: noticeValue,
    });
  }
  if (has13) earnings.push({ key: 'thirteenth', label: '13º salário proporcional', ref: `${thirteenthAvosUsed}/12`, value: thirteenth });
  earnings.push({
    key: 'vacation_due', label: 'Férias vencidas', ref: vacationPeriods ? `${vacationPeriods} período(s)` : '—', value: vacationDue,
  });
  if (reason !== 'JUSTA_CAUSA') {
    earnings.push({ key: 'vacation_prop', label: 'Férias proporcionais', ref: `${vacationAvos}/12`, value: vacationProp });
  }
  earnings.push({ key: 'vacation_third', label: '1/3 constitucional sobre férias', ref: '', value: vacationThird });

  const discounts = [
    { key: 'inss_balance', label: 'INSS sobre saldo de salário', ref: '', value: inssBalance },
  ];
  if (has13) discounts.push({ key: 'inss_13', label: 'INSS sobre 13º', ref: '', value: inss13 });
  discounts.push({ key: 'irrf_balance', label: 'IRRF sobre saldo de salário', ref: '', value: irrfBalance });
  if (has13) discounts.push({ key: 'irrf_13', label: 'IRRF sobre 13º (tributação exclusiva)', ref: '', value: irrf13 });
  if (noticeDiscount) discounts.push({ key: 'notice_discount', label: 'Aviso prévio não cumprido', ref: '30 dias', value: noticeDiscount });
  if (otherDiscounts) discounts.push({ key: 'other', label: 'Outros descontos / adiantamentos', ref: '', value: otherDiscounts });

  const totalEarnings = round2(earnings.reduce((sum, item) => sum + item.value, 0));
  const totalDiscounts = round2(discounts.reduce((sum, item) => sum + item.value, 0));
  const netPay = round2(totalEarnings - totalDiscounts);

  // ── Custo da empresa ─────────────────────────────────────────
  // FGTS: saldo + aviso indenizado + 13º (férias indenizadas não incidem)
  const fgtsMonth = round2((salaryBalance + noticeValue + thirteenth) * rates.fgts / 100);

  const informedBalance = input.fgts_balance !== undefined && input.fgts_balance !== null && input.fgts_balance !== '';
  const monthsWorked = Math.max(0, Math.round((toUtc(end) - toUtc(admission)) / (86400000 * 30.4375)));
  const fgtsBalance = informedBalance
    ? round2(num(input.fgts_balance))
    : round2(salary * rates.fgts / 100 * (monthsWorked + Math.floor(monthsWorked / 12)));

  let fineRate = 0;
  if (reason === 'SEM_JUSTA_CAUSA') fineRate = 40;
  if (reason === 'ACORDO') fineRate = 20;
  const fgtsFine = round2((fgtsBalance + fgtsMonth) * fineRate / 100);

  // INSS patronal/RAT/terceiros: saldo + 13º (aviso e férias indenizados não incidem)
  const employerRate = rates.patronal + rates.rat + rates.third;
  const employerInss = round2((salaryBalance + thirteenth) * employerRate / 100);

  const totalCost = round2(totalEarnings + fgtsMonth + fgtsFine + employerInss);

  const companyCosts = [
    { key: 'earnings', label: 'Total de proventos', ref: '', value: totalEarnings },
    { key: 'fgts_month', label: `FGTS do mês da rescisão (${rates.fgts}%)`, ref: '', value: fgtsMonth },
  ];
  if (fineRate) {
    companyCosts.push({
      key: 'fgts_fine',
      label: `Multa FGTS ${fineRate}%`,
      ref: informedBalance ? 'sobre saldo' : 'saldo estimado',
      value: fgtsFine,
    });
  }
  companyCosts.push({
    key: 'employer_inss',
    label: employerRate ? 'INSS patronal + RAT + terceiros' : 'INSS patronal (recolhido no DAS)',
    ref: employerRate ? `${round2(employerRate).toLocaleString('pt-BR')}%` : '—',
    value: employerInss,
  });

  return {
    employee_id: employee.employee_id,
    full_name: employee.full_name,
    position: employee.position,
    admission_date: formatIso(admission),
    termination_date: formatIso(end),
    salary_base: round2(salary),
    reason,
    reason_label: REASONS[reason],
    notice_type: noticeType,
    notice_label: noticeType ? NOTICE_TYPES[noticeType] : '—',
    notice_days: noticeDays,
    years,
    projected_end: formatIso(projectedEnd),
    fgts_balance: fgtsBalance,
    fgts_balance_estimated: !informedBalance,
    earnings,
    discounts,
    company_costs: companyCosts,
    totals: {
      earnings: totalEarnings,
      discounts: totalDiscounts,
      net: netPay,
      fgts_month: fgtsMonth,
      fgts_fine: fgtsFine,
      fgts_guide: round2(fgtsMonth + fgtsFine),
      employer_inss: employerInss,
      cost: totalCost,
    },
  };
}
