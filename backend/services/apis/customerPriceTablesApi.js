export async function listActivePriceTables(db) {
  const { rows } = await db.query(`
    SELECT price_id, name, description
    FROM public.prices
    WHERE active = true
    ORDER BY price_id
  `);

  return rows;
}

export async function getCustomerPriceTable(db, customerId) {
  const { rows } = await db.query(`
    SELECT
      cpt.customer_id,
      cpt.price_id,
      p.name,
      p.description,
      cpt.created_at,
      cpt.updated_at
    FROM public."customerPriceTables" AS cpt
    JOIN public.customers AS c
      ON c.customer_id = cpt.customer_id
      AND c.is_active = true
    JOIN public.prices AS p
      ON p.price_id = cpt.price_id
      AND p.active = true
    WHERE cpt.customer_id = $1
  `, [customerId]);

  return rows[0] || null;
}

export async function assignCustomerPriceTable(
  db,
  customerId,
  priceId
) {
  const { rows } = await db.query(`
    INSERT INTO public."customerPriceTables" AS cpt (
      customer_id,
      price_id
    )
    SELECT
      c.customer_id,
      p.price_id
    FROM public.customers AS c
    JOIN public.prices AS p
      ON p.price_id = $2
      AND p.active = true
    WHERE c.customer_id = $1
      AND c.is_active = true
    ON CONFLICT (customer_id)
    DO UPDATE SET
      price_id = EXCLUDED.price_id,
      updated_at = now()
    RETURNING
      customer_id,
      price_id,
      created_at,
      updated_at
  `, [customerId, priceId]);

  return rows[0] || null;
}

export async function listCustomerPricedProducts(
  db,
  customerId,
  options = {}
) {
  const search = String(options.search || '').trim();
  const limit = Math.min(options.limit || 100, 500);
  const offset = options.offset || 0;

  const { rows } = await db.query(`
    SELECT
      p.product_id,
      p.product_code,
      p.description,
      p.manufacturer_ref,
      pp.price_id,
      pr.name AS price_table_name,
      pp.sale_price
    FROM public."customerPriceTables" AS cpt
    JOIN public.prices AS pr
      ON pr.price_id = cpt.price_id
      AND pr.active = true
    JOIN public."productsPrices" AS pp
      ON pp.price_id = cpt.price_id
    JOIN public.products AS p
      ON p.product_id::text = pp.product_id
      AND p.is_active = true
    WHERE cpt.customer_id = $1
      AND (
        $2 = ''
        OR p.product_code ILIKE '%' || $2 || '%'
        OR p.description ILIKE '%' || $2 || '%'
        OR COALESCE(p.manufacturer_ref, '') ILIKE '%' || $2 || '%'
      )
    ORDER BY p.description, p.product_code
    LIMIT $3
    OFFSET $4
  `, [customerId, search, limit, offset]);

  return rows;
}

export async function priceBudgetItems(db, customerId, items) {
  const assignment = await getCustomerPriceTable(db, customerId);

  if (!assignment) {
    const error = new Error(
      'Customer has no active price table assignment'
    );
    error.status = 409;
    throw error;
  }

  const productCodes = items.map((item) => item.productCode);

  const { rows } = await db.query(`
    SELECT
      p.product_id,
      p.product_code,
      p.description,
      p.manufacturer_ref,
      pp.sale_price
    FROM public.products AS p
    JOIN public."productsPrices" AS pp
      ON pp.product_id = p.product_id::text
      AND pp.price_id = $1
    WHERE p.is_active = true
      AND p.product_code = ANY($2::varchar[])
  `, [assignment.price_id, productCodes]);

  const productsByCode = new Map(
    rows.map((row) => [row.product_code, row])
  );

  const missingProductCodes = productCodes.filter(
    (productCode) => !productsByCode.has(productCode)
  );

  if (missingProductCodes.length > 0) {
    const error = new Error(
      'Some products are missing from the customer price table'
    );

    error.status = 409;
    error.details = [...new Set(missingProductCodes)];

    throw error;
  }

  return {
    customerId,
    priceId: assignment.price_id,
    priceTableName: assignment.name,

    items: items.map(({ productCode, quantity }) => {
      const product = productsByCode.get(productCode);

      return {
        productId: String(product.product_id),
        sku: product.product_code,
        description: product.description,
        manufacturerRef: product.manufacturer_ref,
        quantity,
        unitPrice: product.sale_price,
        priceId: assignment.price_id,
      };
    }),
  };
}