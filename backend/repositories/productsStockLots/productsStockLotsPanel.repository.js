// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsStockLotsPanel.repository.js — Painel de lotes e validades   ║
// ║ Tela: public/productsStockLots (Estoque por Lote)                    ║
// ║                                                                      ║
// ║ - Parâmetros de alerta: public."productsStockLotsAlertSettings"      ║
// ║ - Colunas extras do lote: manufactured_at, blocked_at, block_reason  ║
// ║ - Lista com produto, situação da validade (faixas), ordem FEFO,      ║
// ║   origem NF-e, cards de resumo e Kardex do lote                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_LOTS = 'public."productsStockLots"';
const TB_SETTINGS = 'public."productsStockLotsAlertSettings"';

const ACTIONS = new Set(['ALERT', 'CONFIRM', 'BLOCK']);

export const DEFAULT_ALERT_SETTINGS = Object.freeze({
  expired_name: 'Vencido',
  expired_color: '#dc2626',
  expired_action: 'BLOCK',
  bands: [
    { name: 'Crítico', days: 30, color: '#ea580c', action: 'CONFIRM' },
    { name: 'Atenção', days: 90, color: '#d97706', action: 'ALERT' },
    { name: 'Aviso', days: 180, color: '#ca8a04', action: 'ALERT' },
  ],
  notify_dashboard: true,
  notify_sales: true,
  notify_email: false,
  emails: '',
  suggest_fefo: true,
  require_fefo: false,
  require_expiry_inbound: false,
  min_days_to_sell: 0,
});

/* ──────────────────────────────────────────────────────────────
   Schema (idempotente, roda uma vez por processo)
────────────────────────────────────────────────────────────── */
let ensurePromise = null;

async function runEnsure() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB_SETTINGS} (
      setting_id serial PRIMARY KEY,
      scope_key text NOT NULL DEFAULT 'GLOBAL',
      expired_name text NOT NULL DEFAULT 'Vencido',
      expired_color text NOT NULL DEFAULT '#dc2626',
      expired_action text NOT NULL DEFAULT 'BLOCK',
      bands jsonb NOT NULL DEFAULT '[]'::jsonb,
      notify_dashboard boolean NOT NULL DEFAULT true,
      notify_sales boolean NOT NULL DEFAULT true,
      notify_email boolean NOT NULL DEFAULT false,
      emails text NULL,
      suggest_fefo boolean NOT NULL DEFAULT true,
      require_fefo boolean NOT NULL DEFAULT false,
      require_expiry_inbound boolean NOT NULL DEFAULT false,
      min_days_to_sell integer NOT NULL DEFAULT 0,
      updated_by integer NULL,
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_psl_alert_settings_scope
      ON ${TB_SETTINGS} (scope_key);
  `);

  await pool.query(`
    ALTER TABLE ${TB_LOTS}
      ADD COLUMN IF NOT EXISTS manufactured_at date NULL,
      ADD COLUMN IF NOT EXISTS blocked_at timestamp without time zone NULL,
      ADD COLUMN IF NOT EXISTS block_reason text NULL;
  `);
}

export function ensurePanelSchema() {
  if (!ensurePromise) {
    ensurePromise = runEnsure().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

/* ──────────────────────────────────────────────────────────────
   Parâmetros de alerta
────────────────────────────────────────────────────────────── */
function cleanColor(value, fallback) {
  const v = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}

function cleanAction(value, fallback = 'ALERT') {
  const v = String(value || '').trim().toUpperCase();
  return ACTIONS.has(v) ? v : fallback;
}

export function normalizeBands(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();

  return list
    .map((b) => ({
      name: String(b?.name || '').trim().slice(0, 40),
      days: Math.trunc(Number(b?.days)),
      color: cleanColor(b?.color, '#d97706'),
      action: cleanAction(b?.action),
    }))
    .filter((b) => b.name && Number.isFinite(b.days) && b.days >= 0 && b.days <= 3650)
    .sort((a, b) => a.days - b.days)
    .filter((b) => (seen.has(b.days) ? false : seen.add(b.days)))
    .slice(0, 8);
}

function rowToSettings(row) {
  if (!row) return { ...DEFAULT_ALERT_SETTINGS, bands: [...DEFAULT_ALERT_SETTINGS.bands] };

  return {
    expired_name: row.expired_name || DEFAULT_ALERT_SETTINGS.expired_name,
    expired_color: cleanColor(row.expired_color, DEFAULT_ALERT_SETTINGS.expired_color),
    expired_action: cleanAction(row.expired_action, 'BLOCK'),
    bands: normalizeBands(row.bands),
    notify_dashboard: row.notify_dashboard !== false,
    notify_sales: row.notify_sales !== false,
    notify_email: row.notify_email === true,
    emails: row.emails || '',
    suggest_fefo: row.suggest_fefo !== false,
    require_fefo: row.require_fefo === true,
    require_expiry_inbound: row.require_expiry_inbound === true,
    min_days_to_sell: Number(row.min_days_to_sell) || 0,
    updated_at: row.updated_at || null,
  };
}

export async function getAlertSettings() {
  await ensurePanelSchema();
  const res = await pool.query(
    `SELECT * FROM ${TB_SETTINGS} WHERE scope_key = 'GLOBAL' LIMIT 1`,
  );
  return rowToSettings(res.rows[0]);
}

export async function saveAlertSettings(input = {}, userId = null) {
  await ensurePanelSchema();

  const bands = normalizeBands(input.bands);
  if (!bands.length) {
    const error = new Error('Informe pelo menos uma faixa de alerta (nome e dias).');
    error.status = 400;
    throw error;
  }

  const minDays = Math.max(0, Math.min(3650, Math.trunc(Number(input.min_days_to_sell) || 0)));
  const emails = String(input.emails || '')
    .split(/[;,\s]+/)
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .join('; ');

  const params = [
    String(input.expired_name || 'Vencido').trim().slice(0, 40) || 'Vencido',
    cleanColor(input.expired_color, '#dc2626'),
    cleanAction(input.expired_action, 'BLOCK'),
    JSON.stringify(bands),
    input.notify_dashboard !== false,
    input.notify_sales !== false,
    input.notify_email === true,
    emails || null,
    input.suggest_fefo !== false,
    input.require_fefo === true,
    input.require_expiry_inbound === true,
    minDays,
    Number(userId) || null,
  ];

  const res = await pool.query(
    `
    INSERT INTO ${TB_SETTINGS} (
      scope_key, expired_name, expired_color, expired_action, bands,
      notify_dashboard, notify_sales, notify_email, emails,
      suggest_fefo, require_fefo, require_expiry_inbound, min_days_to_sell,
      updated_by, updated_at
    ) VALUES ('GLOBAL', $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
    ON CONFLICT (scope_key) DO UPDATE SET
      expired_name = EXCLUDED.expired_name,
      expired_color = EXCLUDED.expired_color,
      expired_action = EXCLUDED.expired_action,
      bands = EXCLUDED.bands,
      notify_dashboard = EXCLUDED.notify_dashboard,
      notify_sales = EXCLUDED.notify_sales,
      notify_email = EXCLUDED.notify_email,
      emails = EXCLUDED.emails,
      suggest_fefo = EXCLUDED.suggest_fefo,
      require_fefo = EXCLUDED.require_fefo,
      require_expiry_inbound = EXCLUDED.require_expiry_inbound,
      min_days_to_sell = EXCLUDED.min_days_to_sell,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING *
    `,
    params,
  );

  return rowToSettings(res.rows[0]);
}

/* ──────────────────────────────────────────────────────────────
   Situação da validade (SQL gerado a partir das faixas)
   Os dias são inteiros já validados em normalizeBands().
────────────────────────────────────────────────────────────── */
function situationCaseSql(bands, daysExpr = 'b.days_left') {
  const parts = [
    `WHEN b.expires_at IS NULL THEN 'NONE'`,
    `WHEN ${daysExpr} < 0 THEN 'EXPIRED'`,
  ];
  bands.forEach((band, index) => {
    parts.push(`WHEN ${daysExpr} <= ${Math.trunc(band.days)} THEN 'B${index}'`);
  });
  return `CASE ${parts.join(' ')} ELSE 'OK' END`;
}

export function describeSituations(settings) {
  const list = [
    { key: 'EXPIRED', label: settings.expired_name || 'Vencido', color: settings.expired_color, action: settings.expired_action },
  ];
  let previous = -1;
  settings.bands.forEach((band, index) => {
    list.push({
      key: `B${index}`,
      label: band.name,
      color: band.color,
      action: band.action,
      days: band.days,
      fromDays: previous + 1,
    });
    previous = band.days;
  });
  list.push({ key: 'OK', label: 'Dentro da validade', color: '#16a34a', action: 'NONE', fromDays: previous + 1 });
  list.push({ key: 'NONE', label: 'Sem validade', color: '#64748b', action: 'NONE' });
  return list;
}

/* ──────────────────────────────────────────────────────────────
   Lista do painel
────────────────────────────────────────────────────────────── */
const SORT_SQL = Object.freeze({
  fefo: 'r.fefo_rank',
  product: 'r.product_description',
  grade: 'r.grade_name',
  lot: 'lower(r.lot_code)',
  expires: 'r.expires_at',
  days: 'r.days_left',
  situation: 'r.days_left',
  on_hand: 'r.qty_on_hand',
  reserved: 'r.qty_reserved',
  available: 'r.qty_available',
  origin: 'r.invoice_number',
});

/** Situações cuja ação é BLOQUEAR (não entram na ordem FEFO). Chaves geradas aqui, sem entrada do usuário. */
function blockedSituationKeys(settings) {
  const keys = [];
  if (settings.expired_action === 'BLOCK') keys.push('EXPIRED');
  settings.bands.forEach((band, index) => { if (band.action === 'BLOCK') keys.push(`B${index}`); });
  return keys;
}

function buildBaseCte(settings) {
  const blockedKeys = blockedSituationKeys(settings);
  const eligibleSql = [
    's.qty_available > 0',
    's.blocked_at IS NULL',
    ...(blockedKeys.length ? [`s.situation NOT IN (${blockedKeys.map((k) => `'${k}'`).join(', ')})`] : []),
  ].join(' AND ');

  return `
    WITH base AS (
      SELECT
        l.lot_id,
        l.product_stock_id,
        l.product_grade_id,
        l.lot_code,
        l.expires_at,
        l.manufactured_at,
        l.qty_on_hand,
        l.qty_reserved,
        (l.qty_on_hand - l.qty_reserved) AS qty_available,
        l.cost_unit,
        l.supplier_id,
        l.nfe_key,
        l.nfe_item_seq,
        l.blocked_at,
        l.block_reason,
        l.created_at,
        l.updated_at,
        (l.expires_at - CURRENT_DATE) AS days_left,
        p.product_id,
        p.product_code,
        p.description AS product_description,
        p.cost_price AS product_cost_price,
        COALESCE(g.grade, pg.grade_id::text, 'Padrão') AS grade_name,
        inv.inbound_id,
        inv.invoice_number,
        inv.entry_date,
        COALESCE(
          to_jsonb(s)->>'trade_name',
          to_jsonb(s)->>'fantasy_name',
          to_jsonb(s)->>'name',
          to_jsonb(s)->>'company_name',
          to_jsonb(s)->>'corporate_name'
        ) AS supplier_name
      FROM ${TB_LOTS} l
      LEFT JOIN LATERAL (
        SELECT pr.product_id, pr.product_code, pr.description, pr.cost_price
          FROM public.products pr
         WHERE pr.product_stock_id = l.product_stock_id
         ORDER BY pr.product_id
         LIMIT 1
      ) p ON true
      LEFT JOIN public."productsGrades" pg
        ON pg.product_grade_id = l.product_grade_id
      LEFT JOIN public."grades" g
        ON g.grade_id = pg.grade_id
      LEFT JOIN LATERAL (
        SELECT i.inbound_id, i.invoice_number, i.entry_date
          FROM public."inboundInvoices" i
         WHERE l.nfe_key IS NOT NULL
           AND TRIM(i.access_key) = TRIM(l.nfe_key)
         ORDER BY i.inbound_id DESC
         LIMIT 1
      ) inv ON true
      LEFT JOIN public.suppliers s
        ON s.supplier_id = l.supplier_id
      WHERE COALESCE(l.is_active, true) = true
        AND l.deleted_at IS NULL
    ),
    sit AS (
      SELECT b.*, ${situationCaseSql(settings.bands)} AS situation
      FROM base b
    ),
    ranked AS (
      SELECT
        s.*,
        CASE
          WHEN ${eligibleSql} THEN
            ROW_NUMBER() OVER (
              PARTITION BY
                s.product_stock_id,
                COALESCE(s.product_grade_id, 0),
                (${eligibleSql})
              ORDER BY s.expires_at ASC NULLS LAST, s.lot_id ASC
            )
        END AS fefo_rank
      FROM sit s
    )
  `;
}

function buildFilters(filters, { skipSituation = false } = {}) {
  const where = [];
  const params = [];

  const q = String(filters.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(`(
      r.lot_code ILIKE $${i}
      OR r.product_code ILIKE $${i}
      OR r.product_description ILIKE $${i}
      OR r.invoice_number::text ILIKE $${i}
    )`);
  }

  const balance = String(filters.balance || 'positive');
  if (balance === 'positive') where.push('r.qty_on_hand > 0');
  if (balance === 'zero') where.push('r.qty_on_hand <= 0');

  const blocked = String(filters.blocked || '');
  if (blocked === 'only') where.push('r.blocked_at IS NOT NULL');
  if (blocked === 'exclude') where.push('r.blocked_at IS NULL');

  const productStockId = Number(filters.product_stock_id);
  if (Number.isInteger(productStockId) && productStockId > 0) {
    params.push(productStockId);
    where.push(`r.product_stock_id = $${params.length}`);
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (isoDate.test(String(filters.expires_from || ''))) {
    params.push(filters.expires_from);
    where.push(`r.expires_at >= $${params.length}::date`);
  }
  if (isoDate.test(String(filters.expires_to || ''))) {
    params.push(filters.expires_to);
    where.push(`r.expires_at <= $${params.length}::date`);
  }

  const situation = String(filters.situation || '').toUpperCase();
  if (!skipSituation && situation === 'WITH_EXPIRY') {
    // "Com data de vencimento": todos os lotes que têm validade (esconde os sem validade)
    where.push(`r.situation <> 'NONE'`);
  } else if (!skipSituation && /^(EXPIRED|OK|NONE|B[0-7])$/.test(situation)) {
    params.push(situation);
    where.push(`r.situation = $${params.length}`);
  }

  return { where, params };
}

export async function listPanel(filters = {}) {
  await ensurePanelSchema();
  const settings = await getAlertSettings();

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(10000, Math.max(1, Number(filters.limit) || 20));
  const offset = (page - 1) * limit;

  const sortKey = SORT_SQL[filters.sort] ? filters.sort : 'expires';
  const dir = String(filters.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const orderSql = `${SORT_SQL[sortKey]} ${dir} NULLS LAST, r.expires_at ASC NULLS LAST, r.lot_id ASC`;

  const cte = buildBaseCte(settings);
  const { where, params } = buildFilters(filters);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(
    `${cte} SELECT COUNT(*)::bigint AS total FROM ranked r ${whereSql}`,
    params,
  );

  const rowsRes = await pool.query(
    `${cte}
     SELECT r.* FROM ranked r
     ${whereSql}
     ORDER BY ${orderSql}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  // Resumo por situação (mesmos filtros, sem o filtro de situação)
  const sum = buildFilters(filters, { skipSituation: true });
  const sumWhere = sum.where.length ? `WHERE ${sum.where.join(' AND ')}` : '';
  const summaryRes = await pool.query(
    `${cte}
     SELECT
       r.situation,
       COUNT(*)::int AS lots,
       COALESCE(SUM(r.qty_on_hand), 0)::numeric AS qty,
       COALESCE(SUM(r.qty_on_hand * COALESCE(r.cost_unit, r.product_cost_price, 0)), 0)::numeric AS value
     FROM ranked r
     ${sumWhere}
     GROUP BY r.situation`,
    sum.params,
  );

  const byKey = new Map(summaryRes.rows.map((row) => [row.situation, row]));
  const situations = describeSituations(settings).map((s) => ({
    ...s,
    lots: Number(byKey.get(s.key)?.lots || 0),
    qty: Number(byKey.get(s.key)?.qty || 0),
    value: Number(byKey.get(s.key)?.value || 0),
  }));

  return {
    page,
    limit,
    total: Number(countRes.rows[0]?.total || 0),
    rows: rowsRes.rows,
    situations,
    settings,
  };
}

/* ──────────────────────────────────────────────────────────────
   Extras do lote (fabricação) e bloqueio
────────────────────────────────────────────────────────────── */
export async function updateLotExtras(lotId, { manufactured_at } = {}) {
  await ensurePanelSchema();
  const value = /^\d{4}-\d{2}-\d{2}$/.test(String(manufactured_at || '')) ? manufactured_at : null;
  const res = await pool.query(
    `UPDATE ${TB_LOTS} SET manufactured_at = $2 WHERE lot_id = $1 RETURNING lot_id, manufactured_at`,
    [Number(lotId), value],
  );
  return res.rows[0] || null;
}

export async function setLotBlocked(lotId, blocked, reason = null) {
  await ensurePanelSchema();
  const res = await pool.query(
    `
    UPDATE ${TB_LOTS}
       SET blocked_at = CASE WHEN $2::boolean THEN COALESCE(blocked_at, now()) ELSE NULL END,
           block_reason = CASE WHEN $2::boolean THEN NULLIF(TRIM($3::text), '') ELSE NULL END
     WHERE lot_id = $1
    RETURNING lot_id, blocked_at, block_reason
    `,
    [Number(lotId), !!blocked, reason],
  );
  return res.rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   Dashboard da home (Início → Estoque · Validade dos lotes)
   Só lotes com saldo (qty_on_hand > 0), ativos.
────────────────────────────────────────────────────────────── */
export async function getDashboard({ upcomingLimit = 8, months = 6 } = {}) {
  await ensurePanelSchema();
  const settings = await getAlertSettings();
  const cte = buildBaseCte(settings);
  const valueSql = 'r.qty_on_hand * COALESCE(r.cost_unit, r.product_cost_price, 0)';
  const monthsN = Math.max(1, Math.min(12, Math.trunc(Number(months) || 6)));
  const limitN = Math.max(1, Math.min(50, Math.trunc(Number(upcomingLimit) || 8)));

  const [summaryRes, upcomingRes, expiredRes, monthsRes, extraRes] = await Promise.all([
    pool.query(`${cte}
      SELECT r.situation, COUNT(*)::int AS lots,
             COALESCE(SUM(r.qty_on_hand), 0)::numeric AS qty,
             COALESCE(SUM(${valueSql}), 0)::numeric AS value
        FROM ranked r WHERE r.qty_on_hand > 0 GROUP BY r.situation`),
    pool.query(`${cte}
      SELECT r.lot_id, r.lot_code, r.expires_at, r.days_left, r.situation, r.fefo_rank,
             r.product_code, r.product_description, r.qty_available, r.qty_on_hand,
             (${valueSql})::numeric AS value, r.blocked_at
        FROM ranked r
       WHERE r.qty_on_hand > 0 AND r.days_left >= 0
       ORDER BY r.expires_at ASC, r.lot_id ASC
       LIMIT ${limitN}`),
    pool.query(`${cte}
      SELECT COUNT(*)::int AS lots, COALESCE(SUM(${valueSql}), 0)::numeric AS value
        FROM ranked r WHERE r.qty_on_hand > 0 AND r.days_left < 0`),
    pool.query(`${cte}
      SELECT to_char(date_trunc('month', r.expires_at), 'YYYY-MM') AS month,
             r.situation,
             COUNT(*)::int AS lots,
             COALESCE(SUM(${valueSql}), 0)::numeric AS value
        FROM ranked r
       WHERE r.qty_on_hand > 0
         AND r.expires_at >= date_trunc('month', CURRENT_DATE)
         AND r.expires_at < date_trunc('month', CURRENT_DATE) + interval '${monthsN} months'
       GROUP BY 1, 2`),
    pool.query(`${cte}
      SELECT COUNT(*) FILTER (WHERE r.blocked_at IS NOT NULL)::int AS blocked_lots,
             COUNT(*)::int AS lots_with_balance
        FROM ranked r WHERE r.qty_on_hand > 0`),
  ]);

  const byKey = new Map(summaryRes.rows.map((row) => [row.situation, row]));
  const situations = describeSituations(settings).map((s) => ({
    ...s,
    lots: Number(byKey.get(s.key)?.lots || 0),
    qty: Number(byKey.get(s.key)?.qty || 0),
    value: Number(byKey.get(s.key)?.value || 0),
  }));

  const today = new Date();
  const monthList = Array.from({ length: monthsN }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const byMonth = monthList.map((month) => {
    const rows = monthsRes.rows.filter((row) => row.month === month);
    return {
      month,
      lots: rows.reduce((sum, row) => sum + Number(row.lots || 0), 0),
      value: rows.reduce((sum, row) => sum + Number(row.value || 0), 0),
      bySituation: Object.fromEntries(rows.map((row) => [row.situation, Number(row.value || 0)])),
    };
  });

  return {
    enabled: settings.notify_dashboard !== false,
    situations,
    upcoming: upcomingRes.rows,
    expired: {
      lots: Number(expiredRes.rows[0]?.lots || 0),
      value: Number(expiredRes.rows[0]?.value || 0),
    },
    blockedLots: Number(extraRes.rows[0]?.blocked_lots || 0),
    lotsWithBalance: Number(extraRes.rows[0]?.lots_with_balance || 0),
    byMonth,
  };
}

/** Lote com dados do produto + situação, para validar operações da tela. */
export async function getLotPanelRow(lotId) {
  await ensurePanelSchema();
  const settings = await getAlertSettings();
  const res = await pool.query(
    `${buildBaseCte(settings)} SELECT r.* FROM ranked r WHERE r.lot_id = $1 LIMIT 1`,
    [Number(lotId)],
  );
  return { row: res.rows[0] || null, settings };
}

/* ──────────────────────────────────────────────────────────────
   Kardex do lote (productMovements pelo código do produto + lote)
────────────────────────────────────────────────────────────── */
export async function listLotKardex(lotId) {
  const { row } = await getLotPanelRow(lotId);
  if (!row) return { lot: null, rows: [] };
  if (!row.product_code) return { lot: row, rows: [] };

  const res = await pool.query(
    `
    SELECT
      pm.movement_id,
      UPPER(BTRIM(pm.movement_type)) AS movement_type,
      pm.origin_module,
      pm.quantity,
      pm.previous_stock,
      pm.new_stock,
      pm.nfe_number,
      pm.notes,
      pm.created_at
    FROM public."productMovements" pm
    WHERE regexp_replace(BTRIM(pm.product_code), '^0+', '') =
          regexp_replace(BTRIM($1), '^0+', '')
      AND (
        lower(BTRIM(pm.lot_code)) = lower(BTRIM($2))
        OR pm.metadata->>'lot_id' = $3
      )
    ORDER BY pm.created_at DESC, pm.movement_id DESC
    LIMIT 300
    `,
    [row.product_code, row.lot_code, String(row.lot_id)],
  );

  return { lot: row, rows: res.rows };
}

/* ──────────────────────────────────────────────────────────────
   Produto pelo código (lupa do modal) + grades do produto
────────────────────────────────────────────────────────────── */
export async function lookupProduct(code) {
  const sku = String(code || '').trim();
  if (!sku) return null;

  const res = await pool.query(
    `
    SELECT p.product_id, p.product_code, p.description, p.product_stock_id, p.cost_price
      FROM public.products p
     WHERE BTRIM(p.product_code) = $1
        OR regexp_replace(BTRIM(p.product_code), '^0+', '') = regexp_replace($1, '^0+', '')
     ORDER BY (BTRIM(p.product_code) = $1) DESC, p.product_id
     LIMIT 1
    `,
    [sku],
  );
  const product = res.rows[0] || null;
  if (!product) return null;

  const grades = await pool.query(
    `
    SELECT pg.product_grade_id, COALESCE(g.grade, pg.grade_id::text) AS grade_name
      FROM public."productsGrades" pg
      LEFT JOIN public."grades" g ON g.grade_id = pg.grade_id
     WHERE BTRIM(pg.product_id::text) = BTRIM($1)
       AND COALESCE(pg.is_active, true) = true
     ORDER BY 2
    `,
    [String(product.product_code)],
  ).catch(() => ({ rows: [] }));

  return { ...product, grades: grades.rows };
}

export default {
  getDashboard,
  lookupProduct,
  ensurePanelSchema,
  getAlertSettings,
  saveAlertSettings,
  listPanel,
  describeSituations,
  updateLotExtras,
  setLotBlocked,
  getLotPanelRow,
  listLotKardex,
};
