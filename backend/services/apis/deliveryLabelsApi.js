// ╔══════════════════════════════════════════════════════════════╗
// ║ deliveryLabelsApi.js — API de Etiquetas de Entrega          ║
// ║ CONSART ERP | ESM                                           ║
// ╚══════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

function normalizeText(value) {
  return value === undefined || value === null ? null : String(value).trim();
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function createDeliveryLabel(data = {}) {
  const volumes = Math.max(1, Number(data.volumes || 1));

  const sql = `
    INSERT INTO public."deliveryLabels" (
      order_id,
      invoice_id,
      nfe_key,
      nfe_number,
      order_number,
      customer_name,
      customer_tax_id,
      phone,
      address,
      number,
      complement,
      neighborhood,
      city,
      state,
      zip_code,
      volumes,
      weight,
      delivery_status,
      driver_name,
      route_name,
      notes
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
    )
    RETURNING *
  `;

  const params = [
    normalizeNumber(data.order_id),
    normalizeNumber(data.invoice_id),
    normalizeText(data.nfe_key),
    normalizeText(data.nfe_number),
    normalizeText(data.order_number),
    normalizeText(data.customer_name),
    normalizeText(data.customer_tax_id),
    normalizeText(data.phone),
    normalizeText(data.address),
    normalizeText(data.number),
    normalizeText(data.complement),
    normalizeText(data.neighborhood),
    normalizeText(data.city),
    normalizeText(data.state),
    normalizeText(data.zip_code),
    volumes,
    normalizeNumber(data.weight),
    normalizeText(data.delivery_status) || 'AGUARDANDO_SEPARACAO',
    normalizeText(data.driver_name),
    normalizeText(data.route_name),
    normalizeText(data.notes),
  ];

  const { rows } = await pool.query(sql, params);
  return rows[0];
}

export async function listDeliveryLabels(filters = {}) {
  const where = [];
  const params = [];

  if (filters.q) {
    params.push(`%${String(filters.q).trim()}%`);
    where.push(`(
      customer_name ILIKE $${params.length}
      OR customer_tax_id ILIKE $${params.length}
      OR order_number ILIKE $${params.length}
      OR nfe_number ILIKE $${params.length}
      OR city ILIKE $${params.length}
    )`);
  }

  if (filters.status) {
    params.push(String(filters.status).trim());
    where.push(`delivery_status = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(1, Number(filters.limit) || 100), 500);
  const page = Math.max(1, Number(filters.page) || 1);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM public."deliveryLabels" ${whereSql}`,
    params
  );

  const sql = `
    SELECT *
    FROM public."deliveryLabels"
    ${whereSql}
    ORDER BY created_at DESC, delivery_label_id DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const { rows } = await pool.query(sql, [...params, limit, (page - 1) * limit]);

  return { rows, total: countRows[0]?.total ?? rows.length, page, limit };
}

export async function getDeliveryLabelById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM public."deliveryLabels" WHERE delivery_label_id = $1`,
    [id]
  );

  return rows[0] || null;
}

export async function updateDeliveryLabel(id, data = {}) {
  const sql = `
    UPDATE public."deliveryLabels"
    SET
      nfe_key = COALESCE($2, nfe_key),
      nfe_number = COALESCE($3, nfe_number),
      order_number = COALESCE($4, order_number),
      customer_name = COALESCE($5, customer_name),
      customer_tax_id = COALESCE($6, customer_tax_id),
      phone = COALESCE($7, phone),
      address = COALESCE($8, address),
      number = COALESCE($9, number),
      complement = COALESCE($10, complement),
      neighborhood = COALESCE($11, neighborhood),
      city = COALESCE($12, city),
      state = COALESCE($13, state),
      zip_code = COALESCE($14, zip_code),
      volumes = COALESCE($15, volumes),
      weight = COALESCE($16, weight),
      delivery_status = COALESCE($17, delivery_status),
      driver_name = COALESCE($18, driver_name),
      route_name = COALESCE($19, route_name),
      notes = COALESCE($20, notes),
      updated_at = NOW()
    WHERE delivery_label_id = $1
    RETURNING *
  `;

  const params = [
    id,
    normalizeText(data.nfe_key),
    normalizeText(data.nfe_number),
    normalizeText(data.order_number),
    normalizeText(data.customer_name),
    normalizeText(data.customer_tax_id),
    normalizeText(data.phone),
    normalizeText(data.address),
    normalizeText(data.number),
    normalizeText(data.complement),
    normalizeText(data.neighborhood),
    normalizeText(data.city),
    normalizeText(data.state),
    normalizeText(data.zip_code),
    data.volumes ? Number(data.volumes) : null,
    normalizeNumber(data.weight),
    normalizeText(data.delivery_status),
    normalizeText(data.driver_name),
    normalizeText(data.route_name),
    normalizeText(data.notes),
  ];

  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

export async function deleteDeliveryLabel(id) {
  const { rowCount } = await pool.query(
    `DELETE FROM public."deliveryLabels" WHERE delivery_label_id = $1`,
    [id]
  );

  return rowCount > 0;
}

/* ──────────────────────────────────────────────────────────
   Importação a partir de Pedido, Orçamento e Nota Fiscal emitida
   (endereço sempre vem do cadastro do cliente)
────────────────────────────────────────────────────────── */

const CUSTOMER_ADDRESS_COLUMNS = `
  COALESCE(c.mobile_number, c.phone_number) AS phone,
  CONCAT_WS(' ', NULLIF(c.street_type, ''), NULLIF(c.street_name, '')) AS address,
  c.street_number AS number,
  c.address_complement AS complement,
  c.neighborhood,
  c.city,
  c.state,
  c.postal_code AS zip_code
`;

function addressFields(row) {
  return {
    phone: row.phone,
    address: row.address,
    number: row.number,
    complement: row.complement,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
  };
}

export async function createFromOrder(orderId) {
  // orders não possui número/NF-e próprios: o nº do pedido é o order_id e a NF-e vem de invoicesIssued
  const { rows } = await pool.query(
    `
      SELECT
        o.order_id,
        COALESCE(NULLIF(o.customer_name, ''), c.legal_name, c.trade_name) AS customer_name,
        COALESCE(NULLIF(o.customer_tax_id, ''), c.tax_id) AS customer_tax_id,
        ${CUSTOMER_ADDRESS_COLUMNS},
        o.customer_phone,
        inv.invoice_id,
        inv.nfe_number,
        inv.nfe_key
      FROM public.orders o
      LEFT JOIN public.customers c
        ON c.customer_id = o.customer_id
      -- NF-e mais recente emitida para o pedido (se houver)
      LEFT JOIN LATERAL (
        SELECT i.invoice_id, i.nfe_number, i.nfe_key
        FROM public."invoicesIssued" i
        WHERE i.order_id = o.order_id
        ORDER BY i.invoice_id DESC
        LIMIT 1
      ) inv ON TRUE
      WHERE o.order_id = $1
      LIMIT 1
    `,
    [orderId]
  );

  const order = rows[0];

  if (!order) {
    throw new Error('Pedido não encontrado.');
  }

  return createDeliveryLabel({
    order_id: order.order_id,
    invoice_id: order.invoice_id,
    order_number: String(order.order_id),
    nfe_number: order.nfe_number,
    nfe_key: order.nfe_key,
    customer_name: order.customer_name,
    customer_tax_id: order.customer_tax_id,
    ...addressFields(order),
    phone: order.phone || order.customer_phone,
    volumes: 1,
  });
}

export async function createFromBudget(budgetId) {
  const { rows } = await pool.query(
    `
      SELECT
        b.budget_id,
        COALESCE(NULLIF(b.customer_name, ''), c.legal_name, c.trade_name) AS customer_name,
        COALESCE(NULLIF(b.customer_tax_id, ''), c.tax_id) AS customer_tax_id,
        ${CUSTOMER_ADDRESS_COLUMNS},
        b.customer_phone,
        inv.invoice_id,
        inv.nfe_number,
        inv.nfe_key
      FROM public.budgets b
      LEFT JOIN public.customers c
        ON c.customer_id = b.customer_id
      -- NF-e mais recente emitida para o orçamento (se houver)
      LEFT JOIN LATERAL (
        SELECT i.invoice_id, i.nfe_number, i.nfe_key
        FROM public."invoicesIssued" i
        WHERE i.budget_id = b.budget_id
        ORDER BY i.invoice_id DESC
        LIMIT 1
      ) inv ON TRUE
      WHERE b.budget_id = $1
      LIMIT 1
    `,
    [budgetId]
  );

  const budget = rows[0];

  if (!budget) {
    throw new Error('Orçamento não encontrado.');
  }

  return createDeliveryLabel({
    invoice_id: budget.invoice_id,
    order_number: `ORC ${budget.budget_id}`,
    nfe_number: budget.nfe_number,
    nfe_key: budget.nfe_key,
    customer_name: budget.customer_name,
    customer_tax_id: budget.customer_tax_id,
    ...addressFields(budget),
    phone: budget.phone || budget.customer_phone,
    notes: `Importado do orçamento #${budget.budget_id}`,
    volumes: 1,
  });
}

export async function createFromInvoice(invoiceId) {
  const { rows } = await pool.query(
    `
      SELECT
        i.invoice_id,
        i.order_id,
        i.budget_id,
        i.nfe_number,
        i.nfe_key,
        COALESCE(
          NULLIF(i.customer_name, ''), NULLIF(o.customer_name, ''),
          NULLIF(b.customer_name, ''), c.legal_name, c.trade_name
        ) AS customer_name,
        COALESCE(
          NULLIF(i.customer_tax_id, ''), NULLIF(o.customer_tax_id, ''),
          NULLIF(b.customer_tax_id, ''), c.tax_id
        ) AS customer_tax_id,
        ${CUSTOMER_ADDRESS_COLUMNS}
      FROM public."invoicesIssued" i
      LEFT JOIN public.orders o
        ON o.order_id = i.order_id
      LEFT JOIN public.budgets b
        ON b.budget_id = i.budget_id
      -- cliente: do pedido; se a nota veio de orçamento, do orçamento
      LEFT JOIN public.customers c
        ON c.customer_id = COALESCE(o.customer_id, b.customer_id)
      WHERE i.invoice_id = $1
      LIMIT 1
    `,
    [invoiceId]
  );

  const invoice = rows[0];

  if (!invoice) {
    throw new Error('Nota fiscal não encontrada.');
  }

  const orderNumber = invoice.order_id
    ? String(invoice.order_id)
    : (invoice.budget_id ? `ORC ${invoice.budget_id}` : null);

  return createDeliveryLabel({
    order_id: invoice.order_id,
    invoice_id: invoice.invoice_id,
    order_number: orderNumber,
    nfe_number: invoice.nfe_number,
    nfe_key: invoice.nfe_key,
    customer_name: invoice.customer_name,
    customer_tax_id: invoice.customer_tax_id,
    ...addressFields(invoice),
    notes: `Importado da NF-e ${invoice.nfe_number ?? `#${invoice.invoice_id}`}`,
    volumes: 1,
  });
}
