/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: debtsApi.js                                                   ║
   ║ MODULE: Debts DAL/API                                               ║
   ║ DESCRIPTION: Access layer for debts                                 ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../config/db.js';

const TB_DEBTS = 'public.debts';
const TB_PAYMENTS = 'public.debt_payments';

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;

  let v = String(value)
    .trim()
    .replace(/[R$\s]/g, '');

  if (v.includes(',')) {
    v = v.replace(/\./g, '').replace(',', '.');
  }

  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function safeText(value, max = 255) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizeDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) return null;

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

function normalizeMonth(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

function normalizeYear(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 2000 && n <= 9999 ? n : null;
}

function computeUpdatedAmount({
  original_amount = 0,
  interest_amount = 0,
  fine_amount = 0,
  discount_amount = 0
}) {
  return roundMoney(
    roundMoney(original_amount) +
    roundMoney(interest_amount) +
    roundMoney(fine_amount) -
    roundMoney(discount_amount)
  );
}

function computeOpenAmount(updatedAmount, paidAmount) {
  return roundMoney(Math.max(roundMoney(updatedAmount) - roundMoney(paidAmount), 0));
}

function computeStatus({ due_date, paid_amount, open_amount }) {
  const open = roundMoney(open_amount);
  const paid = roundMoney(paid_amount);

  if (open <= 0) return 'PAGO';
  if (paid > 0 && open > 0) return 'PARCIAL';

  if (due_date) {
    const due = new Date(due_date);
    due.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (due < today && open > 0) return 'VENCIDO';
  }

  return 'EM_ABERTO';
}

function normalizePaging(page = 1, limit = 20) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const offset = (safePage - 1) * safeLimit;

  return { safePage, safeLimit, offset };
}

function buildFirstDueDateFromIssue(issueDateValue, dueDayValue) {
  const issueDate = normalizeDate(issueDateValue);
  const dueDay = Number(dueDayValue);

  if (!issueDate || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return null;
  }

  const base = new Date(`${issueDate}T00:00:00`);
  const year = base.getFullYear();
  const month = base.getMonth() + 1;

  const lastDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(dueDay, lastDay);

  let dueDate = new Date(year, month - 1, safeDay);

  if (dueDate < base) {
    const nextMonthRaw = month + 1;
    const nextYear = nextMonthRaw > 12 ? year + 1 : year;
    const nextMonth = nextMonthRaw > 12 ? 1 : nextMonthRaw;
    const nextLastDay = new Date(nextYear, nextMonth, 0).getDate();

    dueDate = new Date(nextYear, nextMonth - 1, Math.min(dueDay, nextLastDay));
  }

  return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(
    dueDate.getDate()
  ).padStart(2, '0')}`;
}

function mapDebtPayload(payload = {}) {
  const originalAmount = roundMoney(payload.original_amount);
  const interestAmount = roundMoney(payload.interest_amount);
  const fineAmount = roundMoney(payload.fine_amount);
  const discountAmount = roundMoney(payload.discount_amount);
  const paidAmount = roundMoney(payload.paid_amount);

  const updatedAmount = computeUpdatedAmount({
    original_amount: originalAmount,
    interest_amount: interestAmount,
    fine_amount: fineAmount,
    discount_amount: discountAmount
  });

  const openAmount = computeOpenAmount(updatedAmount, paidAmount);

  const dueDate =
    normalizeDate(payload.due_date) ||
    normalizeDate(payload.first_installment_due_at) ||
    buildFirstDueDateFromIssue(payload.issue_date, payload.due_day);

  const status =
    safeText(payload.status, 30) ||
    computeStatus({
      due_date: dueDate,
      paid_amount: paidAmount,
      open_amount: openAmount
    });

  return {
    code: safeText(payload.code, 30),
    description: safeText(payload.description, 255),
    creditor_name: safeText(payload.creditor_name, 200),
    creditor_document: safeText(payload.creditor_document, 20),
    debt_type: safeText(payload.debt_type, 50),
    category: safeText(payload.category, 100),
    cost_center: safeText(payload.cost_center, 100),
    company_name: safeText(payload.company_name, 150),
    document_number: safeText(payload.document_number, 50),
    reference_number: safeText(payload.reference_number, 50),

    issue_date: normalizeDate(payload.issue_date),
    due_date: dueDate,
    agreement_closed_at: normalizeDate(payload.agreement_closed_at),
    first_installment_due_at: normalizeDate(payload.first_installment_due_at),
    competence_month: normalizeMonth(payload.competence_month),
    competence_year: normalizeYear(payload.competence_year),

    original_amount: originalAmount,
    interest_amount: interestAmount,
    fine_amount: fineAmount,
    discount_amount: discountAmount,
    updated_amount: updatedAmount,
    paid_amount: paidAmount,
    open_amount: openAmount,

    status,
    notes: safeText(payload.notes, 5000),

    is_installment: Boolean(payload.is_installment),
    parent_debt_id: payload.parent_debt_id ? Number(payload.parent_debt_id) : null,
    installment_number: payload.installment_number ? Number(payload.installment_number) : null,
    installment_total: payload.installment_total ? Number(payload.installment_total) : null,
    due_day: payload.due_day ? Number(payload.due_day) : null
  };
}

async function recalcDebtById(debtId, client = pool) {
  const debtRes = await client.query(
    `
      SELECT
        id,
        due_date,
        original_amount,
        interest_amount,
        fine_amount,
        discount_amount
      FROM ${TB_DEBTS}
      WHERE id = $1
      LIMIT 1
    `,
    [debtId]
  );

  if (!debtRes.rows.length) {
    throw new Error('Dívida não encontrada.');
  }

  const debt = debtRes.rows[0];

  const payRes = await client.query(
    `
      SELECT
        COALESCE(SUM(amount + interest_amount + fine_amount - discount_amount), 0) AS total_paid_effective
      FROM ${TB_PAYMENTS}
      WHERE debt_id = $1
    `,
    [debtId]
  );

  const paidAmount = roundMoney(payRes.rows[0]?.total_paid_effective || 0);
  const updatedAmount = computeUpdatedAmount(debt);
  const openAmount = computeOpenAmount(updatedAmount, paidAmount);

  const status = computeStatus({
    due_date: debt.due_date,
    paid_amount: paidAmount,
    open_amount: openAmount
  });

  const updRes = await client.query(
    `
      UPDATE ${TB_DEBTS}
      SET
        updated_amount = $2,
        paid_amount = $3,
        open_amount = $4,
        status = $5,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [debtId, updatedAmount, paidAmount, openAmount, status]
  );

  return updRes.rows[0];
}

/* ──────────────────────────────────────────────────────────────────────
 * Queries
 * ────────────────────────────────────────────────────────────────────── */

async function list(filters = {}) {
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
    only_open
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
        created_at,
        updated_at
      FROM ${TB_DEBTS}
      ${whereSql}
      ORDER BY
        CASE WHEN open_amount > 0 THEN 0 ELSE 1 END,
        due_date ASC NULLS LAST,
        id DESC
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

async function getById(id) {
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

async function create(payload = {}) {
  const data = mapDebtPayload(payload);

  if (!data.description) {
    throw new Error('description é obrigatório.');
  }

  if (!data.debt_type) {
    throw new Error('debt_type é obrigatório.');
  }

  if (!data.due_date) {
    throw new Error('due_date é obrigatório.');
  }

  if (data.original_amount <= 0) {
    throw new Error('original_amount deve ser maior que zero.');
  }

  const res = await pool.query(
    `
      INSERT INTO ${TB_DEBTS} (
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
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),NOW()
      )
      RETURNING *
    `,
    [
      data.code,
      data.description,
      data.creditor_name,
      data.creditor_document,
      data.debt_type,
      data.category,
      data.cost_center,
      data.company_name,
      data.document_number,
      data.reference_number,
      data.issue_date,
      data.due_date,
      data.agreement_closed_at,
      data.first_installment_due_at,
      data.competence_month,
      data.competence_year,
      data.original_amount,
      data.interest_amount,
      data.fine_amount,
      data.discount_amount,
      data.updated_amount,
      data.paid_amount,
      data.open_amount,
      data.status,
      data.notes,
      data.is_installment,
      data.parent_debt_id,
      data.installment_number,
      data.installment_total
    ]
  );

  return res.rows[0];
}

async function update(id, payload = {}) {
  const current = await getById(id);
  if (!current) throw new Error('Dívida não encontrada.');

  const merged = {
    ...current,
    ...payload
  };

  const data = mapDebtPayload(merged);

  if (!data.description) {
    throw new Error('description é obrigatório.');
  }

  if (!data.debt_type) {
    throw new Error('debt_type é obrigatório.');
  }

  if (!data.due_date) {
    throw new Error('due_date é obrigatório.');
  }

  if (data.original_amount <= 0) {
    throw new Error('original_amount deve ser maior que zero.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE ${TB_DEBTS}
        SET
          code = $2,
          description = $3,
          creditor_name = $4,
          creditor_document = $5,
          debt_type = $6,
          category = $7,
          cost_center = $8,
          company_name = $9,
          document_number = $10,
          reference_number = $11,
          issue_date = $12,
          due_date = $13,
          agreement_closed_at = $14,
          first_installment_due_at = $15,
          competence_month = $16,
          competence_year = $17,
          original_amount = $18,
          interest_amount = $19,
          fine_amount = $20,
          discount_amount = $21,
          notes = $22,
          is_installment = $23,
          parent_debt_id = $24,
          installment_number = $25,
          installment_total = $26,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        id,
        data.code,
        data.description,
        data.creditor_name,
        data.creditor_document,
        data.debt_type,
        data.category,
        data.cost_center,
        data.company_name,
        data.document_number,
        data.reference_number,
        data.issue_date,
        data.due_date,
        data.agreement_closed_at,
        data.first_installment_due_at,
        data.competence_month,
        data.competence_year,
        data.original_amount,
        data.interest_amount,
        data.fine_amount,
        data.discount_amount,
        data.notes,
        data.is_installment,
        data.parent_debt_id,
        data.installment_number,
        data.installment_total
      ]
    );

    const debt = await recalcDebtById(id, client);

    await client.query('COMMIT');
    return debt;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function remove(id) {
  const current = await getById(id);
  if (!current) throw new Error('Dívida não encontrada.');

  const payRes = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM ${TB_PAYMENTS}
      WHERE debt_id = $1
    `,
    [id]
  );

  const paymentsCount = payRes.rows[0]?.total || 0;

  if (paymentsCount > 0) {
    throw new Error('Não é possível excluir a dívida porque existem pagamentos vinculados.');
  }

  const childRes = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM ${TB_DEBTS}
      WHERE parent_debt_id = $1
    `,
    [id]
  );

  const childrenCount = childRes.rows[0]?.total || 0;

  if (childrenCount > 0) {
    throw new Error('Não é possível excluir a dívida porque existem parcelas vinculadas.');
  }

  await pool.query(`DELETE FROM ${TB_DEBTS} WHERE id = $1`, [id]);

  return { deleted: true, id: Number(id) };
}

async function getSummary(filters = {}) {
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

function buildDueDate(year, month, day) {
  const lastDay = new Date(year, month, 0).getDate();

  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(
    2,
    '0'
  )}`;
}

async function createInstallments(payload = {}) {
  const description = safeText(payload.description, 255);
  const debtType = safeText(payload.debt_type, 50);

  const agreementClosedAt = normalizeDate(payload.agreement_closed_at);

  const firstInstallmentDueAt =
    normalizeDate(payload.first_installment_due_at) ||
    normalizeDate(payload.first_due_date) ||
    normalizeDate(payload.due_date) ||
    buildFirstDueDateFromIssue(payload.issue_date, payload.due_day);

  const dueDate = firstInstallmentDueAt;

  const installments = Number(payload.installment_total || payload.installments || 0);
  const totalAmount = roundMoney(payload.total_amount || payload.original_amount);

  if (!description) throw new Error('description é obrigatório.');
  if (!debtType) throw new Error('debt_type é obrigatório.');
  if (!dueDate) throw new Error('first_due_date é obrigatório.');

  if (!Number.isInteger(installments) || installments <= 0) {
    throw new Error('installment_total inválido.');
  }

  if (totalAmount <= 0) {
    throw new Error('total_amount deve ser maior que zero.');
  }

  const baseData = {
    code: safeText(payload.code, 30),
    description,
    creditor_name: safeText(payload.creditor_name, 200),
    creditor_document: safeText(payload.creditor_document, 20),
    debt_type: debtType,
    category: safeText(payload.category, 100),
    cost_center: safeText(payload.cost_center, 100),
    company_name: safeText(payload.company_name, 150),
    document_number: safeText(payload.document_number, 50),
    reference_number: safeText(payload.reference_number, 50),
    issue_date: normalizeDate(payload.issue_date),
    agreement_closed_at: agreementClosedAt,
    first_installment_due_at: firstInstallmentDueAt,
    competence_month: normalizeMonth(payload.competence_month),
    competence_year: normalizeYear(payload.competence_year),
    interest_amount: 0,
    fine_amount: 0,
    discount_amount: 0,
    notes: safeText(payload.notes, 5000),
    is_installment: true
  };

  const eachRaw = roundMoney(totalAmount / installments);
  const generated = [];

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let parentDebtId = null;
    let runningTotal = 0;

    for (let i = 1; i <= installments; i++) {
      const dt = new Date(`${dueDate}T00:00:00`);
      dt.setMonth(dt.getMonth() + (i - 1));

      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const installmentDueDate = `${y}-${m}-${d}`;

      let installmentValue = eachRaw;

      if (i < installments) {
        runningTotal = roundMoney(runningTotal + installmentValue);
      } else {
        installmentValue = roundMoney(totalAmount - runningTotal);
      }

      const updatedAmount = computeUpdatedAmount({
        original_amount: installmentValue,
        interest_amount: 0,
        fine_amount: 0,
        discount_amount: 0
      });

      const openAmount = computeOpenAmount(updatedAmount, 0);

      const status = computeStatus({
        due_date: installmentDueDate,
        paid_amount: 0,
        open_amount: openAmount
      });

      const res = await client.query(
        `
          INSERT INTO ${TB_DEBTS} (
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
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),NOW()
          )
          RETURNING *
        `,
        [
          baseData.code ? `${baseData.code}-${String(i).padStart(2, '0')}` : null,
          `${baseData.description} (${i}/${installments})`,
          baseData.creditor_name,
          baseData.creditor_document,
          baseData.debt_type,
          baseData.category,
          baseData.cost_center,
          baseData.company_name,
          baseData.document_number,
          baseData.reference_number,
          baseData.issue_date,
          installmentDueDate,
          baseData.agreement_closed_at,
          baseData.first_installment_due_at,
          baseData.competence_month,
          baseData.competence_year,
          installmentValue,
          0,
          0,
          0,
          updatedAmount,
          0,
          openAmount,
          status,
          baseData.notes,
          true,
          parentDebtId,
          i,
          installments
        ]
      );

      const row = res.rows[0];

      if (i === 1) {
        parentDebtId = row.id;

        await client.query(
          `
            UPDATE ${TB_DEBTS}
            SET parent_debt_id = id, updated_at = NOW()
            WHERE id = $1
          `,
          [row.id]
        );

        row.parent_debt_id = row.id;
      } else {
        row.parent_debt_id = parentDebtId;
      }

      generated.push(row);
    }

    await client.query('COMMIT');

    return {
      total_installments: installments,
      total_amount: totalAmount,
      parent_debt_id: parentDebtId,
      rows: generated
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default {
  list,
  getById,
  create,
  update,
  remove,
  getSummary,
  createInstallments,
  recalcDebtById
};