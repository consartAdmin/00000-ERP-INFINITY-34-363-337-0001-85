// ╔════════════════════════════════════════════════════════════════════╗
// ║ batchProductsPricesApi.js — Ajuste/Upsert de Preços em Lote       ║
// ║ CONSART ERP | ESM                                                 ║
// ║                                                                    ║
// ║ Endpoints (sugeridos):                                            ║
// ║   POST /api/products-prices/batch/adjust                          ║
// ║   POST /api/products-prices/batch/upsert                          ║
// ║                                                                    ║
// ║ modes suportados no adjust:                                       ║
// ║   - 'percent'  → aumenta/reduz % sobre o preço atual              ║
// ║   - 'amount'   → aumenta/reduz R$ sobre o preço atual             ║
// ║   - 'set'      → define novo preço fixo                           ║
// ║   - 'margin'   → define preço pela MARGEM sobre o CUSTO           ║
// ║                  price = cost_price × (1 + margin/100)            ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_PRICES   = 'public."productsPrices"';
const TB_PRODUCTS = 'public."products"';

// Helpers numéricos
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNum       = (v, fb = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

// ──────────────────────────────────────────────────────────────────────
// POST /api/products-prices/batch/adjust
// Body: { price_id, mode, value, operation?, product_ids? }
// ──────────────────────────────────────────────────────────────────────
export async function batchAdjust(req, res) {
  const { price_id, mode, value, operation, product_ids } = req.body || {};

  const priceId = toNum(price_id);
  const numVal  = toNum(value);

  if (!Number.isInteger(priceId)) {
    return res.status(400).json({ ok: false, error: 'price_id must be an integer.' });
  }
  if (!isFiniteNum(numVal)) {
    return res.status(400).json({ ok: false, error: 'value must be a number.' });
  }

  const validModes = ['percent', 'amount', 'set', 'margin'];
  if (!validModes.includes(String(mode))) {
    return res.status(400).json({
      ok: false,
      error: "mode must be 'percent', 'amount', 'set' or 'margin'."
    });
  }

  const op = operation === 'decrease' ? 'decrease' : 'increase';

  // Filtro opcional por produtos
  const hasProductFilter =
    Array.isArray(product_ids) && product_ids.length > 0;

  const params = [priceId];
  const whereParts = ['pp.price_id = $1'];

  if (hasProductFilter) {
    params.push(product_ids.map((id) => String(id)));
    whereParts.push(`pp.product_id = ANY($${params.length}::varchar[])`);
  }

  const whereClause = whereParts.join(' AND ');

  let sql;
  if (mode === 'percent') {
    // aumenta/reduz percentual sobre PREÇO ATUAL
    const sign = op === 'decrease' ? -1 : 1;
    params.push(sign * numVal); // $N

    sql = `
      UPDATE ${TB_PRICES} pp
      SET
        sale_price = ROUND(pp.sale_price * (1 + $${params.length} / 100.0)::numeric, 2),
        updated_at = now()
      WHERE ${whereClause}
      RETURNING pp.product_price_id, pp.product_id, pp.price_id,
                pp.sale_price, pp.markup_percent, pp.gross_profit_pct, pp.updated_at
    `;
  } else if (mode === 'amount') {
    // aumenta/reduz valor fixo em R$
    const sign = op === 'decrease' ? -1 : 1;
    params.push(sign * numVal);

    sql = `
      UPDATE ${TB_PRICES} pp
      SET
        sale_price = ROUND((pp.sale_price + $${params.length})::numeric, 2),
        updated_at = now()
      WHERE ${whereClause}
      RETURNING pp.product_price_id, pp.product_id, pp.price_id,
                pp.sale_price, pp.markup_percent, pp.gross_profit_pct, pp.updated_at
    `;
  } else if (mode === 'set') {
    // define novo preço fixo
    params.push(numVal);

    sql = `
      UPDATE ${TB_PRICES} pp
      SET
        sale_price = ROUND($${params.length}::numeric, 2),
        updated_at = now()
      WHERE ${whereClause}
      RETURNING pp.product_price_id, pp.product_id, pp.price_id,
                pp.sale_price, pp.markup_percent, pp.gross_profit_pct, pp.updated_at
    `;
  } else {
    // mode === 'margin'
    //
    // 🔹 Lógica:
    //   sale_price = cost_price × (1 + margin/100)
    //   - Usa products.cost_price
    //   - Só ajusta se cost_price não for nulo
    //   - Salva a margem em markup_percent (gross_profit_pct mantido)
    params.push(numVal);

    sql = `
      UPDATE ${TB_PRICES} pp
      SET
        sale_price     = ROUND(prod.cost_price * (1 + $${params.length} / 100.0)::numeric, 2),
        markup_percent = $${params.length},
        updated_at     = now()
      FROM ${TB_PRODUCTS} prod
      WHERE
        prod.product_id = pp.product_id
        AND prod.cost_price IS NOT NULL
        AND ${whereClause}
      RETURNING pp.product_price_id, pp.product_id, pp.price_id,
                pp.sale_price, pp.markup_percent, pp.gross_profit_pct, pp.updated_at
    `;
  }

  try {
    const { rows } = await pool.query(sql, params);
    return res.json({ ok: true, rows, data: rows });
  } catch (err) {
    console.error('[batchProductsPricesApi:batchAdjust] error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to apply batch adjustment.' });
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/products-prices/batch/upsert
// Body: { items: [{ product_id, price_id, sale_price?, markup_percent?, gross_profit_pct? }, ...] }
// ──────────────────────────────────────────────────────────────────────
export async function batchUpsert(req, res) {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ ok: false, error: 'items must be a non-empty array.' });
  }

  const normalized = items
    .map((it) => ({
      product_id:       String(it.product_id ?? '').trim(),
      price_id:         toNum(it.price_id),
      sale_price:       isFiniteNum(it.sale_price)       ? Number(it.sale_price)       : null,
      markup_percent:   isFiniteNum(it.markup_percent)   ? Number(it.markup_percent)   : null,
      gross_profit_pct: isFiniteNum(it.gross_profit_pct) ? Number(it.gross_profit_pct) : null
    }))
    .filter((it) => it.product_id && Number.isInteger(it.price_id));

  if (!normalized.length) {
    return res.status(400).json({ ok: false, error: 'No valid items after normalization.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const it of normalized) {
      const { rows } = await client.query(
        `
        INSERT INTO ${TB_PRICES} (
          product_id, price_id, sale_price, markup_percent, gross_profit_pct, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (product_id, price_id)
        DO UPDATE SET
          sale_price       = COALESCE(EXCLUDED.sale_price,       ${TB_PRICES}.sale_price),
          markup_percent   = COALESCE(EXCLUDED.markup_percent,   ${TB_PRICES}.markup_percent),
          gross_profit_pct = COALESCE(EXCLUDED.gross_profit_pct, ${TB_PRICES}.gross_profit_pct),
          updated_at       = now()
        RETURNING product_price_id, product_id, price_id,
                  sale_price, markup_percent, gross_profit_pct, updated_at
        `,
        [
          it.product_id,
          it.price_id,
          it.sale_price,
          it.markup_percent,
          it.gross_profit_pct
        ]
      );
      results.push(rows[0]);
    }

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, rows: results, data: results });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[batchProductsPricesApi:batchUpsert] error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to upsert batch prices.' });
  } finally {
    client.release();
  }
}

// Export default (se quiser importar como objeto)
export default {
  batchAdjust,
  batchUpsert
};
