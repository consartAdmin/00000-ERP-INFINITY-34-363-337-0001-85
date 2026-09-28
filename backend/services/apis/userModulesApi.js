// ╔══════════════════════════════════════════════════════════════════════╗
// ║ userModulesApi.js — DAL para permissões de módulos por usuário      ║
// ║ Tabela: public."userModules"                                        ║
// ║ Funções: ensureTable, list, getById, create, update, remove         ║
// ║          listModulesForUser (JOIN com "moduleSystem")               ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."userModules"';
const ALIAS = 'um';

/* ───────────────────────────── Helpers ───────────────────────────── */

const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNum = (v) => (isFiniteNum(v) ? Number(v) : null);

/** Mapeia a linha crua do banco para objeto de domínio */
function mapRow(r = {}) {
  return {
    id: r.id,
    usuario_id: r.usuario_id,
    modulo_id: r.modulo_id,
    pode_acessar: r.pode_acessar,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Monta WHERE + params dinamicamente
 * Filtros suportados:
 *   - usuario_id  (number)
 *   - modulo_id   (number)
 *   - pode_acessar (boolean)
 */
function buildWhereAndParams({ usuario_id, modulo_id, pode_acessar } = {}) {
  const where = [];
  const params = [];

  if (isFiniteNum(usuario_id)) {
    params.push(Number(usuario_id));
    where.push(`${ALIAS}.usuario_id = $${params.length}`);
  }

  if (isFiniteNum(modulo_id)) {
    params.push(Number(modulo_id));
    where.push(`${ALIAS}.modulo_id = $${params.length}`);
  }

  if (typeof pode_acessar === 'boolean') {
    params.push(pode_acessar);
    where.push(`${ALIAS}.pode_acessar = $${params.length}`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { clause, params };
}

/* ───────────────────── ensureTable() ───────────────────── */
/**
 * Garante a existência da tabela public."userModules".
 * Não altera estrutura caso a tabela já exista.
 * Também garante o índice único (usuario_id, modulo_id) p/ ON CONFLICT.
 */
export async function ensureTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS public."userModules" (
      id           BIGSERIAL PRIMARY KEY,
      usuario_id   BIGINT NOT NULL,
      modulo_id    BIGINT NOT NULL,
      pode_acessar BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.query(sql);

  // Índice único para suportar ON CONFLICT (usuario_id, modulo_id)
  const uniqueIdx = `
    CREATE UNIQUE INDEX IF NOT EXISTS usermodules_usuario_modulo_uidx
    ON public."userModules"(usuario_id, modulo_id);
  `;
  await pool.query(uniqueIdx);
}

/* ───────────────────────────── API CRUD ───────────────────────────── */

/**
 * Lista vínculos usuário/módulo com paginação, ordenação e filtros.
 *
 * @param {Object} opts
 * @param {number} opts.page         - página (1-based)
 * @param {number} opts.limit        - registros por página
 * @param {string} opts.sort         - coluna: id, usuario_id, modulo_id, pode_acessar, created_at, updated_at
 * @param {string} opts.dir          - direção (asc|desc)
 * @param {number} opts.usuario_id   - filtra por usuário
 * @param {number} opts.modulo_id    - filtra por módulo
 * @param {boolean} opts.pode_acessar - filtra por permissão (true/false)
 */
export async function list({
  page = 1,
  limit = 20,
  sort = 'id',
  dir = 'asc',
  usuario_id,
  modulo_id,
  pode_acessar,
} = {}) {
  const _page = Math.max(1, Number(page) || 1);
  const _limit = Math.min(200, Math.max(1, Number(limit) || 20));
  const offset = (_page - 1) * _limit;

  const sortCols = new Set([
    'id',
    'usuario_id',
    'modulo_id',
    'pode_acessar',
    'created_at',
    'updated_at',
  ]);

  const _sort = sortCols.has(String(sort)) ? String(sort) : 'id';
  const _dir = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const { clause, params } = buildWhereAndParams({
    usuario_id,
    modulo_id,
    pode_acessar,
  });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        ${ALIAS}.id,
        ${ALIAS}.usuario_id,
        ${ALIAS}.modulo_id,
        ${ALIAS}.pode_acessar,
        ${ALIAS}.created_at,
        ${ALIAS}.updated_at
      FROM ${TB} ${ALIAS}
      ${clause}
      ORDER BY ${ALIAS}.${_sort} ${_dir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, _limit, offset]
    );

    const countRes = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM ${TB} ${ALIAS}
      ${clause}
      `,
      params
    );

    const mapped = rows.map(mapRow);

    return {
      ok: true,
      data: {
        rows: mapped,
        total: countRes.rows[0]?.total ?? 0,
        page: _page,
        limit: _limit,
      },
    };
  } catch (err) {
    console.error('[userModulesApi:list] error:', err);
    return { ok: false, error: 'Failed to list user modules.' };
  }
}

/** Busca vínculo por ID */
export async function getById(id) {
  const uid = toNum(id);
  if (!uid) return { ok: false, error: 'id is required.' };

  try {
    const { rows } = await pool.query(
      `
      SELECT
        ${ALIAS}.id,
        ${ALIAS}.usuario_id,
        ${ALIAS}.modulo_id,
        ${ALIAS}.pode_acessar,
        ${ALIAS}.created_at,
        ${ALIAS}.updated_at
      FROM ${TB} ${ALIAS}
      WHERE ${ALIAS}.id = $1
      `,
      [uid]
    );

    if (!rows.length) return { ok: false, error: 'UserModule not found.' };
    return { ok: true, data: mapRow(rows[0]) };
  } catch (err) {
    console.error('[userModulesApi:getById] error:', err);
    return { ok: false, error: 'Failed to get user module.' };
  }
}

/**
 * Cria um novo vínculo usuário/módulo.
 * Espera:
 *  - usuario_id (number) obrigatório
 *  - modulo_id  (number) obrigatório
 *  - pode_acessar (boolean) opcional (default false)
 *
 * Comportamento idempotente:
 *  - Se já existir (usuario_id, modulo_id), atualiza pode_acessar e retorna.
 */
export async function create(data = {}) {
  const usuario_id   = Number(data.usuario_id);
  const modulo_id    = Number(data.modulo_id);
  const pode_acessar = data.pode_acessar === undefined ? false : !!data.pode_acessar;

  if (!usuario_id || !modulo_id) {
    return { ok: false, error: 'usuario_id e modulo_id são obrigatórios.' };
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO public."userModules" (usuario_id, modulo_id, pode_acessar)
      VALUES ($1, $2, $3)
      ON CONFLICT (usuario_id, modulo_id)
      DO UPDATE SET
        pode_acessar = EXCLUDED.pode_acessar,
        updated_at   = NOW()
      RETURNING
        id,
        usuario_id,
        modulo_id,
        pode_acessar,
        created_at,
        updated_at
      `,
      [usuario_id, modulo_id, pode_acessar]
    );

    return { ok: true, data: mapRow(rows[0]) };
  } catch (err) {
    console.error('[userModulesApi:create] error inesperado:', err);
    return { ok: false, error: 'Failed to create or update user module.' };
  }
}

/**
 * Atualiza parcialmente um vínculo usuário/módulo.
 * Patch pode conter:
 *  - usuario_id
 *  - modulo_id
 *  - pode_acessar
 */
export async function update(id, patch = {}) {
  const uid = toNum(id);
  if (!uid) return { ok: false, error: 'id is required.' };

  const fields = ['usuario_id', 'modulo_id', 'pode_acessar'];

  const sets = [];
  const params = [];

  fields.forEach((k) => {
    if (patch[k] !== undefined) {
      params.push(patch[k]);
      sets.push(`${k} = $${params.length}`);
    }
  });

  if (!sets.length) return { ok: false, error: 'Nothing to update.' };

  // Atualiza também updated_at
  sets.push(`updated_at = NOW()`);

  params.push(uid);

  try {
    const { rows } = await pool.query(
      `
      UPDATE ${TB}
      SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, ${fields.join(',')}, created_at, updated_at
      `,
      params
    );

    if (!rows.length) return { ok: false, error: 'UserModule not found.' };
    return { ok: true, data: mapRow(rows[0]) };
  } catch (err) {
    console.error('[userModulesApi:update] error:', err);
    return { ok: false, error: 'Failed to update user module.' };
  }
}

/** Remove definitivamente o vínculo (hard delete) */
export async function remove(id) {
  const uid = toNum(id);
  if (!uid) return { ok: false, error: 'id is required.' };

  try {
    const { rows } = await pool.query(
      `
      DELETE FROM ${TB}
      WHERE id = $1
      RETURNING id, usuario_id, modulo_id
      `,
      [uid]
    );

    if (!rows.length) return { ok: false, error: 'UserModule not found.' };

    return {
      ok: true,
      data: {
        id: rows[0].id,
        usuario_id: rows[0].usuario_id,
        modulo_id: rows[0].modulo_id,
      },
    };
  } catch (err) {
    console.error('[userModulesApi:remove] error:', err);
    return { ok: false, error: 'Failed to delete user module.' };
  }
}

/* ─────────── JOIN com moduleSystem: módulos por usuário ─────────── */

/**
 * Retorna a lista de módulos (da "moduleSystem") que o usuário pode acessar.
 * - Faz JOIN userModules ⇔ moduleSystem
 * - Considera pode_acessar = true
 * - Considera moduleSystem.is_active = true
 *
 * @param {number} usuarioId
 * @returns {Promise<{ok:boolean, data?:Array, error?:string}>}
 */
export async function listModulesForUser(usuarioId) {
  const uid = toNum(usuarioId);
  if (!uid) return { ok: false, error: 'usuarioId inválido.' };

  try {
    const { rows } = await pool.query(
      `
      SELECT
        m.id         AS module_id,
        um.id        AS user_module_id,
        um.usuario_id,
        um.modulo_id,
        um.pode_acessar,
        m.name,
        m.path,
        m.is_active
      FROM public."userModules" um
      JOIN public."moduleSystem" m
        ON m.id = um.modulo_id
      WHERE um.usuario_id   = $1
        AND um.pode_acessar = TRUE
        AND m.is_active     = TRUE
      ORDER BY m.id
      `,
      [uid]
    );

    return { ok: true, data: rows };
  } catch (err) {
    console.error('[userModulesApi:listModulesForUser] error:', err);
    return { ok: false, error: 'Failed to list modules for user.' };
  }
}

/* ─────────────────────────── Default export ─────────────────────────── */

export default {
  ensureTable,
  list,
  getById,
  create,
  update,
  remove,
  listModulesForUser,
};
