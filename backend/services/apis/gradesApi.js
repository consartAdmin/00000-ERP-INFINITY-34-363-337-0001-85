// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ gradesApi.js — Service (DB Access, ESM)                                  ║
// ║ Tabela: public."grades"                                                  ║
// ║ Funções: ensureTable, list, getById, create, update, remove              ║
// ║ CONSART ERP — Controle de grades (cores, tamanhos, variações)            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TFULL = 'public."grades"'; // schema-qualified (consultas)
export const TNAME = '"grades"';        // nome (para ON CONFLICT DO UPDATE)
export const ALIAS = 'gr';
const nowSql = 'NOW()';

/* ──────────────────────────────────────────────────────────────
   ensureTable singleton (evita rodar em toda request)
────────────────────────────────────────────────────────────── */
let _ensurePromise = null;

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNumOrNull = (v) => (v === '' || v == null ? null : (isFiniteNum(v) ? Number(v) : null));
const toStrOrNull = (v) => (v === '' || v == null ? null : String(v));

function clampInt(n, { min = 0, max = 100000 } = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(Math.trunc(v), min), max);
}

/* ──────────────────────────────────────────────────────────────
   Normalizador de payload
────────────────────────────────────────────────────────────── */
function normalizePayload(input = {}) {
  const out = {};

  // Campos string
  ['grade', 'description', 'source_system', 'source_hash'].forEach((k) => {
    if (k in input) out[k] = toStrOrNull(input[k]);
  });

  // Campos numéricos
  if ('version' in input) out.version = toNumOrNull(input.version);

  // Booleanos
  if ('is_active' in input) {
    const v = input.is_active;
    out.is_active = (typeof v === 'string')
      ? ['true', '1', 't', 'yes', 'y'].includes(v.toLowerCase())
      : Boolean(v);
  }

  return out;
}

/* ──────────────────────────────────────────────────────────────
   ensureTable() — Cria tabela e estrutura de suporte (idempotente)
────────────────────────────────────────────────────────────── */
export async function ensureTable() {
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Tabela base
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TFULL} (
          grade_id SERIAL PRIMARY KEY,
          grade VARCHAR(50) NOT NULL UNIQUE,
          description TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT ${nowSql},
          updated_at TIMESTAMP DEFAULT ${nowSql},
          version INTEGER DEFAULT 1,
          source_system VARCHAR(50),
          source_hash VARCHAR(120)
        );
      `);

      // Índice único case-insensitive (opcional, mas útil se alguém tentar inserir sem normalizar)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = 'idx_grades_name_unique'
          ) THEN
            CREATE UNIQUE INDEX idx_grades_name_unique
            ON ${TFULL} (LOWER(grade));
          END IF;
        END$$;
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_grades_active ON ${TFULL} (is_active);
        CREATE INDEX IF NOT EXISTS idx_grades_grade  ON ${TFULL} (grade);
      `);

      // Função e trigger para updated_at
      await client.query(`
        CREATE OR REPLACE FUNCTION set_timestamp_grades()
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
            BEFORE UPDATE ON ${TFULL}
            FOR EACH ROW
            EXECUTE FUNCTION set_timestamp_grades();
          END IF;
        END$$;
      `);

      // Sincroniza sequence corretamente
      await client.query(`
        DO $$
        DECLARE
          seq_name text;
          max_id bigint;
        BEGIN
          SELECT pg_get_serial_sequence('${TFULL}', 'grade_id') INTO seq_name;

          IF seq_name IS NOT NULL THEN
            EXECUTE 'SELECT COALESCE(MAX(grade_id), 0) FROM ${TFULL}' INTO max_id;

            IF max_id = 0 THEN
              -- tabela vazia: próximo insert deve gerar 1
              EXECUTE format('SELECT setval(%L, 1, false)', seq_name);
            ELSE
              -- tabela com dados: próximo insert deve gerar max+1
              EXECUTE format('SELECT setval(%L, %s, true)', seq_name, max_id);
            END IF;
          END IF;
        END$$;
      `);

      await client.query('COMMIT');
      return { ok: true };
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('❌ grades.ensureTable() — erro:', e.message);
      _ensurePromise = null; // libera para tentar novamente se falhar
      throw e;
    } finally {
      client.release();
    }
  })();

  return _ensurePromise;
}

/* ──────────────────────────────────────────────────────────────
   list() — Listagem com filtro e paginação
────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────
   list() — Listagem com busca, status e paginação
────────────────────────────────────────────────────────────── */
export async function list({
  q = '',
  isActive,
  limit = 50,
  offset = 0,
} = {}) {
  await ensureTable();

  const safeQuery = String(q || '').trim();
  const safeLimit = clampInt(limit, { min: 1, max: 100 });
  const safeOffset = clampInt(offset, {
    min: 0,
    max: 2_000_000_000,
  });

  const values = [];
  const conditions = [];

  // Busca pelo nome ou pela descrição.
  if (safeQuery) {
    values.push(`%${safeQuery}%`);
    const position = values.length;

    conditions.push(`
      (
        gr.grade ILIKE $${position}
        OR COALESCE(gr.description, '') ILIKE $${position}
      )
    `);
  }

  // Filtra pelo status somente quando true ou false foi informado.
  if (typeof isActive === 'boolean') {
    values.push(isActive);
    conditions.push(`gr.is_active = $${values.length}`);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM ${TFULL} AS gr
    ${where};
  `;

  const listValues = [...values, safeLimit, safeOffset];
  const limitPosition = values.length + 1;
  const offsetPosition = values.length + 2;

  const rowsSql = `
    SELECT
      gr.grade_id,
      gr.grade,
      gr.description,
      gr.is_active,
      gr.created_at,
      gr.updated_at
    FROM ${TFULL} AS gr
    ${where}
    ORDER BY gr.grade ASC
    LIMIT $${limitPosition}
    OFFSET $${offsetPosition};
  `;

  const [countResult, rowsResult] = await Promise.all([
    pool.query(countSql, values),
    pool.query(rowsSql, listValues),
  ]);

  return {
    rows: rowsResult.rows,
    total: Number(countResult.rows[0]?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

/* ──────────────────────────────────────────────────────────────
   getById() — Busca por ID
────────────────────────────────────────────────────────────── */
export async function getById(id) {
  await ensureTable();
  const gradeId = clampInt(id, { min: 1, max: 2_000_000_000 });
  const { rows } = await pool.query(
    `SELECT * FROM ${TFULL} WHERE grade_id = $1 LIMIT 1;`,
    [gradeId]
  );
  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   create() — Inserção idempotente com UPSERT
────────────────────────────────────────────────────────────── */
export async function create(input = {}) {
  await ensureTable();

  const data = normalizePayload(input);
  if (!data.grade) {
    const err = new Error('grade é obrigatório.');
    err.statusCode = 400;
    throw err;
  }

  // Normaliza para evitar variações de case
  data.grade = String(data.grade).trim().toUpperCase();

  const cols = Object.keys(data);
  const vals = Object.values(data);

  if (!cols.length) {
    const err = new Error('Payload vazio.');
    err.statusCode = 400;
    throw err;
  }

  const params = vals.map((_, i) => `$${i + 1}`);

  // Atualiza somente campos != grade; mantém campo antigo se EXCLUDED vier null
  const setUpdates = cols
    .filter((c) => c !== 'grade')
    .map((c) => `${c} = COALESCE(EXCLUDED.${c}, ${TNAME}.${c})`);

  const sql = `
    INSERT INTO ${TFULL} (${cols.join(', ')})
    VALUES (${params.join(', ')})
    ON CONFLICT (grade) DO UPDATE
    SET ${setUpdates.length ? setUpdates.join(', ') + ',' : ''} updated_at = ${nowSql}
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(sql, vals);
    return rows[0];
  } catch (e) {
    // duplicidade via idx lower(grade)
    if (e?.code === '23505') {
      const err = new Error('Grade já existe (duplicidade).');
      err.statusCode = 409;
      throw err;
    }
    throw e;
  }
}

/* ──────────────────────────────────────────────────────────────
   update() — Atualização parcial (bloqueia alteração de grade)
────────────────────────────────────────────────────────────── */
export async function update(id, input = {}) {
  await ensureTable();

  const gradeId = clampInt(id, { min: 1, max: 2_000_000_000 });

  const data = normalizePayload(input);

  // Bloqueia renomeio de grade (se quiser permitir, trate separado)
  if ('grade' in data) delete data.grade;

  if (!Object.keys(data).length) return getById(gradeId);

  const sets = [];
  const vals = [];
  Object.entries(data).forEach(([col, val]) => {
    vals.push(val);
    sets.push(`${col} = $${vals.length}`);
  });

  const sql = `
    UPDATE ${TFULL}
    SET ${sets.join(', ')}, updated_at = ${nowSql}
    WHERE grade_id = $${vals.length + 1}
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(sql, [...vals, gradeId]);
    return rows[0] || null;
  } catch (e) {
    if (e?.code === '23505') {
      const err = new Error('Conflito de duplicidade ao atualizar.');
      err.statusCode = 409;
      throw err;
    }
    throw e;
  }
}

/* ──────────────────────────────────────────────────────────────
   remove() — Exclusão lógica ou física
────────────────────────────────────────────────────────────── */
export async function remove(id, { hard = false } = {}) {
  await ensureTable();

  const gradeId = clampInt(id, { min: 1, max: 2_000_000_000 });

  if (hard) {
    await pool.query(`DELETE FROM ${TFULL} WHERE grade_id = $1;`, [gradeId]);
    return { ok: true, hard: true };
  }

  await pool.query(
    `UPDATE ${TFULL} SET is_active = FALSE, updated_at = ${nowSql} WHERE grade_id = $1;`,
    [gradeId]
  );

  return { ok: true, hard: false };
}

/* ──────────────────────────────────────────────────────────────
   Export default (consistência com demais APIs)
────────────────────────────────────────────────────────────── */
export default { ensureTable, list, getById, create, update, remove };
