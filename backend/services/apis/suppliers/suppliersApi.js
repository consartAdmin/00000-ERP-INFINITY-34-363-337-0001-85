// ╔══════════════════════════════════════════════════════════════════════╗
// ║ suppliersApi.js — DAL / API de Fornecedores (CONSART ERP | ESM)     ║
// ║                                                                      ║
// ║ - Tabela alvo: public."suppliers"                                   ║
// ║ - Compatível com campo legado: address                              ║
// ║ - Novos campos: login, password, website, observations              ║
// ║ - Endereço organizado:                                               ║
// ║   address_street_type, address_street, address_number,              ║
// ║   address_complement,                                               ║
// ║   address_district, city, state, postal_code                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../../config/db.js';
import {
  SUPPLIERS_TABLE,
  SUPPLIERS_SCHEMA,
  SUPPLIERS_INSERT_COLUMNS,
} from './catalog_schema.suppliers.js';

/* ──────────────────────────────────────────────────────────────
   Tabela & Alias
────────────────────────────────────────────────────────────── */
const TB = SUPPLIERS_TABLE;
const ALIAS = SUPPLIERS_SCHEMA.alias;

const RETURNING_COLUMNS = SUPPLIERS_SCHEMA.selectColumns
  .map((column) => `        ${column}`)
  .join(',\n');

/* ──────────────────────────────────────────────────────────────
   Helpers de resposta
────────────────────────────────────────────────────────────── */
function ok(data) {
  return { ok: true, data };
}

function fail(error, status = 400) {
  return { ok: false, error, status };
}

/* ──────────────────────────────────────────────────────────────
   Helpers de normalização
────────────────────────────────────────────────────────────── */
function cleanString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

function cleanPositiveInteger(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeState(value) {
  const str = cleanString(value);
  return str ? str.toUpperCase().slice(0, 2) : str;
}

function buildLegacyAddress(data = {}) {
  const street = [cleanString(data.address_street_type), cleanString(data.address_street)]
    .filter(Boolean)
    .join(' ');

  const parts = [
    street,
    cleanString(data.address_number),
    cleanString(data.address_complement),
    cleanString(data.address_district),
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : null;
}

/* ──────────────────────────────────────────────────────────────
   Normalização de linha vinda do banco
────────────────────────────────────────────────────────────── */
function normalizeRow(row) {
  if (!row) return null;

  const address_street =
    row.address_street ?? null;

  return {
    supplier_id: row.supplier_id,
    name: row.name,
    tax_id: row.tax_id,
    state_registration: row.state_registration,
    phone: row.phone,
    email: row.email,
    website: row.website,
    login: row.login,
    password: row.password,
    observations: row.observations,

    address: row.address,
    address_street_type: row.address_street_type ?? null,
    address_street: address_street || row.address || null,
    address_number: row.address_number,
    address_complement: row.address_complement,
    address_district: row.address_district,
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,

    sales_rep: row.sales_rep,
    sales_rep_email: row.sales_rep_email,
    finance_email: row.finance_email,

    chart_account_id: row.chart_account_id ?? null,
    chart_account_code: row.chart_account_code ?? null,
    chart_account_description: row.chart_account_description ?? null,
    cash_category_id: row.cash_category_id ?? null,
    cash_category_name: row.cash_category_name ?? null,
    cash_subcategory_id: row.cash_subcategory_id ?? null,
    cash_subcategory_name: row.cash_subcategory_name ?? null,
  };
}

async function validateFinancialClassification(client, data = {}) {
  const chartAccountId = cleanPositiveInteger(data.chart_account_id);
  const categoryId = cleanPositiveInteger(data.cash_category_id);
  const subcategoryId = cleanPositiveInteger(data.cash_subcategory_id);

  if (data.chart_account_id != null && chartAccountId === null) {
    return fail('Conta contábil inválida.', 400);
  }
  if (data.cash_category_id != null && categoryId === null) {
    return fail('Categoria financeira inválida.', 400);
  }
  if (data.cash_subcategory_id != null && subcategoryId === null) {
    return fail('Subcategoria financeira inválida.', 400);
  }
  if (subcategoryId && !categoryId) {
    return fail('Selecione a categoria financeira da subcategoria.', 400);
  }

  if (chartAccountId !== undefined && chartAccountId !== null) {
    const result = await client.query(
      `SELECT 1 FROM public."chartOfAccounts" WHERE id = $1 AND is_active = TRUE`,
      [chartAccountId]
    );
    if (!result.rowCount) return fail('Conta contábil inexistente ou inativa.', 400);
  }

  if (categoryId !== undefined && categoryId !== null) {
    const result = await client.query(
      `SELECT 1 FROM public."cashCategories" WHERE id = $1 AND is_active = TRUE`,
      [categoryId]
    );
    if (!result.rowCount) return fail('Categoria financeira inexistente ou inativa.', 400);
  }

  if (subcategoryId !== undefined && subcategoryId !== null) {
    const params = [subcategoryId];
    let sql = `SELECT 1 FROM public."cashSubcategories" WHERE id = $1 AND is_active = TRUE`;
    if (categoryId !== undefined && categoryId !== null) {
      params.push(categoryId);
      sql += ` AND category_id = $2`;
    }
    const result = await client.query(sql, params);
    if (!result.rowCount) {
      return fail('Subcategoria inexistente, inativa ou não pertencente à categoria selecionada.', 400);
    }
  }

  return ok(true);
}

/* ──────────────────────────────────────────────────────────────
   ensureSuppliersTable — valida tabela contra o catálogo
────────────────────────────────────────────────────────────── */
export async function ensureSuppliersTable() {
  try {
    const { rows } = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'suppliers';
    `);

    if (!rows.length) {
      return fail(`Tabela ${TB} não encontrada. Execute a migration correspondente.`, 500);
    }

    const existingColumns = new Set(rows.map(({ column_name }) => column_name));
    const missingColumns = SUPPLIERS_SCHEMA.selectColumns.filter(
      (column) => !existingColumns.has(column)
    );

    if (missingColumns.length) {
      return fail(
        `Tabela ${TB} incompatível com o catálogo. Colunas ausentes: ${missingColumns.join(', ')}.`,
        500
      );
    }

    console.log(`[suppliersApi] ${TB} validada pelo catálogo (${SUPPLIERS_SCHEMA.columns.length} colunas).`);
    return ok({ table: TB, columns: SUPPLIERS_SCHEMA.columns.length });
  } catch (err) {
    console.error('[suppliersApi] Erro ao validar tabela suppliers:', err);
    return fail(err.message || 'Erro ao validar tabela suppliers', 500);
  }
}

/* ──────────────────────────────────────────────────────────────
   list — lista fornecedores com paginação + filtro q
────────────────────────────────────────────────────────────── */
export async function list({
  page = 1,
  limit = 20,
  sort = 'supplier_id',
  dir = 'asc',
  q,
} = {}) {
  try {
    const pg = Number(page) > 0 ? Number(page) : 1;
    const lim = Number(limit) > 0 && Number(limit) <= 200 ? Number(limit) : 20;
    const offset = (pg - 1) * lim;

    const allowedSort = new Set([
      'supplier_id',
      'name',
      'tax_id',
      'city',
      'state',
      'email',
      'phone',
    ]);

    const sortCol = allowedSort.has(sort) ? sort : 'supplier_id';
    const sortDir = String(dir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const params = [];
    const where = [];

    if (q && String(q).trim()) {
      params.push(`%${String(q).trim().toLowerCase()}%`);
      const idx = params.length;

      where.push(`
        (
          LOWER(COALESCE(${ALIAS}.name, '')) LIKE $${idx}
          OR LOWER(COALESCE(${ALIAS}.tax_id, '')) LIKE $${idx}
          OR LOWER(COALESCE(${ALIAS}.email, '')) LIKE $${idx}
          OR LOWER(COALESCE(${ALIAS}.website, '')) LIKE $${idx}
          OR LOWER(COALESCE(${ALIAS}.city, '')) LIKE $${idx}
          OR LOWER(COALESCE(${ALIAS}.state, '')) LIKE $${idx}
          OR LOWER(COALESCE(${ALIAS}.sales_rep, '')) LIKE $${idx}
        )
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(lim);
    const limitIdx = params.length;

    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      SELECT
        ${ALIAS}.supplier_id,
        ${ALIAS}.name,
        ${ALIAS}.tax_id,
        ${ALIAS}.state_registration,
        ${ALIAS}.phone,
        ${ALIAS}.email,
        ${ALIAS}.website,
        ${ALIAS}.address,
        ${ALIAS}.address_street_type,
        ${ALIAS}.address_street,
        ${ALIAS}.address_number,
        ${ALIAS}.address_complement,
        ${ALIAS}.address_district,
        ${ALIAS}.city,
        ${ALIAS}.state,
        ${ALIAS}.postal_code,
        ${ALIAS}.sales_rep,
        ${ALIAS}.sales_rep_email,
        ${ALIAS}.finance_email,
        ${ALIAS}.chart_account_id,
        coa.code AS chart_account_code,
        coa.description AS chart_account_description,
        ${ALIAS}.cash_category_id,
        cc.name AS cash_category_name,
        ${ALIAS}.cash_subcategory_id,
        csc.name AS cash_subcategory_name,
        COUNT(*) OVER() AS total_count
      FROM ${TB} ${ALIAS}
      LEFT JOIN public."chartOfAccounts" coa ON coa.id = ${ALIAS}.chart_account_id
      LEFT JOIN public."cashCategories" cc ON cc.id = ${ALIAS}.cash_category_id
      LEFT JOIN public."cashSubcategories" csc ON csc.id = ${ALIAS}.cash_subcategory_id
      ${whereSql}
      ORDER BY ${ALIAS}.${sortCol} ${sortDir}
      LIMIT $${limitIdx}
      OFFSET $${offsetIdx};
    `;

    const { rows } = await pool.query(sql, params);

    const total = rows.length ? Number(rows[0].total_count) : 0;
    const dataRows = rows.map(normalizeRow);

    return ok({
      rows: dataRows,
      total,
      page: pg,
      limit: lim,
    });
  } catch (err) {
    console.error('[suppliersApi:list] Erro:', err);
    return fail(err.message || 'Erro ao listar fornecedores', 500);
  }
}

/* ──────────────────────────────────────────────────────────────
   search — atalho para list com q
────────────────────────────────────────────────────────────── */
export async function search(q, { page = 1, limit = 20 } = {}) {
  return list({ page, limit, q });
}

/* ──────────────────────────────────────────────────────────────
   getById — busca fornecedor por ID
────────────────────────────────────────────────────────────── */
export async function getById(id) {
  try {
    const supplierId = Number(id);
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      return fail('ID inválido', 400);
    }

    const { rows } = await pool.query(
      `
      SELECT
        ${ALIAS}.supplier_id,
        ${ALIAS}.name,
        ${ALIAS}.tax_id,
        ${ALIAS}.state_registration,
        ${ALIAS}.phone,
        ${ALIAS}.email,
        ${ALIAS}.website,
        ${ALIAS}.login,
        ${ALIAS}.password,
        ${ALIAS}.observations,
        ${ALIAS}.address,
        ${ALIAS}.address_street_type,
        ${ALIAS}.address_street,
        ${ALIAS}.address_number,
        ${ALIAS}.address_complement,
        ${ALIAS}.address_district,
        ${ALIAS}.city,
        ${ALIAS}.state,
        ${ALIAS}.postal_code,
        ${ALIAS}.sales_rep,
        ${ALIAS}.sales_rep_email,
        ${ALIAS}.finance_email
        ,${ALIAS}.chart_account_id
        ,coa.code AS chart_account_code
        ,coa.description AS chart_account_description
        ,${ALIAS}.cash_category_id
        ,cc.name AS cash_category_name
        ,${ALIAS}.cash_subcategory_id
        ,csc.name AS cash_subcategory_name
      FROM ${TB} ${ALIAS}
      LEFT JOIN public."chartOfAccounts" coa ON coa.id = ${ALIAS}.chart_account_id
      LEFT JOIN public."cashCategories" cc ON cc.id = ${ALIAS}.cash_category_id
      LEFT JOIN public."cashSubcategories" csc ON csc.id = ${ALIAS}.cash_subcategory_id
      WHERE ${ALIAS}.supplier_id = $1;
      `,
      [supplierId]
    );

    if (!rows.length) {
      return fail('Fornecedor não encontrado', 404);
    }

    return ok(normalizeRow(rows[0]));
  } catch (err) {
    console.error('[suppliersApi:getById] Erro:', err);
    return fail(err.message || 'Erro ao buscar fornecedor', 500);
  }
}

/* ──────────────────────────────────────────────────────────────
   create — cria novo fornecedor
────────────────────────────────────────────────────────────── */
export async function create(data = {}) {
  const client = await pool.connect();
  try {
    const payload = {
      name: cleanString(data.name),
      tax_id: cleanString(data.tax_id),
      state_registration: cleanString(data.state_registration),
      phone: cleanString(data.phone),
      email: cleanString(data.email),
      website: cleanString(data.website),
      login: cleanString(data.login),
      password: cleanString(data.password),
      observations: cleanString(data.observations),

      address_street_type: cleanString(data.address_street_type),
      address_street: cleanString(data.address_street),
      address_number: cleanString(data.address_number),
      address_complement: cleanString(data.address_complement),
      address_district: cleanString(data.address_district),
      city: cleanString(data.city),
      state: normalizeState(data.state),
      postal_code: cleanString(data.postal_code),

      sales_rep: cleanString(data.sales_rep),
      sales_rep_email: cleanString(data.sales_rep_email),
      finance_email: cleanString(data.finance_email),
      chart_account_id: cleanPositiveInteger(data.chart_account_id),
      cash_category_id: cleanPositiveInteger(data.cash_category_id),
      cash_subcategory_id: cleanPositiveInteger(data.cash_subcategory_id),
    };

    payload.address =
      cleanString(data.address) ||
      buildLegacyAddress(payload);

    if (!payload.name) {
      return fail('Nome do fornecedor é obrigatório.', 400);
    }

    const validation = await validateFinancialClassification(client, payload);
    if (!validation.ok) return validation;

    const cols = [];
    const vals = [];
    const params = [];

    function add(col, val) {
      if (val === undefined) return;
      cols.push(col);
      params.push(val);
      vals.push(`$${params.length}`);
    }

    for (const column of SUPPLIERS_INSERT_COLUMNS) {
      add(column, payload[column]);
    }

    const sql = `
      INSERT INTO ${TB} (${cols.join(', ')})
      VALUES (${vals.join(', ')})
      RETURNING
${RETURNING_COLUMNS};
    `;

    const { rows } = await client.query(sql, params);
    return ok(normalizeRow(rows[0]));
  } catch (err) {
    console.error('[suppliersApi:create] Erro:', err);

    if (err.code === '23505') {
      return fail('Já existe um fornecedor com este documento fiscal (tax_id).', 400);
    }

    if (err.code === '23503') return fail('Classificação financeira inválida.', 400);
    return fail(err.message || 'Erro ao criar fornecedor', 500);
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   update — atualiza fornecedor
────────────────────────────────────────────────────────────── */
export async function update(id, data = {}) {
  const client = await pool.connect();
  try {
    const supplierId = Number(id);
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      return fail('ID inválido', 400);
    }

    const normalized = {
      name: data.name !== undefined ? cleanString(data.name) : undefined,
      tax_id: data.tax_id !== undefined ? cleanString(data.tax_id) : undefined,
      state_registration: data.state_registration !== undefined ? cleanString(data.state_registration) : undefined,
      phone: data.phone !== undefined ? cleanString(data.phone) : undefined,
      email: data.email !== undefined ? cleanString(data.email) : undefined,
      website: data.website !== undefined ? cleanString(data.website) : undefined,
      login: data.login !== undefined ? cleanString(data.login) : undefined,
      password: data.password !== undefined ? cleanString(data.password) : undefined,
      observations: data.observations !== undefined ? cleanString(data.observations) : undefined,

      address_street_type: data.address_street_type !== undefined ? cleanString(data.address_street_type) : undefined,
      address_street: data.address_street !== undefined ? cleanString(data.address_street) : undefined,
      address_number: data.address_number !== undefined ? cleanString(data.address_number) : undefined,
      address_complement: data.address_complement !== undefined ? cleanString(data.address_complement) : undefined,
      address_district: data.address_district !== undefined ? cleanString(data.address_district) : undefined,
      city: data.city !== undefined ? cleanString(data.city) : undefined,
      state: data.state !== undefined ? normalizeState(data.state) : undefined,
      postal_code: data.postal_code !== undefined ? cleanString(data.postal_code) : undefined,

      sales_rep: data.sales_rep !== undefined ? cleanString(data.sales_rep) : undefined,
      sales_rep_email: data.sales_rep_email !== undefined ? cleanString(data.sales_rep_email) : undefined,
      finance_email: data.finance_email !== undefined ? cleanString(data.finance_email) : undefined,
      chart_account_id: data.chart_account_id !== undefined ? cleanPositiveInteger(data.chart_account_id) : undefined,
      cash_category_id: data.cash_category_id !== undefined ? cleanPositiveInteger(data.cash_category_id) : undefined,
      cash_subcategory_id: data.cash_subcategory_id !== undefined ? cleanPositiveInteger(data.cash_subcategory_id) : undefined,
    };

    const currentResult = await client.query(
      `SELECT chart_account_id, cash_category_id, cash_subcategory_id FROM ${TB} WHERE supplier_id = $1`,
      [supplierId]
    );
    if (!currentResult.rowCount) return fail('Fornecedor não encontrado', 404);
    const effective = { ...currentResult.rows[0], ...Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined)) };
    const validation = await validateFinancialClassification(client, effective);
    if (!validation.ok) return validation;

    const composedAddress = buildLegacyAddress({
      address_street_type: normalized.address_street_type,
      address_street: normalized.address_street,
      address_number: normalized.address_number,
      address_complement: normalized.address_complement,
      address_district: normalized.address_district,
    });

    normalized.address =
      data.address !== undefined
        ? cleanString(data.address)
        : composedAddress || undefined;

    const sets = [];
    const params = [];

    function set(col, val) {
      if (val === undefined) return;
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }

    for (const column of SUPPLIERS_INSERT_COLUMNS) {
      set(column, normalized[column]);
    }

    set('updated_at', new Date());

    if (!sets.length) {
      return fail('Nenhum campo para atualizar.', 400);
    }

    params.push(supplierId);

    const sql = `
      UPDATE ${TB}
      SET ${sets.join(', ')}
      WHERE supplier_id = $${params.length}
      RETURNING
${RETURNING_COLUMNS};
    `;

    const { rows } = await client.query(sql, params);

    if (!rows.length) {
      return fail('Fornecedor não encontrado', 404);
    }

    return ok(normalizeRow(rows[0]));
  } catch (err) {
    console.error('[suppliersApi:update] Erro:', err);

    if (err.code === '23505') {
      return fail('Já existe um fornecedor com este documento fiscal (tax_id).', 400);
    }

    if (err.code === '23503') return fail('Classificação financeira inválida.', 400);
    return fail(err.message || 'Erro ao atualizar fornecedor', 500);
  } finally {
    client.release();
  }
}

/* ──────────────────────────────────────────────────────────────
   remove — remove fornecedor
────────────────────────────────────────────────────────────── */
export async function remove(id) {
  try {
    const supplierId = Number(id);
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      return fail('ID inválido', 400);
    }

    const { rowCount } = await pool.query(
      `DELETE FROM ${TB} WHERE supplier_id = $1;`,
      [supplierId]
    );

    if (rowCount === 0) {
      return fail('Fornecedor não encontrado', 404);
    }

    return ok({ supplier_id: supplierId });
  } catch (err) {
    console.error('[suppliersApi:remove] Erro:', err);

    if (err.code === '23503') {
      return fail(
        'Não é possível excluir este fornecedor porque existem registros vinculados (ex.: contas a pagar).',
        400
      );
    }

    return fail(err.message || 'Erro ao remover fornecedor', 500);
  }
}

export default {
  ensureSuppliersTable,
  list,
  search,
  getById,
  create,
  update,
  remove,
};
