// ╔══════════════════════════════════════════════════════════════════════╗
// ║ banksApi.js — DAL de instituições financeiras                      ║
// ║ CONSART ERP | PostgreSQL | ESM                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB = 'public."banks"';

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

export async function listBanks({ search, active } = {}) {
  const where = [];
  const params = [];

  if (search) {
    params.push(`%${String(search).trim()}%`);
    where.push(`(b.name ILIKE $${params.length} OR b.code ILIKE $${params.length})`);
  }

  if (active !== undefined && active !== null && active !== '') {
    params.push(String(active).toLowerCase() !== 'false');
    where.push(`b.is_active = $${params.length}`);
  }

  const sql = `
    SELECT b.id, b.code, b.name, b.is_active, b.created_at, b.updated_at
    FROM ${TB} b
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY b.name ASC, b.id ASC;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getBankById(value) {
  const id = positiveId(value);
  if (!id) return null;

  const { rows } = await pool.query(`
    SELECT b.id, b.code, b.name, b.is_active, b.created_at, b.updated_at
    FROM ${TB} b
    WHERE b.id = $1;
  `, [id]);

  return rows[0] || null;
}

export async function createBank(data = {}) {
  const name = optionalText(data.name, 150);
  const code = optionalText(data.code, 10);

  if (!name) throw Object.assign(new Error('Informe o nome do banco.'), { statusCode: 400 });

  const { rows } = await pool.query(`
    INSERT INTO ${TB} (code, name, is_active)
    VALUES ($1, $2, $3)
    RETURNING id, code, name, is_active, created_at, updated_at;
  `, [code, name, data.is_active !== false]);

  return rows[0];
}

export async function updateBank(value, data = {}) {
  const id = positiveId(value);
  if (!id) throw Object.assign(new Error('ID do banco inválido.'), { statusCode: 400 });

  const current = await getBankById(id);
  if (!current) return null;

  const name = data.name === undefined ? current.name : optionalText(data.name, 150);
  const code = data.code === undefined ? current.code : optionalText(data.code, 10);
  const isActive = data.is_active === undefined ? current.is_active : Boolean(data.is_active);

  if (!name) throw Object.assign(new Error('Informe o nome do banco.'), { statusCode: 400 });

  const { rows } = await pool.query(`
    UPDATE ${TB}
    SET code = $1, name = $2, is_active = $3, updated_at = now()
    WHERE id = $4
    RETURNING id, code, name, is_active, created_at, updated_at;
  `, [code, name, isActive, id]);

  return rows[0] || null;
}

export async function deactivateBank(value) {
  const id = positiveId(value);
  if (!id) throw Object.assign(new Error('ID do banco inválido.'), { statusCode: 400 });

  const { rows } = await pool.query(`
    UPDATE ${TB}
    SET is_active = FALSE, updated_at = now()
    WHERE id = $1
    RETURNING id, code, name, is_active, created_at, updated_at;
  `, [id]);

  return rows[0] || null;
}

export default { listBanks, getBankById, createBank, updateBank, deactivateBank };
