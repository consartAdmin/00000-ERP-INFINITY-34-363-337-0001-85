// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ backfillInboundProductMovements.v2.js — Backfill histórico por âncoras   ║
// ║ CONSART ERP | ESM                                                        ║
// ║                                                                          ║
// ║ ✅ NÃO altera productsStock                                               ║
// ║ ✅ NÃO altera productsStockLots                                           ║
// ║ ✅ NÃO reaplica NF-e de entrada                                           ║
// ║ ✅ Atualiza SOMENTE previous_stock/new_stock ausentes em productMovements ║
// ║ ✅ Usa âncoras confiáveis de estoque (NF-e emitida / movimentos completos) ║
// ║ ✅ DRY-RUN por padrão                                                     ║
// ║ ✅ Se um intervalo não puder ser fechado com segurança, ele é ignorado     ║
// ║ ✅ operation de auditLog <= 20 chars                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Uso a partir da pasta backend:
//
// DRY-RUN geral:
//   node --env-file=.env.local services/apis/backfillInboundProductMovements.js
//
// DRY-RUN de um SKU:
//   node --env-file=.env.local services/apis/backfillInboundProductMovements.js --sku=012001
//
// APPLY de um SKU:
//   node --env-file=.env.local services/apis/backfillInboundProductMovements.js --apply --sku=012001
//
// APPLY geral:
//   node --env-file=.env.local services/apis/backfillInboundProductMovements.js --apply
//
// IMPORTANTE:
// - Só grava intervalos que possuem âncoras coerentes.
// - Não força reconstrução quando existem lacunas históricas.
// - Não mexe em estoque físico.

const { default: pool } = await import('../../config/db.js');

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((v) => v.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function normalizeSku(v) {
  return String(v || '').trim();
}

function num(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round3(v) {
  const n = num(v, 0);
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function nearlyEqual(a, b, eps = 0.001) {
  const x = num(a);
  const y = num(b);
  if (x === null || y === null) return false;
  return Math.abs(x - y) <= eps;
}

const APPLY = hasFlag('apply');
const SKU_FILTER = normalizeSku(getArgValue('sku')) || null;

async function listTargetSkus() {
  const params = [];
  let filter = '';

  if (SKU_FILTER) {
    params.push(SKU_FILTER);
    filter = `
      AND (
        pm.product_code = $1
        OR regexp_replace(pm.product_code, '^0+', '') =
           regexp_replace($1, '^0+', '')
      )
    `;
  }

  const { rows } = await pool.query(
    `
      SELECT
        pm.product_code,
        COUNT(*)::int AS missing_count
      FROM public."productMovements" pm
      WHERE pm.movement_type = 'ENTRADA'
        AND pm.origin_module = 'inbound'
        AND (pm.previous_stock IS NULL OR pm.new_stock IS NULL)
        AND NULLIF(BTRIM(COALESCE(pm.product_code, '')), '') IS NOT NULL
        ${filter}
      GROUP BY pm.product_code
      ORDER BY pm.product_code
    `,
    params
  );

  return rows;
}

async function getTimeline(productCode) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM (
        SELECT
          'PM'::text AS source_kind,
          pm.movement_id::bigint AS event_id,
          pm.movement_id::bigint AS movement_id,
          pm.product_code,
          pm.movement_type,
          pm.origin_module,
          pm.origin_table,
          pm.origin_id::text AS origin_id,
          pm.quantity::numeric AS quantity,
          pm.previous_stock::numeric AS previous_stock,
          pm.new_stock::numeric AS new_stock,
          pm.nfe_number::text AS nfe_number,
          pm.notes,
          pm.created_at
        FROM public."productMovements" pm
        WHERE
          pm.product_code = $1
          OR regexp_replace(pm.product_code, '^0+', '') =
             regexp_replace($1, '^0+', '')

        UNION ALL

        SELECT
          'AUDIT'::text AS source_kind,
          al.id::bigint AS event_id,
          NULL::bigint AS movement_id,
          al.register_id AS product_code,
          'SAIDA'::text AS movement_type,
          'invoiceIssued'::text AS origin_module,
          'auditLogs'::text AS origin_table,
          COALESCE(NULLIF(al.after::jsonb->>'invoice_id',''), al.id::text) AS origin_id,
          -ABS(COALESCE(NULLIF(al.after::jsonb->>'quantity_out','')::numeric,0)) AS quantity,
          NULLIF(al.after::jsonb->>'stock_before','')::numeric AS previous_stock,
          NULLIF(al.after::jsonb->>'stock_after','')::numeric AS new_stock,
          NULLIF(al.after::jsonb->>'nfe_number','') AS nfe_number,
          COALESCE(NULLIF(al.after::jsonb->>'observation',''),'Saída por NF-e emitida') AS notes,
          al.created_at
        FROM public."auditLogs" al
        WHERE al.tabela = 'invoicesIssued'
          AND al.operation = 'PRODUCT_STOCK_OUT'
          AND (
            al.register_id = $1
            OR regexp_replace(al.register_id, '^0+', '') =
               regexp_replace($1, '^0+', '')
          )
      ) t
      ORDER BY t.created_at ASC, t.event_id ASC
    `,
    [productCode]
  );

  return rows;
}

function isKnownAnchor(event) {
  return num(event.previous_stock) !== null && num(event.new_stock) !== null;
}

function isTargetInbound(event) {
  return (
    event.source_kind === 'PM' &&
    String(event.movement_type || '').toUpperCase() === 'ENTRADA' &&
    String(event.origin_module || '').toLowerCase() === 'inbound' &&
    (num(event.previous_stock) === null || num(event.new_stock) === null)
  );
}

// Reconstruct only bounded segments between reliable anchors.
// A segment is safe when:
//   start anchor new_stock + sum(deltas in between) == end anchor previous_stock
function reconstructBoundedIntervals(timeline) {
  const updates = [];
  const intervals = [];
  const skipped = [];

  const anchorIndexes = timeline
    .map((e, i) => (isKnownAnchor(e) ? i : -1))
    .filter((i) => i >= 0);

  if (anchorIndexes.length < 2) {
    return {
      updates,
      intervals,
      skipped: [{ reason: 'Menos de duas âncoras confiáveis na linha do tempo.' }],
    };
  }

  for (let a = 0; a < anchorIndexes.length - 1; a++) {
    const startIdx = anchorIndexes[a];
    const endIdx = anchorIndexes[a + 1];

    const startAnchor = timeline[startIdx];
    const endAnchor = timeline[endIdx];

    const between = timeline.slice(startIdx + 1, endIdx);

    if (!between.some(isTargetInbound)) {
      continue;
    }

    let cursor = num(startAnchor.new_stock);
    const endExpected = num(endAnchor.previous_stock);

    if (cursor === null || endExpected === null) {
      skipped.push({
        reason: 'Âncora inválida.',
        start_event: startAnchor.event_id,
        end_event: endAnchor.event_id,
      });
      continue;
    }

    const localUpdates = [];

    for (const event of between) {
      const qty = num(event.quantity, 0);
      const prev = num(event.previous_stock);
      const next = num(event.new_stock);

      if (prev !== null && !nearlyEqual(cursor, prev)) {
        localUpdates.length = 0;
        skipped.push({
          reason: 'Movimento intermediário com previous_stock incompatível.',
          event_id: event.event_id,
          cursor: round3(cursor),
          previous_stock: round3(prev),
        });
        cursor = null;
        break;
      }

      const eventBefore = prev !== null ? prev : cursor;
      const eventAfter = next !== null ? next : eventBefore + qty;

      if (next !== null && !nearlyEqual(eventAfter, next)) {
        localUpdates.length = 0;
        skipped.push({
          reason: 'Movimento intermediário com new_stock incompatível.',
          event_id: event.event_id,
        });
        cursor = null;
        break;
      }

      if (isTargetInbound(event)) {
        localUpdates.push({
          movement_id: Number(event.movement_id),
          product_code: normalizeSku(event.product_code),
          origin_id: event.origin_id,
          quantity: round3(qty),
          previous_stock: round3(eventBefore),
          new_stock: round3(eventAfter),
          created_at: event.created_at,
        });
      }

      cursor = eventAfter;
    }

    if (cursor === null) continue;

    if (!nearlyEqual(cursor, endExpected)) {
      skipped.push({
        reason: 'Intervalo não fecha com a próxima âncora.',
        start_event: startAnchor.event_id,
        end_event: endAnchor.event_id,
        calculated_end: round3(cursor),
        expected_end: round3(endExpected),
      });
      continue;
    }

    updates.push(...localUpdates);

    intervals.push({
      start_event: startAnchor.event_id,
      end_event: endAnchor.event_id,
      start_stock: round3(startAnchor.new_stock),
      end_stock: round3(endExpected),
      inbound_updates: localUpdates.length,
    });
  }

  // Deduplicate by movement_id in case of any edge overlap.
  const deduped = [];
  const seen = new Set();

  for (const row of updates) {
    if (seen.has(row.movement_id)) continue;
    seen.add(row.movement_id);
    deduped.push(row);
  }

  return { updates: deduped, intervals, skipped };
}

async function applyUpdates(productCode, updates) {
  if (!updates.length) return 0;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let updated = 0;

    for (const row of updates) {
      const res = await client.query(
        `
          UPDATE public."productMovements"
             SET previous_stock = $2,
                 new_stock = $3
           WHERE movement_id = $1
             AND movement_type = 'ENTRADA'
             AND origin_module = 'inbound'
             AND (previous_stock IS NULL OR new_stock IS NULL)
          RETURNING movement_id
        `,
        [row.movement_id, row.previous_stock, row.new_stock]
      );

      if (res.rowCount !== 1) {
        throw new Error(`Movimento ${row.movement_id} não foi atualizado.`);
      }

      updated += 1;
    }

    // operation <= varchar(20)
    await client.query(
      `
        INSERT INTO public."auditLogs"
          (tabela, register_id, operation, before, after, created_at)
        VALUES
          (
            'productMovements',
            $1,
            'BACKFILL_INBOUND',
            $2::jsonb,
            $3::jsonb,
            NOW()
          )
      `,
      [
        productCode,
        JSON.stringify({ product_code: productCode }),
        JSON.stringify({
          product_code: productCode,
          updated_count: updated,
          movement_ids: updates.map((u) => u.movement_id),
        }),
      ]
    );

    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  console.log('='.repeat(82));
  console.log('[BACKFILL INBOUND V2][START]');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`SKU : ${SKU_FILTER || 'ALL'}`);
  console.log('='.repeat(82));

  const targets = await listTargetSkus();

  const summary = {
    skus_scanned: 0,
    skus_with_safe_intervals: 0,
    skus_without_safe_intervals: 0,
    movements_reconstructed: 0,
    movements_updated: 0,
    failed: 0,
  };

  for (const target of targets) {
    summary.skus_scanned += 1;

    const sku = normalizeSku(target.product_code);
    const timeline = await getTimeline(sku);
    const result = reconstructBoundedIntervals(timeline);

    console.log('');
    console.log('-'.repeat(82));
    console.log('[SKU]', sku);
    console.log('[SAFE INTERVALS]', result.intervals);
    console.log('[SKIPPED]', result.skipped);

    if (!result.updates.length) {
      summary.skus_without_safe_intervals += 1;
      console.log('[NO SAFE UPDATES]');
      continue;
    }

    summary.skus_with_safe_intervals += 1;
    summary.movements_reconstructed += result.updates.length;

    for (const row of result.updates) {
      console.log('[RECONSTRUCTED]', {
        movement_id: row.movement_id,
        origin_id: row.origin_id,
        quantity: row.quantity,
        stock: `${row.previous_stock} -> ${row.new_stock}`,
        created_at: row.created_at,
      });
    }

    if (!APPLY) continue;

    try {
      const updated = await applyUpdates(sku, result.updates);
      summary.movements_updated += updated;
      console.log('[APPLIED]', { sku, updated });
    } catch (err) {
      summary.failed += 1;
      console.error('[ERROR]', {
        sku,
        message: err?.message,
        code: err?.code,
        detail: err?.detail,
        column: err?.column,
        constraint: err?.constraint,
      });
    }
  }

  console.log('');
  console.log('='.repeat(82));
  console.log('[BACKFILL INBOUND V2][SUMMARY]');
  console.log(JSON.stringify(summary, null, 2));
  console.log('='.repeat(82));

  if (!APPLY) {
    console.log('DRY-RUN concluído. Nenhuma linha foi alterada.');
  }

  if (summary.failed > 0) process.exitCode = 2;
}

try {
  await main();
} finally {
  await pool.end().catch(() => {});
}
