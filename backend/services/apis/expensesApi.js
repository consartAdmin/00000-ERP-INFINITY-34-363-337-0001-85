// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expensesApi.js — DAL/Service (PostgreSQL)                            ║
// ║ Tabela: public."Expenses"                                            ║
// ║ CONSART ERP | ESM                                                    ║
// ║                                                                      ║
// ║ - Listagem com filtros + paginação                                   ║
// ║ - Count consistente                                                  ║
// ║ - CRUD completo                                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js'; // ⬅️ ajuste se necessário

const TB = 'public."Expenses"';

/** Permite apenas ORDER BY seguro */
function safeOrderBy(input) {
  const allowed = new Map([
    ['created_at_desc', '"created_at" DESC'],
    ['created_at_asc', '"created_at" ASC'],
    ['due_date_desc', '"due_date" DESC'],
    ['due_date_asc', '"due_date" ASC'],
    ['updated_at_desc', '"update_at" DESC'], // sua coluna está "update_at"
    ['updated_at_asc', '"update_at" ASC'],
    ['value_desc', '"value" DESC'],
    ['value_asc', '"value" ASC'],
    ['name_asc', '"name" ASC'],
    ['name_desc', '"name" DESC'],
  ]);
  return allowed.get(String(input || '').toLowerCase()) || '"created_at" DESC';
}

async function generateExpenseId(client) {
  // Format: EXP-YYYYMM-000001
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');

  const { rows } = await client.query(`SELECT nextval('public.expense_id_seq') AS n;`);
  const seq = String(rows[0].n).padStart(6, '0');

  return `EXP-${y}${m}-${seq}`;
}

function toInt(v, d) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function normalizeBool(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['true', '1', 'yes', 'y', 'sim'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'nao', 'não'].includes(s)) return false;
  return undefined;
}

/** Monta WHERE dinâmico com parâmetros */
function buildWhere(filters = {}) {
  const where = [];
  const params = [];
  let i = 1;

  // Busca geral (name/description/expense_id/vendor/category)
  if (filters.q) {
    params.push(`%${String(filters.q).trim()}%`);
    where.push(`(
      "name" ILIKE $${i}
      OR COALESCE("description",'') ILIKE $${i}
      OR COALESCE("expense_id",'') ILIKE $${i}
      OR COALESCE("vendor",'') ILIKE $${i}
      OR COALESCE("category",'') ILIKE $${i}
    )`);
    i++;
  }

  if (filters.name) {
    params.push(`%${String(filters.name).trim()}%`);
    where.push(`"name" ILIKE $${i++}`);
  }

  if (filters.status) {
    params.push(String(filters.status).trim().toUpperCase());
    where.push(`"status" = $${i++}`);
  }

  if (filters.category) {
    params.push(String(filters.category).trim());
    where.push(`"category" = $${i++}`);
  }

  if (filters.vendor) {
    params.push(String(filters.vendor).trim());
    where.push(`"vendor" = $${i++}`);
  }

  const isActive = normalizeBool(filters.is_active);
  if (isActive !== undefined) {
    params.push(isActive);
    where.push(`"is_active" = $${i++}`);
  }

  if (filters.date_from) {
    params.push(filters.date_from);
    where.push(`"due_date" >= $${i++}::date`);
  }

  if (filters.date_to) {
    params.push(filters.date_to);
    where.push(`"due_date" <= $${i++}::date`);
  }

  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { sql, params };
}

export async function listExpenses(query = {}) {
  const limit  = Math.min(Math.max(toInt(query.limit, 20), 1), 200);
  const offset = Math.max(toInt(query.offset, 0), 0);
  const orderBy = safeOrderBy(query.order_by);

  const { sql: whereSql, params } = buildWhere(query);

  // 1) Rows (paginado)
  const qRows = `
    SELECT
      "id",
      "expense_id",
      "name",
      "description",
      "value",
      "due_date",
      "competence_month",
      "competence_year",
      "category",
      "cost_center",
      "vendor",
      "recurrence_type",
      "status",
      "paid_date",
      "payment_method",
      "account_payable_id",
      "payload",
      "is_active",
      "created_at",
      "updated_at"
    FROM ${TB}
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2};
  `;

  // 2) Total (COUNT)
  const qCount = `
    SELECT COUNT(*)::bigint AS total
    FROM ${TB}
    ${whereSql};
  `;

  // 3) Total Value (SUM)
  const qSum = `
    SELECT COALESCE(SUM("value"), 0)::numeric AS total_value
    FROM ${TB}
    ${whereSql};
  `;

  // Executa em paralelo (mais rápido)
  const [rRows, rCount, rSum] = await Promise.all([
    pool.query(qRows, [...params, limit, offset]),
    pool.query(qCount, params),
    pool.query(qSum, params),
  ]);

  return {
    rows: rRows.rows || [],
    total: Number(rCount.rows?.[0]?.total || 0),
    total_value: rSum.rows?.[0]?.total_value ?? '0',
    limit,
    offset,
  };
}

export async function countExpenses(query = {}) {
  const { sql: whereSql, params } = buildWhere(query);

  const q = `
    SELECT COUNT(*)::bigint AS total
    FROM ${TB}
    ${whereSql};
  `;

  const { rows } = await pool.query(q, params);
  return Number(rows?.[0]?.total || 0);
}

export async function getExpenseById(id) {
  const q = `
    SELECT
      "id",
      "expense_id",
      "name",
      "description",
      "value",
      "due_date",
      "competence_month",
      "competence_year",
      "category",
      "cost_center",
      "vendor",
      "recurrence_type",
      "status",
      "paid_date",
      "payment_method",
      "account_payable_id",
      "payload",
      "is_active",
      "created_at",
      "updated_at"
    FROM ${TB}
    WHERE "id" = $1;
  `;
  const { rows } = await pool.query(q, [id]);
  return rows[0] || null;
}

function sanitizeExpensePayload(body = {}) {
  // Mantém só campos permitidos para evitar lixo/SQL issues
  return {
    expense_id: body.expense_id ?? null,
    name: body.name,
    description: body.description ?? null,
    value: body.value,
    due_date: body.due_date,
    competence_month: body.competence_month ?? null,
    competence_year: body.competence_year ?? null,
    category: body.category ?? null,
    cost_center: body.cost_center ?? null,
    vendor: body.vendor ?? null,
    recurrence_type: body.recurrence_type ?? 'MONTHLY',
    status: body.status ?? 'PENDING',
    paid_date: body.paid_date ?? null,
    payment_method: body.payment_method ?? null,
    account_payable_id: body.account_payable_id ?? null,
    payload: body.payload ?? null,
    is_active: body.is_active ?? true,
  };
}

export async function createExpense(body) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const d = sanitizeExpensePayload(body);

    // If user didn't send expense_id, generate
    if (!d.expense_id) {
      d.expense_id = await generateExpenseId(client);
    }

    const q = `
      INSERT INTO ${TB} (
        "expense_id",
        "name",
        "description",
        "value",
        "due_date",
        "competence_month",
        "competence_year",
        "category",
        "cost_center",
        "vendor",
        "recurrence_type",
        "status",
        "paid_date",
        "payment_method",
        "account_payable_id",
        "payload",
        "is_active"
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,
        $8,$9,$10,
        $11,$12,
        $13,$14,
        $15,$16,$17
      )
      RETURNING "id", "expense_id";
    `;

    const params = [
      d.expense_id,
      d.name,
      d.description,
      d.value,
      d.due_date,
      d.competence_month,
      d.competence_year,
      d.category,
      d.cost_center,
      d.vendor,
      String(d.recurrence_type).toUpperCase(),
      String(d.status).toUpperCase(),
      d.paid_date,
      d.payment_method,
      d.account_payable_id,
      d.payload,
      Boolean(d.is_active),
    ];

    const { rows } = await client.query(q, params);

    await client.query('COMMIT');
    return rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateExpense(id, body) {
  const d = sanitizeExpensePayload(body);

  const q = `
    UPDATE ${TB}
    SET
      "expense_id" = $1,
      "name" = $2,
      "description" = $3,
      "value" = $4,
      "due_date" = $5,
      "competence_month" = $6,
      "competence_year" = $7,
      "category" = $8,
      "cost_center" = $9,
      "vendor" = $10,
      "recurrence_type" = $11,
      "status" = $12,
      "paid_date" = $13,
      "payment_method" = $14,
      "account_payable_id" = $15,
      "payload" = $16,
      "is_active" = $17
    WHERE "id" = $18
    RETURNING "id";
  `;

  const params = [
    d.expense_id,
    d.name,
    d.description,
    d.value,
    d.due_date,
    d.competence_month,
    d.competence_year,
    d.category,
    d.cost_center,
    d.vendor,
    String(d.recurrence_type).toUpperCase(),
    String(d.status).toUpperCase(),
    d.paid_date,
    d.payment_method,
    d.account_payable_id,
    d.payload,
    Boolean(d.is_active),
    id,
  ];

  const { rows } = await pool.query(q, params);
  return rows[0] || null;
}

export async function patchExpenseStatus(id, body = {}) {
  const status = String(body.status || '').trim().toUpperCase();
  const paid_date = body.paid_date ?? null;
  const payment_method = body.payment_method ?? null;

  const q = `
    UPDATE ${TB}
    SET
      "status" = $1,
      "paid_date" = $2,
      "payment_method" = $3
    WHERE "id" = $4
    RETURNING "id";
  `;
  const { rows } = await pool.query(q, [status, paid_date, payment_method, id]);
  return rows[0] || null;
}

export async function deleteExpense(id) {
  const q = `DELETE FROM ${TB} WHERE "id" = $1 RETURNING "id";`;
  const { rows } = await pool.query(q, [id]);
  return rows[0] || null;
}