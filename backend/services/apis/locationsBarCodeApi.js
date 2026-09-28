// ╔══════════════════════════════════════════════════════════════════════╗
// ║ locationsBarCodeApi.js — DAL/API Locations BarCode                 ║
// ║ CONSART ERP | ESM + PostgreSQL                                     ║
// ║ Table: public."locationsBarCode"                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const TABLES = Object.freeze({
  BARCODES: 'public."locationsBarCode"',
  LOCALS: 'public."locationLocals"',
  CORRIDORS: 'public."locationCorridors"',
  SHELVES: 'public."locationShelves"',
  BINS: 'public."locationBins"',
  POSITIONS: 'public."locationPositions"',
});

function normalizeBarcode(value) {
  return String(value || '').trim().toUpperCase();
}

function buildUpdateSet(payload, startIndex = 1) {
  const allowed = [
    'local_id',
    'corridor_id',
    'shelf_id',
    'bin_id',
    'position_id',
    'barcode',
    'barcode_type',
    'active',
  ];

  const keys = Object.keys(payload).filter(
    (k) => allowed.includes(k) && payload[k] !== undefined
  );

  const setParts = [];
  const values = [];

  keys.forEach((key, i) => {
    setParts.push(`"${key}" = $${startIndex + i}`);
    values.push(key === 'barcode' ? normalizeBarcode(payload[key]) : payload[key]);
  });

  setParts.push(`updated_at = NOW()`);

  return {
    setClause: `SET ${setParts.join(', ')}`,
    values,
  };
}

async function list(pgPool, { q = '', activeOnly = false, limit = 500, offset = 0 } = {}) {
  const params = [];
  const where = [];
  let idx = 1;

  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    where.push(`
      (
        LOWER(COALESCE(lbc.barcode, '')) LIKE $${idx}
        OR LOWER(COALESCE(ll.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(lc.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(ls.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(lb.name, '')) LIKE $${idx}
        OR LOWER(COALESCE(lp.name, '')) LIKE $${idx}
      )
    `);
    idx++;
  }

  if (activeOnly) {
    where.push(`lbc.active = TRUE`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(Math.max(1, Math.min(Number(limit) || 500, 5000)));
  const limitParam = idx++;

  params.push(Math.max(0, Number(offset) || 0));
  const offsetParam = idx++;

  const sql = `
    SELECT
      lbc.id,
      lbc.local_id,
      lbc.corridor_id,
      lbc.shelf_id,
      lbc.bin_id,
      lbc.position_id,
      lbc.barcode,
      lbc.barcode_type,
      lbc.active,
      lbc.created_at,
      lbc.updated_at,

      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      lb.name AS bandeja,
      lp.name AS position,

      CONCAT_WS(' / ', ll.name, lc.name, ls.name, lb.name, lp.name) AS label

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

    ${whereSql}

    ORDER BY lbc.id DESC

    LIMIT $${limitParam}
    OFFSET $${offsetParam};
  `;

  const { rows } = await pgPool.query(sql, params);
  return rows;
}

async function getById(pgPool, id) {
  const sql = `
    SELECT
      lbc.*,
      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      lb.name AS bandeja,
      lp.name AS position,
      CONCAT_WS(' / ', ll.name, lc.name, ls.name, lb.name, lp.name) AS label
    FROM ${TABLES.BARCODES} lbc
    LEFT JOIN ${TABLES.LOCALS} ll ON ll.id = lbc.local_id
    LEFT JOIN ${TABLES.CORRIDORS} lc ON lc.id = lbc.corridor_id
    LEFT JOIN ${TABLES.SHELVES} ls ON ls.id = lbc.shelf_id
    LEFT JOIN ${TABLES.BINS} lb ON lb.id = lbc.bin_id
    LEFT JOIN ${TABLES.POSITIONS} lp ON lp.id = lbc.position_id
    WHERE lbc.id = $1
    LIMIT 1;
  `;

  const { rows } = await pgPool.query(sql, [id]);
  return rows[0] || null;
}

async function getByBarcode(pgPool, barcode) {
  const sql = `
    SELECT
      lbc.*,
      ll.name AS local,
      lc.name AS corredor,
      ls.name AS prateleira,
      lb.name AS bandeja,
      lp.name AS position,
      CONCAT_WS(' / ', ll.name, lc.name, ls.name, lb.name, lp.name) AS label
    FROM ${TABLES.BARCODES} lbc
    LEFT JOIN ${TABLES.LOCALS} ll ON ll.id = lbc.local_id
    LEFT JOIN ${TABLES.CORRIDORS} lc ON lc.id = lbc.corridor_id
    LEFT JOIN ${TABLES.SHELVES} ls ON ls.id = lbc.shelf_id
    LEFT JOIN ${TABLES.BINS} lb ON lb.id = lbc.bin_id
    LEFT JOIN ${TABLES.POSITIONS} lp ON lp.id = lbc.position_id
    WHERE lbc.barcode = $1
      AND lbc.active = TRUE
    LIMIT 1;
  `;

  const { rows } = await pgPool.query(sql, [normalizeBarcode(barcode)]);
  return rows[0] || null;
}

async function create(pgPool, payload) {
  const barcode = normalizeBarcode(payload.barcode);

  if (!barcode) {
    throw new Error('barcode is required');
  }

  const sql = `
    INSERT INTO ${TABLES.BARCODES} (
      local_id,
      corridor_id,
      shelf_id,
      bin_id,
      position_id,
      barcode,
      barcode_type,
      active
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'CODE128'), COALESCE($8, TRUE))
    RETURNING *;
  `;

  const params = [
    payload.local_id || null,
    payload.corridor_id || null,
    payload.shelf_id || null,
    payload.bin_id || null,
    payload.position_id || null,
    barcode,
    payload.barcode_type || 'CODE128',
    payload.active ?? true,
  ];

  const { rows } = await pgPool.query(sql, params);
  return rows[0];
}

async function update(pgPool, id, payload) {
  const { setClause, values } = buildUpdateSet(payload, 1);

  const sql = `
    UPDATE ${TABLES.BARCODES}
    ${setClause}
    WHERE id = $${values.length + 1}
    RETURNING *;
  `;

  const { rows } = await pgPool.query(sql, [...values, id]);
  return rows[0] || null;
}

async function deactivate(pgPool, id) {
  const sql = `
    UPDATE ${TABLES.BARCODES}
    SET active = FALSE,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const { rows } = await pgPool.query(sql, [id]);
  return rows[0] || null;
}

async function remove(pgPool, id) {
  await pgPool.query(`DELETE FROM ${TABLES.BARCODES} WHERE id = $1;`, [id]);
  return { success: true };
}

async function generateBins(pgPool) {
  const sql = `
    INSERT INTO ${TABLES.BARCODES} (
      local_id,
      corridor_id,
      shelf_id,
      bin_id,
      barcode,
      barcode_type,
      active
    )
    SELECT
      ll.id,
      lc.id,
      ls.id,
      lb.id,
      'LOC-BIN-' || LPAD(lb.id::text, 6, '0'),
      'CODE128',
      TRUE
    FROM ${TABLES.LOCALS} ll
    INNER JOIN ${TABLES.CORRIDORS} lc ON lc.local_id = ll.id
    INNER JOIN ${TABLES.SHELVES} ls ON ls.corridor_id = lc.id
    INNER JOIN ${TABLES.BINS} lb ON lb.shelf_id = ls.id
    ON CONFLICT (barcode) DO NOTHING
    RETURNING *;
  `;

  const { rows } = await pgPool.query(sql);
  return rows;
}

export default {
  TABLES,
  normalizeBarcode,
  list,
  getById,
  getByBarcode,
  create,
  update,
  deactivate,
  remove,
  generateBins,
};