// ╔══════════════════════════════════════════════════════════════════════╗
// ║ enterpriseApi.js                                                    ║
// ║ Descrição: Camada de acesso a dados da tabela enterprises           ║
// ║ Projeto: CONSART ERP                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/* =========================================================================
   Catalog Schema
   ========================================================================= */

const catalog_schema = {
  table: 'enterprises',
  idField: 'id',
  fields: [
    'corporate_name',
    'trade_name',
    'cnpj',
    'state_registration',
    'municipal_registration',
    'tax_regime_code',
    'cnae',
    'opening_date',
    'status',
    'zip_code',
    'address',
    'address_number',
    'address_complement',
    'district',
    'city',
    'state',
    'city_ibge_code',
    'phone',
    'whatsapp',
    'email',
    'website',
    'financial_contact',
    'fiscal_contact',
    'commercial_contact',
    'nfe_environment',
    'nfe_series',
    'next_nfe_number',
    'nfce_series',
    'next_nfce_number',
    'default_cfop_sale',
    'default_cfop_purchase',
    'sped_profile',
    'sped_activity_type',
    'logo_url',
    'slogan',
    'document_notes',
    'pdf_footer',
    'certificate_a1_path',
    'certificate_password',
    'accountant_name',
    'accountant_cpf',
    'accountant_crc',
    'accountant_email',
    'accountant_phone',
    'is_active'
  ],
  searchFields: [
    'corporate_name',
    'trade_name',
    'cnpj',
    'email',
    'city'
  ],
  defaultOrder: 'corporate_name ASC'
};

/* =========================================================================
   Helpers
   ========================================================================= */

function onlyDigits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function normalizeString(value) {
  return value == null ? null : String(value).trim();
}

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;

  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(v)) return false;
  return fallback;
}

function normalizeInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizePayload(payload = {}) {
  return {
    corporate_name: normalizeString(payload.corporate_name),
    trade_name: normalizeString(payload.trade_name),
    cnpj: normalizeString(payload.cnpj),
    state_registration: normalizeString(payload.state_registration),
    municipal_registration: normalizeString(payload.municipal_registration),
    tax_regime_code: normalizeString(payload.tax_regime_code),
    cnae: normalizeString(payload.cnae),
    opening_date: payload.opening_date || null,
    status: normalizeString(payload.status) || 'ACTIVE',

    zip_code: normalizeString(payload.zip_code),
    address: normalizeString(payload.address),
    address_number: normalizeString(payload.address_number),
    address_complement: normalizeString(payload.address_complement),
    district: normalizeString(payload.district),
    city: normalizeString(payload.city),
    state: normalizeString(payload.state),
    city_ibge_code: normalizeString(payload.city_ibge_code),

    phone: normalizeString(payload.phone),
    whatsapp: normalizeString(payload.whatsapp),
    email: normalizeString(payload.email),
    website: normalizeString(payload.website),

    financial_contact: normalizeString(payload.financial_contact),
    fiscal_contact: normalizeString(payload.fiscal_contact),
    commercial_contact: normalizeString(payload.commercial_contact),

    nfe_environment: normalizeString(payload.nfe_environment) || 'homologation',
    nfe_series: normalizeString(payload.nfe_series),
    next_nfe_number: normalizeInteger(payload.next_nfe_number, 1),
    nfce_series: normalizeString(payload.nfce_series),
    next_nfce_number: normalizeInteger(payload.next_nfce_number, 1),

    default_cfop_sale: normalizeString(payload.default_cfop_sale),
    default_cfop_purchase: normalizeString(payload.default_cfop_purchase),
    sped_profile: normalizeString(payload.sped_profile),
    sped_activity_type: normalizeString(payload.sped_activity_type),

    logo_url: normalizeString(payload.logo_url),
    slogan: normalizeString(payload.slogan),
    document_notes: normalizeString(payload.document_notes),
    pdf_footer: normalizeString(payload.pdf_footer),

    certificate_a1_path: normalizeString(payload.certificate_a1_path),
    certificate_password: normalizeString(payload.certificate_password),

    accountant_name: normalizeString(payload.accountant_name),
    accountant_cpf: normalizeString(payload.accountant_cpf),
    accountant_crc: normalizeString(payload.accountant_crc),
    accountant_email: normalizeString(payload.accountant_email),
    accountant_phone: normalizeString(payload.accountant_phone),

    is_active: normalizeBoolean(payload.is_active, true)
  };
}

function validateRequired(payload) {
  if (!payload.corporate_name) {
    throw new Error('Corporate name is required.');
  }

  if (!payload.cnpj) {
    throw new Error('CNPJ is required.');
  }

  const cnpjDigits = onlyDigits(payload.cnpj);
  if (cnpjDigits.length !== 14) {
    throw new Error('Invalid CNPJ.');
  }

  if (payload.state && String(payload.state).length !== 2) {
    throw new Error('State must contain 2 characters.');
  }
}

/* =========================================================================
   Queries
   ========================================================================= */

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enterprises (
      id BIGSERIAL PRIMARY KEY,
      corporate_name           VARCHAR(200) NOT NULL,
      trade_name               VARCHAR(200),
      cnpj                     VARCHAR(18) NOT NULL UNIQUE,
      state_registration       VARCHAR(30),
      municipal_registration   VARCHAR(30),
      tax_regime_code          VARCHAR(2),
      cnae                     VARCHAR(20),
      opening_date             DATE,
      status                   VARCHAR(30) DEFAULT 'ACTIVE',
      zip_code                 VARCHAR(10),
      address                  VARCHAR(200),
      address_number           VARCHAR(20),
      address_complement       VARCHAR(100),
      district                 VARCHAR(100),
      city                     VARCHAR(100),
      state                    VARCHAR(2),
      city_ibge_code           VARCHAR(10),
      phone                    VARCHAR(30),
      whatsapp                 VARCHAR(30),
      email                    VARCHAR(150),
      website                  VARCHAR(150),
      financial_contact        VARCHAR(150),
      fiscal_contact           VARCHAR(150),
      commercial_contact       VARCHAR(150),
      nfe_environment          VARCHAR(20) DEFAULT 'homologation',
      nfe_series               VARCHAR(10),
      next_nfe_number          INTEGER DEFAULT 1,
      nfce_series              VARCHAR(10),
      next_nfce_number         INTEGER DEFAULT 1,
      default_cfop_sale        VARCHAR(10),
      default_cfop_purchase    VARCHAR(10),
      sped_profile             VARCHAR(5),
      sped_activity_type       VARCHAR(5),
      logo_url                 TEXT,
      slogan                   VARCHAR(255),
      document_notes           TEXT,
      pdf_footer               TEXT,
      certificate_a1_path      TEXT,
      certificate_password     TEXT,
      accountant_name          VARCHAR(150),
      accountant_cpf           VARCHAR(14),
      accountant_crc           VARCHAR(30),
      accountant_email         VARCHAR(150),
      accountant_phone         VARCHAR(30),
      is_active                BOOLEAN NOT NULL DEFAULT TRUE,
      created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

async function list({ q = '', is_active, limit = 50, offset = 0 } = {}) {
  await ensureTable();

  const params = [];
  const where = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(`(
      corporate_name ILIKE $${idx}
      OR trade_name ILIKE $${idx}
      OR cnpj ILIKE $${idx}
      OR email ILIKE $${idx}
      OR city ILIKE $${idx}
    )`);
  }

  if (is_active !== undefined && is_active !== null && is_active !== '') {
    params.push(normalizeBoolean(is_active));
    where.push(`is_active = $${params.length}`);
  }

  params.push(limit);
  const limitIndex = params.length;

  params.push(offset);
  const offsetIndex = params.length;

  const sql = `
    SELECT *
    FROM ${catalog_schema.table}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${catalog_schema.defaultOrder}
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

async function count({ q = '', is_active } = {}) {
  await ensureTable();

  const params = [];
  const where = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(`(
      corporate_name ILIKE $${idx}
      OR trade_name ILIKE $${idx}
      OR cnpj ILIKE $${idx}
      OR email ILIKE $${idx}
      OR city ILIKE $${idx}
    )`);
  }

  if (is_active !== undefined && is_active !== null && is_active !== '') {
    params.push(normalizeBoolean(is_active));
    where.push(`is_active = $${params.length}`);
  }

  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM ${catalog_schema.table}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `, params);

  return rows[0]?.total || 0;
}

async function findById(id) {
  await ensureTable();

  const { rows } = await pool.query(`
    SELECT *
    FROM ${catalog_schema.table}
    WHERE ${catalog_schema.idField} = $1
    LIMIT 1
  `, [id]);

  return rows[0] || null;
}

async function findByCnpj(cnpj) {
  await ensureTable();

  const { rows } = await pool.query(`
    SELECT *
    FROM ${catalog_schema.table}
    WHERE regexp_replace(cnpj, '[^0-9]', '', 'g') = $1
    LIMIT 1
  `, [onlyDigits(cnpj)]);

  return rows[0] || null;
}

async function findActive() {
  await ensureTable();

  const { rows } = await pool.query(`
    SELECT *
    FROM ${catalog_schema.table}
    WHERE is_active = TRUE
    ORDER BY id ASC
    LIMIT 1
  `);

  return rows[0] || null;
}

/**
 * Retorna somente os dados públicos necessários para cabeçalhos de documentos.
 * Se enterpriseId não for informado, utiliza a primeira empresa ativa.
 */
async function findForPdf({ enterpriseId = null } = {}) {
  await ensureTable();

  const params = [];
  let whereSql = 'WHERE is_active = TRUE';

  if (enterpriseId !== undefined && enterpriseId !== null && enterpriseId !== '') {
    const normalizedId = Number(enterpriseId);

    if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
      throw new Error('Invalid enterprise ID.');
    }

    params.push(normalizedId);
    whereSql = 'WHERE id = $1 AND is_active = TRUE';
  }

  const { rows } = await pool.query(`
    SELECT
      id,
      corporate_name,
      trade_name,
      cnpj,
      state_registration,
      zip_code,
      address,
      address_number,
      address_complement,
      district,
      city,
      state,
      phone,
      whatsapp,
      email,
      website,
      logo_url,
      slogan,
      document_notes,
      pdf_footer
    FROM ${catalog_schema.table}
    ${whereSql}
    ORDER BY id ASC
    LIMIT 1
  `, params);

  return rows[0] || null;
}

async function create(payload = {}) {
  await ensureTable();

  const data = normalizePayload(payload);
  validateRequired(data);

  const existing = await findByCnpj(data.cnpj);
  if (existing) {
    throw new Error('There is already an enterprise with this CNPJ.');
  }

  const fields = catalog_schema.fields;
  const values = fields.map((field) => data[field] ?? null);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

  const { rows } = await pool.query(`
    INSERT INTO ${catalog_schema.table} (${fields.join(', ')})
    VALUES (${placeholders})
    RETURNING *
  `, values);

  return rows[0];
}

async function update(id, payload = {}) {
  await ensureTable();

  const current = await findById(id);
  if (!current) {
    throw new Error('Enterprise not found.');
  }

  const data = normalizePayload({ ...current, ...payload });
  validateRequired(data);

  const existing = await findByCnpj(data.cnpj);
  if (existing && Number(existing.id) !== Number(id)) {
    throw new Error('There is already another enterprise with this CNPJ.');
  }

  const fields = catalog_schema.fields;
  const setSql = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
  const values = fields.map((field) => data[field] ?? null);

  values.push(id);

  const { rows } = await pool.query(`
    UPDATE ${catalog_schema.table}
    SET ${setSql},
        updated_at = NOW()
    WHERE id = $${values.length}
    RETURNING *
  `, values);

  return rows[0];
}

async function remove(id) {
  await ensureTable();

  const { rowCount } = await pool.query(`
    DELETE FROM ${catalog_schema.table}
    WHERE id = $1
  `, [id]);

  return rowCount > 0;
}

async function setActive(id, isActive) {
  await ensureTable();

  const { rows } = await pool.query(`
    UPDATE ${catalog_schema.table}
    SET is_active = $1,
        updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [normalizeBoolean(isActive), id]);

  return rows[0] || null;
}

export default {
  schema: catalog_schema,
  ensureTable,
  list,
  count,
  findById,
  findByCnpj,
  findActive,
  findForPdf,
  create,
  update,
  remove,
  setActive
};
