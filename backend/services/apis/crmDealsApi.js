// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmDealsApi.js — DAL CRM Deals (CONSART ERP | ESM)                  ║
// ║ + Kanban / Deals / Outcomes / Status Sync                           ║
// ║ + Conclusão do Lead: fecha card (is_closed=true)                    ║
// ║ + Summary do topo baseado em deals fechados                         ║
// ║ + Suporte sellerIds[] (escopo por usuário)                          ║
// ║ + Adaptado para tabelas: crmDeals, crmDealsOutcomes, crmLeadSources ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import perfApi from './crmDealsPerformanceApi.js';
import { applyCrmOutcomeToCustomerActivity } from './customerActivityApi.js';

perfApi.ensureTable?.()
  .then((r) => {
    if (r?.ok) console.log('[crmDealsApi] crmDealsActions OK');
    else console.warn('[crmDealsApi] ensureTable actions retorno:', r);
  })
  .catch((e) => console.warn('[crmDealsApi] ensureTable actions falhou:', e?.message || e));

function buildError(err, context = 'crmDealsApi') {
  console.error(`[${context}]`, err);
  return { ok: false, error: err?.message || String(err) };
}

function isFiniteNum(v) {
  return Number.isFinite(Number(v));
}

function toNumOrNull(v) {
  return isFiniteNum(v) ? Number(v) : null;
}

function toPositiveNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* =========================================================================
 * META / HELPERS — CustomerStatusTypes columns (cache)
 * ========================================================================= */
let _customerStatusTypesColsCache = null;

async function getCustomerStatusTypesCols() {
  if (_customerStatusTypesColsCache) return _customerStatusTypesColsCache;

  const colsRes = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customerStatusTypes'
  `);

  const cols = new Set((colsRes.rows || []).map((r) => r.column_name));
  _customerStatusTypesColsCache = cols;
  return cols;
}

/* =========================================================================
 * MAPPERS
 * ========================================================================= */
function mapStageRow(row) {
  if (!row) return null;

  const isActive = row.is_active ?? true;

  return {
    id: row.id,
    code: row.code ?? row.stage_code ?? null,
    name: row.name ?? row.stage_name ?? null,
    stage_name: row.stage_name ?? row.name ?? null,
    stage_code: row.stage_code ?? row.code ?? null,
    color: row.color ?? null,
    icon: row.icon ?? null,
    sort_order: row.sort_order ?? 0,
    active: isActive,
    is_active: isActive,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
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

    lead_source_id: row.lead_source_id ?? null,
    lead_source_name: row.lead_source_name ?? null,

    status_type_id: row.status_type_id ?? null,
    status_name_pt: row.status_name_pt ?? null,
    status_code: row.status_code ?? null,
    status_color_hex: row.status_color_hex ?? null,

    outcome: row.outcome ?? null,
    outcome_at: row.outcome_at ?? null,
    outcome_id: row.outcome_id ?? null,
    outcome_name: row.outcome_name ?? null,
    outcome_code: row.outcome_code ?? null,

    loss_reason_id: row.loss_reason_id ?? null,
    loss_reason_name: row.loss_reason_name ?? null,
    loss_notes: row.loss_notes ?? null,

    tag: row.tag,
    next_step: row.next_step,
    last_activity_date: row.last_activity_date,
    notes: row.notes,

    is_closed: row.is_closed ?? false,

    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeStatusTypeId(payload = {}) {
  return (
    toNumOrNull(payload.status_type_id) ??
    toNumOrNull(payload.statusTypeId) ??
    toNumOrNull(payload.statusTypeID) ??
    toNumOrNull(payload.tag_status_type_id) ??
    toNumOrNull(payload.tagStatusTypeId) ??
    null
  );
}

function normalizeLeadSourceId(payload = {}) {
  return (
    toNumOrNull(payload.lead_source_id) ??
    toNumOrNull(payload.leadSourceId) ??
    null
  );
}

function normalizeOutcomeId(payload = {}) {
  return (
    toPositiveNumOrNull(payload.outcome_id) ??
    toPositiveNumOrNull(payload.outcomeId) ??
    null
  );
}

function normalizeLossReasonId(payload = {}) {
  return (
    toPositiveNumOrNull(payload.loss_reason_id) ??
    toPositiveNumOrNull(payload.lossReasonId) ??
    null
  );
}

async function syncCustomerActivityFromOutcome({
  dealId,
  customerId,
  outcomeId,
}) {
  try {
    const dId = Number(dealId);
    const cId = Number(customerId);
    const oId = toPositiveNumOrNull(outcomeId);

    if (!Number.isFinite(dId) || !Number.isFinite(cId) || !oId) {
      console.warn('[crmDealsApi] syncCustomerActivityFromOutcome - dados inválidos', {
        dealId,
        customerId,
        outcomeId,
      });
      return;
    }

    await applyCrmOutcomeToCustomerActivity({
      customerId: cId,
      outcomeId: oId,
      dealId: dId,
    });

    console.log('[crmDealsApi] CustomerActivity atualizado via CRM', {
      dealId: dId,
      customerId: cId,
      outcomeId: oId,
    });

  } catch (e) {
    console.warn('[crmDealsApi] Falha ao sincronizar CustomerActivity:', e?.message || e);
  }
}

/* =========================================================================
 * LOOKUPS
 * ========================================================================= */
async function fetchCustomerName(customerId) {
  if (!customerId) return null;

  const attempts = [
    `SELECT nome_fantasia AS name FROM public.clientes WHERE id = $1 LIMIT 1`,
    `SELECT nome_fantasia AS name FROM public.clientes WHERE cliente_id = $1 LIMIT 1`,
    `SELECT nome_fantasia AS name FROM public.customers WHERE customer_id = $1 LIMIT 1`,
    `SELECT nome_fantasia AS name FROM public.customers WHERE cliente_id = $1 LIMIT 1`,
    `SELECT name FROM public.customers WHERE customer_id = $1 LIMIT 1`,
  ];

  for (const sql of attempts) {
    try {
      const { rows } = await pool.query(sql, [customerId]);
      if (rows[0]?.name) return rows[0].name;
    } catch (_) { }
  }

  return null;
}

async function fetchSellerName(sellerId) {
  if (!sellerId) return null;

  const sql = `
    SELECT name, nickname
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
 * SYNC: customerStatus (NOT NULL status_type_id)
 * ========================================================================= */
async function resolveCustomersCustomerId({ client, crmCustomerId }) {
  const id = Number(crmCustomerId);
  if (!Number.isFinite(id) || id <= 0) return null;

  let r = await client.query(
    `SELECT customer_id FROM public.customers WHERE customer_id = $1 LIMIT 1`,
    [id]
  );
  if (r.rowCount) return r.rows[0].customer_id;

  r = await client.query(
    `SELECT customer_id FROM public.customers WHERE cliente_id = $1 LIMIT 1`,
    [id]
  );
  if (r.rowCount) return r.rows[0].customer_id;

  return null;
}

async function upsertCustomerStatus({ client, customerId, statusTypeId, note = null, updatedBy = null }) {
  const st = Number(statusTypeId);
  if (!Number.isFinite(st)) return;
  if (!customerId) return;

  const customersCustomerId = await resolveCustomersCustomerId({
    client,
    crmCustomerId: customerId,
  });

  if (!customersCustomerId) {
    console.warn('[customerStatus] customer_id não encontrado em public.customers. crmCustomerId=', customerId);
    return;
  }

  await client.query(
    `
      INSERT INTO public."customerStatus" (customer_id, status_type_id, note, updated_at, updated_by)
      VALUES ($1, $2, $3, now(), $4)
      ON CONFLICT (customer_id)
      DO UPDATE SET
        status_type_id = EXCLUDED.status_type_id,
        note = COALESCE(EXCLUDED.note, public."customerStatus".note),
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
    `,
    [Number(customersCustomerId), st, note, updatedBy]
  );
}

function safeUpper(v) {
  return String(v || '').toUpperCase();
}

function diffFields(before = {}, after = {}, allow = []) {
  const changed = [];
  for (const k of allow) {
    const b = before?.[k];
    const a = after?.[k];
    const same =
      (b === null || b === undefined || b === '') &&
        (a === null || a === undefined || a === '')
        ? true
        : b === a;

    if (!same) changed.push(k);
  }
  return changed;
}

/* =========================================================================
 * STAGES
 * ========================================================================= */
async function listStages({ includeInactive = false } = {}) {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    const activeExpr = `COALESCE(s.is_active, TRUE)`;

    if (!includeInactive) {
      params.push(true);
      where += ` AND ${activeExpr} = $${params.length}`;
    }

    const sql = `
      SELECT
        s.id,
        COALESCE(s.code, s.stage_code) AS code,
        s.stage_name AS name,
        s.stage_name,
        s.stage_code,
        s.color,
        s.icon,
        s.sort_order,
        COALESCE(s.is_active, TRUE) AS is_active,
        s.created_at,
        s.updated_at
      FROM public."crmDealsStages" s
      ${where}
      ORDER BY ${activeExpr} DESC, s.sort_order ASC, s.id ASC
    `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows.map(mapStageRow) };
  } catch (err) {
    return buildError(err, 'crmDealsApi.listStages');
  }
}

async function getStageById(id) {
  try {
    const sql = `
      SELECT
        s.id,
        COALESCE(s.code, s.stage_code) AS code,
        s.stage_name AS name,
        s.stage_name,
        s.stage_code,
        s.color,
        s.icon,
        s.sort_order,
        COALESCE(s.is_active, TRUE) AS is_active,
        s.created_at,
        s.updated_at
      FROM public."crmDealsStages" s
      WHERE s.id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return { ok: false, error: 'STAGE_NOT_FOUND' };
    return { ok: true, data: mapStageRow(rows[0]) };
  } catch (err) {
    return buildError(err, 'crmDealsApi.getStageById');
  }
}

async function getStageByCode(code) {
  try {
    const sql = `
      SELECT
        s.id,
        COALESCE(s.code, s.stage_code) AS code,
        s.stage_name AS name,
        s.stage_name,
        s.stage_code,
        s.color,
        s.icon,
        s.sort_order,
        COALESCE(s.is_active, TRUE) AS is_active,
        s.created_at,
        s.updated_at
      FROM public."crmDealsStages" s
      WHERE UPPER(COALESCE(s.code, s.stage_code)) = UPPER($1)
    `;
    const { rows } = await pool.query(sql, [code]);
    if (!rows[0]) return { ok: false, error: 'STAGE_NOT_FOUND' };
    return { ok: true, data: mapStageRow(rows[0]) };
  } catch (err) {
    return buildError(err, 'crmDealsApi.getStageByCode');
  }
}

/* =========================================================================
 * DEALS (KANBAN mostra só ABERTOS)
 * ========================================================================= */
function normalizeSellerIdsArr(sellerIds) {
  if (!sellerIds) return null;

  const arr = Array.isArray(sellerIds) ? sellerIds : [sellerIds];
  const norm = arr
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  return norm.length ? Array.from(new Set(norm)) : null;
}

async function listDeals({ stageCode, stageId, sellerId, sellerIds, search, limit = 50, offset = 0 } = {}) {
  try {
    const params = [];
    let where = 'WHERE COALESCE(d.is_closed, FALSE) = FALSE';

    if (stageId) {
      params.push(stageId);
      where += ` AND d.stage_id = $${params.length}`;
    } else if (stageCode) {
      params.push(stageCode);
      where += ` AND UPPER(COALESCE(s.code, s.stage_code)) = UPPER($${params.length})`;
    }

    const scopeIds = normalizeSellerIdsArr(sellerIds);
    if (scopeIds?.length) {
      params.push(scopeIds);
      where += ` AND d.seller_id = ANY($${params.length})`;
    } else if (sellerId) {
      params.push(Number(sellerId));
      where += ` AND d.seller_id = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toUpperCase()}%`);
      where += ` AND (
        UPPER(COALESCE(d.customer_name, '')) LIKE $${params.length}
        OR UPPER(COALESCE(d.seller_name, '')) LIKE $${params.length}
        OR UPPER(COALESCE(ls.name, '')) LIKE $${params.length}
      )`;
    }

    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT
        d.id,
        d.stage_id,
        COALESCE(s.code, s.stage_code) AS stage_code,
        s.stage_name AS stage_name,

        d.customer_id,
        d.customer_name,

        d.seller_id,
        d.seller_name,

        d.estimated_value,

        d.lead_source_id,
        ls.name AS lead_source_name,

        d.status_type_id,
        cst.name_pt       AS status_name_pt,
        cst.internal_code AS status_code,
        cst.color_hex     AS status_color_hex,

        d.outcome,
        d.outcome_at,
        d.outcome_id,
        o.name AS outcome_name,
        o.code AS outcome_code,

        d.loss_reason_id,
        lr.reason_name AS loss_reason_name,
        d.loss_notes,

        d.tag,
        d.next_step,
        d.last_activity_date,
        d.notes,

        d.is_closed,

        d.created_at,
        d.updated_at
      FROM public."crmDeals" d
      JOIN public."crmDealsStages" s ON s.id = d.stage_id
      LEFT JOIN public."customerStatusTypes" cst ON cst.id = d.status_type_id
      LEFT JOIN public."crmLeadSources" ls ON ls.id = d.lead_source_id
      LEFT JOIN public."crmDealsOutcomes" o ON o.id = d.outcome_id
      LEFT JOIN public."crmLossReasons" lr ON lr.id = d.loss_reason_id
      ${where}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows.map(mapDealRow) };
  } catch (err) {
    return buildError(err, 'crmDealsApi.listDeals');
  }
}

async function getDealById(id) {
  try {
    const sql = `
      SELECT
        d.id,
        d.stage_id,
        COALESCE(s.code, s.stage_code) AS stage_code,
        s.stage_name AS stage_name,

        d.customer_id,
        d.customer_name,

        d.seller_id,
        d.seller_name,

        d.estimated_value,

        d.lead_source_id,
        ls.name AS lead_source_name,

        d.status_type_id,
        cst.name_pt       AS status_name_pt,
        cst.internal_code AS status_code,
        cst.color_hex     AS status_color_hex,

        d.outcome,
        d.outcome_at,
        d.outcome_id,
        o.name AS outcome_name,
        o.code AS outcome_code,

        d.loss_reason_id,
        lr.reason_name AS loss_reason_name,
        d.loss_notes,

        d.tag,
        d.next_step,
        d.last_activity_date,
        d.notes,

        d.is_closed,

        d.created_at,
        d.updated_at
      FROM public."crmDeals" d
      JOIN public."crmDealsStages" s ON s.id = d.stage_id
      LEFT JOIN public."customerStatusTypes" cst ON cst.id = d.status_type_id
      LEFT JOIN public."crmLeadSources" ls ON ls.id = d.lead_source_id
      LEFT JOIN public."crmDealsOutcomes" o ON o.id = d.outcome_id
      LEFT JOIN public."crmLossReasons" lr ON lr.id = d.loss_reason_id
      WHERE d.id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return { ok: false, error: 'DEAL_NOT_FOUND' };
    return { ok: true, data: mapDealRow(rows[0]) };
  } catch (err) {
    return buildError(err, 'crmDealsApi.getDealById');
  }
}

async function createDeal(payload = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let stageId = payload.stageId || payload.stage_id || null;
    let stageCode = payload.stageCode || payload.stage_code || null;

    if (!stageId && stageCode) {
      const stageRes = await client.query(
        `
          SELECT id, COALESCE(code, stage_code) AS code
          FROM public."crmDealsStages"
          WHERE UPPER(COALESCE(code, stage_code)) = UPPER($1)
          LIMIT 1
        `,
        [stageCode]
      );
      stageId = stageRes.rows[0]?.id || null;
      stageCode = stageRes.rows[0]?.code || stageCode;
    }

    if (!stageId) throw new Error('STAGE_REQUIRED');

    let customerName = payload.customer_name || null;
    if (!customerName && payload.customer_id) customerName = await fetchCustomerName(payload.customer_id);
    if (!customerName) customerName = 'Cliente não informado';

    let sellerName = payload.seller_name || null;
    if (!sellerName && payload.seller_id) sellerName = await fetchSellerName(payload.seller_id);

    const lastActivityDate =
      payload.last_activity_date ??
      payload.lastActivityDate ??
      payload.lastActivity ??
      payload.last_activity ??
      new Date();

    const notesValue = payload.notes ?? payload.note ?? payload.observation ?? payload.obs ?? null;

    const statusTypeId = normalizeStatusTypeId(payload);
    const leadSourceId = normalizeLeadSourceId(payload);
    const outcomeId = normalizeOutcomeId(payload);
    const lossReasonId = normalizeLossReasonId(payload);
    const lossNotes = payload.loss_notes ?? payload.lossNotes ?? null;

    const sql = `
      INSERT INTO public."crmDeals" (
        stage_id,
        customer_id,
        seller_id,
        customer_name,
        seller_name,
        estimated_value,
        lead_source_id,
        status_type_id,
        outcome_id,
        loss_reason_id,
        loss_notes,
        tag,
        next_step,
        last_activity_date,
        notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id, customer_id, status_type_id, stage_id
    `;

    const values = [
      stageId,
      payload.customer_id ?? null,
      payload.seller_id ?? null,
      customerName,
      sellerName,
      payload.estimated_value ?? null,
      leadSourceId,
      statusTypeId,
      outcomeId,
      lossReasonId,
      lossNotes,
      payload.tag ?? null,
      payload.next_step ?? null,
      lastActivityDate,
      notesValue,
    ];

    const { rows } = await client.query(sql, values);
    const newId = rows[0].id;

    await upsertCustomerStatus({
      client,
      customerId: rows[0].customer_id,
      statusTypeId: rows[0].status_type_id,
      note: notesValue,
      updatedBy: payload.updated_by ?? payload.updatedBy ?? null,
    });

    await client.query('COMMIT');

    // ✅ CORREÇÃO AQUI
    await syncCustomerActivityFromOutcome({
      dealId: newId,
      customerId: rows[0].customer_id,
      outcomeId: outcomeId,
    });

    const detail = await getDealById(newId);
    if (!detail.ok) return { ok: true, data: { id: newId } };

    try {
      await perfApi.logAction({
        action_type: 'CREATE_DEAL',
        deal_id: detail.data.id,
        stage_id: detail.data.stage_id,
        stage_code: detail.data.stage_code || stageCode || null,
        seller_id: detail.data.seller_id,
        seller_name: detail.data.seller_name,
        customer_id: detail.data.customer_id,
        customer_name: detail.data.customer_name,
        estimated_value: detail.data.estimated_value ?? null,
        details: {
          source: 'API',
          payloadKeys: Object.keys(payload || {}),
          status_type_id: detail.data.status_type_id ?? null,
          lead_source_id: detail.data.lead_source_id ?? null,
        },
      });
    } catch (e) {
      console.warn('[crmDealsApi] logAction CREATE_DEAL falhou:', e?.message || e);
    }

    return { ok: true, data: detail.data };
  } catch (err) {
    await client.query('ROLLBACK');
    return buildError(err, 'crmDealsApi.createDeal');
  } finally {
    client.release();
  }
}

async function updateDeal(id, payload = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentRes = await client.query(
      `SELECT * FROM public."crmDeals" WHERE id = $1 FOR UPDATE`,
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
          FROM public."crmDealsStages"
          WHERE UPPER(COALESCE(code, stage_code)) = UPPER($1)
          LIMIT 1
        `,
        [payload.stageCode]
      );
      stageId = stageRes.rows[0]?.id || stageId;
    }

    const customerId = payload.customer_id !== undefined ? payload.customer_id : current.customer_id;
    const sellerId = payload.seller_id !== undefined ? payload.seller_id : current.seller_id;

    let customerName = payload.customer_name !== undefined ? payload.customer_name : current.customer_name;
    let sellerName = payload.seller_name !== undefined ? payload.seller_name : current.seller_name;

    if (payload.customer_id !== undefined && !customerName) {
      customerName = await fetchCustomerName(payload.customer_id);
    }
    if (payload.seller_id !== undefined && !sellerName) {
      sellerName = await fetchSellerName(payload.seller_id);
    }

    const statusTypeTouched =
      payload.status_type_id !== undefined ||
      payload.statusTypeId !== undefined ||
      payload.tagStatusTypeId !== undefined ||
      payload.tag_status_type_id !== undefined ||
      payload.tagStatusTypeID !== undefined;

    const statusTypeId = statusTypeTouched
      ? normalizeStatusTypeId(payload)
      : (current.status_type_id ?? null);

    const leadSourceId =
      payload.lead_source_id !== undefined || payload.leadSourceId !== undefined
        ? normalizeLeadSourceId(payload)
        : (current.lead_source_id ?? null);

    const outcomeId =
      payload.outcome_id !== undefined || payload.outcomeId !== undefined
        ? normalizeOutcomeId(payload)
        : (current.outcome_id ?? null);

    const lossReasonId =
      payload.loss_reason_id !== undefined || payload.lossReasonId !== undefined
        ? normalizeLossReasonId(payload)
        : (current.loss_reason_id ?? null);

    const sql = `
      UPDATE public."crmDeals"
      SET
        stage_id           = $1,
        customer_id        = $2,
        seller_id          = $3,
        customer_name      = $4,
        seller_name        = $5,
        estimated_value    = $6,
        lead_source_id     = $7,
        status_type_id     = $8,
        outcome_id         = $9,
        loss_reason_id     = $10,
        loss_notes         = $11,
        tag                = $12,
        next_step          = $13,
        last_activity_date = $14,
        notes              = $15,
        updated_at         = now()
      WHERE id = $16
      RETURNING id, customer_id, status_type_id
    `;

    const values = [
      stageId,
      customerId,
      sellerId,
      customerName || current.customer_name,
      sellerName || current.seller_name,
      payload.estimated_value ?? current.estimated_value,
      leadSourceId,
      statusTypeId,
      outcomeId,
      lossReasonId,
      payload.loss_notes !== undefined ? payload.loss_notes : current.loss_notes,
      payload.tag !== undefined ? payload.tag : current.tag,
      payload.next_step !== undefined ? payload.next_step : current.next_step,
      payload.last_activity_date !== undefined ? payload.last_activity_date : current.last_activity_date,
      payload.notes !== undefined ? payload.notes : current.notes,
      id,
    ];

    const upd = await client.query(sql, values);
    if (!upd.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'DEAL_NOT_FOUND_AFTER_UPDATE' };
    }

    if (statusTypeTouched) {
      await upsertCustomerStatus({
        client,
        customerId: upd.rows[0].customer_id,
        statusTypeId: upd.rows[0].status_type_id,
        note: payload.notes ?? payload.note ?? null,
        updatedBy: payload.updated_by ?? payload.updatedBy ?? null,
      });
    }

    await client.query('COMMIT');

    const detail = await getDealById(id);
    if (!detail.ok) return { ok: true, data: { id } };

    try {
      const after = detail.data || {};
      const changedFields = diffFields(
        {
          stage_id: current.stage_id,
          customer_id: current.customer_id,
          seller_id: current.seller_id,
          customer_name: current.customer_name,
          seller_name: current.seller_name,
          estimated_value: current.estimated_value,
          lead_source_id: current.lead_source_id,
          status_type_id: current.status_type_id,
          outcome_id: current.outcome_id,
          loss_reason_id: current.loss_reason_id,
          loss_notes: current.loss_notes,
          tag: current.tag,
          next_step: current.next_step,
          last_activity_date: current.last_activity_date,
          notes: current.notes,
        },
        {
          stage_id: after.stage_id,
          customer_id: after.customer_id,
          seller_id: after.seller_id,
          customer_name: after.customer_name,
          seller_name: after.seller_name,
          estimated_value: after.estimated_value,
          lead_source_id: after.lead_source_id,
          status_type_id: after.status_type_id,
          outcome_id: after.outcome_id,
          loss_reason_id: after.loss_reason_id,
          loss_notes: after.loss_notes,
          tag: after.tag,
          next_step: after.next_step,
          last_activity_date: after.last_activity_date,
          notes: after.notes,
        },
        [
          'stage_id',
          'customer_id',
          'seller_id',
          'customer_name',
          'seller_name',
          'estimated_value',
          'lead_source_id',
          'status_type_id',
          'outcome_id',
          'loss_reason_id',
          'loss_notes',
          'tag',
          'next_step',
          'last_activity_date',
          'notes',
        ]
      );

      await perfApi.logAction({
        action_type: 'UPDATE_DEAL',
        deal_id: after.id,
        stage_id: after.stage_id,
        stage_code: after.stage_code || null,
        seller_id: after.seller_id,
        seller_name: after.seller_name,
        customer_id: after.customer_id,
        customer_name: after.customer_name,
        estimated_value: after.estimated_value ?? null,
        details: {
          source: 'API',
          changedFields,
          status_type_id: after.status_type_id ?? null,
          synced_customer: !!statusTypeTouched,
        },
      });
    } catch (e) {
      console.warn('[crmDealsApi] logAction UPDATE_DEAL falhou:', e?.message || e);
    }

    return { ok: true, data: detail.data };
  } catch (err) {
    await client.query('ROLLBACK');
    return buildError(err, 'crmDealsApi.updateDeal');
  } finally {
    client.release();
  }
}

async function moveDealToStage({ id, stageCode, stageId }) {
  try {
    if (!stageId && !stageCode) return { ok: false, error: 'STAGE_REQUIRED' };

    let before = null;
    try {
      const beforeRes = await pool.query(
        `
          SELECT d.id, d.stage_id, COALESCE(s.code, s.stage_code) AS stage_code, d.seller_id, d.seller_name,
                 d.customer_id, d.customer_name, d.estimated_value, d.status_type_id
          FROM public."crmDeals" d
          JOIN public."crmDealsStages" s ON s.id = d.stage_id
          WHERE d.id = $1
        `,
        [id]
      );
      before = beforeRes.rows[0] || null;
    } catch (e) {
      console.warn('[crmDealsApi] snapshot BEFORE move falhou:', e?.message || e);
    }

    if (!stageId && stageCode) {
      const { ok, data, error } = await getStageByCode(stageCode);
      if (!ok) return { ok: false, error: error || 'STAGE_NOT_FOUND' };
      stageId = data.id;
      stageCode = data.code || stageCode;
    }

    const sql = `
      UPDATE public."crmDeals"
      SET stage_id = $1, updated_at = now()
      WHERE id = $2
      RETURNING id
    `;
    const { rows } = await pool.query(sql, [stageId, id]);
    if (!rows[0]) return { ok: false, error: 'DEAL_NOT_FOUND' };

    const detail = await getDealById(id);
    if (!detail.ok) return { ok: true, data: { id } };

    try {
      const after = detail.data || {};
      await perfApi.logAction({
        action_type: 'MOVE_STAGE',
        deal_id: after.id,
        stage_id: after.stage_id,
        stage_code: after.stage_code || safeUpper(stageCode) || null,
        seller_id: after.seller_id ?? before?.seller_id ?? null,
        seller_name: after.seller_name ?? before?.seller_name ?? null,
        customer_id: after.customer_id ?? before?.customer_id ?? null,
        customer_name: after.customer_name ?? before?.customer_name ?? null,
        estimated_value: after.estimated_value ?? before?.estimated_value ?? null,
        from_stage_id: before?.stage_id ?? null,
        to_stage_id: after.stage_id ?? stageId ?? null,
        details: {
          from_stage_code: before?.stage_code || null,
          to_stage_code: after.stage_code || stageCode || null,
          source: 'KANBAN_MOVE',
          status_type_id: after.status_type_id ?? before?.status_type_id ?? null,
        },
      });
    } catch (e) {
      console.warn('[crmDealsApi] logAction MOVE_STAGE falhou:', e?.message || e);
    }

    return { ok: true, data: detail.data };
  } catch (err) {
    return buildError(err, 'crmDealsApi.moveDealToStage');
  }
}

async function deleteDeal(id) {
  try {
    let before = null;
    try {
      const beforeRes = await pool.query(
        `
          SELECT d.id, d.stage_id, COALESCE(s.code, s.stage_code) AS stage_code, d.seller_id, d.seller_name,
                 d.customer_id, d.customer_name, d.estimated_value, d.status_type_id
          FROM public."crmDeals" d
          JOIN public."crmDealsStages" s ON s.id = d.stage_id
          WHERE d.id = $1
        `,
        [id]
      );
      before = beforeRes.rows[0] || null;
    } catch (e) {
      console.warn('[crmDealsApi] snapshot BEFORE delete falhou:', e?.message || e);
    }

    const sql = `DELETE FROM public."crmDeals" WHERE id = $1 RETURNING id`;
    const { rows } = await pool.query(sql, [id]);
    if (!rows[0]) return { ok: false, error: 'DEAL_NOT_FOUND' };

    try {
      await perfApi.logAction({
        action_type: 'DELETE_DEAL',
        deal_id: id,
        stage_id: before?.stage_id ?? null,
        stage_code: before?.stage_code ?? null,
        seller_id: before?.seller_id ?? null,
        seller_name: before?.seller_name ?? null,
        customer_id: before?.customer_id ?? null,
        customer_name: before?.customer_name ?? null,
        estimated_value: before?.estimated_value ?? null,
        details: {
          source: 'API',
          status_type_id: before?.status_type_id ?? null,
        },
      });
    } catch (e) {
      console.warn('[crmDealsApi] logAction DELETE_DEAL falhou:', e?.message || e);
    }

    return { ok: true, data: { id } };
  } catch (err) {
    return buildError(err, 'crmDealsApi.deleteDeal');
  }
}

/* =========================================================================
 * CONCLUSÃO DO LEAD (DROPZONE)
 * ========================================================================= */
async function concludeLeadStatusType({ dealId, statusTypeId, note = null, userId = null }) {
  const client = await pool.connect();

  try {
    const dId = Number(dealId);
    const stId = toNumOrNull(statusTypeId);

    if (!Number.isFinite(dId)) return { ok: false, error: 'INVALID_DEAL_ID' };
    if (!Number.isFinite(stId)) return { ok: false, error: 'INVALID_STATUS_TYPE_ID' };

    await client.query('BEGIN');

    const curRes = await client.query(
      `
        SELECT id,
               stage_id,
               seller_id,
               seller_name,
               customer_id,
               customer_name,
               estimated_value,
               status_type_id,
               is_closed
        FROM public."crmDeals"
        WHERE id = $1
        FOR UPDATE
      `,
      [dId]
    );

    const cur = curRes.rows[0];
    if (!cur) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'DEAL_NOT_FOUND' };
    }

    const cols = await getCustomerStatusTypesCols();
    const activeExpr = cols.has('is_active')
      ? 'COALESCE(t.is_active, TRUE)'
      : cols.has('active')
        ? 'COALESCE(t.active, TRUE)'
        : 'TRUE';

    const chk = await client.query(
      `
        SELECT t.id
        FROM public."customerStatusTypes" t
        WHERE t.id = $1
          AND ${activeExpr} = TRUE
        LIMIT 1
      `,
      [stId]
    );

    if (!chk.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'STATUS_TYPE_NOT_FOUND' };
    }

    await client.query(
      `
        UPDATE public."crmDeals"
        SET
          status_type_id     = $2,
          is_closed          = TRUE,
          last_activity_date = now(),
          updated_at         = now()
        WHERE id = $1
      `,
      [dId, stId]
    );

    await upsertCustomerStatus({
      client,
      customerId: cur.customer_id,
      statusTypeId: stId,
      note: note || null,
      updatedBy: userId || null,
    });

    await client.query('COMMIT');

    // 🔥 TENTA MAPEAR STATUS → OUTCOME (fallback inteligente)
    try {
      let outcomeId = null;

      // tentativa simples de inferência (você pode sofisticar depois)
      if (stId === 1) outcomeId = 3; // ex: ativo → conversão
      if (stId === 2) outcomeId = 2; // ex: risco → perda
      if (stId === 3) outcomeId = 1; // ex: sem contato

      if (cur.customer_id && outcomeId) {
        await syncCustomerActivityFromOutcome({
          dealId: dId,
          customerId: cur.customer_id,
          outcomeId,
        });
      }

    } catch (e) {
      console.warn('[crmDealsApi] sync via concludeLead falhou:', e?.message || e);
    }

    try {
      await perfApi.logAction({
        action_type: 'CONCLUDE_LEAD_STATUS',
        deal_id: dId,
        stage_id: cur.stage_id ?? null,
        stage_code: null,
        seller_id: cur.seller_id ?? null,
        seller_name: cur.seller_name ?? null,
        customer_id: cur.customer_id ?? null,
        customer_name: cur.customer_name ?? null,
        estimated_value: cur.estimated_value ?? null,
        user_id: userId || null,
        details: {
          status_type_id: stId,
          note: note || null,
          source: 'KANBAN_DROPZONE',
        },
      });
    } catch (e) {
      console.warn('[crmDealsApi] logAction CONCLUDE falhou:', e?.message || e);
    }

    return {
      ok: true,
      data: { id: dId, status_type_id: stId, is_closed: true },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    return buildError(err, 'crmDealsApi.concludeLeadStatusType');
  } finally {
    client.release();
  }
}

/* =========================================================================
 * SUMMARY — Conclusão do Lead (topo)
 * ========================================================================= */
async function getLeadConclusionSummary({ sellerId, sellerIds } = {}) {
  try {
    const params = [];
    let where = `WHERE COALESCE(d.is_closed, FALSE) = TRUE AND d.status_type_id IS NOT NULL`;

    const scopeIds = normalizeSellerIdsArr(sellerIds);
    if (scopeIds?.length) {
      params.push(scopeIds);
      where += ` AND d.seller_id = ANY($${params.length})`;
    } else if (sellerId) {
      params.push(Number(sellerId));
      where += ` AND d.seller_id = $${params.length}`;
    }

    const sql = `
      SELECT
        d.status_type_id,
        COUNT(*)::int AS count_cards,
        COALESCE(SUM(COALESCE(d.estimated_value, 0)), 0) AS total_value
      FROM public."crmDeals" d
      ${where}
      GROUP BY d.status_type_id
      ORDER BY d.status_type_id ASC
    `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows || [] };
  } catch (err) {
    return buildError(err, 'crmDealsApi.getLeadConclusionSummary');
  }
}

/* =========================================================================
 * OUTCOMES
 * ========================================================================= */
function normalizeOutcomeType(outcomeType, outcomeId = null) {
  const raw = String(outcomeType || '').trim().toUpperCase();

  if (raw === 'CONVERSION' || raw === 'WON' || raw === 'VENDA') return 'CONVERSION';
  if (raw === 'LOSS' || raw === 'LOST' || raw === 'QUEDA_DE_VENDA') return 'LOSS';
  if (raw === 'NO_SUCCESS_CONTACT' || raw === 'NO_CONTACT' || raw === 'SEM_CONTATO') return 'NO_SUCCESS_CONTACT';

  if (Number(outcomeId) === 1) return 'NO_SUCCESS_CONTACT';
  if (Number(outcomeId) === 2) return 'LOSS';
  if (Number(outcomeId) === 3) return 'CONVERSION';

  return null;
}

async function registerOutcome({ dealId, outcomeType, outcomeId, note, reason, userId, lossReasonId = null }) {
  const client = await pool.connect();

  try {
    const normalizedType = normalizeOutcomeType(outcomeType, outcomeId);
    if (!normalizedType) return { ok: false, error: 'INVALID_OUTCOME_TYPE' };

    await client.query('BEGIN');

    const dealRes = await client.query(
      `
        SELECT
          d.id,
          d.stage_id,
          d.seller_id,
          d.customer_id,
          d.estimated_value,
          d.customer_name,
          d.seller_name
        FROM public."crmDeals" d
        WHERE d.id = $1
        FOR UPDATE
      `,
      [dealId]
    );

    const deal = dealRes.rows[0];
    if (!deal) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'DEAL_NOT_FOUND' };
    }

    let sellerName = deal.seller_name ?? null;
    let customerName = deal.customer_name ?? null;

    try {
      if (!sellerName && deal.seller_id) sellerName = await fetchSellerName(deal.seller_id);
      if (!customerName && deal.customer_id) customerName = await fetchCustomerName(deal.customer_id);
    } catch (_) { }

    const normalizedOutcomeId = toPositiveNumOrNull(outcomeId);
    const normalizedLossReasonId = toPositiveNumOrNull(lossReasonId);

    await client.query(
      `
    UPDATE public."crmDeals"
    SET
      is_closed          = TRUE,
      outcome            = $2,
      outcome_id         = $3,
      outcome_at         = NOW(),
      loss_reason_id     = $4,
      loss_notes         = $5,
      last_activity_date = NOW(),
      updated_at         = NOW()
    WHERE id = $1
  `,
      [
        dealId,
        normalizedType,
        normalizedOutcomeId,
        normalizedLossReasonId,
        note || null,
      ]
    );

    await client.query('COMMIT');

    await syncCustomerActivityFromOutcome({
      dealId,
      customerId: deal.customer_id,
      outcomeId: normalizedOutcomeId,
    });

    try {
      let stageCode = null;

      try {
        const st = await pool.query(
          `
        SELECT COALESCE(code, stage_code) AS code
        FROM public."crmDealsStages"
        WHERE id = $1
        LIMIT 1
      `,
          [deal.stage_id]
        );
        stageCode = st.rows[0]?.code || null;
      } catch (_) { }

      await perfApi.logAction({
        action_type: normalizedType === 'CONVERSION' ? 'OUTCOME_CONVERSION' : 'OUTCOME_LOSS',
        deal_id: dealId,
        stage_id: deal.stage_id || null,
        stage_code: stageCode || null,
        seller_id: deal.seller_id || null,
        seller_name: sellerName || null,
        customer_id: deal.customer_id || null,
        customer_name: customerName || null,
        estimated_value: deal.estimated_value ?? null,
        value_at_moment: deal.estimated_value ?? null,
        user_id: userId || null,
        details: {
          source: 'KANBAN_DROP',
          outcome_catalog_id: normalizedOutcomeId,
          outcome_type: normalizedType,
          reason: reason || null,
          note: note || null,
          loss_reason_id: normalizedLossReasonId,
        },
      });
    } catch (e) {
      console.warn('[crmDealsApi] logAction OUTCOME falhou:', e?.message || e);
    }

    return {
      ok: true,
      data: {
        deal_id: Number(dealId),
        outcome_id: normalizedOutcomeId,
        loss_reason_id: normalizedLossReasonId,
        outcome_type: normalizedType,
        is_closed: true,
        outcome_at: new Date().toISOString(),
      },
    };

  } catch (err) {
    await client.query('ROLLBACK');
    return buildError(err, 'crmDealsApi.registerOutcome');
  } finally {
    client.release();
  }
}

async function getOutcomesSummary({ sellerId, sellerIds } = {}) {
  try {
    const params = [];
    let where = `WHERE COALESCE(d.is_closed, FALSE) = TRUE`;

    const scopeIds = normalizeSellerIdsArr(sellerIds);
    if (scopeIds?.length) {
      params.push(scopeIds);
      where += ` AND d.seller_id = ANY($${params.length})`;
    } else if (sellerId) {
      params.push(Number(sellerId));
      where += ` AND d.seller_id = $${params.length}`;
    }

    const sql = `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN UPPER(COALESCE(d.outcome, '')) = 'CONVERSION' THEN COALESCE(d.estimated_value, 0)
            ELSE 0
          END
        ), 0) AS total_converted,

        COALESCE(SUM(
          CASE
            WHEN UPPER(COALESCE(d.outcome, '')) IN ('LOSS', 'LOST') THEN COALESCE(d.estimated_value, 0)
            ELSE 0
          END
        ), 0) AS total_lost,

        COALESCE(SUM(
          CASE
            WHEN UPPER(COALESCE(d.outcome, '')) = 'NO_SUCCESS_CONTACT' THEN COALESCE(d.estimated_value, 0)
            ELSE 0
          END
        ), 0) AS total_no_success_contact,

        COALESCE(SUM(
          CASE
            WHEN UPPER(COALESCE(d.outcome, '')) = 'CONVERSION' THEN 1
            ELSE 0
          END
        ), 0) AS count_converted,

        COALESCE(SUM(
          CASE
            WHEN UPPER(COALESCE(d.outcome, '')) IN ('LOSS', 'LOST') THEN 1
            ELSE 0
          END
        ), 0) AS count_lost,

        COALESCE(SUM(
          CASE
            WHEN UPPER(COALESCE(d.outcome, '')) = 'NO_SUCCESS_CONTACT' THEN 1
            ELSE 0
          END
        ), 0) AS count_no_success_contact

      FROM public."crmDeals" d
      ${where}
    `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows[0] || {} };
  } catch (err) {
    return buildError(err, 'crmDealsApi.getOutcomesSummary');
  }
}

async function listOutcomes({ outcomeType, sellerId, sellerIds, search, limit = 200, offset = 0 } = {}) {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (outcomeType) {
      params.push(String(outcomeType).trim().toUpperCase());
      where += ` AND o.outcome_type = $${params.length}`;
    }

    const scopeIds = normalizeSellerIdsArr(sellerIds);
    if (scopeIds?.length) {
      params.push(scopeIds);
      where += ` AND o.seller_id = ANY($${params.length})`;
    } else if (sellerId) {
      params.push(Number(sellerId));
      where += ` AND o.seller_id = $${params.length}`;
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim().toUpperCase()}%`);
      where += ` AND (
        UPPER(COALESCE(d.customer_name, '')) LIKE $${params.length}
        OR UPPER(COALESCE(d.seller_name, '')) LIKE $${params.length}
        OR UPPER(COALESCE(o.outcome_reason, '')) LIKE $${params.length}
        OR UPPER(COALESCE(o.note, o.notes, '')) LIKE $${params.length}
      )`;
    }

    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT
        o.id,
        o.deal_id,
        o.outcome_type,
        o.outcome_reason,
        o.note,
        o.notes,
        o.estimated_value,
        o.seller_id,
        o.customer_id,
        o.stage_id,
        o.created_by,
        o.created_at,
        d.customer_name,
        d.seller_name,
        d.tag,
        d.next_step,
        d.last_activity_date,
        COALESCE(s.code, s.stage_code) AS stage_code,
        s.stage_name AS stage_name
      FROM public."crmDealsOutcomes" o
      LEFT JOIN public."crmDeals" d ON d.id = o.deal_id
      LEFT JOIN public."crmDealsStages" s ON s.id = o.stage_id
      ${where}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const { rows } = await pool.query(sql, params);

    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        deal_id: r.deal_id,
        outcome_type: r.outcome_type,
        outcome_reason: r.outcome_reason,
        note: r.note ?? r.notes ?? null,
        value_at_moment: r.estimated_value ?? null,
        estimated_value: r.estimated_value ?? null,
        created_at: r.created_at,
        seller_id: r.seller_id ?? null,
        seller_name: r.seller_name ?? null,
        customer_id: r.customer_id ?? null,
        customer_name: r.customer_name ?? null,
        stage_id: r.stage_id ?? null,
        stage_code: r.stage_code ?? null,
        stage_name: r.stage_name ?? null,
        tag: r.tag ?? null,
        next_step: r.next_step ?? null,
        last_activity_date: r.last_activity_date ?? null,
      })),
    };
  } catch (err) {
    return buildError(err, 'crmDealsApi.listOutcomes');
  }
}

/* =========================================================================
 * STATUS TYPES
 * ========================================================================= */
async function listStatusTypes({ active = true } = {}) {
  try {
    const cols = await getCustomerStatusTypesCols();
    const has = (c) => cols.has(c);

    const codeExpr =
      has('code') ? 't.code' :
        has('internal_code') ? 't.internal_code' :
          has('status_code') ? 't.status_code' :
            has('codigo') ? 't.codigo' :
              'NULL';

    const namePtExpr =
      has('name_pt') ? 't.name_pt' :
        has('nome_pt') ? 't.nome_pt' :
          'NULL';

    const nameExpr =
      has('name') ? 't.name' :
        has('nome') ? 't.nome' :
          'NULL';

    const labelExpr =
      has('label') ? 't.label' :
        has('descricao') ? 't.descricao' :
          has('description') ? 't.description' :
            'NULL';

    const colorExpr =
      has('color_hex') ? 't.color_hex' :
        has('status_color_hex') ? 't.status_color_hex' :
          has('color') ? 't.color' :
            has('cor_hex') ? 't.cor_hex' :
              has('cor') ? 't.cor' :
                `'#64748b'`;

    const sortExpr =
      has('sort_order') ? 't.sort_order' :
        has('ordem') ? 't.ordem' :
          has('order') ? 't."order"' :
            '0';

    const activeExpr =
      has('is_active') ? 'COALESCE(t.is_active, TRUE)' :
        has('active') ? 'COALESCE(t.active, TRUE)' :
          'TRUE';

    const sql = `
      SELECT
        t.id,
        ${codeExpr} AS code,
        ${namePtExpr} AS name_pt,
        COALESCE(${namePtExpr}, ${nameExpr}, ${labelExpr}, ${codeExpr}, ('Status #' || t.id::text)) AS name,
        ${colorExpr} AS color_hex,
        COALESCE(${sortExpr}, 0) AS sort_order,
        ${activeExpr} AS is_active
      FROM public."customerStatusTypes" t
      WHERE ${activeExpr} = $1
      ORDER BY COALESCE(${sortExpr}, 0) ASC,
               COALESCE(${namePtExpr}, ${nameExpr}, ${labelExpr}, ${codeExpr}, ('Status #' || t.id::text)) ASC,
               t.id ASC
    `;

    const r = await pool.query(sql, [!!active]);
    return { ok: true, data: r.rows || [] };
  } catch (err) {
    console.error('[crmDealsApi.listStatusTypes] error:', err?.message || err);
    return { ok: false, error: err?.message || 'STATUS_TYPES_LIST_ERROR' };
  }
}

/* =========================================================================
 * LEAD SOURCES
 * ========================================================================= */
async function listLeadSources({ active = true } = {}) {
  try {
    const sql = `
      SELECT
        id,
        name,
        icon,
        color,
        sort_order,
        is_active,
        created_at
      FROM public."crmLeadSources"
      WHERE COALESCE(is_active, TRUE) = $1
      ORDER BY COALESCE(sort_order, 0) ASC, id ASC
    `;
    const { rows } = await pool.query(sql, [!!active]);
    return { ok: true, data: rows || [] };
  } catch (err) {
    return buildError(err, 'crmDealsApi.listLeadSources');
  }
}

/* =========================================================================
 * DEAL OUTCOMES CATALOG
 * ========================================================================= */
async function listDealOutcomes({ active = true } = {}) {
  try {
    const sql = `
      SELECT
        id,
        name,
        code,
        icon,
        color,
        sort_order,
        is_active,
        created_at
      FROM public."crmDealsOutcomes"
      WHERE COALESCE(is_active, TRUE) = $1
      ORDER BY COALESCE(sort_order, 0) ASC, id ASC
    `;
    const { rows } = await pool.query(sql, [!!active]);
    return { ok: true, data: rows || [] };
  } catch (err) {
    return buildError(err, 'crmDealsApi.listDealOutcomes');
  }
}

const crmDealsApi = {
  listStages,
  getStageById,
  getStageByCode,

  listDeals,
  getDealById,
  createDeal,
  updateDeal,
  moveDealToStage,
  deleteDeal,

  registerOutcome,
  getOutcomesSummary,
  listOutcomes,

  listStatusTypes,
  listLeadSources,
  listDealOutcomes,

  concludeLeadStatusType,
  getLeadConclusionSummary,
};

export default crmDealsApi;