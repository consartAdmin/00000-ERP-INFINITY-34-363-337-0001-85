// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ processesApi.js — Service (DB Access, ESM)                               ║
// ║ Tabela: public.processes                                                 ║
// ║ Funções: ensureTable, list, getById, create, update, remove             ║
// ║ CONSART ERP — Catálogo de Processos                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TB = 'public.processes';
export const ALIAS = 'pr';
const nowSql = 'NOW()';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) => (v === '' || v == null ? null : (isFiniteNum(v) ? Number(v) : null));
const toStrOrNull = (v) => (v === '' || v == null ? null : String(v));

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

  // Strings principais
  ['codigo', 'nome', 'descricao', 'status'].forEach((k) => {
    if (k in input) out[k] = toStrOrNull(input[k]);
  });

  // Permite manipular deleted_at (se quiser fazer restore etc.)
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

    // Tabela base
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        id BIGSERIAL PRIMARY KEY,
        codigo VARCHAR(50) UNIQUE NOT NULL,
        nome VARCHAR(200) NOT NULL,
        descricao TEXT,
        status VARCHAR(20) DEFAULT 'ativo',
        created_at TIMESTAMP DEFAULT ${nowSql},
        updated_at TIMESTAMP DEFAULT ${nowSql},
        deleted_at TIMESTAMP
      );
    `);

    // Índice para busca rápida por nome/código
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'idx_processes_codigo_unique'
        ) THEN
          CREATE UNIQUE INDEX idx_processes_codigo_unique
          ON ${TB} (LOWER(codigo));
        END IF;
      END$$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_processes_nome   ON ${TB} (LOWER(nome));
      CREATE INDEX IF NOT EXISTS idx_processes_status ON ${TB} (status);
    `);

    // Função e trigger para updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION set_timestamp_processes()
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
          EXECUTE FUNCTION set_timestamp_processes();
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
        SELECT pg_get_serial_sequence('public.processes', 'id') INTO seq_name;
        IF seq_name IS NOT NULL THEN
          EXECUTE 'SELECT COALESCE(MAX(id), 0) FROM public.processes' INTO max_id;
          EXECUTE format('SELECT setval(%L, GREATEST(%s, 1), true)', seq_name, max_id);
        END IF;
      END$$;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ [processesApi.ensureTable] erro:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   list() — Listagem com filtro e paginação
────────────────────────────────────────────────────────────── */
export async function list({ q = '', status = '', limit = 20, offset = 0 } = {}) {
  await ensureTable();

  const params = [];
  const whereParts = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const p = `$${params.length}`;
    whereParts.push(
      `(LOWER(codigo) LIKE ${p} OR LOWER(nome) LIKE ${p} OR LOWER(COALESCE(descricao, '')) LIKE ${p})`
    );
  }

  if (status) {
    params.push(status.toLowerCase());
    const p = `$${params.length}`;
    whereParts.push(`LOWER(status) = ${p}`);
  }

  // Por padrão não exibir deletados logicamente
  whereParts.push('deleted_at IS NULL');

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
   create() — Inserção com UPSERT em codigo
────────────────────────────────────────────────────────────── */
export async function create(input = {}) {
  await ensureTable();
  const data = normalizePayload(input);

  if (!data.codigo) throw new Error('codigo é obrigatório.');
  if (!data.nome) throw new Error('nome é obrigatório.');

  // Normaliza código (sem espaços extras)
  data.codigo = String(data.codigo).trim();

  const cols = Object.keys(data);
  const vals = Object.values(data);
  const params = vals.map((_, i) => `$${i + 1}`);

  const setUpdates = cols
    .filter((c) => c !== 'codigo') // codigo não muda no conflito
    .map((c) => `${c} = COALESCE(EXCLUDED.${c}, ${ALIAS}.${c})`);

  const sql = `
    INSERT INTO ${TB} AS ${ALIAS} (${cols.join(', ')})
    VALUES (${params.join(', ')})
    ON CONFLICT (codigo) DO UPDATE
    SET ${setUpdates.length ? setUpdates.join(', ') + ',' : ''} updated_at = ${nowSql}
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
      SET deleted_at = ${nowSql}, status = 'inativo', updated_at = ${nowSql}
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
