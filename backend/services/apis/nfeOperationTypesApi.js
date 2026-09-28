'use strict';

import pool from '../../config/db.js';

const TB = 'public."nfeOperationTypes"';

function positiveInteger(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function text(value, fallback = null) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function boolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(value).toLowerCase());
}

function rowToOperation(row) {
  return row ? {
    ...row,
    operation_type_id: Number(row.operation_type_id),
    generates_receivable: Boolean(row.generates_receivable),
    moves_stock: Boolean(row.moves_stock),
    active: Boolean(row.active),
  } : null;
}

export async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB} (
      operation_type_id BIGSERIAL PRIMARY KEY,
      code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      nature_operation VARCHAR(120) NOT NULL,
      cfop_internal VARCHAR(4),
      cfop_interstate VARCHAR(4),
      generates_receivable BOOLEAN NOT NULL DEFAULT FALSE,
      moves_stock BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_nfe_operation_cfop_internal
        CHECK (cfop_internal IS NULL OR cfop_internal ~ '^[0-9]{4}$'),
      CONSTRAINT chk_nfe_operation_cfop_interstate
        CHECK (cfop_interstate IS NULL OR cfop_interstate ~ '^[0-9]{4}$')
    );

    INSERT INTO ${TB} (
      code, name, nature_operation, generates_receivable, moves_stock, active
    ) VALUES (
      'BONUS', 'Bonificação', 'REMESSA EM BONIFICAÇÃO', FALSE, TRUE, TRUE
    ) ON CONFLICT (code) DO NOTHING;
  `);
  return { ok: true };
}

export async function search({ q = '', active = null, limit = 100, offset = 0 } = {}) {
  await ensureTable();
  const args = [];
  const where = [];
  if (text(q)) {
    args.push(`%${text(q).toLowerCase()}%`);
    where.push(`(LOWER(code) LIKE $${args.length} OR LOWER(name) LIKE $${args.length} OR LOWER(nature_operation) LIKE $${args.length})`);
  }
  if (active !== null && active !== undefined && active !== '') {
    args.push(boolean(active));
    where.push(`active = $${args.length}`);
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rowsArgs = [...args, safeLimit, safeOffset];
  const [rowsResult, countResult] = await Promise.all([
    pool.query(`SELECT * FROM ${TB} ${filter} ORDER BY name, operation_type_id LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, rowsArgs),
    pool.query(`SELECT COUNT(*) AS total FROM ${TB} ${filter}`, args),
  ]);
  return { ok: true, rows: rowsResult.rows.map(rowToOperation), total: Number(countResult.rows[0]?.total || 0) };
}

export async function getById(operationTypeId) {
  await ensureTable();
  const id = positiveInteger(operationTypeId);
  if (!id) return { ok: false, error: 'operation_type_id inválido' };
  const { rows } = await pool.query(`SELECT * FROM ${TB} WHERE operation_type_id = $1`, [id]);
  return rows[0] ? { ok: true, operation: rowToOperation(rows[0]) } : { ok: false, error: 'NOT_FOUND' };
}

export async function getByCode(code) {
  await ensureTable();
  const normalized = text(code)?.toUpperCase();
  if (!normalized) return { ok: false, error: 'code inválido' };
  const { rows } = await pool.query(`SELECT * FROM ${TB} WHERE UPPER(code) = $1`, [normalized]);
  return rows[0] ? { ok: true, operation: rowToOperation(rows[0]) } : { ok: false, error: 'NOT_FOUND' };
}

export async function create(data = {}) {
  await ensureTable();
  const code = text(data.code)?.toUpperCase();
  const name = text(data.name);
  const nature = text(data.nature_operation);
  if (!code || !name || !nature) return { ok: false, error: 'code, name e nature_operation são obrigatórios' };
  const { rows } = await pool.query(`
    INSERT INTO ${TB} (code, name, nature_operation, cfop_internal, cfop_interstate, generates_receivable, moves_stock, active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
  `, [code, name, nature, text(data.cfop_internal), text(data.cfop_interstate), boolean(data.generates_receivable), boolean(data.moves_stock, true), boolean(data.active, true)]);
  return { ok: true, operation: rowToOperation(rows[0]) };
}

export async function update(operationTypeId, patch = {}) {
  await ensureTable();
  const id = positiveInteger(operationTypeId);
  if (!id) return { ok: false, error: 'operation_type_id inválido' };
  const allowed = ['code','name','nature_operation','cfop_internal','cfop_interstate','generates_receivable','moves_stock','active'];
  const sets = [];
  const args = [];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (['code','name','nature_operation','cfop_internal','cfop_interstate'].includes(key)) value = text(value);
    if (key === 'code' && value) value = value.toUpperCase();
    if (['generates_receivable','moves_stock','active'].includes(key)) value = boolean(value);
    args.push(value);
    sets.push(`${key} = $${args.length}`);
  }
  if (!sets.length) return { ok: false, error: 'Nenhum campo para atualizar' };
  args.push(id);
  const { rows } = await pool.query(`UPDATE ${TB} SET ${sets.join(', ')}, updated_at = NOW() WHERE operation_type_id = $${args.length} RETURNING *`, args);
  return rows[0] ? { ok: true, operation: rowToOperation(rows[0]) } : { ok: false, error: 'NOT_FOUND' };
}

export async function remove(operationTypeId) {
  await ensureTable();
  const id = positiveInteger(operationTypeId);
  if (!id) return { ok: false, error: 'operation_type_id inválido' };
  try {
    const { rows } = await pool.query(`DELETE FROM ${TB} WHERE operation_type_id = $1 RETURNING *`, [id]);
    return rows[0] ? { ok: true, deleted: 1, operation: rowToOperation(rows[0]) } : { ok: false, error: 'NOT_FOUND' };
  } catch (error) {
    if (error?.code === '23503') return { ok: false, error: 'OPERATION_TYPE_IN_USE', message: 'Esta operação fiscal já está vinculada e não pode ser excluída. Desative-a em vez de excluir.' };
    throw error;
  }
}

export default { ensureTable, search, getById, getByCode, create, update, remove };
