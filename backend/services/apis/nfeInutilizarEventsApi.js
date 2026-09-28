// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: nfeInutilizarEventsApi.js                                     ║
// ║ MODULE: NF-e Inutilization Events API                               ║
// ║ CONSART ERP                                                         ║
// ║ Camada de acesso ao banco para public."nfeInutilizarEvents"         ║
// ║ ESM • PostgreSQL                                                    ║
// ║ ✔ Suporte a faixa sobreposta                                        ║
// ║ ✔ Proteção contra update vazio                                      ║
// ║ ✔ Queries robustas                                                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TABLE = 'public."nfeInutilizarEvents"';

/* =======================================================================
 * Helpers
 * ======================================================================= */
function normalizeDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function nowYear() {
  return new Date().getFullYear();
}

function normalizeStatusValue(value) {
  return String(value ?? '').trim().toUpperCase();
}

function mapRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    companyCnpj: row.companyCnpj,
    model: row.model,
    serie: row.serie,
    numberStart: row.numberStart,
    numberEnd: row.numberEnd,
    year: row.year,
    justification: row.justification,
    status: row.status,
    protocol: row.protocol,
    xmlRequest: row.xmlRequest,
    xmlResponse: row.xmlResponse,
    message: row.message,
    requestPayload: row.requestPayload,
    responsePayload: row.responsePayload,
    locked: row.locked,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* =======================================================================
 * SQL BASE
 * ======================================================================= */
const RETURNING_FIELDS = `
  id,
  companycnpj AS "companyCnpj",
  model AS "model",
  serie AS "serie",
  numberstart AS "numberStart",
  numberend AS "numberEnd",
  year AS "year",
  justification AS "justification",
  status AS "status",
  protocol AS "protocol",
  xmlrequest AS "xmlRequest",
  xmlresponse AS "xmlResponse",
  message AS "message",
  requestpayload AS "requestPayload",
  responsepayload AS "responsePayload",
  locked AS "locked",
  createdat AS "createdAt",
  updatedat AS "updatedAt"
`;

const BASE_SELECT = `
  SELECT
    ${RETURNING_FIELDS}
  FROM ${TABLE}
`;

/* =======================================================================
 * Create
 * ======================================================================= */
async function create(payload = {}) {
  const companyCnpj = normalizeDigits(payload.companyCnpj);
  const model = String(payload.model || '55').trim();
  const serie = toInt(payload.serie);
  const numberStart = toInt(payload.numberStart);
  const numberEnd = toInt(payload.numberEnd);
  const year = toInt(payload.year || nowYear());
  const justification = String(payload.justification || '').trim();

  const status = normalizeStatusValue(payload.status || 'PENDING');
  const protocol = payload.protocol ? String(payload.protocol).trim() : null;
  const xmlRequest = payload.xmlRequest ? String(payload.xmlRequest) : null;
  const xmlResponse = payload.xmlResponse ? String(payload.xmlResponse) : null;
  const message = payload.message ? String(payload.message) : null;
  const requestPayload = payload.requestPayload ?? null;
  const responsePayload = payload.responsePayload ?? null;
  const locked = Boolean(payload.locked ?? false);

  const sql = `
    INSERT INTO ${TABLE} (
      companycnpj,
      model,
      serie,
      numberstart,
      numberend,
      year,
      justification,
      status,
      protocol,
      xmlrequest,
      xmlresponse,
      message,
      requestpayload,
      responsepayload,
      locked,
      createdat,
      updatedat
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW()
    )
    RETURNING ${RETURNING_FIELDS}
  `;

  const values = [
    companyCnpj,
    model,
    serie,
    numberStart,
    numberEnd,
    year,
    justification,
    status,
    protocol,
    xmlRequest,
    xmlResponse,
    message,
    requestPayload,
    responsePayload,
    locked,
  ];

  const { rows } = await pool.query(sql, values);
  return mapRow(rows[0]);
}

/* =======================================================================
 * Queries
 * ======================================================================= */
async function findById(id) {
  const sql = `
    ${BASE_SELECT}
    WHERE id = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [toInt(id)]);
  return mapRow(rows[0]);
}

/* ================================================================
 * DUPLICADO EXATO
 * ================================================================ */
async function findDuplicate({ companyCnpj, model, serie, numberStart, numberEnd, year }) {
  const sql = `
    ${BASE_SELECT}
    WHERE companycnpj = $1
      AND model = $2
      AND serie = $3
      AND numberstart = $4
      AND numberend = $5
      AND year = $6
    ORDER BY id DESC
    LIMIT 1
  `;

  const values = [
    normalizeDigits(companyCnpj),
    String(model || '55').trim(),
    toInt(serie),
    toInt(numberStart),
    toInt(numberEnd),
    toInt(year),
  ];

  const { rows } = await pool.query(sql, values);
  return mapRow(rows[0]);
}

/* ================================================================
 * 🔥 FAIXA SOBREPOSTA (CORREÇÃO CRÍTICA)
 * ================================================================ */
async function findOverlappingRange({
  companyCnpj,
  model,
  serie,
  numberStart,
  numberEnd,
  year,
}) {
  const sql = `
    ${BASE_SELECT}
    WHERE companycnpj = $1
      AND model = $2
      AND serie = $3
      AND year = $4
      AND numberstart <= $5
      AND numberend >= $6
    ORDER BY id DESC
    LIMIT 1
  `;

  const values = [
    normalizeDigits(companyCnpj),
    String(model || '55').trim(),
    toInt(serie),
    toInt(year),
    toInt(numberEnd),
    toInt(numberStart),
  ];

  const { rows } = await pool.query(sql, values);
  return mapRow(rows[0]);
}

/* ================================================================
 * AUTORIZADA POR NÚMERO
 * ================================================================ */
async function findAuthorizedByNumberRange({
  companyCnpj,
  model = '55',
  serie,
  number,
  year,
}) {
  const sql = `
    ${BASE_SELECT}
    WHERE companycnpj = $1
      AND model = $2
      AND serie = $3
      AND year = $4
      AND $5 BETWEEN numberstart AND numberend
      AND UPPER(COALESCE(status, '')) = 'AUTHORIZED'
    ORDER BY id DESC
    LIMIT 1
  `;

  const values = [
    normalizeDigits(companyCnpj),
    String(model || '55').trim(),
    toInt(serie),
    toInt(year),
    toInt(number),
  ];

  const { rows } = await pool.query(sql, values);
  return mapRow(rows[0]);
}

/* ================================================================
 * LIST
 * ================================================================ */
async function list(filters = {}) {
  const where = [];
  const values = [];
  let idx = 1;

  if (filters.status) {
    where.push(`UPPER(COALESCE(status, '')) = $${idx++}`);
    values.push(normalizeStatusValue(filters.status));
  }

  if (filters.companyCnpj) {
    where.push(`companycnpj = $${idx++}`);
    values.push(normalizeDigits(filters.companyCnpj));
  }

  if (filters.model) {
    where.push(`model = $${idx++}`);
    values.push(String(filters.model).trim());
  }

  if (filters.serie != null && filters.serie !== '') {
    where.push(`serie = $${idx++}`);
    values.push(toInt(filters.serie));
  }

  if (filters.year != null && filters.year !== '') {
    where.push(`year = $${idx++}`);
    values.push(toInt(filters.year));
  }

  if (filters.number != null && filters.number !== '') {
    where.push(`$${idx++} BETWEEN numberstart AND numberend`);
    values.push(toInt(filters.number));
  }

  if (filters.protocol) {
    where.push(`protocol = $${idx++}`);
    values.push(String(filters.protocol).trim());
  }

  const limit = Math.min(Math.max(toInt(filters.limit || 50), 1), 500);
  const offset = Math.max(toInt(filters.offset || 0), 0);

  values.push(limit);
  const limitParam = `$${idx++}`;

  values.push(offset);
  const offsetParam = `$${idx++}`;

  const sql = `
    ${BASE_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY id DESC
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
  `;

  const { rows } = await pool.query(sql, values);
  return rows.map(mapRow);
}

/* =======================================================================
 * Update
 * ======================================================================= */
async function updateStatus(id, payload = {}) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (payload.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(normalizeStatusValue(payload.status));
  }

  if (payload.protocol !== undefined) {
    fields.push(`protocol = $${idx++}`);
    values.push(payload.protocol ? String(payload.protocol).trim() : null);
  }

  if (payload.xmlRequest !== undefined) {
    fields.push(`xmlrequest = $${idx++}`);
    values.push(payload.xmlRequest ? String(payload.xmlRequest) : null);
  }

  if (payload.xmlResponse !== undefined) {
    fields.push(`xmlresponse = $${idx++}`);
    values.push(payload.xmlResponse ? String(payload.xmlResponse) : null);
  }

  if (payload.message !== undefined) {
    fields.push(`message = $${idx++}`);
    values.push(payload.message ? String(payload.message) : null);
  }

  if (payload.requestPayload !== undefined) {
    fields.push(`requestpayload = $${idx++}`);
    values.push(payload.requestPayload ?? null);
  }

  if (payload.responsePayload !== undefined) {
    fields.push(`responsepayload = $${idx++}`);
    values.push(payload.responsePayload ?? null);
  }

  if (payload.locked !== undefined) {
    fields.push(`locked = $${idx++}`);
    values.push(Boolean(payload.locked));
  }

  if (fields.length === 0) {
    return findById(id);
  }

  fields.push(`updatedat = NOW()`);

  const sql = `
    UPDATE ${TABLE}
    SET ${fields.join(', ')}
    WHERE id = $${idx}
    RETURNING ${RETURNING_FIELDS}
  `;

  values.push(toInt(id));

  const { rows } = await pool.query(sql, values);
  return mapRow(rows[0]);
}

/* =======================================================================
 * Shortcuts
 * ======================================================================= */
async function markSent(id, payload = {}) {
  return updateStatus(id, { ...payload, status: 'SENT', locked: false });
}

async function markAuthorized(id, payload = {}) {
  return updateStatus(id, { ...payload, status: 'AUTHORIZED', locked: false });
}

async function markRejected(id, payload = {}) {
  return updateStatus(id, { ...payload, status: 'REJECTED', locked: false });
}

async function markError(id, payload = {}) {
  return updateStatus(id, { ...payload, status: 'ERROR', locked: false });
}

/* =======================================================================
 * Export
 * ======================================================================= */
export default {
  create,
  findById,
  findDuplicate,
  findOverlappingRange, // 🔥 NOVO
  findAuthorizedByNumberRange,
  list,
  updateStatus,
  markSent,
  markAuthorized,
  markRejected,
  markError,
};