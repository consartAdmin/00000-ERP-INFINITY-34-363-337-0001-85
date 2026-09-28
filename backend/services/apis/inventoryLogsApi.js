// ╔══════════════════════════════════════════════════════════════════╗
// ║ inventoryLogsApi.js — API de auditoria de Inventário            ║
// ║ CONSART ERP — ESM                                               ║
// ╚══════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."inventoryLogs"';

/* ───────────────────────────── Helpers ───────────────────────────── */

function mapLogRow(row) {
  if (!row) return null;
  return {
    log_id: row.log_id,
    inventory_id: row.inventory_id,
    inventory_item_id: row.inventory_item_id,
    user_id: row.user_id,
    user_name: row.user_name,
    action: row.action,
    product_code: row.product_code,
    product_name: row.product_name,
    unit: row.unit,
    system_qty_before: row.system_qty_before,
    counted_qty: row.counted_qty,
    system_qty_after: row.system_qty_after,
    created_at: row.created_at,
  };
}

/* ───────────────────── Registrar um log (INSERT) ─────────────────── */

export async function registerLog({
  inventory_id,
  inventory_item_id = null,
  user_id = null,
  user_name = null,
  action,
  product_code = null,
  product_name = null,
  unit = null,
  system_qty_before = null,
  counted_qty = null,
  system_qty_after = null,
}) {
  if (!inventory_id) {
    throw new Error('inventoryLogsApi.registerLog: inventory_id é obrigatório');
  }
  if (!action) {
    throw new Error('inventoryLogsApi.registerLog: action é obrigatório');
  }

  const sql = `
    INSERT INTO ${TB} (
      inventory_id,
      inventory_item_id,
      user_id,
      user_name,
      action,
      product_code,
      product_name,
      unit,
      system_qty_before,
      counted_qty,
      system_qty_after
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *;
  `;

  const params = [
    inventory_id,
    inventory_item_id,
    user_id,
    user_name,
    action,
    product_code,
    product_name,
    unit,
    system_qty_before,
    counted_qty,
    system_qty_after,
  ];

  const { rows } = await pool.query(sql, params);
  return mapLogRow(rows[0]);
}

/* ───────────────────── Listar logs por inventário ────────────────── */

export async function listByInventory({
  inventory_id,
  date_from = null,
  date_to = null,
  user = null,
  product_code = null,
  limit = 500,
  offset = 0,
}) {
  if (!inventory_id) {
    throw new Error('inventoryLogsApi.listByInventory: inventory_id é obrigatório');
  }

  const where = ['inventory_id = $1'];
  const params = [inventory_id];
  let idx = 2;

  if (date_from) {
    where.push(`created_at::date >= $${idx++}::date`);
    params.push(date_from);
  }

  if (date_to) {
    where.push(`created_at::date <= $${idx++}::date`);
    params.push(date_to);
  }

  if (user) {
    where.push(`(user_name ILIKE '%' || $${idx} || '%')`);
    params.push(user);
    idx++;
  }

  if (product_code) {
    where.push(`(product_code ILIKE '%' || $${idx} || '%')`);
    params.push(product_code);
    idx++;
  }

  const sql = `
    SELECT *
    FROM ${TB}
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${idx} OFFSET $${idx + 1};
  `;

  params.push(limit, offset);

  const { rows } = await pool.query(sql, params);
  return {
    rows: rows.map(mapLogRow),
    limit,
    offset,
  };
}
