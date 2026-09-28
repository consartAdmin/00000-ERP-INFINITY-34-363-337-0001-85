// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ibgeLocationsApi.js — Data Access Layer (DAL) para IBGE Locations    ║
// ║ Tabela: public."ibgeLocations"                                       ║
// ║ Funções: ensureTable, list, search, getById, create, update, remove  ║
// ║ + importByState (IBGE → Banco) + countByState + listUfs + resolveCity║
// ║ Padrão CONSART (similar ao sellersApi.js)                            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."ibgeLocations"';
const ALIAS = 'il';

/* =======================================================================
 * Helpers básicos
 * ======================================================================= */
const isFiniteNum = (v) => {
  if (v === '' || v == null) return false;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n);
};

const toNumOrNull = (v) =>
  isFiniteNum(v) ? Number(String(v).trim().replace(',', '.')) : null;

const toTrimOrNull = (v) =>
  v == null ? null : (String(v).trim() || null);

const toBoolOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 't', 'sim', 'yes', 'y', 'ativo', 'active'].includes(s)) return true;
  if (['0', 'false', 'f', 'nao', 'não', 'no', 'n', 'inativo', 'inactive'].includes(s)) return false;
  return null;
};

const toState2 = (v) => {
  const s = toTrimOrNull(v);
  if (!s) return null;
  const out = String(s).trim().toUpperCase();
  return out.slice(0, 2);
};

const toInt = (v, fallback = 0) => {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
};

/* =======================================================================
 * Normalização de payload
 * ======================================================================= */
function normalizePayload(payload = {}) {
  const state =
    payload.state ??
    payload.uf ??
    payload.estado ??
    payload.sigla ??
    null;

  const city =
    payload.city ??
    payload.cidade ??
    payload.municipio ??
    payload.mun ??
    null;

  const ibge_code =
    toNumOrNull(payload.ibge_code ?? payload.ibgeCode ?? payload.codigo_ibge ?? payload.codigoIBGE);

  let status = toBoolOrNull(payload.status);
  if (status === null && payload.active != null) status = toBoolOrNull(payload.active);
  if (status === null) status = true;

  return {
    state: toState2(state),
    city: toTrimOrNull(city),
    ibge_code: ibge_code,
    status: status,
  };
}

/* =======================================================================
 * DDL / ensureTable idempotente
 * ======================================================================= */
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        ibge_location_id SERIAL PRIMARY KEY,
        state            CHAR(2)     NOT NULL,
        city             TEXT        NOT NULL,
        ibge_code        INTEGER     NOT NULL,
        status           BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ✅ evita "SERIAL duplicado" em ALTER TABLE (muito mais seguro)
    await client.query(`
      ALTER TABLE ${TB}
        ADD COLUMN IF NOT EXISTS state      CHAR(2),
        ADD COLUMN IF NOT EXISTS city       TEXT,
        ADD COLUMN IF NOT EXISTS ibge_code  INTEGER,
        ADD COLUMN IF NOT EXISTS status     BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    // Uniques (sem duplicar)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ibgelocations_state_city') THEN
          ALTER TABLE ${TB} ADD CONSTRAINT uq_ibgelocations_state_city UNIQUE (state, city);
        END IF;
      END $$;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ibgelocations_ibge_code') THEN
          ALTER TABLE ${TB} ADD CONSTRAINT uq_ibgelocations_ibge_code UNIQUE (ibge_code);
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ibgelocations_state  ON ${TB} (state);
      CREATE INDEX IF NOT EXISTS idx_ibgelocations_city   ON ${TB} (city);
      CREATE INDEX IF NOT EXISTS idx_ibgelocations_status ON ${TB} (status);
    `);

    // Trigger updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION public.trg_ibgelocations_set_timestamp()
      RETURNS TRIGGER AS $body$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $body$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ibgelocations_set_timestamp') THEN
          CREATE TRIGGER trg_ibgelocations_set_timestamp
          BEFORE UPDATE ON ${TB}
          FOR EACH ROW
          EXECUTE PROCEDURE public.trg_ibgelocations_set_timestamp();
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    return { ok: true, table: 'ibgeLocations', message: 'ensureTable() ibgeLocations ok' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* =======================================================================
 * rowToModel — normaliza saída
 * ======================================================================= */
function rowToModel(r) {
  if (!r) return null;
  return {
    ibge_location_id: r.ibge_location_id,
    state: r.state,
    city: r.city,
    ibge_code: r.ibge_code,
    status: r.status !== false,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/* =======================================================================
 * ✅ LIST UFS (distinct)
 * Retorno: [{ uf:"MG", name:"MG" }, ...]
 * ======================================================================= */
export async function listUfs(params = {}) {
  const st = toBoolOrNull(params.status);

  const wh = ['1=1'];

  if (st === true) wh.push(`${ALIAS}.status = TRUE`);
  else if (st === false) wh.push(`${ALIAS}.status = FALSE`);

  const sql = `
    SELECT DISTINCT ${ALIAS}.state AS uf
    FROM ${TB} ${ALIAS}
    WHERE ${wh.join(' AND ')}
    ORDER BY ${ALIAS}.state ASC;
  `;

  const { rows } = await pool.query(sql);
  return (rows || []).map(r => ({
    uf: String(r.uf || '').trim(),
    name: String(r.uf || '').trim(),
  }));
}

/* =======================================================================
 * ✅ RESOLVE CITY -> IBGE CODE (DB)
 * Input: { uf, city }
 * Saída: { name, uf, ibgeCode }  (compatível com extractors do frontend)
 * ======================================================================= */
export async function resolveCity({ uf, city } = {}) {
  const UF = toState2(uf);
  const CITY = toTrimOrNull(city);

  if (!UF) throw new Error('uf is required.');
  if (!CITY) throw new Error('city is required.');

  // 1) match exato (case-insensitive)
  let r = await pool.query(
    `
    SELECT state, city, ibge_code
    FROM ${TB}
    WHERE state = $1
      AND LOWER(city) = LOWER($2)
    ORDER BY status DESC, ibge_location_id ASC
    LIMIT 1
    `,
    [UF, CITY]
  );

  if (r.rows?.[0]) {
    const row = r.rows[0];
    return { name: row.city, uf: row.state, ibgeCode: row.ibge_code };
  }

  // 2) fallback ILIKE (variações)
  r = await pool.query(
    `
    SELECT state, city, ibge_code
    FROM ${TB}
    WHERE state = $1
      AND city ILIKE $2
    ORDER BY status DESC, ibge_location_id ASC
    LIMIT 1
    `,
    [UF, CITY]
  );

  if (!r.rows?.[0]) return null;

  const row = r.rows[0];
  return { name: row.city, uf: row.state, ibgeCode: row.ibge_code };
}

/* =======================================================================
 * LIST / SEARCH
 * - Compatível:
 *   - padrão: retorna array
 *   - includeTotal=true: retorna { rows, total, limit, offset }
 * ======================================================================= */
export async function list(params = {}) {
  const {
    q,
    state,
    status,
    limit = 100,
    offset = 0,
    includeTotal = false,
  } = params;

  const wh = ['1=1'];
  const values = [];
  let i = 1;

  if (state) {
    wh.push(`${ALIAS}.state = $${i}`);
    values.push(toState2(state));
    i++;
  }

  if (q) {
    wh.push(`(
      ${ALIAS}.state ILIKE $${i} OR
      ${ALIAS}.city  ILIKE $${i} OR
      CAST(${ALIAS}.ibge_code AS TEXT) ILIKE $${i}
    )`);
    values.push(`%${String(q).trim()}%`);
    i++;
  }

  const st = toBoolOrNull(status);
  if (st === true) wh.push(`${ALIAS}.status = TRUE`);
  else if (st === false) wh.push(`${ALIAS}.status = FALSE`);

  let total = null;
  if (includeTotal) {
    const sqlTotal = `
      SELECT COUNT(*)::int AS total
      FROM ${TB} ${ALIAS}
      WHERE ${wh.join(' AND ')};
    `;
    const rTotal = await pool.query(sqlTotal, values);
    total = Number(rTotal.rows?.[0]?.total ?? 0);
  }

  const sql = `
    SELECT ${ALIAS}.*
    FROM ${TB} ${ALIAS}
    WHERE ${wh.join(' AND ')}
    ORDER BY ${ALIAS}.state ASC, ${ALIAS}.city ASC, ${ALIAS}.ibge_location_id ASC
    LIMIT $${i} OFFSET $${i + 1};
  `;

  const valuesPaged = [...values, Number(limit), Number(offset)];
  const { rows } = await pool.query(sql, valuesPaged);
  const mapped = (rows || []).map(rowToModel);

  if (!includeTotal) return mapped;

  return {
    rows: mapped,
    total,
    limit: Number(limit),
    offset: Number(offset),
  };
}

export async function search(q, limit = 50) {
  return list({ q, limit });
}

/* =======================================================================
 * ✅ COUNT BY STATE — quantidade de cidades por UF
 * Retorno: [{ state: "MG", total_cities: 853 }, ...]
 * ======================================================================= */
export async function countByState(params = {}) {
  const st = toBoolOrNull(params.status);

  const wh = ['1=1'];
  if (st === true) wh.push(`${ALIAS}.status = TRUE`);
  else if (st === false) wh.push(`${ALIAS}.status = FALSE`);

  const sql = `
    SELECT ${ALIAS}.state AS state, COUNT(*)::int AS total_cities
    FROM ${TB} ${ALIAS}
    WHERE ${wh.join(' AND ')}
    GROUP BY ${ALIAS}.state
    ORDER BY ${ALIAS}.state ASC;
  `;

  const { rows } = await pool.query(sql);
  return (rows || []).map(r => ({
    state: r.state,
    total_cities: r.total_cities,
  }));
}

/* =======================================================================
 * GET BY ID
 * ======================================================================= */
export async function getById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE ibge_location_id = $1 LIMIT 1`,
    [Number(id)]
  );
  return rowToModel(rows?.[0]);
}

/* =======================================================================
 * Extras úteis
 * ======================================================================= */
export async function getByIbgeCode(ibgeCode) {
  const code = toNumOrNull(ibgeCode);
  if (code == null) return null;

  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE ibge_code = $1 LIMIT 1`,
    [Number(code)]
  );
  return rowToModel(rows?.[0]);
}

/* =======================================================================
 * ✅ Cities by State (com q/limit/offset/status opcional)
 * - Compatível: getCitiesByState("MG") retorna tudo (status TRUE)
 * - Se enviar q, aplica paginação.
 * ======================================================================= */
export async function getCitiesByState(state, opts = {}) {
  const st = toState2(state);
  if (!st) return [];

  const q = toTrimOrNull(opts.q);
  const limit = toInt(opts.limit, 500);
  const offset = toInt(opts.offset, 0);

  // default: status TRUE
  const parsedStatus = (opts.status === undefined) ? true : toBoolOrNull(opts.status);
  const statusFinal = (parsedStatus === null) ? true : parsedStatus;

  const wh = [`state = $1`];
  const values = [st];
  let i = 2;

  if (statusFinal === true) wh.push(`status = TRUE`);
  else if (statusFinal === false) wh.push(`status = FALSE`);

  if (q && q.length >= 1) {
    wh.push(`(city ILIKE $${i} OR CAST(ibge_code AS TEXT) ILIKE $${i})`);
    values.push(`%${q}%`);
    i++;
  }

  const usePaging = !!q;

  const sql = `
    SELECT *
    FROM ${TB}
    WHERE ${wh.join(' AND ')}
    ORDER BY city ASC
    ${usePaging ? `LIMIT $${i} OFFSET $${i + 1}` : ``}
  `;

  const finalValues = usePaging ? [...values, Number(limit), Number(offset)] : values;

  const { rows } = await pool.query(sql, finalValues);
  return (rows || []).map(rowToModel);
}

/* =======================================================================
 * CREATE
 * ======================================================================= */
export async function create(data = {}) {
  const normalized = normalizePayload(data);

  if (!normalized.state) throw new Error('State (UF) is required.');
  if (!normalized.city) throw new Error('City is required.');
  if (normalized.ibge_code == null) throw new Error('ibge_code is required.');

  const cols = [];
  const vals = [];
  const placeholders = [];
  let i = 1;

  for (const [k, v] of Object.entries(normalized)) {
    if (v === undefined) continue;
    cols.push(k);
    vals.push(v);
    placeholders.push(`$${i}`);
    i++;
  }

  const sql = `
    INSERT INTO ${TB} (${cols.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *;
  `;

  const { rows } = await pool.query(sql, vals);
  return rowToModel(rows?.[0]);
}

/* =======================================================================
 * UPDATE
 * ======================================================================= */
export async function update(id, data = {}) {
  const normalized = normalizePayload(data);

  const sets = [];
  const vals = [];
  let i = 1;

  for (const [k, v] of Object.entries(normalized)) {
    if (v === undefined) continue;
    if (v === null && (k === 'state' || k === 'city' || k === 'ibge_code')) continue;
    sets.push(`${k} = $${i}`);
    vals.push(v);
    i++;
  }

  if (!sets.length) return getById(id);

  const sql = `
    UPDATE ${TB}
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE ibge_location_id = $${i}
    RETURNING *;
  `;

  vals.push(Number(id));
  const { rows } = await pool.query(sql, vals);
  return rowToModel(rows?.[0]);
}

/* =======================================================================
 * REMOVE (soft delete: status = false)
 * ======================================================================= */
export async function remove(id) {
  const { rows } = await pool.query(
    `
    UPDATE ${TB}
    SET status = FALSE, updated_at = NOW()
    WHERE ibge_location_id = $1
    RETURNING *;
    `,
    [Number(id)]
  );
  return rowToModel(rows?.[0]);
}

/* =======================================================================
 * ✅ Importar cidades + ibge_code por UF (IBGE → Banco)
 * ======================================================================= */
async function fetchIbgeCitiesByState(state2) {
  const st = toState2(state2);
  if (!st) throw new Error('State (UF) is required.');

  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(st)}/municipios`;

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`IBGE API error ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('IBGE API returned invalid payload.');

  return { st, municipios: data };
}

export async function importByState(state) {
  const { st, municipios } = await fetchIbgeCitiesByState(state);

  const rows = [];
  for (const m of municipios) {
    const ibge_code = toNumOrNull(m?.id);
    const city = toTrimOrNull(m?.nome);
    if (!city || ibge_code == null) continue;
    rows.push({ state: st, city, ibge_code, status: true });
  }

  if (!rows.length) {
    return { ok: true, state: st, total: 0, inserted: 0, updated: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const values = [];
    const placeholders = [];
    let i = 1;

    for (const r of rows) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      values.push(r.state, r.city, Number(r.ibge_code), true);
    }

    const sql = `
      INSERT INTO ${TB} (state, city, ibge_code, status)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (ibge_code)
      DO UPDATE SET
        state = EXCLUDED.state,
        city = EXCLUDED.city,
        status = TRUE,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted;
    `;

    const r = await client.query(sql, values);

    const inserted = r.rows.filter(x => x.inserted).length;
    const updated = r.rows.length - inserted;

    await client.query('COMMIT');
    return { ok: true, state: st, total: r.rows.length, inserted, updated };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/* =======================================================================
 * Export default
 * ======================================================================= */
export default {
  ensureTable,
  listUfs,
  resolveCity,
  list,
  search,
  countByState,
  getById,
  getByIbgeCode,
  getCitiesByState,
  create,
  update,
  remove,
  importByState,
};
