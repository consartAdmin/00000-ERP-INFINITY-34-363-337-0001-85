/* ╔══════════════════════════════════════════════════════════════════════╗
 * ║ plano_acaoApi.js — DAL Plano de Ação (Postgres) | CONSART ERP (ESM)  ║
 * ║ Path: backend/services/apis/plano_acaoApi.js                         ║
 * ║ - CRUD + listagem paginada + filtros + bulk upsert                    ║
 * ║ ⚠️ DAL PURO — sem regras de negócio                                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝ */

import pool from '../../config/db.js';

// ======================================================================
// Tabela
// ======================================================================
const TB = 'public.plano_acao';

// ======================================================================
// Helpers
// ======================================================================
async function q(text, params = []) {
  return pool.query(text, params);
}

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeStr(v) {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function parseDateOrNull(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;

  // Aceita YYYY-MM-DD ou DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function buildWhere(filters = {}, params = []) {
  const where = [];
  const push = (sql, value) => {
    params.push(value);
    where.push(sql.replace(/\$(\?)/g, `$${params.length}`));
  };

  const qTerm = normalizeStr(filters.q);
  const empresa = normalizeStr(filters.empresa);
  const status = normalizeStr(filters.status);
  const responsavel = normalizeStr(filters.responsavel);
  const item = toInt(filters.item, null);

  if (item != null) push(`item = $?`, item);
  if (empresa) push(`empresa ILIKE $?`, `%${empresa}%`);
  if (status) push(`status ILIKE $?`, `%${status}%`);
  if (responsavel) push(`responsavel ILIKE $?`, `%${responsavel}%`);

  if (qTerm) {
    // Busca “inteligente” em campos principais
    params.push(`%${qTerm}%`);
    const p = `$${params.length}`;
    where.push(`(
      empresa ILIKE ${p}
      OR causa ILIKE ${p}
      OR acao ILIKE ${p}
      OR responsavel ILIKE ${p}
      OR status ILIKE ${p}
      OR situacao_atual ILIKE ${p}
      OR observ_evidencias ILIKE ${p}
      OR campo_extra_01 ILIKE ${p}
    )`);
  }

  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { sql, params };
}

function parseOrder(orderBy) {
  // whitelist: evite SQL injection
  const allowed = new Map([
    ['id', 'id'],
    ['item', 'item'],
    ['empresa', 'empresa'],
    ['responsavel', 'responsavel'],
    ['data', '"data"'],
    ['status', 'status'],
    ['created_at', 'created_at'],
    ['updated_at', 'updated_at'],
  ]);

  const raw = String(orderBy ?? '').trim();
  if (!raw) return 'ORDER BY item ASC, id ASC';

  const [colRaw, dirRaw] = raw.split(/\s+/);
  const col = allowed.get(colRaw) || null;
  const dir = String(dirRaw ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  if (!col) return 'ORDER BY item ASC, id ASC';
  return `ORDER BY ${col} ${dir}, id ASC`;
}

// ======================================================================
// API
// ======================================================================
export async function list(filters = {}) {
  const page = clamp(toInt(filters.page, 1), 1, 1_000_000);
  const pageSize = clamp(toInt(filters.pageSize, 20), 1, 200);
  const offset = (page - 1) * pageSize;

  const params = [];
  const { sql: whereSql, params: p2 } = buildWhere(filters, params);
  const orderSql = parseOrder(filters.orderBy);

  const countSql = `SELECT COUNT(*)::bigint AS total FROM ${TB} ${whereSql};`;
  const dataSql = `
    SELECT
      id, item, empresa, causa, acao, responsavel, "data", status,
      situacao_atual, observ_evidencias, campo_extra_01,
      created_at, updated_at
    FROM ${TB}
    ${whereSql}
    ${orderSql}
    LIMIT $${p2.length + 1} OFFSET $${p2.length + 2};
  `;

  const countRes = await q(countSql, p2);
  const total = Number(countRes.rows?.[0]?.total ?? 0);

  const dataRes = await q(dataSql, [...p2, pageSize, offset]);

  return {
    page,
    pageSize,
    total,
    rows: dataRes.rows,
  };
}

export async function getById(id) {
  const res = await q(
    `
    SELECT
      id, item, empresa, causa, acao, responsavel, "data", status,
      situacao_atual, observ_evidencias, campo_extra_01,
      created_at, updated_at
    FROM ${TB}
    WHERE id = $1
    LIMIT 1;
    `,
    [id]
  );
  return res.rows[0] || null;
}

export async function create(payload) {
  const item = toInt(payload.item, null);
  const empresa = normalizeStr(payload.empresa);
  if (!item || !empresa) {
    const err = new Error('Campos obrigatórios: item, empresa.');
    err.statusCode = 400;
    throw err;
  }

  const causa = normalizeStr(payload.causa);
  const acao = normalizeStr(payload.acao);
  const responsavel = normalizeStr(payload.responsavel);
  const data = parseDateOrNull(payload.data);
  const status = normalizeStr(payload.status);
  const situacao_atual = normalizeStr(payload.situacao_atual);
  const observ_evidencias = normalizeStr(payload.observ_evidencias);
  const campo_extra_01 = normalizeStr(payload.campo_extra_01);

  const res = await q(
    `
    INSERT INTO ${TB}
      (item, empresa, causa, acao, responsavel, "data", status, situacao_atual, observ_evidencias, campo_extra_01)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id, item, empresa, causa, acao, responsavel, "data", status, situacao_atual, observ_evidencias, campo_extra_01, created_at, updated_at;
    `,
    [item, empresa, causa, acao, responsavel, data, status, situacao_atual, observ_evidencias, campo_extra_01]
  );

  return res.rows[0];
}

export async function updateById(id, payload) {
  const current = await getById(id);
  if (!current) return null;

  const item = toInt(payload.item, current.item);
  const empresa = normalizeStr(payload.empresa) ?? current.empresa;

  const causa = payload.causa !== undefined ? normalizeStr(payload.causa) : current.causa;
  const acao = payload.acao !== undefined ? normalizeStr(payload.acao) : current.acao;
  const responsavel = payload.responsavel !== undefined ? normalizeStr(payload.responsavel) : current.responsavel;
  const data = payload.data !== undefined ? parseDateOrNull(payload.data) : current.data;
  const status = payload.status !== undefined ? normalizeStr(payload.status) : current.status;
  const situacao_atual = payload.situacao_atual !== undefined ? normalizeStr(payload.situacao_atual) : current.situacao_atual;
  const observ_evidencias = payload.observ_evidencias !== undefined ? normalizeStr(payload.observ_evidencias) : current.observ_evidencias;
  const campo_extra_01 = payload.campo_extra_01 !== undefined ? normalizeStr(payload.campo_extra_01) : current.campo_extra_01;

  if (!item || !empresa) {
    const err = new Error('Campos obrigatórios: item, empresa.');
    err.statusCode = 400;
    throw err;
  }

  const res = await q(
    `
    UPDATE ${TB}
    SET
      item = $2,
      empresa = $3,
      causa = $4,
      acao = $5,
      responsavel = $6,
      "data" = $7,
      status = $8,
      situacao_atual = $9,
      observ_evidencias = $10,
      campo_extra_01 = $11,
      updated_at = NOW()
    WHERE id = $1
    RETURNING id, item, empresa, causa, acao, responsavel, "data", status, situacao_atual, observ_evidencias, campo_extra_01, created_at, updated_at;
    `,
    [id, item, empresa, causa, acao, responsavel, data, status, situacao_atual, observ_evidencias, campo_extra_01]
  );

  return res.rows[0];
}

export async function removeById(id) {
  const res = await q(`DELETE FROM ${TB} WHERE id = $1 RETURNING id;`, [id]);
  return res.rows[0]?.id ?? null;
}

/**
 * bulkUpsert:
 * - recebe array de linhas (como import do Excel)
 * - se vier `id`, atualiza por id
 * - se não vier id, cria
 */
export async function bulkUpsert(rows = []) {
  if (!Array.isArray(rows)) {
    const err = new Error('Payload inválido: esperado array.');
    err.statusCode = 400;
    throw err;
  }

  const out = [];
  for (const row of rows) {
    const id = toInt(row?.id, null);
    if (id) out.push(await updateById(id, row));
    else out.push(await create(row));
  }
  return out;
}
