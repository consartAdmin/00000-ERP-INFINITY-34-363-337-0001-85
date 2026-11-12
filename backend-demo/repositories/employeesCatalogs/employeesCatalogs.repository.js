// ╔══════════════════════════════════════════════════════════════════════╗
// ║ employeesCatalogs.repository.js — CRUD de Departamentos e Cargos     ║
// ║ kind = 'departments' | 'positions'                                   ║
// ║ Renomear atualiza o texto em employees (lista/relatórios usam nome). ║
// ║ Excluir só quando nenhum colaborador usa; senão, inativar.          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import {
  ensureCatalogs,
  TB_DEPARTMENTS, PK_DEPARTMENTS,
  TB_POSITIONS, PK_POSITIONS,
  TB_EMPLOYEES,
} from './employeesCatalogs.schema.js';

const KINDS = Object.freeze({
  departments: {
    table: TB_DEPARTMENTS,
    pk: PK_DEPARTMENTS,
    employeeText: 'department',
    label: 'Departamento',
  },
  positions: {
    table: TB_POSITIONS,
    pk: PK_POSITIONS,
    employeeText: 'position',
    label: 'Cargo',
  },
});

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function kindOf(kind) {
  const cfg = KINDS[kind];
  if (!cfg) throw httpError(400, 'Cadastro inválido.');
  return cfg;
}

function readActive(value) {
  if (value === undefined || value === null || value === '') return null;
  return ['true', '1', 't', 'yes', 'y', 'sim'].includes(String(value).toLowerCase());
}

function cleanText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function selectSql(kind) {
  const cfg = kindOf(kind);
  const counts = `(SELECT COUNT(*)::int FROM ${TB_EMPLOYEES} e WHERE e.${cfg.pk} = c.${cfg.pk}) AS employees_count`;

  if (kind === 'positions') {
    return `
      SELECT c.*, d.name AS department_name, ${counts}
      FROM ${cfg.table} c
      LEFT JOIN ${TB_DEPARTMENTS} d ON d.${PK_DEPARTMENTS} = c.${PK_DEPARTMENTS}
    `;
  }
  return `SELECT c.*, ${counts} FROM ${cfg.table} c`;
}

function normalize(kind, input = {}) {
  const out = {};
  if ('name' in input) out.name = cleanText(input.name, 100);
  if ('description' in input) out.description = cleanText(input.description, 2000);
  if ('active' in input) out.active = readActive(input.active) ?? true;
  if (kind === 'positions' && PK_DEPARTMENTS in input) {
    const id = Number(input[PK_DEPARTMENTS]);
    out[PK_DEPARTMENTS] = Number.isInteger(id) && id > 0 ? id : null;
  }
  return out;
}

function translateDbError(error, cfg) {
  if (error?.code === '23505') return httpError(409, `Já existe um ${cfg.label.toLowerCase()} com esse nome.`);
  if (error?.code === '23503') return httpError(400, 'Departamento informado não existe.');
  return error;
}

// ─────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────
export async function list(kind, { q = '', active = 'true' } = {}) {
  await ensureCatalogs();
  const params = [];
  let where = 'WHERE 1=1';

  const act = readActive(active);
  if (act !== null) {
    params.push(act);
    where += ` AND c.active = $${params.length}`;
  }

  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where += ` AND (LOWER(c.name) LIKE $${params.length} OR LOWER(COALESCE(c.description, '')) LIKE $${params.length})`;
  }

  const { rows } = await pool.query(`${selectSql(kind)} ${where} ORDER BY LOWER(c.name)`, params);
  return rows;
}

export async function getById(kind, id) {
  await ensureCatalogs();
  const cfg = kindOf(kind);
  const { rows } = await pool.query(`${selectSql(kind)} WHERE c.${cfg.pk} = $1 LIMIT 1`, [Number(id)]);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// Escrita
// ─────────────────────────────────────────────────────────────
export async function create(kind, input = {}) {
  await ensureCatalogs();
  const cfg = kindOf(kind);
  const data = normalize(kind, input);
  if (!data.name) throw httpError(400, 'Informe o nome.');

  const cols = Object.keys(data);
  const vals = Object.values(data);

  try {
    const { rows } = await pool.query(
      `INSERT INTO ${cfg.table} (${cols.join(', ')})
       VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING ${cfg.pk}`,
      vals
    );
    return getById(kind, rows[0][cfg.pk]);
  } catch (error) {
    throw translateDbError(error, cfg);
  }
}

export async function update(kind, id, input = {}) {
  await ensureCatalogs();
  const cfg = kindOf(kind);
  const data = normalize(kind, input);
  if ('name' in data && !data.name) throw httpError(400, 'Informe o nome.');
  if (!Object.keys(data).length) return getById(kind, id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const vals = Object.values(data);
    const sets = Object.keys(data).map((col, i) => `${col} = $${i + 1}`);
    const { rows } = await client.query(
      `UPDATE ${cfg.table} SET ${sets.join(', ')}, updated_at = NOW()
       WHERE ${cfg.pk} = $${vals.length + 1}
       RETURNING ${cfg.pk}, name`,
      [...vals, Number(id)]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    // mantém o nome gravado nos colaboradores igual ao do cadastro
    if (data.name) {
      await client.query(
        `UPDATE ${TB_EMPLOYEES} SET ${cfg.employeeText} = $1, updated_at = NOW()
         WHERE ${cfg.pk} = $2 AND ${cfg.employeeText} IS DISTINCT FROM $1`,
        [rows[0].name, Number(id)]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw translateDbError(error, cfg);
  } finally {
    client.release();
  }

  return getById(kind, id);
}

export async function remove(kind, id) {
  await ensureCatalogs();
  const cfg = kindOf(kind);

  const used = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${TB_EMPLOYEES} WHERE ${cfg.pk} = $1`,
    [Number(id)]
  );
  const total = used.rows[0]?.total || 0;
  if (total > 0) {
    throw httpError(409, `${cfg.label} usado por ${total} colaborador(es). Inative em vez de excluir.`);
  }

  const { rowCount } = await pool.query(`DELETE FROM ${cfg.table} WHERE ${cfg.pk} = $1`, [Number(id)]);
  return rowCount > 0;
}
