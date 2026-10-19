// ╔════════════════════════════════════════════════════════════════════╗
// ║ customersConsartRepresentatives.repository.js — Representantes /   ║
// ║ sócios dos clientes Consart (quem assina o contrato pelo cliente)  ║
// ║ • list (por cliente) / getById / create / update / remove          ║
// ║ • ROLES: cargos sugeridos no select (aceita outro texto)           ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_REPRESENTATIVES as TB, ensureContractsConsartTables } from './contractsConsart.schema.js';

const TB_CUSTOMERS = 'public."customersConsart"';

export const ROLES = Object.freeze([
  'Sócio-Administrador',
  'Sócio',
  'Proprietário',
  'Diretor',
  'Presidente',
  'Gerente',
  'Procurador',
  'Representante Legal',
]);

function text(value, max) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function positiveId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function formatCpf(value) {
  const d = String(value ?? '').replace(/\D+/g, '');
  if (!d) return null;
  if (d.length !== 11) throw validationError('CPF do representante deve ter 11 dígitos.');
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function formatCep(value) {
  const d = String(value ?? '').replace(/\D+/g, '');
  if (!d) return null;
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : d.slice(0, 9);
}

function prepare(body = {}) {
  const name = text(body.name, 200);
  if (!name) throw validationError('Informe o nome do representante.');
  const role = text(body.role, 80);
  if (!role) throw validationError('Informe o cargo do representante.');

  return {
    name,
    role,
    cpf: formatCpf(body.cpf),
    rg: text(body.rg, 30),
    nationality: text(body.nationality, 60),
    marital_status: text(body.marital_status, 40),
    address: text(body.address, 255),
    city: text(body.city, 120),
    state: text(body.state, 2)?.toUpperCase() || null,
    postal_code: formatCep(body.postal_code),
    email: text(body.email, 255),
    phone: text(body.phone, 50),
    active: body.active === undefined ? true : body.active === true || body.active === 'true',
  };
}

const FIELDS = ['name', 'role', 'cpf', 'rg', 'nationality', 'marital_status', 'address',
  'city', 'state', 'postal_code', 'email', 'phone', 'active'];

/** Endereço numa linha só (para o contrato / PDF). */
export function addressLine(rep = {}) {
  const cityState = [rep.city, rep.state].map((v) => String(v ?? '').trim()).filter(Boolean).join('/');
  return [rep.address, cityState, rep.postal_code ? `CEP ${rep.postal_code}` : '']
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}

export async function list(customerId, { all = false } = {}) {
  await ensureContractsConsartTables();
  const id = positiveId(customerId);
  if (!id) return [];
  const { rows } = await pool.query(
    `SELECT * FROM ${TB}
      WHERE customer_id = $1 ${all ? '' : 'AND active'}
      ORDER BY active DESC, name`,
    [id]
  );
  return rows;
}

export async function getById(id) {
  await ensureContractsConsartTables();
  const repId = positiveId(id);
  if (!repId) return null;
  const { rows: [row] } = await pool.query(`SELECT * FROM ${TB} WHERE id = $1`, [repId]);
  return row || null;
}

export async function create(customerId, body) {
  await ensureContractsConsartTables();
  const id = positiveId(customerId);
  if (!id) throw validationError('Cliente inválido.');
  const { rowCount } = await pool.query(`SELECT 1 FROM ${TB_CUSTOMERS} WHERE customer_id = $1`, [id]);
  if (!rowCount) throw validationError('Cliente não encontrado no cadastro da Consart.');

  const data = prepare(body);
  const { rows: [row] } = await pool.query(
    `INSERT INTO ${TB} (customer_id, ${FIELDS.join(', ')})
     VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(', ')})
     RETURNING *`,
    [id, ...FIELDS.map((f) => data[f])]
  );
  return row;
}

export async function update(id, body) {
  await ensureContractsConsartTables();
  const repId = positiveId(id);
  if (!repId) return null;
  const data = prepare(body);
  const { rows: [row] } = await pool.query(
    `UPDATE ${TB} SET ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [repId, ...FIELDS.map((f) => data[f])]
  );
  return row || null;
}

export async function remove(id) {
  await ensureContractsConsartTables();
  const repId = positiveId(id);
  if (!repId) return false;
  const { rowCount } = await pool.query(`DELETE FROM ${TB} WHERE id = $1`, [repId]);
  return rowCount > 0;
}
