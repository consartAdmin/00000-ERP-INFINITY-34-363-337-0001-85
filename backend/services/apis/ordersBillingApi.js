// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ordersBillingApi.js — DAL de Cobranças de Pedidos (CONSART ERP)     ║
// ║ Tabela: public."ordersBilling"                                       ║
// ║ Funções:                                                             ║
// ║   - ensureTable                                                      ║
// ║   - createFromAsaasCharge                                            ║
// ║   - listByOrder                                                      ║
// ║   - listByProviderId                                                 ║
// ║   - updateStatusByProviderId                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."ordersBilling"';

// ---------------------------------------------------------------------
// Helper: normaliza data (string/Date/null) para 'YYYY-MM-DD' ou null
// ---------------------------------------------------------------------
function normalizeDateToYMD(value) {
  if (!value) return null;

  // Se já vier como string "YYYY-MM-DD..." → corta
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  // Se for Date
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  // Tentativa genérica
  try {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  } catch (_) {
    // ignora
  }

  return null;
}

// ---------------------------------------------------------------------
// CREATE TABLE (idempotente)
// ---------------------------------------------------------------------
export async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TB} (
        orders_billing_id   SERIAL PRIMARY KEY,
        order_id            INTEGER NOT NULL
                            REFERENCES public.orders (id) ON DELETE CASCADE,
        billing_source      VARCHAR(40) NOT NULL DEFAULT 'ASAAS',
        billing_type        VARCHAR(40) NOT NULL,
        provider_payment_id VARCHAR(100),
        external_reference  VARCHAR(255),
        amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
        due_date            DATE,
        paid_date           DATE,
        status              VARCHAR(40) NOT NULL DEFAULT 'PENDING',
        status_details      TEXT,
        bank_slip_url       TEXT,
        bank_slip_pdf_url   TEXT,
        nosso_numero        VARCHAR(100),
        installment_number  INTEGER,
        installments_total  INTEGER,
        metadata            JSONB,
        created_at          TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        updated_at          TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ordersbilling_order
        ON ${TB} (order_id);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ordersbilling_order_provider
        ON ${TB} (order_id, billing_source, provider_payment_id)
        WHERE provider_payment_id IS NOT NULL;
    `);

    // index auxiliar para webhooks / consultas por id do Asaas
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ordersbilling_provider
        ON ${TB} (provider_payment_id);
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ordersBillingApi.ensureTable] EXC:', err);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// createFromAsaasCharge — cria registro a partir do retorno do Asaas
// ---------------------------------------------------------------------
export async function createFromAsaasCharge(orderId, charge) {
  if (!orderId || !charge) {
    throw new Error('[ordersBillingApi] orderId e charge são obrigatórios');
  }

  const {
    id: provider_payment_id,
    billingType,
    value,
    dueDate,
    paymentDate,
    status,
    bankSlipUrl,
    bankSlipPdfUrl,
    nossoNumero,
    installment,
    totalInstallments,
    statusDescription,
    description,
    externalReference,
    external_reference,
    ...rest
  } = charge;

  const externalRef =
    externalReference ||
    external_reference ||
    null;

  const amount = Number(value || 0);

  const due_date = normalizeDateToYMD(dueDate);
  const paid_date = normalizeDateToYMD(paymentDate);

  const statusFinal = status || 'PENDING';

  const statusDetails =
    statusDescription ||
    description ||
    null;

  const metadataJson =
    rest && Object.keys(rest).length ? JSON.stringify(rest) : null;

  const { rows } = await pool.query(
    `
    INSERT INTO ${TB} (
      order_id,
      billing_source,
      billing_type,
      provider_payment_id,
      external_reference,
      amount,
      due_date,
      paid_date,
      status,
      status_details,
      bank_slip_url,
      bank_slip_pdf_url,
      nosso_numero,
      installment_number,
      installments_total,
      metadata
    )
    VALUES (
      $1,                  -- order_id
      'ASAAS',             -- billing_source
      $2,                  -- billing_type
      $3,                  -- provider_payment_id
      $4,                  -- external_reference
      $5,                  -- amount
      $6,                  -- due_date
      $7,                  -- paid_date
      $8,                  -- status
      $9,                  -- status_details
      $10,                 -- bank_slip_url
      $11,                 -- bank_slip_pdf_url
      $12,                 -- nosso_numero
      $13,                 -- installment_number
      $14,                 -- installments_total
      $15                  -- metadata
    )
    RETURNING *;
    `,
    [
      orderId,                // $1
      billingType,            // $2
      provider_payment_id,    // $3
      externalRef,            // $4
      amount,                 // $5
      due_date,               // $6
      paid_date,              // $7
      statusFinal,            // $8
      statusDetails,          // $9
      bankSlipUrl || null,    // $10
      bankSlipPdfUrl || null, // $11
      nossoNumero || null,    // $12
      installment ?? null,    // $13
      totalInstallments ?? null, // $14
      metadataJson,           // $15
    ],
  );

  return rows[0];
}

// ---------------------------------------------------------------------
// listByOrder — histórico de billing do pedido
// ---------------------------------------------------------------------
export async function listByOrder(orderId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM ${TB}
    WHERE order_id = $1
    ORDER BY created_at ASC, orders_billing_id ASC;
    `,
    [orderId],
  );
  return rows;
}

// ---------------------------------------------------------------------
// listByProviderId — para consultas por id do Asaas (webhook/sync)
// ---------------------------------------------------------------------
export async function listByProviderId(providerPaymentId) {
  if (!providerPaymentId) return [];

  const { rows } = await pool.query(
    `
    SELECT *
    FROM ${TB}
    WHERE provider_payment_id = $1
    ORDER BY created_at ASC, orders_billing_id ASC;
    `,
    [providerPaymentId],
  );

  return rows;
}

// ---------------------------------------------------------------------
// updateStatusByProviderId — usado pelo webhook do Asaas
// ---------------------------------------------------------------------
export async function updateStatusByProviderId(providerPaymentId, patch = {}) {
  if (!providerPaymentId) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  if (patch.status) {
    fields.push(`status = $${idx++}`);
    values.push(patch.status);
  }
  if (patch.paid_date) {
    fields.push(`paid_date = $${idx++}`);
    values.push(normalizeDateToYMD(patch.paid_date));
  }
  if (patch.status_details) {
    fields.push(`status_details = $${idx++}`);
    values.push(patch.status_details);
  }
  if (patch.metadata) {
    fields.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${idx++}::jsonb`);
    values.push(JSON.stringify(patch.metadata));
  }

  if (!fields.length) return null;

  fields.push(`updated_at = NOW()`);

  values.push(providerPaymentId);

  const { rows } = await pool.query(
    `
    UPDATE ${TB}
       SET ${fields.join(', ')}
     WHERE provider_payment_id = $${idx}
    RETURNING *;
    `,
    values,
  );

  return rows[0] || null;
}

export default {
  ensureTable,
  createFromAsaasCharge,
  listByOrder,
  listByProviderId,
  updateStatusByProviderId,
};
