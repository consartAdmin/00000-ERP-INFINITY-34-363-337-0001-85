// ╔════════════════════════════════════════════════════════════════════╗
// ║ proposalsServicesConsart.repository.js — CRUD das Propostas de     ║
// ║ Serviços (CONSART ERP)                                             ║
// ║ • list / getById / create / update / remove / duplicate / forPdf  ║
// ║ • Totais calculados aqui (não confia no front).                    ║
// ║ • "VENCIDA" não é gravada: rascunho/enviada com validade passada   ║
// ║   aparece como VENCIDA (status_effective).                         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, TB_ITEMS, ensureProposalsServicesConsartTables } from './proposalsServicesConsart.schema.js';

const TB_CUSTOMERS = 'public."customersConsart"';
const TB_SELLERS = 'public."sellersConsart"';

export const STATUSES = Object.freeze(['RASCUNHO', 'ENVIADA', 'APROVADA', 'RECUSADA']);

const STATUS_EFFECTIVE_SQL = `
  CASE
    WHEN p.status IN ('RASCUNHO', 'ENVIADA') AND p.valid_until < CURRENT_DATE THEN 'VENCIDA'
    ELSE p.status
  END
`;

const SELECT_HEADER = `
  p.*,
  -- datas como texto (as colunas repetidas sobrescrevem as de p.*): sem fuso
  to_char(p.issue_date, 'YYYY-MM-DD') AS issue_date,
  to_char(p.valid_until, 'YYYY-MM-DD') AS valid_until,
  p.number_year::text || '/' || lpad(p.number_seq::text, 4, '0') AS number,
  ${STATUS_EFFECTIVE_SQL} AS status_effective
`;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function text(value, max) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  let s = String(value).trim().replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function isoDate(value) {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/** Normaliza itens e calcula os totais da proposta. */
function prepareItems(rawItems) {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((it) => {
      const quantity = num(it.quantity, 0);
      const unitPrice = num(it.unit_price, 0);
      const discountPercent = Math.min(Math.max(num(it.discount_percent, 0), 0), 100);
      const gross = round2(quantity * unitPrice);
      const total = round2(gross * (1 - discountPercent / 100));
      return {
        service_id: positiveId(it.service_id),
        service_code: text(it.service_code, 60),
        description: text(it.description),
        unit: text(it.unit, 10),
        quantity,
        unit_price: unitPrice,
        discount_percent: discountPercent,
        gross,
        total,
      };
    })
    .filter((it) => it.description);

  const subtotal = round2(items.reduce((acc, it) => acc + it.gross, 0));
  const total = round2(items.reduce((acc, it) => acc + it.total, 0));

  return { items, subtotal, discount_total: round2(subtotal - total), total };
}

function prepareHeader(body = {}) {
  const title = text(body.title, 200);
  if (!title) throw validationError('Informe o título da proposta.');

  const customerId = positiveId(body.customer_id);
  if (!customerId) throw validationError('Selecione o cliente da proposta.');

  const status = String(body.status || 'RASCUNHO').trim().toUpperCase();
  if (!STATUSES.includes(status)) throw validationError('Status inválido.');

  const validDays = Math.max(0, Math.trunc(num(body.valid_days, 15)));

  return {
    issue_date: isoDate(body.issue_date),
    valid_days: validDays,
    status,
    title,
    customer_id: customerId,
    contact_name: text(body.contact_name, 200),
    seller_id: positiveId(body.seller_id),
    payment_method: text(body.payment_method, 100),
    payment_terms: text(body.payment_terms, 255),
    delivery_time: text(body.delivery_time, 100),
    execution_place: text(body.execution_place, 255),
    scope: text(body.scope),
    notes: text(body.notes),
  };
}

async function lookupNames(client, header) {
  const { rows: [customer] } = await client.query(
    `SELECT COALESCE(NULLIF(trade_name, ''), legal_name) AS name, tax_id
       FROM ${TB_CUSTOMERS} WHERE customer_id = $1`,
    [header.customer_id]
  );
  if (!customer) throw validationError('Cliente não encontrado no cadastro da Consart.');

  let sellerName = null;
  if (header.seller_id) {
    const { rows: [seller] } = await client.query(
      `SELECT COALESCE(NULLIF(nickname, ''), name) AS name FROM ${TB_SELLERS} WHERE id = $1`,
      [header.seller_id]
    );
    sellerName = seller?.name || null;
  }

  return { customer_name: customer.name, customer_tax_id: customer.tax_id, seller_name: sellerName };
}

async function insertItems(client, proposalId, items) {
  for (const [index, it] of items.entries()) {
    await client.query(
      `INSERT INTO ${TB_ITEMS}
         (proposal_id, position, service_id, service_code, description, unit,
          quantity, unit_price, discount_percent, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [proposalId, index + 1, it.service_id, it.service_code, it.description, it.unit,
        it.quantity, it.unit_price, it.discount_percent, it.total]
    );
  }
}

async function inTransaction(fn) {
  await ensureProposalsServicesConsartTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Consultas
// ─────────────────────────────────────────────────────────────────────

export async function list({ q, status, seller_id, from, to, page = 1, limit = 50 } = {}) {
  await ensureProposalsServicesConsartTables();

  const params = [];
  const where = [];

  const search = text(q);
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(
      p.title ILIKE $${i} OR p.customer_name ILIKE $${i} OR p.customer_tax_id ILIKE $${i}
      OR p.contact_name ILIKE $${i}
      OR (p.number_year::text || '/' || lpad(p.number_seq::text, 4, '0')) ILIKE $${i}
    )`);
  }

  const st = String(status || '').trim().toUpperCase();
  if (st) {
    params.push(st);
    where.push(`(${STATUS_EFFECTIVE_SQL}) = $${params.length}`);
  }

  const sellerId = positiveId(seller_id);
  if (sellerId) {
    params.push(sellerId);
    where.push(`p.seller_id = $${params.length}`);
  }

  const fromDate = isoDate(from);
  if (fromDate) {
    params.push(fromDate);
    where.push(`p.issue_date >= $${params.length}`);
  }

  const toDate = isoDate(to);
  if (toDate) {
    params.push(toDate);
    where.push(`p.issue_date <= $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows: [summary] } = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(p.total), 0)::numeric AS total
       FROM ${TB} p ${whereSql}`,
    params
  );

  const pageSize = Math.min(Math.max(Math.trunc(num(limit, 50)), 1), 500);
  const pageNumber = Math.max(Math.trunc(num(page, 1)), 1);

  const { rows } = await pool.query(
    `SELECT ${SELECT_HEADER}
       FROM ${TB} p
       ${whereSql}
      ORDER BY p.issue_date DESC, p.number_year DESC, p.number_seq DESC
      LIMIT ${pageSize} OFFSET ${(pageNumber - 1) * pageSize}`,
    params
  );

  return {
    rows,
    count: summary.count,
    total: Number(summary.total),
    page: pageNumber,
    pages: Math.max(1, Math.ceil(summary.count / pageSize)),
  };
}

export async function getById(id) {
  await ensureProposalsServicesConsartTables();
  const proposalId = positiveId(id);
  if (!proposalId) return null;

  const { rows: [proposal] } = await pool.query(
    `SELECT ${SELECT_HEADER} FROM ${TB} p WHERE p.id = $1`,
    [proposalId]
  );
  if (!proposal) return null;

  const { rows: items } = await pool.query(
    `SELECT * FROM ${TB_ITEMS} WHERE proposal_id = $1 ORDER BY position, id`,
    [proposalId]
  );

  return { ...proposal, items };
}

/** Proposta + dados completos do cliente e do vendedor (para o PDF). */
export async function getForPdf(id) {
  const proposal = await getById(id);
  if (!proposal) return null;

  const { rows: [customer] } = await pool.query(
    `SELECT * FROM ${TB_CUSTOMERS} WHERE customer_id = $1`,
    [proposal.customer_id]
  );

  let seller = null;
  if (proposal.seller_id) {
    const { rows } = await pool.query(`SELECT * FROM ${TB_SELLERS} WHERE id = $1`, [proposal.seller_id]);
    seller = rows[0] || null;
  }

  return { ...proposal, customer: customer || null, seller };
}

// ─────────────────────────────────────────────────────────────────────
// Escrita
// ─────────────────────────────────────────────────────────────────────

export async function create(body = {}, user = {}) {
  const header = prepareHeader(body);
  const totals = prepareItems(body.items);

  const id = await inTransaction(async (client) => {
    const names = await lookupNames(client, header);

    // Numeração por ano sem repetir mesmo com dois cadastros ao mesmo tempo
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('proposalsServicesConsart.number'))`);
    const { rows: [{ issue_date: issueDate, year }] } = await client.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS issue_date, EXTRACT(YEAR FROM d)::int AS year
         FROM (SELECT COALESCE($1::date, CURRENT_DATE) AS d) x`,
      [header.issue_date]
    );
    const { rows: [{ next }] } = await client.query(
      `SELECT COALESCE(MAX(number_seq), 0) + 1 AS next FROM ${TB} WHERE number_year = $1`,
      [year]
    );

    const { rows: [row] } = await client.query(
      `INSERT INTO ${TB}
         (number_year, number_seq, issue_date, valid_days, valid_until, status, title,
          customer_id, customer_name, customer_tax_id, contact_name, seller_id, seller_name,
          payment_method, payment_terms, delivery_time, execution_place, scope, notes,
          subtotal, discount_total, total, created_by, created_by_name)
       VALUES ($1, $2, $3::date, $4, $3::date + $4::int, $5, $6,
               $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, $23)
       RETURNING id`,
      [year, next, issueDate, header.valid_days, header.status, header.title,
        header.customer_id, names.customer_name, names.customer_tax_id, header.contact_name,
        header.seller_id, names.seller_name,
        header.payment_method, header.payment_terms, header.delivery_time, header.execution_place,
        header.scope, header.notes,
        totals.subtotal, totals.discount_total, totals.total,
        positiveId(user.user_id), text(user.name, 150)]
    );

    await insertItems(client, row.id, totals.items);
    return row.id;
  });

  return getById(id);
}

export async function update(id, body = {}) {
  const proposalId = positiveId(id);
  if (!proposalId) return null;

  const header = prepareHeader(body);
  const totals = prepareItems(body.items);

  const found = await inTransaction(async (client) => {
    const names = await lookupNames(client, header);

    const { rowCount } = await client.query(
      `UPDATE ${TB} SET
          issue_date      = COALESCE($2::date, issue_date),
          valid_days      = $3,
          valid_until     = COALESCE($2::date, issue_date) + $3::int,
          status          = $4,
          title           = $5,
          customer_id     = $6,
          customer_name   = $7,
          customer_tax_id = $8,
          contact_name    = $9,
          seller_id       = $10,
          seller_name     = $11,
          payment_method  = $12,
          payment_terms   = $13,
          delivery_time   = $14,
          execution_place = $15,
          scope           = $16,
          notes           = $17,
          subtotal        = $18,
          discount_total  = $19,
          total           = $20,
          updated_at      = NOW()
        WHERE id = $1`,
      [proposalId, header.issue_date, header.valid_days, header.status, header.title,
        header.customer_id, names.customer_name, names.customer_tax_id, header.contact_name,
        header.seller_id, names.seller_name,
        header.payment_method, header.payment_terms, header.delivery_time, header.execution_place,
        header.scope, header.notes,
        totals.subtotal, totals.discount_total, totals.total]
    );
    if (!rowCount) return false;

    await client.query(`DELETE FROM ${TB_ITEMS} WHERE proposal_id = $1`, [proposalId]);
    await insertItems(client, proposalId, totals.items);
    return true;
  });

  return found ? getById(proposalId) : null;
}

export async function remove(id) {
  await ensureProposalsServicesConsartTables();
  const proposalId = positiveId(id);
  if (!proposalId) return false;
  const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE id = $1`, [proposalId]);
  return rowCount > 0;
}

/** Cópia como rascunho, com data de hoje e número novo. */
export async function duplicate(id, user = {}) {
  const source = await getById(id);
  if (!source) return null;

  return create({
    ...source,
    status: 'RASCUNHO',
    issue_date: null,
    items: source.items,
  }, user);
}
