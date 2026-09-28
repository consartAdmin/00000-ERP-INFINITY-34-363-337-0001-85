// ╔════════════════════════════════════════════════════════════════════╗
// ║ batcheProductsPricesAdjust.repository.js — batchAdjust (req, res)  ║
// ║ POST /api/products-prices/batch/adjust                             ║
// ║ modes: 'percent' | 'amount' | 'set' | 'margin'                     ║
// ║   margin → price = cost_price × (1 + margin/100)                   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_PRICES, TB_PRODUCTS } from './batcheProductsPrices.constants.js';
import { isFiniteNum, toNum } from './batcheProductsPrices.utils.js';

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
