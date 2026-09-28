  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║ sellersApi.js — Data Access Layer (DAL) para Vendedores (ESM)       ║
  // ║ Tabela: public."sellers"                                            ║
  // ║ Funções: ensureTable, list, search, getById, create, update, remove ║
  // ║ Padrão CONSART (similar ao productsFiscalApi.js)                    ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  import pool from '../../config/db.js';

  const TB    = 'public."sellers"';
  const ALIAS = 's';

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

  /* =======================================================================
  * Normalização de payload
  * ======================================================================= */
  function normalizePayload(payload = {}) {
    const name =
      payload.name ??
      payload.nome ??
      payload.seller_name ??
      null;

    const nickname =
      payload.nickname ??
      payload.apelido ??
      null;

    const document =
      payload.document ??
      payload.cpf_cnpj ??
      payload.cnpj_cpf ??
      null;

    const email =
      payload.email ??
      payload.mail ??
      null;

    const phone =
      payload.phone ??
      payload.telefone ??
      null;

    const mobile =
      payload.mobile ??
      payload.celular ??
      payload.phone_mobile ??
      null;

    const commission_type =
      payload.commission_type ??
      payload.tipo_comissao ??
      'PERCENT';

    const commission_value =
      toNumOrNull(payload.commission_value ?? payload.comissao ?? payload.commission);

    let active = toBoolOrNull(payload.active);
    if (active === null && payload.status != null) {
      const s = String(payload.status).toLowerCase();
      active = ['ativo', 'active', '1', 'true'].includes(s);
    }

    return {
      name:             toTrimOrNull(name),
      nickname:         toTrimOrNull(nickname),
      document:         toTrimOrNull(document),
      email:            toTrimOrNull(email),
      phone:            toTrimOrNull(phone),
      mobile:           toTrimOrNull(mobile),
      active:           active ?? true,
      commission_type:  toTrimOrNull(commission_type || 'PERCENT'),
      commission_value: commission_value ?? 0,
      observations:     toTrimOrNull(payload.observations ?? payload.obs ?? payload.observacao),
    };
  }

  /* =======================================================================
  * DDL / ensureTable idempotente
  * ======================================================================= */
  export async function ensureTable() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Cria tabela, se não existir
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TB} (
          id               SERIAL PRIMARY KEY,
          name             VARCHAR(150) NOT NULL,
          nickname         VARCHAR(100),
          document         VARCHAR(20),
          email            VARCHAR(150),
          phone            VARCHAR(30),
          mobile           VARCHAR(30),
          active           BOOLEAN DEFAULT TRUE,
          commission_type  VARCHAR(20) DEFAULT 'PERCENT',
          commission_value NUMERIC(10,4) DEFAULT 0,
          observations     TEXT,
          created_at       TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
          updated_at       TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        );
      `);

      // Garante colunas (caso tabela já existisse antiga)
      await client.query(`
        ALTER TABLE ${TB}
          ADD COLUMN IF NOT EXISTS id               SERIAL,
          ADD COLUMN IF NOT EXISTS name             VARCHAR(150),
          ADD COLUMN IF NOT EXISTS nickname         VARCHAR(100),
          ADD COLUMN IF NOT EXISTS document         VARCHAR(20),
          ADD COLUMN IF NOT EXISTS email            VARCHAR(150),
          ADD COLUMN IF NOT EXISTS phone            VARCHAR(30),
          ADD COLUMN IF NOT EXISTS mobile           VARCHAR(30),
          ADD COLUMN IF NOT EXISTS active           BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS commission_type  VARCHAR(20) DEFAULT 'PERCENT',
          ADD COLUMN IF NOT EXISTS commission_value NUMERIC(10,4) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS observations     TEXT,
          ADD COLUMN IF NOT EXISTS created_at       TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
          ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW();
      `);

      // Índices úteis
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sellers_name
          ON ${TB} (name);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sellers_document
          ON ${TB} (document);
      `);

      // Função de updated_at (usa mesma ideia do padrão do seu banco)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_proc WHERE proname = 'trg_sellers_set_timestamp'
          ) THEN
            CREATE OR REPLACE FUNCTION trg_sellers_set_timestamp()
            RETURNS TRIGGER AS $body$
            BEGIN
              NEW.updated_at = NOW();
              RETURN NEW;
            END;
            $body$ LANGUAGE plpgsql;
          END IF;
        END $$;
      `);

      // Trigger de updated_at
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sellers_set_timestamp'
          ) THEN
            CREATE TRIGGER trg_sellers_set_timestamp
            BEFORE UPDATE ON ${TB}
            FOR EACH ROW
            EXECUTE PROCEDURE trg_sellers_set_timestamp();
          END IF;
        END $$;
      `);

      await client.query('COMMIT');
      return { ok: true, table: 'sellers', message: 'ensureTable() sellers ok' };
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
      id:               r.id,
      name:             r.name,
      nickname:         r.nickname,
      document:         r.document,
      email:            r.email,
      phone:            r.phone,
      mobile:           r.mobile,
      active:           r.active !== false, // default true
      commission_type:  r.commission_type || 'PERCENT',
      commission_value: toNumOrNull(r.commission_value) ?? 0,
      observations:     r.observations,
      created_at:       r.created_at,
      updated_at:       r.updated_at,
    };
  }

  /* =======================================================================
  * LIST / SEARCH
  * ======================================================================= */
  export async function list(params = {}) {
    const {
      q,
      active,
      limit  = 50,
      offset = 0,
    } = params;

    const wh = ['1=1'];
    const values = [];
    let i = 1;

    if (q) {
      wh.push(`(
        ${ALIAS}.name ILIKE $${i} OR
        ${ALIAS}.nickname ILIKE $${i} OR
        ${ALIAS}.email ILIKE $${i} OR
        ${ALIAS}.phone ILIKE $${i} OR
        ${ALIAS}.mobile ILIKE $${i} OR
        ${ALIAS}.document ILIKE $${i} OR
        ${ALIAS}.observations ILIKE $${i}
      )`);
      values.push(`%${q}%`);
      i++;
    }

    if (active === true) {
      wh.push(`${ALIAS}.active = TRUE`);
    } else if (active === false) {
      wh.push(`${ALIAS}.active = FALSE`);
    }

    const sql = `
      SELECT ${ALIAS}.*
      FROM ${TB} ${ALIAS}
      WHERE ${wh.join(' AND ')}
      ORDER BY ${ALIAS}.name ASC, ${ALIAS}.id ASC
      LIMIT $${i} OFFSET $${i + 1};
    `;

    values.push(Number(limit), Number(offset));
    const { rows } = await pool.query(sql, values);
    return rows.map(rowToModel);
  }

  export async function search(q, limit = 20) {
    return list({ q, limit });
  }

  /* =======================================================================
  * GET BY ID
  * ======================================================================= */
  export async function getById(id) {
    const { rows } = await pool.query(
      `SELECT * FROM ${TB} WHERE id = $1 LIMIT 1`,
      [Number(id)]
    );
    return rowToModel(rows[0]);
  }

  /* =======================================================================
  * CREATE
  * ======================================================================= */
  export async function create(data = {}) {
    const normalized = normalizePayload(data);

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

    if (!cols.length || !normalized.name) {
      throw new Error('Nome do vendedor é obrigatório.');
    }

    const sql = `
      INSERT INTO ${TB} (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *;
    `;

    const { rows } = await pool.query(sql, vals);
    return rowToModel(rows[0]);
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
      sets.push(`${k} = $${i}`);
      vals.push(v);
      i++;
    }

    if (!sets.length) {
      return getById(id);
    }

    const sql = `
      UPDATE ${TB}
      SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${i}
      RETURNING *;
    `;

    vals.push(Number(id));
    const { rows } = await pool.query(sql, vals);
    return rowToModel(rows[0]);
  }

  /* =======================================================================
  * REMOVE (soft delete: active = false)
  * ======================================================================= */
  export async function remove(id) {
    const { rows } = await pool.query(
      `
      UPDATE ${TB}
      SET active = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING *;
      `,
      [Number(id)]
    );
    return rowToModel(rows[0]);
  }

  /* =======================================================================
  * Export default
  * ======================================================================= */
  export default {
    ensureTable,
    list,
    search,
    getById,
    create,
    update,
    remove,
  };
