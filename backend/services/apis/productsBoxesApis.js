// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsBoxesApis.js — DB Access (ESM)                                ║
// ║ Path: backend/services/apis/productsBoxesApis.js                      ║
// ║ Tabelas: public."productsBoxes", public."productsBoxesItems"         ║
// ║ + JOIN: public."products" (para descrição do produto)                 ║
// ║ Funções: CRUD Boxes + Itens (product_code) • Paginação • Busca • Order safe    ║
// ║ + Helpers extras: getBoxWithItems, listBoxesWithItems                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

export const TB_BOX = 'public."productsBoxes"';
export const TB_ITEM = 'public."productsBoxesItems"';
export const TB_PRODUCT = 'public."products"'; // ✅ tabela de produtos (cadastro)

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res;
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'sim'].includes(s)) return true;
  if (['0', 'false', 'f', 'no', 'n', 'nao', 'não'].includes(s)) return false;
  return null;
}

function asNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeStr(v, max = 255) {
  return String(v ?? '').trim().slice(0, max);
}

/** ORDER BY seguro */
function parseOrder(orderBy, allowed = []) {
  if (!orderBy) return '';
  const [col, dirRaw] = String(orderBy).trim().split(/\s+/);
  const colSafe = allowed.includes(col) ? col : null;
  const dir = /^(asc|desc)$/i.test(dirRaw || '') ? dirRaw.toUpperCase() : 'ASC';
  return colSafe ? ` ORDER BY ${colSafe} ${dir} ` : '';
}

function ensureInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function ensureBoxId(box_id) {
  const id = ensureInt(box_id, NaN);
  if (!Number.isFinite(id)) {
    const err = new Error('invalid box_id');
    err.status = 400;
    throw err;
  }
  return id;
}

/* ──────────────────────────────────────────────────────────────
   Boxes — CRUD
────────────────────────────────────────────────────────────── */
export async function listBoxes({
  q: query,
  active,
  page = 1,
  pageSize = 20,
  orderBy = 'created_at DESC',
} = {}) {
  const where = [];
  const params = [];

  const activeBool = asBool(active);
  if (activeBool !== null) {
    params.push(activeBool);
    where.push(`active = $${params.length}`);
  }

  if (query && String(query).trim()) {
    const like = `%${safeStr(query, 200)}%`;
    params.push(like);
    where.push(`(name ILIKE $${params.length})`);
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')} ` : '';
  const orderSql = parseOrder(orderBy, [
    'box_id', 'name', 'box_type', 'location', 'active', 'created_at', 'updated_at',
  ]);

  const p = Math.max(1, ensureInt(page, 1));
  const ps = Math.min(200, Math.max(1, ensureInt(pageSize, 20)));
  const offset = (p - 1) * ps;

  const countSql = `SELECT COUNT(*)::bigint AS total FROM ${TB_BOX} ${whereSql}`;
  const countRes = await q(countSql, params);
  const total = Number(countRes.rows?.[0]?.total || 0);

  const params2 = [...params, ps, offset];

  const dataSql = `
  SELECT
  box_id, name, box_type, location,
  length_cm, width_cm, height_cm,
  max_weight_kg, max_volume_cm3,
  notes, active, created_at, updated_at
  FROM ${TB_BOX}
  ${whereSql}
  ${orderSql || ' ORDER BY created_at DESC '}
  LIMIT $${params2.length - 1} OFFSET $${params2.length}
  `;

  const dataRes = await q(dataSql, params2);

  return {
    page: p,
    pageSize: ps,
    total,
    rows: dataRes.rows || [],
  };
}

export async function getBoxById(box_id) {
  const id = ensureInt(box_id, NaN);
  if (!Number.isFinite(id)) return null;

  const res = await q(`SELECT * FROM ${TB_BOX} WHERE box_id = $1`, [id]);
  return res.rows?.[0] || null;
}

export async function createBox(payload = {}) {
  const name = safeStr(payload.name, 120);

  if (!name) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }

  const box_type = payload.box_type ? safeStr(payload.box_type, 40) : null;
  const location = payload.location ? safeStr(payload.location, 80) : null;

  const length_cm = asNum(payload.length_cm);
  const width_cm  = asNum(payload.width_cm);
  const height_cm = asNum(payload.height_cm);

  const max_weight_kg  = asNum(payload.max_weight_kg);
  const max_volume_cm3 = asNum(payload.max_volume_cm3);

  const notes = payload.notes ? String(payload.notes) : null;

  const active = asBool(payload.active);
  const activeFinal = active === null ? true : active;

  const sql = `
    INSERT INTO ${TB_BOX}
      (name, box_type, location, length_cm, width_cm, height_cm,
       max_weight_kg, max_volume_cm3, notes, active)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `;

  const res = await q(sql, [
    name, box_type, location,
    length_cm, width_cm, height_cm,
    max_weight_kg, max_volume_cm3,
    notes, activeFinal,
  ]);

  return res.rows?.[0] || null;
}

export async function updateBox(box_id, payload = {}) {
  const id = ensureBoxId(box_id);

  const fields = [];
  const params = [];

  function pushField(col, val) {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  }

  if (payload.name !== undefined) pushField('name', payload.name ? safeStr(payload.name, 120) : null);
  if (payload.box_type !== undefined) pushField('box_type', payload.box_type ? safeStr(payload.box_type, 40) : null);
  if (payload.location !== undefined) pushField('location', payload.location ? safeStr(payload.location, 80) : null);

  if (payload.length_cm !== undefined) pushField('length_cm', asNum(payload.length_cm));
  if (payload.width_cm !== undefined) pushField('width_cm', asNum(payload.width_cm));
  if (payload.height_cm !== undefined) pushField('height_cm', asNum(payload.height_cm));

  if (payload.max_weight_kg !== undefined) pushField('max_weight_kg', asNum(payload.max_weight_kg));
  if (payload.max_volume_cm3 !== undefined) pushField('max_volume_cm3', asNum(payload.max_volume_cm3));

  if (payload.notes !== undefined) pushField('notes', payload.notes ? String(payload.notes) : null);

  if (payload.active !== undefined) {
    const b = asBool(payload.active);
    if (b === null) {
      const err = new Error('active must be boolean');
      err.status = 400;
      throw err;
    }
    pushField('active', b);
  }

  if (!fields.length) {
    const current = await getBoxById(id);
    return current;
  }

  params.push(id);

  const sql = `
    UPDATE ${TB_BOX}
    SET ${fields.join(', ')}, updated_at = NOW()
    WHERE box_id = $${params.length}
    RETURNING *
  `;

  const res = await q(sql, params);
  return res.rows?.[0] || null;
}

export async function deleteBox(box_id) {
  const id = ensureBoxId(box_id);
  const res = await q(`DELETE FROM ${TB_BOX} WHERE box_id = $1 RETURNING box_id`, [id]);
  return res.rows?.[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   Itens da Caixa (SKUs) + ✅ Descrição do Produto (JOIN)
────────────────────────────────────────────────────────────── */
export async function listBoxItems(box_id) {
  const id = ensureBoxId(box_id);

  const res = await q(
    `
    SELECT
      i.box_item_id,
      i.box_id,
      i.product_code,
      i.quantity,
      i.unit,
      i.notes,
      i.created_at,
      i.updated_at,

      -- ✅ descrição vinda do cadastro do produto
      p.description AS product_description

    FROM ${TB_ITEM} i
    LEFT JOIN ${TB_PRODUCT} p
      ON p.product_code = i.product_code  -- ⚠️ se sua coluna for p.product_code, troque aqui
    WHERE i.box_id = $1
    ORDER BY i.created_at ASC
    `,
    [id]
  );

  return res.rows || [];
}

export async function deleteBoxItem(box_id, product_code) {
  const id = ensureBoxId(box_id);

  const codeSafe = safeStr(product_code, 60);
  if (!codeSafe) {
    const err = new Error('product_code is required');
    err.status = 400;
    throw err;
  }

  const res = await q(
    `DELETE FROM ${TB_ITEM} WHERE box_id = $1 AND product_code = $2 RETURNING box_item_id`,
    [id, codeSafe]
  );
  return res.rows?.[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   Extras (úteis pro PDF/relatórios)
────────────────────────────────────────────────────────────── */
export async function getBoxWithItems(box_id) {
  const box = await getBoxById(box_id);
  if (!box) return null;
  const items = await listBoxItems(box_id); // ✅ já vem com product_description
  return { ...box, items };
}

export async function listBoxesWithItems(opts = {}) {
  const list = await listBoxes(opts);
  const ids = (list.rows || []).map((r) => r.box_id);

  if (!ids.length) return { ...list, rows: [] };

  // ✅ carrega todos itens em 1 query e inclui descrição do produto
  const itemsRes = await q(
    `
      SELECT
        i.box_item_id,
        i.box_id,
        i.product_code,
        i.quantity,
        i.unit,
        i.notes,
        i.created_at,
        i.updated_at,
        p.description AS product_description
      FROM ${TB_ITEM} i
      LEFT JOIN ${TB_PRODUCT} p
        ON p.product_code = i.product_code
      WHERE i.box_id = ANY($1::bigint[])
      ORDER BY i.box_id ASC, i.created_at ASC
    `,
    [ids.map((v) => Number(v))] // ids já vem do banco, mas garante array numérico
  );

  const map = new Map();
  for (const it of itemsRes.rows || []) {
    if (!map.has(it.box_id)) map.set(it.box_id, []);
    map.get(it.box_id).push(it);
  }

  const rows = (list.rows || []).map((b) => ({ ...b, items: map.get(b.box_id) || [] }));
  return { ...list, rows };
}

export async function upsertBoxItem(box_id, item = {}) {
  const id = ensureBoxId(box_id);

  // aceita "sku" ou "product_code"
  const product_code = safeStr(item.product_code ?? item.sku, 60);
  if (!product_code) {
    const err = new Error('product_code (ou sku) is required');
    err.status = 400;
    throw err;
  }

  const quantity = asNum(item.quantity);
  if (quantity === null || quantity <= 0) {
    const err = new Error('quantity must be > 0');
    err.status = 400;
    throw err;
  }

  const unit = item.unit ? safeStr(item.unit, 20) : null;
  const notes = item.notes ? String(item.notes) : null;

  const sql = `
    INSERT INTO ${TB_ITEM} (box_id, product_code, quantity, unit, notes)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (box_id, product_code)
    DO UPDATE SET
      quantity = EXCLUDED.quantity,
      unit = EXCLUDED.unit,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING *
  `;

  const res = await q(sql, [id, product_code, quantity, unit, notes]);
  return res.rows?.[0] || null;
}

export async function listBoxesByProductCode(product_code) {
  const code = safeStr(product_code, 60);
  if (!code) {
    const err = new Error('invalid product_code');
    err.status = 400;
    throw err;
  }

  const res = await q(
    `
    SELECT
      b.box_id,
      b.name,
      b.box_type,
      b.location,
      b.active,
      i.quantity,
      i.unit,
      i.updated_at
    FROM ${TB_ITEM} i
    JOIN ${TB_BOX} b ON b.box_id = i.box_id
    WHERE i.product_code = $1
    ORDER BY b.name ASC, b.box_id ASC
    `,
    [code]
  );

  return res.rows || [];
}

export async function getBoxByProductCode(product_code) {
  const sku = safeStr(product_code, 60);
  if (!sku) return null;

  const res = await q(
    `
      SELECT b.*
      FROM ${TB_ITEM} i
      INNER JOIN ${TB_BOX} b ON b.box_id = i.box_id
      WHERE i.product_code = $1
      LIMIT 1
    `,
    [sku]
  );

  return res.rows?.[0] || null;
}
