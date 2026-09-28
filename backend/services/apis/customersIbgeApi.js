// ╔══════════════════════════════════════════════════════════════════════╗
// ║ customersIbgeApi.js — Service/API Customers IBGE (ESM) — CONSART ERP ║
// ║ Resolve e persiste UF/Cidade/Código IBGE por cliente                 ║
// ║ Tabela: public."customersIbge"                                       ║
// ║ Endpoints típicos (via controller/routes):                           ║
// ║  - ensureTable / ensureTables                                        ║
// ║  - search (uf/city/q)                                                ║
// ║  - getByCustomerId                                                   ║
// ║  - upsert (por customer_id)                                          ║
// ║  - remove (delete por customer_id)                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ----------------------------------------------------------------------
// Tabelas
// ----------------------------------------------------------------------
const TB_CUSTOMERS      = 'public."customers"';
const TB_CUSTOMERS_IBGE = 'public."customersIbge"';

// ----------------------------------------------------------------------
// DDL / Infra
// ----------------------------------------------------------------------
const DDL = {
  customersIbge: `
    CREATE TABLE IF NOT EXISTS ${TB_CUSTOMERS_IBGE} (
      customer_id  BIGINT  NOT NULL PRIMARY KEY
        REFERENCES ${TB_CUSTOMERS}(customer_id) ON DELETE CASCADE,

      uf           CHAR(2) NOT NULL,
      city         TEXT    NOT NULL,

      codigo_ibge  CHAR(7),

      source       TEXT     NOT NULL DEFAULT 'manual',
      confidence   SMALLINT NOT NULL DEFAULT 100,

      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ✅ Compat / evolução: garante colunas em bancos já existentes
    ALTER TABLE ${TB_CUSTOMERS_IBGE}
      ADD COLUMN IF NOT EXISTS uf          CHAR(2),
      ADD COLUMN IF NOT EXISTS city        TEXT,
      ADD COLUMN IF NOT EXISTS codigo_ibge CHAR(7),
      ADD COLUMN IF NOT EXISTS source      TEXT,
      ADD COLUMN IF NOT EXISTS confidence  SMALLINT,
      ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ;

    -- ✅ Defaults e NOT NULL (sem quebrar dados existentes)
    -- (Obs: NOT NULL só é seguro se não houver linhas com NULL; por isso usamos COALESCE via UPDATE)
    UPDATE ${TB_CUSTOMERS_IBGE}
      SET
        source     = COALESCE(source, 'manual'),
        confidence = COALESCE(confidence, 100),
        created_at = COALESCE(created_at, NOW()),
        updated_at = COALESCE(updated_at, NOW())
    WHERE
      source IS NULL OR confidence IS NULL OR created_at IS NULL OR updated_at IS NULL;

    -- garante defaults
    ALTER TABLE ${TB_CUSTOMERS_IBGE}
      ALTER COLUMN source     SET DEFAULT 'manual',
      ALTER COLUMN confidence SET DEFAULT 100,
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN updated_at SET DEFAULT NOW();

    -- se uf/city estiverem NULL em tabela antiga, tenta manter consistência (não força NOT NULL aqui)
    -- Você pode reforçar NOT NULL depois de limpar dados, se quiser.

    -- garante índice de busca por UF/cidade
    CREATE INDEX IF NOT EXISTS idx_customersibge_uf_city
      ON ${TB_CUSTOMERS_IBGE}(uf, city);

    -- (opcional, mas ajuda muito em resolução por código)
    CREATE INDEX IF NOT EXISTS idx_customersibge_codigo_ibge
      ON ${TB_CUSTOMERS_IBGE}(codigo_ibge);

    -- trigger updated_at
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at_customers_ibge'
      ) THEN
        CREATE OR REPLACE FUNCTION set_updated_at_customers_ibge()
        RETURNS TRIGGER AS $f$
        BEGIN
          NEW.updated_at := NOW();
          RETURN NEW;
        END;
        $f$ LANGUAGE plpgsql;
      END IF;
    END$$;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customersibge_updated_at'
      ) THEN
        CREATE TRIGGER trg_customersibge_updated_at
        BEFORE UPDATE ON ${TB_CUSTOMERS_IBGE}
        FOR EACH ROW EXECUTE FUNCTION set_updated_at_customers_ibge();
      END IF;
    END$$;
  `,
};

export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL.customersIbge);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

// compat com seu padrão “ensureTables”
export async function ensureTables() {
  return ensureTable();
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
const isFiniteNum = (v) => Number.isFinite(Number(v));

function normUF(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return s.slice(0, 2);
}

function normCity(v) {
  return String(v ?? '').trim();
}

function normIbge(v) {
  const s = String(v ?? '').trim();
  // mantém apenas dígitos se vier com máscara
  const digits = s.replace(/\D+/g, '');
  if (!digits) return null;
  return digits.slice(0, 7);
}

function normSource(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s || 'manual';
}

function clampConfidence(v) {
  if (!isFiniteNum(v)) return 100;
  const n = Math.round(Number(v));
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function rowToCustomersIbge(row) {
  if (!row) return null;
  return {
    customer_id: Number(row.customer_id),
    uf: row.uf?.trim?.() ?? row.uf,
    city: row.city,
    codigo_ibge: row.codigo_ibge?.trim?.() ?? row.codigo_ibge ?? null,
    source: row.source ?? 'manual',
    confidence: Number(row.confidence ?? 100),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ----------------------------------------------------------------------
// Search / Listagem
// ----------------------------------------------------------------------
export async function search({
  q = '',
  uf,
  city,
  ibgeCode,
  source,
  minConfidence,
  limit = 20,
  offset = 0,
} = {}) {
  await ensureTable();

  const where = [];
  const args = [];
  let ai = 1;

  // 🔎 busca textual (city / ibge / customer_id)
  if (q && String(q).trim()) {
    const val = `%${String(q).toLowerCase().trim()}%`;
    where.push(`(
      LOWER(cib.city) LIKE $${ai}
      OR cib.codigo_ibge LIKE $${ai}
      OR CAST(cib.customer_id AS TEXT) LIKE $${ai}
    )`);
    args.push(val);
    ai++;
  }

  // UF
  if (uf && String(uf).trim()) {
    where.push(`cib.uf = $${ai}`);
    args.push(normUF(uf));
    ai++;
  }

  // City exata (útil pra resolver)
  if (city && String(city).trim()) {
    where.push(`LOWER(cib.city) = $${ai}`);
    args.push(String(city).trim().toLowerCase());
    ai++;
  }

  // Código IBGE
  if (ibgeCode && String(ibgeCode).trim()) {
    where.push(`cib.codigo_ibge = $${ai}`);
    args.push(normIbge(ibgeCode));
    ai++;
  }

  // source
  if (source && String(source).trim()) {
    where.push(`LOWER(cib.source) = $${ai}`);
    args.push(normSource(source));
    ai++;
  }

  // confidence mínima
  if (minConfidence != null && isFiniteNum(minConfidence)) {
    where.push(`cib.confidence >= $${ai}`);
    args.push(clampConfidence(minConfidence));
    ai++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sqlRows = `
    SELECT
      cib.customer_id,
      cib.uf,
      cib.city,
      cib.codigo_ibge,
      cib.source,
      cib.confidence,
      cib.created_at,
      cib.updated_at
    FROM ${TB_CUSTOMERS_IBGE} cib
    ${whereSql}
    ORDER BY cib.updated_at DESC, cib.customer_id DESC
    LIMIT $${ai} OFFSET $${ai + 1}
  `;
  args.push(Number(limit) || 20, Number(offset) || 0);

  const sqlCount = `
    SELECT COUNT(*) AS total
    FROM ${TB_CUSTOMERS_IBGE} cib
    ${whereSql}
  `;

  const client = await pool.connect();
  try {
    const [rowsRes, countRes] = await Promise.all([
      client.query(sqlRows, args),
      client.query(sqlCount, args.slice(0, ai - 1)),
    ]);

    return {
      ok: true,
      rows: rowsRes.rows.map(rowToCustomersIbge),
      total: Number(countRes.rows?.[0]?.total || 0),
    };
  } catch (err) {
    console.error('[customersIbgeApi.search] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  } finally {
    client.release();
  }
}

export async function list({ limit = 20, offset = 0 } = {}) {
  return search({ q: '', limit, offset });
}

// ----------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------
export async function getByCustomerId(customerId) {
  await ensureTable();

  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'ID inválido' };

  try {
    const r = await pool.query(
      `
      SELECT
        customer_id, uf, city, codigo_ibge,
        source, confidence, created_at, updated_at
      FROM ${TB_CUSTOMERS_IBGE}
      WHERE customer_id = $1
      `,
      [id],
    );
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToCustomersIbge(r.rows[0]) };
  } catch (err) {
    console.error('[customersIbgeApi.getByCustomerId] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  }
}

// Útil pro front: resolve por UF + City (retorna registro mais “confiável”)
export async function getByUfCity(uf, city) {
  await ensureTable();

  const u = normUF(uf);
  const c = normCity(city);
  if (!u || u.length !== 2) return { ok: false, error: 'UF inválida' };
  if (!c) return { ok: false, error: 'City inválida' };

  try {
    const r = await pool.query(
      `
      SELECT
        customer_id, uf, city, codigo_ibge,
        source, confidence, created_at, updated_at
      FROM ${TB_CUSTOMERS_IBGE}
      WHERE uf = $1 AND LOWER(city) = LOWER($2)
      ORDER BY confidence DESC, updated_at DESC
      LIMIT 1
      `,
      [u, c],
    );
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToCustomersIbge(r.rows[0]) };
  } catch (err) {
    console.error('[customersIbgeApi.getByUfCity] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  }
}

// ----------------------------------------------------------------------
// Upsert (principal)
// ----------------------------------------------------------------------
export async function upsert(customerId, payload = {}) {
  await ensureTable();

  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'ID inválido' };

  const uf = normUF(payload.uf);
  const city = normCity(payload.city);
  const codigo_ibge = payload.codigo_ibge == null ? null : normIbge(payload.codigo_ibge);

  if (!uf || uf.length !== 2) return { ok: false, error: 'UF inválida' };
  if (!city) return { ok: false, error: 'Cidade inválida' };

  const source = normSource(payload.source ?? 'manual');
  const confidence = clampConfidence(payload.confidence ?? 100);

  const sql = `
    INSERT INTO ${TB_CUSTOMERS_IBGE}
      (customer_id, uf, city, codigo_ibge, source, confidence)
    VALUES
      ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (customer_id) DO UPDATE SET
      uf         = EXCLUDED.uf,
      city       = EXCLUDED.city,
      codigo_ibge= EXCLUDED.codigo_ibge,
      source     = EXCLUDED.source,
      confidence = EXCLUDED.confidence,
      updated_at = NOW()
    RETURNING
      customer_id, uf, city, codigo_ibge, source, confidence, created_at, updated_at
  `;

  try {
    const r = await pool.query(sql, [id, uf, city, codigo_ibge, source, confidence]);
    return { ok: true, row: rowToCustomersIbge(r.rows[0]) };
  } catch (err) {
    console.error('[customersIbgeApi.upsert] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  }
}

// Update parcial (opcional — só campos enviados)
export async function update(customerId, patch = {}) {
  await ensureTable();

  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'ID inválido' };

  const sets = [];
  const args = [];
  let ai = 1;

  if (patch.uf != null) {
    const uf = normUF(patch.uf);
    if (!uf || uf.length !== 2) return { ok: false, error: 'UF inválida' };
    sets.push(`uf = $${ai++}`);
    args.push(uf);
  }

  if (patch.city != null) {
    const city = normCity(patch.city);
    if (!city) return { ok: false, error: 'Cidade inválida' };
    sets.push(`city = $${ai++}`);
    args.push(city);
  }

  if (patch.codigo_ibge !== undefined) {
    // permite limpar enviando null
    const code = patch.codigo_ibge == null ? null : normIbge(patch.codigo_ibge);
    sets.push(`codigo_ibge = $${ai++}`);
    args.push(code);
  }

  if (patch.source != null) {
    sets.push(`source = $${ai++}`);
    args.push(normSource(patch.source));
  }

  if (patch.confidence != null) {
    sets.push(`confidence = $${ai++}`);
    args.push(clampConfidence(patch.confidence));
  }

  if (!sets.length) return { ok: false, error: 'Nenhum campo para atualizar' };

  const sql = `
    UPDATE ${TB_CUSTOMERS_IBGE}
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE customer_id = $${ai}
    RETURNING
      customer_id, uf, city, codigo_ibge, source, confidence, created_at, updated_at
  `;
  args.push(id);

  try {
    const r = await pool.query(sql, args);
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToCustomersIbge(r.rows[0]) };
  } catch (err) {
    console.error('[customersIbgeApi.update] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  }
}

// ----------------------------------------------------------------------
// Delete
// ----------------------------------------------------------------------
export async function remove(customerId) {
  await ensureTable();

  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'ID inválido' };

  try {
    const r = await pool.query(
      `DELETE FROM ${TB_CUSTOMERS_IBGE} WHERE customer_id = $1`,
      [id],
    );
    return { ok: true, deleted: r.rowCount };
  } catch (err) {
    console.error('[customersIbgeApi.remove] ERR:', err);
    return { ok: false, error: String(err.message || err) };
  }
}

// ----------------------------------------------------------------------
// Export default
// ----------------------------------------------------------------------
const customersIbgeApi = {
  ensureTable,
  ensureTables, // alias compat
  search,
  list,
  getByCustomerId,
  getByUfCity,
  upsert,
  update,
  remove,
};

export default customersIbgeApi;
