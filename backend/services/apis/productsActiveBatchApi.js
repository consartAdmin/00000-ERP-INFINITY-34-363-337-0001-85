// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ productsActiveBatchApi.js — Batch ativar/desativar produtos (is_active)    ║
// ║ CONSART ERP | ESM                                                         ║
// ║                                                                            ║
// ║ Endpoints:                                                                ║
// ║   GET  /api/products-active/batch/list                                     ║
// ║   POST /api/products-active/batch/activate                                 ║
// ║   POST /api/products-active/batch/deactivate                               ║
// ║   POST /api/products-active/batch/set                                      ║
// ║                                                                            ║
// ║ ✅ FIX 2026-02:                                                            ║
// ║   - Detecta tipo real de products.product_id (int4/int8/uuid/text)         ║
// ║   - Busca robusta (detectSearchColumns)                                    ║
// ║   - Best-effort: não quebra se colunas não existirem                       ║
// ║   - Atualiza updated_at se existir                                         ║
// ╚════════════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB_PRODUCTS = 'public."products"';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const toInt = (v, fb = null) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : fb;
};

const notEmptyStr = (s) => typeof s === 'string' && s.trim().length > 0;

function normalizeIds(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x ?? '').trim())
    .filter((x) => x.length > 0);
}

function onlyNumericIds(arr) {
  return normalizeIds(arr)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n));
}

async function tableExists(tableNameQuoted) {
  const [schema, raw] = String(tableNameQuoted || '').split('.');
  const table = raw?.replace(/"/g, '');
  if (!schema || !table) return false;

  const res = await pool.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
      LIMIT 1;
    `,
    [schema.replace(/"/g, ''), table],
  );

  return res.rowCount > 0;
}

async function columnExists(tableNameQuoted, colName) {
  const [schema, raw] = String(tableNameQuoted || '').split('.');
  const table = raw?.replace(/"/g, '');
  if (!schema || !table || !colName) return false;

  const res = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
      LIMIT 1;
    `,
    [schema.replace(/"/g, ''), table, String(colName)],
  );

  return res.rowCount > 0;
}

async function getColumnUdtName(tableNameQuoted, colName) {
  const [schema, raw] = String(tableNameQuoted || '').split('.');
  const table = raw?.replace(/"/g, '');
  if (!schema || !table || !colName) return null;

  const res = await pool.query(
    `
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
      LIMIT 1;
    `,
    [schema.replace(/"/g, ''), table, String(colName)],
  );

  return res.rows?.[0]?.udt_name || null; // int4, int8, uuid, varchar, text...
}

// ✅ detecta colunas pesquisáveis existentes na tabela products
async function detectSearchColumns() {
  const candidates = [
    'product_code',
    'product_description',
    'sku',
    'code',
    'barcode',
    'name',
    'description',
  ];

  const ok = [];
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await columnExists(TB_PRODUCTS, c).catch(() => false);
    if (exists) ok.push(c);
  }
  return ok;
}

function productIdArrayCastFromUdt(udt) {
  if (udt === 'int8') return { cast: 'bigint[]', mode: 'numeric' };
  if (udt === 'int4') return { cast: 'int[]', mode: 'numeric' };
  if (udt === 'uuid') return { cast: 'uuid[]', mode: 'text' };
  return { cast: 'text[]', mode: 'text' };
}

/**
 * buildProductsWhere
 * - product_ids (com cast correto)
 * - q (busca em colunas detectadas)
 * - where_group_id / where_subgroup_id (se existirem as colunas)
 * - status filter (active/inactive/all) se existir is_active
 */
function buildProductsWhere({
  product_ids,
  q,
  where_group_id,
  where_subgroup_id,
  status, // 'active' | 'inactive' | 'all' | undefined
  hasActiveCol,
  hasGroupCol,
  hasSubgroupCol,
  searchCols = [],
  productIdUdtName,
}) {
  const where = [];
  const values = [];
  let i = 1;

  const { cast, mode } = productIdArrayCastFromUdt(productIdUdtName);

  // ✅ product_ids
  if (Array.isArray(product_ids) && product_ids.length) {
    if (mode === 'numeric') {
      const nums = onlyNumericIds(product_ids);
      if (nums.length) {
        values.push(nums);
        where.push(`p.product_id = ANY($${i++}::${cast})`);
      } else {
        where.push(`1=0`);
      }
    } else {
      const ids = normalizeIds(product_ids);
      if (ids.length) {
        values.push(ids);
        where.push(`p.product_id = ANY($${i++}::${cast})`);
      }
    }
  }

  // ✅ q
  if (notEmptyStr(q)) {
    const term = `%${q.trim()}%`;
    values.push(term);
    const idx = i++;

    const ors = [];
    ors.push(`CAST(p.product_id AS text) ILIKE $${idx}`);

    for (const col of searchCols) {
      ors.push(`COALESCE(CAST(p.${col} AS text),'') ILIKE $${idx}`);
    }

    where.push(`(${ors.join(' OR ')})`);
  }

  // ✅ filtro por grupo/subgrupo (se colunas existirem)
  if (hasGroupCol) {
    const g = toInt(where_group_id);
    if (Number.isInteger(g)) {
      values.push(g);
      where.push(`p.product_group_id = $${i++}`);
    }
  }

  if (hasSubgroupCol) {
    const sg = toInt(where_subgroup_id);
    if (Number.isInteger(sg)) {
      values.push(sg);
      where.push(`p.product_subgroup_id = $${i++}`);
    }
  }

  // ✅ status (is_active)
  if (hasActiveCol) {
    const st = String(status || 'all').toLowerCase();
    if (st === 'active') where.push(`p.is_active = TRUE`);
    if (st === 'inactive') where.push(`p.is_active = FALSE`);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    values,
    meta: { productIdUdtName, productIdArrayCast: cast, productIdMode: mode },
  };
}

// -----------------------------------------------------------------------------
// POST /api/products-active/batch/set
// body: { is_active: true|false, product_ids? / q? / where_group_id? / where_subgroup_id? }
// -----------------------------------------------------------------------------
export async function batchSetActive(req, res) {
  const body = req.body || {};

  // valida is_active
  const isActive =
    body.is_active === true ? true :
    body.is_active === false ? false :
    null;

  if (isActive === null) {
    return res.status(400).json({ ok: false, error: 'is_active must be boolean (true/false).' });
  }

  // Detect columns / types
  let hasActiveCol = false;
  let hasUpdatedAt = false;
  let hasGroupCol = false;
  let hasSubgroupCol = false;
  let searchCols = [];
  let productIdUdtName = null;

  try {
    [
      hasActiveCol,
      hasUpdatedAt,
      hasGroupCol,
      hasSubgroupCol,
      searchCols,
      productIdUdtName,
    ] = await Promise.all([
      columnExists(TB_PRODUCTS, 'is_active').catch(() => false),
      columnExists(TB_PRODUCTS, 'updated_at').catch(() => false),
      columnExists(TB_PRODUCTS, 'product_group_id').catch(() => false),
      columnExists(TB_PRODUCTS, 'product_subgroup_id').catch(() => false),
      detectSearchColumns().catch(() => []),
      getColumnUdtName(TB_PRODUCTS, 'product_id').catch(() => null),
    ]);
  } catch {
    // segue
  }

  if (!hasActiveCol) {
    return res.status(409).json({
      ok: false,
      error: 'products.is_active column not found. Cannot batch activate/deactivate.',
    });
  }

  const { whereSql, values, meta: whereMeta } = buildProductsWhere({
    product_ids: body.product_ids,
    q: body.q,
    where_group_id: body.where_group_id,
    where_subgroup_id: body.where_subgroup_id,
    status: body.status, // opcional para restringir alvo
    hasActiveCol,
    hasGroupCol,
    hasSubgroupCol,
    searchCols,
    productIdUdtName,
  });

  const hasAnyTarget =
    (Array.isArray(body.product_ids) && body.product_ids.length > 0) ||
    notEmptyStr(body.q) ||
    Number.isInteger(toInt(body.where_group_id)) ||
    Number.isInteger(toInt(body.where_subgroup_id));

  if (!hasAnyTarget) {
    return res.status(400).json({
      ok: false,
      error: 'Provide at least one target filter: product_ids, q, where_group_id or where_subgroup_id.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const params = [...values];
    let i = params.length + 1;

    params.push(isActive);

    const sql = `
      UPDATE ${TB_PRODUCTS} p
      SET
        is_active = $${i++}
        ${hasUpdatedAt ? ', updated_at = now()' : ''}
      ${whereSql}
      RETURNING
        p.product_id
        ${searchCols.includes('product_code') ? ', p.product_code' : ''}
        ${searchCols.includes('sku') ? ', p.sku' : ''}
        ${searchCols.includes('product_description') ? ', p.product_description' : ''}
        ${searchCols.includes('description') ? ', p.description' : ''}
        , p.is_active
        ${hasUpdatedAt ? ', p.updated_at' : ''};
    `;

    const { rows } = await client.query(sql, params);

    await client.query('COMMIT');
    return res.json({
      ok: true,
      affected: rows.length,
      rows,
      data: rows,
      meta: {
        is_active_set_to: isActive,
        hasActiveCol,
        hasUpdatedAt,
        hasGroupCol,
        hasSubgroupCol,
        searchCols,
        whereMeta,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[productsActiveBatchApi:batchSetActive] error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to batch set active flag.' });
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// POST /api/products-active/batch/activate
// -----------------------------------------------------------------------------
export async function batchActivate(req, res) {
  req.body = { ...(req.body || {}), is_active: true };
  return batchSetActive(req, res);
}

// -----------------------------------------------------------------------------
// POST /api/products-active/batch/deactivate
// -----------------------------------------------------------------------------
export async function batchDeactivate(req, res) {
  req.body = { ...(req.body || {}), is_active: false };
  return batchSetActive(req, res);
}

// -----------------------------------------------------------------------------
// GET /api/products-active/batch/list
// query:
//  - page, limit
//  - q
//  - status: active|inactive|all (default all)
//  - where_group_id / where_subgroup_id (opcional, se colunas existirem)
// -----------------------------------------------------------------------------
export async function batchListProducts(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all').toLowerCase();

    // Detect columns / types
    const [
      hasActiveCol,
      hasGroupCol,
      hasSubgroupCol,
      hasUpdatedAt,
      searchCols,
      productIdUdtName,
    ] = await Promise.all([
      columnExists(TB_PRODUCTS, 'is_active').catch(() => false),
      columnExists(TB_PRODUCTS, 'product_group_id').catch(() => false),
      columnExists(TB_PRODUCTS, 'product_subgroup_id').catch(() => false),
      columnExists(TB_PRODUCTS, 'updated_at').catch(() => false),
      detectSearchColumns().catch(() => []),
      getColumnUdtName(TB_PRODUCTS, 'product_id').catch(() => null),
    ]);

    if (!hasActiveCol) {
      return res.status(409).json({
        ok: false,
        error: 'products.is_active column not found. Cannot list active/inactive status.',
      });
    }

    const { whereSql, values } = buildProductsWhere({
      product_ids: undefined,
      q,
      where_group_id: req.query.where_group_id,
      where_subgroup_id: req.query.where_subgroup_id,
      status,
      hasActiveCol,
      hasGroupCol,
      hasSubgroupCol,
      searchCols,
      productIdUdtName,
    });

    const selectCols = [
      'p.product_id',
      ...(searchCols.includes('product_code') ? ['p.product_code'] : []),
      ...(searchCols.includes('sku') ? ['p.sku'] : []),
      ...(searchCols.includes('code') ? ['p.code'] : []),
      ...(searchCols.includes('product_description') ? ['p.product_description'] : []),
      ...(searchCols.includes('description') ? ['p.description'] : []),
      ...(searchCols.includes('name') ? ['p.name'] : []),
      ...(hasGroupCol ? ['p.product_group_id'] : []),
      ...(hasSubgroupCol ? ['p.product_subgroup_id'] : []),
      'p.is_active',
      ...(hasUpdatedAt ? ['p.updated_at'] : []),
    ].join(', ');

    // total (best-effort)
    const countSql = `
      SELECT COUNT(*)::bigint AS total
      FROM ${TB_PRODUCTS} p
      ${whereSql};
    `;
    const countRes = await pool.query(countSql, values);
    const total = Number(countRes.rows?.[0]?.total || 0);

    const sql = `
      SELECT ${selectCols}
      FROM ${TB_PRODUCTS} p
      ${whereSql}
      ORDER BY p.product_id DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2};
    `;

    const params = [...values, limit, offset];
    const { rows } = await pool.query(sql, params);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      status,
      data: rows,
    });
  } catch (err) {
    console.error('[productsActiveBatchApi:batchListProducts]', err);
    return res.status(500).json({ ok: false, error: 'Failed to list products.' });
  }
}

export default {
  batchListProducts,
  batchSetActive,
  batchActivate,
  batchDeactivate,
};
