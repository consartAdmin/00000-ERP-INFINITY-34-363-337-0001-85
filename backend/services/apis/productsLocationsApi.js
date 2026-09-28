// ╔══════════════════════════════════════════════════════════════════════╗
// ║ 📦 productsLocationsApi.js — Service/API de acesso                    ║
// ║ Tabela `productsLocations` — CONSART ERP (ESM)                        ║
// ║ Path: backend/services/apis/products/productsLocationsApi.js          ║
// ║                                                                      ║
// ║ ✅ LISTA com JOIN em products para trazer descrição (por product_code)║
// ║ ✅ Busca (q) também procura na descrição do produto                    ║
// ║ ✅ Busca (q) também procura por BARCODE (JOIN em productsBarCode)     ║
// ║ ✅ Count consistente (repete JOIN quando necessário)                   ║
// ║ ✅ FIX: UNIQUE com COALESCE agora via UNIQUE INDEX (Postgres)          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."productsLocations"';
const ALIAS = 'pl';

// products (ajuste o nome/coluna se seu schema for diferente)
const TB_PRODUCTS = 'public."products"';
const PRODUCTS_ALIAS = 'p';

// ⚠️ Ajuste aqui se a coluna de descrição do produto tiver outro nome:
// ex.: 'description', 'product_name', 'descricao', etc.
const PRODUCT_DESC_COL = 'description';

// ✅ barcodes (AJUSTE se seu schema for diferente)
const TB_BARCODES = 'public."productsBarCode"';
const BARCODES_ALIAS = 'pb';
const BARCODE_COL = 'barcode';

const toBool = (v, def = true) =>
  (typeof v === 'boolean') ? v :
    (v == null ? def : String(v).match(/^(1|true|t|yes|y)$/i) != null);

/* ────────────────────────────────────────────────────────────────────
   DDL — Criação da tabela e objetos auxiliares (idempotente)
──────────────────────────────────────────────────────────────────── */
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Cria a tabela (se não existir) com o mínimo
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        id            BIGSERIAL PRIMARY KEY,
        product_code  VARCHAR(50) NOT NULL
      );
    `);

    // 2) Garante colunas ausentes (migração idempotente)
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS store_id    INTEGER;`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS corredor    VARCHAR(50);`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS prateleira  VARCHAR(50);`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS bandeja     VARCHAR(50);`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS box         VARCHAR(50);`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS observacao  TEXT;`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await client.query(`ALTER TABLE ${TB} ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE;`);

    // 3) Índices básicos
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pl_product_code
        ON ${TB} (product_code);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pl_store_product
        ON ${TB} (store_id, product_code);
    `);

    // ✅ 3.1) UNIQUE com COALESCE — via UNIQUE INDEX (Postgres)
    // Motivo: COALESCE em constraint UNIQUE NÃO é permitido.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'i'
            AND c.relname = 'uq_products_locations_store_product_place_idx'
            AND n.nspname = 'public'
        ) THEN
          EXECUTE '
            CREATE UNIQUE INDEX uq_products_locations_store_product_place_idx
            ON public."productsLocations" (
              store_id,
              product_code,
              COALESCE(corredor, ''''),
              COALESCE(prateleira, ''''),
              COALESCE(bandeja, ''''),
              COALESCE(box, '''')
            );
          ';
        END IF;
      END$$;
    `);

    // 4) Trigger de updated_at (reutiliza o padrão global)
    await client.query(`
      CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at := NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_products_locations_set_updated_at'
        ) THEN
          CREATE TRIGGER trg_products_locations_set_updated_at
          BEFORE UPDATE ON ${TB}
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at_timestamp();
        END IF;
      END$$;
    `);

    // 5) Backfill defensivo
    await client.query(`
      UPDATE ${TB}
         SET is_active = TRUE
       WHERE is_active IS NULL;
    `);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────── */
function normalizeRow(r = {}) {
  return {
    id: r.id != null ? Number(r.id) : null,
    product_code: r.product_code ?? null,

    // ✅ descrição do produto (join)
    product_description: r.product_description ?? null,

    // ✅ barcode (join) — se você não quiser retornar, pode ignorar no frontend
    barcode: r.barcode ?? null,

    store_id: r.store_id != null ? Number(r.store_id) : null,
    corredor: r.corredor ?? null,
    prateleira: r.prateleira ?? null,
    bandeja: r.bandeja ?? null,
    box: r.box ?? null,
    observacao: r.observacao ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    is_active: !!r.is_active,
  };
}

/**
 * buildWhere suporta busca também na descrição do produto (p.description)
 * e no barcode (pb.barcode).
 */
function buildWhere({
  q,
  product_code,
  store_id,
  onlyActive,
  corredor,
  prateleira,
  bandeja
} = {}) {
  const clauses = [];
  const params = [];

  // 🔎 BUSCA GLOBAL (q)
  if (q) {
    const qRaw = String(q).trim();
    params.push(`%${qRaw}%`.toLowerCase());
    const pLike = `$${params.length}`;

    params.push(qRaw);
    const pExact = `$${params.length}`;

    clauses.push(`
      (
        LOWER(${ALIAS}.product_code) LIKE ${pLike}
        OR LOWER(COALESCE(${ALIAS}.corredor,    '')) LIKE ${pLike}
        OR LOWER(COALESCE(${ALIAS}.prateleira,  '')) LIKE ${pLike}
        OR LOWER(COALESCE(${ALIAS}.bandeja,     '')) LIKE ${pLike}
        OR LOWER(COALESCE(${ALIAS}.box,         '')) LIKE ${pLike}
        OR LOWER(COALESCE(${ALIAS}.observacao,  '')) LIKE ${pLike}
        OR LOWER(COALESCE(${PRODUCTS_ALIAS}."${PRODUCT_DESC_COL}", '')) LIKE ${pLike}

        OR ${BARCODES_ALIAS}."${BARCODE_COL}" = ${pExact}
        OR LOWER(COALESCE(${BARCODES_ALIAS}."${BARCODE_COL}", '')) LIKE ${pLike}
      )
    `);
  }

  // 🔎 FILTRO EXATO POR SKU
  if (product_code) {
    params.push(product_code);
    clauses.push(`${ALIAS}.product_code = $${params.length}`);
  }

  // 🏪 STORE
  if (store_id != null && store_id !== '') {
    params.push(Number(store_id));
    clauses.push(`${ALIAS}.store_id = $${params.length}`);
  }

  // 🧭 CORREDOR
  if (corredor) {
    params.push(`%${String(corredor).toLowerCase()}%`);
    clauses.push(`LOWER(COALESCE(${ALIAS}.corredor,'')) LIKE $${params.length}`);
  }

  // 🧱 GÔNDOLA (prateleira)
  if (prateleira) {
    params.push(`%${String(prateleira).toLowerCase()}%`);
    clauses.push(`LOWER(COALESCE(${ALIAS}.prateleira,'')) LIKE $${params.length}`);
  }

  // 📦 BANDEJA
  if (bandeja) {
    params.push(`%${String(bandeja).toLowerCase()}%`);
    clauses.push(`LOWER(COALESCE(${ALIAS}.bandeja,'')) LIKE $${params.length}`);
  }

  // ✅ ATIVOS
  if (onlyActive) {
    clauses.push(`${ALIAS}.is_active = TRUE`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return { where, params };
}

/* ────────────────────────────────────────────────────────────────────
   CRUD
──────────────────────────────────────────────────────────────────── */
export async function list({
  q,
  product_code,
  store_id,
  corredor,
  prateleira,
  bandeja,
  limit = 50,
  offset = 0,
  onlyActive = false,
} = {}) {
  limit = Math.max(1, Math.min(1000, Number(limit) || 50));
  offset = Math.max(0, Number(offset) || 0);
  onlyActive = toBool(onlyActive, false);

  // ✅ Sempre fazemos LEFT JOIN para trazer descrição e barcode.
  // ✅ E o WHERE pode filtrar também pela descrição e barcode via aliases.
  const { where, params } = buildWhere({
    q,
    product_code,
    store_id,
    onlyActive,
    corredor: arguments[0]?.corredor,
    prateleira: arguments[0]?.prateleira,
    bandeja: arguments[0]?.bandeja
  });

  const sql = `
    SELECT
      ${ALIAS}.id,
      ${ALIAS}.product_code,
      ${PRODUCTS_ALIAS}."${PRODUCT_DESC_COL}" AS product_description,
      ${BARCODES_ALIAS}."${BARCODE_COL}"      AS barcode,
      ${ALIAS}.store_id,
      ${ALIAS}.corredor,
      ${ALIAS}.prateleira,
      ${ALIAS}.bandeja,
      ${ALIAS}.box,
      ${ALIAS}.observacao,
      ${ALIAS}.created_at,
      ${ALIAS}.updated_at,
      ${ALIAS}.is_active
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PRODUCTS} ${PRODUCTS_ALIAS}
      ON ${PRODUCTS_ALIAS}.product_code = ${ALIAS}.product_code
    LEFT JOIN ${TB_BARCODES} ${BARCODES_ALIAS}
      ON ${BARCODES_ALIAS}.product_code = ${ALIAS}.product_code
    ${where}
    ORDER BY ${ALIAS}.product_code ASC, ${ALIAS}.id ASC
    LIMIT ${limit} OFFSET ${offset};
  `;

  // ✅ Count precisa do mesmo JOIN porque o WHERE pode usar p.description e pb.barcode
  const sqlCount = `
    SELECT COUNT(*)::int AS total
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PRODUCTS} ${PRODUCTS_ALIAS}
      ON ${PRODUCTS_ALIAS}.product_code = ${ALIAS}.product_code
    LEFT JOIN ${TB_BARCODES} ${BARCODES_ALIAS}
      ON ${BARCODES_ALIAS}.product_code = ${ALIAS}.product_code
    ${where};
  `;

  const client = await pool.connect();
  try {
    const [{ rows }, count] = await Promise.all([
      client.query(sql, params),
      client.query(sqlCount, params),
    ]);

    return {
      rows: rows.map(normalizeRow),
      total: count.rows?.[0]?.total ?? 0,
      limit,
      offset,
    };
  } finally {
    client.release();
  }
}

export async function listByProductCode(product_code, store_id = null) {
  return list({ product_code, store_id, onlyActive: false, limit: 1000, offset: 0 });
}

export async function getById(id) {
  const { rows } = await pool.query(
    `
    SELECT
      ${ALIAS}.id,
      ${ALIAS}.product_code,
      ${PRODUCTS_ALIAS}."${PRODUCT_DESC_COL}" AS product_description,
      ${BARCODES_ALIAS}."${BARCODE_COL}"      AS barcode,
      ${ALIAS}.store_id,
      ${ALIAS}.corredor,
      ${ALIAS}.prateleira,
      ${ALIAS}.bandeja,
      ${ALIAS}.box,
      ${ALIAS}.observacao,
      ${ALIAS}.created_at,
      ${ALIAS}.updated_at,
      ${ALIAS}.is_active
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PRODUCTS} ${PRODUCTS_ALIAS}
      ON ${PRODUCTS_ALIAS}.product_code = ${ALIAS}.product_code
    LEFT JOIN ${TB_BARCODES} ${BARCODES_ALIAS}
      ON ${BARCODES_ALIAS}.product_code = ${ALIAS}.product_code
    WHERE ${ALIAS}.id = $1
    LIMIT 1;
    `,
    [id]
  );

  return rows[0] ? normalizeRow(rows[0]) : null;
}

export async function create({
  product_code,
  store_id = null,
  corredor = null,
  prateleira = null,
  bandeja = null,
  box = null,
  observacao = null,
  is_active = true,
} = {}) {
  if (!product_code) throw new Error('product_code é obrigatório');

  const { rows } = await pool.query(
    `INSERT INTO ${TB} (
       product_code,
       store_id,
       corredor,
       prateleira,
       bandeja,
       box,
       observacao,
       is_active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id;`,
    [
      product_code,
      store_id != null ? Number(store_id) : null,
      corredor,
      prateleira,
      bandeja,
      box,
      observacao,
      toBool(is_active, true),
    ]
  );

  // ✅ retorna já com descrição/barcode (via getById com join)
  return rows[0]?.id ? getById(rows[0].id) : null;
}

export async function update(id, patch = {}) {
  const fields = [];
  const params = [];
  let idx = 1;

  if (patch.product_code != null) {
    fields.push(`product_code = $${idx++}`);
    params.push(patch.product_code);
  }
  if (patch.store_id !== undefined) {
    fields.push(`store_id = $${idx++}`);
    params.push(
      patch.store_id === null || patch.store_id === ''
        ? null
        : Number(patch.store_id)
    );
  }
  if (patch.corredor !== undefined) {
    fields.push(`corredor = $${idx++}`);
    params.push(patch.corredor);
  }
  if (patch.prateleira !== undefined) {
    fields.push(`prateleira = $${idx++}`);
    params.push(patch.prateleira);
  }
  if (patch.bandeja !== undefined) {
    fields.push(`bandeja = $${idx++}`);
    params.push(patch.bandeja);
  }
  if (patch.box !== undefined) {
    fields.push(`box = $${idx++}`);
    params.push(patch.box);
  }
  if (patch.observacao !== undefined) {
    fields.push(`observacao = $${idx++}`);
    params.push(patch.observacao);
  }
  if (patch.is_active != null) {
    fields.push(`is_active = $${idx++}`);
    params.push(toBool(patch.is_active));
  }

  if (!fields.length) return getById(id);

  params.push(id);

  const { rows } = await pool.query(
    `UPDATE ${TB}
        SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${idx}
      RETURNING id;`,
    params
  );

  // ✅ retorna já com descrição/barcode (via getById com join)
  return rows[0]?.id ? getById(rows[0].id) : null;
}

export async function deactivate(id) {
  const { rows } = await pool.query(
    `UPDATE ${TB}
        SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING id;`,
    [id]
  );
  return rows[0]?.id ? getById(rows[0].id) : null;
}

export async function remove(id) {
  // aqui não precisa join
  const { rows } = await pool.query(
    `DELETE FROM ${TB}
      WHERE id = $1
      RETURNING *;`,
    [id]
  );
  return rows[0] ? normalizeRow(rows[0]) : null;
}

export default {
  ensureTable,
  list,
  listByProductCode,
  getById,
  create,
  update,
  deactivate,
  remove,
};