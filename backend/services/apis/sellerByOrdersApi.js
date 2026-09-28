// ╔══════════════════════════════════════════════════════════════════════╗
// ║ sellerByOrdersApi.js — Service API (DB) Vendedor x Pedido | CONSART  ║
// ║ Path: /backend/services/apis/sellerByOrdersApi.js                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."sellerByOrders"';
const TB_ORDERS = 'public."orders"';

const ok = (data = {}) => ({ ok: true, ...data });
const bad = (error, extra = {}) => ({ ok: false, error, ...extra });

export async function ensureTable() {
  // Mantém simples: você já tem o SQL acima, mas isso evita crash em ambiente novo
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TB} (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES ${TB_ORDERS}(order_id) ON DELETE CASCADE,
      seller_id BIGINT NOT NULL,
      seller_name VARCHAR(200),
      seller_email VARCHAR(180),
      seller_phone VARCHAR(30),
      role VARCHAR(30) NOT NULL DEFAULT 'PRINCIPAL',
      commission_pct NUMERIC(7,3) NOT NULL DEFAULT 0,
      commission_value NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_id, seller_id)
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sbo_order_id  ON ${TB}(order_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sbo_seller_id ON ${TB}(seller_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sbo_role      ON ${TB}(role);`);
  return ok();
}

export async function listByOrder(orderId) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) return bad('orderId inválido');

  const { rows } = await pool.query(
    `
    SELECT
      id, order_id, seller_id, seller_name, seller_email, seller_phone,
      role, commission_pct, commission_value, notes,
      created_at, updated_at
    FROM ${TB}
    WHERE order_id = $1
    ORDER BY (role = 'PRINCIPAL') DESC, id ASC
    `,
    [id]
  );

  return ok({ rows });
}

export async function upsertForOrder(orderId, payload = {}) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) return bad('orderId inválido');

  const sellerId = Number(payload.seller_id);
  if (!Number.isFinite(sellerId) || sellerId <= 0) return bad('seller_id inválido');

  const role = (payload.role || 'PRINCIPAL').toString().trim().toUpperCase();

  const commissionPct = Number(payload.commission_pct || 0);
  const commissionValue = Number(payload.commission_value || 0);

  const sellerName = payload.seller_name ?? null;
  const sellerEmail = payload.seller_email ?? null;
  const sellerPhone = payload.seller_phone ?? null;
  const notes = payload.notes ?? null;

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB}
      (order_id, seller_id, seller_name, seller_email, seller_phone, role, commission_pct, commission_value, notes)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (order_id, seller_id)
    DO UPDATE SET
      seller_name = EXCLUDED.seller_name,
      seller_email = EXCLUDED.seller_email,
      seller_phone = EXCLUDED.seller_phone,
      role = EXCLUDED.role,
      commission_pct = EXCLUDED.commission_pct,
      commission_value = EXCLUDED.commission_value,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING *
    `,
    [id, sellerId, sellerName, sellerEmail, sellerPhone, role, commissionPct, commissionValue, notes]
  );

  return ok({ row: rows[0] });
}

export async function patchSeller(orderId, sellerId, patch = {}) {
  const oid = Number(orderId);
  const sid = Number(sellerId);
  if (!Number.isFinite(oid) || oid <= 0) return bad('orderId inválido');
  if (!Number.isFinite(sid) || sid <= 0) return bad('sellerId inválido');

  const sets = [];
  const args = [];
  let i = 1;

  const add = (col, val) => {
    sets.push(`${col} = $${i++}`);
    args.push(val);
  };

  if (patch.seller_name !== undefined) add('seller_name', patch.seller_name ?? null);
  if (patch.seller_email !== undefined) add('seller_email', patch.seller_email ?? null);
  if (patch.seller_phone !== undefined) add('seller_phone', patch.seller_phone ?? null);
  if (patch.role !== undefined) add('role', String(patch.role || 'PRINCIPAL').toUpperCase());
  if (patch.commission_pct !== undefined) add('commission_pct', Number(patch.commission_pct || 0));
  if (patch.commission_value !== undefined) add('commission_value', Number(patch.commission_value || 0));
  if (patch.notes !== undefined) add('notes', patch.notes ?? null);

  if (!sets.length) return bad('patch vazio');

  args.push(oid, sid);

  const { rows } = await pool.query(
    `
    UPDATE ${TB}
    SET ${sets.join(', ')}, updated_at = NOW()
    WHERE order_id = $${i++} AND seller_id = $${i++}
    RETURNING *
    `,
    args
  );

  if (!rows?.length) return bad('NOT_FOUND');
  return ok({ row: rows[0] });
}

export async function remove(orderId, sellerId) {
  const oid = Number(orderId);
  const sid = Number(sellerId);
  if (!Number.isFinite(oid) || oid <= 0) return bad('orderId inválido');
  if (!Number.isFinite(sid) || sid <= 0) return bad('sellerId inválido');

  const { rowCount } = await pool.query(
    `DELETE FROM ${TB} WHERE order_id = $1 AND seller_id = $2`,
    [oid, sid]
  );

  if (!rowCount) return bad('NOT_FOUND');
  return ok({ removed: true });
}
