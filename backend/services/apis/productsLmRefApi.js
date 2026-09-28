import pool from '../../config/db.js';

const TABLE = 'public."productsLmRef"';

const PRODUCTS_LM_REF_COLUMNS = `
  product_lm_ref_id,
  supplier_id,
  nf_product_code,
  product_code,
  description,
  is_active,
  created_at,
  updated_at
`;

export async function findAllProductsLmRef({
  supplierId,
  isActive,
  search,
  limit = 50,
  offset = 0,
} = {}) {
  const conditions = [];
  const values = [];

  if (supplierId !== undefined) {
    values.push(supplierId);
    conditions.push(`supplier_id = $${values.length}`);
  }

  if (isActive !== undefined) {
    values.push(isActive);
    conditions.push(`is_active = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(
      nf_product_code ILIKE $${values.length}
      OR product_code ILIKE $${values.length}
      OR description ILIKE $${values.length}
    )`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  values.push(limit, offset);

  const query = `
    SELECT ${PRODUCTS_LM_REF_COLUMNS}
    FROM ${TABLE}
    ${whereClause}
    ORDER BY product_lm_ref_id ASC
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
  `;

  const { rows } = await pool.query(query, values);
  return rows;
}

export async function findProductLmRefById(productLmRefId) {
  const { rows } = await pool.query(
    `SELECT ${PRODUCTS_LM_REF_COLUMNS}
     FROM ${TABLE}
     WHERE product_lm_ref_id = $1`,
    [productLmRefId],
  );

  return rows[0] ?? null;
}

export async function createProductLmRef({
  supplierId,
  nfProductCode,
  productCode,
  description,
  isActive = true,
}) {
  const { rows } = await pool.query(
    `INSERT INTO ${TABLE} (
       supplier_id,
       nf_product_code,
       product_code,
       description,
       is_active
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PRODUCTS_LM_REF_COLUMNS}`,
    [supplierId, nfProductCode, productCode, description, isActive],
  );

  return rows[0];
}

export async function updateProductLmRef(
  productLmRefId,
  { supplierId, nfProductCode, productCode, description, isActive },
) {
  const fieldMap = {
    supplierId: ['supplier_id', supplierId],
    nfProductCode: ['nf_product_code', nfProductCode],
    productCode: ['product_code', productCode],
    description: ['description', description],
    isActive: ['is_active', isActive],
  };

  const updates = [];
  const values = [];

  for (const [field, [column, value]] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    }
  }

  if (!updates.length) {
    return findProductLmRefById(productLmRefId);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(productLmRefId);

  const { rows } = await pool.query(
    `UPDATE ${TABLE}
     SET ${updates.join(', ')}
     WHERE product_lm_ref_id = $${values.length}
     RETURNING ${PRODUCTS_LM_REF_COLUMNS}`,
    values,
  );

  return rows[0] ?? null;
}

export async function deleteProductLmRef(productLmRefId) {
  const { rows } = await pool.query(
    `DELETE FROM ${TABLE}
     WHERE product_lm_ref_id = $1
     RETURNING ${PRODUCTS_LM_REF_COLUMNS}`,
    [productLmRefId],
  );

  return rows[0] ?? null;
}

