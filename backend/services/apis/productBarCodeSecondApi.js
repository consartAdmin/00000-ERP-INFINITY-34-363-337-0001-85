// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ productBarCodeSecondApi.js — Segundo Código de Barras (CONSART ERP)     ║
// ║ Tabela principal: public."productBarCodeSecond"                          ║
// ║ - Liga product_code + product_unit_id → second_bar_code                  ║
// ║ - Suporte a múltiplos códigos por unidade, com unicidade garantida       ║
// ║ - Cada código secundário pode ter uma tabela de preço (prices.price_id)  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ──────────────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────────────
const TB = '"productBarCodeSecond"';
const DEFAULT_PRICE_ID = 2; // 🔹 ATCDO. (price_id = 2)

const COLS = Object.freeze({
  id:              'id',
  product_code:    'product_code',
  product_unit_id: 'product_unit_id',
  second_bar_code: 'second_bar_code',
  code_type:       'code_type',
  price_id:        'price_id',     // 🔹 nova coluna
  created_at:      'created_at',
  updated_at:      'updated_at',
});

const ORDERABLE = new Set([
  COLS.id,
  COLS.product_code,
  COLS.product_unit_id,
  COLS.second_bar_code,
  COLS.price_id,
  COLS.created_at,
  COLS.updated_at,
]);

const notEmptyStr = (s) => typeof s === 'string' && s.trim().length > 0;
const uniqueViolation = (err) => err && err.code === '23505';

const sanitizeOrder = (orderBy = COLS.second_bar_code, dir = 'ASC') => {
  const safeCol = ORDERABLE.has(orderBy) ? orderBy : COLS.second_bar_code;
  const safeDir = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return { orderBy: safeCol, dir: safeDir };
};

const mapRow = (r) =>
  r && {
    id: r.id,
    product_code: r.product_code,
    product_description: r.product_description, // ✅ novo
    product_unit_id: r.product_unit_id,
    second_bar_code: r.second_bar_code,
    code_type: r.code_type,
    price_id: r.price_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };

// ──────────────────────────────────────────────────────────────────────────────
// DDL / índices / triggers
// ──────────────────────────────────────────────────────────────────────────────
export async function ensureProductBarCodeSecondTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tabela base (já inclui price_id para novas instalações)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${TB} (
        ${COLS.id}              SERIAL PRIMARY KEY,
        ${COLS.product_code}    VARCHAR(50)  NOT NULL,
        ${COLS.product_unit_id} INTEGER      NOT NULL,
        ${COLS.second_bar_code} VARCHAR(100) NOT NULL,
        ${COLS.code_type}       VARCHAR(50)  DEFAULT 'EAN-13',
        ${COLS.price_id}        INTEGER      DEFAULT ${DEFAULT_PRICE_ID},
        ${COLS.created_at}      TIMESTAMP    DEFAULT NOW(),
        ${COLS.updated_at}      TIMESTAMP    DEFAULT NOW()
      );
    `);

    // Garante coluna price_id em bases já existentes
    await client.query(`
      ALTER TABLE public.${TB}
      ADD COLUMN IF NOT EXISTS ${COLS.price_id} INTEGER;
    `);

    // Define default = 2 (ATCDO.)
    await client.query(`
      ALTER TABLE public.${TB}
        ALTER COLUMN ${COLS.price_id} SET DEFAULT ${DEFAULT_PRICE_ID};
    `);

    // Atualiza registros antigos nulos para 2
    await client.query(`
      UPDATE public.${TB}
         SET ${COLS.price_id} = ${DEFAULT_PRICE_ID}
       WHERE ${COLS.price_id} IS NULL;
    `);

    // Garante NOT NULL
    await client.query(`
      ALTER TABLE public.${TB}
        ALTER COLUMN ${COLS.price_id} SET NOT NULL;
    `);

    // FK → products(product_code)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.${TB}'::regclass
             AND conname  = 'pbs_product_fk'
        ) THEN
          ALTER TABLE public.${TB}
            ADD CONSTRAINT pbs_product_fk
            FOREIGN KEY (${COLS.product_code})
            REFERENCES public."products"(product_code)
            ON UPDATE CASCADE
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // FK → productsUnits(product_unit_id)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.${TB}'::regclass
             AND conname  = 'pbs_product_unit_fk'
        ) THEN
          ALTER TABLE public.${TB}
            ADD CONSTRAINT pbs_product_unit_fk
            FOREIGN KEY (${COLS.product_unit_id})
            REFERENCES public."productsUnits"(product_unit_id)
            ON UPDATE CASCADE
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // FK → prices(price_id)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.${TB}'::regclass
             AND conname  = 'pbs_price_fk'
        ) THEN
          ALTER TABLE public.${TB}
            ADD CONSTRAINT pbs_price_fk
            FOREIGN KEY (${COLS.price_id})
            REFERENCES public."prices"(price_id)
            ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // Índice para busca por código de barras
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pbs_second_bar_code
        ON public.${TB}(${COLS.second_bar_code});
    `);

    // Índice por price_id (útil para relatórios)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pbs_price_id
        ON public.${TB}(${COLS.price_id});
    `);

    // Unicidade: mesmo produto + unidade + código não repete
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pbs_unique_entry
        ON public.${TB}(${COLS.product_code}, ${COLS.product_unit_id}, ${COLS.second_bar_code});
    `);

    // Função genérica de timestamp (reutilizável)
    await client.query(`
      CREATE OR REPLACE FUNCTION trg_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.${COLS.updated_at} = NOW();
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);

    // Trigger updated_at para esta tabela
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_pbs') THEN
          CREATE TRIGGER set_timestamp_pbs
          BEFORE UPDATE ON public.${TB}
          FOR EACH ROW
          EXECUTE PROCEDURE trg_set_timestamp();
        END IF;
      END $$;
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

// ──────────────────────────────────────────────────────────────────────────────
// List / Get
// ──────────────────────────────────────────────────────────────────────────────
export async function listSecondBarCodes(params = {}) {
  const {
    q, // busca no próprio código de barras
    product_code,
    product_unit_id,
    price_id,
    limit = 50,
    offset = 0,
    orderBy = COLS.second_bar_code,
    dir = 'ASC',
  } = params;

  const { orderBy: ob, dir: od } = sanitizeOrder(orderBy, dir);

  const where = [];
  const values = [];
  let i = 1;

  if (notEmptyStr(q)) {
    where.push(`LOWER(${COLS.second_bar_code}) LIKE LOWER($${i++})`);
    values.push(`%${q.trim()}%`);
  }
  if (notEmptyStr(product_code)) {
    where.push(`${COLS.product_code} = $${i++}`);
    values.push(String(product_code).trim());
  }
  if (product_unit_id !== undefined && product_unit_id !== null && product_unit_id !== '') {
    where.push(`${COLS.product_unit_id} = $${i++}`);
    values.push(Number(product_unit_id));
  }
  if (price_id !== undefined && price_id !== null && price_id !== '') {
    where.push(`${COLS.price_id} = $${i++}`);
    values.push(Number(price_id));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

const sql = `
  SELECT
    pbs.${COLS.id},
    pbs.${COLS.product_code},
    p.description AS product_description,     -- ✅ vem do products
    pbs.${COLS.product_unit_id},
    pbs.${COLS.second_bar_code},
    pbs.${COLS.code_type},
    pbs.${COLS.price_id},
    pbs.${COLS.created_at},
    pbs.${COLS.updated_at}
  FROM public.${TB} pbs
  LEFT JOIN public."products" p
    ON p.product_code = pbs.${COLS.product_code}
  ${whereSql}
  ORDER BY pbs.${ob} ${od}
  LIMIT $${i++} OFFSET $${i++};
`;

  values.push(Number(limit) || 50, Number(offset) || 0);

  const countSql = `
    SELECT COUNT(*)::INT AS total
      FROM public.${TB}
      ${whereSql};
  `;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, values),
    pool.query(countSql, values.slice(0, values.length - 2)),
  ]);

  return {
    rows: rowsRes.rows.map(mapRow),
    total: countRes.rows[0]?.total ?? 0,
    limit: Number(limit) || 50,
    offset: Number(offset) || 0,
  };
}

export async function getSecondBarCodeById(id) {
  const { rows } = await pool.query(
    `
    SELECT
      pbs.${COLS.id},
      pbs.${COLS.product_code},
      p.description AS product_description,
      pbs.${COLS.product_unit_id},
      pbs.${COLS.second_bar_code},
      pbs.${COLS.code_type},
      pbs.${COLS.price_id},
      pbs.${COLS.created_at},
      pbs.${COLS.updated_at}
    FROM public.${TB} pbs
    LEFT JOIN public."products" p
      ON p.product_code = pbs.${COLS.product_code}
    WHERE pbs.${COLS.id} = $1
    LIMIT 1;
    `,
    [id]
  );
  return mapRow(rows[0]);
}

/**
 * Busca por código de barras exato (para uso no PDV / conferência).
 */
export async function findBySecondBarCode(secondBarCode) {
  const { rows } = await pool.query(
    `
    SELECT ${COLS.id}, ${COLS.product_code}, ${COLS.product_unit_id},
           ${COLS.second_bar_code}, ${COLS.code_type}, ${COLS.price_id},
           ${COLS.created_at}, ${COLS.updated_at}
      FROM public.${TB}
     WHERE ${COLS.second_bar_code} = $1;
    `,
    [secondBarCode]
  );
  return rows.map(mapRow);
}

// ──────────────────────────────────────────────────────────────────────────────
// Create / Upsert
// ──────────────────────────────────────────────────────────────────────────────
export async function createSecondBarCode(payload = {}) {
  const errors = [];
  if (!notEmptyStr(payload?.product_code)) {
    errors.push('O campo "product_code" é obrigatório.');
  }
  if (
    payload?.product_unit_id === undefined ||
    payload.product_unit_id === null ||
    payload.product_unit_id === ''
  ) {
    errors.push('O campo "product_unit_id" é obrigatório.');
  }
  if (!notEmptyStr(payload?.second_bar_code)) {
    errors.push('O campo "second_bar_code" é obrigatório.');
  }

  if (errors.length) {
    const e = new Error('ValidationError');
    e.status = 400;
    e.details = errors;
    throw e;
  }

  const product_code    = String(payload.product_code).trim();
  const product_unit_id = Number(payload.product_unit_id);
  const second_bar_code = String(payload.second_bar_code).trim();
  const code_type = notEmptyStr(payload?.code_type)
    ? String(payload.code_type).trim()
    : 'EAN-13';

  // 🔹 Se não vier nada, usa ALWAYS price_id = 2 (ATCDO.)
  const rawPriceId = payload.price_id;
  let price_id =
    rawPriceId === undefined || rawPriceId === null || rawPriceId === ''
      ? DEFAULT_PRICE_ID
      : Number(rawPriceId);
  if (Number.isNaN(price_id)) price_id = DEFAULT_PRICE_ID;

  try {
    const { rows: [row] } = await pool.query(
      `
      INSERT INTO public.${TB} (
        ${COLS.product_code},
        ${COLS.product_unit_id},
        ${COLS.second_bar_code},
        ${COLS.code_type},
        ${COLS.price_id}
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
      `,
      [product_code, product_unit_id, second_bar_code, code_type, price_id]
    );
    return mapRow(row);
  } catch (err) {
    if (uniqueViolation(err)) {
      const e = new Error(
        `Já existe o segundo código de barras "${second_bar_code}" para o produto ${product_code} na unidade ${product_unit_id}.`
      );
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function upsertSecondBarCode(payload = {}) {
  const errors = [];
  if (!notEmptyStr(payload?.product_code)) {
    errors.push('O campo "product_code" é obrigatório.');
  }
  if (
    payload?.product_unit_id === undefined ||
    payload.product_unit_id === null ||
    payload.product_unit_id === ''
  ) {
    errors.push('O campo "product_unit_id" é obrigatório.');
  }
  if (!notEmptyStr(payload?.second_bar_code)) {
    errors.push('O campo "second_bar_code" é obrigatório.');
  }
  if (errors.length) {
    const e = new Error('ValidationError');
    e.status = 400;
    e.details = errors;
    throw e;
  }

  const product_code    = String(payload.product_code).trim();
  const product_unit_id = Number(payload.product_unit_id);
  const second_bar_code = String(payload.second_bar_code).trim();
  const code_type = notEmptyStr(payload?.code_type)
    ? String(payload.code_type).trim()
    : 'EAN-13';

  const rawPriceId = payload.price_id;
  let price_id =
    rawPriceId === undefined || rawPriceId === null || rawPriceId === ''
      ? DEFAULT_PRICE_ID
      : Number(rawPriceId);
  if (Number.isNaN(price_id)) price_id = DEFAULT_PRICE_ID;

  const { rows: [row] } = await pool.query(
    `
    INSERT INTO public.${TB} (
      ${COLS.product_code},
      ${COLS.product_unit_id},
      ${COLS.second_bar_code},
      ${COLS.code_type},
      ${COLS.price_id}
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (${COLS.product_code}, ${COLS.product_unit_id}, ${COLS.second_bar_code})
    DO UPDATE SET
      ${COLS.code_type}  = EXCLUDED.${COLS.code_type},
      ${COLS.price_id}   = EXCLUDED.${COLS.price_id},
      ${COLS.updated_at} = NOW()
    RETURNING *;
    `,
    [product_code, product_unit_id, second_bar_code, code_type, price_id]
  );

  return mapRow(row);
}

// ──────────────────────────────────────────────────────────────────────────────
// Update / Delete
// ──────────────────────────────────────────────────────────────────────────────
export async function updateSecondBarCode(id, patch = {}) {
  const sets = [];
  const values = [];
  let i = 1;

  if (patch.product_code !== undefined) {
    if (!notEmptyStr(patch.product_code)) {
      const e = new Error('O campo "product_code" não pode ser vazio.');
      e.status = 400;
      throw e;
    }
    sets.push(`${COLS.product_code} = $${i++}`);
    values.push(String(patch.product_code).trim());
  }

  if (patch.product_unit_id !== undefined) {
    if (
      patch.product_unit_id === null ||
      patch.product_unit_id === '' ||
      Number.isNaN(Number(patch.product_unit_id))
    ) {
      const e = new Error('O campo "product_unit_id" deve ser numérico e obrigatório.');
      e.status = 400;
      throw e;
    }
    sets.push(`${COLS.product_unit_id} = $${i++}`);
    values.push(Number(patch.product_unit_id));
  }

  if (patch.second_bar_code !== undefined) {
    if (!notEmptyStr(patch.second_bar_code)) {
      const e = new Error('O campo "second_bar_code" não pode ser vazio.');
      e.status = 400;
      throw e;
    }
    sets.push(`${COLS.second_bar_code} = $${i++}`);
    values.push(String(patch.second_bar_code).trim());
  }

  if (patch.code_type !== undefined) {
    sets.push(`${COLS.code_type} = $${i++}`);
    values.push(
      notEmptyStr(patch.code_type) ? String(patch.code_type).trim() : null
    );
  }

  if (patch.price_id !== undefined) {
    if (patch.price_id === null || patch.price_id === '' || Number.isNaN(Number(patch.price_id))) {
      const e = new Error('O campo "price_id" deve ser numérico e não pode ser vazio.');
      e.status = 400;
      throw e;
    }
    sets.push(`${COLS.price_id} = $${i++}`);
    values.push(Number(patch.price_id));
  }

  if (!sets.length) {
    const e = new Error('Nada para atualizar.');
    e.status = 400;
    throw e;
  }

  const sql = `
    UPDATE public.${TB}
       SET ${sets.join(', ')}, ${COLS.updated_at} = NOW()
     WHERE ${COLS.id} = $${i}
    RETURNING *;
  `;
  values.push(id);

  try {
    const { rows: [row] } = await pool.query(sql, values);
    return mapRow(row);
  } catch (err) {
    if (uniqueViolation(err)) {
      const e = new Error(
        'Já existe outro registro com essa combinação (product_code, product_unit_id, second_bar_code).'
      );
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function deleteSecondBarCode(id) {
  const res = await pool.query(
    `DELETE FROM public.${TB} WHERE ${COLS.id} = $1`,
    [id]
  );
  return res.rowCount > 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Export default agrupado
// ──────────────────────────────────────────────────────────────────────────────
const ProductBarCodeSecondAPI = Object.freeze({
  ensureTable: ensureProductBarCodeSecondTable,
  list:        listSecondBarCodes,
  getById:     getSecondBarCodeById,
  findBySecondBarCode,
  create:      createSecondBarCode,
  upsert:      upsertSecondBarCode,
  update:      updateSecondBarCode,
  remove:      deleteSecondBarCode,
});

export default ProductBarCodeSecondAPI;
