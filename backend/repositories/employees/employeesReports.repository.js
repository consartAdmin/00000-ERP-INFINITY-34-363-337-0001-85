// ╔══════════════════════════════════════════════════════════════════════╗
// ║ employeesReports.repository.js — Relatórios de colaboradores         ║
// ║ • list    → lista de colaboradores                                   ║
// ║ • payroll → salários e benefícios (com totais)                      ║
// ║ • trial   → experiência a vencer                                    ║
// ║ Cada relatório devolve { title, columns, rows, totals } para o PDF  ║
// ║ e o Excel usarem a mesma definição de colunas.                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, PK } from './employees.constants.js';
import { ensureTable } from './employeesSchema.repository.js';

// width = largura no PDF (A4 paisagem, 778pt úteis) | type: text | date | money | int
const REPORTS = Object.freeze({
  list: {
    title: 'Lista de colaboradores',
    file: 'colaboradores',
    columns: [
      { key: 'employee_id', label: 'ID', width: 30, type: 'int' },
      { key: 'full_name', label: 'Nome', width: 170 },
      { key: 'cpf', label: 'CPF', width: 80 },
      { key: 'department', label: 'Departamento', width: 95 },
      { key: 'position', label: 'Cargo', width: 95 },
      { key: 'admission_date', label: 'Admissão', width: 58, type: 'date' },
      { key: 'email', label: 'E-mail', width: 130 },
      { key: 'contact', label: 'Celular / Telefone', width: 75 },
      { key: 'status', label: 'Status', width: 45 },
    ],
  },
  payroll: {
    title: 'Salários e benefícios',
    file: 'colaboradores-salarios-beneficios',
    columns: [
      { key: 'full_name', label: 'Nome', width: 190 },
      { key: 'department', label: 'Departamento', width: 100 },
      { key: 'position', label: 'Cargo', width: 100 },
      { key: 'salary_base', label: 'Salário base', width: 70, type: 'money', total: true },
      { key: 'transport_benefit', label: 'Transporte', width: 62, type: 'money', total: true },
      { key: 'food_benefit', label: 'Alimentação', width: 62, type: 'money', total: true },
      { key: 'meal_benefit', label: 'Refeição', width: 62, type: 'money', total: true },
      { key: 'health_benefit', label: 'Saúde', width: 62, type: 'money', total: true },
      { key: 'total', label: 'Total', width: 70, type: 'money', total: true, bold: true },
    ],
  },
  trial: {
    title: 'Experiência a vencer',
    file: 'colaboradores-experiencia',
    columns: [
      { key: 'full_name', label: 'Nome', width: 190 },
      { key: 'department', label: 'Departamento', width: 105 },
      { key: 'admission_date', label: 'Admissão', width: 62, type: 'date' },
      { key: 'trial_start_date', label: 'Início', width: 62, type: 'date' },
      { key: 'trial_end_date', label: 'Fim', width: 62, type: 'date' },
      { key: 'trial_extended_label', label: 'Prorrogado', width: 60 },
      { key: 'trial_extension_end_date', label: 'Fim prorrog.', width: 70, type: 'date' },
      { key: 'due_date', label: 'Vence em', width: 62, type: 'date', bold: true },
      { key: 'days_left_label', label: 'Dias restantes', width: 105 },
    ],
  },
});

export const REPORT_TYPES = Object.freeze(Object.keys(REPORTS));

const money = (col) => `COALESCE(${col}, 0)::float8`;
const ymd = (col) => `to_char(${col}, 'YYYY-MM-DD')`;

function daysLeftLabel(days) {
  if (days === null || days === undefined) return '';
  const n = Number(days);
  if (n < 0) return `vencido há ${Math.abs(n)} dia(s)`;
  if (n === 0) return 'vence hoje';
  return `${n} dia(s)`;
}

export async function listDepartments() {
  await ensureTable();
  const { rows } = await pool.query(`
    SELECT DISTINCT TRIM(department) AS department
    FROM ${TB}
    WHERE COALESCE(TRIM(department), '') <> ''
    ORDER BY 1
  `);
  return rows.map((r) => r.department);
}

/**
 * @param {{ type: 'list'|'payroll'|'trial', active?: boolean|null, department?: string }} filters
 */
export async function loadEmployeesReport({ type, active = true, department = '' } = {}) {
  const def = REPORTS[type];
  if (!def) {
    const err = new Error('Tipo de relatório inválido. Use list, payroll ou trial.');
    err.status = 400;
    throw err;
  }

  await ensureTable();

  const params = [];
  let where = 'WHERE 1=1';

  if (active !== null && active !== undefined) {
    params.push(Boolean(active));
    where += ` AND active = $${params.length}`;
  }

  if (department) {
    params.push(String(department).trim().toLowerCase());
    where += ` AND LOWER(TRIM(COALESCE(department, ''))) = $${params.length}`;
  }

  // vencimento da experiência: fim da prorrogação quando prorrogado, senão o fim
  const dueDate = `CASE WHEN trial_extended AND trial_extension_end_date IS NOT NULL
                        THEN trial_extension_end_date ELSE trial_end_date END`;

  if (type === 'trial') where += ` AND (${dueDate}) IS NOT NULL`;

  const orderBy = type === 'trial' ? `(${dueDate}) ASC, LOWER(full_name)` : `LOWER(full_name), ${PK}`;

  const { rows } = await pool.query(
    `
      SELECT
        ${PK} AS employee_id,
        full_name, cpf, department, position, email, phone, mobile, active,
        ${ymd('admission_date')} AS admission_date,
        ${ymd('trial_start_date')} AS trial_start_date,
        ${ymd('trial_end_date')} AS trial_end_date,
        COALESCE(trial_extended, false) AS trial_extended,
        ${ymd('trial_extension_end_date')} AS trial_extension_end_date,
        ${ymd(dueDate)} AS due_date,
        ((${dueDate}) - CURRENT_DATE) AS days_left,
        ${money('salary_base')} AS salary_base,
        ${money('transport_benefit')} AS transport_benefit,
        ${money('food_benefit')} AS food_benefit,
        ${money('meal_benefit')} AS meal_benefit,
        ${money('health_benefit')} AS health_benefit
      FROM ${TB}
      ${where}
      ORDER BY ${orderBy}
    `,
    params
  );

  const data = rows.map((r) => ({
    ...r,
    contact: r.mobile || r.phone || '',
    status: r.active ? 'Ativo' : 'Inativo',
    trial_extended_label: r.trial_extended ? 'Sim' : 'Não',
    days_left_label: daysLeftLabel(r.days_left),
    total: r.salary_base + r.transport_benefit + r.food_benefit + r.meal_benefit + r.health_benefit,
  }));

  const totalCols = def.columns.filter((c) => c.total);
  const totals = totalCols.length
    ? Object.fromEntries(totalCols.map((c) => [c.key, data.reduce((sum, r) => sum + Number(r[c.key] || 0), 0)]))
    : null;

  const statusLabel = active === null || active === undefined ? 'Todos' : (active ? 'Ativos' : 'Inativos');
  const subtitle = [
    `Status: ${statusLabel}`,
    `Departamento: ${department || 'Todos'}`,
    `${data.length} colaborador(es)`,
    `Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
  ].join(' • ');

  return { type, title: def.title, file: def.file, subtitle, columns: def.columns, rows: data, totals };
}
