// ╔══════════════════════════════════════════════════════════════════════╗
// ║ deliveryRoutesApi.js — DAL Postgres (Rotas de Entrega)               ║
// ║ CONSART ERP | ESM                                                   ║
// ║ Tabela: public."deliveryRoutes"                                     ║
// ║ CRUD + list (q, is_active, route_type, paginado)                    ║
// ║ ✅ Vínculo: customer_id / supplier_id + linked_name/linked_tax_id    ║
// ║ Requisitos: pool em ../../config/db.js                              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

// ======================================================================
// Table
// ======================================================================
const TB = 'public."deliveryRoutes"';

// ======================================================================
// Helpers
// ======================================================================
function toInt(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toBool(v, d = null) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined) return d;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'sim'].includes(s)) return true;
  if (['0', 'false', 'f', 'no', 'n', 'nao', 'não'].includes(s)) return false;
  return d;
}

function normalizeWeekdays(weekdays) {
  if (weekdays == null) return [];
  if (Array.isArray(weekdays)) {
    return weekdays
      .map((x) => toInt(x, null))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  }
  const s = String(weekdays).replace(/[{}]/g, '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((x) => toInt(x.trim(), null))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

function normalizeRouteType(v, d = 'customers') {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'customers' || s === 'suppliers') return s;
  return d;
}

function cleanText(v, maxLen = null) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (maxLen && trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
}

function coerceLinkByType(payload) {
  const t = normalizeRouteType(payload.route_type, 'customers');
  const out = { ...payload, route_type: t };

  if (t === 'customers') {
    out.supplier_id = null;
  } else {
    out.customer_id = null;
  }

  return out;
}

function buildWhere({ q, is_active, route_type }) {
  const where = [];
  const params = [];

  const qStr = (q ?? '').toString().trim();
  if (qStr) {
    params.push(`%${qStr}%`);
    const p = `$${params.length}`;
    where.push(
      `(name ILIKE ${p} OR route_code ILIKE ${p} OR city ILIKE ${p} OR region ILIKE ${p} OR driver_name ILIKE ${p} OR vehicle_plate ILIKE ${p} OR linked_name ILIKE ${p} OR linked_tax_id ILIKE ${p})`
    );
  }

  const act = toBool(is_active, null);
  if (act !== null) {
    params.push(act);
    where.push(`is_active = $${params.length}`);
  }

  const rt = route_type === null || route_type === undefined || route_type === ''
    ? null
    : normalizeRouteType(route_type, null);

  if (rt) {
    params.push(rt);
    where.push(`route_type = $${params.length}`);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// ======================================================================
// CRUD
// ======================================================================
export async function createDeliveryRoute(data = {}) {
  const payload = coerceLinkByType({
    route_code: cleanText(data.route_code, 80),
    name: cleanText(data.name, 255) || '',
    route_type: normalizeRouteType(data.route_type, 'customers'),

    city: cleanText(data.city, 100),
    region: cleanText(data.region, 100),
    weekdays: normalizeWeekdays(data.weekdays),

    driver_name: cleanText(data.driver_name, 120),
    vehicle_plate: cleanText(data.vehicle_plate, 20),

    is_active: toBool(data.is_active, true),
    notes: data.notes ?? null,

    customer_id: data.customer_id != null ? toInt(data.customer_id, null) : null,
    supplier_id: data.supplier_id != null ? toInt(data.supplier_id, null) : null,
    linked_name: cleanText(data.linked_name, 255),
    linked_tax_id: cleanText(data.linked_tax_id, 32),
  });

  if (!payload.name) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }

  const sql = `
    INSERT INTO ${TB}
      (route_code, name, route_type, city, region, weekdays, driver_name, vehicle_plate, is_active, notes,
       customer_id, supplier_id, linked_name, linked_tax_id)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING
      route_id, route_code, name, route_type, city, region, weekdays, driver_name, vehicle_plate, is_active, notes,
      customer_id, supplier_id, linked_name, linked_tax_id,
      created_at, updated_at;
  `;

  const params = [
    payload.route_code,
    payload.name,
    payload.route_type,
    payload.city,
    payload.region,
    payload.weekdays,
    payload.driver_name,
    payload.vehicle_plate,
    payload.is_active,
    payload.notes,
    payload.customer_id,
    payload.supplier_id,
    payload.linked_name,
    payload.linked_tax_id,
  ];

  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

export async function getDeliveryRouteById(route_id) {
  const id = toInt(route_id, null);
  if (!id) return null;

  const sql = `
    SELECT
      route_id, route_code, name, route_type, city, region, weekdays, driver_name, vehicle_plate, is_active, notes,
      customer_id, supplier_id, linked_name, linked_tax_id,
      created_at, updated_at
    FROM ${TB}
    WHERE route_id = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

export async function updateDeliveryRoute(route_id, data = {}) {
  const id = toInt(route_id, null);
  if (!id) {
    const err = new Error('route_id invalid');
    err.status = 400;
    throw err;
  }

  const current = await getDeliveryRouteById(id);
  if (!current) return null;

  const finalRouteType = ('route_type' in data)
    ? normalizeRouteType(data.route_type, 'customers')
    : normalizeRouteType(current.route_type, 'customers');

  const set = [];
  const params = [];

  if ('route_code' in data) {
    params.push(cleanText(data.route_code, 80));
    set.push(`route_code = $${params.length}`);
  }

  if ('name' in data) {
    const v = cleanText(data.name, 255) || '';
    if (!v) {
      const err = new Error('name is required');
      err.status = 400;
      throw err;
    }
    params.push(v);
    set.push(`name = $${params.length}`);
  }

  if ('route_type' in data) {
    params.push(finalRouteType);
    set.push(`route_type = $${params.length}`);
  }

  if ('city' in data) {
    params.push(cleanText(data.city, 100));
    set.push(`city = $${params.length}`);
  }

  if ('region' in data) {
    params.push(cleanText(data.region, 100));
    set.push(`region = $${params.length}`);
  }

  if ('weekdays' in data) {
    params.push(normalizeWeekdays(data.weekdays));
    set.push(`weekdays = $${params.length}`);
  }

  if ('driver_name' in data) {
    params.push(cleanText(data.driver_name, 120));
    set.push(`driver_name = $${params.length}`);
  }

  if ('vehicle_plate' in data) {
    params.push(cleanText(data.vehicle_plate, 20));
    set.push(`vehicle_plate = $${params.length}`);
  }

  if ('is_active' in data) {
    const v = toBool(data.is_active, null);
    if (v === null) {
      const err = new Error('is_active invalid');
      err.status = 400;
      throw err;
    }
    params.push(v);
    set.push(`is_active = $${params.length}`);
  }

  if ('notes' in data) {
    params.push(data.notes ?? null);
    set.push(`notes = $${params.length}`);
  }

  if ('linked_name' in data) {
    params.push(cleanText(data.linked_name, 255));
    set.push(`linked_name = $${params.length}`);
  }

  if ('linked_tax_id' in data) {
    params.push(cleanText(data.linked_tax_id, 32));
    set.push(`linked_tax_id = $${params.length}`);
  }

  // ============================================================
  // VÍNCULOS — sempre definir UMA ÚNICA VEZ, sem repetir coluna
  // ============================================================
  const customerProvided = Object.prototype.hasOwnProperty.call(data, 'customer_id');
  const supplierProvided = Object.prototype.hasOwnProperty.call(data, 'supplier_id');
  const routeTypeProvided = Object.prototype.hasOwnProperty.call(data, 'route_type');

  const shouldTouchLinks = routeTypeProvided || customerProvided || supplierProvided;

  if (shouldTouchLinks) {
    let finalCustomerId = current.customer_id;
    let finalSupplierId = current.supplier_id;

    if (customerProvided) {
      finalCustomerId = data.customer_id == null ? null : toInt(data.customer_id, null);
    }

    if (supplierProvided) {
      finalSupplierId = data.supplier_id == null ? null : toInt(data.supplier_id, null);
    }

    if (finalRouteType === 'customers') {
      finalSupplierId = null;
    } else if (finalRouteType === 'suppliers') {
      finalCustomerId = null;
    }

    params.push(finalCustomerId);
    set.push(`customer_id = $${params.length}`);

    params.push(finalSupplierId);
    set.push(`supplier_id = $${params.length}`);
  }

  if (!set.length) {
    return current;
  }

  params.push(id);

  const sql = `
    UPDATE ${TB}
    SET ${set.join(', ')}
    WHERE route_id = $${params.length}
    RETURNING
      route_id, route_code, name, route_type, city, region, weekdays, driver_name, vehicle_plate, is_active, notes,
      customer_id, supplier_id, linked_name, linked_tax_id,
      created_at, updated_at;
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

export async function deleteDeliveryRoute(route_id) {
  const id = toInt(route_id, null);
  if (!id) {
    const err = new Error('route_id invalid');
    err.status = 400;
    throw err;
  }

  const sql = `
    DELETE FROM ${TB}
    WHERE route_id = $1
    RETURNING route_id;
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

export async function setDeliveryRouteActive(route_id, isActive) {
  const id = toInt(route_id, null);
  const v = toBool(isActive, null);

  if (!id || v === null) {
    const err = new Error('route_id / is_active invalid');
    err.status = 400;
    throw err;
  }

  const sql = `
    UPDATE ${TB}
    SET is_active = $1
    WHERE route_id = $2
    RETURNING
      route_id, route_code, name, route_type, city, region, weekdays, driver_name, vehicle_plate, is_active, notes,
      customer_id, supplier_id, linked_name, linked_tax_id,
      created_at, updated_at;
  `;

  const { rows } = await pool.query(sql, [v, id]);
  return rows[0] || null;
}

// ======================================================================
// List / Search (paginado)
// ======================================================================
export async function listDeliveryRoutes({
  q = '',
  is_active = null,
  route_type = null,
  limit = 50,
  offset = 0,
  order = 'name',
  dir = 'asc',
} = {}) {
  const { whereSql, params } = buildWhere({ q, is_active, route_type });

  const lim = Math.max(1, Math.min(200, toInt(limit, 50)));
  const off = Math.max(0, toInt(offset, 0));

  const allowedOrder = new Set(['name', 'route_id', 'created_at', 'updated_at']);
  const orderBy = allowedOrder.has(String(order)) ? String(order) : 'name';
  const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const sqlCount = `SELECT COUNT(*)::bigint AS total FROM ${TB} ${whereSql};`;
  const countRes = await pool.query(sqlCount, params);
  const total = Number(countRes.rows?.[0]?.total || 0);

  params.push(lim);
  const pLim = `$${params.length}`;
  params.push(off);
  const pOff = `$${params.length}`;

  const sql = `
    SELECT
      route_id, route_code, name, route_type, city, region, weekdays, driver_name, vehicle_plate, is_active, notes,
      customer_id, supplier_id, linked_name, linked_tax_id,
      created_at, updated_at
    FROM ${TB}
    ${whereSql}
    ORDER BY ${orderBy} ${direction}, route_id ASC
    LIMIT ${pLim} OFFSET ${pOff};
  `;

  const { rows } = await pool.query(sql, params);

  return {
    total,
    limit: lim,
    offset: off,
    rows,
  };
}