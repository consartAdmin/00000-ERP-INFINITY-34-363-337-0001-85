// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ productsUnitsApi.js — API de Unidades por Produto (CONSART ERP | ESM)     ║
// ║ Path: backend/services/apis/productsUnitsApi.js                           ║
// ║ Tabela principal: public."productsUnits"                                  ║
// ║ Lookup unidades: public.units (unit_id, unit, description)                ║
// ║ Tabela barcodes: public."productsBarCode"                                 ║
// ║ ✅ PADRÃO API: product_code (compat: product_id / productId / sku)        ║
// ║ ✅ LIST/GET: retorna barcode ativo via JOIN LATERAL (productsBarCode)     ║
// ║ ✅ create/upsert/update: grava barcode na productsBarCode (fonte oficial) ║
// ║ ✅ fallback: usa productsUnits.barcode se existir                          ║
// ║ ✅ getByBarcode: resolve via productsBarCode (principal)                  ║
// ║ ✅ FIX: productsBarCode exige product_code NOT NULL (preenche automático) ║
// ║ ✅ FIX: aceita product_id numérico (id interno) e resolve p/ product_code ║
// ║ ✅ UPDATE: description preferencialmente da tabela units (quando existir) ║
// ║ ⚙️ Compatível com instalações que não possuem coluna barcode em pu        ║
// ╚════════════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

/* ──────────────────────────────────────────────────────────────────────────────
   Cache de schema (evita bater no catálogo toda hora)
───────────────────────────────────────────────────────────────────────────── */
let HAS_BARCODE_COLUMN = null;

let HAS_PBC_PRODUCT_CODE = null;
let HAS_PBC_BARCODE_ID = null;

let HAS_PRODUCTS_ID_COL = null;
let HAS_PRODUCTS_PRODUCT_ID_COL = null;

let PU_HAS_PRODUCT_ID = null;
let PU_HAS_PRODUCT_CODE = null;
let PU_PRODUCT_COL = null; // 'product_id' ou 'product_code'

/* ──────────────────────────────────────────────────────────────────────────────
   Constantes
───────────────────────────────────────────────────────────────────────────── */
const TB = '"productsUnits"';
const UNITS_TB = 'units';
const PBC_TB = '"productsBarCode"';

/** Colunas "fixas" da productsUnits (as de SKU variam) */
const COLS = Object.freeze({
  id:          'product_unit_id',
  unit_id:     'unit_id',
  unit:        'unit',
  fator:       'fator',
  description: 'description',
  barcode:     'barcode',
  standard:    'standard',
  created_at:  'created_at',
  updated_at:  'updated_at',
  is_active:   'is_active',
});

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers base
───────────────────────────────────────────────────────────────────────────── */
const notEmptyStr = (s) => typeof s === 'string' && s.trim().length > 0;
const toNumber = (v, def = null) => (v === undefined || v === null || v === '' ? def : Number(v));
const uniqueViolation = (err) => err && err.code === '23505';

const normBarcode = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  const digits = s.replace(/\D+/g, '');
  return digits || null;
};

function pickProductCode(obj = {}) {
  const v = obj.product_code ?? obj.product_id ?? obj.productId ?? obj.sku;
  if (!notEmptyStr(v)) return null;
  return String(v).trim();
}

function pickProductCodeFromParams(params = {}) {
  const v =
    params.product_code ??
    params.product_id ??
    params.productId ??
    params.sku;

  return notEmptyStr(v) ? String(v).trim() : null;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Catálogo: products(id/product_id) (pra resolver numérico → product_code)
───────────────────────────────────────────────────────────────────────────── */
async function checkProductsIdColumns() {
  if (HAS_PRODUCTS_ID_COL !== null && HAS_PRODUCTS_PRODUCT_ID_COL !== null) {
    return { hasId: HAS_PRODUCTS_ID_COL, hasProductId: HAS_PRODUCTS_PRODUCT_ID_COL };
  }

  const { rows } = await pool.query(`
    SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'products'
       AND a.attnum > 0
       AND NOT a.attisdropped;
  `);

  const cols = new Set(rows.map(r => String(r.attname)));
  HAS_PRODUCTS_ID_COL = cols.has('id');
  HAS_PRODUCTS_PRODUCT_ID_COL = cols.has('product_id');

  return { hasId: HAS_PRODUCTS_ID_COL, hasProductId: HAS_PRODUCTS_PRODUCT_ID_COL };
}

/* ──────────────────────────────────────────────────────────────────────────────
   Catálogo: productsUnits(product_id vs product_code)
───────────────────────────────────────────────────────────────────────────── */
async function checkProductsUnitsProductColumn() {
  if (PU_PRODUCT_COL) return PU_PRODUCT_COL;

  const { rows } = await pool.query(`
    SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'productsUnits'
       AND a.attnum > 0
       AND NOT a.attisdropped;
  `);

  const cols = new Set(rows.map(r => String(r.attname)));

  PU_HAS_PRODUCT_ID = cols.has('product_id');
  PU_HAS_PRODUCT_CODE = cols.has('product_code');

  if (!PU_HAS_PRODUCT_CODE && !PU_HAS_PRODUCT_ID) {
    const e = new Error('Schema inválido: public."productsUnits" não possui coluna product_code nem product_id.');
    e.status = 500;
    throw e;
  }

  // Preferência: se existe product_code, usa ela. Senão usa product_id.
  PU_PRODUCT_COL = PU_HAS_PRODUCT_CODE ? 'product_code' : 'product_id';

  return PU_PRODUCT_COL;
}

async function getPuProductCol() {
  return await checkProductsUnitsProductColumn();
}

async function checkBarcodeColumn() {
  if (HAS_BARCODE_COLUMN !== null) return HAS_BARCODE_COLUMN;

  const { rows } = await pool.query(`
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'productsUnits'
       AND a.attname = 'barcode'
       AND a.attnum > 0
       AND NOT a.attisdropped
     LIMIT 1;
  `);

  HAS_BARCODE_COLUMN = rows.length > 0;
  return HAS_BARCODE_COLUMN;
}

async function checkPbcColumns() {
  if (HAS_PBC_PRODUCT_CODE !== null && HAS_PBC_BARCODE_ID !== null) {
    return { hasProductCode: HAS_PBC_PRODUCT_CODE, hasBarcodeId: HAS_PBC_BARCODE_ID };
  }

  const { rows } = await pool.query(`
    SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'productsBarCode'
       AND a.attnum > 0
       AND NOT a.attisdropped;
  `);

  const cols = new Set(rows.map(r => String(r.attname)));
  HAS_PBC_PRODUCT_CODE = cols.has('product_code');
  HAS_PBC_BARCODE_ID = cols.has('barcode_id');

  return { hasProductCode: HAS_PBC_PRODUCT_CODE, hasBarcodeId: HAS_PBC_BARCODE_ID };
}

/* ──────────────────────────────────────────────────────────────────────────────
   ORDER / mapRow
───────────────────────────────────────────────────────────────────────────── */
function sanitizeOrder(orderBy, dir, puProductCol) {
  const ORDERABLE = new Set([
    COLS.id, puProductCol, COLS.unit, COLS.fator,
    COLS.standard, COLS.created_at, COLS.updated_at,
  ]);

  const safeCol = ORDERABLE.has(orderBy) ? orderBy : COLS.unit;
  const safeDir = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return { orderBy: safeCol, dir: safeDir };
}

function mapRow(r) {
  if (!r) return null;
  return {
    product_unit_id: r.product_unit_id,
    product_code:    r.product_code, // sempre padronizado no SELECT
    unit_id:         r.unit_id,
    unit:            r.unit,
    fator:           r.fator,
    description:     r.description,
    barcode:         r.barcode ?? null,
    standard:        r.standard,
    is_active:       r.is_active,
    created_at:      r.created_at,
    updated_at:      r.updated_at,
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
   Resolver SKU por ID numérico
───────────────────────────────────────────────────────────────────────────── */
async function resolveProductCodeForBarcode(client, product_id) {
  const raw = String(product_id ?? '').trim();
  if (!raw) return null;

  const digits = raw.replace(/\D+/g, '');
  const asInt = digits ? Number(digits) : NaN;
  const isInt = Number.isFinite(asInt) && asInt > 0;

  const { hasId, hasProductId } = await checkProductsIdColumns();

  const byIdWhere = [];
  if (isInt && hasId) byIdWhere.push(`p.id = $1::bigint`);
  if (isInt && hasProductId) byIdWhere.push(`p.product_id = $1::bigint`);
  const byIdWhereSql = byIdWhere.length ? `(${byIdWhere.join(' OR ')}) OR` : '';

  const byIdOrder = [];
  if (isInt && hasId) byIdOrder.push(`WHEN p.id = $1::bigint THEN 1`);
  if (isInt && hasProductId) byIdOrder.push(`WHEN p.product_id = $1::bigint THEN 2`);
  const byIdOrderSql = byIdOrder.length ? byIdOrder.join('\n         ') + '\n         ' : '';

  // ✅ FIX: 3 params / 3 placeholders
  const params = [
    isInt ? asInt : 0, // $1
    raw,               // $2
    digits || null,    // $3
  ];

  const { rows } = await client.query(
    `
    SELECT p.product_code
      FROM public.products p
     WHERE
       ${byIdWhereSql}
       p.product_code = $2
       OR p.product_code = LPAD($2, 6, '0')
       OR p.product_code = LPAD($2, 7, '0')
       OR p.product_code = LPAD($2, 8, '0')
       OR p.product_code = LPAD($2, 9, '0')
       OR p.product_code = LPAD($2, 10, '0')
       OR p.product_code = LPAD($2, 12, '0')
       OR regexp_replace(p.product_code, '\\D+', '', 'g') = $3
     ORDER BY
       CASE
         ${byIdOrderSql}
         WHEN p.product_code = $2 THEN 10
         WHEN p.product_code = LPAD($2, 8, '0') THEN 11
         WHEN p.product_code = LPAD($2, 10, '0') THEN 12
         WHEN regexp_replace(p.product_code, '\\D+', '', 'g') = $3 THEN 20
         ELSE 99
       END
     LIMIT 1;
    `,
    params
  );

  return rows[0]?.product_code ? String(rows[0].product_code).trim() : null;
}

async function resolveIncomingProductCodeMaybeId(rawCode) {
  if (!notEmptyStr(rawCode)) return rawCode;

  const raw = String(rawCode).trim();
  const digits = raw.replace(/\D+/g, '');
  const isPureDigits = !!digits && digits.length === raw.length;

  if (!isPureDigits) return raw;

  const asInt = Number(digits);
  if (!Number.isFinite(asInt) || asInt <= 0) return raw;

  const client = await pool.connect();
  try {
    const resolved = await resolveProductCodeForBarcode(client, raw);
    return resolved || raw;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Resolver unit_id pela sigla
───────────────────────────────────────────────────────────────────────────── */
async function resolveUnitId(sigla) {
  if (!notEmptyStr(sigla)) return null;
  const s = sigla.trim().toUpperCase();

  const withDot = s.endsWith('.') ? s : `${s}.`;
  const withoutDot = s.endsWith('.') ? s.slice(0, -1) : s;

  const { rows } = await pool.query(
    `
      SELECT unit_id
        FROM public.${UNITS_TB}
       WHERE UPPER(unit) IN ($1, $2)
          OR UPPER(description) IN ($1, $2)
       LIMIT 1;
    `,
    [withDot, withoutDot]
  );

  return rows[0]?.unit_id ?? null;
}

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers: barcode via productsBarCode + fallback productsUnits.barcode
───────────────────────────────────────────────────────────────────────────── */
async function buildBarcodeSelect() {
  const hasBarcode = await checkBarcodeColumn();
  return hasBarcode
    ? `COALESCE(pbc.barcode, pu.${COLS.barcode}) AS barcode`
    : `pbc.barcode AS barcode`;
}

function buildDescriptionSelect() {
  return `COALESCE(NULLIF(u.description, ''), pu.${COLS.description}) AS description`;
}

async function setActiveBarcode(client, product_unit_id, barcode, opts = {}) {
  const bc = normBarcode(barcode);
  if (!product_unit_id) return;

  await client.query(
    `UPDATE public.${PBC_TB}
        SET is_active = FALSE,
            updated_at = NOW()
      WHERE product_unit_id = $1
        AND is_active IS TRUE`,
    [product_unit_id]
  );

  if (!bc) return;

  let product_code = opts?.product_code ? String(opts.product_code).trim() : null;
  if (!product_code) {
    const puProductCol = await getPuProductCol();
    const { rows } = await client.query(
      `SELECT pu.${puProductCol} AS product_code
         FROM public.${TB} pu
        WHERE pu.${COLS.id} = $1
        LIMIT 1`,
      [product_unit_id]
    );
    const sku = rows[0]?.product_code ? String(rows[0].product_code).trim() : null;
    if (sku) product_code = await resolveProductCodeForBarcode(client, sku);
  }

  // fallback: se não resolver product_code, grava no barcode legado (se existir)
  if (!product_code) {
    const hasBarcodeCol = await checkBarcodeColumn();
    if (hasBarcodeCol) {
      await client.query(
        `UPDATE public.${TB}
            SET ${COLS.barcode} = $2,
                ${COLS.updated_at} = NOW()
          WHERE ${COLS.id} = $1`,
        [product_unit_id, bc]
      );
    }
    return;
  }

  const { rowCount } = await client.query(
    `UPDATE public.${PBC_TB}
        SET is_active = TRUE,
            updated_at = NOW()
      WHERE product_unit_id = $1
        AND barcode = $2`,
    [product_unit_id, bc]
  );
  if (rowCount > 0) return;

  const existing = await client.query(
    `SELECT barcode_id
       FROM public.${PBC_TB}
      WHERE barcode = $1
      LIMIT 1`,
    [bc]
  );

  if (existing.rows.length) {
    await client.query(
      `UPDATE public.${PBC_TB}
          SET product_code = $1,
              product_unit_id = $2,
              is_active = TRUE,
              updated_at = NOW()
        WHERE barcode_id = $3`,
      [product_code, product_unit_id, existing.rows[0].barcode_id]
    );
    return;
  }

  await client.query(
    `INSERT INTO public.${PBC_TB}
       (product_code, product_unit_id, barcode, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW(), NOW())`,
    [product_code, product_unit_id, bc]
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Ensure (não destrói seu schema existente)
───────────────────────────────────────────────────────────────────────────── */
export async function ensureProductsUnitsTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cria tabela se não existir.
    // ✅ Melhorado: já cria com product_code (padrão), mantendo product_id legado também.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${TB} (
        ${COLS.id}          BIGSERIAL PRIMARY KEY,
        product_code        VARCHAR(50)   NULL,
        product_id          VARCHAR(50)   NULL,
        ${COLS.unit_id}     INTEGER       NULL REFERENCES public.${UNITS_TB}(unit_id) ON DELETE SET NULL,
        ${COLS.unit}        VARCHAR(50)   NOT NULL,
        ${COLS.fator}       NUMERIC(10,3) DEFAULT 1,
        ${COLS.description} VARCHAR(100),
        ${COLS.barcode}     VARCHAR(50),
        ${COLS.standard}    BOOLEAN       DEFAULT FALSE,
        ${COLS.created_at}  TIMESTAMP     DEFAULT NOW(),
        ${COLS.updated_at}  TIMESTAMP     DEFAULT NOW(),
        ${COLS.is_active}   BOOLEAN       DEFAULT TRUE
      );
    `);

    // Garante colunas neutras
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.unit_id}     INTEGER NULL;`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.description} VARCHAR(100);`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.barcode}     VARCHAR(50);`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.standard}   BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.created_at} TIMESTAMP DEFAULT NOW();`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.updated_at} TIMESTAMP DEFAULT NOW();`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.is_active}  BOOLEAN DEFAULT TRUE;`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS ${COLS.fator}      NUMERIC(10,3) DEFAULT 1;`);

    // ✅ Compat: se existir product_id mas não existir product_code, cria product_code e tenta popular
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS product_code VARCHAR(50) NULL;`);
    await client.query(`ALTER TABLE public.${TB} ADD COLUMN IF NOT EXISTS product_id   VARCHAR(50) NULL;`);

    // Se product_code estiver NULL e product_id tiver valor, copia (não quebra legado)
    await client.query(`
      UPDATE public.${TB}
         SET product_code = COALESCE(product_code, product_id)
       WHERE product_code IS NULL
         AND product_id IS NOT NULL;
    `);

    // normalize unit
    await client.query(`
      UPDATE public.${TB}
         SET ${COLS.unit} = UPPER(BTRIM(${COLS.unit}))
       WHERE ${COLS.unit} IS NOT NULL
         AND ${COLS.unit} <> UPPER(BTRIM(${COLS.unit}));
    `);

    // normalize barcode legado (se existir)
    await client.query(`
      UPDATE public.${TB}
         SET ${COLS.barcode} = NULLIF(regexp_replace(COALESCE(${COLS.barcode}, ''), '\\D+', '', 'g'), '')
       WHERE ${COLS.barcode} IS NOT NULL;
    `);

    // trigger updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION public.productsunits_set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.${COLS.updated_at} = NOW();
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'productsunits_set_updated_at_trg') THEN
          CREATE TRIGGER productsunits_set_updated_at_trg
          BEFORE UPDATE ON public.${TB}
          FOR EACH ROW
          EXECUTE PROCEDURE public.productsunits_set_updated_at();
        END IF;
      END $$;
    `);

    // trigger normalize unit/barcode
    await client.query(`
      CREATE OR REPLACE FUNCTION public.productsunits_normalize()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.${COLS.unit} IS NOT NULL THEN
          NEW.${COLS.unit} := UPPER(BTRIM(NEW.${COLS.unit}));
        END IF;

        IF NEW.${COLS.barcode} IS NOT NULL THEN
          NEW.${COLS.barcode} := NULLIF(regexp_replace(NEW.${COLS.barcode}, '\\D+', '', 'g'), '');
        END IF;

        RETURN NEW;
      END; $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS productsunits_normalize_trg ON public.${TB};
      CREATE TRIGGER productsunits_normalize_trg
      BEFORE INSERT OR UPDATE ON public.${TB}
      FOR EACH ROW
      EXECUTE PROCEDURE public.productsunits_normalize();
    `);

    await client.query('COMMIT');

    // reset caches
    HAS_BARCODE_COLUMN = null;
    HAS_PBC_PRODUCT_CODE = null;
    HAS_PBC_BARCODE_ID = null;
    PU_PRODUCT_COL = null;
    PU_HAS_PRODUCT_ID = null;
    PU_HAS_PRODUCT_CODE = null;

    await checkBarcodeColumn();
    await checkPbcColumns();
    await checkProductsUnitsProductColumn();

    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   LIST / GET
───────────────────────────────────────────────────────────────────────────── */
export async function listProductsUnits(params = {}) {
  const {
    q,

    // ✅ filtros de produto (padrão + compat)
    product_code, // padrão
    product_id,   // compat
    productId,    // compat
    sku,          // compat

    unit_id,
    standard,
    include_inactive = false,
    limit = 50,
    offset = 0,
    orderBy,
    dir = 'ASC',
  } = params;

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  // ✅ aceita qualquer alias: product_code / product_id / productId / sku
  let code = pickProductCodeFromParams({ product_code, product_id, productId, sku });
  if (notEmptyStr(code)) code = await resolveIncomingProductCodeMaybeId(code);

  const puProductCol = await getPuProductCol();
  const { orderBy: ob, dir: od } = sanitizeOrder(orderBy || COLS.unit, dir, puProductCol);

  const where = [];
  const values = [];
  let i = 1;

  if (!include_inactive) where.push(`pu.${COLS.is_active} IS DISTINCT FROM FALSE`);

  if (notEmptyStr(q)) {
    where.push(`LOWER(pu.${COLS.unit}) LIKE LOWER($${i++})`);
    values.push(`%${q.trim()}%`);
  }

  if (notEmptyStr(code)) {
    where.push(`pu.${puProductCol} = $${i++}`);
    values.push(code);
  }

  if (unit_id !== undefined && unit_id !== null && unit_id !== '') {
    const uid = Number(unit_id);
    if (!Number.isFinite(uid)) {
      const e = new Error('O campo "unit_id" deve ser numérico.');
      e.status = 400;
      throw e;
    }
    where.push(`pu.${COLS.unit_id} = $${i++}`);
    values.push(uid);
  }

  if (standard === true || standard === 'true' || standard === false || standard === 'false') {
    where.push(`pu.${COLS.standard} = $${i++}`);
    values.push(standard === true || standard === 'true');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const barcodeSelect = await buildBarcodeSelect();
  const descriptionSelect = buildDescriptionSelect();

  const { hasBarcodeId } = await checkPbcColumns();
  const pbcOrder = hasBarcodeId ? `b.updated_at DESC, b.barcode_id DESC` : `b.updated_at DESC`;

  const sql = `
    SELECT
      pu.${COLS.id}                         AS product_unit_id,
      pu.${puProductCol}                    AS product_code,
      pu.${COLS.unit_id}                    AS unit_id,
      pu.${COLS.unit}                       AS unit,
      pu.${COLS.fator}                      AS fator,
      ${descriptionSelect},
      ${barcodeSelect},
      pu.${COLS.standard}                   AS standard,
      pu.${COLS.is_active}                  AS is_active,
      pu.${COLS.created_at}                 AS created_at,
      pu.${COLS.updated_at}                 AS updated_at
    FROM public.${TB} pu
    LEFT JOIN public.${UNITS_TB} u
      ON u.unit_id = pu.${COLS.unit_id}
    LEFT JOIN LATERAL (
      SELECT b.barcode
      FROM public.${PBC_TB} b
      WHERE b.product_unit_id = pu.${COLS.id}
        AND COALESCE(b.is_active, TRUE) IS TRUE
      ORDER BY ${pbcOrder}
      LIMIT 1
    ) pbc ON TRUE
    ${whereSql}
    ORDER BY pu.${ob} ${od}
    LIMIT $${i++} OFFSET $${i++};
  `;

  values.push(safeLimit, safeOffset);

  const countSql = `
    SELECT COUNT(*)::INT AS total
    FROM public.${TB} pu
    ${whereSql};
  `;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, values),
    pool.query(countSql, values.slice(0, values.length - 2)),
  ]);

  return {
    rows: rowsRes.rows.map(mapRow),
    total: countRes.rows[0]?.total ?? 0,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getProductsUnitById(id) {
  const puProductCol = await getPuProductCol();
  const barcodeSelect = await buildBarcodeSelect();
  const descriptionSelect = buildDescriptionSelect();

  const { hasBarcodeId } = await checkPbcColumns();
  const pbcOrder = hasBarcodeId ? `b.updated_at DESC, b.barcode_id DESC` : `b.updated_at DESC`;

  const { rows } = await pool.query(
    `
      SELECT
        pu.${COLS.id}        AS product_unit_id,
        pu.${puProductCol}   AS product_code,
        pu.${COLS.unit_id}   AS unit_id,
        pu.${COLS.unit}      AS unit,
        pu.${COLS.fator}     AS fator,
        ${descriptionSelect},
        ${barcodeSelect},
        pu.${COLS.standard}  AS standard,
        pu.${COLS.is_active} AS is_active,
        pu.${COLS.created_at} AS created_at,
        pu.${COLS.updated_at} AS updated_at
      FROM public.${TB} pu
      LEFT JOIN public.${UNITS_TB} u
        ON u.unit_id = pu.${COLS.unit_id}
      LEFT JOIN LATERAL (
        SELECT b.barcode
        FROM public.${PBC_TB} b
        WHERE b.product_unit_id = pu.${COLS.id}
          AND COALESCE(b.is_active, TRUE) IS TRUE
        ORDER BY ${pbcOrder}
        LIMIT 1
      ) pbc ON TRUE
      WHERE pu.${COLS.id} = $1
      LIMIT 1;
    `,
    [id]
  );

  return mapRow(rows[0]);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Create / Upsert
───────────────────────────────────────────────────────────────────────────── */
export async function createProductsUnit(payload = {}) {
  const hasBarcodeCol = await checkBarcodeColumn();
  const puProductCol = await getPuProductCol();

  const errors = [];
  let product_code = pickProductCode(payload);
  if (product_code) product_code = await resolveIncomingProductCodeMaybeId(product_code);
  if (!product_code) errors.push('O campo "product_code" é obrigatório (aceita product_id como legado).');

  if (!notEmptyStr(payload?.unit)) errors.push('O campo "unit" é obrigatório.');
  else if (payload.unit.trim().length > 50) errors.push('O campo "unit" deve ter no máximo 50 caracteres.');

  const fator = toNumber(payload?.fator, 1);
  if (fator !== null && (Number.isNaN(fator) || fator <= 0)) errors.push('O campo "fator" deve ser numérico > 0.');

  const barcode = normBarcode(payload?.barcode);
  if (barcode !== null && barcode !== undefined && String(barcode).length > 50) {
    errors.push('O campo "barcode" deve ter no máximo 50 caracteres.');
  }

  if (errors.length) {
    const e = new Error('ValidationError');
    e.status = 400;
    e.details = errors;
    throw e;
  }

  let unit_id =
    payload?.unit_id !== undefined && payload.unit_id !== null && payload.unit_id !== ''
      ? Number(payload.unit_id)
      : null;

  const unit = String(payload.unit).trim().toUpperCase();
  const description = payload?.description ?? null;
  const standard = payload?.standard === undefined ? false : !!payload.standard;

  if (unit_id == null) unit_id = await resolveUnitId(unit);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (standard === true) {
      await client.query(
        `
          UPDATE public.${TB}
             SET ${COLS.standard} = FALSE, ${COLS.updated_at} = NOW()
           WHERE ${puProductCol} = $1
             AND ${COLS.standard} IS TRUE
        `,
        [product_code]
      );
    }

    const cols = [puProductCol, COLS.unit_id, COLS.unit, COLS.fator, COLS.description, COLS.standard, COLS.is_active];
    const args = [product_code, unit_id, unit, fator ?? 1, description, standard];
    const vals = ['$1', '$2', '$3', '$4', '$5', '$6', 'TRUE'];

    if (hasBarcodeCol) {
      cols.splice(5, 0, COLS.barcode);
      vals.splice(5, 0, '$6');
      vals[vals.length - 2] = '$7';
      args.splice(5, 0, barcode ?? null);
    }

    const { rows: [row] } = await client.query(
      `
        INSERT INTO public.${TB} (${cols.join(', ')})
        VALUES (${vals.join(', ')})
        RETURNING ${COLS.id} AS product_unit_id;
      `,
      args
    );

    if (payload?.barcode !== undefined) {
      await setActiveBarcode(client, row.product_unit_id, payload.barcode, { product_code });
    }

    await client.query('COMMIT');
    return await getProductsUnitById(row.product_unit_id);
  } catch (err) {
    await client.query('ROLLBACK');
    if (uniqueViolation(err)) {
      const e = new Error(`Já existe a unidade "${String(payload.unit).trim().toUpperCase()}" para o produto ${product_code}.`);
      e.status = 409;
      throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertProductsUnit(payload = {}) {
  const hasBarcodeCol = await checkBarcodeColumn();
  const puProductCol = await getPuProductCol();

  // product_code (padrão) + compat (product_id/productId/sku)
  let product_code = pickProductCode(payload);
  if (product_code) product_code = await resolveIncomingProductCodeMaybeId(product_code);

  if (!product_code) {
    const e = new Error('O campo "product_code" é obrigatório (aceita product_id como legado).');
    e.status = 400;
    throw e;
  }

  if (!notEmptyStr(payload?.unit)) {
    const e = new Error('O campo "unit" é obrigatório.');
    e.status = 400;
    throw e;
  }

  // unit_id pode vir do front ou ser resolvido pela sigla
  let unit_id =
    payload?.unit_id !== undefined && payload.unit_id !== null && payload.unit_id !== ''
      ? Number(payload.unit_id)
      : null;

  // Normaliza unit (opcionalmente remove ponto final pra evitar "UN" vs "UN.")
  let unit = String(payload.unit).trim().toUpperCase();
  unit = unit.replace(/\s+/g, ' ');
  if (unit.endsWith('.')) unit = unit.slice(0, -1); // <- evita duplicidade por ponto

  const fator = toNumber(payload?.fator, 1);
  if (fator !== null && (Number.isNaN(fator) || fator <= 0)) {
    const e = new Error('O campo "fator" deve ser numérico > 0.');
    e.status = 400;
    throw e;
  }

  const description = payload?.description ?? null;
  const barcode = normBarcode(payload?.barcode);
  const standard = payload?.standard === undefined ? false : !!payload.standard;

  if (unit_id == null) unit_id = await resolveUnitId(unit);

  if (unit_id == null) {
    const e = new Error(`Não foi possível resolver unit_id para a unidade "${unit}". Cadastre/valide na tabela units.`);
    e.status = 400;
    throw e;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Se marcou "standard", desmarca as outras do mesmo produto
    if (standard === true) {
      await client.query(
        `
          UPDATE public.${TB}
             SET ${COLS.standard} = FALSE,
                 ${COLS.updated_at} = NOW()
           WHERE ${puProductCol} = $1
             AND ${COLS.standard} IS TRUE
        `,
        [product_code]
      );
    }

    // INSERT dinâmico (com/sem barcode)
    const insertCols = [puProductCol, COLS.unit_id, COLS.unit, COLS.fator, COLS.description, COLS.standard, COLS.is_active];
    const insertVals = ['$1', '$2', '$3', '$4', '$5', '$6', 'TRUE'];
    const args = [product_code, unit_id, unit, fator ?? 1, description, standard];

    const updates = [
      `${COLS.unit}        = EXCLUDED.${COLS.unit}`,
      `${COLS.fator}       = EXCLUDED.${COLS.fator}`,
      `${COLS.description} = EXCLUDED.${COLS.description}`,
      `${COLS.standard}    = EXCLUDED.${COLS.standard}`,
      `${COLS.is_active}   = TRUE`,
      `${COLS.updated_at}  = NOW()`,
    ];

    if (hasBarcodeCol) {
      // insere barcode antes do standard (mantendo teu padrão)
      insertCols.splice(5, 0, COLS.barcode);
      insertVals.splice(5, 0, '$6');
      insertVals[insertVals.length - 2] = '$7'; // ajusta placeholder do standard
      args.splice(5, 0, barcode ?? null);

      updates.splice(3, 0, `${COLS.barcode} = EXCLUDED.${COLS.barcode}`);
    }

    // ✅ O CONFLICT CORRETO NO TEU BANCO: (product_code, unit_id)
    // (não em unit)
    const conflictTarget = `(${puProductCol}, ${COLS.unit_id})`;

    const { rows: [row] } = await client.query(
      `
        INSERT INTO public.${TB} (${insertCols.join(', ')})
        VALUES (${insertVals.join(', ')})
        ON CONFLICT ${conflictTarget}
        DO UPDATE SET
          ${updates.join(', ')}
        RETURNING ${COLS.id} AS product_unit_id;
      `,
      args
    );

    // Se barcode veio no payload, sincroniza productsBarCode (fonte oficial)
    if (payload?.barcode !== undefined) {
      await setActiveBarcode(client, row.product_unit_id, payload.barcode, { product_code });
    }

    await client.query('COMMIT');
    return await getProductsUnitById(row.product_unit_id);
  } catch (err) {
    await client.query('ROLLBACK');

    // Mantém 23505 legível (quando existir outra constraint além da esperada)
    if (uniqueViolation(err)) {
      const e = new Error('Conflito de unicidade ao salvar unidade (verifique constraints/duplicidades).');
      e.status = 409;
      e.original = err;
      throw e;
    }

    throw err;
  } finally {
    client.release();
  }
}


/* ──────────────────────────────────────────────────────────────────────────────
   Update / Deactivate / Delete
───────────────────────────────────────────────────────────────────────────── */
export async function updateProductsUnit(id, patch = {}) {
  const hasBarcodeCol = await checkBarcodeColumn();
  const puProductCol = await getPuProductCol();

  const sets = [];
  const values = [];
  let i = 1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let productCodeForClear = null;
    let patchCode = pickProductCode(patch);
    if (patchCode) patchCode = await resolveIncomingProductCodeMaybeId(patchCode);

    if (patchCode !== null && patchCode !== undefined) {
      productCodeForClear = patchCode;
      sets.push(`${puProductCol} = $${i++}`);
      values.push(productCodeForClear);
    }

    if (patch.unit_id !== undefined) {
      const v = (patch.unit_id === null || patch.unit_id === '') ? null : Number(patch.unit_id);
      if (v !== null && !Number.isFinite(v)) {
        const e = new Error('O campo "unit_id" deve ser numérico.');
        e.status = 400;
        throw e;
      }
      sets.push(`${COLS.unit_id} = $${i++}`);
      values.push(v);
    }

    if (patch.unit !== undefined) {
      if (!notEmptyStr(patch.unit)) { const e = new Error('O campo "unit" não pode ser vazio.'); e.status = 400; throw e; }
      sets.push(`${COLS.unit} = UPPER(BTRIM($${i++}))`);
      values.push(patch.unit);
    }

    if (patch.fator !== undefined) {
      const f = toNumber(patch.fator, null);
      if (f !== null && (Number.isNaN(f) || f <= 0)) { const e = new Error('O campo "fator" deve ser numérico > 0.'); e.status = 400; throw e; }
      sets.push(`${COLS.fator} = $${i++}`);
      values.push(f);
    }

    if (patch.description !== undefined) {
      sets.push(`${COLS.description} = $${i++}`);
      values.push(patch.description ?? null);
    }

    if (patch.is_active !== undefined) {
      sets.push(`${COLS.is_active} = $${i++}`);
      values.push(!!patch.is_active);
    }

    let barcodeToSet = undefined;
    if (patch.barcode !== undefined) {
      barcodeToSet = patch.barcode;
      if (hasBarcodeCol) {
        const bc = normBarcode(patch.barcode);
        sets.push(`${COLS.barcode} = $${i++}`);
        values.push(bc ?? null);
      }
    }

    let setStandard = null;
    if (patch.standard !== undefined) setStandard = !!patch.standard;

    if (setStandard === true && !productCodeForClear) {
      const { rows: current } = await client.query(
        `SELECT ${puProductCol} AS product_code FROM public.${TB} WHERE ${COLS.id} = $1`,
        [id]
      );
      productCodeForClear = current[0]?.product_code ? String(current[0].product_code).trim() : null;
    }

    if (setStandard === true && productCodeForClear) {
      await client.query(
        `
          UPDATE public.${TB}
             SET ${COLS.standard} = FALSE, ${COLS.updated_at} = NOW()
           WHERE ${puProductCol} = $1
             AND ${COLS.standard} IS TRUE
             AND ${COLS.id} <> $2
        `,
        [productCodeForClear, id]
      );
    }

    if (setStandard !== null) {
      sets.push(`${COLS.standard} = $${i++}`);
      values.push(setStandard);
    }

    if (!sets.length) { const e = new Error('Nada para atualizar.'); e.status = 400; throw e; }

    const sql = `
      UPDATE public.${TB}
         SET ${sets.join(', ')}, ${COLS.updated_at} = NOW()
       WHERE ${COLS.id} = $${i}
      RETURNING ${COLS.id} AS product_unit_id, ${puProductCol} AS product_code;
    `;
    values.push(id);

    const { rows: [row] } = await client.query(sql, values);

    if (patch.barcode !== undefined) {
      await setActiveBarcode(client, row.product_unit_id, barcodeToSet, { product_code: row.product_code });
    }

    if (patch.is_active === false) {
      await setActiveBarcode(client, row.product_unit_id, null, { product_code: row.product_code });
    }

    await client.query('COMMIT');
    return await getProductsUnitById(row.product_unit_id);
  } catch (err) {
    await client.query('ROLLBACK');
    if (uniqueViolation(err)) {
      const e = new Error('Já existe outra unidade com esse (product_code, unit).');
      e.status = 409;
      throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function deactivateProductsUnit(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [row] } = await client.query(
      `
        UPDATE public.${TB}
           SET ${COLS.is_active} = FALSE,
               ${COLS.standard}  = FALSE,
               ${COLS.updated_at} = NOW()
         WHERE ${COLS.id} = $1
        RETURNING ${COLS.id} AS product_unit_id;
      `,
      [id]
    );

    if (!row) {
      await client.query('COMMIT');
      return null;
    }

    await setActiveBarcode(client, row.product_unit_id, null, {});

    await client.query('COMMIT');
    return await getProductsUnitById(row.product_unit_id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteProductsUnit(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const puProductCol = await getPuProductCol();

    const { rows: curRows } = await client.query(
      `SELECT ${puProductCol} AS product_code, ${COLS.standard} AS standard
         FROM public.${TB}
        WHERE ${COLS.id} = $1
        LIMIT 1`,
      [id]
    );

    if (!curRows.length) {
      await client.query('COMMIT');
      return false;
    }

    const { product_code, standard } = curRows[0];

    await client.query(
      `UPDATE public.${PBC_TB}
          SET is_active = FALSE, updated_at = NOW()
        WHERE product_unit_id = $1`,
      [id]
    );

    await client.query(
      `UPDATE public.${TB}
          SET ${COLS.is_active} = FALSE,
              ${COLS.standard}  = FALSE,
              ${COLS.updated_at} = NOW()
        WHERE ${COLS.id} = $1`,
      [id]
    );

    if (standard === true && product_code) {
      await client.query(
        `
        WITH next_std AS (
          SELECT ${COLS.id} AS id
            FROM public.${TB}
           WHERE ${puProductCol} = $1
             AND ${COLS.is_active} IS DISTINCT FROM FALSE
           ORDER BY ${COLS.updated_at} DESC, ${COLS.id} DESC
           LIMIT 1
        )
        UPDATE public.${TB}
           SET ${COLS.standard} = TRUE,
               ${COLS.updated_at} = NOW()
          FROM next_std
         WHERE public.${TB}.${COLS.id} = next_std.id;
        `,
        [product_code]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
   Extras: factorsBySkus / getByBarcode / listByProduct
───────────────────────────────────────────────────────────────────────────── */
export async function factorsBySkus(skus = []) {
  const list = (Array.isArray(skus) ? skus : [])
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .slice(0, 500);

  if (!list.length) return [];

  const puProductCol = await getPuProductCol();

  const { rows } = await pool.query(
    `
      SELECT
        pu.${puProductCol} AS sku,
        UPPER(BTRIM(pu.${COLS.unit})) AS unit,
        COALESCE(pu.${COLS.fator}, 1)::numeric AS factor,
        COALESCE(pu.${COLS.standard}, FALSE) AS standard
      FROM public.${TB} pu
      WHERE pu.${puProductCol} = ANY($1::text[])
        AND pu.${COLS.is_active} IS DISTINCT FROM FALSE
      ORDER BY pu.${puProductCol}, COALESCE(pu.${COLS.standard}, FALSE) DESC, UPPER(BTRIM(pu.${COLS.unit})) ASC
    `,
    [list]
  );

  return rows.map(r => ({
    sku: String(r.sku || '').trim(),
    unit: String(r.unit || '').trim(),
    factor: Number(r.factor ?? 1) || 1,
    standard: !!r.standard,
  }));
}

export async function getFactorsMapBySkus(skus = []) {
  return await factorsBySkus(skus);
}

export async function getByBarcode(barcode, { product_code, product_id } = {}) {
  const bc = normBarcode(barcode);
  if (!bc) return null;

  let code = pickProductCodeFromParams({ product_code, product_id });
  if (notEmptyStr(code)) code = await resolveIncomingProductCodeMaybeId(code);

  const puProductCol = await getPuProductCol();
  const descriptionSelect = buildDescriptionSelect();

  const { hasBarcodeId } = await checkPbcColumns();
  const orderBarcodeId = hasBarcodeId ? `, b.barcode_id DESC` : ``;

  const values = [bc];
  let i = 2;

  let extra = '';
  if (notEmptyStr(code)) {
    extra = ` AND pu.${puProductCol} = $${i++}`;
    values.push(code);
  }

  const { rows } = await pool.query(
    `
      SELECT
        pu.${COLS.id}        AS product_unit_id,
        pu.${puProductCol}   AS product_code,
        pu.${COLS.unit_id}   AS unit_id,
        pu.${COLS.unit}      AS unit,
        pu.${COLS.fator}     AS fator,
        ${descriptionSelect},
        b.barcode            AS barcode,
        pu.${COLS.standard}  AS standard,
        pu.${COLS.is_active} AS is_active,
        pu.${COLS.created_at} AS created_at,
        pu.${COLS.updated_at} AS updated_at
      FROM public.${PBC_TB} b
      JOIN public.${TB} pu
        ON pu.${COLS.id} = b.product_unit_id
      LEFT JOIN public.${UNITS_TB} u
        ON u.unit_id = pu.${COLS.unit_id}
      WHERE b.barcode = $1
        AND COALESCE(b.is_active, TRUE) IS TRUE
        AND pu.${COLS.is_active} IS DISTINCT FROM FALSE
        ${extra}
      ORDER BY COALESCE(pu.${COLS.standard}, FALSE) DESC, b.updated_at DESC${orderBarcodeId}
      LIMIT 1;
    `,
    values
  );

  if (rows[0]) return mapRow(rows[0]);

  const hasBarcode = await checkBarcodeColumn();
  if (!hasBarcode) return null;

  // fallback: productsUnits.barcode (legado)
  const values2 = [bc];
  let j = 2;

  let extra2 = '';
  if (notEmptyStr(code)) {
    extra2 = ` AND pu.${puProductCol} = $${j++}`;
    values2.push(code);
  }

  const { rows: rows2 } = await pool.query(
    `
      SELECT
        pu.${COLS.id}        AS product_unit_id,
        pu.${puProductCol}   AS product_code,
        pu.${COLS.unit_id}   AS unit_id,
        pu.${COLS.unit}      AS unit,
        pu.${COLS.fator}     AS fator,
        ${descriptionSelect},
        pu.${COLS.barcode}   AS barcode,
        pu.${COLS.standard}  AS standard,
        pu.${COLS.is_active} AS is_active,
        pu.${COLS.created_at} AS created_at,
        pu.${COLS.updated_at} AS updated_at
      FROM public.${TB} pu
      LEFT JOIN public.${UNITS_TB} u
        ON u.unit_id = pu.${COLS.unit_id}
      WHERE pu.${COLS.is_active} IS DISTINCT FROM FALSE
        AND pu.${COLS.barcode} = $1
        ${extra2}
      ORDER BY COALESCE(pu.${COLS.standard}, FALSE) DESC, pu.${COLS.updated_at} DESC
      LIMIT 1;
    `,
    values2
  );

  return mapRow(rows2[0] || null);
}

export async function listByProduct(product_code, { include_inactive = false } = {}) {
  let code = pickProductCodeFromParams({ product_code });
  if (!notEmptyStr(code)) return [];
  code = await resolveIncomingProductCodeMaybeId(code);

  const puProductCol = await getPuProductCol();
  const barcodeSelect = await buildBarcodeSelect();
  const descriptionSelect = buildDescriptionSelect();

  const { hasBarcodeId } = await checkPbcColumns();
  const pbcOrder = hasBarcodeId ? `b.updated_at DESC, b.barcode_id DESC` : `b.updated_at DESC`;

  const { rows } = await pool.query(
    `
      SELECT
        pu.${COLS.id}        AS product_unit_id,
        pu.${puProductCol}   AS product_code,
        pu.${COLS.unit_id}   AS unit_id,
        pu.${COLS.unit}      AS unit,
        pu.${COLS.fator}     AS fator,
        ${descriptionSelect},
        ${barcodeSelect},
        pu.${COLS.standard}  AS standard,
        pu.${COLS.is_active} AS is_active,
        pu.${COLS.created_at} AS created_at,
        pu.${COLS.updated_at} AS updated_at
      FROM public.${TB} pu
      LEFT JOIN public.${UNITS_TB} u
        ON u.unit_id = pu.${COLS.unit_id}
      LEFT JOIN LATERAL (
        SELECT b.barcode
        FROM public.${PBC_TB} b
        WHERE b.product_unit_id = pu.${COLS.id}
          AND COALESCE(b.is_active, TRUE) IS TRUE
        ORDER BY ${pbcOrder}
        LIMIT 1
      ) pbc ON TRUE
      WHERE pu.${puProductCol} = $1
        ${include_inactive ? '' : `AND pu.${COLS.is_active} IS DISTINCT FROM FALSE`}
      ORDER BY COALESCE(pu.${COLS.standard}, FALSE) DESC, UPPER(BTRIM(pu.${COLS.unit})) ASC;
    `,
    [String(code).trim()]
  );

  return rows.map(mapRow);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Export default
───────────────────────────────────────────────────────────────────────────── */
const ProductsUnitsAPI = Object.freeze({
  ensureProductsUnitsTable,

  list:       listProductsUnits,
  getById:    getProductsUnitById,
  create:     createProductsUnit,
  upsert:     upsertProductsUnit,
  update:     updateProductsUnit,
  deactivate: deactivateProductsUnit,
  remove:     deleteProductsUnit,

  // extras
  factorsBySkus,
  getByBarcode,
  getFactorsMapBySkus,
  listByProduct,
});

export default ProductsUnitsAPI;
