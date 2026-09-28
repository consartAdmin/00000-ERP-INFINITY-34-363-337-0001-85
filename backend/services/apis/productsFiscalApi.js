// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  backend/services/apis/productsFiscalApi.js                               ║
// ║  API — Products Fiscal (ESM)                                              ║
// ║  ✅ Tabela REAL: public."productsFiscal"                                   ║
// ║     - product_code (SEM FK)                                               ║
// ║     - snapshot: is_current / valid_from / valid_to                         ║
// ║     - legados + canônicos + arrays CFOP                                   ║
// ║  ✅ FIX CRÍTICO: products_fiscal_id NUNCA vai no INSERT (usa DEFAULT/SEQ)  ║
// ║  ✅ ensureTable GARANTE sequence + OWNED BY + DEFAULT do products_fiscal_id ║
// ║  ✅ sem nested transaction: importFromRefs usa o MESMO client/tx            ║
// ║  ✅ INSERT/UPDATE com colunas sempre QUOTED (evita conflito com nomes)      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."productsFiscal"';
const ALIAS = 'pf';
const TB_PRODUCTS = 'public."products"'; // opcional: traz descrição via SKU (product_code)

// sequence padrão para a PK (sem serial/identity, mas com default)
const PK_SEQ = 'productsFiscal_products_fiscal_id_seq';

/* ──────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────── */
const isFiniteNum = (v) => {
  if (v === '' || v == null) return false;
  const s = String(v).trim().replace(',', '.');
  return Number.isFinite(Number(s));
};

const toNumOrNull = (v) => {
  if (!isFiniteNum(v)) return null;
  return Number(String(v).trim().replace(',', '.'));
};

const toTrimOrNull = (v) => (v == null ? null : (String(v).trim() || null));
const toTextOrNull = (v) => (v == null ? null : String(v));

const q = (col) => `"${String(col).replace(/"/g, '""')}"`; // quote seguro para nomes de coluna

function toJsonObject(value, fallback = {}) {
  if (value == null || value === '') return fallback;

  let parsed = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('tax_reform_details deve conter um JSON válido.');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tax_reform_details deve ser um objeto JSON.');
  }

  return parsed;
}

function normalizeDigits(value, exactLength, fieldName) {
  if (value == null || value === '') return null;

  const digits = String(value).replace(/\D/g, '');

  if (digits.length !== exactLength) {
    throw new Error(
      `${fieldName} deve possuir exatamente ${exactLength} dígitos.`,
    );
  }

  return digits;
}

function normalizeNCM(ncmLike) {
  if (ncmLike == null) return null;
  let digits = String(ncmLike).replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.length < 8) digits = digits.padEnd(8, '0');
  if (digits.length > 8) digits = digits.slice(0, 8);
  return digits;
}

function normalizeCEST(cestLike) {
  if (cestLike == null) return null;
  let digits = String(cestLike).replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.length !== 7) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 7)}`;
}

function normalizeCFOPList(v) {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = [];
  for (const item of arr) {
    const digits = String(item).replace(/\D+/g, '');
    if (!digits) continue;
    out.push(digits.padStart(4, '0').slice(-4));
  }
  return out.length ? out : null;
}

const takeFirst = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

/* ──────────────────────────────────────────────────────────
   Campos fiscais + espelhos legados
────────────────────────────────────────────────────────── */
const FISCAL_FIELDS = [
  'fiscal_profile_id',
  'fiscal_classification_id',

  'classification_name',
  'profile_name',

  'ncm', 'ex_tipi', 'cest',

  'origem_mercadoria',
  'cst_icms', 'csosn', 'modalidade_bc', 'modalidade_bc_st',
  'aliquota_icms', 'reducao_bc', 'mva_st', 'aliquota_st', 'aliquota_fcp',

  'cfops_entrada', 'cfops_saida',

  'pis_cst', 'pis_aliquota', 'cofins_cst', 'cofins_aliquota',

  'ipi_cst', 'ipi_aliquota',

  'ibpt_nacional', 'ibpt_importado', 'ibpt_estadual', 'ibpt_municipal',

  'observacao',

  // ── Espelhos legados
  'description_class',
  'description_profile',
  'ncm_code',
  'ncm_description',
  'cest_code',
  'cest_description',
  'icms_cst',
  'icms_rate',
  'pis_rate',
  'cofins_rate',
  'origin_code',
  'cfop_entry',
  'cfop_exit',
  'benefit_code',

  // Reforma Tributária — IS
  'is_cst',
  'is_classification',
  'is_rate',
  'is_specific_rate',
  'is_unit',

  // Reforma Tributária — IBS/CBS
  'ibscbs_cst',
  'ibscbs_classification',
  'ibs_uf_rate',
  'ibs_municipal_rate',
  'cbs_rate',
  'donation_indicator',
  'tax_reform_details',
];

/* ──────────────────────────────────────────────────────────
   Normalização com aliases + preenchimento dos espelhos
────────────────────────────────────────────────────────── */
function normalizePayload(payload = {}) {
  const profileId = payload.fiscal_profile_id ?? payload.fiscalProfileId ?? payload.profile_id;
  const classId = payload.fiscal_classification_id ?? payload.fiscalClassificationId ?? payload.classification_id;

  const classification_name =
    payload.classification_name ?? payload.classificationName ?? payload.name_class ?? null;
  const profile_name =
    payload.profile_name ?? payload.profileName ?? null;

  // Classificação
  const ncmRaw = payload.ncm ?? payload.ncm_code ?? payload.ncmCode;
  const cestRaw = payload.cest ?? payload.cest_code ?? payload.cestCode;

  const ncm = normalizeNCM(ncmRaw);
  const ex_tipi = toTrimOrNull(payload.ex_tipi ?? payload.ex_tipi_code ?? payload.exTipi);
  const cest = normalizeCEST(cestRaw);

  // ICMS
  const origem_mercadoria =
    payload.origem_mercadoria ?? payload.origem ?? payload.origin_code ?? payload.orig ?? null;

  const cst_icms = toTrimOrNull(payload.cst_icms ?? payload.icms_cst ?? payload.cst);
  const csosn = toTrimOrNull(payload.csosn);
  const modalidade_bc = toTrimOrNull(payload.modalidade_bc ?? payload.mod_bc);
  const modalidade_bc_st = toTrimOrNull(payload.modalidade_bc_st ?? payload.mod_bc_st);

  const aliquota_icms = toNumOrNull(payload.aliquota_icms ?? payload.icms_rate);
  const reducao_bc = toNumOrNull(payload.reducao_bc);
  const mva_st = toNumOrNull(payload.mva_st);
  const aliquota_st = toNumOrNull(payload.aliquota_st);
  const aliquota_fcp = toNumOrNull(payload.aliquota_fcp);

  // CFOP
  const cfops_entrada = normalizeCFOPList(payload.cfops_entrada ?? payload.cfop_entry ?? payload.cfopEntrada);
  const cfops_saida = normalizeCFOPList(payload.cfops_saida ?? payload.cfop_exit ?? payload.cfopSaida);

  // PIS/COFINS
  const pis_cst = toTrimOrNull(payload.pis_cst);
  const pis_aliquota = toNumOrNull(payload.pis_aliquota ?? payload.pis_rate);
  const cofins_cst = toTrimOrNull(payload.cofins_cst);
  const cofins_aliquota = toNumOrNull(payload.cofins_aliquota ?? payload.cofins_rate);

  // IPI
  const ipi_cst = toTrimOrNull(payload.ipi_cst);
  const ipi_aliquota = toNumOrNull(payload.ipi_aliquota ?? payload.ipi_rate);

  // IBPT
  const ibpt_nacional = toNumOrNull(payload.ibpt_nacional);
  const ibpt_importado = toNumOrNull(payload.ibpt_importado);
  const ibpt_estadual = toNumOrNull(payload.ibpt_estadual);
  const ibpt_municipal = toNumOrNull(payload.ibpt_municipal);

  // Descrições e benefit
  const description_class = toTrimOrNull(payload.description_class) ?? classification_name ?? null;
  const description_profile = toTrimOrNull(payload.description_profile) ?? profile_name ?? null;
  const ncm_description = toTrimOrNull(payload.ncm_description);
  const cest_description = toTrimOrNull(payload.cest_description);
  const benefit_code = toTrimOrNull(payload.benefit_code);

  // Espelhos legados derivados
  const ncm_code = ncm ?? null;
  const cest_code = cest ?? null;

  const origin_code = origem_mercadoria == null ? null : String(origem_mercadoria);
  const icms_rate = aliquota_icms;
  const pis_rate = pis_aliquota;
  const cofins_rate = cofins_aliquota;
  const icms_cst = cst_icms;
  const cfop_entry = takeFirst(cfops_entrada);
  const cfop_exit = takeFirst(cfops_saida);

  // Reforma Tributária — IS
  const is_cst = toTrimOrNull(payload.is_cst);
  const is_classification = toTrimOrNull(payload.is_classification);
  const is_rate = toNumOrNull(payload.is_rate);
  const is_specific_rate = toNumOrNull(payload.is_specific_rate);
  const is_unit = toTrimOrNull(payload.is_unit)?.toUpperCase() || 'UN';

  // Reforma Tributária — IBS/CBS
  const ibscbs_cst =
    payload.ibscbs_cst == null || payload.ibscbs_cst === ''
      ? null
      : normalizeDigits(payload.ibscbs_cst, 3, 'CST IBS/CBS');

  const ibscbs_classification =
    payload.ibscbs_classification == null ||
      payload.ibscbs_classification === ''
      ? null
      : normalizeDigits(
        payload.ibscbs_classification,
        6,
        'Classificação IBS/CBS',
      );

  const ibs_uf_rate = toNumOrNull(payload.ibs_uf_rate);
  const ibs_municipal_rate = toNumOrNull(
    payload.ibs_municipal_rate,
  );
  const cbs_rate = toNumOrNull(payload.cbs_rate);
  const donation_indicator = toNumOrNull(
    payload.donation_indicator,
  );

  if (
    donation_indicator != null &&
    ![0, 1].includes(donation_indicator)
  ) {
    throw new Error('donation_indicator deve ser 0 ou 1.');
  }

  const tax_reform_details = toJsonObject(
    payload.tax_reform_details,
    {},
  );

  const base = {
    fiscal_profile_id: profileId == null ? null : Number(profileId),
    fiscal_classification_id: classId == null ? null : Number(classId),
    classification_name,
    profile_name,

    ncm, ex_tipi, cest,
    origem_mercadoria: origem_mercadoria == null ? null : Number(origem_mercadoria),
    cst_icms, csosn, modalidade_bc, modalidade_bc_st,
    aliquota_icms, reducao_bc, mva_st, aliquota_st, aliquota_fcp,
    cfops_entrada, cfops_saida,
    pis_cst, pis_aliquota, cofins_cst, cofins_aliquota,
    ipi_cst, ipi_aliquota,
    ibpt_nacional, ibpt_importado, ibpt_estadual, ibpt_municipal,
    observacao: toTrimOrNull(payload.observacao ?? payload.observation ?? payload.obs),

    description_class,
    description_profile,
    ncm_code,
    ncm_description,
    cest_code,
    cest_description,
    icms_cst,
    icms_rate,
    pis_rate,
    cofins_rate,
    origin_code,
    cfop_entry,
    cfop_exit,
    benefit_code,

    is_cst,
    is_classification,
    is_rate,
    is_specific_rate,
    is_unit,

    ibscbs_cst,
    ibscbs_classification,
    ibs_uf_rate,
    ibs_municipal_rate,
    cbs_rate,
    donation_indicator,
    tax_reform_details,
  };

  const out = {};
  for (const k of FISCAL_FIELDS) out[k] = (k in base ? base[k] : null);
  return out;
}

function shallowEqualFiscal(a, b) {
  for (const k of FISCAL_FIELDS) {
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va) || Array.isArray(vb)) {
      const sa = (va ?? []).map(String);
      const sb = (vb ?? []).map(String);
      if (sa.length !== sb.length) return false;
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    } else if (String(va ?? '') !== String(vb ?? '')) {
      return false;
    }
  }
  return true;
}

/* ──────────────────────────────────────────────────────────
   Resolve product_code
   - productsFiscal é por product_code (SEM FK)
   - compat: se vier product_id, resolve via public."products"
────────────────────────────────────────────────────────── */
async function resolveProductCode(client, { product_code, productCode, product_id, productId } = {}) {
  const code = toTrimOrNull(product_code ?? productCode);
  if (code) return code;

  const pid = product_id ?? productId;
  if (pid == null) return null;
  if (!isFiniteNum(pid)) return null;

  const { rows } = await client.query(
    `SELECT product_code FROM ${TB_PRODUCTS} WHERE product_id = $1 LIMIT 1`,
    [Number(pid)]
  );
  return rows[0]?.product_code ? String(rows[0].product_code) : null;
}

/* ──────────────────────────────────────────────────────────
   DDL / Migração idempotente (ALINHADA À TABELA REAL)
   ✅ garante SEQUENCE + OWNED BY + DEFAULT do products_fiscal_id
────────────────────────────────────────────────────────── */
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // cria tabela base (se não existir)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public."productsFiscal" (
        products_fiscal_id INTEGER
      );
    `);

    // garante coluna PK existe
    await client.query(`
      ALTER TABLE public."productsFiscal"
        ADD COLUMN IF NOT EXISTS products_fiscal_id INTEGER;
    `);

    // garante NOT NULL da PK
    await client.query(`
      ALTER TABLE public."productsFiscal"
        ALTER COLUMN products_fiscal_id SET NOT NULL;
    `);

    // garante PK (se não existir)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public."productsFiscal"'::regclass
            AND contype = 'p'
        ) THEN
          ALTER TABLE public."productsFiscal"
            ADD CONSTRAINT "productsFiscal_pkey" PRIMARY KEY (products_fiscal_id);
        END IF;
      END $$;
    `);

    // ✅ garante sequence + owned by + default + setval
    await client.query(`
      DO $$
      DECLARE
        seq_name TEXT := '${PK_SEQ}';
        has_def  BOOLEAN;
      BEGIN
        -- 1) cria sequence se não existir
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'S' AND n.nspname = 'public' AND c.relname = seq_name
        ) THEN
          EXECUTE format('CREATE SEQUENCE public.%I', seq_name);
        END IF;

        -- 2) OWNED BY (vincula a coluna na sequence)
        EXECUTE format(
          'ALTER SEQUENCE public.%I OWNED BY public."productsFiscal".products_fiscal_id',
          seq_name
        );

        -- 3) verifica se a coluna tem default
        SELECT EXISTS (
          SELECT 1
          FROM pg_attrdef d
          JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE d.adrelid = 'public."productsFiscal"'::regclass
            AND a.attname = 'products_fiscal_id'
        ) INTO has_def;

        -- 4) se não tem default, seta
        IF NOT has_def THEN
          EXECUTE format(
            'ALTER TABLE public."productsFiscal" ALTER COLUMN products_fiscal_id SET DEFAULT nextval(''public.%I''::regclass)',
            seq_name
          );
        END IF;

        -- 5) sincroniza para evitar colisão
        EXECUTE format(
          'SELECT setval(''public.%I'', COALESCE((SELECT MAX(products_fiscal_id) FROM public."productsFiscal"), 0) + 1, false)',
          seq_name
        );
      END $$;
    `);

    // coluna chave (SEM FK)
    await client.query(`
      ALTER TABLE public."productsFiscal"
        ADD COLUMN IF NOT EXISTS product_code VARCHAR(60);
    `);

    // colunas (tipos conforme DESCRIBE)
    await client.query(`
      ALTER TABLE public."productsFiscal"
        ADD COLUMN IF NOT EXISTS fiscal_classification_id INTEGER,
        ADD COLUMN IF NOT EXISTS fiscal_profile_id INTEGER,

        ADD COLUMN IF NOT EXISTS classification_name VARCHAR(150),
        ADD COLUMN IF NOT EXISTS description_class TEXT,
        ADD COLUMN IF NOT EXISTS ncm_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS ncm_description TEXT,
        ADD COLUMN IF NOT EXISTS cest_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS cest_description TEXT,

        ADD COLUMN IF NOT EXISTS profile_name VARCHAR(120),
        ADD COLUMN IF NOT EXISTS description_profile TEXT,

        ADD COLUMN IF NOT EXISTS icms_cst VARCHAR(10),
        ADD COLUMN IF NOT EXISTS icms_rate NUMERIC(6,2),
        ADD COLUMN IF NOT EXISTS cfop_entry VARCHAR(10),
        ADD COLUMN IF NOT EXISTS cfop_exit VARCHAR(10),
        ADD COLUMN IF NOT EXISTS origin_code VARCHAR(10),

        ADD COLUMN IF NOT EXISTS pis_cst VARCHAR(10),
        ADD COLUMN IF NOT EXISTS pis_rate NUMERIC(6,2),
        ADD COLUMN IF NOT EXISTS cofins_cst VARCHAR(10),
        ADD COLUMN IF NOT EXISTS cofins_rate NUMERIC(6,2),

        ADD COLUMN IF NOT EXISTS benefit_code VARCHAR(20),

        ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS effective_to   TIMESTAMP WITHOUT TIME ZONE,
        ADD COLUMN IF NOT EXISTS version        INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT TRUE,

        ADD COLUMN IF NOT EXISTS source_system    VARCHAR(60),
        ADD COLUMN IF NOT EXISTS source_reference VARCHAR(120),
        ADD COLUMN IF NOT EXISTS source_hash      TEXT,
        ADD COLUMN IF NOT EXISTS extra_payload    JSONB,
        ADD COLUMN IF NOT EXISTS raw_payload      JSONB,

        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),

        -- espelhos/canônicos
        ADD COLUMN IF NOT EXISTS ncm VARCHAR(12),
        ADD COLUMN IF NOT EXISTS ex_tipi VARCHAR(3),
        ADD COLUMN IF NOT EXISTS cest VARCHAR(10),
        ADD COLUMN IF NOT EXISTS origem_mercadoria SMALLINT,
        ADD COLUMN IF NOT EXISTS cst_icms VARCHAR(3),
        ADD COLUMN IF NOT EXISTS csosn VARCHAR(3),
        ADD COLUMN IF NOT EXISTS modalidade_bc VARCHAR(2),
        ADD COLUMN IF NOT EXISTS modalidade_bc_st VARCHAR(2),
        ADD COLUMN IF NOT EXISTS aliquota_icms NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS reducao_bc NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS mva_st NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS aliquota_st NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS aliquota_fcp NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS cfops_entrada TEXT[],
        ADD COLUMN IF NOT EXISTS cfops_saida   TEXT[],
        ADD COLUMN IF NOT EXISTS pis_aliquota NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS cofins_aliquota NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS ipi_cst VARCHAR(3),
        ADD COLUMN IF NOT EXISTS ipi_aliquota NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS ibpt_nacional NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS ibpt_importado NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS ibpt_estadual NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS ibpt_municipal NUMERIC(7,4),
        ADD COLUMN IF NOT EXISTS observacao TEXT,

        -- snapshot versioning (com TZ)
        ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS valid_to   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS is_current BOOLEAN;
    `);

    // FKs (idempotente via DO $$)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'productsfiscal_fiscal_classification_id_fkey'
        ) THEN
          ALTER TABLE public."productsFiscal"
            ADD CONSTRAINT productsfiscal_fiscal_classification_id_fkey
            FOREIGN KEY (fiscal_classification_id)
            REFERENCES public."fiscalClassification"(fiscal_classification_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'productsfiscal_fiscal_profile_id_fkey'
        ) THEN
          ALTER TABLE public."productsFiscal"
            ADD CONSTRAINT productsfiscal_fiscal_profile_id_fkey
            FOREIGN KEY (fiscal_profile_id)
            REFERENCES public."fiscalProfile"(fiscal_profile_id)
            ON UPDATE CASCADE ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    // índices (idempotente)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_productsfiscal_ncm ON public."productsFiscal"(ncm_code);
      CREATE INDEX IF NOT EXISTS idx_productsfiscal_cest ON public."productsFiscal"(cest_code);
      CREATE INDEX IF NOT EXISTS idx_productsfiscal_is_current ON public."productsFiscal"(is_current);
      CREATE INDEX IF NOT EXISTS idx_productsfiscal_product_code ON public."productsFiscal"(product_code);
    `);

    // unique (source_system, source_hash)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'ux_productsfiscal_source_hash'
        ) THEN
          ALTER TABLE public."productsFiscal"
            ADD CONSTRAINT ux_productsfiscal_source_hash
            UNIQUE (source_system, source_hash);
        END IF;
      END$$;
    `);

    // opcional (recomendado): evitar 2 snapshots "current" pro mesmo produto
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_productsfiscal_current_per_product
      ON public."productsFiscal"(product_code)
      WHERE is_current = TRUE AND is_active = TRUE;
    `);

    await client.query('COMMIT');
    return { ok: true, table: 'productsFiscal', message: 'ensureTable() aligned + seq/default enforced' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────
   Row mapper
────────────────────────────────────────────────────────── */
function rowToModel(r) {
  if (!r) return null;

  const asArray = (v) => (Array.isArray(v) ? v.map(String) : v == null ? null : normalizeCFOPList(v));

  return {
    ...r,
    cfops_entrada: asArray(r.cfops_entrada),
    cfops_saida: asArray(r.cfops_saida),

    aliquota_icms: toNumOrNull(r.aliquota_icms),
    reducao_bc: toNumOrNull(r.reducao_bc),
    mva_st: toNumOrNull(r.mva_st),
    aliquota_st: toNumOrNull(r.aliquota_st),
    aliquota_fcp: toNumOrNull(r.aliquota_fcp),
    pis_aliquota: toNumOrNull(r.pis_aliquota),
    cofins_aliquota: toNumOrNull(r.cofins_aliquota),
    ipi_aliquota: toNumOrNull(r.ipi_aliquota),
    ibpt_nacional: toNumOrNull(r.ibpt_nacional),
    ibpt_importado: toNumOrNull(r.ibpt_importado),
    ibpt_estadual: toNumOrNull(r.ibpt_estadual),
    ibpt_municipal: toNumOrNull(r.ibpt_municipal),

    icms_rate: toNumOrNull(r.icms_rate),
    pis_rate: toNumOrNull(r.pis_rate),
    cofins_rate: toNumOrNull(r.cofins_rate),

    is_rate: toNumOrNull(r.is_rate),
    is_specific_rate: toNumOrNull(r.is_specific_rate),
    ibs_uf_rate: toNumOrNull(r.ibs_uf_rate),
    ibs_municipal_rate: toNumOrNull(r.ibs_municipal_rate),
    cbs_rate: toNumOrNull(r.cbs_rate),
    donation_indicator: toNumOrNull(r.donation_indicator),

    tax_reform_details: toJsonObject(
      r.tax_reform_details,
      {},
    ),
  };
}

/* ──────────────────────────────────────────────────────────
   LIST / GET
────────────────────────────────────────────────────────── */
export async function list(params = {}) {
  const { q: qtext, productCode, product_code, current, limit = 20, offset = 0 } = params;

  const wh = ['1=1'];
  const values = [];
  let i = 1;

  const codeFilter = toTrimOrNull(product_code ?? productCode);
  if (codeFilter) {
    wh.push(`${ALIAS}.product_code = $${i}`);
    values.push(codeFilter);
    i++;
  }

  if (qtext) {
    wh.push(`(
      ${ALIAS}.product_code::text ILIKE $${i} OR
      ${ALIAS}.ncm ILIKE $${i} OR
      ${ALIAS}.cest ILIKE $${i} OR
      ${ALIAS}.cst_icms ILIKE $${i} OR
      ${ALIAS}.icms_cst ILIKE $${i} OR
      ${ALIAS}.csosn ILIKE $${i} OR
      ${ALIAS}.pis_cst ILIKE $${i} OR
      ${ALIAS}.cofins_cst ILIKE $${i} OR
      ${ALIAS}.ipi_cst ILIKE $${i} OR
      ${ALIAS}.observacao ILIKE $${i} OR
      ${ALIAS}.ncm_description ILIKE $${i} OR
      ${ALIAS}.cest_description ILIKE $${i} OR
      ${ALIAS}.classification_name ILIKE $${i} OR
      ${ALIAS}.profile_name ILIKE $${i} OR
      p.description ILIKE $${i}
    )`);
    values.push(`%${qtext}%`);
    i++;
  }

  if (current === true) wh.push(`${ALIAS}.is_current = TRUE`);
  else if (current === false) wh.push(`${ALIAS}.is_current = FALSE`);

  const sql = `
    SELECT
      ${ALIAS}.*,
      p.description AS product_description
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PRODUCTS} p
      ON p.product_code = ${ALIAS}.product_code
    WHERE ${wh.join(' AND ')}
    ORDER BY ${ALIAS}.updated_at DESC, ${ALIAS}.products_fiscal_id DESC
    LIMIT $${i} OFFSET $${i + 1};
  `;

  values.push(Number(limit), Number(offset));
  const { rows } = await pool.query(sql, values);
  return rows.map(rowToModel);
}

export async function getById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM ${TB} WHERE products_fiscal_id = $1`,
    [Number(id)]
  );
  return rowToModel(rows[0]);
}

export async function getCurrentBySku(productCode) {
  const code = toTrimOrNull(productCode);
  if (!code) return null;

  const sql = `
    SELECT
      ${ALIAS}.*,
      p.description AS product_description
    FROM ${TB} ${ALIAS}
    LEFT JOIN ${TB_PRODUCTS} p
      ON p.product_code = ${ALIAS}.product_code
    WHERE ${ALIAS}.product_code = $1
      AND ${ALIAS}.is_current = TRUE
      AND ${ALIAS}.is_active = TRUE
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [code]);
  return rows[0] ? rowToModel(rows[0]) : null;
}

// ✅ compat: se alguém ainda chama por productId numérico, resolve para SKU e busca
export async function getCurrentByProduct(productIdOrCode) {
  const client = await pool.connect();
  try {
    const code = await resolveProductCode(client, {
      product_id: isFiniteNum(productIdOrCode) ? Number(productIdOrCode) : null,
      product_code: !isFiniteNum(productIdOrCode) ? String(productIdOrCode) : null,
    });
    if (!code) return null;
    return await getCurrentBySku(code);
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────
   CREATE snapshots (por product_code)
   ✅ IMPORTANT: products_fiscal_id NÃO entra no INSERT nunca.
   ✅ Aceita client externo para evitar nested transactions.
   ✅ INSERT com colunas QUOTED
────────────────────────────────────────────────────────── */
export async function createFromImport(payload = {}, externalClient = null) {
  const client = externalClient || (await pool.connect());
  const mustManageTx = !externalClient;

  try {
    const product_code = await resolveProductCode(client, payload);
    if (!product_code) {
      throw new Error('product_code é obrigatório (ou informe product_id para resolver SKU).');
    }

    const normalized = normalizePayload(payload);

    if (mustManageTx) await client.query('BEGIN');

    const { rows: curRows } = await client.query(
      `SELECT * FROM ${TB}
       WHERE product_code = $1 AND is_current = TRUE AND is_active = TRUE
       LIMIT 1`,
      [product_code]
    );
    const current = rowToModel(curRows[0]);

    if (current) {
      if (shallowEqualFiscal(normalizePayload(current), normalized)) {
        if (mustManageTx) await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `UPDATE ${TB}
         SET is_current = FALSE, valid_to = NOW()
         WHERE products_fiscal_id = $1`,
        [current.products_fiscal_id]
      );
    }

    // ✅ INSERT (sem products_fiscal_id)
    const cols = ['product_code', ...FISCAL_FIELDS, 'is_current', 'is_active', 'valid_from'];
    const vals = [product_code, ...FISCAL_FIELDS.map((k) => normalized[k]), true, true];

    // placeholders: vals + NOW() (valid_from)
    const placeholders = vals.map((_, idx) => `$${idx + 1}`).concat(['NOW()']);

    const insertSQL = `
      INSERT INTO ${TB} (${cols.map(q).join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *;
    `;

    const { rows: ins } = await client.query(insertSQL, vals);

    if (mustManageTx) await client.query('COMMIT');
    return rowToModel(ins[0]);
  } catch (err) {
    if (mustManageTx) {
      try { await client.query('ROLLBACK'); } catch { }
    }
    throw err;
  } finally {
    if (!externalClient) client.release();
  }
}

export async function closeCurrent(productCodeOrId) {
  const client = await pool.connect();
  try {
    const code = await resolveProductCode(client, {
      product_code: !isFiniteNum(productCodeOrId) ? String(productCodeOrId) : null,
      product_id: isFiniteNum(productCodeOrId) ? Number(productCodeOrId) : null,
    });
    if (!code) return { closed: 0 };

    const { rowCount } = await client.query(
      `UPDATE ${TB}
       SET is_current = FALSE, valid_to = NOW()
       WHERE product_code = $1 AND is_current = TRUE`,
      [code]
    );
    return { closed: rowCount };
  } finally {
    client.release();
  }
}

export async function update(id, data = {}) {
  const normalized = normalizePayload(data);
  const sets = [];
  const values = [];
  let i = 1;

  for (const k of FISCAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, k)) {
      let v = normalized[k];
      if (k === 'cfops_entrada' || k === 'cfops_saida') {
        v = v == null ? null : (Array.isArray(v) ? v : normalizeCFOPList(v));
      }
      sets.push(`${q(k)} = $${i}`);
      values.push(v);
      i++;
    }
  }

  // opcional: permitir atualizar product_code via update()
  if (Object.prototype.hasOwnProperty.call(data, 'product_code') || Object.prototype.hasOwnProperty.call(data, 'productCode')) {
    const pc = toTrimOrNull(data.product_code ?? data.productCode);
    if (pc) {
      sets.push(`${q('product_code')} = $${i}`);
      values.push(pc);
      i++;
    }
  }

  if (!sets.length) return getById(id);

  const sql = `
    UPDATE ${TB}
    SET ${sets.join(', ')}, ${q('updated_at')} = NOW()
    WHERE ${q('products_fiscal_id')} = $${i}
    RETURNING *;
  `;
  values.push(Number(id));

  const { rows } = await pool.query(sql, values);
  return rowToModel(rows[0]);
}

// ✅ DELETE REAL (remove a linha do banco)
export async function softDelete(id) {
  const { rows } = await pool.query(
    `DELETE FROM ${TB}
     WHERE products_fiscal_id = $1
     RETURNING *;`,
    [Number(id)]
  );
  return rowToModel(rows[0]);
}


/* ──────────────────────────────────────────────────────────
   Integração com fiscalProfile / fiscalClassification
────────────────────────────────────────────────────────── */
async function getFiscalProfileByIdOrName(client, { id, name }) {
  if (!id && !name) return null;
  if (id) {
    const { rows } = await client.query(
      `SELECT * FROM public."fiscalProfile" WHERE fiscal_profile_id = $1 LIMIT 1`,
      [Number(id)]
    );
    if (rows[0]) return rows[0];
  }
  if (name) {
    const { rows } = await client.query(
      `SELECT * FROM public."fiscalProfile" WHERE LOWER(profile_name) = LOWER($1) LIMIT 1`,
      [String(name).trim()]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

async function getFiscalClassificationByIdOrName(client, { id, name }) {
  if (!id && !name) return null;
  if (id) {
    const { rows } = await client.query(
      `SELECT * FROM public."fiscalClassification" WHERE fiscal_classification_id = $1 LIMIT 1`,
      [Number(id)]
    );
    if (rows[0]) return rows[0];
  }
  if (name) {
    const { rows } = await client.query(
      `SELECT * FROM public."fiscalClassification" WHERE LOWER(classification_name) = LOWER($1) LIMIT 1`,
      [String(name).trim()]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

function mapClassificationToFiscalPayload(c = {}) {
  return {
    classification_name: c.classification_name ?? c.name ?? null,
    description_class: c.description_class ?? c.description ?? null,
    ncm: normalizeNCM(c.ncm ?? c.ncm_code),
    ncm_code: normalizeNCM(c.ncm ?? c.ncm_code),
    ncm_description: toTrimOrNull(c.ncm_description),

    ex_tipi: toTrimOrNull(c.ex_tipi ?? c.ex_tipi_code),
    cest: normalizeCEST(c.cest ?? c.cest_code),
    cest_code: normalizeCEST(c.cest ?? c.cest_code),
    cest_description: toTrimOrNull(c.cest_description),

    origem_mercadoria: c.origem_mercadoria ?? c.origin_code ?? null,

    cfops_entrada: normalizeCFOPList(c.cfops_entrada ?? c.cfop_entry),
    cfops_saida: normalizeCFOPList(c.cfops_saida ?? c.cfop_exit),

    ibpt_nacional: toNumOrNull(c.ibpt_nacional),
    ibpt_importado: toNumOrNull(c.ibpt_importado),
    ibpt_estadual: toNumOrNull(c.ibpt_estadual),
    ibpt_municipal: toNumOrNull(c.ibpt_municipal),

    benefit_code: toTrimOrNull(c.benefit_code),
    observacao: toTrimOrNull(c.observacao)
  };
}

function mapProfileToFiscalPayload(p = {}) {
  const aliqICMS = toNumOrNull(p.aliquota_icms ?? p.icms_rate);
  const aliqPIS = toNumOrNull(p.pis_aliquota ?? p.pis_rate);
  const aliqCOF = toNumOrNull(p.cofins_aliquota ?? p.cofins_rate);

  const srcCstIcms =
    p.cst_icms ??
    p.icms_cst ??
    p.cst ??
    null;

  return {
    profile_name: p.profile_name ?? p.name ?? null,
    description_profile: toTrimOrNull(p.description_profile ?? p.description),

    cst_icms: toTrimOrNull(srcCstIcms),
    csosn: toTrimOrNull(p.csosn),
    modalidade_bc: toTrimOrNull(p.modalidade_bc),
    modalidade_bc_st: toTrimOrNull(p.modalidade_bc_st),
    aliquota_icms: aliqICMS,
    reducao_bc: toNumOrNull(p.reducao_bc),
    mva_st: toNumOrNull(p.mva_st),
    aliquota_st: toNumOrNull(p.aliquota_st),
    aliquota_fcp: toNumOrNull(p.aliquota_fcp),

    pis_cst: toTrimOrNull(p.pis_cst),
    pis_aliquota: aliqPIS,
    cofins_cst: toTrimOrNull(p.cofins_cst),
    cofins_aliquota: aliqCOF,

    ipi_cst: toTrimOrNull(p.ipi_cst),
    ipi_aliquota: toNumOrNull(p.ipi_aliquota ?? p.ipi_rate),

    cfops_entrada: normalizeCFOPList(p.cfops_entrada ?? p.cfop_entry),
    cfops_saida: normalizeCFOPList(p.cfops_saida ?? p.cfop_exit),

    benefit_code: toTrimOrNull(p.benefit_code),
    observacao: toTrimOrNull(p.observacao),

    // espelhos legados
    icms_cst: toTrimOrNull(srcCstIcms),
    icms_rate: aliqICMS,
    pis_rate: aliqPIS,
    cofins_rate: aliqCOF,

    // Reforma Tributária — IS
    is_cst: toTrimOrNull(p.is_cst),
    is_classification: toTrimOrNull(p.is_classification),
    is_rate: toNumOrNull(p.is_rate),
    is_specific_rate: toNumOrNull(p.is_specific_rate),
    is_unit: toTrimOrNull(p.is_unit)?.toUpperCase() || 'UN',

    // Reforma Tributária — IBS/CBS
    ibscbs_cst: toTrimOrNull(p.ibscbs_cst),
    ibscbs_classification: toTrimOrNull(
      p.ibscbs_classification,
    ),
    ibs_uf_rate: toNumOrNull(p.ibs_uf_rate),
    ibs_municipal_rate: toNumOrNull(
      p.ibs_municipal_rate,
    ),
    cbs_rate: toNumOrNull(p.cbs_rate),
    donation_indicator: toNumOrNull(
      p.donation_indicator,
    ),
    tax_reform_details: toJsonObject(
      p.tax_reform_details,
      {},
    ),
  };
}

function mergeFiscalPayload({ classification, profile, override = {} }) {
  const fromClass = mapClassificationToFiscalPayload(classification || {});
  const fromProf = mapProfileToFiscalPayload(profile || {});
  return { ...fromClass, ...fromProf, ...(override || {}) };
}

export async function previewMerge(args) {
  const client = await pool.connect();
  try {
    const profile = await getFiscalProfileByIdOrName(client, { id: args.fiscal_profile_id, name: args.fiscal_profile_name });
    const classification = await getFiscalClassificationByIdOrName(client, { id: args.fiscal_classification_id, name: args.fiscal_classification_name });
    const merged = mergeFiscalPayload({ classification, profile, override: args.override });

    if (profile?.fiscal_profile_id) {
      merged.fiscal_profile_id = profile.fiscal_profile_id;
      merged.profile_name = merged.profile_name ?? profile.profile_name ?? null;
      merged.description_profile = merged.description_profile ?? profile.description_profile ?? profile.description ?? null;
    }
    if (classification?.fiscal_classification_id) {
      merged.fiscal_classification_id = classification.fiscal_classification_id;
      merged.classification_name = merged.classification_name ?? classification.classification_name ?? null;
      merged.description_class = merged.description_class ?? classification.description_class ?? classification.description ?? null;
    }
    return normalizePayload(merged);
  } finally {
    client.release();
  }
}

export async function importFromRefs(args) {
  const client = await pool.connect();
  try {
    const product_code = await resolveProductCode(client, args);
    if (!product_code) throw new Error('product_code é obrigatório (ou informe product_id para resolver SKU).');

    await client.query('BEGIN');

    const profile = await getFiscalProfileByIdOrName(client, { id: args.fiscal_profile_id, name: args.fiscal_profile_name });
    const classification = await getFiscalClassificationByIdOrName(client, { id: args.fiscal_classification_id, name: args.fiscal_classification_name });

    if (!profile && !classification && (!args.override || Object.keys(args.override).length === 0)) {
      throw new Error('Nenhum fiscalProfile/fiscalClassification encontrado e nenhum override informado.');
    }

    const merged = mergeFiscalPayload({ classification, profile, override: args.override });

    if (profile?.fiscal_profile_id) {
      merged.fiscal_profile_id = profile.fiscal_profile_id;
      merged.profile_name = merged.profile_name ?? profile.profile_name ?? null;
      merged.description_profile = merged.description_profile ?? profile.description_profile ?? profile.description ?? null;
    }
    if (classification?.fiscal_classification_id) {
      merged.fiscal_classification_id = classification.fiscal_classification_id;
      merged.classification_name = merged.classification_name ?? classification.classification_name ?? null;
      merged.description_class = merged.description_class ?? classification.description_class ?? classification.description ?? null;
    }

    // ✅ usa o MESMO client/tx (sem nested transaction)
    const created = await createFromImport({ product_code, ...merged }, client);

    await client.query('COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default {
  ensureTable,
  list,
  getById,
  getCurrentByProduct, // compat (id ou SKU)
  getCurrentBySku,
  createFromImport,
  closeCurrent,
  update,
  softDelete,
  previewMerge,
  importFromRefs
};
