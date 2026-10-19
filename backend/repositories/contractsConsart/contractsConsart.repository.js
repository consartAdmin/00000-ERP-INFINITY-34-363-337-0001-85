// ╔════════════════════════════════════════════════════════════════════╗
// ║ contractsConsart.repository.js — CRUD dos Contratos de Serviços    ║
// ║ (CONSART ERP)                                                      ║
// ║ • list / getById / create / update / remove / duplicate / forPdf  ║
// ║ • fromProposal: contrato novo a partir de Proposta de Serviços     ║
// ║   APROVADA (cliente, vendedor, serviços, condições e escopo).      ║
// ║ • Totais calculados aqui (não confia no front); itens UNICA        ║
// ║   (implantação) somam em one_time_total, fora da mensalidade.      ║
// ║ • "VENCIDO" não é gravado: ativo sem renovação automática com      ║
// ║   término passado aparece como VENCIDO (status_effective).         ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, TB_ITEMS, TB_CLAUSES, TB_REPRESENTATIVES, ensureContractsConsartTables } from './contractsConsart.schema.js';
import { addressLine } from './customersConsartRepresentatives.repository.js';
import { DEFAULT_CLAUSES } from './contractsConsart.clauses.js';
import * as proposalsRepo from '../proposalsServicesConsart/proposalsServicesConsart.repository.js';

const TB_CUSTOMERS = 'public."customersConsart"';
const TB_SELLERS = 'public."sellersConsart"';

export const STATUSES = Object.freeze(['RASCUNHO', 'ATIVO', 'ENCERRADO', 'CANCELADO']);
export const BILLING_TYPES = Object.freeze(['MENSAL', 'UNICO', 'PARCELADO']);
export const CHARGE_TYPES = Object.freeze(['RECORRENTE', 'UNICA']);

const STATUS_EFFECTIVE_SQL = `
  CASE
    WHEN c.status = 'ATIVO' AND NOT c.auto_renew AND c.end_date < CURRENT_DATE THEN 'VENCIDO'
    ELSE c.status
  END
`;

const SELECT_HEADER = `
  c.*,
  -- datas como texto (as colunas repetidas sobrescrevem as de c.*): sem fuso
  to_char(c.issue_date, 'YYYY-MM-DD') AS issue_date,
  to_char(c.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
  to_char(c.signing_date, 'YYYY-MM-DD') AS signing_date,
  c.number_year::text || '/' || lpad(c.number_seq::text, 4, '0') AS number,
  ${STATUS_EFFECTIVE_SQL} AS status_effective
`;

// Término = início + vigência (meses) - 1 dia; vigência 0 = prazo indeterminado
const END_DATE_SQL = (start, months) => `
  CASE WHEN ${start} IS NOT NULL AND ${months} > 0
       THEN (${start} + make_interval(months => ${months}) - INTERVAL '1 day')::date
  END
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

/** Normaliza itens e calcula os totais do contrato. */
function prepareItems(rawItems) {
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((it) => {
      const quantity = num(it.quantity, 0);
      const unitPrice = num(it.unit_price, 0);
      const discountPercent = Math.min(Math.max(num(it.discount_percent, 0), 0), 100);
      const gross = round2(quantity * unitPrice);
      const total = round2(gross * (1 - discountPercent / 100));
      const chargeType = String(it.charge_type || 'RECORRENTE').trim().toUpperCase();
      return {
        charge_type: CHARGE_TYPES.includes(chargeType) ? chargeType : 'RECORRENTE',
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
  const oneTime = round2(items.filter((it) => it.charge_type === 'UNICA').reduce((acc, it) => acc + it.total, 0));

  return {
    items,
    subtotal,
    discount_total: round2(subtotal - total),
    total,
    recurring_total: round2(total - oneTime),
    one_time_total: oneTime,
  };
}

/** Cláusulas: undefined = não mexe (update) / modelo padrão (create). */
function prepareClauses(rawClauses) {
  if (rawClauses === undefined) return undefined;
  return (Array.isArray(rawClauses) ? rawClauses : [])
    .map((cl) => ({
      title: text(cl.title, 200),
      body: String(cl.body ?? '').trim(),
    }))
    .filter((cl) => cl.title || cl.body)
    .map((cl) => ({ ...cl, title: cl.title || 'CLÁUSULA' }));
}

function prepareHeader(body = {}) {
  const title = text(body.title, 200);
  if (!title) throw validationError('Informe o título do contrato.');

  const customerId = positiveId(body.customer_id);
  if (!customerId) throw validationError('Selecione o cliente (contratante).');

  const status = String(body.status || 'RASCUNHO').trim().toUpperCase();
  if (!STATUSES.includes(status)) throw validationError('Status inválido.');

  const billingType = String(body.billing_type || 'MENSAL').trim().toUpperCase();
  if (!BILLING_TYPES.includes(billingType)) throw validationError('Tipo de cobrança inválido.');

  const dueDay = Math.trunc(num(body.due_day, 0));

  return {
    issue_date: isoDate(body.issue_date),
    status,
    title,
    proposal_id: positiveId(body.proposal_id),
    proposal_number: text(body.proposal_number, 20),
    customer_id: customerId,
    contact_name: text(body.contact_name, 200),
    seller_id: positiveId(body.seller_id),
    representative_id: positiveId(body.representative_id),
    start_date: isoDate(body.start_date),
    term_months: Math.max(0, Math.min(600, Math.trunc(num(body.term_months, 12)))),
    auto_renew: body.auto_renew === true || body.auto_renew === 'true',
    billing_type: billingType,
    payment_method: text(body.payment_method, 100),
    payment_terms: text(body.payment_terms, 255),
    due_day: dueDay >= 1 && dueDay <= 31 ? dueDay : null,
    readjustment_index: text(body.readjustment_index, 60),
    execution_place: text(body.execution_place, 255),
    delivery_time: text(body.delivery_time, 100),
    forum_city: text(body.forum_city, 120),
    signing_city: text(body.signing_city, 120),
    signing_date: isoDate(body.signing_date),
    object: text(body.object),
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

/** Cópia do representante escolhido (precisa ser do mesmo cliente). */
async function lookupRepresentative(client, header) {
  if (!header.representative_id) {
    return { id: null, name: null, role: null, cpf: null, address: null };
  }
  const { rows: [rep] } = await client.query(
    `SELECT * FROM ${TB_REPRESENTATIVES} WHERE id = $1 AND customer_id = $2`,
    [header.representative_id, header.customer_id]
  );
  if (!rep) throw validationError('Representante não encontrado para este cliente.');
  return { id: rep.id, name: rep.name, role: rep.role, cpf: rep.cpf, address: addressLine(rep) || null };
}

async function saveRepresentative(client, contractId, rep) {
  await client.query(
    `UPDATE ${TB} SET representative_id = $2, representative_name = $3, representative_role = $4,
            representative_cpf = $5, representative_address = $6
      WHERE id = $1`,
    [contractId, rep.id, rep.name, rep.role, rep.cpf, rep.address]
  );
}

async function insertItems(client, contractId, items) {
  for (const [index, it] of items.entries()) {
    await client.query(
      `INSERT INTO ${TB_ITEMS}
         (contract_id, position, service_id, service_code, description, unit,
          quantity, unit_price, discount_percent, total, charge_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [contractId, index + 1, it.service_id, it.service_code, it.description, it.unit,
        it.quantity, it.unit_price, it.discount_percent, it.total, it.charge_type]
    );
  }
}

async function insertClauses(client, contractId, clauses) {
  for (const [index, cl] of clauses.entries()) {
    await client.query(
      `INSERT INTO ${TB_CLAUSES} (contract_id, position, title, body) VALUES ($1, $2, $3, $4)`,
      [contractId, index + 1, cl.title, cl.body]
    );
  }
}

async function inTransaction(fn) {
  await ensureContractsConsartTables();
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
  await ensureContractsConsartTables();

  const params = [];
  const where = [];

  const search = text(q);
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(
      c.title ILIKE $${i} OR c.customer_name ILIKE $${i} OR c.customer_tax_id ILIKE $${i}
      OR c.contact_name ILIKE $${i} OR c.proposal_number ILIKE $${i}
      OR (c.number_year::text || '/' || lpad(c.number_seq::text, 4, '0')) ILIKE $${i}
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
    where.push(`c.seller_id = $${params.length}`);
  }

  const fromDate = isoDate(from);
  if (fromDate) {
    params.push(fromDate);
    where.push(`c.issue_date >= $${params.length}`);
  }

  const toDate = isoDate(to);
  if (toDate) {
    params.push(toDate);
    where.push(`c.issue_date <= $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows: [summary] } = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(c.total), 0)::numeric AS total
       FROM ${TB} c ${whereSql}`,
    params
  );

  const pageSize = Math.min(Math.max(Math.trunc(num(limit, 50)), 1), 500);
  const pageNumber = Math.max(Math.trunc(num(page, 1)), 1);

  const { rows } = await pool.query(
    `SELECT ${SELECT_HEADER}
       FROM ${TB} c
       ${whereSql}
      ORDER BY c.issue_date DESC, c.number_year DESC, c.number_seq DESC
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
  await ensureContractsConsartTables();
  const contractId = positiveId(id);
  if (!contractId) return null;

  const { rows: [contract] } = await pool.query(
    `SELECT ${SELECT_HEADER} FROM ${TB} c WHERE c.id = $1`,
    [contractId]
  );
  if (!contract) return null;

  const [{ rows: items }, { rows: clauses }] = await Promise.all([
    pool.query(`SELECT * FROM ${TB_ITEMS} WHERE contract_id = $1 ORDER BY position, id`, [contractId]),
    pool.query(`SELECT * FROM ${TB_CLAUSES} WHERE contract_id = $1 ORDER BY position, id`, [contractId]),
  ]);

  return { ...contract, items, clauses };
}

/** Contrato + dados completos do cliente e do vendedor (para o PDF). */
export async function getForPdf(id) {
  const contract = await getById(id);
  if (!contract) return null;

  const { rows: [customer] } = await pool.query(
    `SELECT * FROM ${TB_CUSTOMERS} WHERE customer_id = $1`,
    [contract.customer_id]
  );

  let seller = null;
  if (contract.seller_id) {
    const { rows } = await pool.query(`SELECT * FROM ${TB_SELLERS} WHERE id = $1`, [contract.seller_id]);
    seller = rows[0] || null;
  }

  return { ...contract, customer: customer || null, seller };
}

// ─────────────────────────────────────────────────────────────────────
// Escrita
// ─────────────────────────────────────────────────────────────────────

export async function create(body = {}, user = {}) {
  const header = prepareHeader(body);
  const totals = prepareItems(body.items);
  const clauses = prepareClauses(body.clauses) ?? DEFAULT_CLAUSES.map((cl) => ({ ...cl }));

  const id = await inTransaction(async (client) => {
    const names = await lookupNames(client, header);

    // Numeração por ano sem repetir mesmo com dois cadastros ao mesmo tempo
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('contractsConsart.number'))`);
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
         (number_year, number_seq, issue_date, status, title, proposal_id, proposal_number,
          customer_id, customer_name, customer_tax_id, contact_name, seller_id, seller_name,
          start_date, term_months, end_date, auto_renew, billing_type,
          payment_method, payment_terms, due_day, readjustment_index,
          execution_place, delivery_time, forum_city, signing_city, signing_date,
          object, notes, subtotal, discount_total, total, created_by, created_by_name,
          recurring_total, one_time_total)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7,
               $8, $9, $10, $11, $12, $13,
               $14::date, $15::int, ${END_DATE_SQL('$14::date', '$15::int')}, $16, $17,
               $18, $19, $20, $21,
               $22, $23, $24, $25, $26::date,
               $27, $28, $29, $30, $31, $32, $33,
               $34, $35)
       RETURNING id`,
      [year, next, issueDate, header.status, header.title, header.proposal_id, header.proposal_number,
        header.customer_id, names.customer_name, names.customer_tax_id, header.contact_name,
        header.seller_id, names.seller_name,
        header.start_date, header.term_months, header.auto_renew, header.billing_type,
        header.payment_method, header.payment_terms, header.due_day, header.readjustment_index,
        header.execution_place, header.delivery_time, header.forum_city, header.signing_city,
        header.signing_date,
        header.object, header.notes, totals.subtotal, totals.discount_total, totals.total,
        positiveId(user.user_id), text(user.name, 150),
        totals.recurring_total, totals.one_time_total]
    );

    await insertItems(client, row.id, totals.items);
    await insertClauses(client, row.id, clauses);
    await saveRepresentative(client, row.id, await lookupRepresentative(client, header));
    return row.id;
  });

  return getById(id);
}

export async function update(id, body = {}) {
  const contractId = positiveId(id);
  if (!contractId) return null;

  const header = prepareHeader(body);
  const totals = prepareItems(body.items);
  const clauses = prepareClauses(body.clauses);

  const found = await inTransaction(async (client) => {
    const names = await lookupNames(client, header);

    const { rowCount } = await client.query(
      `UPDATE ${TB} SET
          issue_date         = COALESCE($2::date, issue_date),
          status             = $3,
          title              = $4,
          customer_id        = $5,
          customer_name      = $6,
          customer_tax_id    = $7,
          contact_name       = $8,
          seller_id          = $9,
          seller_name        = $10,
          start_date         = $11::date,
          term_months        = $12::int,
          end_date           = ${END_DATE_SQL('$11::date', '$12::int')},
          auto_renew         = $13,
          billing_type       = $14,
          payment_method     = $15,
          payment_terms      = $16,
          due_day            = $17,
          readjustment_index = $18,
          execution_place    = $19,
          delivery_time      = $20,
          forum_city         = $21,
          signing_city       = $22,
          signing_date       = $23::date,
          object             = $24,
          notes              = $25,
          subtotal           = $26,
          discount_total     = $27,
          total              = $28,
          recurring_total    = $29,
          one_time_total     = $30,
          updated_at         = NOW()
        WHERE id = $1`,
      [contractId, header.issue_date, header.status, header.title,
        header.customer_id, names.customer_name, names.customer_tax_id, header.contact_name,
        header.seller_id, names.seller_name,
        header.start_date, header.term_months, header.auto_renew, header.billing_type,
        header.payment_method, header.payment_terms, header.due_day, header.readjustment_index,
        header.execution_place, header.delivery_time, header.forum_city, header.signing_city,
        header.signing_date, header.object, header.notes,
        totals.subtotal, totals.discount_total, totals.total,
        totals.recurring_total, totals.one_time_total]
    );
    if (!rowCount) return false;

    await client.query(`DELETE FROM ${TB_ITEMS} WHERE contract_id = $1`, [contractId]);
    await insertItems(client, contractId, totals.items);
    await saveRepresentative(client, contractId, await lookupRepresentative(client, header));

    if (clauses) {
      await client.query(`DELETE FROM ${TB_CLAUSES} WHERE contract_id = $1`, [contractId]);
      await insertClauses(client, contractId, clauses);
    }
    return true;
  });

  return found ? getById(contractId) : null;
}

export async function remove(id) {
  await ensureContractsConsartTables();
  const contractId = positiveId(id);
  if (!contractId) return false;
  const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE id = $1`, [contractId]);
  return rowCount > 0;
}

/** Cópia como rascunho, com data de hoje e número novo (sem vínculo com a proposta). */
export async function duplicate(id, user = {}) {
  const source = await getById(id);
  if (!source) return null;

  return create({
    ...source,
    status: 'RASCUNHO',
    issue_date: null,
    signing_date: null,
    proposal_id: null,
    proposal_number: null,
  }, user);
}

/**
 * Contrato (rascunho) a partir de uma Proposta de Serviços APROVADA.
 * Se a proposta já tem contrato, devolve o existente ({ existed: true }).
 */
export async function fromProposal(proposalId, user = {}) {
  await ensureContractsConsartTables();
  const proposal = await proposalsRepo.getById(proposalId);
  if (!proposal) return null;

  if (proposal.status !== 'APROVADA') {
    throw validationError(`A proposta ${proposal.number} não está aprovada. Aprove a proposta antes de gerar o contrato.`);
  }

  const { rows: [existing] } = await pool.query(
    `SELECT id FROM ${TB} WHERE proposal_id = $1 ORDER BY id LIMIT 1`,
    [proposal.id]
  );
  if (existing) return { contract: await getById(existing.id), existed: true };

  const contract = await create({
    status: 'RASCUNHO',
    title: proposal.title,
    proposal_id: proposal.id,
    proposal_number: proposal.number,
    customer_id: proposal.customer_id,
    contact_name: proposal.contact_name,
    seller_id: proposal.seller_id,
    start_date: null,
    term_months: 12,
    billing_type: 'MENSAL',
    payment_method: proposal.payment_method,
    payment_terms: proposal.payment_terms,
    delivery_time: proposal.delivery_time,
    execution_place: proposal.execution_place,
    object: proposal.scope,
    notes: proposal.notes,
    // Implantação/instalação/setup entram como cobrança única
    items: proposal.items.map((it) => ({
      ...it,
      charge_type: /implant|instala|setup|configura/i.test(it.description || '') ? 'UNICA' : 'RECORRENTE',
    })),
  }, user);

  return { contract, existed: false };
}
