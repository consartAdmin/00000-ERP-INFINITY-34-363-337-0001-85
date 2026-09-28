/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ pdv_loginsApi.js — Acesso a dados dos usuários do PDV               ║
   ║ CONSART ERP                                                          ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import bcrypt from 'bcryptjs';
import pool from '../../config/db.js';

const TABLE = 'public.pdv_logins';
const DEFAULT_ROLE = 'operator';
const ALLOWED_ROLES = new Set(['operator', 'supervisor', 'admin']);
const BCRYPT_ROUNDS = 12;

const SAFE_COLUMNS = `
  id,
  username,
  full_name,
  role,
  active,
  created_at,
  updated_at
`;

function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeFullName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeRole(value) {
  const role = String(value ?? DEFAULT_ROLE).trim().toLowerCase();
  if (!ALLOWED_ROLES.has(role)) {
    const error = new Error('Perfil inválido. Use operator, supervisor ou admin.');
    error.code = 'INVALID_ROLE';
    error.status = 400;
    throw error;
  }
  return role;
}

function normalizeBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  const error = new Error('O campo active deve ser booleano.');
  error.code = 'INVALID_ACTIVE';
  error.status = 400;
  throw error;
}

function validatePassword(password, required = true) {
  if (!required && (password === undefined || password === null || password === '')) return null;
  if (typeof password !== 'string' || password.length < 8) {
    const error = new Error('A senha deve possuir no mínimo 8 caracteres.');
    error.code = 'INVALID_PASSWORD';
    error.status = 400;
    throw error;
  }
  if (password.length > 72) {
    const error = new Error('A senha deve possuir no máximo 72 caracteres.');
    error.code = 'INVALID_PASSWORD';
    error.status = 400;
    throw error;
  }
  return password;
}

function validateIdentity(username, fullName) {
  if (!username || username.length < 3 || username.length > 50) {
    const error = new Error('O usuário deve possuir entre 3 e 50 caracteres.');
    error.code = 'INVALID_USERNAME';
    error.status = 400;
    throw error;
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    const error = new Error('O usuário aceita apenas letras, números, ponto, hífen e sublinhado.');
    error.code = 'INVALID_USERNAME';
    error.status = 400;
    throw error;
  }
  if (!fullName || fullName.length > 120) {
    const error = new Error('O nome completo é obrigatório e deve possuir até 120 caracteres.');
    error.code = 'INVALID_FULL_NAME';
    error.status = 400;
    throw error;
  }
}

export async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      full_name VARCHAR(120) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(30) DEFAULT '${DEFAULT_ROLE}',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pdv_logins_active
      ON ${TABLE} (active)
  `);
}

export async function list({ search = '', role, active, page = 1, limit = 50 } = {}) {
  const where = [];
  const values = [];

  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const normalizedLimit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));

  if (String(search).trim()) {
    values.push(`%${String(search).trim()}%`);
    where.push(`(username ILIKE $${values.length} OR full_name ILIKE $${values.length})`);
  }

  if (role !== undefined && role !== null && role !== '') {
    values.push(normalizeRole(role));
    where.push(`role = $${values.length}`);
  }

  if (active !== undefined && active !== null && active !== '') {
    values.push(normalizeBoolean(active));
    where.push(`active = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${TABLE} ${whereSql}`,
    values
  );

  const queryValues = [...values, normalizedLimit, (normalizedPage - 1) * normalizedLimit];
  const result = await pool.query(
    `SELECT ${SAFE_COLUMNS}
       FROM ${TABLE}
       ${whereSql}
      ORDER BY full_name ASC, id ASC
      LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    queryValues
  );

  const total = countResult.rows[0]?.total ?? 0;
  return {
    data: result.rows,
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      total_pages: Math.ceil(total / normalizedLimit),
    },
  };
}

export async function getById(id) {
  const result = await pool.query(
    `SELECT ${SAFE_COLUMNS} FROM ${TABLE} WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function create({ username, full_name, password, role, active } = {}) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedFullName = normalizeFullName(full_name);
  validateIdentity(normalizedUsername, normalizedFullName);
  const validPassword = validatePassword(password);
  const passwordHash = await bcrypt.hash(validPassword, BCRYPT_ROUNDS);

  const result = await pool.query(
    `INSERT INTO ${TABLE}
       (username, full_name, password_hash, role, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING ${SAFE_COLUMNS}`,
    [
      normalizedUsername,
      normalizedFullName,
      passwordHash,
      normalizeRole(role),
      normalizeBoolean(active, true),
    ]
  );

  return result.rows[0];
}

export async function update(id, payload = {}) {
  const currentResult = await pool.query(
    `SELECT id, username, full_name, role, active FROM ${TABLE} WHERE id = $1`,
    [id]
  );
  const current = currentResult.rows[0];
  if (!current) return null;

  const username = payload.username === undefined
    ? current.username
    : normalizeUsername(payload.username);
  const fullName = payload.full_name === undefined
    ? current.full_name
    : normalizeFullName(payload.full_name);
  validateIdentity(username, fullName);

  const role = payload.role === undefined ? current.role : normalizeRole(payload.role);
  const active = payload.active === undefined ? current.active : normalizeBoolean(payload.active);
  const password = validatePassword(payload.password, false);

  if (password) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      `UPDATE ${TABLE}
          SET username = $2,
              full_name = $3,
              role = $4,
              active = $5,
              password_hash = $6,
              updated_at = NOW()
        WHERE id = $1
        RETURNING ${SAFE_COLUMNS}`,
      [id, username, fullName, role, active, passwordHash]
    );
    return result.rows[0] ?? null;
  }

  const result = await pool.query(
    `UPDATE ${TABLE}
        SET username = $2,
            full_name = $3,
            role = $4,
            active = $5,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${SAFE_COLUMNS}`,
    [id, username, fullName, role, active]
  );
  return result.rows[0] ?? null;
}

export async function setActive(id, active) {
  const result = await pool.query(
    `UPDATE ${TABLE}
        SET active = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING ${SAFE_COLUMNS}`,
    [id, normalizeBoolean(active)]
  );
  return result.rows[0] ?? null;
}

export async function remove(id) {
  const result = await pool.query(
    `DELETE FROM ${TABLE} WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rowCount > 0;
}

export async function verifyCredentials(username, password) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || typeof password !== 'string' || !password) return null;

  const result = await pool.query(
    `SELECT id, username, full_name, password_hash, role, active, created_at, updated_at
       FROM ${TABLE}
      WHERE username = $1
      LIMIT 1`,
    [normalizedUsername]
  );

  const user = result.rows[0];
  if (!user || !user.active) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
