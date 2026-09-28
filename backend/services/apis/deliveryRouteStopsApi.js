// ╔══════════════════════════════════════════════════════════════════════╗
// ║ deliveryRouteStopsApi.js — DAL Postgres (Paradas de Rotas)          ║
// ║ CONSART ERP | ESM                                                   ║
// ║ Tabela: public."deliveryRouteStops"                                 ║
// ║ CRUD + list by route + reorder + status                             ║
// ║ Requisitos: pool em ../../config/db.js                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB = 'public."deliveryRouteStops"';

// ======================================================================
// Helpers
// ======================================================================
function toInt(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function cleanText(v, maxLen = null) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeMovementType(v, d = 'delivery') {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'pickup' || s === 'delivery') return s;
  return d;
}

function normalizeLinkedType(v, d = 'other') {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'customer' || s === 'supplier' || s === 'other') return s;
  return d;
}

function normalizeStatus(v, d = 'pending') {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'pending' || s === 'done' || s === 'canceled') return s;
  return d;
}

function normalizeDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function normalizeTime(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function coerceByLinkedType(data = {}) {
  const linked_type = normalizeLinkedType(data.linked_type, 'other');

  const out = {
    route_id: toInt(data.route_id, null),
    stop_order: toInt(data.stop_order, null),
    movement_type: normalizeMovementType(data.movement_type, 'delivery'),
    linked_type,

    customer_id: data.customer_id != null ? toInt(data.customer_id, null) : null,
    supplier_id: data.supplier_id != null ? toInt(data.supplier_id, null) : null,

    name: cleanText(data.name, 255),
    tax_id: cleanText(data.tax_id, 32),
    address: cleanText(data.address, 500),
    city: cleanText(data.city, 120),
    region: cleanText(data.region, 120),
    contact_name: cleanText(data.contact_name, 255),
    phone: cleanText(data.phone, 50),
    notes: data.notes ?? null,
    expected_date: normalizeDate(data.expected_date),
    expected_time: normalizeTime(data.expected_time),
    status: normalizeStatus(data.status, 'pending'),
  };

  if (linked_type === 'customer') {
    out.supplier_id = null;
  } else if (linked_type === 'supplier') {
    out.customer_id = null;
  } else {
    out.customer_id = null;
    out.supplier_id = null;
  }

  return out;
}

async function ensureRouteExists(route_id) {
  const sql = `
    SELECT 1
    FROM public."deliveryRoutes"
    WHERE route_id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [route_id]);
  return !!rows[0];
}

async function getNextStopOrder(route_id) {
  const sql = `
    SELECT COALESCE(MAX(stop_order), 0) + 1 AS next_order
    FROM ${TB}
    WHERE route_id = $1;
  `;
  const { rows } = await pool.query(sql, [route_id]);
  return Number(rows?.[0]?.next_order || 1);
}

// ======================================================================
// CRUD
// ======================================================================
export async function createDeliveryRouteStop(data = {}) {
  const payload = coerceByLinkedType(data);

  if (!payload.route_id) {
    const err = new Error('route_id is required');
    err.status = 400;
    throw err;
  }

  if (!(await ensureRouteExists(payload.route_id))) {
    const err = new Error('Route not found');
    err.status = 404;
    throw err;
  }

  if (!payload.stop_order || payload.stop_order <= 0) {
    payload.stop_order = await getNextStopOrder(payload.route_id);
  }

  const sql = `
    INSERT INTO ${TB}
      (
        route_id, stop_order, movement_type, linked_type,
        customer_id, supplier_id,
        name, tax_id, address, city, region,
        contact_name, phone, notes, expected_date, expected_time, status
      )
    VALUES
      (
        $1,$2,$3,$4,
        $5,$6,
        $7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17
      )
    RETURNING
      stop_id, route_id, stop_order, movement_type, linked_type,
      customer_id, supplier_id,
      name, tax_id, address, city, region,
      contact_name, phone, notes, expected_date, expected_time, status,
      created_at, updated_at;
  `;

  const params = [
    payload.route_id,
    payload.stop_order,
    payload.movement_type,
    payload.linked_type,
    payload.customer_id,
    payload.supplier_id,
    payload.name,
    payload.tax_id,
    payload.address,
    payload.city,
    payload.region,
    payload.contact_name,
    payload.phone,
    payload.notes,
    payload.expected_date,
    payload.expected_time,
    payload.status,
  ];

  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

export async function getDeliveryRouteStopById(stop_id) {
  const id = toInt(stop_id, null);
  if (!id) return null;

  const sql = `
    SELECT
      stop_id, route_id, stop_order, movement_type, linked_type,
      customer_id, supplier_id,
      name, tax_id, address, city, region,
      contact_name, phone, notes, expected_date, expected_time, status,
      created_at, updated_at
    FROM ${TB}
    WHERE stop_id = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

export async function listDeliveryRouteStopsByRoute(route_id) {
  const id = toInt(route_id, null);
  if (!id) {
    const err = new Error('route_id invalid');
    err.status = 400;
    throw err;
  }

  const sql = `
    SELECT
      stop_id, route_id, stop_order, movement_type, linked_type,
      customer_id, supplier_id,
      name, tax_id, address, city, region,
      contact_name, phone, notes, expected_date, expected_time, status,
      created_at, updated_at
    FROM ${TB}
    WHERE route_id = $1
    ORDER BY stop_order ASC, stop_id ASC;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows;
}

export async function updateDeliveryRouteStop(stop_id, data = {}) {
  const id = toInt(stop_id, null);
  if (!id) {
    const err = new Error('stop_id invalid');
    err.status = 400;
    throw err;
  }

  const current = await getDeliveryRouteStopById(id);
  if (!current) return null;

  const finalLinkedType = Object.prototype.hasOwnProperty.call(data, 'linked_type')
    ? normalizeLinkedType(data.linked_type, 'other')
    : normalizeLinkedType(current.linked_type, 'other');

  const set = [];
  const params = [];

  if ('route_id' in data) {
    const route_id = toInt(data.route_id, null);
    if (!route_id) {
      const err = new Error('route_id invalid');
      err.status = 400;
      throw err;
    }
    if (!(await ensureRouteExists(route_id))) {
      const err = new Error('Route not found');
      err.status = 404;
      throw err;
    }
    params.push(route_id);
    set.push(`route_id = $${params.length}`);
  }

  if ('stop_order' in data) {
    const v = toInt(data.stop_order, null);
    if (!v || v <= 0) {
      const err = new Error('stop_order invalid');
      err.status = 400;
      throw err;
    }
    params.push(v);
    set.push(`stop_order = $${params.length}`);
  }

  if ('movement_type' in data) {
    params.push(normalizeMovementType(data.movement_type, 'delivery'));
    set.push(`movement_type = $${params.length}`);
  }

  if ('linked_type' in data) {
    params.push(finalLinkedType);
    set.push(`linked_type = $${params.length}`);
  }

  if ('name' in data) {
    params.push(cleanText(data.name, 255));
    set.push(`name = $${params.length}`);
  }

  if ('tax_id' in data) {
    params.push(cleanText(data.tax_id, 32));
    set.push(`tax_id = $${params.length}`);
  }

  if ('address' in data) {
    params.push(cleanText(data.address, 500));
    set.push(`address = $${params.length}`);
  }

  if ('city' in data) {
    params.push(cleanText(data.city, 120));
    set.push(`city = $${params.length}`);
  }

  if ('region' in data) {
    params.push(cleanText(data.region, 120));
    set.push(`region = $${params.length}`);
  }

  if ('contact_name' in data) {
    params.push(cleanText(data.contact_name, 255));
    set.push(`contact_name = $${params.length}`);
  }

  if ('phone' in data) {
    params.push(cleanText(data.phone, 50));
    set.push(`phone = $${params.length}`);
  }

  if ('notes' in data) {
    params.push(data.notes ?? null);
    set.push(`notes = $${params.length}`);
  }

  if ('expected_date' in data) {
    params.push(normalizeDate(data.expected_date));
    set.push(`expected_date = $${params.length}`);
  }

  if ('expected_time' in data) {
    params.push(normalizeTime(data.expected_time));
    set.push(`expected_time = $${params.length}`);
  }

  if ('status' in data) {
    params.push(normalizeStatus(data.status, 'pending'));
    set.push(`status = $${params.length}`);
  }

  const customerProvided = Object.prototype.hasOwnProperty.call(data, 'customer_id');
  const supplierProvided = Object.prototype.hasOwnProperty.call(data, 'supplier_id');
  const linkedTypeProvided = Object.prototype.hasOwnProperty.call(data, 'linked_type');
  const shouldTouchLinks = customerProvided || supplierProvided || linkedTypeProvided;

  if (shouldTouchLinks) {
    let finalCustomerId = current.customer_id;
    let finalSupplierId = current.supplier_id;

    if (customerProvided) {
      finalCustomerId = data.customer_id == null ? null : toInt(data.customer_id, null);
    }

    if (supplierProvided) {
      finalSupplierId = data.supplier_id == null ? null : toInt(data.supplier_id, null);
    }

    if (finalLinkedType === 'customer') {
      finalSupplierId = null;
    } else if (finalLinkedType === 'supplier') {
      finalCustomerId = null;
    } else {
      finalCustomerId = null;
      finalSupplierId = null;
    }

    params.push(finalCustomerId);
    set.push(`customer_id = $${params.length}`);

    params.push(finalSupplierId);
    set.push(`supplier_id = $${params.length}`);
  }

  if (!set.length) return current;

  params.push(id);

  const sql = `
    UPDATE ${TB}
    SET ${set.join(', ')}
    WHERE stop_id = $${params.length}
    RETURNING
      stop_id, route_id, stop_order, movement_type, linked_type,
      customer_id, supplier_id,
      name, tax_id, address, city, region,
      contact_name, phone, notes, expected_date, expected_time, status,
      created_at, updated_at;
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

export async function deleteDeliveryRouteStop(stop_id) {
  const id = toInt(stop_id, null);
  if (!id) {
    const err = new Error('stop_id invalid');
    err.status = 400;
    throw err;
  }

  const sql = `
    DELETE FROM ${TB}
    WHERE stop_id = $1
    RETURNING stop_id, route_id;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

export async function setDeliveryRouteStopStatus(stop_id, status) {
  const id = toInt(stop_id, null);
  const st = normalizeStatus(status, null);

  if (!id) {
    const err = new Error('stop_id invalid');
    err.status = 400;
    throw err;
  }

  if (!st) {
    const err = new Error('status invalid');
    err.status = 400;
    throw err;
  }

  const sql = `
    UPDATE ${TB}
    SET status = $1
    WHERE stop_id = $2
    RETURNING
      stop_id, route_id, stop_order, movement_type, linked_type,
      customer_id, supplier_id,
      name, tax_id, address, city, region,
      contact_name, phone, notes, expected_date, expected_time, status,
      created_at, updated_at;
  `;

  const { rows } = await pool.query(sql, [st, id]);
  return rows[0] || null;
}

export async function reorderDeliveryRouteStops(route_id, items = []) {
  const rid = toInt(route_id, null);
  if (!rid) {
    const err = new Error('route_id invalid');
    err.status = 400;
    throw err;
  }

  if (!Array.isArray(items) || !items.length) {
    const err = new Error('items is required');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const item of items) {
      const stop_id = toInt(item?.stop_id, null);
      const stop_order = toInt(item?.stop_order, null);

      if (!stop_id || !stop_order || stop_order <= 0) {
        const err = new Error('Invalid reorder item');
        err.status = 400;
        throw err;
      }

      const sql = `
        UPDATE ${TB}
        SET stop_order = $1
        WHERE stop_id = $2
          AND route_id = $3;
      `;
      await client.query(sql, [stop_order, stop_id, rid]);
    }

    await client.query('COMMIT');
    return await listDeliveryRouteStopsByRoute(rid);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}