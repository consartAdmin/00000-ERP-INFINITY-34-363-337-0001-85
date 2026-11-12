// ╔══════════════════════════════════════════════════════════════════════╗
// ║ zeroStockLots20261025.js — Zeragem única do estoque dos lotes (BH3)  ║
// ║ Roda no boot UMA vez (trava em public."oneTimeJobs")                 ║
// ║ ✅ Só no banco erp-infinity-00000                                     ║
// ║ ✅ Backup: productsStockLots_backup_20261025 / productsStock_backup_… ║
// ║ ✅ Movimento AJUSTE por lote em public."productMovements"            ║
// ║ ✅ Zera qty_on_hand e qty_reserved; trigger recalcula stock_qty      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const JOB_KEY = 'zero_stock_lots_2026_10_25';
const TARGET_DB = 'erp-infinity-00000';
const LOCK_ID = 2026102501;

const SKU_CANDIDATES = ['product_code', 'codigo', 'sku', 'codigo_produto', 'codprod', 'code'];

async function resolveSkuColumn(client) {
  const { rows } = await client.query(
    `
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = ANY($1::text[])
    `,
    [SKU_CANDIDATES]
  );
  const found = new Set(rows.map((r) => r.column_name));
  return SKU_CANDIDATES.find((c) => found.has(c)) || null;
}

export async function runZeroStockLots20261025() {
  const client = await pool.connect();

  try {
    const db = await client.query('SELECT current_database() AS name');
    if (db.rows[0]?.name !== TARGET_DB) {
      return { skipped: true, reason: `banco ${db.rows[0]?.name} não é ${TARGET_DB}` };
    }

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public."oneTimeJobs" (
        job_key text PRIMARY KEY,
        ran_at timestamp without time zone NOT NULL DEFAULT now(),
        result jsonb NULL
      );
    `);

    const done = await client.query(
      'SELECT 1 FROM public."oneTimeJobs" WHERE job_key = $1',
      [JOB_KEY]
    );
    if (done.rowCount) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'já executado' };
    }

    const reg = await client.query(`
      SELECT to_regclass('public."productsStockLots"') AS lots,
             to_regclass('public."productsStock"') AS stock,
             to_regclass('public."productMovements"') AS movements
    `);
    if (!reg.rows[0]?.lots || !reg.rows[0]?.stock) {
      await client.query('ROLLBACK');
      return { skipped: true, reason: 'tabelas de estoque não existem' };
    }

    await client.query(`
      CREATE TABLE public."productsStockLots_backup_20261025" AS
        SELECT * FROM public."productsStockLots";
    `);
    await client.query(`
      CREATE TABLE public."productsStock_backup_20261025" AS
        SELECT * FROM public."productsStock";
    `);

    let movements = 0;
    const skuCol = reg.rows[0]?.movements ? await resolveSkuColumn(client) : null;

    if (skuCol) {
      const mv = await client.query(`
        INSERT INTO public."productMovements" (
          product_code, movement_type, origin_module, origin_table, origin_id,
          quantity, previous_stock, new_stock, unit, lot_code, nfe_key,
          notes, metadata
        )
        SELECT
          btrim(p."${skuCol}"::text),
          'AJUSTE',
          'zerarEstoqueLotes',
          'productsStockLots',
          l.lot_id::text,
          -l.qty_on_hand,
          l.qty_on_hand,
          0,
          NULL,
          l.lot_code,
          l.nfe_key,
          'Zeragem geral de estoque dos lotes (2026-10-25)',
          jsonb_build_object(
            'product_stock_id', l.product_stock_id,
            'product_grade_id', l.product_grade_id,
            'lot_id', l.lot_id,
            'expires_at', l.expires_at,
            'qty_reserved_before', l.qty_reserved,
            'backup_table', 'productsStockLots_backup_20261025'
          )
        FROM public."productsStockLots" l
        JOIN public.products p ON p.product_stock_id = l.product_stock_id
        WHERE COALESCE(l.is_active, true) = true
          AND l.deleted_at IS NULL
          AND (l.qty_on_hand <> 0 OR l.qty_reserved <> 0)
          AND COALESCE(btrim(p."${skuCol}"::text), '') <> ''
      `);
      movements = mv.rowCount;
    }

    const upd = await client.query(`
      UPDATE public."productsStockLots"
         SET qty_on_hand = 0,
             qty_reserved = 0
       WHERE COALESCE(is_active, true) = true
         AND deleted_at IS NULL
         AND (qty_on_hand <> 0 OR qty_reserved <> 0)
    `);

    const result = { lots_zeroed: upd.rowCount, movements };

    await client.query(
      'INSERT INTO public."oneTimeJobs" (job_key, result) VALUES ($1, $2::jsonb)',
      [JOB_KEY, JSON.stringify(result)]
    );

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export default runZeroStockLots20261025;
