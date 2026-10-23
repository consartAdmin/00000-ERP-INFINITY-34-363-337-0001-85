// ╔════════════════════════════════════════════════════════════════════╗
// ║ payrollCharges.schema.js — Encargos e Rescisões (CONSART ERP)      ║
// ║ Tabelas:                                                           ║
// ║   public."payrollTaxTables"       → INSS/IRRF por ano (editável)   ║
// ║   public."payrollChargesSettings" → regime e alíquotas da empresa  ║
// ║   public."payrollTerminations"    → simulações de rescisão         ║
// ║   public."payrollChargesPayables" → títulos gerados no Contas a    ║
// ║                                     Pagar (competência + linha)    ║
// ║ • Colaboradores vêm de public.employees (salário, admissão,        ║
// ║   dependentes, benefícios).                                        ║
// ║ • Roda uma vez por boot (primeira chamada do repositório).         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { ensureTable as ensureEmployeesTable } from '../employees/employeesSchema.repository.js';

export const TB_TABLES = 'public."payrollTaxTables"';
export const TB_SETTINGS = 'public."payrollChargesSettings"';
export const TB_TERMINATIONS = 'public."payrollTerminations"';
export const TB_PAYABLES = 'public."payrollChargesPayables"';

const IRRF_BRACKETS = [
  { limit: 2428.80, rate: 0, deduction: 0 },
  { limit: 2826.65, rate: 7.5, deduction: 182.16 },
  { limit: 3751.05, rate: 15, deduction: 394.16 },
  { limit: 4664.68, rate: 22.5, deduction: 675.49 },
  { limit: null, rate: 27.5, deduction: 908.73 },
];

// Tabelas oficiais de partida; o usuário edita na tela (botão "Tabelas")
export const DEFAULT_TABLES = [
  {
    year: 2025,
    min_wage: 1518.00,
    inss_brackets: [
      { limit: 1518.00, rate: 7.5 },
      { limit: 2793.88, rate: 9 },
      { limit: 4190.83, rate: 12 },
      { limit: 8157.41, rate: 14 },
    ],
    irrf_brackets: IRRF_BRACKETS,
    irrf_dependent: 189.59,
    irrf_simplified: 607.20,
    irrf_reduction: null,
  },
  {
    year: 2026,
    min_wage: 1621.00,
    inss_brackets: [
      { limit: 1621.00, rate: 7.5 },
      { limit: 2902.84, rate: 9 },
      { limit: 4354.27, rate: 12 },
      { limit: 8475.55, rate: 14 },
    ],
    irrf_brackets: IRRF_BRACKETS,
    irrf_dependent: 189.59,
    irrf_simplified: 607.20,
    // Lei 15.270/2025: zera até 5.000; entre 5.000,01 e 7.350 reduz 978,62 − 0,133145 × renda
    irrf_reduction: { full_limit: 5000, partial_limit: 7350, a: 978.62, b: 0.133145 },
  },
];

let ready = null;

export function ensurePayrollChargesTables() {
  if (!ready) {
    ready = createTables().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function createTables() {
  await ensureEmployeesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_TABLES} (
      year             INTEGER PRIMARY KEY,
      min_wage         NUMERIC(12,2) NOT NULL DEFAULT 0,
      inss_brackets    JSONB NOT NULL DEFAULT '[]'::jsonb,
      irrf_brackets    JSONB NOT NULL DEFAULT '[]'::jsonb,
      irrf_dependent   NUMERIC(12,2) NOT NULL DEFAULT 0,
      irrf_simplified  NUMERIC(12,2) NOT NULL DEFAULT 0,
      irrf_reduction   JSONB,
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${TB_SETTINGS} (
      id             INTEGER PRIMARY KEY DEFAULT 1,
      regime         VARCHAR(30) NOT NULL DEFAULT 'LUCRO_PRESUMIDO',
      patronal_rate  NUMERIC(6,2) NOT NULL DEFAULT 20,
      rat_fap_rate   NUMERIC(6,2) NOT NULL DEFAULT 2,
      third_rate     NUMERIC(6,2) NOT NULL DEFAULT 5.8,
      fgts_rate      NUMERIC(6,2) NOT NULL DEFAULT 8,
      updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "payrollChargesSettings_single" CHECK (id = 1)
    );

    INSERT INTO ${TB_SETTINGS} (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    -- Favorecido/categoria memorizados por linha + modo dos salários
    ALTER TABLE ${TB_SETTINGS}
      ADD COLUMN IF NOT EXISTS payables_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS ${TB_PAYABLES} (
      id                  BIGSERIAL PRIMARY KEY,
      competence          CHAR(7) NOT NULL,
      line_key            VARCHAR(40) NOT NULL,
      account_payable_id  INTEGER NOT NULL,
      amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_by_name     VARCHAR(150),
      created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "payrollChargesPayables_line_uk" UNIQUE (competence, line_key)
    );

    CREATE TABLE IF NOT EXISTS ${TB_TERMINATIONS} (
      id                BIGSERIAL PRIMARY KEY,
      employee_id       INTEGER NOT NULL,
      employee_name     VARCHAR(150),
      termination_date  DATE NOT NULL,
      reason            VARCHAR(30) NOT NULL,
      notice_type       VARCHAR(20),
      input             JSONB NOT NULL DEFAULT '{}'::jsonb,
      result            JSONB NOT NULL DEFAULT '{}'::jsonb,
      net_total         NUMERIC(14,2) NOT NULL DEFAULT 0,
      cost_total        NUMERIC(14,2) NOT NULL DEFAULT 0,
      status            VARCHAR(20) NOT NULL DEFAULT 'SIMULACAO',
      created_by        INTEGER,
      created_by_name   VARCHAR(150),
      created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      confirmed_at      TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS "payrollTerminations_employee_idx"
      ON ${TB_TERMINATIONS} (employee_id, created_at DESC);
  `);

  for (const table of DEFAULT_TABLES) {
    await pool.query(
      `INSERT INTO ${TB_TABLES}
         (year, min_wage, inss_brackets, irrf_brackets, irrf_dependent, irrf_simplified, irrf_reduction)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb)
       ON CONFLICT (year) DO NOTHING`,
      [
        table.year,
        table.min_wage,
        JSON.stringify(table.inss_brackets),
        JSON.stringify(table.irrf_brackets),
        table.irrf_dependent,
        table.irrf_simplified,
        table.irrf_reduction ? JSON.stringify(table.irrf_reduction) : null,
      ],
    );
  }
}
