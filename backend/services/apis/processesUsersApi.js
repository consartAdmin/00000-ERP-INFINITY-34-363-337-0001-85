// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ processesUsersApi.js — Service (DB Access, ESM)                          ║
// ║ Tabela: public."processesUsers"                                          ║
// ║ Funções: ensureTable, list, getById, create, update, remove              ║
// ║ CONSART ERP — Permissões por Processo e Usuário                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public."processesUsers"';
export const ALIAS = 'pu';
const nowSql = 'NOW()';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) => (v === '' || v == null ? null : (isFiniteNum(v) ? Number(v) : null));

const toBoolOrNull = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return !!v;
  if (typeof v === 'string') {
    return ['true', '1', 't', 'yes', 'y', 'sim', 's'].includes(v.toLowerCase());
  }
  return null;
};

/* ──────────────────────────────────────────────────────────────
   Normalizador de payload
────────────────────────────────────────────────────────────── */
function normalizePayload(input = {}) {
  const out = {};

  if ('process_id' in input) out.process_id = toNumOrNull(input.process_id);
  if ('user_id' in input) out.user_id = toNumOrNull(input.user_id);

  ['can_view', 'can_edit', 'can_approve', 'is_owner'].forEach((k) => {
    if (k in input) out[k] = toBoolOrNull(input[k]);
  });

  if ('deleted_at' in input) {
    out.deleted_at = input.deleted_at || null;
  }

  return out;
}

/* ──────────────────────────────────────────────────────────────
   ensureTable() — Cria tabela e estrutura de suporte
────────────────────────────────────────────────────────────── */
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        id BIGSERIAL PRIMARY KEY,
        process_id BIGINT NOT NULL,
        user_id INTEGER NOT NULL,

        can_view    BOOLEAN NOT NULL DEFAULT TRUE,
        can_edit    BOOLEAN NOT NULL DEFAULT FALSE,
        can_approve BOOLEAN NOT NULL DEFAULT FALSE,
        is_owner    BOOLEAN NOT NULL DEFAULT FALSE,

        created_at TIMESTAMP DEFAULT ${nowSql},
        updated_at TIMESTAMP DEFAULT ${nowSql},
        deleted_at TIMESTAMP,

        CONSTRAINT uq_processes_users UNIQUE (process_id, user_id)
      );
    `);

    // Índices auxiliares
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_processes_users_process_id ON ${TB} (process_id);
      CREATE INDEX IF NOT EXISTS idx_processes_users_user_id    ON ${TB} (user_id);
      CREATE INDEX IF NOT EXISTS idx_processes_users_owner      ON ${TB} (is_owner);
    `);

    // Função e trigger para updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION set_timestamp_processes_users()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_${ALIAS}_set_timestamp'
        ) THEN
          CREATE TRIGGER trg_${ALIAS}_set_timestamp
          BEFORE UPDATE ON ${TB}
          FOR EACH ROW
          EXECUTE FUNCTION set_timestamp_processes_users();
        END IF;
      END$$;
    `);

    // Sincroniza a sequence
    await client.query(`
      DO $$
      DECLARE
        seq_name text;
        max_id bigint;
      BEGIN
        SELECT pg_get_serial_sequence('public."processesUsers"', 'id') INTO seq_name;
        IF seq_name IS NOT NULL THEN
          EXECUTE 'SELECT COALESCE(MAX(id), 0) FROM public."processesUsers"' INTO max_id;
          EXECUTE format('SELECT setval(%L, GREATEST(%s, 1), true)', seq_name, max_id);
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ [processesUsersApi.ensureTable] erro:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   list() — Filtro por process_id/user_id + paginação
────────────────────────────────────────────────────────────── */
export async function list({
  process_id = null,
  user_id = null,
  limit = 50,
  offset = 0
} = {}) {
  await ensureTable();

  const params = [];
  const whereParts = ['deleted_at IS NULL'];

  if (process_id != null && process_id !== '') {
    params.push(Number(process_id));
    whereParts.push(`process_id = $${params.length}`);
  }

  if (user_id != null && user_id !== '') {
    params.push(Number(user_id));
    whereParts.push(`user_id = $${params.length}`);
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${TB} ${where}`,
    params
  );
  const total = countRes.rows?.[0]?.total || 0;

  const { rows } = await pool.query(
    `
      SELECT *
      FROM ${TB}
      ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset};
    `,
    params
  );

  return { rows, total, limit, offset };
}

/* ──────────────────────────────────────────────────────────────
   getById() — Busca por ID
────────────────────────────────────────────────────────────── */
export async function getById(id) {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE id = $1 LIMIT 1;`,
    [Number(id)]
  );
  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   create() — UPSERT por (process_id, user_id)
────────────────────────────────────────────────────────────── */
export async function create(input = {}) {
  await ensureTable();
  const data = normalizePayload(input);

  if (!data.process_id) throw new Error('process_id é obrigatório.');
  if (!data.user_id) throw new Error('user_id é obrigatório.');

  const cols = Object.keys(data);
  const vals = Object.values(data);
  const params = vals.map((_, i) => `$${i + 1}`);

  const setUpdates = cols
    .filter((c) => !['process_id', 'user_id'].includes(c))
    .map((c) => `${c} = COALESCE(EXCLUDED.${c}, ${ALIAS}.${c})`);

  const sql = `
    INSERT INTO ${TB} AS ${ALIAS} (${cols.join(', ')})
    VALUES (${params.join(', ')})
    ON CONFLICT (process_id, user_id) DO UPDATE
    SET ${setUpdates.length ? setUpdates.join(', ') + ',' : ''} 
        deleted_at = NULL,
        updated_at = ${nowSql}
    RETURNING *;
  `;

  const { rows } = await pool.query(sql, vals);
  return rows[0];
}

/* ──────────────────────────────────────────────────────────────
   update() — Atualização parcial
────────────────────────────────────────────────────────────── */
export async function update(id, input = {}) {
  await ensureTable();
  const data = normalizePayload(input);
  if (!Object.keys(data).length) return getById(id);

  const sets = [];
  const vals = [];

  Object.entries(data).forEach(([col, val]) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  });

  const sql = `
    UPDATE ${TB}
    SET ${sets.join(', ')}, updated_at = ${nowSql}
    WHERE id = $${vals.length + 1}
    RETURNING *;
  `;

  const { rows } = await pool.query(sql, [...vals, Number(id)]);
  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   remove() — Exclusão lógica ou física
────────────────────────────────────────────────────────────── */
export async function remove(id, { hard = false } = {}) {
  await ensureTable();
  const numId = Number(id);

  if (hard) {
    await pool.query(`DELETE FROM ${TB} WHERE id = $1`, [numId]);
    return { ok: true, hard: true };
  }

  await pool.query(
    `
      UPDATE ${TB}
      SET deleted_at = ${nowSql}, updated_at = ${nowSql}
      WHERE id = $1
    `,
    [numId]
  );

  return { ok: true, hard: false };
}

/* ──────────────────────────────────────────────────────────────
   Export default
────────────────────────────────────────────────────────────── */
export default { ensureTable, list, getById, create, update, remove };
