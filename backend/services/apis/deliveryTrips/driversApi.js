/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: driversApi.js                                                 ║
   ║ MODULE: Entregas — Motoristas                                       ║
   ║ DESCRIPTION: DAL de public."drivers" (motorista = funcionário +     ║
   ║              dados de CNH). Nome/CPF vêm de public.employees.       ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../../config/db.js';
import { httpError, toInt, toBool, cleanText, toDate, mapDbError } from './deliveryTripsSchema.js';

const TB = 'public."drivers"';

const SELECT = `
  SELECT d.driver_id, d.employee_id, d.cnh_number, d.cnh_category, d.cnh_expiration::text AS cnh_expiration,
         COALESCE(d.phone, e.mobile, e.phone) AS phone, d.phone AS driver_phone,
         d.is_active, d.notes, d.created_at, d.updated_at,
         e.full_name, e.cpf, e.position, e.active AS employee_active,
         (d.cnh_expiration IS NOT NULL AND d.cnh_expiration < CURRENT_DATE) AS cnh_expired
    FROM ${TB} d
    JOIN public.employees e ON e.employee_id = d.employee_id
`;

function pickPayload(data = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || 'employee_id' in data) out.employee_id = toInt(data.employee_id);
  if (!partial || 'cnh_number' in data) out.cnh_number = cleanText(data.cnh_number, 20);
  if (!partial || 'cnh_category' in data) out.cnh_category = cleanText(data.cnh_category, 5)?.toUpperCase() ?? null;
  if (!partial || 'cnh_expiration' in data) out.cnh_expiration = toDate(data.cnh_expiration);
  if (!partial || 'phone' in data) out.phone = cleanText(data.phone, 30);
  if (!partial || 'is_active' in data) out.is_active = toBool(data.is_active, true);
  if (!partial || 'notes' in data) out.notes = cleanText(data.notes);
  if ('employee_id' in out && !out.employee_id) throw httpError('EMPLOYEE_ID_REQUIRED', 400);
  return out;
}

export async function listDrivers({ q = '', is_active = null } = {}) {
  const where = [];
  const params = [];
  const term = cleanText(q);
  if (term) {
    params.push(`%${term}%`);
    where.push(`(e.full_name ILIKE $${params.length} OR e.cpf ILIKE $${params.length} OR d.cnh_number ILIKE $${params.length})`);
  }
  const active = toBool(is_active, null);
  if (active !== null) {
    params.push(active);
    where.push(`d.is_active = $${params.length}`);
  }
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.full_name`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getDriverById(id) {
  const { rows } = await pool.query(`${SELECT} WHERE d.driver_id = $1`, [toInt(id)]);
  if (!rows[0]) throw httpError('DRIVER_NOT_FOUND', 404);
  return rows[0];
}

export async function createDriver(data) {
  const p = pickPayload(data);
  try {
    const { rows } = await pool.query(
      `INSERT INTO ${TB} (employee_id, cnh_number, cnh_category, cnh_expiration, phone, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING driver_id`,
      [p.employee_id, p.cnh_number, p.cnh_category, p.cnh_expiration, p.phone, p.is_active, p.notes]
    );
    return getDriverById(rows[0].driver_id);
  } catch (err) {
    if (err?.code === '23503') throw httpError('EMPLOYEE_NOT_FOUND', 404);
    throw mapDbError(err);
  }
}

export async function updateDriver(id, data) {
  const p = pickPayload(data, { partial: true });
  const cols = Object.keys(p);
  if (!cols.length) return getDriverById(id);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  try {
    const { rowCount } = await pool.query(
      `UPDATE ${TB} SET ${sets} WHERE driver_id = $1`,
      [toInt(id), ...cols.map((c) => p[c])]
    );
    if (!rowCount) throw httpError('DRIVER_NOT_FOUND', 404);
    return getDriverById(id);
  } catch (err) {
    if (err?.code === '23503') throw httpError('EMPLOYEE_NOT_FOUND', 404);
    throw mapDbError(err);
  }
}

export async function deleteDriver(id) {
  try {
    const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE driver_id = $1`, [toInt(id)]);
    if (!rowCount) throw httpError('DRIVER_NOT_FOUND', 404);
    return { driver_id: toInt(id) };
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Funcionários ativos que ainda não são motoristas (para o cadastro) */
export async function listEligibleEmployees({ q = '' } = {}) {
  const params = [];
  let filter = '';
  const term = cleanText(q);
  if (term) {
    params.push(`%${term}%`);
    filter = `AND (e.full_name ILIKE $1 OR e.cpf ILIKE $1)`;
  }
  const { rows } = await pool.query(
    `SELECT e.employee_id, e.full_name, e.cpf, e.position, COALESCE(e.mobile, e.phone) AS phone
       FROM public.employees e
      WHERE COALESCE(e.active, TRUE) = TRUE
        AND NOT EXISTS (SELECT 1 FROM ${TB} d WHERE d.employee_id = e.employee_id)
        ${filter}
      ORDER BY e.full_name
      LIMIT 200`,
    params
  );
  return rows;
}
