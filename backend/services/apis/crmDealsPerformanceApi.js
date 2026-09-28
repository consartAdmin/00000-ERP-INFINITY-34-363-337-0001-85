// ╔══════════════════════════════════════════════════════════════════════╗
// ║ crmDealsReativationPerformanceApi.js — Sales Performance (CRM)       ║
// ║ CONSART ERP | ESM                                                    ║
// ║                                                                      ║
// ║ Tabela: public."crmDealsReativationActions"                           ║
// ║ - Registra eventos por ação do vendedor                              ║
// ║ - Lista eventos com filtros                                          ║
// ║ - Resumo (indicadores) por vendedor/período                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TABLE = 'public."crmDealsReativationActions"';

function buildError(err, context = 'crmDealsPerformanceApi') {
  console.error(`[${context}]`, err);
  return { ok: false, error: err?.message || String(err) };
}

async function ensureTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id              BIGSERIAL PRIMARY KEY,
        deal_id         BIGINT NULL,
        stage_id        BIGINT NULL,
        stage_code      TEXT NULL,
        seller_id       BIGINT NULL,
        seller_name     TEXT NULL,
        user_id         BIGINT NULL,
        customer_id     BIGINT NULL,
        customer_name   TEXT NULL,
        action_type     TEXT NOT NULL,
        from_stage_id   BIGINT NULL,
        to_stage_id     BIGINT NULL,
        estimated_value NUMERIC(18,2) NULL,
        value_at_moment NUMERIC(18,2) NULL,
        details         JSONB NULL,
        ip              TEXT NULL,
        user_agent      TEXT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_crmReatActions_created_at
        ON ${TABLE}(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_crmReatActions_seller_created
        ON ${TABLE}(seller_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_crmReatActions_deal_created
        ON ${TABLE}(deal_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_crmReatActions_action_type
        ON ${TABLE}(action_type);

      CREATE INDEX IF NOT EXISTS idx_crmReatActions_details_gin
        ON ${TABLE} USING GIN (details);
    `;
    await pool.query(sql);
    return { ok: true };
  } catch (err) {
    return buildError(err, 'crmDealsReativationPerformanceApi.ensureTable');
  }
}

/**
 * Registra um evento (ação).
 * Dica: você chama isso dentro do seu crmDealsReativationApi.js (create/update/move/outcome/delete).
 */
async function logAction(payload = {}) {
  try {
    const sql = `
      INSERT INTO ${TABLE} (
        deal_id, stage_id, stage_code,
        seller_id, seller_name, user_id,
        customer_id, customer_name,
        action_type,
        from_stage_id, to_stage_id,
        estimated_value, value_at_moment,
        details, ip, user_agent
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,
        $7,$8,
        $9,
        $10,$11,
        $12,$13,
        $14,$15,$16
      )
      RETURNING id, created_at
    `;

    const values = [
      payload.deal_id ?? payload.dealId ?? null,
      payload.stage_id ?? payload.stageId ?? null,
      payload.stage_code ?? payload.stageCode ?? null,

      payload.seller_id ?? payload.sellerId ?? null,
      payload.seller_name ?? payload.sellerName ?? null,
      payload.user_id ?? payload.userId ?? null,

      payload.customer_id ?? payload.customerId ?? null,
      payload.customer_name ?? payload.customerName ?? null,

      String(payload.action_type || payload.actionType || '').toUpperCase(),

      payload.from_stage_id ?? payload.fromStageId ?? null,
      payload.to_stage_id ?? payload.toStageId ?? null,

      payload.estimated_value ?? payload.estimatedValue ?? null,
      payload.value_at_moment ?? payload.valueAtMoment ?? null,

      payload.details ?? null,
      payload.ip ?? null,
      payload.user_agent ?? payload.userAgent ?? null,
    ];

    if (!values[8]) return { ok: false, error: 'ACTION_TYPE_REQUIRED' };

    const { rows } = await pool.query(sql, values);
    return { ok: true, data: rows[0] };
  } catch (err) {
    return buildError(err, 'crmDealsReativationPerformanceApi.logAction');
  }
}

/** Lista ações com filtros */
async function listActions({
  sellerId,
  dealId,
  actionType,
  startDate,
  endDate,
  limit = 200,
  offset = 0,
} = {}) {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (sellerId) {
      params.push(sellerId);
      where += ` AND seller_id = $${params.length}`;
    }
    if (dealId) {
      params.push(dealId);
      where += ` AND deal_id = $${params.length}`;
    }
    if (actionType) {
      params.push(String(actionType).toUpperCase());
      where += ` AND action_type = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      where += ` AND created_at::date >= $${params.length}::date`;
    }
    if (endDate) {
      params.push(endDate);
      where += ` AND created_at::date <= $${params.length}::date`;
    }

    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT
        id, deal_id, stage_id, stage_code,
        seller_id, seller_name, user_id,
        customer_id, customer_name,
        action_type, from_stage_id, to_stage_id,
        estimated_value, value_at_moment,
        details, ip, user_agent,
        created_at
      FROM ${TABLE}
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows };
  } catch (err) {
    return buildError(err, 'crmDealsReativationPerformanceApi.listActions');
  }
}

/**
 * Resumo estilo "salesPerformance" por vendedor
 * - quantidade de ações
 * - quantos moves
 * - conversões e perdas
 * - soma de valores convertidos/perdidos
 */
async function getSellerPerformance({
  sellerId,
  startDate,
  endDate,
} = {}) {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (sellerId) {
      params.push(sellerId);
      where += ` AND seller_id = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      where += ` AND created_at::date >= $${params.length}::date`;
    }
    if (endDate) {
      params.push(endDate);
      where += ` AND created_at::date <= $${params.length}::date`;
    }

    const sql = `
      SELECT
        seller_id,
        COALESCE(MAX(seller_name), '—') AS seller_name,

        COUNT(*) AS actions_total,

        COALESCE(SUM(CASE WHEN action_type='CREATE_DEAL' THEN 1 ELSE 0 END),0) AS created_cards,
        COALESCE(SUM(CASE WHEN action_type='UPDATE_DEAL' THEN 1 ELSE 0 END),0) AS updates,
        COALESCE(SUM(CASE WHEN action_type='MOVE_STAGE' THEN 1 ELSE 0 END),0) AS moves,

        COALESCE(SUM(CASE WHEN action_type='OUTCOME_CONVERSION' THEN 1 ELSE 0 END),0) AS conversions_count,
        COALESCE(SUM(CASE WHEN action_type='OUTCOME_LOSS' THEN 1 ELSE 0 END),0) AS losses_count,

        COALESCE(SUM(CASE WHEN action_type='OUTCOME_CONVERSION'
          THEN COALESCE(value_at_moment, estimated_value, 0) ELSE 0 END),0) AS conversions_value,

        COALESCE(SUM(CASE WHEN action_type='OUTCOME_LOSS'
          THEN COALESCE(value_at_moment, estimated_value, 0) ELSE 0 END),0) AS losses_value

      FROM ${TABLE}
      ${where}
      GROUP BY seller_id
      ORDER BY conversions_value DESC, conversions_count DESC, actions_total DESC
    `;

    const { rows } = await pool.query(sql, params);
    return { ok: true, data: rows };
  } catch (err) {
    return buildError(err, 'crmDealsReativationPerformanceApi.getSellerPerformance');
  }
}

const crmDealsReativationPerformanceApi = {
  ensureTable,
  logAction,
  listActions,
  getSellerPerformance,
};

export default crmDealsReativationPerformanceApi;
