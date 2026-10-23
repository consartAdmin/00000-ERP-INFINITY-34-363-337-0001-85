// ╔════════════════════════════════════════════════════════════════════╗
// ║ payrollCharges.payables.js — Encargos do mês → Contas a Pagar      ║
// ║ CONSART ERP                                                        ║
// ║                                                                    ║
// ║ • preview: monta as linhas da competência (salários, guias INSS,   ║
// ║   FGTS, IRRF e benefícios) com favorecido/categoria memorizados    ║
// ║   e vencimentos legais sugeridos                                   ║
// ║ • generate: cria os títulos em public."accountsPayable" sem        ║
// ║   duplicar (payrollChargesPayables guarda competência + linha).    ║
// ║   O pagamento segue no Contas a Pagar, que lança a saída no Caixa. ║
// ║ • Salários: um título por colaborador (fornecedor pelo CPF; cria   ║
// ║   se não existir) ou um título só com a folha líquida.             ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_SETTINGS, TB_PAYABLES, ensurePayrollChargesTables } from './payrollCharges.schema.js';
import { monthReport, getSettings } from './payrollCharges.repository.js';
import { round2 } from './payrollCharges.calc.js';

const TB_AP = 'public."accountsPayable"';
const TB_SUPPLIERS = 'public.suppliers';
const TB_EMPLOYEES = 'public.employees';

export const SALARY_MODES = Object.freeze({
  PER_EMPLOYEE: 'Um título por colaborador',
  SINGLE: 'Um título com a folha líquida',
});

// Linhas fixas: composição exibida na tela e vencimento sugerido
const GUIDE_LINES = [
  { key: 'INSS', title: 'INSS — DCTFWeb', columns: 'INSS (desc.) + INSS patronal + RAT + Terc.', guide: 'inss', due: 'DAY_20' },
  { key: 'FGTS', title: 'FGTS Digital', columns: 'FGTS', guide: 'fgts', due: 'DAY_20' },
  { key: 'IRRF', title: 'DARF IRRF 0561', columns: 'IRRF (desc.)', guide: 'irrf', due: 'DAY_20' },
];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function iso(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// Feriados nacionais de data fixa (MM-DD); os móveis ficam por conta do usuário
const FIXED_HOLIDAYS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isNonBusinessDay(date) {
  return isWeekend(date) || FIXED_HOLIDAYS.includes(iso(date).slice(5));
}

/** Vencimento sugerido no mês seguinte à competência. */
export function suggestedDueDate(competence, rule) {
  const [year, month] = competence.split('-').map(Number);
  if (rule === 'BUSINESS_DAY_5') {
    // salário: até o 5º dia útil (sábado conta como útil pela CLT; aqui só seg–sex, a favor do caixa)
    let count = 0;
    const date = new Date(Date.UTC(year, month, 1));
    for (;;) {
      if (!isNonBusinessDay(date)) count += 1;
      if (count === 5) return iso(date);
      date.setUTCDate(date.getUTCDate() + 1);
    }
  }
  // DCTFWeb, FGTS Digital e IRRF: dia 20, antecipando se não for dia útil
  const date = new Date(Date.UTC(year, month, 20));
  while (isNonBusinessDay(date)) date.setUTCDate(date.getUTCDate() - 1);
  return iso(date);
}

function competenceLabel(competence) {
  const [year, month] = competence.split('-');
  return `${month}/${year}`;
}

// ======================================================================
// LEITURAS AUXILIARES
// ======================================================================

/** Categorias e subcategorias do Caixa (as mesmas do Contas a Pagar). */
export async function listCashCategories() {
  const [{ rows: categories }, { rows: subcategories }] = await Promise.all([
    pool.query(`SELECT id, nome FROM public."cashCategories" WHERE is_active IS NOT FALSE ORDER BY nome`),
    pool.query(`SELECT id, categoria_id, nome FROM public."cashSubcategories" WHERE is_active IS NOT FALSE ORDER BY nome`),
  ]);
  return { categories, subcategories };
}

async function suppliersByIds(ids) {
  const list = [...new Set(ids.filter(Boolean).map(Number))];
  if (!list.length) return new Map();
  const { rows } = await pool.query(`SELECT supplier_id, name FROM ${TB_SUPPLIERS} WHERE supplier_id = ANY($1::int[])`, [list]);
  return new Map(rows.map((row) => [Number(row.supplier_id), row.name]));
}

/** Fornecedor com o mesmo CPF do colaborador (só dígitos). */
async function suppliersByCpf(cpfs) {
  const list = [...new Set(cpfs.map(onlyDigits).filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (doc) supplier_id, name, doc
       FROM (SELECT supplier_id, name, regexp_replace(COALESCE(tax_id, ''), '\\D', '', 'g') AS doc
               FROM ${TB_SUPPLIERS}) s
      WHERE doc = ANY($1::text[])
      ORDER BY doc, supplier_id`,
    [list],
  );
  return new Map(rows.map((row) => [row.doc, { supplier_id: Number(row.supplier_id), name: row.name }]));
}

/** Títulos já gerados na competência (ignora vínculos cujo título foi excluído). */
async function existingLinks(competence) {
  const { rows } = await pool.query(
    `SELECT p.line_key, p.account_payable_id, p.amount, ap.status
       FROM ${TB_PAYABLES} p
       JOIN ${TB_AP} ap ON ap.id = p.account_payable_id
      WHERE p.competence = $1`,
    [competence],
  );
  return new Map(rows.map((row) => [row.line_key, row]));
}

// ======================================================================
// PREVIEW
// ======================================================================

export async function preview(query = {}) {
  await ensurePayrollChargesTables();
  const report = await monthReport({ competence: query.competence });
  const { competence } = report;
  const settings = await getSettings();
  const defaults = settings.payables_defaults || {};
  const lineDefaults = defaults.lines || {};
  const salaryMode = SALARY_MODES[query.salary_mode] ? query.salary_mode
    : (SALARY_MODES[defaults.salary_mode] ? defaults.salary_mode : 'PER_EMPLOYEE');

  const links = await existingLinks(competence);
  const perEmployeeDone = [...links.keys()].some((key) => key.startsWith('SALARY:'));
  const singleDone = links.has('SALARY_TOTAL');
  const label = competenceLabel(competence);

  // CPF dos colaboradores para achar o fornecedor
  const ids = report.rows.map((row) => row.employee_id);
  const { rows: employees } = ids.length
    ? await pool.query(`SELECT employee_id, cpf FROM ${TB_EMPLOYEES} WHERE employee_id = ANY($1::int[])`, [ids])
    : { rows: [] };
  const cpfById = new Map(employees.map((e) => [Number(e.employee_id), e.cpf]));
  const byCpf = await suppliersByCpf(employees.map((e) => e.cpf));

  const lines = [];
  const salaryDue = suggestedDueDate(competence, 'BUSINESS_DAY_5');

  if (salaryMode === 'PER_EMPLOYEE') {
    const def = lineDefaults.SALARY || {};
    report.rows.filter((row) => row.net > 0).forEach((row) => {
      const supplier = byCpf.get(onlyDigits(cpfById.get(Number(row.employee_id))));
      lines.push({
        key: `SALARY:${row.employee_id}`,
        title: `Salário líquido — ${row.full_name}`,
        columns: 'Líquido',
        amount: row.net,
        due_date: salaryDue,
        supplier_id: supplier?.supplier_id || null,
        supplier_name: supplier?.name || null,
        supplier_hint: supplier ? null : `Será cadastrado: ${row.full_name}`,
        category_id: def.category_id || null,
        subcategory_id: def.subcategory_id || null,
        blocked: singleDone ? 'Folha já gerada em um título único' : null,
      });
    });
  } else {
    const def = lineDefaults.SALARY_TOTAL || {};
    lines.push({
      key: 'SALARY_TOTAL',
      title: `Folha líquida ${label}`,
      columns: `Líquido (${report.rows.filter((row) => row.net > 0).length} colaboradores)`,
      amount: report.guides.net_payroll,
      due_date: salaryDue,
      supplier_id: def.supplier_id || null,
      supplier_name: null,
      supplier_hint: null,
      category_id: def.category_id || null,
      subcategory_id: def.subcategory_id || null,
      blocked: perEmployeeDone ? 'Salários já gerados por colaborador' : null,
    });
  }

  GUIDE_LINES.forEach((guide) => {
    const def = lineDefaults[guide.key] || {};
    lines.push({
      key: guide.key,
      title: `${guide.title} ${label}`,
      columns: guide.columns,
      amount: report.guides[guide.guide],
      due_date: suggestedDueDate(competence, guide.due),
      supplier_id: def.supplier_id || null,
      supplier_name: null,
      supplier_hint: null,
      category_id: def.category_id || null,
      subcategory_id: def.subcategory_id || null,
      blocked: null,
    });
  });

  const benefitDefaults = lineDefaults.BENEFITS || {};
  lines.push({
    key: 'BENEFITS',
    title: `Benefícios ${label}`,
    columns: 'Benefícios (VT, VA, VR, saúde)',
    amount: report.totals.benefits,
    due_date: salaryDue,
    supplier_id: benefitDefaults.supplier_id || null,
    supplier_name: null,
    supplier_hint: null,
    category_id: benefitDefaults.category_id || null,
    subcategory_id: benefitDefaults.subcategory_id || null,
    blocked: null,
  });

  // Nome dos fornecedores memorizados
  const names = await suppliersByIds(lines.map((line) => line.supplier_id));
  lines.forEach((line) => {
    if (line.supplier_id && !line.supplier_name) line.supplier_name = names.get(Number(line.supplier_id)) || null;
    if (line.supplier_id && !names.has(Number(line.supplier_id)) && !line.supplier_name) line.supplier_id = null;
    const link = links.get(line.key);
    line.account_payable_id = link ? Number(link.account_payable_id) : null;
    line.account_payable_status = link?.status || null;
    line.amount = round2(line.amount);
  });

  return {
    competence,
    salary_mode: salaryMode,
    salary_modes: SALARY_MODES,
    lines: lines.filter((line) => line.amount > 0 || line.account_payable_id),
  };
}

// ======================================================================
// GERAR TÍTULOS
// ======================================================================

/** Acha o fornecedor pelo CPF ou cria (mesmo padrão das despesas). */
async function supplierForEmployee(client, employeeId) {
  const { rows } = await client.query(`SELECT full_name, cpf, email, phone, mobile FROM ${TB_EMPLOYEES} WHERE employee_id = $1`, [employeeId]);
  const employee = rows[0];
  if (!employee) throw httpError(404, `Colaborador ${employeeId} não encontrado.`);
  const cpf = onlyDigits(employee.cpf);

  if (cpf) {
    const found = await client.query(
      `SELECT supplier_id FROM ${TB_SUPPLIERS}
        WHERE regexp_replace(COALESCE(tax_id, ''), '\\D', '', 'g') = $1
        ORDER BY supplier_id LIMIT 1`,
      [cpf],
    );
    if (found.rowCount) return Number(found.rows[0].supplier_id);
  }

  const created = await client.query(
    `INSERT INTO ${TB_SUPPLIERS} (name, tax_id, phone, email)
     VALUES ($1, $2, $3, $4) RETURNING supplier_id`,
    [String(employee.full_name).toUpperCase(), cpf || null, employee.mobile || employee.phone || null, employee.email || null],
  );
  return Number(created.rows[0].supplier_id);
}

function toIntOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function generate(input = {}, user = {}) {
  const current = await preview({ competence: input.competence, salary_mode: input.salary_mode });
  const { competence, salary_mode: salaryMode } = current;
  const requested = new Map((Array.isArray(input.lines) ? input.lines : []).map((line) => [line.key, line]));
  if (!requested.size) throw httpError(400, 'Selecione ao menos um título.');

  const todo = current.lines.filter((line) => requested.has(line.key));
  const problems = [];
  todo.forEach((line) => {
    const req = requested.get(line.key);
    if (line.account_payable_id) problems.push(`${line.title}: já gerado (título nº ${line.account_payable_id}).`);
    else if (line.blocked) problems.push(`${line.title}: ${line.blocked}.`);
    else if (!(line.amount > 0)) problems.push(`${line.title}: sem valor.`);
    else if (!line.key.startsWith('SALARY:') && !toIntOrNull(req.supplier_id)) problems.push(`${line.title}: escolha o favorecido.`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.due_date || ''))) problems.push(`${line.title}: vencimento inválido.`);
  });
  if (problems.length) throw httpError(400, problems.join('\n'));

  const label = competenceLabel(competence);
  const client = await pool.connect();
  const created = [];

  try {
    await client.query('BEGIN');
    // vínculos de títulos excluídos no Contas a Pagar liberam a linha de novo
    await client.query(
      `DELETE FROM ${TB_PAYABLES} p
        WHERE p.competence = $1
          AND NOT EXISTS (SELECT 1 FROM ${TB_AP} ap WHERE ap.id = p.account_payable_id)`,
      [competence],
    );

    for (const line of todo) {
      const req = requested.get(line.key);
      let supplierId = toIntOrNull(req.supplier_id);
      if (!supplierId && line.key.startsWith('SALARY:')) {
        supplierId = await supplierForEmployee(client, Number(line.key.split(':')[1]));
      }

      const { rows } = await client.query(
        `INSERT INTO ${TB_AP} (
           supplier_id, invoice_number, issue_date, due_date, payment_date, payment_method_id,
           description, category_id, subcategory_id, document_number, total_value, amount_paid,
           status, notes, attachment_url, source_type, source_id, created_at, updated_at
         ) VALUES ($1, NULL, CURRENT_DATE, $2, NULL, NULL, $3, $4, $5, $6, $7, 0,
                   'PENDING', $8, NULL, 'PAYROLL', NULL, NOW(), NOW())
         RETURNING id`,
        [
          supplierId,
          req.due_date,
          line.title,
          toIntOrNull(req.category_id),
          toIntOrNull(req.subcategory_id),
          `FOLHA ${label}`,
          line.amount,
          `Gerado em Encargos e Rescisões (competência ${label}): ${line.columns}.`,
        ],
      );
      const payableId = Number(rows[0].id);

      await client.query(
        `INSERT INTO ${TB_PAYABLES} (competence, line_key, account_payable_id, amount, created_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [competence, line.key, payableId, line.amount, user.name || null],
      );
      created.push({ key: line.key, title: line.title, account_payable_id: payableId, amount: line.amount });
    }

    // memoriza favorecido/categoria por tipo de linha e o modo dos salários
    const settings = await getSettings();
    const defaults = settings.payables_defaults || {};
    const lines = { ...(defaults.lines || {}) };
    todo.forEach((line) => {
      const req = requested.get(line.key);
      const group = line.key.startsWith('SALARY:') ? 'SALARY' : line.key;
      lines[group] = {
        supplier_id: group === 'SALARY' ? null : toIntOrNull(req.supplier_id),
        category_id: toIntOrNull(req.category_id),
        subcategory_id: toIntOrNull(req.subcategory_id),
      };
    });
    await client.query(
      `UPDATE ${TB_SETTINGS} SET payables_defaults = $1::jsonb, updated_at = NOW() WHERE id = 1`,
      [JSON.stringify({ salary_mode: salaryMode, lines })],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error?.code === '23505') throw httpError(409, 'Algum título já foi gerado por outra pessoa. Recarregue a lista.');
    throw error;
  } finally {
    client.release();
  }

  return {
    competence,
    created,
    total: round2(created.reduce((sum, item) => sum + item.amount, 0)),
  };
}
