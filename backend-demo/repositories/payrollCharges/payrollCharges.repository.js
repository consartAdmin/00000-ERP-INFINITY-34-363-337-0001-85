// ╔════════════════════════════════════════════════════════════════════╗
// ║ payrollCharges.repository.js — Encargos e Rescisões (CONSART ERP)  ║
// ║ • Encargos do mês: colaboradores ativos na competência             ║
// ║ • Rescisão: simula, salva e confirma (grava desligamento no        ║
// ║   cadastro e inativa o colaborador)                                ║
// ║ • Tabelas INSS/IRRF por ano e alíquotas da empresa (editáveis)     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_TABLES, TB_SETTINGS, TB_TERMINATIONS, ensurePayrollChargesTables } from './payrollCharges.schema.js';
import { monthCharges, sumMonth, terminationCalc, employerRates, parseDate, REGIMES, REASONS, NOTICE_TYPES } from './payrollCharges.calc.js';

const TB_EMPLOYEES = 'public.employees';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ======================================================================
// TABELAS E CONFIGURAÇÕES
// ======================================================================

/** Tabela do ano (ou a mais recente anterior; senão a mais antiga). */
export async function getTaxTable(year) {
  await ensurePayrollChargesTables();
  const { rows } = await pool.query(
    `SELECT * FROM ${TB_TABLES}
      ORDER BY (year <= $1) DESC, CASE WHEN year <= $1 THEN -year ELSE year END
      LIMIT 1`,
    [Number(year)],
  );
  if (!rows[0]) throw httpError(500, 'Nenhuma tabela de INSS/IRRF cadastrada.');
  return rows[0];
}

export async function listTaxTables() {
  await ensurePayrollChargesTables();
  const { rows } = await pool.query(`SELECT * FROM ${TB_TABLES} ORDER BY year DESC`);
  return rows;
}

function cleanBrackets(list, withDeduction) {
  if (!Array.isArray(list) || !list.length) throw httpError(400, 'Informe as faixas da tabela.');
  return list.map((item, index) => {
    const last = index === list.length - 1;
    const limit = item.limit === null || item.limit === '' || item.limit === undefined ? null : num(item.limit);
    if (limit === null && !(withDeduction && last)) throw httpError(400, `Faixa ${index + 1} sem valor limite.`);
    const out = { limit, rate: num(item.rate) };
    if (withDeduction) out.deduction = num(item.deduction);
    return out;
  });
}

export async function saveTaxTable(year, input = {}) {
  await ensurePayrollChargesTables();
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw httpError(400, 'Ano inválido.');

  const inss = cleanBrackets(input.inss_brackets, false);
  const irrf = cleanBrackets(input.irrf_brackets, true);
  const red = input.irrf_reduction;
  const reduction = red && num(red.full_limit) > 0
    ? { full_limit: num(red.full_limit), partial_limit: num(red.partial_limit), a: num(red.a), b: num(red.b) }
    : null;

  const { rows } = await pool.query(
    `INSERT INTO ${TB_TABLES}
       (year, min_wage, inss_brackets, irrf_brackets, irrf_dependent, irrf_simplified, irrf_reduction, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb, NOW())
     ON CONFLICT (year) DO UPDATE SET
       min_wage = EXCLUDED.min_wage,
       inss_brackets = EXCLUDED.inss_brackets,
       irrf_brackets = EXCLUDED.irrf_brackets,
       irrf_dependent = EXCLUDED.irrf_dependent,
       irrf_simplified = EXCLUDED.irrf_simplified,
       irrf_reduction = EXCLUDED.irrf_reduction,
       updated_at = NOW()
     RETURNING *`,
    [
      y,
      num(input.min_wage),
      JSON.stringify(inss),
      JSON.stringify(irrf),
      num(input.irrf_dependent),
      num(input.irrf_simplified),
      reduction ? JSON.stringify(reduction) : null,
    ],
  );
  return rows[0];
}

export async function getSettings() {
  await ensurePayrollChargesTables();
  const { rows } = await pool.query(`SELECT * FROM ${TB_SETTINGS} WHERE id = 1`);
  return rows[0];
}

export async function saveSettings(input = {}) {
  await ensurePayrollChargesTables();
  const current = await getSettings();
  const regime = REGIMES[input.regime] ? input.regime : current.regime;
  const pick = (key) => (input[key] === undefined || input[key] === '' ? num(current[key]) : num(input[key]));

  const { rows } = await pool.query(
    `UPDATE ${TB_SETTINGS}
        SET regime = $1, patronal_rate = $2, rat_fap_rate = $3, third_rate = $4, fgts_rate = $5, updated_at = NOW()
      WHERE id = 1
      RETURNING *`,
    [regime, pick('patronal_rate'), pick('rat_fap_rate'), pick('third_rate'), pick('fgts_rate')],
  );
  return rows[0];
}

export function options() {
  return { regimes: REGIMES, reasons: REASONS, notice_types: NOTICE_TYPES };
}

// ======================================================================
// ENCARGOS DO MÊS
// ======================================================================

function parseCompetence(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) throw httpError(400, 'Competência inválida (use AAAA-MM).');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw httpError(400, 'Competência inválida (use AAAA-MM).');
  return { year, month };
}

export async function monthReport(query = {}) {
  await ensurePayrollChargesTables();
  const { year, month } = parseCompetence(query.competence);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;

  const params = [first];
  let where = `
    e.admission_date < ($1::date + INTERVAL '1 month')
    AND (
      (e.termination_date IS NULL AND COALESCE(e.active, TRUE) = TRUE)
      OR e.termination_date >= $1::date
    )`;
  if (query.department) {
    params.push(String(query.department));
    where += ` AND COALESCE(e.department, '') = $${params.length}`;
  }

  const [{ rows: employees }, table, settings] = await Promise.all([
    pool.query(`SELECT e.* FROM ${TB_EMPLOYEES} e WHERE ${where} ORDER BY e.full_name`, params),
    getTaxTable(year),
    getSettings(),
  ]);

  const rows = employees.map((employee) => monthCharges(employee, { year, month, table, settings }));
  const { totals, guides } = sumMonth(rows);

  const { rows: departments } = await pool.query(
    `SELECT DISTINCT department FROM ${TB_EMPLOYEES}
      WHERE COALESCE(department, '') <> '' ORDER BY department`,
  );

  return {
    competence: `${year}-${String(month).padStart(2, '0')}`,
    table_year: table.year,
    settings,
    rates: employerRates(settings),
    rows,
    totals,
    guides,
    departments: departments.map((row) => row.department),
  };
}

// ======================================================================
// RESCISÃO
// ======================================================================

async function getEmployee(id) {
  const { rows } = await pool.query(`SELECT * FROM ${TB_EMPLOYEES} WHERE employee_id = $1`, [Number(id)]);
  if (!rows[0]) throw httpError(404, 'Colaborador não encontrado.');
  return rows[0];
}

export async function listEmployees() {
  await ensurePayrollChargesTables();
  const { rows } = await pool.query(
    `SELECT employee_id, full_name, position, department, admission_date, termination_date,
            salary_base, dependents, COALESCE(active, TRUE) AS active
       FROM ${TB_EMPLOYEES}
      ORDER BY COALESCE(active, TRUE) DESC, full_name`,
  );
  return rows;
}

export async function simulateTermination(input = {}) {
  await ensurePayrollChargesTables();
  if (!input.employee_id) throw httpError(400, 'Selecione o colaborador.');
  const employee = await getEmployee(input.employee_id);
  const end = parseDate(input.termination_date);
  if (!end) throw httpError(400, 'Informe a data de desligamento.');

  const [table, settings] = await Promise.all([getTaxTable(end.y), getSettings()]);
  return terminationCalc(employee, input, { table, table13: table, settings });
}

function cleanInput(input = {}) {
  return {
    employee_id: Number(input.employee_id),
    termination_date: String(input.termination_date || '').slice(0, 10),
    reason: input.reason,
    notice_type: input.notice_type,
    vacation_periods: num(input.vacation_periods),
    fgts_balance: input.fgts_balance === '' || input.fgts_balance == null ? null : num(input.fgts_balance),
    other_discounts: num(input.other_discounts),
  };
}

export async function saveTermination(input = {}, user = {}) {
  const clean = cleanInput(input);
  const result = await simulateTermination(clean);

  const { rows } = await pool.query(
    `INSERT INTO ${TB_TERMINATIONS}
       (employee_id, employee_name, termination_date, reason, notice_type, input, result,
        net_total, cost_total, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
     RETURNING *`,
    [
      clean.employee_id,
      result.full_name,
      clean.termination_date,
      result.reason,
      result.notice_type,
      JSON.stringify(clean),
      JSON.stringify(result),
      result.totals.net,
      result.totals.cost,
      user.user_id || null,
      user.name || null,
    ],
  );
  return rows[0];
}

export async function listTerminations(query = {}) {
  await ensurePayrollChargesTables();
  const params = [];
  let where = '';
  if (query.employee_id) {
    params.push(Number(query.employee_id));
    where = `WHERE employee_id = $1`;
  }
  const { rows } = await pool.query(
    `SELECT id, employee_id, employee_name, termination_date, reason, notice_type,
            net_total, cost_total, status, created_by_name, created_at, confirmed_at
       FROM ${TB_TERMINATIONS} ${where}
      ORDER BY created_at DESC
      LIMIT 100`,
    params,
  );
  return rows;
}

export async function getTermination(id) {
  await ensurePayrollChargesTables();
  const { rows } = await pool.query(`SELECT * FROM ${TB_TERMINATIONS} WHERE id = $1`, [Number(id)]);
  if (!rows[0]) throw httpError(404, 'Simulação não encontrada.');
  return rows[0];
}

export async function removeTermination(id) {
  const termination = await getTermination(id);
  if (termination.status === 'CONFIRMADA') throw httpError(400, 'Rescisão confirmada não pode ser excluída.');
  await pool.query(`DELETE FROM ${TB_TERMINATIONS} WHERE id = $1`, [Number(id)]);
  return { id: Number(id) };
}

/** Confirma: grava a data de desligamento no colaborador e o inativa. */
export async function confirmTermination(id) {
  const termination = await getTermination(id);
  if (termination.status === 'CONFIRMADA') return termination;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ${TB_EMPLOYEES}
          SET termination_date = $1, active = FALSE, updated_at = NOW()::timestamp
        WHERE employee_id = $2`,
      [termination.termination_date, termination.employee_id],
    );
    const { rows } = await client.query(
      `UPDATE ${TB_TERMINATIONS} SET status = 'CONFIRMADA', confirmed_at = NOW()
        WHERE id = $1 RETURNING *`,
      [Number(id)],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
