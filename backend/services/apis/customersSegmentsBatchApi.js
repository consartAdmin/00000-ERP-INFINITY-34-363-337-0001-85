// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║ customersSegmentsBatchApi.js — Batch Segment Link (Postgres) — CONSART ERP  ║
// ║ - GET  batch-list                                                            ║
// ║ - POST batch-apply                                                           ║
// ║ - POST unlink                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_CUSTOMERS = 'public."customers"';
const TB_SEGMENTS  = 'public."customerSegments"';

/* ============================================================================
   LIST BATCH
   - Lista clientes com/sem segmento
============================================================================ */

export async function listBatch({
  q = '',
  hasSegment,
  limit = 20,
  offset = 0,
} = {}) {

  const params = [];
  const where = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(
      LOWER(COALESCE(c.trade_name,'')) LIKE ${p}
      OR LOWER(COALESCE(c.legal_name,'')) LIKE ${p}
      OR LOWER(COALESCE(c.tax_id,'')) LIKE ${p}
      OR LOWER(COALESCE(c.email,'')) LIKE ${p}
      OR LOWER(COALESCE(c.phone_number,'')) LIKE ${p}
      OR LOWER(COALESCE(c.mobile_number,'')) LIKE ${p}
    )`);
  }

  if (hasSegment === true) where.push(`c.segment_id IS NOT NULL`);
  if (hasSegment === false) where.push(`c.segment_id IS NULL`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM ${TB_CUSTOMERS} c
      ${whereSql};
    `,
    params
  );

  const total = countRes.rows?.[0]?.total ?? 0;

  const { rows } = await pool.query(
    `
      SELECT
        c.customer_id,
        c.trade_name,
        c.legal_name,
        c.tax_id,
        c.email,
        c.phone_number,
        c.mobile_number,
        c.segment_id,
        (c.segment_id IS NOT NULL) AS has_segment,
        s.segment_code,
        s.segment_name
      FROM ${TB_CUSTOMERS} c
      LEFT JOIN ${TB_SEGMENTS} s
        ON s.segment_id = c.segment_id
      ${whereSql}
      ORDER BY LOWER(COALESCE(c.trade_name, c.legal_name)) ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `,
    [...params, Number(limit), Number(offset)]
  );

  return {
    rows,
    total,
    limit: Number(limit),
    offset: Number(offset)
  };
}

/* ============================================================================
   BATCH APPLY
============================================================================ */

export async function batchApply({ customerIds = [], segment_id }) {

  if (!Array.isArray(customerIds) || !customerIds.length) {
    throw new Error('customerIds is required.');
  }

  if (!Number.isFinite(Number(segment_id))) {
    throw new Error('segment_id is required.');
  }

  const ids = customerIds.map(Number).filter(n => Number.isFinite(n));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const segCheck = await client.query(
      `SELECT segment_id FROM ${TB_SEGMENTS} WHERE segment_id = $1 LIMIT 1;`,
      [Number(segment_id)]
    );

    if (!segCheck.rows.length) {
      throw new Error('Segmento não encontrado.');
    }

    const updateRes = await client.query(
      `
        UPDATE ${TB_CUSTOMERS}
        SET segment_id = $1
        WHERE customer_id = ANY($2::bigint[]);
      `,
      [Number(segment_id), ids]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      updated: updateRes.rowCount,
      attempted: ids.length,
      segment_id: Number(segment_id)
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ============================================================================
   UNLINK ONE
============================================================================ */

export async function unlinkOne({ customer_id }) {

  if (!Number.isFinite(Number(customer_id))) {
    throw new Error('customer_id is required.');
  }

  const { rowCount } = await pool.query(
    `
      UPDATE ${TB_CUSTOMERS}
      SET segment_id = NULL
      WHERE customer_id = $1;
    `,
    [Number(customer_id)]
  );

  return {
    ok: true,
    customer_id: Number(customer_id),
    updated: rowCount
  };
}