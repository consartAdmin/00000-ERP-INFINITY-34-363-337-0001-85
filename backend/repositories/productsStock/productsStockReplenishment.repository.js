// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsStockReplenishment.repository.js — Reposição de estoque      ║
// ║ Tela: public/productsStock (Estoque mínimo e máximo) + card da home  ║
// ║                                                                      ║
// ║ - Parâmetros: public."productsStockReplenishmentSettings"            ║
// ║ - Fabricante: productsManufactures.lead_time_days / min_order_value  ║
// ║ - Produto:    productsStock.lead_time_days (prazo próprio, opcional) ║
// ║                                                                      ║
// ║ Cálculo (consumo = saídas dos últimos N dias, em productMovements):  ║
// ║   consumo/dia      = saídas ÷ N                                      ║
// ║   ponto de pedido  = mínimo + consumo/dia × prazo                    ║
// ║   comprar          = máximo − atual + consumo/dia × prazo            ║
// ║   cobertura (dias) = atual ÷ consumo/dia                             ║
// ║   pedir até        = acaba em − prazo                                ║
// ║   pedido mínimo    = Σ comprar × cost_price por fabricante           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_SETTINGS = 'public."productsStockReplenishmentSettings"';
const TB_STOCK = 'public."productsStock"';
const TB_PRODUCTS = 'public."products"';
const TB_MANUFACTURERS = 'public."productsManufactures"';
const TB_MOVEMENTS = 'public."productMovements"';

export const DEFAULT_REPLENISHMENT_SETTINGS = Object.freeze({
  consumption_days: 90,
  default_lead_time_days: 10,
  soon_days: 15,
  consumption_source: 'SALES',
  max_cover_days: 30,
});

const CONSUMPTION_SOURCES = new Set(['SALES', 'ALL']);

export const SITUATIONS = Object.freeze([
  { key: 'BUY', label: 'Comprar agora', color: '#dc2626' },
  { key: 'ZERO_SALES', label: 'Zerados com venda', color: '#7c3aed' },
  { key: 'SOON', label: 'Repor em breve', color: '#d97706' },
  { key: 'OK', label: 'Estoque OK', color: '#16a34a' },
  { key: 'OVER', label: 'Acima do máximo', color: '#0891b2' },
  { key: 'NO_PARAMS', label: 'Sem mín./máx.', color: '#64748b' },
]);
const SITUATION_KEYS = new Set(SITUATIONS.map((s) => s.key));

/* ──────────────────────────────────────────────────────────────
   Schema (idempotente, roda uma vez por processo)
────────────────────────────────────────────────────────────── */
let ensurePromise = null;

async function runEnsure() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_SETTINGS} (
      setting_id serial PRIMARY KEY,
      scope_key text NOT NULL DEFAULT 'GLOBAL',
      consumption_days integer NOT NULL DEFAULT 90,
      default_lead_time_days integer NOT NULL DEFAULT 10,
      soon_days integer NOT NULL DEFAULT 15,
      consumption_source text NOT NULL DEFAULT 'SALES',
      max_cover_days integer NOT NULL DEFAULT 30,
      updated_by integer NULL,
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "productsStockReplenishmentSettings_scope_key_uq"
      ON ${TB_SETTINGS} (scope_key);
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS ${TB_MANUFACTURERS}
      ADD COLUMN IF NOT EXISTS lead_time_days integer NULL,
      ADD COLUMN IF NOT EXISTS min_order_value numeric(14,2) NULL;
  `);
  await pool.query(`
    ALTER TABLE IF EXISTS ${TB_STOCK}
      ADD COLUMN IF NOT EXISTS lead_time_days integer NULL;
  `);
}

export function ensureReplenishmentSchema() {
  if (!ensurePromise) {
    ensurePromise = runEnsure().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
function intIn(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeSettings(row = {}) {
  const d = DEFAULT_REPLENISHMENT_SETTINGS;
  return {
    consumption_days: intIn(row.consumption_days, 7, 365, d.consumption_days),
    default_lead_time_days: intIn(row.default_lead_time_days, 0, 365, d.default_lead_time_days),
    soon_days: intIn(row.soon_days, 0, 365, d.soon_days),
    consumption_source: CONSUMPTION_SOURCES.has(String(row.consumption_source || '').toUpperCase())
      ? String(row.consumption_source).toUpperCase()
      : d.consumption_source,
    max_cover_days: intIn(row.max_cover_days, 1, 365, d.max_cover_days),
    updated_at: row.updated_at ?? null,
  };
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Coluna date do Postgres → 'YYYY-MM-DD' (o driver devolve Date na meia-noite local). */
function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

function rowToModel(r) {
  return {
    product_id: r.product_id,
    product_code: r.product_code,
    product_description: r.product_description,
    product_group_id: r.product_group_id,
    product_group_name: r.product_group_name,
    product_subgroup_id: r.product_subgroup_id,
    product_subgroup_name: r.product_subgroup_name,
    manufacturer_id: r.product_manufacturer_id,
    manufacturer_name: r.manufacturer_name,
    product_stock_id: r.product_stock_id,
    stock_qty: Number(r.stock_qty || 0),
    stock_min: Number(r.stock_min || 0),
    stock_max: Number(r.stock_max || 0),
    lead_days: Number(r.lead_days || 0),
    lead_source: r.lead_source,
    lead_time_product: num(r.lead_time_product),
    lead_time_manufacturer: num(r.lead_time_manufacturer),
    min_order_value: num(r.min_order_value),
    cost_price: Number(r.cost_price || 0),
    qty_out: Number(r.qty_out || 0),
    daily: Number(r.daily || 0),
    reorder_point: Number(r.reorder_point || 0),
    coverage_days: r.coverage_days === null ? null : Number(r.coverage_days),
    days_to_reorder: r.days_to_reorder === null ? null : Number(r.days_to_reorder),
    situation: r.situation,
    suggestion: Number(r.suggestion || 0),
    suggestion_now: Number(r.suggestion_now || 0),
    suggestion_value: Number(r.suggestion || 0) * Number(r.cost_price || 0),
    runs_out_at: dateOnly(r.runs_out_at),
    order_by: dateOnly(r.order_by),
    arrives_at: dateOnly(r.arrives_at),
  };
}

/* ──────────────────────────────────────────────────────────────
   Parâmetros
────────────────────────────────────────────────────────────── */
export async function getSettings() {
  await ensureReplenishmentSchema();
  const { rows } = await pool.query(`SELECT * FROM ${TB_SETTINGS} WHERE scope_key = 'GLOBAL' LIMIT 1`);
  return normalizeSettings(rows[0] || DEFAULT_REPLENISHMENT_SETTINGS);
}

export async function listManufacturersReplenishment() {
  await ensureReplenishmentSchema();
  const { rows } = await pool.query(`
    SELECT pm.product_manufacturer_id AS id, pm.name, pm.lead_time_days, pm.min_order_value,
           COUNT(p.product_id)::int AS products
      FROM ${TB_MANUFACTURERS} pm
      LEFT JOIN ${TB_PRODUCTS} p ON p.manufacturer_id = pm.product_manufacturer_id
     WHERE COALESCE(pm.is_active, true) = true
     GROUP BY pm.product_manufacturer_id, pm.name, pm.lead_time_days, pm.min_order_value
     ORDER BY COUNT(p.product_id) DESC, pm.name ASC
  `);
  const { rows: none } = await pool.query(`SELECT COUNT(*)::int AS products FROM ${TB_PRODUCTS} WHERE manufacturer_id IS NULL`);
  return {
    manufacturers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      lead_time_days: num(r.lead_time_days),
      min_order_value: num(r.min_order_value),
      products: r.products,
    })),
    without_manufacturer: none[0]?.products ?? 0,
  };
}

export async function saveSettings(payload = {}, userId = null) {
  await ensureReplenishmentSchema();
  const s = normalizeSettings(payload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO ${TB_SETTINGS} (scope_key, consumption_days, default_lead_time_days, soon_days,
                                  consumption_source, max_cover_days, updated_by, updated_at)
      VALUES ('GLOBAL', $1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (scope_key) DO UPDATE SET
        consumption_days = EXCLUDED.consumption_days,
        default_lead_time_days = EXCLUDED.default_lead_time_days,
        soon_days = EXCLUDED.soon_days,
        consumption_source = EXCLUDED.consumption_source,
        max_cover_days = EXCLUDED.max_cover_days,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `, [s.consumption_days, s.default_lead_time_days, s.soon_days, s.consumption_source, s.max_cover_days, userId]);

    const manufacturers = Array.isArray(payload.manufacturers) ? payload.manufacturers : [];
    for (const m of manufacturers) {
      const id = Math.trunc(Number(m?.id));
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const lead = numOrNull(m.lead_time_days);
      const minOrder = numOrNull(m.min_order_value);
      if (lead !== null && (lead < 0 || lead > 365)) throw badRequest('Prazo do fabricante deve ficar entre 0 e 365 dias.');
      if (minOrder !== null && minOrder < 0) throw badRequest('Pedido mínimo não pode ser negativo.');
      await client.query(
        `UPDATE ${TB_MANUFACTURERS} SET lead_time_days = $1, min_order_value = $2 WHERE product_manufacturer_id = $3`,
        [lead === null ? null : Math.trunc(lead), minOrder, id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getSettings();
}

/* ──────────────────────────────────────────────────────────────
   CTE principal: um registro por produto ativo com o cálculo
   Parâmetros: $1 dias de consumo, $2 prazo padrão, $3 "repor em breve"
────────────────────────────────────────────────────────────── */
function buildCte(settings) {
  const sourceSql = settings.consumption_source === 'ALL'
    ? 'TRUE'
    : `m.origin_module IN ('invoicesIssued', 'pdvStarter')`;

  return {
    params: [settings.consumption_days, settings.default_lead_time_days, settings.soon_days],
    sql: `
      WITH cons AS (
        SELECT m.product_code,
               SUM(CASE WHEN m.movement_type = 'SAIDA' THEN ABS(COALESCE(m.quantity, 0))
                        ELSE -ABS(COALESCE(m.quantity, 0)) END) AS qty_out
          FROM ${TB_MOVEMENTS} m
         WHERE m.created_at >= (CURRENT_DATE - $1::int)
           AND (
                 (m.movement_type = 'SAIDA' AND ${sourceSql})
              OR (m.movement_type = 'ENTRADA' AND m.origin_module = 'invoicesIssued')
           )
         GROUP BY m.product_code
      ),
      base AS (
        SELECT
          p.product_id,
          p.product_code,
          p.description AS product_description,
          p.product_group_id,
          pg.name AS product_group_name,
          p.product_subgroup_id,
          psg.name AS product_subgroup_name,
          p.manufacturer_id AS product_manufacturer_id,
          pm.name AS manufacturer_name,
          COALESCE(ps.product_stock_id, p.product_stock_id) AS product_stock_id,
          COALESCE(ps.stock_qty, 0)::numeric AS stock_qty,
          COALESCE(ps.stock_min, 0)::numeric AS stock_min,
          COALESCE(ps.stock_max, 0)::numeric AS stock_max,
          ps.lead_time_days AS lead_time_product,
          pm.lead_time_days AS lead_time_manufacturer,
          COALESCE(ps.lead_time_days, pm.lead_time_days, $2::int) AS lead_days,
          CASE WHEN ps.lead_time_days IS NOT NULL THEN 'PRODUCT'
               WHEN pm.lead_time_days IS NOT NULL THEN 'MANUFACTURER'
               ELSE 'DEFAULT' END AS lead_source,
          pm.min_order_value,
          COALESCE(p.cost_price, 0)::numeric AS cost_price,
          GREATEST(COALESCE(c.qty_out, 0), 0)::numeric AS qty_out,
          (GREATEST(COALESCE(c.qty_out, 0), 0) / $1::numeric) AS daily
        FROM ${TB_PRODUCTS} p
        LEFT JOIN ${TB_STOCK} ps ON ps.product_stock_id = p.product_stock_id
        LEFT JOIN public."productsGroups" pg ON pg.product_group_id = p.product_group_id
        LEFT JOIN public."productsSubgroups" psg ON psg.product_subgroup_id = p.product_subgroup_id
        LEFT JOIN ${TB_MANUFACTURERS} pm ON pm.product_manufacturer_id = p.manufacturer_id
        LEFT JOIN cons c ON c.product_code = p.product_code
        WHERE COALESCE((to_jsonb(p)->>'is_active')::boolean, true) = true
      ),
      calc AS (
        SELECT b.*,
               b.stock_min + b.daily * b.lead_days AS reorder_point,
               CASE WHEN b.daily > 0 THEN b.stock_qty / b.daily END AS coverage_days
          FROM base b
      ),
      sit AS (
        SELECT c.*,
               CASE
                 WHEN c.stock_qty <= 0 AND c.daily > 0 THEN 'ZERO_SALES'
                 WHEN c.stock_min <= 0 AND c.stock_max <= 0 THEN 'NO_PARAMS'
                 WHEN c.stock_qty <= c.reorder_point THEN 'BUY'
                 WHEN c.daily > 0 AND (c.stock_qty - c.reorder_point) / c.daily <= $3::int THEN 'SOON'
                 WHEN c.stock_max > 0 AND c.stock_qty > c.stock_max THEN 'OVER'
                 ELSE 'OK'
               END AS situation
          FROM calc c
      ),
      rep AS (
        SELECT s.*,
               CEIL(GREATEST(0, GREATEST(s.stock_max, s.stock_min) - s.stock_qty + s.daily * s.lead_days)) AS suggestion_now,
               CASE WHEN s.situation IN ('BUY', 'ZERO_SALES')
                    THEN CEIL(GREATEST(0, GREATEST(s.stock_max, s.stock_min) - s.stock_qty + s.daily * s.lead_days))
                    ELSE 0 END AS suggestion,
               CASE WHEN s.daily > 0 THEN GREATEST(0, (s.stock_qty - s.reorder_point) / s.daily) END AS days_to_reorder,
               CASE WHEN s.daily > 0 THEN CURRENT_DATE + GREATEST(0, FLOOR(s.stock_qty / s.daily))::int END AS runs_out_at,
               CASE WHEN s.daily > 0 THEN CURRENT_DATE + GREATEST(0, FLOOR(s.stock_qty / s.daily))::int - s.lead_days END AS order_by,
               CURRENT_DATE + s.lead_days AS arrives_at,
               CASE s.situation WHEN 'ZERO_SALES' THEN 1 WHEN 'BUY' THEN 2 WHEN 'SOON' THEN 3
                                WHEN 'OVER' THEN 4 WHEN 'OK' THEN 5 ELSE 6 END AS situation_rank
          FROM sit s
      )
    `,
  };
}

function buildFilters(filters = {}, startIndex) {
  const where = [];
  const values = [];
  let idx = startIndex;

  const q = String(filters.q || '').trim();
  if (q) {
    where.push(`(r.product_code ILIKE $${idx} OR r.product_description ILIKE $${idx} OR CAST(r.product_id AS text) = $${idx + 1})`);
    values.push(`%${q}%`, q);
    idx += 2;
  }

  const situation = String(filters.situation || '').trim().toUpperCase();
  if (situation === 'NEED') {
    where.push(`r.situation IN ('BUY', 'ZERO_SALES')`);
  } else if (SITUATION_KEYS.has(situation)) {
    where.push(`r.situation = $${idx++}`);
    values.push(situation);
  }

  for (const [key, col] of [['group_id', 'product_group_id'], ['subgroup_id', 'product_subgroup_id']]) {
    const id = Math.trunc(Number(filters[key]));
    if (Number.isSafeInteger(id) && id > 0) {
      where.push(`r.${col} = $${idx++}`);
      values.push(id);
    }
  }

  const manufacturer = String(filters.manufacturer_id ?? '').trim();
  if (manufacturer === 'none') {
    where.push('r.product_manufacturer_id IS NULL');
  } else if (manufacturer) {
    const id = Math.trunc(Number(manufacturer));
    if (Number.isSafeInteger(id) && id > 0) {
      where.push(`r.product_manufacturer_id = $${idx++}`);
      values.push(id);
    }
  }

  if (String(filters.with_sales || '') === '1') where.push('r.daily > 0');

  const ids = Array.isArray(filters.product_ids) ? filters.product_ids.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) : [];
  if (ids.length) {
    where.push(`r.product_id = ANY($${idx++}::int[])`);
    values.push(ids);
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', values, nextIndex: idx };
}

const SORTS = {
  product: 'r.product_description',
  code: 'r.product_code',
  group: 'r.product_group_name',
  manufacturer: 'r.manufacturer_name',
  lead: 'r.lead_days',
  daily: 'r.daily',
  qty: 'r.stock_qty',
  min: 'r.stock_min',
  reorder: 'r.reorder_point',
  max: 'r.stock_max',
  coverage: 'r.coverage_days',
  suggestion: 'r.suggestion',
  value: '(r.suggestion * r.cost_price)',
  situation: 'r.situation_rank',
};

function orderSql(sort, dir) {
  const col = SORTS[String(sort || '')] || null;
  const d = String(dir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  if (!col) {
    // Padrão: o que acaba primeiro, dentro da prioridade da situação
    return 'r.situation_rank ASC, r.coverage_days ASC NULLS LAST, r.product_description ASC';
  }
  return `${col} ${d} NULLS LAST, r.product_description ASC`;
}

/* ──────────────────────────────────────────────────────────────
   Lista + cards
────────────────────────────────────────────────────────────── */
async function summaryFor(settings, filters = {}) {
  const cte = buildCte(settings);
  const built = buildFilters({ ...filters, situation: '' }, cte.params.length + 1);
  const { rows } = await pool.query(`
    ${cte.sql}
    SELECT r.situation,
           COUNT(*)::int AS items,
           COALESCE(SUM(r.suggestion * r.cost_price), 0)::numeric AS buy_value,
           COALESCE(SUM(GREATEST(0, r.stock_qty - r.stock_max) * r.cost_price)
                    FILTER (WHERE r.situation = 'OVER'), 0)::numeric AS over_value,
           COALESCE(SUM(GREATEST(0, r.stock_qty) * r.cost_price), 0)::numeric AS stock_value
      FROM rep r
      ${built.sql}
     GROUP BY r.situation
  `, [...cte.params, ...built.values]);

  const map = new Map(rows.map((r) => [r.situation, r]));
  return SITUATIONS.map((s) => {
    const r = map.get(s.key) || {};
    return {
      ...s,
      items: Number(r.items || 0),
      buy_value: Number(r.buy_value || 0),
      over_value: Number(r.over_value || 0),
      stock_value: Number(r.stock_value || 0),
    };
  });
}

export async function listReplenishment(filters = {}) {
  const settings = await getSettings();
  const limit = intIn(filters.limit, 1, 500, 20);
  const page = intIn(filters.page, 1, 100000, 1);
  const offset = (page - 1) * limit;

  const cte = buildCte(settings);
  const built = buildFilters(filters, cte.params.length + 1);

  const [list, count, situations] = await Promise.all([
    pool.query(`
      ${cte.sql}
      SELECT r.* FROM rep r
      ${built.sql}
      ORDER BY ${orderSql(filters.sort, filters.dir)}
      LIMIT $${built.nextIndex} OFFSET $${built.nextIndex + 1}
    `, [...cte.params, ...built.values, limit, offset]),
    pool.query(`
      ${cte.sql}
      SELECT COUNT(*)::int AS total FROM rep r ${built.sql}
    `, [...cte.params, ...built.values]),
    summaryFor(settings, filters),
  ]);

  return {
    ok: true,
    rows: list.rows.map(rowToModel),
    total: count.rows[0]?.total ?? 0,
    page,
    limit,
    situations,
    settings,
  };
}

/** Todas as linhas do filtro (Excel / PDF), sem paginação. */
export async function listAllReplenishment(filters = {}, max = 20000) {
  const settings = await getSettings();
  const cte = buildCte(settings);
  const built = buildFilters(filters, cte.params.length + 1);
  const { rows } = await pool.query(`
    ${cte.sql}
    SELECT r.* FROM rep r
    ${built.sql}
    ORDER BY ${orderSql(filters.sort, filters.dir)}
    LIMIT ${Math.trunc(max)}
  `, [...cte.params, ...built.values]);
  return { rows: rows.map(rowToModel), settings };
}

export async function getReplenishmentRow(productId) {
  const id = Math.trunc(Number(productId));
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Produto inválido.');
  const settings = await getSettings();
  const cte = buildCte(settings);
  const { rows } = await pool.query(`${cte.sql} SELECT r.* FROM rep r WHERE r.product_id = $4 LIMIT 1`, [...cte.params, id]);
  if (!rows[0]) return null;
  const row = rowToModel(rows[0]);
  return { ...row, calc: suggestParams(row, settings), settings };
}

export async function listProductMovements(productId, limit = 40) {
  const id = Math.trunc(Number(productId));
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Produto inválido.');
  const { rows } = await pool.query(`
    SELECT m.movement_id, m.created_at, m.movement_type, m.origin_module, m.quantity, m.lot_code,
           m.nfe_number, m.notes, m.previous_stock, m.new_stock
      FROM ${TB_MOVEMENTS} m
      JOIN ${TB_PRODUCTS} p ON p.product_code = m.product_code
     WHERE p.product_id = $1
     ORDER BY m.created_at DESC, m.movement_id DESC
     LIMIT $2
  `, [id, intIn(limit, 1, 200, 40)]);
  return rows;
}

/** Mínimo = consumo durante o prazo; máximo = mínimo + consumo de max_cover_days. */
function suggestParams(row, settings) {
  const daily = Number(row.daily || 0);
  const lead = Number(row.lead_days || 0);
  const min = Math.ceil(daily * lead);
  const max = Math.ceil(daily * (lead + settings.max_cover_days));
  return {
    daily,
    qty_out: row.qty_out,
    days: settings.consumption_days,
    lead_days: lead,
    max_cover_days: settings.max_cover_days,
    stock_min: min,
    stock_max: Math.max(max, min),
    has_consumption: daily > 0,
  };
}

/* ──────────────────────────────────────────────────────────────
   Salvar mín./máx./prazo (um produto ou vários)
────────────────────────────────────────────────────────────── */
async function ensureStockRow(client, productId) {
  const { rows } = await client.query(
    `SELECT product_stock_id FROM ${TB_PRODUCTS} WHERE product_id = $1 FOR UPDATE`,
    [productId],
  );
  if (!rows[0]) throw badRequest(`Produto ${productId} não encontrado.`);
  if (rows[0].product_stock_id) {
    const { rows: exists } = await client.query(`SELECT 1 FROM ${TB_STOCK} WHERE product_stock_id = $1`, [rows[0].product_stock_id]);
    if (exists[0]) return rows[0].product_stock_id;
  }
  const { rows: created } = await client.query(
    `INSERT INTO ${TB_STOCK} (stock_qty, stock_min, stock_max) VALUES (0, 0, 0) RETURNING product_stock_id`,
  );
  const stockId = created[0].product_stock_id;
  await client.query(`UPDATE ${TB_PRODUCTS} SET product_stock_id = $1 WHERE product_id = $2`, [stockId, productId]);
  return stockId;
}

/**
 * items: [{ product_id, stock_min?, stock_max?, lead_time_days? ('' = usar do fabricante), calc? }]
 * calc = true → mínimo/máximo pelo consumo (ignora stock_min/stock_max informados).
 */
export async function saveParams(items = []) {
  await ensureReplenishmentSchema();
  const list = (Array.isArray(items) ? items : []).slice(0, 2000);
  if (!list.length) throw badRequest('Nenhum produto informado.');

  const settings = await getSettings();
  const needCalc = list.some((i) => i?.calc);
  let calcRows = new Map();
  if (needCalc) {
    const ids = list.filter((i) => i?.calc).map((i) => Number(i.product_id));
    const { rows } = await listAllReplenishment({ product_ids: ids });
    calcRows = new Map(rows.map((r) => [Number(r.product_id), r]));
  }

  const client = await pool.connect();
  let updated = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');
    for (const item of list) {
      const productId = Math.trunc(Number(item?.product_id));
      if (!Number.isSafeInteger(productId) || productId <= 0) continue;

      let min = numOrNull(item.stock_min);
      let max = numOrNull(item.stock_max);
      const leadProvided = Object.prototype.hasOwnProperty.call(item, 'lead_time_days');
      let lead = leadProvided ? numOrNull(item.lead_time_days) : undefined;

      if (lead !== undefined && lead !== null && (lead < 0 || lead > 365)) {
        throw badRequest('Prazo de entrega deve ficar entre 0 e 365 dias.');
      }

      if (item.calc) {
        const row = calcRows.get(productId);
        if (!row || !(row.daily > 0)) { skipped += 1; continue; }
        const leadDays = leadProvided
          ? (lead ?? row.lead_time_manufacturer ?? settings.default_lead_time_days)
          : (row.lead_time_product ?? row.lead_time_manufacturer ?? settings.default_lead_time_days);
        const s = suggestParams({ ...row, lead_days: leadDays }, settings);
        min = s.stock_min;
        max = s.stock_max;
      }

      if (min !== null && min < 0) throw badRequest('Estoque mínimo não pode ser negativo.');
      if (max !== null && max < 0) throw badRequest('Estoque máximo não pode ser negativo.');
      if (min !== null && max !== null && max > 0 && max < min) {
        throw badRequest('O estoque máximo deve ser maior ou igual ao mínimo.');
      }

      const stockId = await ensureStockRow(client, productId);
      const sets = [];
      const vals = [];
      if (min !== null) { vals.push(min); sets.push(`stock_min = $${vals.length}`); }
      if (max !== null) { vals.push(max); sets.push(`stock_max = $${vals.length}`); }
      if (lead !== undefined) { vals.push(lead === null ? null : Math.trunc(lead)); sets.push(`lead_time_days = $${vals.length}`); }
      if (!sets.length) continue;
      vals.push(stockId);
      await client.query(
        `UPDATE ${TB_STOCK} SET ${sets.join(', ')}, updated_at = now() WHERE product_stock_id = $${vals.length}`,
        vals,
      );
      updated += 1;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, updated, skipped };
}

/* ──────────────────────────────────────────────────────────────
   Pedidos por fabricante + pedido mínimo
────────────────────────────────────────────────────────────── */
export async function listManufacturerOrders({ withComplete = true, manufacturer_id = null } = {}) {
  const settings = await getSettings();
  const cte = buildCte(settings);
  const params = [...cte.params];
  let mfFilter = '';
  if (manufacturer_id === 'none') {
    mfFilter = 'AND r.product_manufacturer_id IS NULL';
  } else if (manufacturer_id) {
    params.push(Math.trunc(Number(manufacturer_id)));
    mfFilter = `AND r.product_manufacturer_id = $${params.length}`;
  }

  const { rows } = await pool.query(`
    ${cte.sql}
    SELECT r.product_manufacturer_id AS manufacturer_id,
           COALESCE(MAX(r.manufacturer_name), 'Sem fabricante') AS manufacturer_name,
           COALESCE(MAX(r.lead_time_manufacturer), $2::int) AS lead_days,
           MAX(r.min_order_value) AS min_order_value,
           COUNT(*)::int AS items,
           SUM(r.suggestion * r.cost_price)::numeric AS total,
           COUNT(*) FILTER (WHERE r.cost_price <= 0)::int AS items_without_cost
      FROM rep r
     WHERE r.situation IN ('BUY', 'ZERO_SALES') AND r.suggestion > 0 ${mfFilter}
     GROUP BY r.product_manufacturer_id
     ORDER BY SUM(r.suggestion * r.cost_price) DESC
  `, params);

  const orders = rows.map((r) => {
    const total = Number(r.total || 0);
    const minOrder = r.min_order_value === null ? null : Number(r.min_order_value);
    const reached = minOrder === null || minOrder <= 0 || total >= minOrder;
    return {
      manufacturer_id: r.manufacturer_id,
      manufacturer_name: r.manufacturer_name,
      lead_days: r.lead_days === null ? settings.default_lead_time_days : Number(r.lead_days),
      min_order_value: minOrder,
      items: r.items,
      items_without_cost: r.items_without_cost,
      total,
      percent: minOrder ? Math.round((total / minOrder) * 100) : null,
      reached,
      missing: reached ? 0 : Math.max(0, minOrder - total),
      complete: [],
      complete_total: 0,
    };
  });

  if (withComplete) {
    const pending = orders.filter((o) => !o.reached && o.manufacturer_id);
    if (pending.length) {
      const ids = pending.map((o) => o.manufacturer_id);
      const { rows: cand } = await pool.query(`
        ${cte.sql}
        SELECT r.* FROM rep r
         WHERE r.product_manufacturer_id = ANY($4::int[])
           AND r.situation IN ('SOON', 'OK')
           AND r.daily > 0 AND r.cost_price > 0 AND r.suggestion_now > 0
         ORDER BY r.product_manufacturer_id, r.days_to_reorder ASC NULLS LAST, r.coverage_days ASC NULLS LAST
      `, [...cte.params, ids]);

      const byMf = new Map();
      cand.forEach((r) => {
        const list = byMf.get(r.product_manufacturer_id) || [];
        list.push(rowToModel(r));
        byMf.set(r.product_manufacturer_id, list);
      });

      pending.forEach((order) => {
        let acc = 0;
        for (const r of byMf.get(order.manufacturer_id) || []) {
          if (acc >= order.missing) break;
          const value = r.suggestion_now * r.cost_price;
          order.complete.push({
            product_id: r.product_id,
            product_code: r.product_code,
            product_description: r.product_description,
            days_to_reorder: r.days_to_reorder === null ? null : Math.round(r.days_to_reorder),
            qty: r.suggestion_now,
            cost_price: r.cost_price,
            value,
          });
          acc += value;
        }
        order.complete_total = acc;
        order.complete_reaches = order.total + acc >= (order.min_order_value || 0);
      });
    }
  }

  return { ok: true, orders, settings };
}

/* ──────────────────────────────────────────────────────────────
   Card da home
────────────────────────────────────────────────────────────── */
export async function getReplenishmentDashboard({ limit = 6 } = {}) {
  const settings = await getSettings();
  const cte = buildCte(settings);
  const lim = intIn(limit, 1, 20, 6);

  const [situations, buyNow, willRunOut, coverage, orders] = await Promise.all([
    summaryFor(settings),
    pool.query(`
      ${cte.sql}
      SELECT r.* FROM rep r
       WHERE r.situation IN ('BUY', 'ZERO_SALES') AND r.suggestion > 0
       ORDER BY r.situation_rank ASC, r.coverage_days ASC NULLS LAST, (r.suggestion * r.cost_price) DESC
       LIMIT ${lim}
    `, cte.params),
    pool.query(`
      ${cte.sql}
      SELECT r.* FROM rep r
       WHERE r.situation IN ('SOON', 'OK', 'OVER') AND r.coverage_days IS NOT NULL AND r.coverage_days <= 30
       ORDER BY r.order_by ASC NULLS LAST
       LIMIT ${lim}
    `, cte.params),
    pool.query(`
      ${cte.sql}
      SELECT
        COUNT(*) FILTER (WHERE r.stock_qty <= 0)::int AS zero,
        COUNT(*) FILTER (WHERE r.stock_qty > 0 AND r.coverage_days <= 7)::int AS d7,
        COUNT(*) FILTER (WHERE r.coverage_days > 7 AND r.coverage_days <= 15)::int AS d15,
        COUNT(*) FILTER (WHERE r.coverage_days > 15 AND r.coverage_days <= 30)::int AS d30,
        COUNT(*) FILTER (WHERE r.coverage_days > 30 AND r.coverage_days <= 60)::int AS d60,
        COUNT(*) FILTER (WHERE r.coverage_days > 60)::int AS d60plus,
        COUNT(*) FILTER (WHERE r.situation IN ('SOON', 'OK', 'OVER') AND r.coverage_days <= 30)::int AS will_run_out
        FROM rep r
       WHERE r.daily > 0 OR (r.situation <> 'NO_PARAMS' AND r.stock_qty <= 0)
    `, cte.params),
    listManufacturerOrders({ withComplete: false }),
  ]);

  const c = coverage.rows[0] || {};
  return {
    ok: true,
    settings,
    situations,
    buyNow: buyNow.rows.map(rowToModel),
    willRunOut: willRunOut.rows.map(rowToModel),
    willRunOutTotal: Number(c.will_run_out || 0),
    coverage: [
      { label: 'zerado', value: Number(c.zero || 0) },
      { label: '1–7 d', value: Number(c.d7 || 0) },
      { label: '8–15 d', value: Number(c.d15 || 0) },
      { label: '16–30 d', value: Number(c.d30 || 0) },
      { label: '31–60 d', value: Number(c.d60 || 0) },
      { label: '+60 d', value: Number(c.d60plus || 0) },
    ],
    orders: orders.orders,
  };
}

export default {
  ensureReplenishmentSchema,
  getSettings,
  saveSettings,
  listManufacturersReplenishment,
  listReplenishment,
  listAllReplenishment,
  getReplenishmentRow,
  listProductMovements,
  saveParams,
  listManufacturerOrders,
  getReplenishmentDashboard,
  SITUATIONS,
};
