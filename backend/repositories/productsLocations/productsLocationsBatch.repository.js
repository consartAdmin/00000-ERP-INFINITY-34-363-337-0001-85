// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsLocationsBatch.repository.js — Localizações em Lote          ║
// ║ Tabelas: public."productsLocations" + public."products"              ║
// ║                                                                      ║
// ║ listProducts → produtos + localização atual (principal ou a última   ║
// ║                ativa) + estoque + nº de outras localizações ativas   ║
// ║ applyBatch   → grava a mesma localização em vários produtos:         ║
// ║   MOVER     : a nova vira a principal (products.product_location_id) ║
// ║               e a atual fica inativa (histórico)                     ║
// ║   ADICIONAR : a nova entra como extra; só vira principal se o        ║
// ║               produto ainda não tiver uma principal ativa            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB, TB_PRODUCTS, TB_BARCODES, BARCODE_COL, PRODUCT_DESC_COL } from './productsLocations.constants.js';

const TB_STOCK = 'public."productsStock"';

export const BATCH_MAX_PRODUCTS = 2000;
export const BATCH_MODES = Object.freeze({ MOVE: 'MOVER', ADD: 'ADICIONAR' });

/* ────────────────────────────────────────────────────────────────────
   Localização atual do produto: a principal, se ativa; senão a última
   localização ativa cadastrada.
──────────────────────────────────────────────────────────────────── */
const CURRENT_LOCATION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT l.id, l.store_id, l.corredor, l.prateleira, l.bandeja, l.box
      FROM ${TB} l
     WHERE l.product_code = p.product_code
       AND l.is_active = TRUE
     ORDER BY (l.id = p.product_location_id) DESC NULLS LAST, l.id DESC
     LIMIT 1
  ) cur ON TRUE
`;

function buildProductsWhere({ q, store_id, corredor, withoutLocation }) {
  const where = ['p.is_active IS NOT FALSE'];
  const params = [];

  if (q) {
    const raw = String(q).trim();
    params.push(`%${raw.toLowerCase()}%`);
    const like = `$${params.length}`;
    params.push(raw);
    const exact = `$${params.length}`;
    where.push(`(
      LOWER(p.product_code) LIKE ${like}
      OR LOWER(COALESCE(p."${PRODUCT_DESC_COL}", '')) LIKE ${like}
      OR EXISTS (
        SELECT 1 FROM ${TB_BARCODES} pb
         WHERE pb.product_code = p.product_code
           AND (pb."${BARCODE_COL}" = ${exact} OR LOWER(COALESCE(pb."${BARCODE_COL}", '')) LIKE ${like})
      )
    )`);
  }

  if (withoutLocation) {
    where.push('cur.id IS NULL');
  } else {
    if (store_id != null) {
      params.push(store_id);
      where.push(`cur.store_id = $${params.length}`);
    }
    if (corredor) {
      params.push(String(corredor).trim().toLowerCase());
      where.push(`LOWER(COALESCE(cur.corredor, '')) = $${params.length}`);
    }
  }

  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/**
 * Lista produtos com a localização atual.
 * codesOnly=true devolve todos os SKUs do filtro (até BATCH_MAX_PRODUCTS),
 * usado no "Marcar todos do filtro".
 */
export async function listProducts({
  q,
  store_id = null,
  corredor = null,
  withoutLocation = false,
  limit = 50,
  offset = 0,
  codesOnly = false,
} = {}) {
  const { whereSql, params } = buildProductsWhere({ q, store_id, corredor, withoutLocation });

  const from = `
    FROM ${TB_PRODUCTS} p
    ${CURRENT_LOCATION_JOIN}
    ${whereSql}
  `;

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total ${from};`, params);
  const total = countRows[0]?.total || 0;

  const lim = codesOnly ? BATCH_MAX_PRODUCTS : Math.max(1, Math.min(Number(limit) || 50, 500));
  const off = codesOnly ? 0 : Math.max(0, Number(offset) || 0);

  const sql = `
    SELECT
      p.product_code,
      p."${PRODUCT_DESC_COL}" AS description,
      cur.id         AS location_id,
      cur.store_id,
      cur.corredor,
      cur.prateleira,
      cur.bandeja,
      cur.box,
      COALESCE(ps.stock_qty, 0)::float AS stock_qty,
      (
        SELECT COUNT(*)::int FROM ${TB} o
         WHERE o.product_code = p.product_code
           AND o.is_active = TRUE
           AND o.id IS DISTINCT FROM cur.id
      ) AS other_locations
    FROM ${TB_PRODUCTS} p
    ${CURRENT_LOCATION_JOIN}
    LEFT JOIN ${TB_STOCK} ps ON ps.product_stock_id = p.product_stock_id
    ${whereSql}
    ORDER BY p."${PRODUCT_DESC_COL}" ASC NULLS LAST, p.product_code ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2};
  `;

  const { rows } = await pool.query(sql, [...params, lim, off]);

  return {
    total,
    limit: lim,
    offset: off,
    rows: rows.map((r) => ({
      product_code: r.product_code,
      description: r.description ?? '',
      location_id: r.location_id == null ? null : Number(r.location_id),
      store_id: r.store_id == null ? null : Number(r.store_id),
      corredor: r.corredor ?? null,
      prateleira: r.prateleira ?? null,
      bandeja: r.bandeja ?? null,
      box: r.box ?? null,
      stock_qty: Number(r.stock_qty || 0),
      other_locations: Number(r.other_locations || 0),
    })),
  };
}

/* ────────────────────────────────────────────────────────────────────
   applyBatch — tudo numa transação: ou grava em todos, ou em nenhum.
──────────────────────────────────────────────────────────────────── */
export async function applyBatch({ product_codes, destination, mode, observacao = null }) {
  const { store_id, corredor, prateleira, bandeja = null, box = null } = destination;
  const isMove = mode === BATCH_MODES.MOVE;

  const client = await pool.connect();
  const result = { updated: 0, created: 0, reactivated: 0, unchanged: 0, not_found: [] };

  try {
    await client.query('BEGIN');

    // SKUs que existem no cadastro (com a localização atual de cada um)
    const { rows: products } = await client.query(
      `
      SELECT p.product_code, p.product_location_id, cur.id AS current_id
        FROM ${TB_PRODUCTS} p
        ${CURRENT_LOCATION_JOIN}
       WHERE p.product_code = ANY($1::text[])
       FOR UPDATE OF p;
      `,
      [product_codes]
    );

    const found = new Map(products.map((p) => [p.product_code, p]));
    result.not_found = product_codes.filter((code) => !found.has(code));

    for (const product of products) {
      const code = product.product_code;
      const currentId = product.current_id == null ? null : Number(product.current_id);

      // Mesma localização já cadastrada (ativa ou inativa)? reaproveita a linha
      const { rows: existing } = await client.query(
        `
        SELECT id, is_active FROM ${TB}
         WHERE product_code = $1
           AND store_id IS NOT DISTINCT FROM $2
           AND COALESCE(corredor, '')   = COALESCE($3, '')
           AND COALESCE(prateleira, '') = COALESCE($4, '')
           AND COALESCE(bandeja, '')    = COALESCE($5, '')
           AND COALESCE(box, '')        = COALESCE($6, '')
         LIMIT 1;
        `,
        [code, store_id, corredor, prateleira, bandeja, box]
      );

      let targetId;
      if (existing[0]) {
        targetId = Number(existing[0].id);
        if (!existing[0].is_active) result.reactivated++;
        await client.query(
          `UPDATE ${TB}
              SET is_active = TRUE,
                  observacao = COALESCE($2, observacao),
                  updated_at = NOW()
            WHERE id = $1;`,
          [targetId, observacao]
        );
      } else {
        const { rows: inserted } = await client.query(
          `INSERT INTO ${TB}
             (product_code, store_id, corredor, prateleira, bandeja, box, observacao, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
           RETURNING id;`,
          [code, store_id, corredor, prateleira, bandeja, box, observacao]
        );
        targetId = Number(inserted[0].id);
        result.created++;
      }

      if (currentId === targetId) {
        // já estava nessa localização
        if (Number(product.product_location_id) !== targetId) {
          await client.query(
            `UPDATE ${TB_PRODUCTS} SET product_location_id = $1 WHERE product_code = $2;`,
            [targetId, code]
          );
        }
        result.unchanged++;
        continue;
      }

      if (isMove) {
        if (currentId) {
          await client.query(
            `UPDATE ${TB} SET is_active = FALSE, updated_at = NOW() WHERE id = $1;`,
            [currentId]
          );
        }
        await client.query(
          `UPDATE ${TB_PRODUCTS} SET product_location_id = $1 WHERE product_code = $2;`,
          [targetId, code]
        );
      } else {
        // ADICIONAR: só vira principal se o produto não tiver localização atual
        if (!currentId) {
          await client.query(
            `UPDATE ${TB_PRODUCTS} SET product_location_id = $1 WHERE product_code = $2;`,
            [targetId, code]
          );
        }
      }

      result.updated++;
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default { listProducts, applyBatch, BATCH_MAX_PRODUCTS, BATCH_MODES };
