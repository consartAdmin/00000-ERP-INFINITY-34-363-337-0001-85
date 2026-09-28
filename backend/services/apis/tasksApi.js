// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: tasksApi.js                                           ║
// ║ MODULE: Tasks API / DAL                                     ║
// ║ CONSART ERP | PostgreSQL | ESM                              ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB_TASKS = 'public.tasks';
const TB_TASK_GROUPS = 'public."taskGroups"';

function toNull(value) {
  return value === undefined || value === '' ? null : value;
}

function toBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const s = String(value).trim().toLowerCase();

  if (['true', '1', 't', 'yes', 'y', 'sim', 's'].includes(s)) return true;
  if (['false', '0', 'f', 'no', 'n', 'nao', 'não'].includes(s)) return false;

  return fallback;
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === '') return null;

  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function ensureTasksGroupColumn() {
  await pool.query(`
    ALTER TABLE ${TB_TASKS}
    ADD COLUMN IF NOT EXISTS task_group_id INTEGER;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_tasks_task_group'
      ) THEN
        ALTER TABLE ${TB_TASKS}
        ADD CONSTRAINT fk_tasks_task_group
        FOREIGN KEY (task_group_id)
        REFERENCES ${TB_TASK_GROUPS}(task_group_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tasks_task_group_id
    ON ${TB_TASKS} (task_group_id);
  `);
}

export async function listTasks({
  q = '',
  status = '',
  active = '',
  task_group_id = '',
  taskGroupId = '',
} = {}) {
  await ensureTasksGroupColumn();

  const params = [];
  const where = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(`
      (
        t.title ILIKE $${params.length}
        OR t.description ILIKE $${params.length}
        OR t.observations ILIKE $${params.length}
      )
    `);
  }

  if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }

  if (active !== '') {
    params.push(toBool(active, true));
    where.push(`t.active = $${params.length}`);
  }

  const groupId = toIntOrNull(task_group_id || taskGroupId);

  if (groupId !== null) {
    params.push(groupId);
    where.push(`t.task_group_id = $${params.length}`);
  }

  const sql = `
    SELECT
      t.*,

      tg.name AS task_group_name,
      tg.color AS task_group_color,
      tg.icon AS task_group_icon,
      tg.sort_order AS task_group_sort_order,
      tg.is_active AS task_group_is_active

    FROM ${TB_TASKS} t

    LEFT JOIN ${TB_TASK_GROUPS} tg
      ON tg.task_group_id = t.task_group_id

    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}

    ORDER BY
      t.created_at DESC,
      t.id DESC
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getTaskById(id) {
  await ensureTasksGroupColumn();

  const { rows } = await pool.query(
    `
    SELECT
      t.*,

      tg.name AS task_group_name,
      tg.color AS task_group_color,
      tg.icon AS task_group_icon,
      tg.sort_order AS task_group_sort_order,
      tg.is_active AS task_group_is_active

    FROM ${TB_TASKS} t

    LEFT JOIN ${TB_TASK_GROUPS} tg
      ON tg.task_group_id = t.task_group_id

    WHERE t.id = $1
    `,
    [id]
  );

  return rows[0] || null;
}

export async function createTask(data = {}) {
  await ensureTasksGroupColumn();

  const {
    title,
    description,
    status,
    assigned_to,
    created_by,
    priority,
    started_at,
    finished_at,
    duration_ms,
    observations,
    active,
    task_group_id,
    taskGroupId,
  } = data;

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB_TASKS} (
      title,
      description,
      status,
      assigned_to,
      created_by,
      priority,
      started_at,
      finished_at,
      duration_ms,
      observations,
      active,
      task_group_id
    )
    VALUES (
      $1,
      $2,
      COALESCE($3, 'OPEN'),
      $4,
      $5,
      COALESCE($6, 'NORMAL'),
      $7,
      $8,
      COALESCE($9, 0),
      $10,
      COALESCE($11, TRUE),
      $12
    )
    RETURNING *
    `,
    [
      title,
      toNull(description),
      toNull(status),
      toNull(assigned_to),
      toNull(created_by),
      toNull(priority),
      toNull(started_at),
      toNull(finished_at),
      toNull(duration_ms),
      toNull(observations),
      active === undefined ? true : toBool(active, true),
      toIntOrNull(task_group_id ?? taskGroupId),
    ]
  );

  return rows[0];
}

export async function updateTask(id, data = {}) {
  await ensureTasksGroupColumn();

  const current = await getTaskById(id);
  if (!current) return null;

  const updated = {
    title: data.title ?? current.title,
    description: data.description ?? current.description,
    status: data.status ?? current.status,
    assigned_to: data.assigned_to ?? current.assigned_to,
    created_by: data.created_by ?? current.created_by,
    priority: data.priority ?? current.priority,
    started_at: data.started_at ?? current.started_at,
    finished_at: data.finished_at ?? current.finished_at,
    duration_ms: data.duration_ms ?? current.duration_ms,
    observations: data.observations ?? current.observations,
    active: data.active === undefined ? current.active : toBool(data.active, current.active),
    task_group_id:
      data.task_group_id !== undefined
        ? toIntOrNull(data.task_group_id)
        : data.taskGroupId !== undefined
          ? toIntOrNull(data.taskGroupId)
          : current.task_group_id,
  };

  const { rows } = await pool.query(
    `
    UPDATE ${TB_TASKS}
    SET
      title = $1,
      description = $2,
      status = $3,
      assigned_to = $4,
      created_by = $5,
      priority = $6,
      started_at = $7,
      finished_at = $8,
      duration_ms = $9,
      observations = $10,
      active = $11,
      task_group_id = $12
    WHERE id = $13
    RETURNING *
    `,
    [
      updated.title,
      toNull(updated.description),
      toNull(updated.status),
      toNull(updated.assigned_to),
      toNull(updated.created_by),
      toNull(updated.priority),
      toNull(updated.started_at),
      toNull(updated.finished_at),
      toNull(updated.duration_ms),
      toNull(updated.observations),
      updated.active,
      toIntOrNull(updated.task_group_id),
      id,
    ]
  );

  return rows[0];
}

export async function finishTask(id) {
  await ensureTasksGroupColumn();

  const { rows } = await pool.query(
    `
    UPDATE ${TB_TASKS}
    SET
      status = 'FINISHED',
      finished_at = CURRENT_TIMESTAMP,
      duration_ms = CASE
        WHEN started_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) * 1000
        ELSE duration_ms
      END
    WHERE id = $1
    RETURNING *
    `,
    [id]
  );

  return rows[0] || null;
}

export async function deleteTask(id) {
  await ensureTasksGroupColumn();

  const { rowCount } = await pool.query(
    `
    DELETE FROM ${TB_TASKS}
    WHERE id = $1
    `,
    [id]
  );

  return rowCount > 0;
}

export default {
  ensureTasksGroupColumn,
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  finishTask,
  deleteTask,
};