// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ sellerByUserApi.js — API/DAL (Usuário x Vendedor) | CONSART ERP             ║
// ║ PostgreSQL (pool) • ESM                                                     ║
// ║ Tabela: public."sellerByUser"                                               ║
// ║                                                                            ║
// ║ ✅ ensureTables (DDL + trigger updated_at)                                   ║
// ║ ✅ CRUD + helpers (getByUserId, setPrimary, toggleActive)                    ║
// ║ ✅ JOIN (users + sellers) p/ retornar "id + nome" no list/getByUserId/getById ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ----------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------
const TB = 'public."sellerByUser"';
const TB_USERS = 'public."users"';
const TB_SELLERS = 'public."sellers"';

const DDL = `
  CREATE TABLE IF NOT EXISTS ${TB} (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    seller_id   BIGINT NOT NULL,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_sellerByUser_user_id
    ON ${TB}(user_id);

  CREATE INDEX IF NOT EXISTS idx_sellerByUser_seller_id
    ON ${TB}(seller_id);

  -- Garante 1 principal por usuário (quando is_primary=true)
  CREATE UNIQUE INDEX IF NOT EXISTS ux_sellerByUser_user_primary
    ON ${TB}(user_id)
    WHERE is_primary = true;
`;

const DDL_TRIGGER = `
  CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS trigger AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_sellerByUser_updated_at ON ${TB};

  CREATE TRIGGER trg_sellerByUser_updated_at
  BEFORE UPDATE ON ${TB}
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
`;

// ----------------------------------------------------------------------
// Infra
// ----------------------------------------------------------------------
export async function ensureTables() {
  await pool.query('BEGIN');
  try {
    await pool.query(DDL);
    await pool.query(DDL_TRIGGER);
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
function normalizeRow(r) {
  if (!r) return null;

  // base
  const row = {
    id: Number(r.id),
    user_id: Number(r.user_id),
    seller_id: Number(r.seller_id),
    is_primary: !!r.is_primary,
    active: !!r.active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };

  // extras (JOIN) — opcionais
  if (r.user_name !== undefined) row.user_name = r.user_name ?? null;
  if (r.user_email !== undefined) row.user_email = r.user_email ?? null;
  if (r.user_is_active !== undefined) row.user_is_active = r.user_is_active ?? null;

  if (r.seller_name !== undefined) row.seller_name = r.seller_name ?? null;
  if (r.seller_nickname !== undefined) row.seller_nickname = r.seller_nickname ?? null;
  if (r.seller_document !== undefined) row.seller_document = r.seller_document ?? null;
  if (r.seller_active !== undefined) row.seller_active = r.seller_active ?? null;

  return row;
}

// ----------------------------------------------------------------------
// SQL base (JOIN)
// ----------------------------------------------------------------------
const SELECT_JOIN = `
  SELECT
    sbu.id,
    sbu.user_id,
    sbu.seller_id,
    sbu.is_primary,
    sbu.active,
    sbu.created_at,
    sbu.updated_at,

    u.name      AS user_name,
    u.email     AS user_email,
    u.is_active AS user_is_active,

    s.name      AS seller_name,
    s.nickname  AS seller_nickname,
    s.document  AS seller_document,
    s.active    AS seller_active

  FROM ${TB} sbu
  LEFT JOIN ${TB_USERS} u
    ON u.id = sbu.user_id
  LEFT JOIN ${TB_SELLERS} s
    ON s.id = sbu.seller_id
`;

// ----------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------
export async function list({
  user_id,
  seller_id,
  active,
  include_inactive, // ✅ NOVO: se true ignora filtro de active
  limit = 200,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];

  const add = (sql, val) => {
    params.push(val);
    where.push(`${sql} $${params.length}`);
  };

  if (user_id !== undefined && user_id !== null && user_id !== '') add('sbu.user_id =', Number(user_id));
  if (seller_id !== undefined && seller_id !== null && seller_id !== '') add('sbu.seller_id =', Number(seller_id));

  // compat: se include_inactive=true -> não força filtro
  const forceActiveFilter = !(include_inactive === true);

  if (forceActiveFilter) {
    if (active !== undefined && active !== null && active !== '') {
      params.push(Boolean(active));
      where.push(`sbu.active = $${params.length}`);
    } else {
      // default do seu front: quando não pediu inativos, mostra só ativos
      where.push(`sbu.active = TRUE`);
    }
  } else {
    // include_inactive=true -> não aplica filtro de active
    // (mas se você quiser honrar "active" mesmo assim, é só remover este else)
  }

  params.push(Number(limit));
  const pLimit = `$${params.length}`;
  params.push(Number(offset));
  const pOffset = `$${params.length}`;

  const sql = `
    ${SELECT_JOIN}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY sbu.is_primary DESC, sbu.user_id ASC, sbu.id ASC
    LIMIT ${pLimit} OFFSET ${pOffset}
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map(normalizeRow);
}

export async function getById(id) {
  const { rows } = await pool.query(
    `
    ${SELECT_JOIN}
    WHERE sbu.id = $1
    `,
    [Number(id)]
  );
  return normalizeRow(rows[0]);
}

export async function getByUserId(userId, { include_inactive } = {}) {
  const params = [Number(userId)];
  const where = [`sbu.user_id = $1`];

  if (!(include_inactive === true)) {
    where.push(`sbu.active = TRUE`);
  }

  const sql = `
    ${SELECT_JOIN}
    WHERE ${where.join(' AND ')}
    ORDER BY sbu.is_primary DESC, sbu.id ASC
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map(normalizeRow);
}

// ----------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------
export async function create({ user_id, seller_id, is_primary = false, active = true } = {}) {
  if (!user_id) throw new Error('user_id é obrigatório');
  if (!seller_id) throw new Error('seller_id é obrigatório');

  await pool.query('BEGIN');
  try {
    // se vier como principal, zera os outros do usuário
    if (is_primary) {
      await pool.query(`UPDATE ${TB} SET is_primary = false WHERE user_id = $1`, [Number(user_id)]);
    }

    const { rows } = await pool.query(
      `
      INSERT INTO ${TB} (user_id, seller_id, is_primary, active)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, seller_id, is_primary, active, created_at, updated_at
      `,
      [Number(user_id), Number(seller_id), Boolean(is_primary), Boolean(active)]
    );

    await pool.query('COMMIT');
    return normalizeRow(rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

export async function update(id, patch = {}) {
  id = Number(id);
  if (!id) throw new Error('id inválido');

  const allowed = ['user_id', 'seller_id', 'is_primary', 'active'];
  const sets = [];
  const params = [];

  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    params.push(k === 'user_id' || k === 'seller_id' ? Number(patch[k]) : Boolean(patch[k]));
    sets.push(`${k} = $${params.length}`);
  }

  if (!sets.length) {
    return getById(id);
  }

  await pool.query('BEGIN');
  try {
    // se estiver marcando como primary, precisamos saber user_id
    if (patch.is_primary === true) {
      // user_id pode ter vindo no patch; se não, busca o atual
      let userId = patch.user_id ? Number(patch.user_id) : null;
      if (!userId) {
        const cur = await getById(id);
        if (!cur) throw new Error('Registro não encontrado');
        userId = cur.user_id;
      }
      await pool.query(`UPDATE ${TB} SET is_primary = false WHERE user_id = $1`, [Number(userId)]);
    }

    params.push(id);
    const { rows } = await pool.query(
      `
      UPDATE ${TB}
      SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, user_id, seller_id, is_primary, active, created_at, updated_at
      `,
      params
    );

    await pool.query('COMMIT');
    return normalizeRow(rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

export async function remove(id) {
  const { rows } = await pool.query(
    `
    DELETE FROM ${TB}
    WHERE id = $1
    RETURNING id
    `,
    [Number(id)]
  );
  return rows?.[0]?.id ? Number(rows[0].id) : null;
}

export async function toggleActive(id, active) {
  const { rows } = await pool.query(
    `
    UPDATE ${TB}
    SET active = $2
    WHERE id = $1
    RETURNING id, user_id, seller_id, is_primary, active, created_at, updated_at
    `,
    [Number(id), Boolean(active)]
  );
  return normalizeRow(rows[0]);
}

export async function setPrimary(userId, id) {
  userId = Number(userId);
  id = Number(id);
  if (!userId) throw new Error('userId inválido');
  if (!id) throw new Error('id inválido');

  await pool.query('BEGIN');
  try {
    await pool.query(`UPDATE ${TB} SET is_primary = false WHERE user_id = $1`, [userId]);

    const { rows } = await pool.query(
      `
      UPDATE ${TB}
      SET is_primary = true, active = true
      WHERE id = $1 AND user_id = $2
      RETURNING id, user_id, seller_id, is_primary, active, created_at, updated_at
      `,
      [id, userId]
    );

    await pool.query('COMMIT');
    return normalizeRow(rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

export default {
  ensureTables,
  list,
  getById,
  getByUserId,
  create,
  update,
  remove,
  toggleActive,
  setPrimary,
};
