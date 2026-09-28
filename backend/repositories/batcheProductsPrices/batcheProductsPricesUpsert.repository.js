// ╔════════════════════════════════════════════════════════════════════╗
// ║ batcheProductsPricesUpsert.repository.js — batchUpsert (req, res)  ║
// ║ POST /api/products-prices/batch/upsert                             ║
// ║ Tabela: public."productsPrices" (transação)                        ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_PRICES } from './batcheProductsPrices.constants.js';
import { isFiniteNum, toNum } from './batcheProductsPrices.utils.js';

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
