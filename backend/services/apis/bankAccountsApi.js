// ╔══════════════════════════════════════════════════════════════════════╗
// ║ bankAccountsApi.js — DAL de contas bancárias                      ║
// ║ CONSART ERP | PostgreSQL | ESM                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB = 'public."bankAccounts"';
const TB_BANKS = 'public."banks"';
const PROVIDERS = new Set(['ASAAS', 'MANUAL', 'OTHER_API']);
const BOLETO_MODES = new Set(['AUTOMATIC', 'MANUAL', 'NONE']);

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function optionalText(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function enumValue(value, allowed, fallback, label) {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!allowed.has(normalized)) {
    throw Object.assign(new Error(`${label} inválido.`), { statusCode: 400 });
  }
  return normalized;
}

const SELECT_FIELDS = `
  ba.id, ba.bank_id, b.code AS bank_code, b.name AS bank_name,
  ba.name, ba.agency, ba.account_number, ba.account_digit,
  ba.integration_provider, ba.boleto_mode,
  ba.is_default, ba.is_active, ba.created_at, ba.updated_at
`;

export async function listBankAccounts({ search, active, provider, bankId } = {}) {
  const where = [];
  const params = [];

  if (search) {
    params.push(`%${String(search).trim()}%`);
    where.push(`(ba.name ILIKE $${params.length} OR b.name ILIKE $${params.length} OR ba.account_number ILIKE $${params.length})`);
  }
  if (active !== undefined && active !== null && active !== '') {
    params.push(String(active).toLowerCase() !== 'false');
    where.push(`ba.is_active = $${params.length}`);
  }
  if (provider) {
    params.push(enumValue(provider, PROVIDERS, 'MANUAL', 'Provedor'));
    where.push(`ba.integration_provider = $${params.length}`);
  }
  if (bankId) {
    const id = positiveId(bankId);
    if (!id) throw Object.assign(new Error('bankId inválido.'), { statusCode: 400 });
    params.push(id);
    where.push(`ba.bank_id = $${params.length}`);
  }

  const { rows } = await pool.query(`
    SELECT ${SELECT_FIELDS}
    FROM ${TB} ba
    INNER JOIN ${TB_BANKS} b ON b.id = ba.bank_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ba.is_default DESC, ba.name ASC, ba.id ASC;
  `, params);
  return rows;
}

export async function getBankAccountById(value, db = pool) {
  const id = positiveId(value);
  if (!id) return null;
  const { rows } = await db.query(`
    SELECT ${SELECT_FIELDS}
    FROM ${TB} ba
    INNER JOIN ${TB_BANKS} b ON b.id = ba.bank_id
    WHERE ba.id = $1;
  `, [id]);
  return rows[0] || null;
}

function normalizedPayload(data, current = {}) {
  const bankId = data.bank_id === undefined ? positiveId(current.bank_id) : positiveId(data.bank_id);
  const name = data.name === undefined ? current.name : optionalText(data.name, 150);
  if (!bankId) throw Object.assign(new Error('Selecione um banco.'), { statusCode: 400 });
  if (!name) throw Object.assign(new Error('Informe o nome da conta bancária.'), { statusCode: 400 });

  return {
    bankId,
    name,
    agency: data.agency === undefined ? current.agency ?? null : optionalText(data.agency, 30),
    accountNumber: data.account_number === undefined ? current.account_number ?? null : optionalText(data.account_number, 50),
    accountDigit: data.account_digit === undefined ? current.account_digit ?? null : optionalText(data.account_digit, 10),
    provider: enumValue(data.integration_provider ?? current.integration_provider, PROVIDERS, 'MANUAL', 'Provedor'),
    boletoMode: enumValue(data.boleto_mode ?? current.boleto_mode, BOLETO_MODES, 'MANUAL', 'Modo do boleto'),
    isDefault: data.is_default === undefined ? Boolean(current.is_default) : Boolean(data.is_default),
    isActive: data.is_active === undefined ? current.is_active !== false : Boolean(data.is_active),
  };
}

async function saveBankAccount(client, id, payload) {
  if (payload.isDefault) {
    await client.query(`UPDATE ${TB} SET is_default = FALSE, updated_at = now() WHERE is_default = TRUE${id ? ' AND id <> $1' : ''};`, id ? [id] : []);
  }

  const values = [payload.bankId, payload.name, payload.agency, payload.accountNumber,
    payload.accountDigit, payload.provider, payload.boletoMode, payload.isDefault, payload.isActive];

  if (!id) {
    const { rows } = await client.query(`
      INSERT INTO ${TB} (bank_id, name, agency, account_number, account_digit,
        integration_provider, boleto_mode, is_default, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id;
    `, values);
    return rows[0].id;
  }

  await client.query(`
    UPDATE ${TB}
    SET bank_id=$1, name=$2, agency=$3, account_number=$4, account_digit=$5,
      integration_provider=$6, boleto_mode=$7, is_default=$8, is_active=$9,
      updated_at=now()
    WHERE id=$10;
  `, [...values, id]);
  return id;
}

export async function createBankAccount(data = {}) {
  const payload = normalizedPayload(data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = await saveBankAccount(client, null, payload);
    const result = await getBankAccountById(id, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function updateBankAccount(value, data = {}) {
  const id = positiveId(value);
  if (!id) throw Object.assign(new Error('ID da conta bancária inválido.'), { statusCode: 400 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await getBankAccountById(id, client);
    if (!current) { await client.query('ROLLBACK'); return null; }
    const payload = normalizedPayload(data, current);
    await saveBankAccount(client, id, payload);
    const result = await getBankAccountById(id, client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function deactivateBankAccount(value) {
  const id = positiveId(value);
  if (!id) throw Object.assign(new Error('ID da conta bancária inválido.'), { statusCode: 400 });
  const { rows } = await pool.query(`
    UPDATE ${TB}
    SET is_active=FALSE, is_default=FALSE, updated_at=now()
    WHERE id=$1 RETURNING id;
  `, [id]);
  return rows[0] ? getBankAccountById(id) : null;
}

export default { listBankAccounts, getBankAccountById, createBankAccount, updateBankAccount, deactivateBankAccount };
