/* ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ crmDealsStagesApi.js                                                    ║
 * ║ API DAL de Etapas do CRM                                                ║
 * ║ CONSART ERP | Backend ESM + PostgreSQL                                  ║
 * ║ Tabela: public."crmDealsStages"                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝ */

import pool from '../../config/db.js';

/* ========================================================================== */
/* HELPERS                                                                    */
/* ========================================================================== */

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;

  const v = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(v)) return false;

  return fallback;
}

function normalizeInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function buildCodeFromStageName(stageName = '') {
  return String(stageName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .toUpperCase();
}

function mapStageRow(row) {
  if (!row) return null;

  const isActive = row.is_active ?? true;
  const code = row.code ?? row.stage_code ?? null;
  const name = row.name ?? row.stage_name ?? null;

  return {
    id: row.id,
    name,
    code,
    stage_name: row.stage_name ?? name,
    stage_code: row.stage_code ?? code,
    color: row.color ?? '#cbd5e1',
    icon: row.icon ?? null,
    sort_order: Number(row.sort_order ?? 0),
    is_active: isActive,
    active: isActive,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function buildStageSelectSql() {
  return `
    SELECT
      s.id,
      s.stage_name AS name,
      COALESCE(s.code, s.stage_code) AS code,
      s.stage_name,
      s.stage_code,
      s.color,
      s.icon,
      s.sort_order,
      COALESCE(s.is_active, TRUE) AS is_active,
      s.created_at,
      s.updated_at
    FROM public."crmDealsStages" s
  `;
}

/* ========================================================================== */
/* API                                                                        */
/* ========================================================================== */

export async function listStages(params = {}) {
  const q = normalizeText(params.q);
  const onlyActive =
    params.only_active === undefined
      ? true
      : normalizeBoolean(params.only_active, true);

  const limit = Math.max(1, Math.min(500, normalizeInteger(params.limit, 100)));
  const offset = Math.max(0, normalizeInteger(params.offset, 0));

  const values = [];
  const where = [];

  if (onlyActive) {
    values.push(true);
    where.push(`COALESCE(s.is_active, TRUE) = $${values.length}`);
  }

  if (q) {
    values.push(`%${q}%`);
    const idx = values.length;
    where.push(`(
      s.stage_name ILIKE $${idx}
      OR s.stage_code ILIKE $${idx}
      OR COALESCE(s.code, '') ILIKE $${idx}
      OR COALESCE(s.icon, '') ILIKE $${idx}
    )`);
  }

  values.push(limit);
  const limitIndex = values.length;

  values.push(offset);
  const offsetIndex = values.length;

  const sql = `
    ${buildStageSelectSql()}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(s.sort_order, 0) ASC, s.stage_name ASC, s.id ASC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const { rows } = await pool.query(sql, values);
  return rows.map(mapStageRow);
}

export async function countStages(params = {}) {
  const q = normalizeText(params.q);
  const onlyActive =
    params.only_active === undefined
      ? true
      : normalizeBoolean(params.only_active, true);

  const values = [];
  const where = [];

  if (onlyActive) {
    values.push(true);
    where.push(`COALESCE(s.is_active, TRUE) = $${values.length}`);
  }

  if (q) {
    values.push(`%${q}%`);
    const idx = values.length;
    where.push(`(
      s.stage_name ILIKE $${idx}
      OR s.stage_code ILIKE $${idx}
      OR COALESCE(s.code, '') ILIKE $${idx}
      OR COALESCE(s.icon, '') ILIKE $${idx}
    )`);
  }

  const sql = `
    SELECT COUNT(*)::int AS total
    FROM public."crmDealsStages" s
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0]?.total || 0;
}

export async function getStageById(id) {
  const stageId = normalizeInteger(id, 0);
  if (!stageId) return null;

  const sql = `
    ${buildStageSelectSql()}
    WHERE s.id = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [stageId]);
  return mapStageRow(rows[0] || null);
}

export async function createStage(payload = {}) {
  const stage_name = normalizeText(payload.stage_name);
  const generatedCode = buildCodeFromStageName(stage_name);

  const stage_code = normalizeText(payload.stage_code || generatedCode);
  const code = normalizeText(payload.code || stage_code);
  const color = normalizeText(payload.color || '#cbd5e1');
  const icon = normalizeText(payload.icon || '');
  const sort_order = normalizeInteger(payload.sort_order, 0);
  const is_active = normalizeBoolean(payload.is_active, true);

  if (!stage_name) {
    const err = new Error('O campo "stage_name" é obrigatório.');
    err.status = 400;
    throw err;
  }

  if (!stage_code) {
    const err = new Error('O campo "stage_code" é obrigatório.');
    err.status = 400;
    throw err;
  }

  const sql = `
    INSERT INTO public."crmDealsStages" (
      stage_name,
      stage_code,
      color,
      icon,
      sort_order,
      is_active,
      code,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    RETURNING
      id,
      stage_name AS name,
      COALESCE(code, stage_code) AS code,
      stage_name,
      stage_code,
      color,
      icon,
      sort_order,
      COALESCE(is_active, TRUE) AS is_active,
      created_at,
      updated_at
  `;

  try {
    const { rows } = await pool.query(sql, [
      stage_name,
      stage_code,
      color,
      icon || null,
      sort_order,
      is_active,
      code || null,
    ]);

    return mapStageRow(rows[0] || null);
  } catch (error) {
    if (
      String(error?.message || '').includes('crmDealsStages_stage_code_key') ||
      error?.constraint === 'crmDealsStages_stage_code_key'
    ) {
      const err = new Error('Já existe uma etapa com este stage_code.');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

export async function updateStage(id, payload = {}) {
  const stageId = normalizeInteger(id, 0);
  if (!stageId) {
    const err = new Error('ID da etapa inválido.');
    err.status = 400;
    throw err;
  }

  const current = await getStageById(stageId);
  if (!current) {
    const err = new Error('Etapa não encontrada.');
    err.status = 404;
    throw err;
  }

  const stage_name =
    payload.stage_name !== undefined
      ? normalizeText(payload.stage_name, current.stage_name)
      : current.stage_name;

  const stage_code =
    payload.stage_code !== undefined
      ? normalizeText(payload.stage_code, current.stage_code || buildCodeFromStageName(stage_name))
      : (current.stage_code || buildCodeFromStageName(stage_name));

  const code =
    payload.code !== undefined
      ? normalizeText(payload.code, current.code || stage_code)
      : (current.code || stage_code);

  const color =
    payload.color !== undefined
      ? normalizeText(payload.color, current.color || '#cbd5e1')
      : (current.color || '#cbd5e1');

  const icon =
    payload.icon !== undefined
      ? normalizeText(payload.icon, current.icon || '')
      : (current.icon || '');

  const sort_order =
    payload.sort_order !== undefined
      ? normalizeInteger(payload.sort_order, current.sort_order || 0)
      : (current.sort_order || 0);

  const is_active =
    payload.is_active !== undefined
      ? normalizeBoolean(payload.is_active, current.is_active)
      : current.is_active;

  if (!stage_name) {
    const err = new Error('O campo "stage_name" é obrigatório.');
    err.status = 400;
    throw err;
  }

  if (!stage_code) {
    const err = new Error('O campo "stage_code" é obrigatório.');
    err.status = 400;
    throw err;
  }

  const sql = `
    UPDATE public."crmDealsStages"
    SET
      stage_name = $2,
      stage_code = $3,
      color = $4,
      icon = $5,
      sort_order = $6,
      is_active = $7,
      code = $8,
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id,
      stage_name AS name,
      COALESCE(code, stage_code) AS code,
      stage_name,
      stage_code,
      color,
      icon,
      sort_order,
      COALESCE(is_active, TRUE) AS is_active,
      created_at,
      updated_at
  `;

  try {
    const { rows } = await pool.query(sql, [
      stageId,
      stage_name,
      stage_code,
      color,
      icon || null,
      sort_order,
      is_active,
      code || null,
    ]);

    return mapStageRow(rows[0] || null);
  } catch (error) {
    if (
      String(error?.message || '').includes('crmDealsStages_stage_code_key') ||
      error?.constraint === 'crmDealsStages_stage_code_key'
    ) {
      const err = new Error('Já existe uma etapa com este stage_code.');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

export async function removeStage(id, options = {}) {
  const stageId = normalizeInteger(id, 0);
  if (!stageId) {
    const err = new Error('ID da etapa inválido.');
    err.status = 400;
    throw err;
  }

  const hardDelete = normalizeBoolean(options.hardDelete, false);

  if (hardDelete) {
    const sql = `
      DELETE FROM public."crmDealsStages"
      WHERE id = $1
      RETURNING
        id,
        stage_name AS name,
        COALESCE(code, stage_code) AS code,
        stage_name,
        stage_code,
        color,
        icon,
        sort_order,
        COALESCE(is_active, TRUE) AS is_active,
        created_at,
        updated_at
    `;

    const { rows } = await pool.query(sql, [stageId]);
    return mapStageRow(rows[0] || null);
  }

  const sql = `
    UPDATE public."crmDealsStages"
    SET
      is_active = FALSE,
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id,
      stage_name AS name,
      COALESCE(code, stage_code) AS code,
      stage_name,
      stage_code,
      color,
      icon,
      sort_order,
      COALESCE(is_active, TRUE) AS is_active,
      created_at,
      updated_at
  `;

  const { rows } = await pool.query(sql, [stageId]);
  return mapStageRow(rows[0] || null);
}