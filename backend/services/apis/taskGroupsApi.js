// ╔══════════════════════════════════════════════════════════════════════╗
// ║ taskGroupsApi.js — Service DB Access                                ║
// ║ Tabela: public."taskGroups"                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."taskGroups"';

const toStrOrNull = (v) => (v === '' || v == null ? null : String(v).trim());
const toBool = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return ['true', '1', 't', 'yes', 'y', 'sim', 's'].includes(s);
};

export async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB} (
      task_group_id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      color VARCHAR(20),
      icon VARCHAR(20),
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_task_groups_active
      ON ${TB} (is_active);

    CREATE INDEX IF NOT EXISTS idx_task_groups_name
      ON ${TB} (name);
  `);
}

export async function list({ q = '', active = '', page = 1, limit = 50 } = {}) {
  await ensureTable();

  page = Math.max(Number(page) || 1, 1);
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(`name ILIKE $${params.length}`);
  }

  if (active !== '') {
    params.push(toBool(active));
    where.push(`is_active = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `
    SELECT
      task_group_id,
      name,
      color,
      icon,
      sort_order,
      is_active,
      created_at,
      updated_at
    FROM ${TB}
    ${whereSql}
    ORDER BY sort_order ASC, name ASC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, limit, offset]
  );

  const totalResult = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM ${TB}
    ${whereSql}
    `,
    params
  );

  return {
    rows,
    total: totalResult.rows[0]?.total || 0,
    page,
    limit,
  };
}

export async function getById(id) {
  await ensureTable();

  const { rows } = await pool.query(
    `
    SELECT *
    FROM ${TB}
    WHERE task_group_id = $1
    `,
    [id]
  );

  return rows[0] || null;
}

export async function create(payload = {}) {
  await ensureTable();

  const name = toStrOrNull(payload.name);
  if (!name) {
    const err = new Error('Nome do grupo é obrigatório.');
    err.status = 400;
    throw err;
  }

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB} (
      name,
      color,
      icon,
      sort_order,
      is_active,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), NOW(), NOW())
    RETURNING *
    `,
    [
      name,
      toStrOrNull(payload.color),
      toStrOrNull(payload.icon),
      Number(payload.sort_order || payload.sortOrder || 0),
      toBool(payload.is_active ?? payload.isActive),
    ]
  );

  return rows[0];
}

export async function update(id, payload = {}) {
  await ensureTable();

  const current = await getById(id);
  if (!current) {
    const err = new Error('Grupo de tarefa não encontrado.');
    err.status = 404;
    throw err;
  }

  const name = toStrOrNull(payload.name);
  if (!name) {
    const err = new Error('Nome do grupo é obrigatório.');
    err.status = 400;
    throw err;
  }

  const { rows } = await pool.query(
    `
    UPDATE ${TB}
    SET
      name = $2,
      color = $3,
      icon = $4,
      sort_order = $5,
      is_active = COALESCE($6, is_active),
      updated_at = NOW()
    WHERE task_group_id = $1
    RETURNING *
    `,
    [
      id,
      name,
      toStrOrNull(payload.color),
      toStrOrNull(payload.icon),
      Number(payload.sort_order || payload.sortOrder || 0),
      toBool(payload.is_active ?? payload.isActive),
    ]
  );

  return rows[0];
}

export async function remove(id) {
  await ensureTable();

  const { rows } = await pool.query(
    `
    UPDATE ${TB}
    SET is_active = FALSE,
        updated_at = NOW()
    WHERE task_group_id = $1
    RETURNING *
    `,
    [id]
  );

  return rows[0] || null;
}

export async function restore(id) {
  await ensureTable();

  const { rows } = await pool.query(
    `
    UPDATE ${TB}
    SET is_active = TRUE,
        updated_at = NOW()
    WHERE task_group_id = $1
    RETURNING *
    `,
    [id]
  );

  return rows[0] || null;
}

export default {
  ensureTable,
  list,
  getById,
  create,
  update,
  remove,
  restore,
};