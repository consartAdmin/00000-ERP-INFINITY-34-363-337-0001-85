// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmConsartApi.js — DAL CRM (CONSART ERP | ESM)                        ║
// ║                                                                      ║
// ║ Tabelas base:                                                        ║
// ║   • public."crmDealsStages"         → colunas do Kanban         ║
// ║   • public."crmDealsReativation"          → cards / negociações       ║
// ║   • public."crmDealsReativationOutcomes"  → resultados (conversão)    ║
// ║                                                                      ║
// ║ Funções principais:                                                  ║
// ║   • listStages({ includeInactive })                                  ║
// ║   • getStageById(id) / getStageByCode(code)                          ║
// ║   • listDeals({ stageCode, stageId, sellerId, search, limit, offset })║
// ║   • getDealById(id)                                                  ║
// ║   • createDeal(payload)                                              ║
// ║   • updateDeal(id, payload)                                          ║
// ║   • moveDealToStage({ id, stageCode, stageId })                      ║
// ║   • deleteDeal(id)                                                   ║
// ║   • registerOutcome({ dealId, outcomeType, note, reason, userId })   ║
// ║   • getOutcomesSummary({ sellerId })                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/* =========================================================================
 * Helpers internos
 * ========================================================================= */

function buildError(err, context = 'crmConsartApi') {
  console.error(`[${context}]`, err);
  return {
    ok: false,
    error: err?.message || String(err),
  };
}

function mapStageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    color: row.color,
    sort_order: row.sort_order,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapDealRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    stage_id: row.stage_id,
    stage_code: row.stage_code,
    stage_name: row.stage_name,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    seller_id: row.seller_id,
    seller_name: row.seller_name,
    estimated_value: row.estimated_value,
    tag: row.tag,
    next_step: row.next_step,
    last_activity_date: row.last_activity_date,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function fetchCustomerName(customerId) {
  if (!customerId) return null;
  const sql = `
    SELECT nome_fantasia AS name
    FROM public.clientes
    WHERE id = $1
  `;
  const { rows } = await pool.query(sql, [customerId]);
  return rows[0]?.name || null;
}

async function fetchSellerName(sellerId) {
  if (!sellerId) return null;

  const sql = `
    SELECT
      name,
      nickname
    FROM public."sellers"
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [sellerId]);

  if (!rows.length) return null;
  const row = rows[0];
  if (row.nickname) return `${row.name} (${row.nickname})`;
  return row.name;
}

/* =========================================================================
 * STAGES (colunas do Kanban)
 * ========================================================================= */

async function listStages({ includeInactive = false } = {}) {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (!includeInactive) {
      params.push(true);
      where += ` AND s.active = $${params.length}`;
    }

    const sql = `
      SELECT
        s.id,
        s.code,
        s.name,
        s.color,
        s.sort_order,
        s.active,
        s.created_at,
        s.updated_at
      FROM public."crmStagesReativation" s
      ${where}
      ORDER BY s.active DESC, s.sort_order ASC, s.id ASC
    `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows.map(mapStageRow) };
  } catch (err) {
    return buildError(err, 'crmConsartApi.listStages');
  }
}

async function getStageById(id) {
  try {
    const sql = `
      SELECT
        s.id,
        s.code,
        s.name,
        s.color,
        s.sort_order,
        s.active,
        s.created_at,
        s.updated_at
      FROM public."crmStagesReativation" s
      WHERE s.id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return { ok: false, error: 'STAGE_NOT_FOUND' };
    return { ok: true, data: mapStageRow(rows[0]) };
  } catch (err) {
    return buildError(err, 'crmConsartApi.getStageById');
  }
}

async function getStageByCode(code) {
  try {
    const sql = `
      SELECT
        s.id,
        s.code,
        s.name,
        s.color,
        s.sort_order,
        s.active,
        s.created_at,
        s.updated_at
      FROM public."crmStagesReativation" s
      WHERE UPPER(s.code) = UPPER($1)
    `;
    const { rows } = await pool.query(sql, [code]);
    if (!rows[0]) return { ok: false, error: 'STAGE_NOT_FOUND' };
    return { ok: true, data: mapStageRow(rows[0]) };
  } catch (err) {
    return buildError(err, 'crmConsartApi.getStageByCode');
  }
}

/* =========================================================================
 * DEALS (cards do Kanban)
 * ========================================================================= */

async function listDeals({
  stageCode,
  stageId,
  sellerId,
  search,
  limit = 50,
  offset = 0,
} = {}) {
  try {
    const params = [];
    // ⚠️ Só mostra cards "abertos" no Kanban
    let where = 'WHERE COALESCE(d.is_closed, FALSE) = FALSE';

    if (stageId) {
      params.push(stageId);
      where += ` AND d.stage_id = $${params.length}`;
    } else if (stageCode) {
      params.push(stageCode);
      where += ` AND UPPER(s.code) = UPPER($${params.length})`;
    }

    if (sellerId) {
      params.push(sellerId);
      where += ` AND d.seller_id = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toUpperCase()}%`);
      where += ` AND UPPER(d.customer_name) LIKE $${params.length}`;
    }

    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT
        d.id,
        d.stage_id,
        s.code        AS stage_code,
        s.name        AS stage_name,
        d.customer_id,
        d.customer_name,
        d.seller_id,
        d.seller_name,
        d.estimated_value,
        d.tag,
        d.next_step,
        d.last_activity_date,
        d.notes,
        d.created_at,
        d.updated_at
      FROM public."crmDealsReativation" d
      JOIN public."crmStagesReativation" s
        ON s.id = d.stage_id
      ${where}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
   `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows.map(mapDealRow) };
  } catch (err) {
    return buildError(err, 'crmConsartApi.listDeals');
  }
}

async function getDealById(id) {
  try {
    const sql = `
      SELECT
        d.id,
        d.stage_id,
        s.code        AS stage_code,
        s.name        AS stage_name,
        d.customer_id,
        d.customer_name,
        d.seller_id,
        d.seller_name,
        d.estimated_value,
        d.tag,
        d.next_step,
        d.last_activity_date,
        d.notes,
        d.created_at,
        d.updated_at
      FROM public."crmDealsReativation" d
      JOIN public."crmStagesReativation" s
        ON s.id = d.stage_id
      WHERE d.id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return { ok: false, error: 'DEAL_NOT_FOUND' };
    return { ok: true, data: mapDealRow(rows[0]) };
  } catch (err) {
    return buildError(err, 'crmConsartApi.getDealById');
  }
}

async function createDeal(payload = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let stageId = payload.stageId || payload.stage_id || null;
    if (!stageId && payload.stageCode) {
      const stageRes = await client.query(
        `
          SELECT id
          FROM public."crmStagesReativation"
          WHERE UPPER(code) = UPPER($1)
        `,
        [payload.stageCode]
      );
      stageId = stageRes.rows[0]?.id || null;
    }
    if (!stageId) throw new Error('STAGE_REQUIRED');

    let customerName = payload.customer_name || null;
    if (!customerName && payload.customer_id) {
      customerName = await fetchCustomerName(payload.customer_id);
    }
    if (!customerName) customerName = 'Cliente não informado';

    let sellerName = payload.seller_name || null;
    if (!sellerName && payload.seller_id) {
      sellerName = await fetchSellerName(payload.seller_id);
    }

    const sql = `
      INSERT INTO public."crmDealsReativation" (
        stage_id,
        customer_id,
        seller_id,
        customer_name,
        seller_name,
        estimated_value,
        tag,
        next_step,
        last_activity_date,
        notes
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      )
      RETURNING id
    `;

    const values = [
      stageId,
      payload.customer_id || null,
      payload.seller_id || null,
      customerName,
      sellerName,
      payload.estimated_value ?? null,
      payload.tag || null,
      payload.next_step || null,
      payload.last_activity_date || null,
      payload.notes || null,
    ];

    const { rows } = await client.query(sql, values);
    const newId = rows[0].id;

    await client.query('COMMIT');

    const detail = await getDealById(newId);
    if (!detail.ok) return { ok: true, data: { id: newId } };
    return { ok: true, data: detail.data };
  } catch (err) {
    await client.query('ROLLBACK');
    return buildError(err, 'crmConsartApi.createDeal');
  } finally {
    client.release();
  }
}

async function updateDeal(id, payload = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      `
        SELECT *
        FROM public."crmDealsReativation"
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );
    const current = currentRes.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'DEAL_NOT_FOUND' };
    }

    let stageId = payload.stageId || payload.stage_id || current.stage_id;
    if (!stageId && payload.stageCode) {
      const stageRes = await client.query(
        `
          SELECT id
          FROM public."crmStagesReativation"
          WHERE UPPER(code) = UPPER($1)
        `,
        [payload.stageCode]
      );
      stageId = stageRes.rows[0]?.id || stageId;
    }

    const customerId =
      payload.customer_id !== undefined ? payload.customer_id : current.customer_id;
    const sellerId =
      payload.seller_id !== undefined ? payload.seller_id : current.seller_id;

    let customerName =
      payload.customer_name !== undefined ? payload.customer_name : current.customer_name;
    let sellerName =
      payload.seller_name !== undefined ? payload.seller_name : current.seller_name;

    if (payload.customer_id !== undefined && !customerName) {
      customerName = await fetchCustomerName(payload.customer_id);
    }
    if (payload.seller_id !== undefined && !sellerName) {
      sellerName = await fetchSellerName(payload.seller_id);
    }

    const sql = `
      UPDATE public."crmDealsReativation"
      SET
        stage_id           = $1,
        customer_id        = $2,
        seller_id          = $3,
        customer_name      = $4,
        seller_name        = $5,
        estimated_value    = $6,
        tag                = $7,
        next_step          = $8,
        last_activity_date = $9,
        notes              = $10
      WHERE id = $11
      RETURNING id
    `;

    const values = [
      stageId,
      customerId,
      sellerId,
      customerName || current.customer_name,
      sellerName || current.seller_name,
      payload.estimated_value ?? current.estimated_value,
      payload.tag !== undefined ? payload.tag : current.tag,
      payload.next_step !== undefined ? payload.next_step : current.next_step,
      payload.last_activity_date !== undefined
        ? payload.last_activity_date
        : current.last_activity_date,
      payload.notes !== undefined ? payload.notes : current.notes,
      id,
    ];

    const { rows } = await client.query(sql, values);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'DEAL_NOT_FOUND_AFTER_UPDATE' };
    }

    await client.query('COMMIT');

    const detail = await getDealById(id);
    if (!detail.ok) return { ok: true, data: { id } };
    return { ok: true, data: detail.data };
  } catch (err) {
    await client.query('ROLLBACK');
    return buildError(err, 'crmConsartApi.updateDeal');
  } finally {
    client.release();
  }
}

async function moveDealToStage({ id, stageCode, stageId }) {
  try {
    if (!stageId && !stageCode) return { ok: false, error: 'STAGE_REQUIRED' };

    let targetStageId = stageId;

    if (!targetStageId && stageCode) {
      const stageRes = await getStageByCode(stageCode);
      if (!stageRes.ok) return { ok: false, error: stageRes.error || 'STAGE_NOT_FOUND' };
      targetStageId = stageRes.data.id;
    }

    const sql = `
      UPDATE public."crmDealsReativation"
      SET stage_id = $1
      WHERE id = $2
      RETURNING id
    `;
    const { rows } = await pool.query(sql, [targetStageId, id]);
    if (!rows[0]) return { ok: false, error: 'DEAL_NOT_FOUND' };

    const detail = await getDealById(id);
    if (!detail.ok) return { ok: true, data: { id } };
    return { ok: true, data: detail.data };
  } catch (err) {
    return buildError(err, 'crmConsartApi.moveDealToStage');
  }
}

async function deleteDeal(id) {
  try {
    const sql = `
      DELETE FROM public."crmDealsReativation"
      WHERE id = $1
      RETURNING id
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return { ok: false, error: 'DEAL_NOT_FOUND' };
    return { ok: true, data: { id } };
  } catch (err) {
    return buildError(err, 'crmConsartApi.deleteDeal');
  }
}

/* =========================================================================
 * OUTCOMES (Conversão / Queda de venda)
 * ========================================================================= */

async function registerOutcome({ dealId, outcomeType, note, reason, userId }) {
  const client = await pool.connect();
  try {
    const type = String(outcomeType || '').toUpperCase();
    if (!type || !['CONVERSION', 'LOSS'].includes(type)) {
      return { ok: false, error: 'INVALID_OUTCOME_TYPE' };
    }

    await client.query('BEGIN');

    const dealRes = await client.query(
      `
        SELECT
          id,
          stage_id,
          seller_id,
          customer_id,
          estimated_value
        FROM public."crmDealsReativation"
        WHERE id = $1
        FOR UPDATE
      `,
      [dealId]
    );

    const deal = dealRes.rows[0];
    if (!deal) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'DEAL_NOT_FOUND' };
    }

    await client.query(
      `
        UPDATE public."crmDealsReativation"
        SET
          is_closed = TRUE,
          last_activity_date = COALESCE(last_activity_date, now())
        WHERE id = $1
      `,
      [dealId]
    );

    const estimatedValue = deal.estimated_value ?? null;
    const valueAtMoment = estimatedValue;

    const insRes = await client.query(
      `
        INSERT INTO public."crmDealsReativationOutcomes" (
          deal_id,
          outcome_type,
          outcome_source,
          stage_id,
          seller_id,
          customer_id,
          estimated_value,
          note,
          outcome_reason,
          notes,
          value_at_moment,
          created_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
        )
        RETURNING id, created_at
      `,
      [
        dealId,
        type,
        'KANBAN_DROP',
        deal.stage_id || null,
        deal.seller_id || null,
        deal.customer_id || null,
        estimatedValue,
        note || null,
        reason || null,
        note || null,
        valueAtMoment,
        userId || null,
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      data: {
        id: insRes.rows[0].id,
        deal_id: dealId,
        outcome_type: type,
        created_at: insRes.rows[0].created_at,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    return buildError(err, 'crmConsartApi.registerOutcome');
  } finally {
    client.release();
  }
}

async function getOutcomesSummary({ sellerId } = {}) {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (sellerId) {
      params.push(sellerId);
      where += ` AND o.seller_id = $${params.length}`;
    }

    const sql = `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN o.outcome_type = 'CONVERSION'
              THEN COALESCE(o.value_at_moment, o.estimated_value, 0)
              ELSE 0
            END
          ),
          0
        ) AS total_converted,
        COALESCE(
          SUM(
            CASE
              WHEN o.outcome_type IN ('LOSS', 'LOST')
              THEN COALESCE(o.value_at_moment, o.estimated_value, 0)
              ELSE 0
            END
          ),
          0
        ) AS total_lost,
        COALESCE(
          SUM(
            CASE
              WHEN o.outcome_type = 'CONVERSION' THEN 1
              ELSE 0
            END
          ),
          0
        ) AS count_converted,
        COALESCE(
          SUM(
            CASE
              WHEN o.outcome_type IN ('LOSS', 'LOST') THEN 1
              ELSE 0
            END
          ),
          0
        ) AS count_lost
      FROM public."crmDealsReativationOutcomes" o
      ${where}
    `;

    const { rows } = await pool.query(sql, params);
    const row = rows[0] || {
      total_converted: 0,
      total_lost: 0,
      count_converted: 0,
      count_lost: 0,
    };

    return { ok: true, data: row };
  } catch (err) {
    return buildError(err, 'crmConsartApi.getOutcomesSummary');
  }
}

/* =========================================================================
 * Export default
 * ========================================================================= */

const crmConsartApi = {
  // stages
  listStages,
  getStageById,
  getStageByCode,

  // deals
  listDeals,
  getDealById,
  createDeal,
  updateDeal,
  moveDealToStage,
  deleteDeal,

  // outcomes
  registerOutcome,
  getOutcomesSummary,
};

export default crmConsartApi;
