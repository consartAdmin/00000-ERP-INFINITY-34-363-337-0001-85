// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ locationsApi.js — Warehouse Locations API (CONSART ERP | ESM + Postgres) ║
// ║ Tables (camelCase with quotes):                                          ║
// ║   public."locationLocals"                                                ║
// ║   public."locationCorridors"                                             ║
// ║   public."locationShelves"                                               ║
// ║   public."locationBins"                                                  ║
// ║   public."locationPositions"                                             ║
// ║   public."localizationProducts"                                          ║
// ║                                                                           ║
// ║ This module DOES NOT create the pool; you must pass pgPool in each call. ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/* ------------------------------------------------------------------------- */
/* Table name constants (quoted, to support CamelCase)                       */
/* ------------------------------------------------------------------------- */

const TABLES = Object.freeze({
  LOCALS: 'public."locationLocals"',
  CORRIDORS: 'public."locationCorridors"',
  SHELVES: 'public."locationShelves"',
  BINS: 'public."locationBins"',
  POSITIONS: 'public."locationPositions"',
  LOCALIZATION_PRODUCTS: 'public."localizationProducts"',
  PRODUCTS: 'public."products"', // 👈 NOVO
});

/* ------------------------------------------------------------------------- */
/* Helper – run callback with client (optional, but good for transactions)  */
/* ------------------------------------------------------------------------- */

/**
 * @param {import('pg').Pool} pgPool
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withClient(pgPool, fn) {
  const client = await pgPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------------- */
/* Generic helpers                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Builds a dynamic SET clause and params for UPDATE
 * Returns: { setClause: 'SET col1 = $1, col2 = $2', values: [...] }
 */
function buildUpdateSet(payload, startIndex = 1) {
  const keys = Object.keys(payload).filter((k) => payload[k] !== undefined);
  const setParts = [];
  const values = [];

  keys.forEach((key, i) => {
    setParts.push(`"${key}" = $${startIndex + i}`);
    values.push(payload[key]);
  });

  return {
    setClause: setParts.length ? `SET ${setParts.join(', ')}` : '',
    values,
  };
}

/* ------------------------------------------------------------------------- */
/* 1) locationLocals — CRUD                                                  */
/* ------------------------------------------------------------------------- */

async function listLocals(pgPool, { activeOnly = true } = {}) {
  const text = `
    SELECT
      id,
      name,
      description,
      active,
      created_at,
      updated_at
    FROM ${TABLES.LOCALS}
    ${activeOnly ? 'WHERE active = TRUE' : ''}
    ORDER BY name;
  `;
  const { rows } = await pgPool.query(text);
  return rows;
}

async function getLocalById(pgPool, id) {
  const text = `
    SELECT
      id,
      name,
      description,
      active,
      created_at,
      updated_at
    FROM ${TABLES.LOCALS}
    WHERE id = $1;
  `;
  const { rows } = await pgPool.query(text, [id]);
  return rows[0] || null;
}

async function createLocal(pgPool, { name, description = null, active = true }) {
  const text = `
    INSERT INTO ${TABLES.LOCALS} (name, description, active)
    VALUES ($1, $2, $3)
    RETURNING id, name, description, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [name, description, active]);
  return rows[0];
}

async function updateLocal(pgPool, id, payload) {
  const { setClause, values } = buildUpdateSet(payload, 1);

  if (!setClause) {
    throw new Error('[locationsApi] updateLocal: empty payload');
  }

  const text = `
    UPDATE ${TABLES.LOCALS}
    ${setClause}
    WHERE id = $${values.length + 1}
    RETURNING id, name, description, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [...values, id]);
  return rows[0] || null;
}

async function deleteLocal(pgPool, id) {
  const text = `DELETE FROM ${TABLES.LOCALS} WHERE id = $1;`;
  await pgPool.query(text, [id]);
  return { success: true };
}

/* ------------------------------------------------------------------------- */
/* 2) locationCorridors — CRUD                                               */
/* ------------------------------------------------------------------------- */

async function listCorridors(pgPool, { localId = null, activeOnly = true } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (localId !== null) {
    conditions.push(`local_id = $${idx++}`);
    params.push(localId);
  }
  if (activeOnly) {
    conditions.push(`active = TRUE`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const text = `
    SELECT id, name, description, local_id, active, created_at, updated_at
    FROM ${TABLES.CORRIDORS}
    ${where}
    ORDER BY name;
  `;
  const { rows } = await pgPool.query(text, params);
  return rows;
}

async function createCorridor(pgPool, { name, description = null, local_id = null, active = true }) {
  const text = `
    INSERT INTO ${TABLES.CORRIDORS} (name, description, local_id, active)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, description, local_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [name, description, local_id, active]);
  return rows[0];
}

async function updateCorridor(pgPool, id, payload) {
  const { setClause, values } = buildUpdateSet(payload, 1);
  if (!setClause) {
    throw new Error('[locationsApi] updateCorridor: empty payload');
  }

  const text = `
    UPDATE ${TABLES.CORRIDORS}
    ${setClause}
    WHERE id = $${values.length + 1}
    RETURNING id, name, description, local_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [...values, id]);
  return rows[0] || null;
}

async function deleteCorridor(pgPool, id) {
  const text = `DELETE FROM ${TABLES.CORRIDORS} WHERE id = $1;`;
  await pgPool.query(text, [id]);
  return { success: true };
}

/* ------------------------------------------------------------------------- */
/* 3) locationShelves — CRUD                                                 */
/* ------------------------------------------------------------------------- */

async function listShelves(pgPool, { corridorId = null, activeOnly = true } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (corridorId !== null) {
    conditions.push(`corridor_id = $${idx++}`);
    params.push(corridorId);
  }
  if (activeOnly) {
    conditions.push(`active = TRUE`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const text = `
    SELECT id, name, description, corridor_id, active, created_at, updated_at
    FROM ${TABLES.SHELVES}
    ${where}
    ORDER BY name;
  `;
  const { rows } = await pgPool.query(text, params);
  return rows;
}

async function createShelf(pgPool, { name, description = null, corridor_id = null, active = true }) {
  const text = `
    INSERT INTO ${TABLES.SHELVES} (name, description, corridor_id, active)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, description, corridor_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [name, description, corridor_id, active]);
  return rows[0];
}

async function updateShelf(pgPool, id, payload) {
  const { setClause, values } = buildUpdateSet(payload, 1);
  if (!setClause) {
    throw new Error('[locationsApi] updateShelf: empty payload');
  }

  const text = `
    UPDATE ${TABLES.SHELVES}
    ${setClause}
    WHERE id = $${values.length + 1}
    RETURNING id, name, description, corridor_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [...values, id]);
  return rows[0] || null;
}

async function deleteShelf(pgPool, id) {
  const text = `DELETE FROM ${TABLES.SHELVES} WHERE id = $1;`;
  await pgPool.query(text, [id]);
  return { success: true };
}

/* ------------------------------------------------------------------------- */
/* 4) locationBins — CRUD                                                    */
/* ------------------------------------------------------------------------- */

async function listBins(pgPool, { shelfId = null, activeOnly = true } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (shelfId !== null) {
    conditions.push(`shelf_id = $${idx++}`);
    params.push(shelfId);
  }
  if (activeOnly) {
    conditions.push(`active = TRUE`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const text = `
    SELECT id, name, description, shelf_id, active, created_at, updated_at
    FROM ${TABLES.BINS}
    ${where}
    ORDER BY name;
  `;
  const { rows } = await pgPool.query(text, params);
  return rows;
}

async function createBin(pgPool, { name, description = null, shelf_id = null, active = true }) {
  const text = `
    INSERT INTO ${TABLES.BINS} (name, description, shelf_id, active)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, description, shelf_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [name, description, shelf_id, active]);
  return rows[0];
}

async function updateBin(pgPool, id, payload) {
  const { setClause, values } = buildUpdateSet(payload, 1);
  if (!setClause) {
    throw new Error('[locationsApi] updateBin: empty payload');
  }

  const text = `
    UPDATE ${TABLES.BINS}
    ${setClause}
    WHERE id = $${values.length + 1}
    RETURNING id, name, description, shelf_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [...values, id]);
  return rows[0] || null;
}

async function deleteBin(pgPool, id) {
  const text = `DELETE FROM ${TABLES.BINS} WHERE id = $1;`;
  await pgPool.query(text, [id]);
  return { success: true };
}

/* ------------------------------------------------------------------------- */
/* 5) locationPositions — CRUD                                               */
/* ------------------------------------------------------------------------- */

async function listPositions(pgPool, { binId = null, activeOnly = true } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (binId !== null) {
    conditions.push(`bin_id = $${idx++}`);
    params.push(binId);
  }
  if (activeOnly) {
    conditions.push(`active = TRUE`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const text = `
    SELECT id, name, description, bin_id, active, created_at, updated_at
    FROM ${TABLES.POSITIONS}
    ${where}
    ORDER BY name;
  `;
  const { rows } = await pgPool.query(text, params);
  return rows;
}

async function createPosition(pgPool, { name, description = null, bin_id = null, active = true }) {
  const text = `
    INSERT INTO ${TABLES.POSITIONS} (name, description, bin_id, active)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, description, bin_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [name, description, bin_id, active]);
  return rows[0];
}

async function updatePosition(pgPool, id, payload) {
  const { setClause, values } = buildUpdateSet(payload, 1);
  if (!setClause) {
    throw new Error('[locationsApi] updatePosition: empty payload');
  }

  const text = `
    UPDATE ${TABLES.POSITIONS}
    ${setClause}
    WHERE id = $${values.length + 1}
    RETURNING id, name, description, bin_id, active, created_at, updated_at;
  `;
  const { rows } = await pgPool.query(text, [...values, id]);
  return rows[0] || null;
}

async function deletePosition(pgPool, id) {
  const text = `DELETE FROM ${TABLES.POSITIONS} WHERE id = $1;`;
  await pgPool.query(text, [id]);
  return { success: true };
}

/* ------------------------------------------------------------------------- */
/* 5.1) LOCATION MAP — FULL WAREHOUSE MAP                                    */
/* ------------------------------------------------------------------------- */

async function listLocationMap(
  pgPool,
  {
    q = '',
    corredor = '',
    prateleira = '',
    bandeja = '',
    onlyActive = true,
    limit = 5000,
  } = {}
) {
  const params = [];
  const where = [];
  let idx = 1;

  const active =
    String(onlyActive ?? 'true')
      .trim()
      .toLowerCase()
      .match(/^(1|true|t|yes|y|sim)$/i);

  if (active) {
    where.push(`
      ll.active = TRUE
      AND lc.active = TRUE
      AND ls.active = TRUE
      AND lb.active = TRUE
    `);
  }

  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);

    where.push(`
      (
        LOWER(COALESCE(ll.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(lc.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(ls.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(lb.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(lp.name, '')) LIKE $${idx}
      )
    `);

    idx++;
  }

  if (corredor) {
    params.push(`%${String(corredor).toLowerCase()}%`);

    where.push(`
      LOWER(COALESCE(lc.name, '')) LIKE $${idx}
    `);

    idx++;
  }

  if (prateleira) {
    params.push(`%${String(prateleira).toLowerCase()}%`);

    where.push(`
      LOWER(COALESCE(ls.name, '')) LIKE $${idx}
    `);

    idx++;
  }

  if (bandeja) {
    params.push(`%${String(bandeja).toLowerCase()}%`);

    where.push(`
      LOWER(COALESCE(lb.name, '')) LIKE $${idx}
    `);

    idx++;
  }

  const whereSql =
    where.length
      ? `WHERE ${where.join(' AND ')}`
      : '';

  const sql = `
    SELECT
      lb.id AS id,

      ll.id AS local_id,
      lc.id AS corridor_id,
      ls.id AS shelf_id,
      lb.id AS bin_id,
      lp.id AS position_id,

      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      ls.name AS gondola,
      lb.name AS bandeja,
      lb.name AS bin,
      lp.name AS position,

      CONCAT_WS(
        ' / ',
        ll.name,
        lc.name,
        ls.name,
        lb.name,
        lp.name
      ) AS label,

      COALESCE(
        lb.description,
        ls.description,
        lc.description,
        ll.description,
        ''
      ) AS descricao,

      (
        ll.active = TRUE
        AND lc.active = TRUE
        AND ls.active = TRUE
        AND lb.active = TRUE
      ) AS is_active

    FROM ${TABLES.LOCALS} ll

    INNER JOIN ${TABLES.CORRIDORS} lc
      ON lc.local_id = ll.id

    INNER JOIN ${TABLES.SHELVES} ls
      ON ls.corridor_id = lc.id

    INNER JOIN ${TABLES.BINS} lb
      ON lb.shelf_id = ls.id

    LEFT JOIN ${TABLES.POSITIONS} lp
      ON lp.bin_id = lb.id

    ${whereSql}

    ORDER BY
      ll.name ASC,
      lc.name ASC,
      ls.name ASC,
      lb.name ASC,
      lp.name ASC NULLS LAST

    LIMIT ${Math.max(1, Math.min(10000, Number(limit) || 5000))}
  `;

  const { rows } = await pgPool.query(sql, params);

  return rows;
}

/* ------------------------------------------------------------------------- */
/* 6) localizationProducts — product → location                              */
/* ------------------------------------------------------------------------- */

async function listProductLocations(pgPool, { productCode = null } = {}) {
  const params = [];
  let where = '';

  if (productCode) {
    where = 'WHERE lp.product_code = $1';
    params.push(productCode);
  }

  const text = `
    SELECT
      lp.id,
      lp.product_code,
      p.description AS product_description,  -- 👈 descrição do produto
      lp.local_id,
      lp.corridor_id,
      lp.shelf_id,
      lp.bin_id,
      lp.position_id,
      lp.local,
      lp.corridor,
      lp.shelf,
      lp.bin,
      lp.position,
      lp.notes,
      lp.created_at,
      lp.updated_at
    FROM ${TABLES.LOCALIZATION_PRODUCTS} lp
    LEFT JOIN ${TABLES.PRODUCTS} p
      ON p.product_code = lp.product_code   -- 🔁 ajuste aqui se sua coluna for outra
    ${where}
    ORDER BY lp.created_at DESC;
  `;

  const { rows } = await pgPool.query(text, params);
  return rows;
}

async function getProductLocationById(pgPool, id) {
  const text = `
    SELECT
      id,
      product_code,
      p.description AS product_description, 
      local_id,
      corridor_id,
      shelf_id,
      bin_id,
      position_id,
      local,
      corridor,
      shelf,
      bin,
      position,
      notes,
      created_at,
      updated_at
    FROM ${TABLES.LOCALIZATION_PRODUCTS}
    WHERE id = $1;
  `;
  const { rows } = await pgPool.query(text, [id]);
  return rows[0] || null;
}

/**
 * Creates a new product-location row
 */
async function createProductLocation(
  pgPool,
  {
    product_code,
    local_id = null,
    corridor_id = null,
    shelf_id = null,
    bin_id = null,
    position_id = null,
    local,
    corridor,
    shelf,
    bin = null,
    position = null,
    notes = null,
  }
) {
  const text = `
    INSERT INTO ${TABLES.LOCALIZATION_PRODUCTS} (
      product_code,
      local_id,
      corridor_id,
      shelf_id,
      bin_id,
      position_id,
      local,
      corridor,
      shelf,
      bin,
      position,
      notes
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12
    )
    RETURNING
      id,
      product_code,
      local_id,
      corridor_id,
      shelf_id,
      bin_id,
      position_id,
      local,
      corridor,
      shelf,
      bin,
      position,
      notes,
      created_at,
      updated_at;
  `;

  const params = [
    product_code,
    local_id,
    corridor_id,
    shelf_id,
    bin_id,
    position_id,
    local,
    corridor,
    shelf,
    bin,
    position,
    notes,
  ];

  const { rows } = await pgPool.query(text, params);
  return rows[0];
}

/**
 * Updates an existing product-location row
 */
async function updateProductLocation(pgPool, id, payload) {
  const { setClause, values } = buildUpdateSet(payload, 1);
  if (!setClause) {
    throw new Error('[locationsApi] updateProductLocation: empty payload');
  }

  const text = `
    UPDATE ${TABLES.LOCALIZATION_PRODUCTS}
    ${setClause}
    WHERE id = $${values.length + 1}
    RETURNING
      id,
      product_code,
      local_id,
      corridor_id,
      shelf_id,
      bin_id,
      position_id,
      local,
      corridor,
      shelf,
      bin,
      position,
      notes,
      created_at,
      updated_at;
  `;
  const { rows } = await pgPool.query(text, [...values, id]);
  return rows[0] || null;
}

async function deleteProductLocation(pgPool, id) {
  const text = `DELETE FROM ${TABLES.LOCALIZATION_PRODUCTS} WHERE id = $1;`;
  await pgPool.query(text, [id]);
  return { success: true };
}

async function getLocationByBarcode(pgPool, barcode) {
  const sql = `
    SELECT
      lbc.id AS barcode_id,
      lbc.barcode,
      lbc.barcode_type,
      lbc.active,

      ll.id AS local_id,
      lc.id AS corridor_id,
      ls.id AS shelf_id,
      lb.id AS bin_id,
      lp.id AS position_id,

      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      lb.name AS bandeja,
      lp.name AS position,

      CONCAT_WS(
        ' / ',
        ll.name,
        lc.name,
        ls.name,
        lb.name,
        lp.name
      ) AS label

    FROM ${TABLES.BARCODES} lbc

    LEFT JOIN ${TABLES.LOCALS} ll
      ON ll.id = lbc.local_id

    LEFT JOIN ${TABLES.CORRIDORS} lc
      ON lc.id = lbc.corridor_id

    LEFT JOIN ${TABLES.SHELVES} ls
      ON ls.id = lbc.shelf_id

    LEFT JOIN ${TABLES.BINS} lb
      ON lb.id = lbc.bin_id

    LEFT JOIN ${TABLES.POSITIONS} lp
      ON lp.id = lbc.position_id

    WHERE lbc.barcode = $1
      AND lbc.active = TRUE

    LIMIT 1;
  `;

  const { rows } = await pgPool.query(sql, [barcode]);
  return rows[0] || null;
}

/* ------------------------------------------------------------------------- */
/* Export bundle                                                             */
/* ------------------------------------------------------------------------- */

const locationsApi = {
  TABLES,
  withClient,

  // Location map
  listLocationMap,

  // Locals
  listLocals,
  getLocalById,
  createLocal,
  updateLocal,
  deleteLocal,

  // Corridors
  listCorridors,
  createCorridor,
  updateCorridor,
  deleteCorridor,

  // Shelves
  listShelves,
  createShelf,
  updateShelf,
  deleteShelf,

  // Bins
  listBins,
  createBin,
  updateBin,
  deleteBin,

  // Positions
  listPositions,
  createPosition,
  updatePosition,
  deletePosition,

  // Product locations
  listProductLocations,
  getProductLocationById,
  createProductLocation,
  updateProductLocation,
  deleteProductLocation,
  getLocationByBarcode,
};

export default locationsApi;
