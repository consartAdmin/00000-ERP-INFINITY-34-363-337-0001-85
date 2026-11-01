// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarterCatalog.repository.js — Catálogo para o caixa (offline)   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { SINGLE_PRICE_ID } from '../productsPrices/productsPrices.single.js';

/*
 * O caixa baixa o catálogo inteiro em páginas e guarda no PC, para vender
 * sem internet. Preço = tabela de preço única (SINGLE_PRICE_ID), como no
 * app mobile de produtos.
 */
export async function listCatalog({ limit = 2000, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
  const off = Math.max(Number(offset) || 0, 0);

  const { rows } = await pool.query(
    `
    SELECT
      p.product_code,
      p.description,
      COALESCE(pp.sale_price, 0)::float AS sale_price,
      COALESCE(ps.stock_qty, 0)::float AS stock_qty,
      COALESCE(bc.barcodes, '[]'::json) AS barcodes,
      img.image_url
    FROM public.products p
    LEFT JOIN public."productsPrices" pp
      ON pp.product_code = p.product_code
     AND pp.price_id = $1
    LEFT JOIN public."productsStock" ps
      ON ps.product_stock_id = p.product_stock_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'barcode', b.barcode,
               'unit', COALESCE(b.unit, 'UN'),
               'factor', COALESCE(b.fator, 1),
               'standard', COALESCE(b.standard, false)
             ) ORDER BY b.standard DESC NULLS LAST, b.barcode_id) AS barcodes
        FROM public."productsBarCode" b
       WHERE b.product_code = p.product_code
         AND COALESCE(b.is_active, true) = true
    ) bc ON true
    LEFT JOIN LATERAL (
      SELECT i.image_url
        FROM public."productsImages" i
       WHERE i.product_code = p.product_code
         AND COALESCE(i.is_active, true) = true
         AND COALESCE(i.image_url, '') <> ''
       ORDER BY i.is_primary DESC NULLS LAST, i.position ASC NULLS LAST, i.product_image_id ASC
       LIMIT 1
    ) img ON true
    WHERE COALESCE(p.is_active, true) = true
    ORDER BY p.product_code
    LIMIT $2 OFFSET $3
    `,
    [SINGLE_PRICE_ID, lim, off],
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM public.products WHERE COALESCE(is_active, true) = true`,
  );

  return {
    items: rows.map((r) => ({
      ...r,
      unit: r.barcodes?.find((b) => b.standard)?.unit || r.barcodes?.[0]?.unit || 'UN',
    })),
    total: countRows[0]?.total ?? rows.length,
    limit: lim,
    offset: off,
  };
}
