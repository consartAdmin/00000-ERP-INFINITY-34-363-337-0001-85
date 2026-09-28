// ╔══════════════════════════════════════════════════════════════════════╗
// ║ signaturesDeliveriesApi.js — DAL Assinaturas Entrega (ESM)          ║
// ║ Tabela: public."signaturesDeliveries"                               ║
// ║ Funções: ensureTable, list, search, getById, create, update, remove ║
// ║ Padrão CONSART (similar ao sellersApi.js)                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB    = 'public."signaturesDeliveries"';
const ALIAS = 'sd';

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

/* =======================================================================
 * Normalização de payload
 * ======================================================================= */
function normalizePayload(payload = {}) {
  const order_id =
    payload.order_id ??
    payload.orderId ??
    payload.pedido_id ??
    null;

  const nfe_key =
    payload.nfe_key ??
    payload.nfeKey ??
    payload.chave_nfe ??
    payload.chaveAcesso ??
    null;

  const signed_name =
    payload.signed_name ??
    payload.signedName ??
    payload.nome_assinatura ??
    payload.nome_recebedor ??
    null;

  const signature_image =
    payload.signature_image ??
    payload.signatureImage ??
    payload.assinatura_imagem ??
    null;

  return {
    order_id:        order_id != null ? Number(order_id) : null,
    nfe_key:         toTrimOrNull(nfe_key),
    signed_name:     toTrimOrNull(signed_name),
    signature_image: signature_image, // base64 dataURL (image/png)
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
        id              SERIAL PRIMARY KEY,
        order_id        INTEGER NOT NULL,
        nfe_key         VARCHAR(44) NOT NULL,
        signed_name     VARCHAR(255) NOT NULL,
        signature_image TEXT NOT NULL,
        created_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        updated_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      );
    `);

    // Garante colunas (caso tabela já existisse antiga)
    await client.query(`
      ALTER TABLE ${TB}
        ADD COLUMN IF NOT EXISTS id              SERIAL,
        ADD COLUMN IF NOT EXISTS order_id        INTEGER,
        ADD COLUMN IF NOT EXISTS nfe_key         VARCHAR(44),
        ADD COLUMN IF NOT EXISTS signed_name     VARCHAR(255),
        ADD COLUMN IF NOT EXISTS signature_image TEXT,
        ADD COLUMN IF NOT EXISTS created_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW();
    `);

    // Índices úteis
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_signaturesDeliveries_order_id
        ON ${TB} (order_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_signaturesDeliveries_nfe_key
        ON ${TB} (nfe_key);
    `);

    // Função de updated_at
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'trg_signaturesDeliveries_set_timestamp'
        ) THEN
          CREATE OR REPLACE FUNCTION trg_signaturesDeliveries_set_timestamp()
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
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_signaturesDeliveries_set_timestamp'
        ) THEN
          CREATE TRIGGER trg_signaturesDeliveries_set_timestamp
          BEFORE UPDATE ON ${TB}
          FOR EACH ROW
          EXECUTE PROCEDURE trg_signaturesDeliveries_set_timestamp();
        END IF;
      END $$;
    `);

    // (Opcional) Único por pedido + chave NF-e
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM   pg_constraint
          WHERE  conname = 'signaturesDeliveries_order_nfe_uk'
        ) THEN
          ALTER TABLE ${TB}
            ADD CONSTRAINT signaturesDeliveries_order_nfe_uk
            UNIQUE (order_id, nfe_key);
        END IF;
      END;
      $$;
    `);

    await client.query('COMMIT');
    return { ok: true, table: 'signaturesDeliveries', message: 'ensureTable() signaturesDeliveries ok' };
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
    id:              r.id,
    order_id:        r.order_id,
    nfe_key:         r.nfe_key,
    signed_name:     r.signed_name,
    signature_image: r.signature_image,
    created_at:      r.created_at,
    updated_at:      r.updated_at,
  };
}

/* =======================================================================
 * LIST / SEARCH
 * ======================================================================= */
export async function list(params = {}) {
  const {
    q,
    order_id,
    nfe_key,
    limit  = 50,
    offset = 0,
  } = params;

  const wh = ['1=1'];
  const values = [];
  let i = 1;

  if (q) {
    wh.push(`(
      ${ALIAS}.signed_name ILIKE $${i} OR
      ${ALIAS}.nfe_key     ILIKE $${i}
    )`);
    values.push(`%${q}%`);
    i++;
  }

  if (order_id != null) {
    wh.push(`${ALIAS}.order_id = $${i}`);
    values.push(Number(order_id));
    i++;
  }

  if (nfe_key) {
    wh.push(`${ALIAS}.nfe_key = $${i}`);
    values.push(String(nfe_key));
    i++;
  }

  const sql = `
    SELECT ${ALIAS}.*
    FROM ${TB} ${ALIAS}
    WHERE ${wh.join(' AND ')}
    ORDER BY ${ALIAS}.created_at DESC, ${ALIAS}.id DESC
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

  if (!normalized.order_id) {
    throw new Error('order_id é obrigatório para a assinatura de entrega.');
  }
  if (!normalized.nfe_key) {
    throw new Error('nfe_key (chave da NF-e) é obrigatória.');
  }
  if (!normalized.signed_name) {
    throw new Error('signed_name (nome de quem recebeu) é obrigatório.');
  }
  if (!normalized.signature_image) {
    throw new Error('signature_image (imagem base64 da assinatura) é obrigatório.');
  }

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
    ON CONFLICT (order_id, nfe_key)
    DO UPDATE SET
      signed_name     = EXCLUDED.signed_name,
      signature_image = EXCLUDED.signature_image,
      updated_at      = NOW()
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
 * REMOVE (delete definitivo da assinatura)
 * ======================================================================= */
export async function remove(id) {
  const { rows } = await pool.query(
    `
    DELETE FROM ${TB}
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
