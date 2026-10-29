// ╔════════════════════════════════════════════════════════════════════╗
// ║ debtsQuery.repository.js — list / getById / getSummary             ║
// ║ Tabelas: public.debts, public.debt_payments,                       ║
// ║          public.debt_installment_plans                             ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_DEBTS, TB_PAYMENTS, TB_PLANS } from './debts.constants.js';
import { normalizeDate, normalizePaging } from './debts.utils.js';

// Colunas ordenáveis pela tela (sort_by) → expressão SQL. Nunca interpolar o valor recebido.
const SORT_COLUMNS = Object.freeze({
  code: "LPAD(COALESCE(NULLIF(code, ''), id::text), 30, '0')",
  description: 'description',
  creditor_name: 'creditor_name',
  debt_type: 'debt_type',
  due_date: 'due_date',
  original_amount: 'original_amount',
  paid_amount: 'paid_amount',
  open_amount: 'open_amount',
  status: 'status',
  installments_paid: 'installments_paid',
  installment_avg_amount: 'installment_avg_amount'
});

// Parcelas pagas = nº de parcelas distintas com pagamento; total = installment_total (mín. 1).
// Valor médio = média das parcelas previstas: valor da faixa (debt_installment_plans)
// quando a parcela está numa faixa, senão original_amount / total.
const INSTALLMENT_COLUMNS_SQL = `
        COALESCE(NULLIF(d.installment_total, 0), 1)::int AS installments_count,
        (
          SELECT COUNT(DISTINCT p.installment_number)
          FROM ${TB_PAYMENTS} p
          WHERE p.debt_id = d.id
            AND p.installment_number IS NOT NULL
        )::int AS installments_paid,
        (
          SELECT ROUND(AVG(COALESCE(pl.installment_amount,
            d.original_amount / COALESCE(NULLIF(d.installment_total, 0), 1)))::numeric, 2)
          FROM generate_series(1, COALESCE(NULLIF(d.installment_total, 0), 1)) AS gs(n)
          LEFT JOIN LATERAL (
            SELECT ip.installment_amount
            FROM ${TB_PLANS} ip
            WHERE ip.debt_id = d.id
              AND gs.n BETWEEN ip.start_installment AND ip.end_installment
            ORDER BY ip.start_installment, ip.id
            LIMIT 1
          ) pl ON true
        ) AS installment_avg_amount`;

function buildOrderBy(sortBy, sortDir) {
  const expr = SORT_COLUMNS[String(sortBy || '').trim()];

  if (!expr) {
    return `
        CASE WHEN open_amount > 0 THEN 0 ELSE 1 END,
        due_date ASC NULLS LAST,
        id DESC`;
  }

  const dir = String(sortDir || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  return `${expr} ${dir} NULLS LAST, id DESC`;
}

export async function list(filters = {}) {
  const {
    page = 1,
    limit = 20,
    q,
    status,
    debt_type,
    creditor_name,
    due_date_from,
    due_date_to,
    only_overdue,
    only_open,
    sort_by,
    sort_dir
  } = filters;

  const { safePage, safeLimit, offset } = normalizePaging(page, limit);

  const where = [];
  const params = [];
  let p = 1;

  if (q) {
    where.push(`
      (
        code ILIKE $${p}
        OR description ILIKE $${p}
        OR creditor_name ILIKE $${p}
        OR document_number ILIKE $${p}
        OR reference_number ILIKE $${p}
      )
    `);
    params.push(`%${String(q).trim()}%`);
    p++;
  }

  if (status) {
    where.push(`status = $${p}`);
    params.push(String(status).trim().toUpperCase());
    p++;
  }

  if (debt_type) {
    where.push(`debt_type = $${p}`);
    params.push(String(debt_type).trim());
    p++;
  }

  if (creditor_name) {
    where.push(`creditor_name ILIKE $${p}`);
    params.push(`%${String(creditor_name).trim()}%`);
    p++;
  }

  if (due_date_from) {
    where.push(`due_date >= $${p}`);
    params.push(normalizeDate(due_date_from));
    p++;
  }

  if (due_date_to) {
    where.push(`due_date <= $${p}`);
    params.push(normalizeDate(due_date_to));
    p++;
  }

  if (String(only_overdue) === 'true') {
    where.push(`due_date < CURRENT_DATE AND open_amount > 0`);
  }

  if (String(only_open) === 'true') {
    where.push(`open_amount > 0`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM ${TB_DEBTS}
      ${whereSql}
    `,
    params
  );

  const total = countRes.rows[0]?.total || 0;

  params.push(safeLimit, offset);

  const rowsRes = await pool.query(
    `
      SELECT
        id,
        code,
        description,
        creditor_name,
        creditor_document,
        debt_type,
        category,
        cost_center,
        company_name,
        document_number,
        reference_number,
        issue_date,
        due_date,
        agreement_closed_at,
        first_installment_due_at,
        competence_month,
        competence_year,
        original_amount,
        interest_amount,
        fine_amount,
        discount_amount,
        updated_amount,
        paid_amount,
        open_amount,
        status,
        notes,
        is_installment,
        parent_debt_id,
        installment_number,
        installment_total,
        installments_count,
        installments_paid,
        installment_avg_amount,
        created_at,
        updated_at
      FROM (
        SELECT d.*, ${INSTALLMENT_COLUMNS_SQL}
        FROM ${TB_DEBTS} d
      ) AS debts_list
      ${whereSql}
      ORDER BY ${buildOrderBy(sort_by, sort_dir)}
      LIMIT $${p} OFFSET $${p + 1}
    `,
    params
  );

  return {
    page: safePage,
    limit: safeLimit,
    total,
    pages: Math.ceil(total / safeLimit),
    rows: rowsRes.rows
  };
}

export async function getById(id) {
  const res = await pool.query(
    `
      SELECT
        id,
        code,
        description,
        creditor_name,
        creditor_document,
        debt_type,
        category,
        cost_center,
        company_name,
        document_number,
        reference_number,
        issue_date,
        due_date,
        agreement_closed_at,
        first_installment_due_at,
        competence_month,
        competence_year,
        original_amount,
        interest_amount,
        fine_amount,
        discount_amount,
        updated_amount,
        paid_amount,
        open_amount,
        status,
        notes,
        is_installment,
        parent_debt_id,
        installment_number,
        installment_total,
        due_day,
        created_at,
        updated_at
      FROM ${TB_DEBTS}
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return res.rows[0] || null;
}

export async function getSummary(filters = {}) {
  const { due_date_from, due_date_to } = filters;

  const where = [];
  const params = [];
  let p = 1;

  if (due_date_from) {
    where.push(`d.due_date >= $${p}`);
    params.push(normalizeDate(due_date_from));
    p++;
  }

  if (due_date_to) {
    where.push(`d.due_date <= $${p}`);
    params.push(normalizeDate(due_date_to));
    p++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const res = await pool.query(
    `
      WITH base AS (
        SELECT
          d.*,
          COALESCE(NULLIF(d.installment_total, 0), 1) AS total_parcelas,
          COALESCE(d.first_installment_due_at, d.due_date) AS primeira_parcela,
          COALESCE(NULLIF(d.due_day, 0), 31) AS dia_vencimento
        FROM ${TB_DEBTS} d
        ${whereSql}
      ),

      parcelas AS (
        SELECT
          b.id AS debt_id,
          gs.parcela AS installment_number,

          (
            DATE_TRUNC('month', b.primeira_parcela)
            + ((gs.parcela - 1) * INTERVAL '1 month')
            + (
              LEAST(
                b.dia_vencimento,
                EXTRACT(
                  DAY FROM (
                    DATE_TRUNC('month', b.primeira_parcela)
                    + ((gs.parcela) * INTERVAL '1 month')
                    - INTERVAL '1 day'
                  )
                )::int
              ) - 1
            ) * INTERVAL '1 day'
          )::date AS installment_due_date,

          ROUND((b.original_amount / b.total_parcelas)::numeric, 2) AS installment_amount,

          EXISTS (
            SELECT 1
            FROM ${TB_PAYMENTS} p
            WHERE p.debt_id = b.id
              AND p.installment_number = gs.parcela
          ) AS is_paid
        FROM base b
        CROSS JOIN LATERAL generate_series(1, b.total_parcelas) AS gs(parcela)
      )

      SELECT
        COUNT(*)::int AS total_debts,

        COALESCE(SUM(b.original_amount), 0)::numeric(14,2) AS total_original,
        COALESCE(SUM(b.updated_amount), 0)::numeric(14,2) AS total_updated,
        COALESCE(SUM(b.paid_amount), 0)::numeric(14,2) AS total_paid,
        COALESCE(SUM(b.open_amount), 0)::numeric(14,2) AS total_open,

        COALESCE((
          SELECT SUM(p.installment_amount)
          FROM parcelas p
          WHERE p.installment_due_date < CURRENT_DATE
            AND p.is_paid = false
        ), 0)::numeric(14,2) AS total_overdue,

        COALESCE((
          SELECT SUM(p.installment_amount)
          FROM parcelas p
          WHERE p.installment_due_date = CURRENT_DATE
            AND p.is_paid = false
        ), 0)::numeric(14,2) AS due_today,

        COALESCE(SUM(b.paid_amount), 0)::numeric(14,2) AS total_fully_paid,

        COUNT(*) FILTER (WHERE b.open_amount > 0)::int AS count_open,
        COUNT(*) FILTER (WHERE b.status = 'PARCIAL')::int AS count_partial,
        COUNT(*) FILTER (WHERE b.open_amount <= 0)::int AS count_paid,

        COALESCE((
          SELECT COUNT(*)
          FROM parcelas p
          WHERE p.installment_due_date < CURRENT_DATE
            AND p.is_paid = false
        ), 0)::int AS count_overdue

      FROM base b
    `,
    params
  );

  return res.rows[0];
}
