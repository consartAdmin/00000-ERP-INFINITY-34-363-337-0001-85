/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: vehiclesApi.js                                                ║
   ║ MODULE: Entregas — Veículos (frota)                                 ║
   ║ DESCRIPTION: DAL de public."vehicles"                               ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../../config/db.js';
import {
  VEHICLE_TYPES, httpError, toInt, toNum, toBool, cleanText, toEnum, mapDbError,
} from './deliveryTripsSchema.js';

const TB = 'public."vehicles"';

const COLS = [
  'vehicle_id', 'plate', 'description', 'brand', 'vehicle_type', 'model_year', 'renavam',
  'capacity_kg', 'capacity_m3', 'is_active', 'notes', 'created_at', 'updated_at',
].join(', ');

function normalizePlate(v) {
  const s = cleanText(v, 10);
  if (!s) throw httpError('PLATE_REQUIRED', 400);
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function pickPayload(data = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || 'plate' in data) out.plate = normalizePlate(data.plate);
  if (!partial || 'description' in data) {
    out.description = cleanText(data.description, 120);
    if (!out.description) throw httpError('DESCRIPTION_REQUIRED', 400);
  }
  if (!partial || 'brand' in data) out.brand = cleanText(data.brand, 60);
  if (!partial || 'vehicle_type' in data) out.vehicle_type = toEnum(data.vehicle_type, VEHICLE_TYPES, 'INVALID_VEHICLE_TYPE', 'CARRO');
  if (!partial || 'model_year' in data) out.model_year = toInt(data.model_year);
  if (!partial || 'renavam' in data) out.renavam = cleanText(data.renavam, 20);
  if (!partial || 'capacity_kg' in data) out.capacity_kg = toNum(data.capacity_kg);
  if (!partial || 'capacity_m3' in data) out.capacity_m3 = toNum(data.capacity_m3);
  if (!partial || 'is_active' in data) out.is_active = toBool(data.is_active, true);
  if (!partial || 'notes' in data) out.notes = cleanText(data.notes);
  return out;
}

export async function listVehicles({ q = '', is_active = null } = {}) {
  const where = [];
  const params = [];
  const term = cleanText(q);
  if (term) {
    params.push(`%${term}%`);
    where.push(`(plate ILIKE $${params.length} OR description ILIKE $${params.length} OR brand ILIKE $${params.length})`);
  }
  const active = toBool(is_active, null);
  if (active !== null) {
    params.push(active);
    where.push(`is_active = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM ${TB} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY plate`,
    params
  );
  return rows;
}

export async function getVehicleById(id) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM ${TB} WHERE vehicle_id = $1`, [toInt(id)]);
  if (!rows[0]) throw httpError('VEHICLE_NOT_FOUND', 404);
  return rows[0];
}

export async function createVehicle(data) {
  const p = pickPayload(data);
  const cols = Object.keys(p);
  try {
    const { rows } = await pool.query(
      `INSERT INTO ${TB} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING ${COLS}`,
      cols.map((c) => p[c])
    );
    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
}

export async function updateVehicle(id, data) {
  const p = pickPayload(data, { partial: true });
  const cols = Object.keys(p);
  if (!cols.length) return getVehicleById(id);
  try {
    const { rows } = await pool.query(
      `UPDATE ${TB} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}
        WHERE vehicle_id = $1 RETURNING ${COLS}`,
      [toInt(id), ...cols.map((c) => p[c])]
    );
    if (!rows[0]) throw httpError('VEHICLE_NOT_FOUND', 404);
    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
}

export async function deleteVehicle(id) {
  try {
    const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE vehicle_id = $1`, [toInt(id)]);
    if (!rowCount) throw httpError('VEHICLE_NOT_FOUND', 404);
    return { vehicle_id: toInt(id) };
  } catch (err) {
    throw mapDbError(err);
  }
}
