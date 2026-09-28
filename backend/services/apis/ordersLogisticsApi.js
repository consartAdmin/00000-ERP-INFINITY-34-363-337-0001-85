// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ordersLogisticsApi.js — DAL Logística de Pedidos (CONSART ERP)      ║
// ║ ESM | PostgreSQL | Tabelas:                                         ║
// ║   • "ordersLogistics"                                               ║
// ║   • "ordersLogisticsItems"                                          ║
// ║                                                                      ║
// ║ - Controla fluxo: picking → conferência cega → embalagem → envio    ║
// ║ - Suporte a conferência cega por NF (chave) + bipagem de produtos   ║
// ║ - Helpers para itens (qty_ordered, qty_picked, qty_checked, etc.)   ║
// ║ - Alinhado aos schemas:                                             ║
// ║   • catalog_schema.ordersLogistics.js                                ║
// ║   • catalog_schema.ordersLogisticsItems.js                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ---------------------------------------------------------------------
// CREATE TABLES (idempotente)
// ---------------------------------------------------------------------
export async function ensureTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ================================================================
    // Tabela principal: "ordersLogistics"
    // ================================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS "ordersLogistics" (
        logistics_id         SERIAL PRIMARY KEY,
        order_id             INTEGER NOT NULL REFERENCES "orders"(order_id) ON DELETE CASCADE,

        -- Status geral
        status               VARCHAR(50) NOT NULL DEFAULT 'AGUARDANDO_SEPARACAO',

        -- Responsáveis
        picker_user_id       INTEGER,
        checker_user_id      INTEGER,
        packer_user_id       INTEGER,
        shipper_user_id      INTEGER,

        -- Picking
        picking_started_at   TIMESTAMP,
        picking_finished_at  TIMESTAMP,

        -- Conferência cega
        checking_started_at  TIMESTAMP,
        checking_finished_at TIMESTAMP,

        -- Embalagem
        packing_started_at   TIMESTAMP,
        packing_finished_at  TIMESTAMP,

        -- Expedição
        shipping_method      VARCHAR(50),
        shipping_code        VARCHAR(200),
        shipping_date        TIMESTAMP,
        shipping_obs         TEXT,

        -- Dados da NF (para iniciar conferência pela chave/código de barras)
        nfe_key              VARCHAR(60),
        nf_number            INTEGER,
        nf_series            VARCHAR(10),

        -- Controle conferência cega
        blind_check_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
        blind_check_status   VARCHAR(30) DEFAULT 'PENDENTE', -- PENDENTE | EM_ANDAMENTO | OK | DIVERGENCIA
        has_discrepancy      BOOLEAN DEFAULT FALSE,
        discrepancy_note     TEXT,

        -- Auditoria
        created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Índice por pedido
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_ordersLogistics_order_id'
            AND n.nspname = 'public'
        ) THEN
          CREATE INDEX idx_ordersLogistics_order_id
            ON "ordersLogistics"(order_id);
        END IF;
      END $$;
    `);

    // Índice por NF (chave)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_ordersLogistics_nfe_key'
            AND n.nspname = 'public'
        ) THEN
          CREATE INDEX idx_ordersLogistics_nfe_key
            ON "ordersLogistics"(nfe_key);
        END IF;
      END $$;
    `);

    // ================================================================
    // Tabela de itens: "ordersLogisticsItems"
    // ================================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS "ordersLogisticsItems" (
        item_log_id      SERIAL PRIMARY KEY,

        logistics_id     INTEGER NOT NULL REFERENCES "ordersLogistics"(logistics_id) ON DELETE CASCADE,
        order_item_id    INTEGER NOT NULL REFERENCES "order_items"(order_item_id) ON DELETE CASCADE,

        sku              VARCHAR(50) NOT NULL,
        product_name     TEXT NOT NULL,

        qty_ordered      NUMERIC(14,3) NOT NULL,
        qty_picked       NUMERIC(14,3) NOT NULL DEFAULT 0,
        qty_checked      NUMERIC(14,3) NOT NULL DEFAULT 0,

        discrepancy_qty  NUMERIC(14,3)
          GENERATED ALWAYS AS (qty_checked - qty_picked) STORED,

        location         VARCHAR(120),
        obs              TEXT,

        updated_at       TIMESTAMP DEFAULT NOW()
      );
    `);

    // Índice por logística
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'idx_ordersLogisticsItems_logistics_id'
            AND n.nspname = 'public'
        ) THEN
          CREATE INDEX idx_ordersLogisticsItems_logistics_id
            ON "ordersLogisticsItems"(logistics_id);
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ordersLogisticsApi.ensureTables] erro ao garantir tabelas:', err);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// SELECT base
// ---------------------------------------------------------------------

const BASE_SELECT_LOGISTICS = `
  SELECT
    logistics_id,
    order_id,
    status,
    picker_user_id,
    checker_user_id,
    packer_user_id,
    shipper_user_id,
    picking_started_at,
    picking_finished_at,
    checking_started_at,
    checking_finished_at,
    packing_started_at,
    packing_finished_at,
    shipping_method,
    shipping_code,
    shipping_date,
    shipping_obs,
    nfe_key,
    nf_number,
    nf_series,
    blind_check_enabled,
    blind_check_status,
    has_discrepancy,
    discrepancy_note,
    created_at,
    updated_at
  FROM "ordersLogistics"
`;

const BASE_SELECT_ITEMS = `
  SELECT
    item_log_id,
    logistics_id,
    order_item_id,
    sku,
    product_name,
    qty_ordered,
    qty_picked,
    qty_checked,
    discrepancy_qty,
    location,
    obs,
    updated_at
  FROM "ordersLogisticsItems"
`;

// ---------------------------------------------------------------------
// HELPERS: LOGISTICS HEADER
// ---------------------------------------------------------------------

/**
 * Retorna o registro de logística por ID.
 */
export async function getLogisticsById(logistics_id) {
  const sql = `
    ${BASE_SELECT_LOGISTICS}
    WHERE logistics_id = $1;
  `;
  const { rows } = await pool.query(sql, [logistics_id]);
  return rows[0] || null;
}

/**
 * Retorna a logística vinculada a um pedido.
 * Se houver mais de uma (não deveria), devolve a mais recente.
 */
export async function getLogisticsByOrderId(order_id) {
  const sql = `
    ${BASE_SELECT_LOGISTICS}
    WHERE order_id = $1
    ORDER BY created_at DESC, logistics_id DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [order_id]);
  return rows[0] || null;
}

/**
 * Cria um registro de logística vinculado ao pedido.
 */
export async function createLogisticsForOrder({
  order_id,
  status = 'AGUARDANDO_SEPARACAO',
  nfe_key = null,
  nf_number = null,
  nf_series = null
}) {
  const sql = `
    INSERT INTO "ordersLogistics" (
      order_id,
      status,
      nfe_key,
      nf_number,
      nf_series,
      created_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
    RETURNING
      logistics_id,
      order_id,
      status,
      picker_user_id,
      checker_user_id,
      packer_user_id,
      shipper_user_id,
      picking_started_at,
      picking_finished_at,
      checking_started_at,
      checking_finished_at,
      packing_started_at,
      packing_finished_at,
      shipping_method,
      shipping_code,
      shipping_date,
      shipping_obs,
      nfe_key,
      nf_number,
      nf_series,
      blind_check_enabled,
      blind_check_status,
      has_discrepancy,
      discrepancy_note,
      created_at,
      updated_at;
  `;
  const params = [order_id, status, nfe_key, nf_number, nf_series];
  const { rows } = await pool.query(sql, params);
  return rows[0];
}

/**
 * Busca ou cria a logística para um pedido.
 */
export async function getOrCreateLogisticsForOrder(order_id, { nfe_key = null, nf_number = null, nf_series = null } = {}) {
  const existing = await getLogisticsByOrderId(order_id);
  if (existing) return existing;

  return createLogisticsForOrder({
    order_id,
    status: 'AGUARDANDO_SEPARACAO',
    nfe_key,
    nf_number,
    nf_series
  });
}

/**
 * Atualiza status e data/hora de uma etapa simples.
 */
export async function updateLogisticsStatus(logistics_id, status, extraFields = {}) {
  const allowedFields = [
    'picker_user_id',
    'checker_user_id',
    'packer_user_id',
    'shipper_user_id',
    'picking_started_at',
    'picking_finished_at',
    'checking_started_at',
    'checking_finished_at',
    'packing_started_at',
    'packing_finished_at',
    'shipping_method',
    'shipping_code',
    'shipping_date',
    'shipping_obs',
    'blind_check_enabled',
    'blind_check_status',
    'has_discrepancy',
    'discrepancy_note',
    'nfe_key',
    'nf_number',
    'nf_series'
  ];

  const sets = ['status = $1', 'updated_at = NOW()'];
  const values = [status];
  let idx = 2;

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(extraFields, field)) {
      sets.push(`"${field}" = $${idx++}`);
      values.push(extraFields[field]);
    }
  }

  values.push(logistics_id);

  const sql = `
    UPDATE "ordersLogistics"
       SET ${sets.join(', ')}
     WHERE logistics_id = $${idx}
    RETURNING
      logistics_id,
      order_id,
      status,
      picker_user_id,
      checker_user_id,
      packer_user_id,
      shipper_user_id,
      picking_started_at,
      picking_finished_at,
      checking_started_at,
      checking_finished_at,
      packing_started_at,
      packing_finished_at,
      shipping_method,
      shipping_code,
      shipping_date,
      shipping_obs,
      nfe_key,
      nf_number,
      nf_series,
      blind_check_enabled,
      blind_check_status,
      has_discrepancy,
      discrepancy_note,
      created_at,
      updated_at;
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

/**
 * Lista processos logísticos por status (ex.: AGUARDANDO_SEPARACAO).
 */
export async function listLogisticsByStatus(status) {
  const sql = `
    ${BASE_SELECT_LOGISTICS}
    WHERE status = $1
    ORDER BY created_at DESC, logistics_id DESC;
  `;
  const { rows } = await pool.query(sql, [status]);
  return rows;
}

/**
 * Lista todos (opcionalmente apenas "abertos").
 */
export async function listAllLogistics({ onlyOpen = false } = {}) {
  let where = 'WHERE 1=1';

  if (onlyOpen) {
    where += ` AND status NOT IN ('ENTREGUE', 'CANCELADO')`;
  }

  const sql = `
    ${BASE_SELECT_LOGISTICS}
    ${where}
    ORDER BY created_at DESC, logistics_id DESC;
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

// ---------------------------------------------------------------------
// HELPERS: ITEMS
// ---------------------------------------------------------------------

/**
 * Lista itens de logística por logistics_id.
 */
export async function listItemsByLogisticsId(logistics_id) {
  const sql = `
    ${BASE_SELECT_ITEMS}
    WHERE logistics_id = $1
    ORDER BY item_log_id ASC;
  `;
  const { rows } = await pool.query(sql, [logistics_id]);
  return rows;
}

/**
 * Busca item de logística por logistics_id + order_item_id.
 */
export async function getItem(logistics_id, order_item_id) {
  const sql = `
    ${BASE_SELECT_ITEMS}
    WHERE logistics_id = $1
      AND order_item_id = $2;
  `;
  const { rows } = await pool.query(sql, [logistics_id, order_item_id]);
  return rows[0] || null;
}

/**
 * Cria item logístico vinculado ao item do pedido.
 */
export async function createItem({
  logistics_id,
  order_item_id,
  sku,
  product_name,
  qty_ordered,
  qty_picked = 0,
  qty_checked = 0,
  location = null,
  obs = null
}) {
  const sql = `
    INSERT INTO "ordersLogisticsItems" (
      logistics_id,
      order_item_id,
      sku,
      product_name,
      qty_ordered,
      qty_picked,
      qty_checked,
      location,
      obs,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    RETURNING
      item_log_id,
      logistics_id,
      order_item_id,
      sku,
      product_name,
      qty_ordered,
      qty_picked,
      qty_checked,
      discrepancy_qty,
      location,
      obs,
      updated_at;
  `;
  const params = [
    logistics_id,
    order_item_id,
    sku,
    product_name,
    qty_ordered,
    qty_picked,
    qty_checked,
    location,
    obs
  ];

  const { rows } = await pool.query(sql, params);
  return rows[0];
}

/**
 * Garante que exista um item para o par logistics_id + order_item_id.
 * Se não existir, cria. Se existir, devolve.
 */
export async function getOrCreateItem({
  logistics_id,
  order_item_id,
  sku,
  product_name,
  qty_ordered,
  qty_picked = 0,
  location = null,
  obs = null
}) {
  const existing = await getItem(logistics_id, order_item_id);
  if (existing) return existing;

  return createItem({
    logistics_id,
    order_item_id,
    sku,
    product_name,
    qty_ordered,
    qty_picked,
    qty_checked: 0,
    location,
    obs
  });
}

/**
 * Incrementa quantidade separada (picking).
 */
export async function incrementPickedQty(logistics_id, order_item_id, deltaQty) {
  const sql = `
    UPDATE "ordersLogisticsItems"
       SET qty_picked = qty_picked + $3,
           updated_at = NOW()
     WHERE logistics_id = $1
       AND order_item_id = $2
    RETURNING
      item_log_id,
      logistics_id,
      order_item_id,
      sku,
      product_name,
      qty_ordered,
      qty_picked,
      qty_checked,
      discrepancy_qty,
      location,
      obs,
      updated_at;
  `;
  const { rows } = await pool.query(sql, [logistics_id, order_item_id, deltaQty]);
  return rows[0] || null;
}

/**
 * Incrementa quantidade conferida (conferência cega).
 * Ideal para uso a cada bip de produto.
 */
export async function incrementCheckedQty(logistics_id, order_item_id, deltaQty) {
  const sql = `
    UPDATE "ordersLogisticsItems"
       SET qty_checked = qty_checked + $3,
           updated_at = NOW()
     WHERE logistics_id = $1
       AND order_item_id = $2
    RETURNING
      item_log_id,
      logistics_id,
      order_item_id,
      sku,
      product_name,
      qty_ordered,
      qty_picked,
      qty_checked,
      discrepancy_qty,
      location,
      obs,
      updated_at;
  `;
  const { rows } = await pool.query(sql, [logistics_id, order_item_id, deltaQty]);
  return rows[0] || null;
}

/**
 * Atualiza campos livres de um item.
 */
export async function updateItem(item_log_id, fields = {}) {
  const allowedFields = [
    'qty_ordered',
    'qty_picked',
    'qty_checked',
    'location',
    'obs'
  ];

  const sets = [];
  const values = [];
  let idx = 1;

  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`"${key}" = $${idx++}`);
      values.push(fields[key]);
    }
  }

  if (sets.length === 0) {
    return getItemById(item_log_id);
  }

  sets.push('updated_at = NOW()');
  values.push(item_log_id);

  const sql = `
    UPDATE "ordersLogisticsItems"
       SET ${sets.join(', ')}
     WHERE item_log_id = $${idx}
    RETURNING
      item_log_id,
      logistics_id,
      order_item_id,
      sku,
      product_name,
      qty_ordered,
      qty_picked,
      qty_checked,
      discrepancy_qty,
      location,
      obs,
      updated_at;
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

/**
 * Busca item por ID.
 */
export async function getItemById(item_log_id) {
  const sql = `
    ${BASE_SELECT_ITEMS}
    WHERE item_log_id = $1;
  `;
  const { rows } = await pool.query(sql, [item_log_id]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Conferência Cega — helpers de status
// ---------------------------------------------------------------------

/**
 * Marca conferência cega como iniciada.
 */
export async function markBlindCheckStarted(logistics_id, checker_user_id = null) {
  return updateLogisticsStatus(logistics_id, 'CONFERENCIA_INICIADA', {
    checker_user_id: checker_user_id ?? undefined,
    checking_started_at: new Date(),
    blind_check_status: 'EM_ANDAMENTO'
  });
}

/**
 * Finaliza conferência cega e atualiza status com base em divergências.
 * (Aqui só marca flags; a lógica de "se tem divergência ou não" pode ser
 * calculada no controller, passando has_discrepancy / discrepancy_note).
 */
export async function finalizeBlindCheck(logistics_id, { has_discrepancy = false, discrepancy_note = null } = {}) {
  const blind_check_status = has_discrepancy ? 'DIVERGENCIA' : 'OK';

  return updateLogisticsStatus(logistics_id, 'CONFERENCIA_CONCLUIDA', {
    checking_finished_at: new Date(),
    blind_check_status,
    has_discrepancy,
    discrepancy_note
  });
}

// ---------------------------------------------------------------------
// Export default — bundle estilo service
// ---------------------------------------------------------------------

const ordersLogisticsApi = {
  ensureTables,

  // header
  getLogisticsById,
  getLogisticsByOrderId,
  createLogisticsForOrder,
  getOrCreateLogisticsForOrder,
  updateLogisticsStatus,
  listLogisticsByStatus,
  listAllLogistics,

  // items
  listItemsByLogisticsId,
  getItem,
  createItem,
  getOrCreateItem,
  incrementPickedQty,
  incrementCheckedQty,
  updateItem,
  getItemById,

  // blind check helpers
  markBlindCheckStarted,
  finalizeBlindCheck
};

export default ordersLogisticsApi;
