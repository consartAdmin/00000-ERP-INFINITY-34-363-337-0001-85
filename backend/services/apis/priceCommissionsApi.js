// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissionsApi.js — API Service (PostgreSQL) | CONSART ERP      ║
// ║ CRUD de comissões por Tabela de Preço x Vendedor (vigência)          ║
// ║ ✅ FIX: PK real = commission_id (conforme seu PgAdmin)               ║
// ║ ✅ ensureTables idempotente: cria/ajusta coluna e PK automaticamente ║
// ║ Path: /backend/services/apis/priceCommissionsApi.js                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_PRICES = 'public."prices"';
const TB_SELLERS = 'public."sellers"';
const TB_PC = 'public."priceCommissions"';

// ======================================================================
// DDL (idempotente + compatível com banco já existente)
// - Garante coluna commission_id como BIGSERIAL
// - Se existir price_commission_id, migra (rename) -> commission_id
// - Garante PK em commission_id
// - Índices e unique
// - Trigger updated_at
// ======================================================================
const DDL = `
  CREATE TABLE IF NOT EXISTS ${TB_PC} (
    commission_id BIGSERIAL PRIMARY KEY,

    price_id  INTEGER NOT NULL
      REFERENCES ${TB_PRICES}(price_id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT,

    seller_id INTEGER NOT NULL
      REFERENCES ${TB_SELLERS}(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT,

    commission_type VARCHAR(20) NOT NULL DEFAULT 'PERCENT', -- PERCENT | FIXED
    percent_value   NUMERIC(10,4) NOT NULL DEFAULT 0,
    fixed_value     NUMERIC(14,2) NOT NULL DEFAULT 0,

    active     BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to   DATE NULL,

    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  DO $$
  BEGIN
    -- Se a tabela já existia com a PK antiga, renomeia de forma segura
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='priceCommissions' AND column_name='price_commission_id'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='priceCommissions' AND column_name='commission_id'
    )
    THEN
      EXECUTE 'ALTER TABLE ${TB_PC} RENAME COLUMN price_commission_id TO commission_id';
    END IF;

    -- Se não existe commission_id por algum motivo, cria
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='priceCommissions' AND column_name='commission_id'
    )
    THEN
      EXECUTE 'ALTER TABLE ${TB_PC} ADD COLUMN commission_id BIGSERIAL';
    END IF;

    -- Garante PK em commission_id (se a PK não for essa)
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'p'
        AND n.nspname = 'public'
        AND t.relname = 'priceCommissions'
        AND pg_get_constraintdef(c.oid) ILIKE '%(commission_id)%'
    )
    THEN
      -- remove PK anterior, se houver
      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'p'
          AND n.nspname = 'public'
          AND t.relname = 'priceCommissions'
      )
      THEN
        EXECUTE (
          SELECT 'ALTER TABLE ${TB_PC} DROP CONSTRAINT ' || quote_ident(c.conname)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE c.contype = 'p'
            AND n.nspname = 'public'
            AND t.relname = 'priceCommissions'
          LIMIT 1
        );
      END IF;

      EXECUTE 'ALTER TABLE ${TB_PC} ADD PRIMARY KEY (commission_id)';
    END IF;
  END$$;

  CREATE INDEX IF NOT EXISTS idx_priceCommissions_price
    ON ${TB_PC}(price_id);

  CREATE INDEX IF NOT EXISTS idx_priceCommissions_seller
    ON ${TB_PC}(seller_id);

  CREATE INDEX IF NOT EXISTS idx_priceCommissions_active
    ON ${TB_PC}(active);

  CREATE INDEX IF NOT EXISTS idx_priceCommissions_vigencia
    ON ${TB_PC}(valid_from, valid_to);

  CREATE UNIQUE INDEX IF NOT EXISTS uq_priceCommissions_unique
    ON ${TB_PC}(price_id, seller_id, valid_from);

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_timestamp_price_commissions') THEN
      CREATE OR REPLACE FUNCTION set_timestamp_price_commissions()
      RETURNS TRIGGER AS $f$
      BEGIN
        NEW.updated_at := CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $f$ LANGUAGE plpgsql;
    END IF;
  END$$;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_price_commissions_set_timestamp') THEN
      CREATE TRIGGER trg_price_commissions_set_timestamp
      BEFORE UPDATE ON ${TB_PC}
      FOR EACH ROW
      EXECUTE FUNCTION set_timestamp_price_commissions();
    END IF;
  END$$;
`;

export async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: String(err?.message || err) };
  } finally {
    client.release();
  }
}

// ======================================================================
// Helpers
// ======================================================================
const isFiniteNum = (v) => Number.isFinite(Number(v));
const clamp0 = (n) => (n < 0 ? 0 : n);

function normType(t) {
  const s = String(t || '').toUpperCase().trim();
  return (s === 'FIXED' || s === 'PERCENT') ? s : 'PERCENT';
}

function normalizeIn(body = {}) {
  const out = {
    price_id: Number(body.price_id),
    seller_id: Number(body.seller_id),
    commission_type: normType(body.commission_type),
    percent_value: isFiniteNum(body.percent_value) ? clamp0(Number(body.percent_value)) : 0,
    fixed_value: isFiniteNum(body.fixed_value) ? clamp0(Number(body.fixed_value)) : 0,
    active: body.active === false ? false : true,
    valid_from: body.valid_from || new Date().toISOString().slice(0, 10),
    valid_to: body.valid_to || null,
  };

  if (!Number.isFinite(out.price_id) || out.price_id <= 0) throw new Error('price_id inválido');
  if (!Number.isFinite(out.seller_id) || out.seller_id <= 0) throw new Error('seller_id inválido');

  // coerência
  if (out.commission_type === 'PERCENT') out.fixed_value = 0;
  else out.percent_value = 0;

  return out;
}

function rowToObj(r) {
  return {
    commission_id: r.commission_id,
    price_id: r.price_id,
    price_name: r.price_name ?? null,
    seller_id: r.seller_id,
    seller_name: r.seller_name ?? null,
    commission_type: r.commission_type,
    percent_value: Number(r.percent_value || 0),
    fixed_value: Number(r.fixed_value || 0),
    active: r.active === true,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ======================================================================
// CRUD
// ======================================================================
export async function list({
  q = '',
  price_id,
  seller_id,
  active,
  date,        // data de referência (pega regra vigente nela)
  dateFrom,
  dateTo,
  limit = 200,
  offset = 0,
} = {}) {
  const where = [];
  const args = [];
  let ai = 1;

  if (q && String(q).trim()) {
    const v = `%${String(q).toLowerCase().trim()}%`;
    where.push(`(
      LOWER(p.name) LIKE $${ai} OR
      LOWER(s.name) LIKE $${ai} OR
      CAST(pc.price_id AS TEXT) LIKE $${ai} OR
      CAST(pc.seller_id AS TEXT) LIKE $${ai} OR
      CAST(pc.commission_id AS TEXT) LIKE $${ai}
    )`);
    args.push(v);
    ai++;
  }

  if (price_id != null && String(price_id).trim() !== '') {
    where.push(`pc.price_id = $${ai}`); args.push(Number(price_id)); ai++;
  }
  if (seller_id != null && String(seller_id).trim() !== '') {
    where.push(`pc.seller_id = $${ai}`); args.push(Number(seller_id)); ai++;
  }
  if (active === 'true' || active === 'false') {
    where.push(`pc.active = $${ai}`); args.push(active === 'true'); ai++;
  }

  // vigência
  if (date) {
    where.push(`pc.valid_from <= $${ai}`); args.push(date); ai++;
    where.push(`(pc.valid_to IS NULL OR pc.valid_to >= $${ai})`); args.push(date); ai++;
  } else {
    if (dateFrom) { where.push(`pc.valid_from >= $${ai}`); args.push(dateFrom); ai++; }
    if (dateTo)   { where.push(`pc.valid_from <= $${ai}`); args.push(dateTo); ai++; }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      pc.*,
      p.name AS price_name,
      s.name AS seller_name
    FROM ${TB_PC} pc
    JOIN ${TB_PRICES} p ON p.price_id = pc.price_id
    JOIN ${TB_SELLERS} s ON s.id = pc.seller_id
    ${whereSql}
    ORDER BY pc.active DESC, pc.valid_from DESC, pc.price_id ASC, pc.seller_id ASC
    LIMIT $${ai} OFFSET $${ai + 1}
  `;
  args.push(Number(limit) || 200, Number(offset) || 0);

  const sqlCount = `
    SELECT COUNT(*)::int AS total
    FROM ${TB_PC} pc
    JOIN ${TB_PRICES} p ON p.price_id = pc.price_id
    JOIN ${TB_SELLERS} s ON s.id = pc.seller_id
    ${whereSql}
  `;

  const client = await pool.connect();
  try {
    const [rowsRes, countRes] = await Promise.all([
      client.query(sql, args),
      client.query(sqlCount, args.slice(0, ai - 1)),
    ]);

    return {
      ok: true,
      rows: rowsRes.rows.map(rowToObj),
      total: Number(countRes.rows?.[0]?.total || 0),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    client.release();
  }
}

export async function getById(id) {
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return { ok: false, error: 'ID inválido' };

  const sql = `
    SELECT pc.*,
           p.name AS price_name,
           s.name AS seller_name
    FROM ${TB_PC} pc
    JOIN ${TB_PRICES} p ON p.price_id = pc.price_id
    JOIN ${TB_SELLERS} s ON s.id = pc.seller_id
    WHERE pc.commission_id = $1
    LIMIT 1
  `;
  try {
    const r = await pool.query(sql, [pid]);
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, row: rowToObj(r.rows[0]) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export async function create(body = {}) {
  const v = normalizeIn(body);

  const cols = [
    'price_id','seller_id',
    'commission_type','percent_value','fixed_value',
    'active','valid_from','valid_to',
  ];
  const args = cols.map((c) => v[c]);
  const vals = cols.map((_, i) => `$${i + 1}`);

  const sql = `
    INSERT INTO ${TB_PC} (${cols.join(', ')})
    VALUES (${vals.join(', ')})
    RETURNING commission_id
  `;

  const client = await pool.connect();
  try {
    const r = await client.query(sql, args);
    return { ok: true, id: r.rows?.[0]?.commission_id };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('uq_priceCommissions_unique')) {
      return { ok: false, error: 'Já existe regra para este vendedor/tabela nesta data inicial.' };
    }
    return { ok: false, error: msg };
  } finally {
    client.release();
  }
}

export async function update(id, body = {}) {
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return { ok: false, error: 'ID inválido' };

  const v = normalizeIn(body);

  const setCols = [
    'price_id','seller_id',
    'commission_type','percent_value','fixed_value',
    'active','valid_from','valid_to',
  ];
  const sets = setCols.map((c, i) => `${c} = $${i + 1}`);
  const args = setCols.map((c) => v[c]);
  args.push(pid);

  const sql = `
    UPDATE ${TB_PC}
    SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE commission_id = $${args.length}
    RETURNING commission_id
  `;

  const client = await pool.connect();
  try {
    const r = await client.query(sql, args);
    if (!r.rowCount) return { ok: false, error: 'NOT_FOUND' };
    return { ok: true, id: r.rows?.[0]?.commission_id };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('uq_priceCommissions_unique')) {
      return { ok: false, error: 'Já existe regra para este vendedor/tabela nesta data inicial.' };
    }
    return { ok: false, error: msg };
  } finally {
    client.release();
  }
}

export async function remove(id) {
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return { ok: false, error: 'ID inválido' };

  const sql = `DELETE FROM ${TB_PC} WHERE commission_id = $1`;
  try {
    const r = await pool.query(sql, [pid]);
    return { ok: true, deleted: r.rowCount };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ======================================================================
// Auxiliares p/ frontend
// ======================================================================
export async function listPrices({ activeOnly = true } = {}) {
  const sql = `
    SELECT price_id, name, description, active
    FROM ${TB_PRICES}
    ${activeOnly ? 'WHERE active IS DISTINCT FROM FALSE' : ''}
    ORDER BY name ASC
  `;
  try {
    const r = await pool.query(sql);
    return { ok: true, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export async function listSellers({ activeOnly = true } = {}) {
  const sql = `
    SELECT id, name, nickname, active
    FROM ${TB_SELLERS}
    ${activeOnly ? 'WHERE active IS DISTINCT FROM FALSE' : ''}
    ORDER BY name ASC
  `;
  try {
    const r = await pool.query(sql);
    return { ok: true, rows: r.rows };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

const priceCommissionsApi = {
  ensureTables,
  list,
  getById,
  create,
  update,
  remove,
  listPrices,
  listSellers,
};

export default priceCommissionsApi;
