// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ OrdersLogisticsPackingController.js — Montar Pedido para Despacho       ║
// ║ Path: backend/controllers/OrdersLogisticsPackingController.js           ║
// ║ CONSART ERP | ESM | Express | PostgreSQL                                ║
// ║                                                                          ║
// ║ Monta volumes a partir de um PEDIDO ou de um ORÇAMENTO.                  ║
// ║                                                                          ║
// ║ Origens:                                                                 ║
// ║  - ORDER  → public.orders  + public."ordersItems" (fallback "orderItems")║
// ║  - BUDGET → public.budgets + public."budgetsItems"                       ║
// ║                                                                          ║
// ║ Tabelas do módulo (garantidas no boot por ensurePackingSchema):          ║
// ║  - public."orderVolumes"     (source_type ORDER|BUDGET, order_id |       ║
// ║                               budget_id, medidas, tara, peso, cubagem)   ║
// ║  - public."orderVolumeItems" (order_item_id | budget_item_id, qtd na     ║
// ║                               unidade do item, peso/medidas unitários)   ║
// ║                                                                          ║
// ║ Peso/medidas vêm de public."productsBarCode" (unidade do item).          ║
// ║                                                                          ║
// ║ Rotas: ver routes/OrdersLogisticsPackingRoutes.js                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../config/db.js';
import {
  generateOrdersLogisticsPackingPdf,
  generateOrdersLogisticsPackingLabelsPdf,
} from '../generationPdf/generateOrdersLogisticsPackingPdf.js';

/* ──────────────────────────────────────────────────────────────
   Constantes
────────────────────────────────────────────────────────────── */
const TB_VOL = 'public."orderVolumes"';
const TB_VI = 'public."orderVolumeItems"';
const TB_PBC = 'public."productsBarCode"';

const VOLUME_TYPES = Object.freeze(['BOX', 'PALLET', 'BUNDLE', 'BAG', 'OTHER']);

/**
 * Configuração de cada origem.
 * - volCol / viCol: colunas em orderVolumes / orderVolumeItems
 * - items: resolvido em runtime (resolveItemsMeta)
 */
const SOURCES = Object.freeze({
  ORDER: Object.freeze({
    key: 'ORDER',
    label: 'Pedido',
    head: 'public.orders',
    headPk: 'order_id',
    itemsCandidates: ['ordersItems', 'orderItems'],
    itemPk: 'order_item_id',
    itemFk: 'order_id',
    volCol: 'order_id',
    viCol: 'order_item_id',
  }),
  BUDGET: Object.freeze({
    key: 'BUDGET',
    label: 'Orçamento',
    head: 'public.budgets',
    headPk: 'budget_id',
    itemsCandidates: ['budgetsItems'],
    itemPk: 'budget_item_id',
    itemFk: 'budget_id',
    volCol: 'budget_id',
    viCol: 'budget_item_id',
  }),
});

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const toNum = (v, def = 0) => {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
};
const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const round3 = (v) => Math.round(toNum(v, 0) * 1000) / 1000;
/** DATE do pg vem como Date na meia-noite local: devolve 'YYYY-MM-DD'. */
const ymd = (v) => {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(+v)) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};
const qid = (name) => `"${String(name).replaceAll('"', '""')}"`;

/** productsBarCode às vezes guarda medidas em metros (0,40 = 40 cm). */
const normalizeCm = (v) => {
  const n = toNum(v, 0);
  if (!(n > 0)) return 0;
  return n < 1 ? n * 100 : n;
};

function ok(res, data = {}) {
  return res.json({ ok: true, ...data });
}
function bad(res, msg, code = 400, extra = {}) {
  return res.status(code).json({ ok: false, error: msg, ...extra });
}

class HttpError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

function parseSource(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'ORDER' || s === 'PEDIDO') return SOURCES.ORDER;
  if (s === 'BUDGET' || s === 'ORCAMENTO' || s === 'ORÇAMENTO') return SOURCES.BUDGET;
  return null;
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Executa fn numa transação; HttpError vira resposta 4xx. */
async function inTx(res, label, fn) {
  try {
    const out = await withClient(async (client) => {
      await ensurePackingSchema();
      await client.query('BEGIN');
      try {
        const r = await fn(client);
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => { });
        throw e;
      }
    });
    return ok(res, out || {});
  } catch (err) {
    if (err instanceof HttpError) return bad(res, err.message, err.code);
    console.error(`${label} error:`, err);
    return bad(res, `Falha ao ${label}.`, 500);
  }
}

/* ──────────────────────────────────────────────────────────────
   Metadados (colunas existentes) — cache por processo
────────────────────────────────────────────────────────────── */
const columnsCache = new Map();

async function getColumns(client, tableName) {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName);
  const r = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const set = new Set(r.rows.map((x) => x.column_name));
  if (set.size) columnsCache.set(tableName, set);
  return set;
}

const pick = (cols, names) => names.find((n) => cols.has(n)) || null;

/**
 * Descobre a tabela de itens e o nome das colunas
 * (tabelas novas: product_code/unit_code/conversion_factor/barcode_id;
 *  legado "orderItems": sku/unit).
 */
async function resolveItemsMeta(client, src) {
  for (const t of src.itemsCandidates) {
    const cols = await getColumns(client, t);
    if (!cols.size || !cols.has(src.itemPk) || !cols.has(src.itemFk)) continue;
    return {
      table: `public.${qid(t)}`,
      tableName: t,
      code: pick(cols, ['product_code', 'sku']),
      unit: pick(cols, ['unit_code', 'unit']),
      factor: pick(cols, ['conversion_factor']),
      barcode: pick(cols, ['barcode_id']),
      qty: pick(cols, ['quantity']),
      desc: pick(cols, ['description']),
    };
  }
  throw new HttpError(500, `Tabela de itens de ${src.label.toLowerCase()} não encontrada.`);
}

/** SELECT padronizado dos itens da origem (alias i). */
function itemSelectSql(src, meta) {
  return `
    i.${qid(src.itemPk)}                                 AS item_id,
    i.${qid(src.itemFk)}                                 AS source_id,
    ${meta.code ? `i.${qid(meta.code)}::text` : `''`}    AS product_code,
    ${meta.desc ? `i.${qid(meta.desc)}` : `''`}          AS description,
    ${meta.unit ? `i.${qid(meta.unit)}::text` : `'UN'`}  AS unit,
    ${meta.factor ? `COALESCE(i.${qid(meta.factor)}, 1)` : '1'} AS conversion_factor,
    ${meta.barcode ? `i.${qid(meta.barcode)}` : 'NULL::bigint'} AS barcode_id,
    COALESCE(i.${qid(meta.qty || 'quantity')}, 0)        AS ordered_qty`;
}

/* ──────────────────────────────────────────────────────────────
   Schema (criado/ajustado no boot, sem apagar dados)
────────────────────────────────────────────────────────────── */
let schemaPromise = null;

export function ensurePackingSchema() {
  if (!schemaPromise) {
    schemaPromise = withClient(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TB_VOL} (
          id            BIGSERIAL PRIMARY KEY,
          source_type   VARCHAR(10)   NOT NULL DEFAULT 'ORDER',
          order_id      BIGINT,
          budget_id     BIGINT,
          volume_number INTEGER       NOT NULL DEFAULT 1,
          volume_type   VARCHAR(20)   NOT NULL DEFAULT 'BOX',
          description   TEXT,
          height_cm     NUMERIC(12,3) NOT NULL DEFAULT 0,
          width_cm      NUMERIC(12,3) NOT NULL DEFAULT 0,
          length_cm     NUMERIC(12,3) NOT NULL DEFAULT 0,
          tare_kg       NUMERIC(12,3) NOT NULL DEFAULT 0,
          volume_m3     NUMERIC(14,6) NOT NULL DEFAULT 0,
          weight_kg     NUMERIC(14,3) NOT NULL DEFAULT 0,
          status        VARCHAR(20)   NOT NULL DEFAULT 'OPEN',
          notes         TEXT,
          created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TB_VI} (
          id                BIGSERIAL PRIMARY KEY,
          volume_id         BIGINT NOT NULL REFERENCES ${TB_VOL}(id) ON DELETE CASCADE,
          order_item_id     BIGINT,
          budget_item_id    BIGINT,
          quantity          NUMERIC(14,3) NOT NULL DEFAULT 0,
          product_unit_id   INTEGER,
          unit              VARCHAR(50),
          fator             NUMERIC(14,6) NOT NULL DEFAULT 1,
          weight_source     VARCHAR(20),
          dimensions_source VARCHAR(20),
          unit_weight_kg    NUMERIC(14,4) NOT NULL DEFAULT 0,
          unit_height_cm    NUMERIC(12,3) NOT NULL DEFAULT 0,
          unit_width_cm     NUMERIC(12,3) NOT NULL DEFAULT 0,
          unit_length_cm    NUMERIC(12,3) NOT NULL DEFAULT 0,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      // Tabelas antigas: colunas novas + order_id / order_item_id opcionais
      await client.query(`
        ALTER TABLE ${TB_VOL}
          ADD COLUMN IF NOT EXISTS source_type VARCHAR(10)   NOT NULL DEFAULT 'ORDER',
          ADD COLUMN IF NOT EXISTS budget_id   BIGINT,
          ADD COLUMN IF NOT EXISTS volume_m3   NUMERIC(14,6) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS weight_kg   NUMERIC(14,3) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS status      VARCHAR(20)   NOT NULL DEFAULT 'OPEN',
          ADD COLUMN IF NOT EXISTS notes       TEXT,
          ADD COLUMN IF NOT EXISTS description TEXT,
          ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now();
      `);
      await client.query(`ALTER TABLE ${TB_VOL} ALTER COLUMN order_id DROP NOT NULL;`);

      await client.query(`
        ALTER TABLE ${TB_VI}
          ADD COLUMN IF NOT EXISTS budget_item_id    BIGINT,
          ADD COLUMN IF NOT EXISTS product_unit_id   INTEGER,
          ADD COLUMN IF NOT EXISTS unit              VARCHAR(50),
          ADD COLUMN IF NOT EXISTS fator             NUMERIC(14,6) NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS weight_source     VARCHAR(20),
          ADD COLUMN IF NOT EXISTS dimensions_source VARCHAR(20),
          ADD COLUMN IF NOT EXISTS unit_weight_kg    NUMERIC(14,4) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS unit_height_cm    NUMERIC(12,3) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS unit_width_cm     NUMERIC(12,3) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS unit_length_cm    NUMERIC(12,3) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();
      `);
      await client.query(`ALTER TABLE ${TB_VI} ALTER COLUMN order_item_id DROP NOT NULL;`);

      // Pedidos atuais gravam em "ordersItems": a FK antiga para "orderItems"
      // impediria embalar esses itens. Remove só FK que aponte para "orderItems".
      await client.query(`
        DO $$
        DECLARE r record;
        BEGIN
          IF to_regclass('public."ordersItems"') IS NOT NULL
             AND to_regclass('public."orderItems"') IS NOT NULL THEN
            FOR r IN
              SELECT conname
                FROM pg_constraint
               WHERE conrelid = 'public."orderVolumeItems"'::regclass
                 AND contype = 'f'
                 AND confrelid = 'public."orderItems"'::regclass
            LOOP
              EXECUTE format('ALTER TABLE public."orderVolumeItems" DROP CONSTRAINT %I', r.conname);
            END LOOP;
          END IF;
        END $$;
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_order_volumes_order  ON ${TB_VOL} (order_id)  WHERE order_id  IS NOT NULL;`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_order_volumes_budget ON ${TB_VOL} (budget_id) WHERE budget_id IS NOT NULL;`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_order_volume_items_volume ON ${TB_VI} (volume_id);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_order_volume_items_oi ON ${TB_VI} (order_item_id)  WHERE order_item_id  IS NOT NULL;`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_order_volume_items_bi ON ${TB_VI} (budget_item_id) WHERE budget_item_id IS NOT NULL;`);

      columnsCache.clear();
    }).catch((err) => {
      schemaPromise = null; // tenta de novo na próxima chamada
      throw err;
    });
  }
  return schemaPromise;
}

// Boot: garante as colunas assim que o servidor sobe (não derruba o servidor)
ensurePackingSchema().catch((err) => console.error('[packing] ensurePackingSchema:', err.message));

/* ──────────────────────────────────────────────────────────────
   Leitura
────────────────────────────────────────────────────────────── */
async function getHead(client, src, id) {
  const r = await client.query(`SELECT * FROM ${src.head} WHERE ${qid(src.headPk)} = $1`, [id]);
  if (!r.rowCount) throw new HttpError(404, `${src.label} ${id} não encontrado.`);
  return r.rows[0];
}

/** Transportadora (best effort: nunca quebra a tela). */
async function getCarrierName(client, src, head) {
  try {
    if (src.key === 'ORDER' && head.order_shipping_id) {
      const r = await client.query(
        `SELECT carrier_name FROM public."ordersShipping" WHERE order_shipping_id = $1`,
        [head.order_shipping_id]
      );
      return r.rows[0]?.carrier_name || null;
    }
    if (src.key === 'BUDGET' && head.budget_shipping_id) {
      const r = await client.query(
        `SELECT COALESCE(NULLIF(t.trade_name, ''), t.legal_name) AS name
           FROM public."budgetsShipping" s
           LEFT JOIN public.transporters t ON t.transporter_id = s.transporter_id
          WHERE s.budget_shipping_id = $1`,
        [head.budget_shipping_id]
      );
      return r.rows[0]?.name || null;
    }
  } catch (err) {
    console.warn('[packing] transportadora:', err.message);
  }
  return null;
}

/** Itens da origem com pedido / embalado / restante. */
async function getItems(client, src, meta, id) {
  const r = await client.query(
    `
    SELECT ${itemSelectSql(src, meta)},
           COALESCE(p.packed_qty, 0) AS packed_qty
      FROM ${meta.table} i
      LEFT JOIN (
        SELECT vi.${qid(src.viCol)} AS item_id, SUM(vi.quantity) AS packed_qty
          FROM ${TB_VI} vi
          JOIN ${TB_VOL} v ON v.id = vi.volume_id
         WHERE v.source_type = $2 AND v.${qid(src.volCol)} = $1
         GROUP BY vi.${qid(src.viCol)}
      ) p ON p.item_id = i.${qid(src.itemPk)}
     WHERE i.${qid(src.itemFk)} = $1
     ORDER BY i.${qid(src.itemPk)} ASC
    `,
    [id, src.key]
  );

  const items = r.rows.map((x) => {
    const ordered = toNum(x.ordered_qty, 0);
    const packed = toNum(x.packed_qty, 0);
    return {
      ...x,
      ordered_qty: ordered,
      packed_qty: packed,
      remaining_qty: round3(Math.max(ordered - packed, 0)),
      conversion_factor: toNum(x.conversion_factor, 1) || 1,
      units: [],
    };
  });

  // Unidades ativas (productsBarCode) de cada produto
  const codes = [...new Set(items.map((x) => x.product_code).filter(Boolean))];
  if (codes.length) {
    const u = await client.query(
      `
      SELECT barcode_id, product_code::text AS product_code, product_unit_id, barcode,
             unit, COALESCE(fator, 1) AS fator, COALESCE(standard, false) AS standard,
             COALESCE(weight_kg, 0) AS weight_kg, COALESCE(height_cm, 0) AS height_cm,
             COALESCE(width_cm, 0) AS width_cm, COALESCE(length_cm, 0) AS length_cm
        FROM ${TB_PBC}
       WHERE product_code::text = ANY($1::text[])
         AND is_active IS TRUE
       ORDER BY product_code, COALESCE(standard, false) DESC, fator ASC, barcode_id ASC
      `,
      [codes]
    );
    const byCode = new Map();
    for (const row of u.rows) {
      const unit = {
        barcode_id: row.barcode_id,
        product_unit_id: row.product_unit_id,
        barcode: row.barcode,
        unit: row.unit || 'UN',
        fator: toNum(row.fator, 1) || 1,
        standard: !!row.standard,
        weight_kg: toNum(row.weight_kg, 0),
        height_cm: normalizeCm(row.height_cm),
        width_cm: normalizeCm(row.width_cm),
        length_cm: normalizeCm(row.length_cm),
      };
      if (!byCode.has(row.product_code)) byCode.set(row.product_code, []);
      byCode.get(row.product_code).push(unit);
    }
    for (const it of items) it.units = byCode.get(it.product_code) || [];
  }

  // Peso/medidas por unidade do item (barcode do item → mesma unidade → padrão)
  for (const it of items) {
    const base =
      it.units.find((u) => it.barcode_id && Number(u.barcode_id) === Number(it.barcode_id)) ||
      it.units.find((u) => String(u.unit).toUpperCase() === String(it.unit).toUpperCase()) ||
      it.units.find((u) => u.standard) ||
      it.units[0] ||
      null;
    it.unit_weight_kg = base ? base.weight_kg : 0;
    it.unit_height_cm = base ? base.height_cm : 0;
    it.unit_width_cm = base ? base.width_cm : 0;
    it.unit_length_cm = base ? base.length_cm : 0;
    it.unit_barcode_id = base ? base.barcode_id : null;
  }

  return items;
}

async function getItemById(client, src, meta, itemId) {
  const r = await client.query(
    `SELECT ${itemSelectSql(src, meta)} FROM ${meta.table} i WHERE i.${qid(src.itemPk)} = $1`,
    [itemId]
  );
  return r.rows[0] || null;
}

async function getPackedQty(client, src, itemId, exceptVolumeItemId = null) {
  const r = await client.query(
    `SELECT COALESCE(SUM(quantity), 0) AS q
       FROM ${TB_VI}
      WHERE ${qid(src.viCol)} = $1
        AND ($2::bigint IS NULL OR id <> $2)`,
    [itemId, exceptVolumeItemId]
  );
  return toNum(r.rows[0]?.q, 0);
}

async function recalcVolume(client, volumeId) {
  await client.query(
    `
    UPDATE ${TB_VOL} v
       SET volume_m3 = (COALESCE(v.height_cm,0) * COALESCE(v.width_cm,0) * COALESCE(v.length_cm,0)) / 1000000.0,
           weight_kg = COALESCE(v.tare_kg,0) + COALESCE((
             SELECT SUM(COALESCE(vi.quantity,0) * COALESCE(vi.unit_weight_kg,0))
               FROM ${TB_VI} vi WHERE vi.volume_id = v.id
           ), 0),
           updated_at = now()
     WHERE v.id = $1
    `,
    [volumeId]
  );
}

async function getVolume(client, volumeId) {
  const r = await client.query(`SELECT * FROM ${TB_VOL} WHERE id = $1`, [volumeId]);
  if (!r.rowCount) throw new HttpError(404, 'Volume não encontrado.');
  const v = r.rows[0];
  const src = parseSource(v.source_type) || SOURCES.ORDER;
  return { volume: v, src, sourceId: v[src.volCol] };
}

async function buildSummary(client, src, id) {
  const meta = await resolveItemsMeta(client, src);
  const head = await getHead(client, src, id);
  const carrier = await getCarrierName(client, src, head);

  // mantém peso/cubagem em dia (inclui volumes antigos, anteriores às colunas novas)
  const ids = await client.query(
    `SELECT id FROM ${TB_VOL} WHERE source_type = $2 AND ${qid(src.volCol)} = $1`,
    [id, src.key]
  );
  for (const row of ids.rows) await recalcVolume(client, row.id);

  const volumesR = await client.query(
    `SELECT * FROM ${TB_VOL}
      WHERE source_type = $2 AND ${qid(src.volCol)} = $1
      ORDER BY volume_number ASC, id ASC`,
    [id, src.key]
  );

  const items = await getItems(client, src, meta, id);
  const itemsById = new Map(items.map((x) => [String(x.item_id), x]));

  const viR = await client.query(
    `SELECT vi.*, v.volume_number
       FROM ${TB_VI} vi
       JOIN ${TB_VOL} v ON v.id = vi.volume_id
      WHERE v.source_type = $2 AND v.${qid(src.volCol)} = $1
      ORDER BY v.volume_number ASC, vi.id ASC`,
    [id, src.key]
  );

  const volumeItems = viR.rows.map((vi) => {
    const it = itemsById.get(String(vi[src.viCol])) || {};
    const qty = toNum(vi.quantity, 0);
    return {
      ...vi,
      item_id: vi[src.viCol],
      product_code: it.product_code || '',
      sku: it.product_code || '',
      description: it.description || '(item não encontrado no cadastro atual)',
      unit: it.unit || vi.unit || 'UN',
      quantity: qty,
      line_weight_kg: round3(qty * toNum(vi.unit_weight_kg, 0)),
    };
  });

  const volumes = volumesR.rows.map((v) => ({
    ...v,
    height_cm: toNum(v.height_cm, 0),
    width_cm: toNum(v.width_cm, 0),
    length_cm: toNum(v.length_cm, 0),
    tare_kg: toNum(v.tare_kg, 0),
    volume_m3: toNum(v.volume_m3, 0),
    weight_kg: toNum(v.weight_kg, 0),
  }));

  const orderedTotal = items.reduce((a, x) => a + x.ordered_qty, 0);
  const packedTotal = items.reduce((a, x) => a + Math.min(x.packed_qty, x.ordered_qty), 0);
  const pending = items.filter((x) => x.remaining_qty > 0);

  return {
    source: src.key,
    sourceLabel: src.label,
    sourceId: id,
    head: {
      id,
      status: head.status ?? null,
      issue_date: ymd(head.issue_date ?? head.created_at ?? null),
      customer_name: head.customer_name ?? null,
      customer_tax_id: head.customer_tax_id ?? null,
      total_amount: head.total_amount ?? null,
      carrier_name: carrier,
    },
    items,
    volumes,
    volumeItems,
    totals: {
      volumes: volumes.length,
      items: items.length,
      pending_items: pending.length,
      pending_qty: round3(pending.reduce((a, x) => a + x.remaining_qty, 0)),
      packed_pct: orderedTotal > 0 ? Math.round((packedTotal / orderedTotal) * 1000) / 10 : 0,
      weight_kg: round3(volumes.reduce((a, v) => a + v.weight_kg, 0)),
      volume_m3: Math.round(volumes.reduce((a, v) => a + v.volume_m3, 0) * 1e6) / 1e6,
    },
  };
}

/* ──────────────────────────────────────────────────────────────
   Controllers — leitura
────────────────────────────────────────────────────────────── */
function readSourceParams(req) {
  // Rotas novas: /sources/:source/:id   |   legado: /orders/:orderId
  const src = req.params.source ? parseSource(req.params.source) : SOURCES.ORDER;
  const id = toInt(req.params.id ?? req.params.orderId);
  if (!src) throw new HttpError(400, 'Origem inválida (use ORDER ou BUDGET).');
  if (!id) throw new HttpError(400, 'Número inválido.');
  return { src, id };
}

export async function getSummary(req, res) {
  try {
    const { src, id } = readSourceParams(req);
    await ensurePackingSchema();
    const data = await withClient((client) => buildSummary(client, src, id));
    return ok(res, data);
  } catch (err) {
    if (err instanceof HttpError) return bad(res, err.message, err.code);
    console.error('packing getSummary error:', err);
    return bad(res, 'Falha ao carregar os itens e volumes.', 500);
  }
}

/** GET /search?q=&source=ALL|ORDER|BUDGET&situation=PENDING|ALL&limit= */
export async function searchSources(req, res) {
  const q = String(req.query.q || '').trim();
  const source = String(req.query.source || 'ALL').toUpperCase();
  const situation = String(req.query.situation || 'PENDING').toUpperCase();
  const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit || '30', 10) || 30, 100));

  try {
    await ensurePackingSchema();
    const rows = await withClient(async (client) => {
      const parts = [];
      const params = [];

      const qNum = /^\d+$/.test(q) ? q : null;
      params.push(q ? `%${q}%` : null); // $1
      params.push(qNum);                // $2

      for (const src of [SOURCES.ORDER, SOURCES.BUDGET]) {
        if (source !== 'ALL' && source !== src.key) continue;
        let meta;
        try {
          meta = await resolveItemsMeta(client, src);
        } catch {
          continue;
        }
        const headCols = await getColumns(client, src.head.replace('public.', ''));
        const has = (c) => headCols.has(c);

        params.push(src.key);
        const pSrc = `$${params.length}`;

        parts.push(`
          SELECT ${pSrc}::text AS source,
                 h.${qid(src.headPk)} AS id,
                 ${has('customer_name') ? 'h.customer_name' : 'NULL::text'} AS customer_name,
                 ${has('issue_date') ? 'h.issue_date' : has('created_at') ? 'h.created_at::date' : 'NULL::date'} AS issue_date,
                 ${has('status') ? 'h.status' : 'NULL::text'} AS status,
                 ${has('total_amount') ? 'h.total_amount' : 'NULL::numeric'} AS total_amount,
                 pk.ordered, pk.packed
            FROM ${src.head} h
            CROSS JOIN LATERAL (
              SELECT COALESCE(SUM(COALESCE(i.${qid(meta.qty || 'quantity')},0)), 0) AS ordered,
                     COALESCE(SUM(LEAST(COALESCE(p.q,0), COALESCE(i.${qid(meta.qty || 'quantity')},0))), 0) AS packed
                FROM ${meta.table} i
                LEFT JOIN (
                  SELECT vi.${qid(src.viCol)} AS item_id, SUM(vi.quantity) AS q
                    FROM ${TB_VI} vi
                    JOIN ${TB_VOL} v ON v.id = vi.volume_id
                   WHERE v.source_type = ${pSrc} AND v.${qid(src.volCol)} = h.${qid(src.headPk)}
                   GROUP BY 1
                ) p ON p.item_id = i.${qid(src.itemPk)}
               WHERE i.${qid(src.itemFk)} = h.${qid(src.headPk)}
            ) pk
           WHERE (
             $1::text IS NULL
             OR h.${qid(src.headPk)}::text = $2
             ${has('customer_name') ? `OR h.customer_name ILIKE $1` : ''}
             ${has('customer_tax_id') ? `OR h.customer_tax_id ILIKE $1` : ''}
             ${has('status') ? `OR h.status ILIKE $1` : ''}
           )
        `);
      }

      if (!parts.length) return [];

      params.push(limit);
      const sql = `
        SELECT * FROM (${parts.join(' UNION ALL ')}) x
         WHERE x.ordered > 0
           ${situation === 'PENDING' ? 'AND x.packed < x.ordered' : ''}
         ORDER BY x.issue_date DESC NULLS LAST, x.id DESC
         LIMIT $${params.length}
      `;
      const r = await client.query(sql, params);
      return r.rows.map((x) => ({
        ...x,
        issue_date: ymd(x.issue_date),
        label: x.source === 'BUDGET' ? 'Orçamento' : 'Pedido',
        packed_pct: toNum(x.ordered, 0) > 0
          ? Math.round((toNum(x.packed, 0) / toNum(x.ordered, 0)) * 1000) / 10
          : 0,
      }));
    });
    return ok(res, { rows });
  } catch (err) {
    console.error('packing search error:', err);
    return bad(res, 'Falha ao pesquisar pedidos/orçamentos.', 500);
  }
}

/* ──────────────────────────────────────────────────────────────
   Controllers — volumes
────────────────────────────────────────────────────────────── */
function readVolumeBody(b = {}, { partial = false } = {}) {
  const out = {};
  const type = String(b.volume_type ?? '').trim().toUpperCase();
  if (!partial || b.volume_type !== undefined) {
    out.volume_type = VOLUME_TYPES.includes(type) ? type : 'BOX';
  }
  for (const k of ['height_cm', 'width_cm', 'length_cm', 'tare_kg']) {
    if (!partial || b[k] !== undefined) {
      const v = toNum(b[k], 0);
      if (v < 0) throw new HttpError(400, 'Medidas e tara não podem ser negativas.');
      out[k] = v;
    }
  }
  if (!partial || b.description !== undefined) out.description = String(b.description ?? '').trim() || null;
  if (!partial || b.notes !== undefined) out.notes = String(b.notes ?? '').trim() || null;
  return out;
}

/** POST /sources/:source/:id/volumes  (body.copies = volumes iguais) */
export async function createVolume(req, res) {
  let src, id, body, copies;
  try {
    ({ src, id } = readSourceParams(req));
    body = readVolumeBody(req.body);
    copies = Math.max(1, Math.min(toInt(req.body?.copies) || 1, 50));
  } catch (err) {
    return bad(res, err.message, err.code || 400);
  }

  return inTx(res, 'criar volume', async (client) => {
    await getHead(client, src, id);
    // trava por origem para numerar sem duplicar
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`packing:${src.key}:${id}`]);

    const rows = [];
    for (let k = 0; k < copies; k++) {
      const nx = await client.query(
        `SELECT COALESCE(MAX(volume_number), 0) + 1 AS n
           FROM ${TB_VOL} WHERE source_type = $2 AND ${qid(src.volCol)} = $1`,
        [id, src.key]
      );
      const ins = await client.query(
        `INSERT INTO ${TB_VOL}
           (source_type, ${qid(src.volCol)}, volume_number, volume_type, description,
            height_cm, width_cm, length_cm, tare_kg, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [src.key, id, Number(nx.rows[0].n), body.volume_type, body.description,
          body.height_cm, body.width_cm, body.length_cm, body.tare_kg, body.notes]
      );
      await recalcVolume(client, ins.rows[0].id);
      rows.push(ins.rows[0]);
    }
    return { rows, row: rows[0] };
  });
}

export async function updateVolume(req, res) {
  const volumeId = toInt(req.params.volumeId);
  if (!volumeId) return bad(res, 'Volume inválido.');
  let body;
  try {
    body = readVolumeBody(req.body, { partial: true });
  } catch (err) {
    return bad(res, err.message, err.code || 400);
  }
  const keys = Object.keys(body);
  if (!keys.length) return bad(res, 'Nada para atualizar.');

  return inTx(res, 'atualizar volume', async (client) => {
    await getVolume(client, volumeId);
    const sets = keys.map((k, i) => `${qid(k)} = $${i + 1}`);
    await client.query(
      `UPDATE ${TB_VOL} SET ${sets.join(', ')}, updated_at = now() WHERE id = $${keys.length + 1}`,
      [...keys.map((k) => body[k]), volumeId]
    );
    await recalcVolume(client, volumeId);
    const r = await client.query(`SELECT * FROM ${TB_VOL} WHERE id = $1`, [volumeId]);
    return { row: r.rows[0] };
  });
}

/** Exclui o volume (itens voltam a ficar pendentes) e renumera os demais. */
export async function deleteVolume(req, res) {
  const volumeId = toInt(req.params.volumeId);
  if (!volumeId) return bad(res, 'Volume inválido.');

  return inTx(res, 'excluir volume', async (client) => {
    const { src, sourceId } = await getVolume(client, volumeId);
    await client.query(`DELETE FROM ${TB_VI} WHERE volume_id = $1`, [volumeId]);
    await client.query(`DELETE FROM ${TB_VOL} WHERE id = $1`, [volumeId]);
    // renumera em ordem crescente (só desce números: não colide com UNIQUE antigo)
    const rest = await client.query(
      `SELECT id, volume_number FROM ${TB_VOL}
        WHERE source_type = $2 AND ${qid(src.volCol)} = $1
        ORDER BY volume_number, id`,
      [sourceId, src.key]
    );
    let n = 0;
    for (const row of rest.rows) {
      n += 1;
      if (Number(row.volume_number) !== n) {
        await client.query(
          `UPDATE ${TB_VOL} SET volume_number = $1, updated_at = now() WHERE id = $2`,
          [n, row.id]
        );
      }
    }
    return { deleted: true, volumeId };
  });
}

/* ──────────────────────────────────────────────────────────────
   Controllers — itens dos volumes
────────────────────────────────────────────────────────────── */

/**
 * POST /volumes/:volumeId/items
 * body: { item_id, quantity, unit_barcode_id?, unit_weight_kg?, unit_height_cm?, ... }
 * - quantity na unidade escolhida; converte para a unidade do item
 *   (qtdItem = qtd × fatorEscolhido ÷ fatorItem)
 */
export async function addItemToVolume(req, res) {
  const volumeId = toInt(req.params.volumeId);
  const b = req.body || {};
  const itemId = toInt(b.item_id ?? b.order_item_id ?? b.budget_item_id);
  const qtyInput = toNum(b.quantity, 0);

  if (!volumeId) return bad(res, 'Volume inválido.');
  if (!itemId) return bad(res, 'Item inválido.');
  if (!(qtyInput > 0)) return bad(res, 'Informe uma quantidade maior que zero.');

  return inTx(res, 'adicionar item ao volume', async (client) => {
    const { src, sourceId } = await getVolume(client, volumeId);
    const meta = await resolveItemsMeta(client, src);

    const item = await getItemById(client, src, meta, itemId);
    if (!item) throw new HttpError(404, 'Item não encontrado.');
    if (Number(item.source_id) !== Number(sourceId)) {
      throw new HttpError(409, `Item pertence a outro ${src.label.toLowerCase()}.`);
    }

    // Unidades do produto
    const items = await getItems(client, src, meta, sourceId);
    const full = items.find((x) => Number(x.item_id) === Number(itemId));
    const itemFactor = toNum(full?.conversion_factor, 1) || 1;
    const chosen = (full?.units || []).find((u) => Number(u.barcode_id) === Number(b.unit_barcode_id)) || null;
    const chosenFactor = chosen ? chosen.fator : itemFactor;

    const qtyItem = round3((qtyInput * chosenFactor) / itemFactor);
    if (!(qtyItem > 0)) throw new HttpError(400, 'Quantidade inválida.');

    const remaining = round3(toNum(item.ordered_qty, 0) - (await getPackedQty(client, src, itemId)));
    if (qtyItem > remaining + 0.0005) {
      throw new HttpError(409, `Quantidade maior que o restante (${remaining.toLocaleString('pt-BR')} ${full?.unit || ''}).`);
    }

    // Peso/medidas por unidade do item (manual > unidade do item > convertida da escolhida)
    let w = toNum(b.unit_weight_kg, NaN);
    if (!Number.isFinite(w)) {
      w = toNum(full?.unit_weight_kg, 0);
      if (!(w > 0) && chosen?.weight_kg > 0) w = (chosen.weight_kg * itemFactor) / chosenFactor;
    }
    const dim = (k) => {
      const manual = toNum(b[`unit_${k}`], NaN);
      if (Number.isFinite(manual)) return normalizeCm(manual);
      return toNum(full?.[`unit_${k}`], 0);
    };

    const existing = await client.query(
      `SELECT id, quantity FROM ${TB_VI} WHERE volume_id = $1 AND ${qid(src.viCol)} = $2 LIMIT 1`,
      [volumeId, itemId]
    );

    let row;
    if (existing.rowCount) {
      const up = await client.query(
        `UPDATE ${TB_VI}
            SET quantity = quantity + $1, unit_weight_kg = $2, updated_at = now()
          WHERE id = $3 RETURNING *`,
        [qtyItem, w, existing.rows[0].id]
      );
      row = up.rows[0];
    } else {
      const ins = await client.query(
        `INSERT INTO ${TB_VI}
           (volume_id, ${qid(src.viCol)}, quantity, product_unit_id, unit, fator,
            weight_source, dimensions_source,
            unit_weight_kg, unit_height_cm, unit_width_cm, unit_length_cm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [volumeId, itemId, qtyItem, chosen?.product_unit_id ?? null, full?.unit || item.unit, itemFactor,
          Number.isFinite(toNum(b.unit_weight_kg, NaN)) ? 'MANUAL' : 'UNIT',
          Number.isFinite(toNum(b.unit_height_cm, NaN)) ? 'MANUAL' : 'UNIT',
          w, dim('height_cm'), dim('width_cm'), dim('length_cm')]
      );
      row = ins.rows[0];
    }

    await recalcVolume(client, volumeId);
    return { row, added_qty: qtyItem };
  });
}

/** POST /volumes/:volumeId/allocate-remaining — coloca todo o restante no volume. */
export async function allocateRemaining(req, res) {
  const volumeId = toInt(req.params.volumeId);
  if (!volumeId) return bad(res, 'Volume inválido.');

  return inTx(res, 'alocar itens pendentes', async (client) => {
    const { src, sourceId } = await getVolume(client, volumeId);
    const meta = await resolveItemsMeta(client, src);
    const items = await getItems(client, src, meta, sourceId);
    const pending = items.filter((x) => x.remaining_qty > 0);

    for (const it of pending) {
      const ex = await client.query(
        `SELECT id FROM ${TB_VI} WHERE volume_id = $1 AND ${qid(src.viCol)} = $2 LIMIT 1`,
        [volumeId, it.item_id]
      );
      if (ex.rowCount) {
        await client.query(
          `UPDATE ${TB_VI} SET quantity = quantity + $1, updated_at = now() WHERE id = $2`,
          [it.remaining_qty, ex.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO ${TB_VI}
             (volume_id, ${qid(src.viCol)}, quantity, unit, fator, weight_source, dimensions_source,
              unit_weight_kg, unit_height_cm, unit_width_cm, unit_length_cm)
           VALUES ($1,$2,$3,$4,$5,'UNIT','UNIT',$6,$7,$8,$9)`,
          [volumeId, it.item_id, it.remaining_qty, it.unit, it.conversion_factor,
            it.unit_weight_kg, it.unit_height_cm, it.unit_width_cm, it.unit_length_cm]
        );
      }
    }

    await recalcVolume(client, volumeId);
    return { allocated: pending.length };
  });
}

/** PATCH /volume-items/:id  body: { quantity } (na unidade do item) */
export async function updateVolumeItem(req, res) {
  const viId = toInt(req.params.volumeItemId);
  const qty = round3(toNum(req.body?.quantity, 0));
  if (!viId) return bad(res, 'Item do volume inválido.');
  if (!(qty > 0)) return bad(res, 'Informe uma quantidade maior que zero.');

  return inTx(res, 'alterar quantidade', async (client) => {
    const r = await client.query(`SELECT * FROM ${TB_VI} WHERE id = $1`, [viId]);
    if (!r.rowCount) throw new HttpError(404, 'Item do volume não encontrado.');
    const vi = r.rows[0];
    const { src } = await getVolume(client, vi.volume_id);
    const meta = await resolveItemsMeta(client, src);
    const itemId = vi[src.viCol];

    const item = await getItemById(client, src, meta, itemId);
    if (item) {
      const others = await getPackedQty(client, src, itemId, viId);
      const max = round3(toNum(item.ordered_qty, 0) - others);
      if (qty > max + 0.0005) {
        throw new HttpError(409, `Quantidade maior que o disponível (${max.toLocaleString('pt-BR')}).`);
      }
    }

    const up = await client.query(
      `UPDATE ${TB_VI} SET quantity = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [qty, viId]
    );
    await recalcVolume(client, vi.volume_id);
    return { row: up.rows[0] };
  });
}

export async function deleteVolumeItem(req, res) {
  const viId = toInt(req.params.volumeItemId);
  if (!viId) return bad(res, 'Item do volume inválido.');

  return inTx(res, 'remover item do volume', async (client) => {
    const r = await client.query(`SELECT volume_id FROM ${TB_VI} WHERE id = $1`, [viId]);
    if (!r.rowCount) throw new HttpError(404, 'Item do volume não encontrado.');
    await client.query(`DELETE FROM ${TB_VI} WHERE id = $1`, [viId]);
    await recalcVolume(client, r.rows[0].volume_id);
    return { deleted: true, volumeItemId: viId };
  });
}

/** PATCH /volume-items/:id/move  body: { to_volume_id } */
export async function moveVolumeItem(req, res) {
  const viId = toInt(req.params.volumeItemId);
  const toVolumeId = toInt(req.body?.to_volume_id);
  if (!viId) return bad(res, 'Item do volume inválido.');
  if (!toVolumeId) return bad(res, 'Volume de destino inválido.');

  return inTx(res, 'mover item entre volumes', async (client) => {
    const r = await client.query(`SELECT * FROM ${TB_VI} WHERE id = $1`, [viId]);
    if (!r.rowCount) throw new HttpError(404, 'Item do volume não encontrado.');
    const vi = r.rows[0];
    if (Number(vi.volume_id) === Number(toVolumeId)) return { unchanged: true };

    const from = await getVolume(client, vi.volume_id);
    const to = await getVolume(client, toVolumeId);
    if (from.src.key !== to.src.key || Number(from.sourceId) !== Number(to.sourceId)) {
      throw new HttpError(409, 'Os volumes são de pedidos/orçamentos diferentes.');
    }
    const col = from.src.viCol;

    const dest = await client.query(
      `SELECT id FROM ${TB_VI} WHERE volume_id = $1 AND ${qid(col)} = $2 LIMIT 1`,
      [toVolumeId, vi[col]]
    );
    if (dest.rowCount) {
      await client.query(
        `UPDATE ${TB_VI} SET quantity = quantity + $1, updated_at = now() WHERE id = $2`,
        [toNum(vi.quantity, 0), dest.rows[0].id]
      );
      await client.query(`DELETE FROM ${TB_VI} WHERE id = $1`, [viId]);
    } else {
      await client.query(
        `UPDATE ${TB_VI} SET volume_id = $1, updated_at = now() WHERE id = $2`,
        [toVolumeId, viId]
      );
    }
    await recalcVolume(client, vi.volume_id);
    await recalcVolume(client, toVolumeId);
    return { moved: true };
  });
}

/* ──────────────────────────────────────────────────────────────
   PDFs (romaneio e etiquetas)
────────────────────────────────────────────────────────────── */
function sendPdf(res, buffer, filename) {
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  return res.end(buffer);
}

export async function getPackingPdf(req, res) {
  try {
    const { src, id } = readSourceParams(req);
    await ensurePackingSchema();
    const summary = await withClient((client) => buildSummary(client, src, id));

    // formato esperado pelo gerador
    const pdfData = {
      ...summary,
      order: {
        ...summary.head,
        order_id: id,
        cnpj_cpf: summary.head.customer_tax_id,
        issue_date_br: summary.head.issue_date ? summary.head.issue_date.split('-').reverse().join('/') : null,
      },
      notPacked: summary.items
        .filter((x) => x.remaining_qty > 0)
        .map((x) => ({ ...x, sku: x.product_code })),
    };
    const { buffer, filename } = await generateOrdersLogisticsPackingPdf(pdfData, { orderId: id });
    if (!buffer || !Buffer.isBuffer(buffer)) return bad(res, 'Gerador de PDF não retornou Buffer.', 500);
    return sendPdf(res, buffer, filename);
  } catch (err) {
    if (err instanceof HttpError) return bad(res, err.message, err.code);
    console.error('packing pdf error:', err);
    return bad(res, 'Falha ao gerar o romaneio em PDF.', 500);
  }
}

/** GET /sources/:source/:id/labels?volume_id= (opcional: só um volume) */
export async function getPackingLabelsPdf(req, res) {
  try {
    const { src, id } = readSourceParams(req);
    await ensurePackingSchema();
    const summary = await withClient((client) => buildSummary(client, src, id));
    if (!summary.volumes.length) return bad(res, 'Nenhum volume criado ainda.', 400);

    const onlyVolume = toInt(req.query.volume_id);
    const { buffer, filename } = await generateOrdersLogisticsPackingLabelsPdf(summary, { onlyVolumeId: onlyVolume });
    return sendPdf(res, buffer, filename);
  } catch (err) {
    if (err instanceof HttpError) return bad(res, err.message, err.code);
    console.error('packing labels error:', err);
    return bad(res, 'Falha ao gerar as etiquetas dos volumes.', 500);
  }
}
