// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ OrdersLogisticsPackingApi.js — Packing/Volumes API (ÚNICA)              ║
// ║ Path: backend/services/apis/OrdersLogisticsPackingApi.js                 ║
// ║ CONSART ERP | ESM | Express | PostgreSQL                                 ║
// ║                                                                          ║
// ║ Tabelas/View:                                                            ║
// ║  - public.orders (PK: order_id)                                          ║
// ║  - public.order_items (PK: order_item_id)                                ║
// ║  - public."orderVolumes"                                                 ║
// ║  - public."orderVolumeItems"                                             ║
// ║  - public.v_order_items_not_fully_packed                                 ║
// ║                                                                          ║
// ║ Endpoints (base sugerida: /api/packing):                                 ║
// ║  GET    /orders/:orderId/summary                                         ║
// ║  GET    /orders/:orderId/not-packed                                      ║
// ║  GET    /orders/:orderId/volumes                                         ║
// ║  POST   /orders/:orderId/volumes                                         ║
// ║  PATCH  /volumes/:volumeId                                               ║
// ║  DELETE /volumes/:volumeId                                               ║
// ║  GET    /volumes/:volumeId/items                                         ║
// ║  POST   /volumes/:volumeId/items                                         ║
// ║  PATCH  /volume-items/:volumeItemId                                      ║
// ║  DELETE /volume-items/:volumeItemId                                      ║
// ║  POST   /volume-items/:volumeItemId/move                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

import { Router } from 'express';
import pool from '../../config/db.js'; // ajuste se seu path for diferente

const router = Router();

/* ──────────────────────────────────────────────────────────────
   Constantes
────────────────────────────────────────────────────────────── */
const TB_ORDERS = 'public.orders';
const TB_ITEMS = 'public.order_items';
const TB_VOL = 'public."orderVolumes"';
const TB_VI = 'public."orderVolumeItems"';

const VIEW_NOT_PACKED = 'public.v_order_items_not_fully_packed';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const isFiniteNum = (v) => Number.isFinite(Number(v));
const toNum = (v, def = 0) => (isFiniteNum(v) ? Number(v) : def);
const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

function ok(res, data = {}) {
  return res.json({ ok: true, ...data });
}
function bad(res, msg, code = 400, extra = {}) {
  return res.status(code).json({ ok: false, error: msg, ...extra });
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function ensureOrderExists(client, orderId) {
  const r = await client.query(
    `SELECT order_id FROM ${TB_ORDERS} WHERE order_id = $1`,
    [orderId]
  );
  return r.rowCount ? r.rows[0] : null;
}

async function ensureVolumeExists(client, volumeId) {
  const r = await client.query(
    `SELECT id, order_id, volume_number FROM ${TB_VOL} WHERE id = $1`,
    [volumeId]
  );
  return r.rowCount ? r.rows[0] : null;
}

async function ensureVolumeItemExists(client, volumeItemId) {
  const r = await client.query(
    `SELECT
    id,
    volume_id,
    order_item_id,
    product_unit_id,
    unit,
    fator,
    quantity
   FROM ${TB_VI} WHERE id = $1`,
    [volumeItemId]
  );
  return r.rowCount ? r.rows[0] : null;
}

async function getNextVolumeNumber(client, orderId) {
  const r = await client.query(
    `SELECT COALESCE(MAX(volume_number), 0) + 1 AS next
       FROM ${TB_VOL}
      WHERE order_id = $1`,
    [orderId]
  );
  return Number(r.rows[0]?.next || 1);
}

async function ensureNotPackedView(client) {
  await client.query(`
    CREATE OR REPLACE VIEW public.v_order_items_not_fully_packed AS
    SELECT
      oi.order_item_id,
      oi.order_id,
      oi.sku,
      oi.description,
      oi.unit,
      oi.quantity AS ordered_qty,

      COALESCE(packed.packed_qty, 0) AS packed_qty,
      GREATEST(oi.quantity - COALESCE(packed.packed_qty, 0), 0) AS remaining_qty,

      COALESCE(pbc.weight_kg, 0) AS unit_weight_kg,
      COALESCE(pbc.height_cm, 0) AS unit_height_cm,
      COALESCE(pbc.width_cm, 0) AS unit_width_cm,
      COALESCE(pbc.length_cm, 0) AS unit_length_cm

    FROM public.order_items oi

    LEFT JOIN (
      SELECT
        order_item_id,
        SUM(quantity) AS packed_qty
      FROM public."orderVolumeItems"
      GROUP BY order_item_id
    ) packed ON packed.order_item_id = oi.order_item_id

    LEFT JOIN LATERAL (
      SELECT
        pbc.weight_kg,
        pbc.height_cm,
        pbc.width_cm,
        pbc.length_cm
      FROM public."productsBarCode" pbc
      WHERE pbc.product_code::text = oi.sku::text
        AND pbc.is_active IS TRUE
      ORDER BY
        COALESCE(pbc.standard, false) DESC,
        CASE
          WHEN pbc.unit::text = oi.unit::text THEN 0
          ELSE 1
        END ASC,
        pbc.updated_at DESC,
        pbc.barcode_id DESC
      LIMIT 1
    ) pbc ON true

    WHERE GREATEST(oi.quantity - COALESCE(packed.packed_qty, 0), 0) > 0;
  `);
}

/* ──────────────────────────────────────────────────────────────
   GET /orders/:orderId/summary
   - Pedido + volumes + itens nos volumes + itens não alocados
────────────────────────────────────────────────────────────── */
router.get('/orders/:orderId/summary', async (req, res) => {
  const orderId = toInt(req.params.orderId);
  if (!orderId) return bad(res, 'orderId inválido.');

  try {
    const data = await withClient(async (client) => {

      // ==========================================================
      // Garante que a VIEW esteja utilizando productsBarCode
      // ==========================================================
      await ensureNotPackedView(client);

      // ==========================================================
      // Pedido
      // ==========================================================
      const order = await client.query(
        `SELECT *
           FROM ${TB_ORDERS}
          WHERE order_id = $1`,
        [orderId]
      );

      // ==========================================================
      // Volumes
      // ==========================================================
      const volumes = await client.query(
        `SELECT *
           FROM ${TB_VOL}
          WHERE order_id = $1
          ORDER BY volume_number ASC`,
        [orderId]
      );

      // ==========================================================
      // Itens dos volumes
      // ==========================================================
      const volumeItems = await client.query(
        `
        SELECT
            ovi.*,
            ov.order_id,
            ov.volume_number,
            oi.sku,
            oi.description,
            oi.unit
        FROM ${TB_VI} ovi
        JOIN ${TB_VOL} ov
             ON ov.id = ovi.volume_id
        JOIN ${TB_ITEMS} oi
             ON oi.order_item_id = ovi.order_item_id
        WHERE ov.order_id = $1
        ORDER BY
            ov.volume_number ASC,
            ovi.id ASC
        `,
        [orderId]
      );

      // ==========================================================
      // Itens ainda não embalados
      // (agora a VIEW já está apontando para productsBarCode)
      // ==========================================================
      const notPacked = await client.query(
        `
        SELECT *
        FROM ${VIEW_NOT_PACKED}
        WHERE order_id = $1
        ORDER BY description ASC
        `,
        [orderId]
      );

      return {
        order: order.rows[0] || null,
        volumes: volumes.rows,
        volumeItems: volumeItems.rows,
        notPacked: notPacked.rows,
      };
    });

    return ok(res, data);

  } catch (err) {
    console.error('packing summary error:', err);
    return bad(res, 'Falha ao carregar summary do packing.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   GET /orders/:orderId/not-packed
────────────────────────────────────────────────────────────── */
router.get('/orders/:orderId/not-packed', async (req, res) => {
  const orderId = toInt(req.params.orderId);
  if (!orderId) return bad(res, 'orderId inválido.');

  try {
    const r = await pool.query(
      `SELECT * FROM ${VIEW_NOT_PACKED}
        WHERE order_id = $1
        ORDER BY description ASC`,
      [orderId]
    );
    return ok(res, { rows: r.rows });
  } catch (err) {
    console.error('not-packed error:', err);
    return bad(res, 'Falha ao listar itens não alocados.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   GET /orders/:orderId/volumes
────────────────────────────────────────────────────────────── */
router.get('/orders/:orderId/volumes', async (req, res) => {
  const orderId = toInt(req.params.orderId);
  if (!orderId) return bad(res, 'orderId inválido.');

  try {
    const r = await pool.query(
      `SELECT *
         FROM ${TB_VOL}
        WHERE order_id = $1
        ORDER BY volume_number ASC`,
      [orderId]
    );
    return ok(res, { rows: r.rows });
  } catch (err) {
    console.error('list volumes error:', err);
    return bad(res, 'Falha ao listar volumes.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   POST /orders/:orderId/volumes
   Body (opcional):
     { volume_type, description, height_cm, width_cm, length_cm, tare_kg, notes }
   - volume_number é calculado automaticamente
────────────────────────────────────────────────────────────── */
router.post('/orders/:orderId/volumes', async (req, res) => {
  const orderId = toInt(req.params.orderId);
  if (!orderId) return bad(res, 'orderId inválido.');

  const body = req.body || {};
  const volume_type = String(body.volume_type || 'BOX').trim() || 'BOX';
  const description = body.description ?? null;
  const notes = body.notes ?? null;

  const height_cm = toNum(body.height_cm, 0);
  const width_cm = toNum(body.width_cm, 0);
  const length_cm = toNum(body.length_cm, 0);
  const tare_kg = toNum(body.tare_kg, 0);

  if (height_cm < 0 || width_cm < 0 || length_cm < 0 || tare_kg < 0) {
    return bad(res, 'Dimensões/tara não podem ser negativas.');
  }

  try {
    const out = await withClient(async (client) => {
      const exists = await ensureOrderExists(client, orderId);
      if (!exists) return { __err: { code: 404, msg: `Pedido ${orderId} não encontrado.` } };

      const volume_number = await getNextVolumeNumber(client, orderId);

      const ins = await client.query(
        `INSERT INTO ${TB_VOL}
          (order_id, volume_number, volume_type, description, height_cm, width_cm, length_cm, tare_kg, notes)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [orderId, volume_number, volume_type, description, height_cm, width_cm, length_cm, tare_kg, notes]
      );

      return { row: ins.rows[0] };
    });

    if (out.__err) return bad(res, out.__err.msg, out.__err.code);
    return ok(res, out);
  } catch (err) {
    console.error('create volume error:', err);
    return bad(res, 'Falha ao criar volume.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   PATCH /volumes/:volumeId
   Atualiza metadata/dimensões/tara/status
────────────────────────────────────────────────────────────── */
router.patch('/volumes/:volumeId', async (req, res) => {
  const volumeId = toInt(req.params.volumeId);
  if (!volumeId) return bad(res, 'volumeId inválido.');

  const b = req.body || {};

  const fields = [];
  const vals = [];
  let i = 1;

  const setIf = (col, val) => {
    fields.push(`${col} = $${i++}`);
    vals.push(val);
  };

  if (b.volume_type !== undefined) setIf('volume_type', String(b.volume_type || 'BOX'));
  if (b.description !== undefined) setIf('description', b.description ?? null);
  if (b.notes !== undefined) setIf('notes', b.notes ?? null);
  if (b.status !== undefined) setIf('status', String(b.status || 'OPEN'));

  if (b.height_cm !== undefined) {
    const v = toNum(b.height_cm, 0); if (v < 0) return bad(res, 'height_cm inválido.');
    setIf('height_cm', v);
  }
  if (b.width_cm !== undefined) {
    const v = toNum(b.width_cm, 0); if (v < 0) return bad(res, 'width_cm inválido.');
    setIf('width_cm', v);
  }
  if (b.length_cm !== undefined) {
    const v = toNum(b.length_cm, 0); if (v < 0) return bad(res, 'length_cm inválido.');
    setIf('length_cm', v);
  }
  if (b.tare_kg !== undefined) {
    const v = toNum(b.tare_kg, 0); if (v < 0) return bad(res, 'tare_kg inválido.');
    setIf('tare_kg', v);
  }

  if (!fields.length) return bad(res, 'Nada para atualizar.');

  try {
    const out = await withClient(async (client) => {
      const vol = await ensureVolumeExists(client, volumeId);
      if (!vol) return { __err: { code: 404, msg: 'Volume não encontrado.' } };

      vals.push(volumeId);
      const q = `
        UPDATE ${TB_VOL}
           SET ${fields.join(', ')},
               updated_at = now()
         WHERE id = $${i}
         RETURNING *`;
      const r = await client.query(q, vals);
      return { row: r.rows[0] };
    });

    if (out.__err) return bad(res, out.__err.msg, out.__err.code);
    return ok(res, out);
  } catch (err) {
    console.error('update volume error:', err);
    return bad(res, 'Falha ao atualizar volume.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   DELETE /volumes/:volumeId
   - ON DELETE CASCADE remove itens
────────────────────────────────────────────────────────────── */
router.delete('/volumes/:volumeId', async (req, res) => {
  const volumeId = toInt(req.params.volumeId);
  if (!volumeId) return bad(res, 'volumeId inválido.');

  try {
    const out = await withClient(async (client) => {
      const vol = await ensureVolumeExists(client, volumeId);
      if (!vol) return { __err: { code: 404, msg: 'Volume não encontrado.' } };

      await client.query(`DELETE FROM ${TB_VOL} WHERE id = $1`, [volumeId]);
      return { deleted: true, volumeId };
    });

    if (out.__err) return bad(res, out.__err.msg, out.__err.code);
    return ok(res, out);
  } catch (err) {
    console.error('delete volume error:', err);
    return bad(res, 'Falha ao excluir volume.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   GET /volumes/:volumeId/items
────────────────────────────────────────────────────────────── */
router.get('/volumes/:volumeId/items', async (req, res) => {
  const volumeId = toInt(req.params.volumeId);
  if (!volumeId) return bad(res, 'volumeId inválido.');

  try {
    const r = await pool.query(
      `SELECT
         ovi.*,
         oi.order_id,
         oi.sku,
         oi.description,
         oi.unit,
         ov.volume_number
       FROM ${TB_VI} ovi
       JOIN ${TB_ITEMS} oi ON oi.order_item_id = ovi.order_item_id
       JOIN ${TB_VOL} ov ON ov.id = ovi.volume_id
      WHERE ovi.volume_id = $1
      ORDER BY ovi.id ASC`,
      [volumeId]
    );
    return ok(res, { rows: r.rows });
  } catch (err) {
    console.error('list volume items error:', err);
    return bad(res, 'Falha ao listar itens do volume.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   POST /volumes/:volumeId/items
   Body:
     {
       order_item_id, quantity,
       unit_weight_kg, unit_height_cm, unit_width_cm, unit_length_cm
     }
   - Se já existir (mesmo order_item_id no volume), soma quantidade.
   - Trigger no banco recalcula line_weight_kg/line_volume_m3 e volume totals.
────────────────────────────────────────────────────────────── */
router.post('/volumes/:volumeId/items', async (req, res) => {
  const volumeId = toInt(req.params.volumeId);
  if (!volumeId) return bad(res, 'volumeId inválido.');

  const b = req.body || {};
  const order_item_id = toInt(b.order_item_id);
  const quantity = toNum(b.quantity, 0);

  const product_unit_id = toInt(b.product_unit_id);
  const unit = String(b.unit || '').trim() || null;
  const fator = toNum(b.fator, 1);

  if (!order_item_id) return bad(res, 'order_item_id inválido.');
  if (!(quantity > 0)) return bad(res, 'quantity deve ser > 0.');

  let unit_weight_kg = toNum(b.unit_weight_kg, 0);
  let unit_height_cm = toNum(b.unit_height_cm, 0);
  let unit_width_cm = toNum(b.unit_width_cm, 0);
  let unit_length_cm = toNum(b.unit_length_cm, 0);

  if (unit_weight_kg < 0 || unit_height_cm < 0 || unit_width_cm < 0 || unit_length_cm < 0) {
    return bad(res, 'peso/dimensões não podem ser negativos.');
  }

  try {
    const out = await withClient(async (client) => {
      await client.query('BEGIN');

      const vol = await ensureVolumeExists(client, volumeId);
      if (!vol) {
        await client.query('ROLLBACK');
        return { __err: { code: 404, msg: 'Volume não encontrado.' } };
      }

      // garante item existe e pega order_id pra consistência
      const item = await client.query(
        `SELECT order_item_id, order_id, sku, description, unit, quantity AS order_quantity
           FROM ${TB_ITEMS}
          WHERE order_item_id = $1`,
        [order_item_id]
      );
      if (!item.rowCount) {
        await client.query('ROLLBACK');
        return { __err: { code: 404, msg: 'Item do pedido não encontrado.' } };
      }

      // Consistência: item e volume têm que ser do mesmo pedido (também há trigger no banco)
      if (Number(item.rows[0].order_id) !== Number(vol.order_id)) {
        await client.query('ROLLBACK');
        return { __err: { code: 409, msg: 'Item pertence a outro pedido (inconsistência).' } };
      }

      // ==========================================================
      // Peso/dimensões oficiais vêm do productsBarCode
      // Não confia no frontend se veio 0
      // ==========================================================
      const pbc = await client.query(
        `
  SELECT
      weight_kg,
      height_cm,
      width_cm,
      length_cm
  FROM public."productsBarCode"
  WHERE product_code::text = $1::text
    AND is_active IS TRUE
    AND (
      product_unit_id = $2
      OR TRIM(REPLACE(UPPER(unit), '.', '')) =
         TRIM(REPLACE(UPPER($3), '.', ''))
      OR standard IS TRUE
    )
  ORDER BY
      CASE WHEN product_unit_id = $2 THEN 0 ELSE 1 END,
      CASE
        WHEN TRIM(REPLACE(UPPER(unit), '.', '')) =
             TRIM(REPLACE(UPPER($3), '.', ''))
        THEN 0 ELSE 1
      END,
      COALESCE(standard, false) DESC,
      updated_at DESC,
      barcode_id DESC
  LIMIT 1
  `,
        [
          item.rows[0].sku,
          product_unit_id,
          unit || item.rows[0].unit
        ]
      );

      if (pbc.rowCount) {
        unit_weight_kg = toNum(pbc.rows[0].weight_kg, unit_weight_kg);
        unit_height_cm = toNum(pbc.rows[0].height_cm, unit_height_cm);
        unit_width_cm = toNum(pbc.rows[0].width_cm, unit_width_cm);
        unit_length_cm = toNum(pbc.rows[0].length_cm, unit_length_cm);
      }

      // Se já existir, soma qty
      const existing = await client.query(
        `SELECT id, quantity
     FROM ${TB_VI}
    WHERE volume_id = $1
      AND order_item_id = $2
      AND COALESCE(product_unit_id,0) = COALESCE($3,0)`,
        [volumeId, order_item_id, product_unit_id]
      );

      let row;
      if (existing.rowCount) {
        const newQty = toNum(existing.rows[0].quantity, 0) + quantity;

        const up = await client.query(
          `UPDATE ${TB_VI}
      SET quantity = $1,
          product_unit_id = $2,
          unit = $3,
          fator = $4,
          unit_weight_kg = $5,
          unit_height_cm = $6,
          unit_width_cm  = $7,
          unit_length_cm = $8,
          updated_at = now()
    WHERE id = $9
    RETURNING *`,
          [
            newQty,
            product_unit_id,
            unit,
            fator,
            unit_weight_kg,
            unit_height_cm,
            unit_width_cm,
            unit_length_cm,
            existing.rows[0].id
          ]
        );
        row = up.rows[0];
      } else {
        const ins = await client.query(
          `INSERT INTO ${TB_VI}
          (
            volume_id,
            order_item_id,
            quantity,
            product_unit_id,
            unit,
            fator,
            unit_weight_kg,
            unit_height_cm,
            unit_width_cm,
            unit_length_cm
            )
            VALUES
            (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
            )
            RETURNING *`,
          [
            volumeId,
            order_item_id,
            quantity,
            product_unit_id,
            unit,
            fator,
            unit_weight_kg,
            unit_height_cm,
            unit_width_cm,
            unit_length_cm
          ]
        );
        row = ins.rows[0];
      }

      await client.query('COMMIT');
      return { row };
    });

    if (out.__err) return bad(res, out.__err.msg, out.__err.code);
    return ok(res, out);
  } catch (err) {
    console.error('add item to volume error:', err);
    // se trigger estourar (ex: item de outro pedido), cai aqui
    return bad(res, 'Falha ao adicionar item ao volume.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   PATCH /volume-items/:volumeItemId
   Body: { quantity }
────────────────────────────────────────────────────────────── */
router.patch('/volume-items/:volumeItemId', async (req, res) => {
  const volumeItemId = toInt(req.params.volumeItemId);
  if (!volumeItemId) return bad(res, 'volumeItemId inválido.');

  const qty = toNum(req.body?.quantity, 0);
  if (!(qty > 0)) return bad(res, 'quantity deve ser > 0.');

  try {
    const out = await withClient(async (client) => {
      const vi = await ensureVolumeItemExists(client, volumeItemId);
      if (!vi) return { __err: { code: 404, msg: 'Item do volume não encontrado.' } };

      const up = await client.query(
        `UPDATE ${TB_VI}
            SET quantity = $1,
                updated_at = now()
          WHERE id = $2
          RETURNING *`,
        [qty, volumeItemId]
      );

      return { row: up.rows[0] };
    });

    if (out.__err) return bad(res, out.__err.msg, out.__err.code);
    return ok(res, out);
  } catch (err) {
    console.error('update volume item error:', err);
    return bad(res, 'Falha ao atualizar item do volume.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   DELETE /volume-items/:volumeItemId
────────────────────────────────────────────────────────────── */
router.delete('/volume-items/:volumeItemId', async (req, res) => {
  const volumeItemId = toInt(req.params.volumeItemId);
  if (!volumeItemId) return bad(res, 'volumeItemId inválido.');

  try {
    const out = await withClient(async (client) => {
      const vi = await ensureVolumeItemExists(client, volumeItemId);
      if (!vi) return { __err: { code: 404, msg: 'Item do volume não encontrado.' } };

      await client.query(`DELETE FROM ${TB_VI} WHERE id = $1`, [volumeItemId]);
      return { deleted: true, volumeItemId };
    });

    if (out.__err) return bad(res, out.__err.msg, out.__err.code);
    return ok(res, out);
  } catch (err) {
    console.error('delete volume item error:', err);
    return bad(res, 'Falha ao excluir item do volume.', 500);
  }
});

/* ──────────────────────────────────────────────────────────────
   POST /volume-items/:volumeItemId/move
   Body: { to_volume_id }
   - Move o item do volume A para volume B (mesmo pedido)
   - Se já existir o mesmo order_item_id no destino, soma quantidade e remove origem.
────────────────────────────────────────────────────────────── */
router.post('/volume-items/:volumeItemId/move', async (req, res) => {
  const volumeItemId = toInt(req.params.volumeItemId);
  const toVolumeId = toInt(req.body?.to_volume_id);

  if (!volumeItemId) return bad(res, 'volumeItemId inválido.');
  if (!toVolumeId) return bad(res, 'to_volume_id inválido.');

  try {
    const out = await withClient(async (client) => {
      await client.query('BEGIN');

      const vi = await ensureVolumeItemExists(client, volumeItemId);
      if (!vi) {
        await client.query('ROLLBACK');
        return { __err: { code: 404, msg: 'Item do volume não encontrado.' } };
      }

      const fromVol = await ensureVolumeExists(client, vi.volume_id);
      const toVol = await ensureVolumeExists(client, toVolumeId);

      if (!fromVol || !toVol) {
        await client.query('ROLLBACK');
        return { __err: { code: 404, msg: 'Volume origem/destino não encontrado.' } };
      }

      if (Number(fromVol.order_id) !== Number(toVol.order_id)) {
        await client.query('ROLLBACK');
        return { __err: { code: 409, msg: 'Volumes pertencem a pedidos diferentes.' } };
      }

      // destino já tem esse item?
      const existingDest = await client.query(
        `SELECT id, quantity
           FROM ${TB_VI}
          WHERE volume_id = $1
          AND order_item_id = $2
          AND COALESCE(product_unit_id,0) =
          COALESCE($3,0)`,
        [toVolumeId, vi.order_item_id, vi.product_unit_id]
      );

      let result;

      if (existingDest.rowCount) {
        const newQty = toNum(existingDest.rows[0].quantity, 0) + toNum(vi.quantity, 0);

        // soma no destino
        await client.query(
          `UPDATE ${TB_VI}
      SET quantity = $1,
          updated_at = now()
    WHERE id = $2`,
          [newQty, existingDest.rows[0].id]
        );

        // remove origem
        await client.query(`DELETE FROM ${TB_VI} WHERE id = $1`, [volumeItemId]);

        result = { merged_into_id: existingDest.rows[0].id, removed_id: volumeItemId, to_volume_id: toVolumeId };
      } else {
        // move simples (troca volume_id)
        const up = await client.query(
          `UPDATE ${TB_VI}
      SET volume_id = $1,
          updated_at = now()
    WHERE id = $2
    RETURNING *`,
          [toVolumeId, volumeItemId]
        );

        result = { row: up.rows[0] };
      }

      await client.query('COMMIT');
      return result;
    });

    if (out.__err) return bad(res, out.__err.msg, out.__err.code);
    return ok(res, out);
  } catch (err) {
    console.error('move volume item error:', err);
    return bad(res, 'Falha ao mover item entre volumes.', 500);
  }
});

export default router;
