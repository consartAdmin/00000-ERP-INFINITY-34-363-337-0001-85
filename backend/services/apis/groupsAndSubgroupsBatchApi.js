// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ groupsAndSubgroupsBatchApi.js — Batch update de Grupo/Subgrupo (Produtos)  ║
// ║ CONSART ERP | ESM                                                         ║
// ║                                                                            ║
// ║ Endpoints:                                                                ║
// ║   GET  /api/products-groups/batch/list                                     ║
// ║   POST /api/products-groups/batch/assign                                   ║
// ║   POST /api/products-groups/batch/clear                                    ║
// ║                                                                            ║
// ║ ✅ FIX 2026-02:                                                            ║
// ║   - Corrige erro "integer = varchar" em product_ids                         ║
// ║   - Detecta tipo real de products.product_id (int4/int8/uuid/text)         ║
// ║   - Validação de subgrupo detecta coluna de grupo em productsSubgroups     ║
// ║   - Best-effort: não quebra se tabela/colunas não existirem                ║
// ╚════════════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TB_PRODUCTS   = 'public."products"';
const TB_GROUPS     = 'public."productsGroups"';
const TB_SUBGROUPS  = 'public."productsSubgroups"';

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

  return res.rows?.[0]?.udt_name || null; // e.g. int4, int8, uuid, varchar, text
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
  // udt_name commonly: int4, int8, uuid, varchar, text
  if (udt === 'int8') return { cast: 'bigint[]', mode: 'numeric' };
  if (udt === 'int4') return { cast: 'int[]', mode: 'numeric' };
  if (udt === 'uuid') return { cast: 'uuid[]', mode: 'text' };
  // default text-ish
  return { cast: 'text[]', mode: 'text' };
}

// ✅ monta WHERE de produtos (corrigido para product_id type)
function buildProductsWhere({
  product_ids,
  q,
  only_active_products,
  where_group_id,
  where_subgroup_id,
  hasActiveCol,
  hasSubgroupCol,
  searchCols = [],
  productIdUdtName, // <-- NEW
}) {
  const where = [];
  const values = [];
  let i = 1;

  const { cast, mode } = productIdArrayCastFromUdt(productIdUdtName);

  // ✅ product_ids (com cast correto)
  if (Array.isArray(product_ids) && product_ids.length) {
    if (mode === 'numeric') {
      const nums = onlyNumericIds(product_ids);
      if (nums.length) {
        values.push(nums);
        where.push(`p.product_id = ANY($${i++}::${cast})`);
      } else {
        // se vier tudo inválido, força 0 resultados sem explodir
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
    const pIdx = i++;

    const ors = [];
    ors.push(`CAST(p.product_id AS text) ILIKE $${pIdx}`);

    for (const col of searchCols) {
      ors.push(`CAST(p.${col} AS text) ILIKE $${pIdx}`);
    }

    where.push(`(${ors.join(' OR ')})`);
  }

  // ✅ only_active
  if (hasActiveCol) {
    const onlyActive = only_active_products !== false; // default true
    if (onlyActive) where.push(`p.is_active = TRUE`);
  }

  // ✅ where_group_id / where_subgroup_id
  const g = toInt(where_group_id);
  if (Number.isInteger(g)) {
    values.push(g);
    where.push(`p.product_group_id = $${i++}`);
  }

  if (hasSubgroupCol) {
    const sg = toInt(where_subgroup_id);
    if (Number.isInteger(sg)) {
      values.push(sg);
      where.push(`p.product_subgroup_id = $${i++}`);
    }
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    values,
    meta: { productIdUdtName, productIdArrayCast: cast, productIdMode: mode },
  };
}

// -----------------------------------------------------------------------------
// Internal validation: subgroup belongs to group (best-effort)
// -----------------------------------------------------------------------------
async function validateSubgroupBelongsToGroup({ product_group_id, product_subgroup_id }) {
  if (!Number.isInteger(product_subgroup_id)) return { ok: true, skipped: true };

  const hasSubgroupsTable = await tableExists(TB_SUBGROUPS).catch(() => false);
  if (!hasSubgroupsTable) return { ok: true, skipped: true };

  const hasIsActive = await columnExists(TB_SUBGROUPS, 'is_active').catch(() => false);

  const groupColCandidates = ['product_group_id', 'group_id', 'products_group_id', 'productGroupId'];
  let groupCol = null;
  for (const c of groupColCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await columnExists(TB_SUBGROUPS, c).catch(() => false);
    if (ok) { groupCol = c; break; }
  }

  const selectCols = [
    'product_subgroup_id',
    ...(groupCol ? [groupCol] : []),
    ...(hasIsActive ? ['is_active'] : []),
  ].join(', ');

  const sgRes = await pool.query(
    `
      SELECT ${selectCols}
      FROM ${TB_SUBGROUPS}
      WHERE product_subgroup_id = $1
      LIMIT 1;
    `,
    [product_subgroup_id],
  );

  if (!sgRes.rowCount) {
    const err = new Error('Subgroup not found.');
    err.status = 404;
    throw err;
  }

  const row = sgRes.rows[0];

  if (hasIsActive && row?.is_active === false) {
    const err = new Error('Cannot assign an inactive subgroup.');
    err.status = 409;
    throw err;
  }

  if (groupCol) {
    const subgroupGroupId = toInt(row[groupCol], null);
    if (Number.isInteger(subgroupGroupId) && subgroupGroupId !== product_group_id) {
      const err = new Error('Subgroup does not belong to the provided group.');
      err.status = 409;
      throw err;
    }
  }

  return { ok: true, skipped: false, groupCol, hasIsActive };
}

// -----------------------------------------------------------------------------
// POST /api/products-groups/batch/assign
// -----------------------------------------------------------------------------
export async function batchAssignGroups(req, res) {
  const body = req.body || {};

  const product_group_id = toInt(body.product_group_id);
  const product_subgroup_id =
    body.product_subgroup_id !== undefined ? toInt(body.product_subgroup_id) : undefined;

  if (!Number.isInteger(product_group_id)) {
    return res.status(400).json({ ok: false, error: 'product_group_id must be an integer.' });
  }

  // Detect columns / types from schema
  let hasActiveCol = false;
  let hasSubgroupCol = false;
  let searchCols = [];
  let productIdUdtName = null;

  try {
    [hasActiveCol, hasSubgroupCol, searchCols, productIdUdtName] = await Promise.all([
      columnExists(TB_PRODUCTS, 'is_active').catch(() => false),
      columnExists(TB_PRODUCTS, 'product_subgroup_id').catch(() => false),
      detectSearchColumns().catch(() => []),
      getColumnUdtName(TB_PRODUCTS, 'product_id').catch(() => null),
    ]);
  } catch {
    // segue
  }

  // valida grupo
  try {
    const gRes = await pool.query(
      `
        SELECT product_group_id, name, is_active
        FROM ${TB_GROUPS}
        WHERE product_group_id = $1
        LIMIT 1;
      `,
      [product_group_id],
    );

    if (!gRes.rowCount) {
      return res.status(404).json({ ok: false, error: 'Group not found.' });
    }

    if (gRes.rows[0]?.is_active === false) {
      return res.status(409).json({ ok: false, error: 'Cannot assign an inactive group.' });
    }
  } catch (err) {
    console.error('[groupsAndSubgroupsBatchApi:validateGroup] error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to validate group.' });
  }

  // valida subgrupo
  if (hasSubgroupCol && product_subgroup_id !== undefined) {
    if (!Number.isInteger(product_subgroup_id)) {
      return res
        .status(400)
        .json({ ok: false, error: 'product_subgroup_id must be an integer (or omit it).' });
    }

    try {
      await validateSubgroupBelongsToGroup({
        product_group_id,
        product_subgroup_id,
      });
    } catch (err) {
      const status = err?.status || 500;
      console.error('[groupsAndSubgroupsBatchApi:validateSubgroup] error:', err);
      return res.status(status).json({ ok: false, error: err?.message || 'Failed to validate subgroup.' });
    }
  }

  const { whereSql, values, meta: whereMeta } = buildProductsWhere({
    product_ids: body.product_ids,
    q: body.q,
    only_active_products: body.only_active_products,
    where_group_id: body.where_group_id,
    where_subgroup_id: body.where_subgroup_id,
    hasActiveCol,
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

    const setParts = [];
    const params = [...values];
    let i = params.length + 1;

    params.push(product_group_id);
    setParts.push(`product_group_id = $${i++}`);

    if (hasSubgroupCol) {
      if (product_subgroup_id !== undefined) {
        params.push(product_subgroup_id);
        setParts.push(`product_subgroup_id = $${i++}`);
      }
    }

    const hasUpdatedAt = await columnExists(TB_PRODUCTS, 'updated_at').catch(() => false);
    if (hasUpdatedAt) setParts.push(`updated_at = now()`);

    const sql = `
      UPDATE ${TB_PRODUCTS} p
      SET ${setParts.join(', ')}
      ${whereSql}
      RETURNING
        p.product_id,
        p.product_group_id
        ${hasSubgroupCol ? ', p.product_subgroup_id' : ''}
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
        hasSubgroupCol,
        hasActiveCol,
        searchCols,
        whereMeta,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[groupsAndSubgroupsBatchApi:batchAssignGroups] error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to batch assign groups/subgroups.' });
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// POST /api/products-groups/batch/clear
// -----------------------------------------------------------------------------
export async function batchClearGroups(req, res) {
  const body = req.body || {};

  let hasActiveCol = false;
  let hasSubgroupCol = false;
  let searchCols = [];
  let productIdUdtName = null;

  try {
    [hasActiveCol, hasSubgroupCol, searchCols, productIdUdtName] = await Promise.all([
      columnExists(TB_PRODUCTS, 'is_active').catch(() => false),
      columnExists(TB_PRODUCTS, 'product_subgroup_id').catch(() => false),
      detectSearchColumns().catch(() => []),
      getColumnUdtName(TB_PRODUCTS, 'product_id').catch(() => null),
    ]);
  } catch {
    // segue
  }

  const { whereSql, values, meta: whereMeta } = buildProductsWhere({
    product_ids: body.product_ids,
    q: body.q,
    only_active_products: body.only_active_products,
    where_group_id: body.where_group_id,
    where_subgroup_id: body.where_subgroup_id,
    hasActiveCol,
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

    const hasUpdatedAt = await columnExists(TB_PRODUCTS, 'updated_at').catch(() => false);

    const sql = `
      UPDATE ${TB_PRODUCTS} p
      SET
        product_group_id = NULL
        ${hasSubgroupCol ? ', product_subgroup_id = NULL' : ''}
        ${hasUpdatedAt ? ', updated_at = now()' : ''}
      ${whereSql}
      RETURNING
        p.product_id,
        p.product_group_id
        ${hasSubgroupCol ? ', p.product_subgroup_id' : ''}
        ${hasUpdatedAt ? ', p.updated_at' : ''};
    `;

    const { rows } = await client.query(sql, values);

    await client.query('COMMIT');
    return res.json({
      ok: true,
      affected: rows.length,
      rows,
      data: rows,
      meta: {
        hasSubgroupCol,
        hasActiveCol,
        searchCols,
        whereMeta,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[groupsAndSubgroupsBatchApi:batchClearGroups] error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to batch clear groups/subgroups.' });
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// GET /api/products-groups/batch/list
// -----------------------------------------------------------------------------
export async function batchListProducts(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const q = String(req.query.q || '').trim();
    const linked = req.query.linked; // 'true' | 'false' | undefined
    const onlyActive = req.query.only_active === 'true' || req.query.only_active_products !== 'false';

    const [hasActiveCol, hasSubgroupCol, searchCols] = await Promise.all([
      columnExists(TB_PRODUCTS, 'is_active').catch(() => false),
      columnExists(TB_PRODUCTS, 'product_subgroup_id').catch(() => false),
      detectSearchColumns().catch(() => []),
    ]);

    const where = [];
    const values = [];
    let i = 1;

    if (notEmptyStr(q)) {
      values.push(`%${q}%`);
      const idx = i++;

      const ors = [];
      ors.push(`p.product_id::text ILIKE $${idx}`);
      for (const col of searchCols) {
        ors.push(`COALESCE(CAST(p.${col} AS text),'') ILIKE $${idx}`);
      }
      where.push(`(${ors.join(' OR ')})`);
    }

    if (hasActiveCol && onlyActive) {
      where.push(`p.is_active = TRUE`);
    }

    if (linked === 'true') where.push(`p.product_group_id IS NOT NULL`);
    if (linked === 'false') where.push(`p.product_group_id IS NULL`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const selectCols = [
      'p.product_id',
      ...(searchCols.includes('product_code') ? ['p.product_code'] : []),
      ...(searchCols.includes('product_description') ? ['p.product_description'] : []),
      ...(searchCols.includes('name') ? ['p.name'] : []),
      ...(searchCols.includes('description') ? ['p.description'] : []),
      'p.product_group_id',
      ...(hasSubgroupCol ? ['p.product_subgroup_id'] : []),
      ...(hasActiveCol ? ['p.is_active'] : []),
    ].join(', ');

    const sql = `
      SELECT ${selectCols}
      FROM ${TB_PRODUCTS} p
      ${whereSql}
      ORDER BY p.product_id DESC
      LIMIT $${i++}
      OFFSET $${i++};
    `;

    values.push(limit);
    values.push(offset);

    const { rows } = await pool.query(sql, values);

    return res.json({
      ok: true,
      page,
      limit,
      data: rows,
    });
  } catch (err) {
    console.error('[batchListProducts]', err);
    return res.status(500).json({
      ok: false,
      error: 'Failed to list products.',
    });
  }
}

export default {
  batchListProducts,
  batchAssignGroups,
  batchClearGroups,
};
