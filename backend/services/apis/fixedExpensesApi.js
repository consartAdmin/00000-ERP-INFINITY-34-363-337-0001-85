// ╔══════════════════════════════════════════════════════════════════════╗
// ║ fixedExpensesApi.js — Acesso ao Postgres (Despesas Fixas)           ║
/* ║ CONSART ERP — ESM, tabela "fixedExpenses" (COM customer_id, UUID)   ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

import pool from '../../config/db.js';

const TABLE = '"fixedExpenses"'; // camelCase preservado (sempre com aspas)

/** Execução básica de query */
async function q(text, params = []) {
  // console.debug('[SQL]', text, params);
  return pool.query(text, params);
}

/** Ordenação segura (colunas permitidas) */
function parseOrder(orderBy, allowed = []) {
  if (!orderBy) return '';
  const [col, dirRaw] = String(orderBy).trim().split(/\s+/);
  const colSafe = allowed.includes(col) ? col : null;
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'ASC';
  return colSafe ? ` ORDER BY ${colSafe} ${dir} ` : '';
}

/** WHERE dinâmico p/ listagem */
function buildWhere(filters = {}) {
  const { search, report_name, date_from, date_to, customer_id } = filters;
  const where = [];
  const params = [];

  if (customer_id) {
    params.push(String(customer_id).trim());
    where.push(`customer_id = $${params.length}::uuid`);
  }

  if (report_name) {
    params.push(`%${String(report_name).trim()}%`);
    where.push(`report_name ILIKE $${params.length}`);
  }

  if (search) {
    params.push(`%${String(search).trim()}%`);
    const i = params.length;
    where.push(`(report_name ILIKE $${i} OR payload::text ILIKE $${i})`);
  }

  if (date_from) {
    params.push(date_from);
    where.push(`created_at >= $${params.length}`);
  }

  if (date_to) {
    params.push(date_to);
    where.push(`created_at < $${params.length}`);
  }

  return { sql: where.length ? ` WHERE ${where.join(' AND ')} ` : '', params };
}

/** Normaliza payload JSONB */
function normalizePayload(payload) {
  if (payload === undefined || payload === null || payload === '') return {};
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return {};
    try { return JSON.parse(trimmed); } catch { /* retorna string bruta */ }
  }
  return payload;
}

/**
 * ensureTable (idempotente)
 * - Só cria se NÃO existir
 * - Cria com customer_id UUID, payload JSONB NOT NULL default '{}'
 * - Cria UNIQUE(customer_id, report_name) (modelo correto multi-customer)
 * - NÃO cria UNIQUE(report_name) (isso quebra multi-customer)
 */
async function ensureTable() {
  const ddl = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'fixedExpenses'
      ) THEN
        CREATE TABLE ${TABLE} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id UUID,
          report_name TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT uq_fixedexpenses_customer_report UNIQUE (customer_id, report_name)
        );
      END IF;
    END$$;

    -- Função updated_at (idempotente)
    CREATE OR REPLACE FUNCTION fixedexpenses_set_updated_at()
    RETURNS TRIGGER AS $f$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;

    -- Trigger updated_at (idempotente)
    DO $$
    DECLARE
      tbl_oid oid := to_regclass('public."fixedExpenses"');
    BEGIN
      IF tbl_oid IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgname = 'tr_fixedexpenses_set_updated_at'
             AND t.tgrelid = tbl_oid
        ) THEN
          CREATE TRIGGER tr_fixedexpenses_set_updated_at
          BEFORE UPDATE ON "fixedExpenses"
          FOR EACH ROW EXECUTE FUNCTION fixedexpenses_set_updated_at();
        END IF;
      END IF;
    END$$;

    -- Índices úteis
    CREATE INDEX IF NOT EXISTS idx_fixedexpenses_created_at  ON ${TABLE}(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fixedexpenses_customer_id ON ${TABLE}(customer_id);
    CREATE INDEX IF NOT EXISTS idx_fixedexpenses_report_name ON ${TABLE}(report_name);
    CREATE INDEX IF NOT EXISTS idx_fixedexpenses_payload_gin ON ${TABLE} USING GIN (payload);
  `;
  await q(ddl);
  return { ok: true };
}

/** Lista */
async function list(opts = {}) {
  const {
    search,
    report_name,
    date_from,
    date_to,
    customer_id,
    orderBy = 'created_at DESC',
    limit = 20,
    offset = 0,
  } = opts;

  const allowedOrder = ['id', 'customer_id', 'report_name', 'created_at', 'updated_at'];
  const orderClause = parseOrder(orderBy, allowedOrder);

  const { sql: whereSql, params } = buildWhere({ search, report_name, date_from, date_to, customer_id });

  params.push(Math.max(1, Math.min(200, Number(limit) || 20)));
  params.push(Math.max(0, Number(offset) || 0));

  const sql = `
    SELECT id, customer_id, report_name, payload, created_at, updated_at
      FROM ${TABLE}
      ${whereSql}
      ${orderClause || ' ORDER BY created_at DESC '}
      LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const { rows } = await q(sql, params);
  return rows;
}

/** Count p/ paginação */
async function count(filters = {}) {
  const { sql: whereSql, params } = buildWhere(filters);
  const { rows } = await q(`SELECT COUNT(*)::int AS total FROM ${TABLE} ${whereSql}`, params);
  return rows?.[0]?.total ?? 0;
}

/** Get por ID (UUID) */
async function getById(id) {
  const { rows } = await q(
    `SELECT id, customer_id, report_name, payload, created_at, updated_at
       FROM ${TABLE}
      WHERE id = $1::uuid`,
    [String(id).trim()],
  );
  return rows[0] || null;
}

/** Create */
async function create(payloadIn) {
  const { customer_id, report_name, payload } = payloadIn || {};
  if (!report_name) throw new Error('report_name é obrigatório');

  const cust = customer_id ? String(customer_id).trim() : null;
  const jsonb = normalizePayload(payload);

  const { rows } = await q(
    `INSERT INTO ${TABLE} (customer_id, report_name, payload)
     VALUES ($1::uuid, $2, $3::jsonb)
     RETURNING id, customer_id, report_name, payload, created_at, updated_at`,
    [cust, report_name, jsonb],
  );

  return rows[0];
}

/** Update parcial */
async function update(id, payloadIn = {}) {
  const sets = [];
  const params = [];
  let i = 0;

  if (payloadIn.customer_id !== undefined) {
    params.push(payloadIn.customer_id ? String(payloadIn.customer_id).trim() : null);
    sets.push(`customer_id = $${++i}::uuid`);
  }

  if (payloadIn.report_name !== undefined) {
    params.push(String(payloadIn.report_name ?? '').trim());
    sets.push(`report_name = $${++i}`);
  }

  if (payloadIn.payload !== undefined) {
    params.push(normalizePayload(payloadIn.payload));
    sets.push(`payload = $${++i}::jsonb`);
  }

  if (!sets.length) return getById(id);

  params.push(String(id).trim());
  const sql = `
    UPDATE ${TABLE}
       SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${++i}::uuid
     RETURNING id, customer_id, report_name, payload, created_at, updated_at
  `;

  const { rows } = await q(sql, params);
  return rows[0] || null;
}

/** Remove */
async function remove(id) {
  const { rows } = await q(
    `DELETE FROM ${TABLE} WHERE id = $1::uuid RETURNING id`,
    [String(id).trim()],
  );
  return !!rows[0];
}

/** Upsert por (customer_id, report_name) */
async function upsertByCustomerAndReport({ customer_id, report_name, payload }) {
  const cust = customer_id ? String(customer_id).trim() : null;
  if (!cust) throw new Error('customer_id é obrigatório');
  if (!report_name) throw new Error('report_name é obrigatório');

  const jsonb = normalizePayload(payload);

  const { rows } = await q(
    `INSERT INTO ${TABLE} (customer_id, report_name, payload)
     VALUES ($1::uuid, $2, $3::jsonb)
     ON CONFLICT (customer_id, report_name) DO UPDATE
       SET payload = EXCLUDED.payload,
           updated_at = NOW()
     RETURNING id, customer_id, report_name, payload, created_at, updated_at`,
    [cust, report_name, jsonb],
  );

  return rows[0];
}

export const fixedExpensesApi = {
  ensureTable,
  list,
  count,
  getById,
  create,
  update,
  remove,
  upsertByCustomerAndReport,
};

export default fixedExpensesApi;