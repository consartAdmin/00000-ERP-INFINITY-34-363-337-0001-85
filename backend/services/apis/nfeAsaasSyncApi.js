// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeAsaasSyncApi.js — NF-e autorizada → Contas a Receber / Asaas      ║
// ║ CONSART ERP | PostgreSQL | ESM                                       ║
// ║                                                                      ║
// ║ FLUXOS SUPORTADOS                                                    ║
// ║ 1. PEDIDO    → NF-e autorizada → CONTAS A RECEBER → ASAAS opcional  ║
// ║ 2. ORÇAMENTO → NF-e autorizada → CONTAS A RECEBER → ASAAS opcional  ║
// ║                                                                      ║
// ║ REGRAS                                                               ║
// ║ - Persiste accountsReceivable para toda parcela financeira válida   ║
// ║ - Cria cobrança ASAAS somente para boleto automático ASAAS           ║
// ║ - Reutiliza cobrança existente por externalReference                 ║
// ║ - Persiste accountsReceivableAsaas somente quando houver ASAAS       ║
// ║ - Evita duplicidade em reprocessamentos/reconciliações               ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';
import * as asaasApi from '../../repositories/asaas/asaas.index.js';

const TB_AR = 'public."accountsReceivable"';
const TB_BRIDGE = 'public."accountsReceivableAsaas"';
const TB_ORDERS = 'public."orders"';
const TB_CUSTOMERS = 'public."customers"';

// ============================================================================
// HELPERS BÁSICOS
// ============================================================================

const round2 = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
};

const cleanText = (value) => String(value ?? '').trim();

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = cleanText(value);
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

function isBoletoMethod(row = {}) {
  const text = [
    row.payment_method_name,
    row.payment_method_type,
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  return text.includes('BOLETO') || text.includes('BANK_SLIP');
}

function isAutomaticAsaasBoleto(row = {}) {
  const bankAccountId = Number(row.bank_account_id || 0);
  const provider = cleanText(row.collection_provider).toUpperCase();
  const boletoMode = cleanText(row.boleto_mode).toUpperCase();

  return (
    isBoletoMethod(row) &&
    Number.isInteger(bankAccountId) &&
    bankAccountId > 0 &&
    provider === 'ASAAS' &&
    boletoMode === 'AUTOMATIC'
  );
}

function makeExternalReference({ nfeKey, nfeNumber, orderId, paymentId, installment }) {
  const fiscal = cleanText(nfeKey) || `NFE-${cleanText(nfeNumber) || 'SN'}`;
  return `${fiscal}-ORD-${orderId}-BP-${paymentId}-P-${installment}`.slice(0, 100);
}

// ============================================================================
// EXTERNAL REFERENCE — ORÇAMENTO
// ============================================================================

function makeBudgetExternalReference({
  nfeKey,
  nfeNumber,
  budgetId,
  paymentId,
  installment,
}) {
  const fiscal =
    cleanText(nfeKey) ||
    `NFE-${cleanText(nfeNumber) || 'SN'}`;

  return (
    `${fiscal}` +
    `-BUD-${budgetId}` +
    `-BP-${paymentId}` +
    `-P-${installment}`
  ).slice(0, 100);
}

function mapAsaasStatus(status) {
  switch (cleanText(status).toUpperCase()) {
    case 'RECEIVED':
    case 'CONFIRMED':
      return 'PAID';
    case 'OVERDUE':
      return 'OVERDUE';
    case 'REFUNDED':
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}


// accountsReceivable currently accepts only ASAAS / OTHER_BANK / NO_INTEGRATION.
// budgetsPayments also has MANUAL / OTHER_API. Keep the original source in notes
// and map it to the closest valid AR collection provider.
function normalizeReceivableCollectionProvider(value) {
  const provider = cleanText(value).toUpperCase();

  if (provider === 'ASAAS') return 'ASAAS';
  if (provider === 'OTHER_BANK' || provider === 'OTHER_API') return 'OTHER_BANK';
  return 'NO_INTEGRATION';
}

function buildInvoiceNumber(nfeNumber, sequence) {
  return `${cleanText(nfeNumber || 'SN')}/${String(sequence).padStart(3, '0')}`;
}

function buildDescription(nfeNumber, sequence) {
  return `NF-e ${cleanText(nfeNumber || 'SN')} - Parcela ${String(sequence).padStart(3, '0')}`;
}

function buildFinancialInstallments(rows = []) {
  return rows
    .map((row, index) => {
      const installment = Number(row.installment_number || index + 1);
      const sequence = index + 1;
      const value = round2(row.installment_amount ?? row.payment_amount);
      const dueDate = normalizeDate(row.due_date || row.manual_due_date);

      if (!value || value <= 0 || !dueDate) return null;

      return {
        ...row,
        installment,
        sequence,
        value,
        dueDate,
        automaticAsaas: isAutomaticAsaasBoleto(row),
      };
    })
    .filter(Boolean);
}

// ============================================================================
// PEDIDO → CONTEXTO FINANCEIRO / ASAAS
// ============================================================================

async function loadContext(client, orderId) {
  const orderResult = await client.query(
    `
      SELECT
        o.order_id,
        o.budget_id,
        o.customer_id,
        o.total_amount,
        o.operation_type_id,
        COALESCE(ii.issued_date, ii.issued_at::date, o.issue_date, CURRENT_DATE) AS issue_date,
        ii.nfe_number,
        ii.nfe_key,
        COALESCE(ot.generates_receivable, TRUE) AS generates_receivable,
        c.asaas_id,
        c.trade_name,
        c.legal_name
      FROM ${TB_ORDERS} o
      LEFT JOIN ${TB_CUSTOMERS} c
        ON c.customer_id = o.customer_id
      LEFT JOIN public."invoicesIssued" ii
        ON ii.order_id = o.order_id
       AND ii.source_type = 'ORDER'
      LEFT JOIN public."nfeOperationTypes" ot
        ON ot.operation_type_id = o.operation_type_id
      WHERE o.order_id = $1
      ORDER BY ii.invoice_id DESC NULLS LAST
      LIMIT 1
    `,
    [orderId],
  );

  const order = orderResult.rows[0];
  if (!order) throw new Error(`Pedido ${orderId} não encontrado.`);
  if (!order.budget_id) throw new Error(`Pedido ${orderId} não possui budget_id.`);
  if (!order.customer_id) throw new Error(`Pedido ${orderId} não possui customer_id.`);

  if (order.generates_receivable === false) {
    return { order, installments: [] };
  }

  const installmentsResult = await client.query(
    `
      SELECT
        bp.budget_payment_id,
        bp.payment_method_id,
        bp.amount AS payment_amount,
        bp.manual_due_date,
        bp.bank_account_id,
        bp.collection_provider,
        bp.boleto_mode,
        pm.name AS payment_method_name,
        pm.type AS payment_method_type,
        bpi.installment_number,
        bpi.amount AS installment_amount,
        bpi.due_date,
        bpi.status AS installment_status,
        bpi.paid_amount,
        bpi.paid_at
      FROM public."budgetsPayments" bp
      LEFT JOIN public."paymentMethods" pm
        ON pm."paymentMethods_id" = bp.payment_method_id
      LEFT JOIN public."budgetsPaymentInstallments" bpi
        ON bpi.budget_payment_id = bp.budget_payment_id
      WHERE bp.budget_id = $1
      ORDER BY
        bp.budget_payment_id ASC,
        bpi.installment_number ASC NULLS LAST,
        bpi.due_date ASC NULLS LAST
    `,
    [order.budget_id],
  );

  const installments = buildFinancialInstallments(installmentsResult.rows);

  if (installments.some((row) => row.automaticAsaas) && !cleanText(order.asaas_id)) {
    throw new Error(`Cliente ${order.customer_id} ainda não possui asaas_id para cobrança automática ASAAS.`);
  }

  return { order, installments };
}

// ============================================================================
// BUDGET → CONTEXTO FINANCEIRO / ASAAS
// ============================================================================

async function loadBudgetContext(client, budgetId) {
  const id = Number(budgetId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('budgetId inválido.');
  }

  const budgetResult = await client.query(
    `
      SELECT
        b.budget_id,
        b.customer_id,
        b.total_amount,
        b.operation_type_id,
        COALESCE(ii.issued_date, ii.issued_at::date, b.issue_date, CURRENT_DATE) AS issue_date,
        ii.nfe_number,
        ii.nfe_key,
        COALESCE(ot.generates_receivable, TRUE) AS generates_receivable,
        c.asaas_id,
        c.trade_name,
        c.legal_name
      FROM public.budgets b
      LEFT JOIN public.customers c
        ON c.customer_id = b.customer_id
      LEFT JOIN public."invoicesIssued" ii
        ON ii.budget_id = b.budget_id
       AND ii.source_type = 'BUDGET'
      LEFT JOIN public."nfeOperationTypes" ot
        ON ot.operation_type_id = b.operation_type_id
      WHERE b.budget_id = $1
      ORDER BY ii.invoice_id DESC NULLS LAST
      LIMIT 1
    `,
    [id],
  );

  const budget = budgetResult.rows[0];

  if (!budget) {
    throw new Error(`Orçamento ${id} não encontrado.`);
  }

  if (!budget.customer_id) {
    throw new Error(`Orçamento ${id} não possui customer_id.`);
  }

  if (budget.generates_receivable === false) {
    return { budget, installments: [] };
  }

  const installmentsResult = await client.query(
    `
      SELECT
        bp.budget_payment_id,
        bp.payment_method_id,
        bp.amount AS payment_amount,
        bp.manual_due_date,
        bp.bank_account_id,
        bp.collection_provider,
        bp.boleto_mode,
        pm.name AS payment_method_name,
        pm.type AS payment_method_type,
        bpi.installment_number,
        bpi.amount AS installment_amount,
        bpi.due_date,
        bpi.status AS installment_status,
        bpi.paid_amount,
        bpi.paid_at
      FROM public."budgetsPayments" bp
      LEFT JOIN public."paymentMethods" pm
        ON pm."paymentMethods_id" = bp.payment_method_id
      LEFT JOIN public."budgetsPaymentInstallments" bpi
        ON bpi.budget_payment_id = bp.budget_payment_id
      WHERE bp.budget_id = $1
      ORDER BY
        bp.budget_payment_id ASC,
        bpi.installment_number ASC NULLS LAST,
        bpi.due_date ASC NULLS LAST
    `,
    [id],
  );

  const installments = buildFinancialInstallments(installmentsResult.rows);

  if (installments.some((row) => row.automaticAsaas) && !cleanText(budget.asaas_id)) {
    throw new Error(`Cliente ${budget.customer_id} ainda não possui asaas_id para cobrança automática ASAAS.`);
  }

  return { budget, installments };
}

// ============================================================================
// LOCALIZAÇÃO / REUTILIZAÇÃO DE COBRANÇAS
// ============================================================================

async function findLocalLink(client, externalReference) {
  const result = await client.query(
    `
      SELECT
        asa.accounts_receivable_id,
        asa.asaas_payment_id,
        asa.last_status,
        asa.raw
      FROM ${TB_BRIDGE} asa
      WHERE asa.raw->>'externalReference' = $1
      LIMIT 1
    `,
    [externalReference],
  );

  return result.rows[0] || null;
}

async function findRemotePayment(externalReference) {
  const result = await asaasApi.listPayments({
    externalReference,
    limit: 1,
    offset: 0,
    sort: 'dueDate',
    order: 'asc',
  });

  return Array.isArray(result?.data) ? (result.data[0] || null) : null;
}

// ============================================================================
// PERSISTÊNCIA — CONTAS A RECEBER + PONTE ASAAS
// ============================================================================

async function persistLocalReceivable(client, {
  context,
  installment,
  externalReference,
  nfeNumber,
}) {
  const sequence = Number(installment.sequence || installment.installment || 1);
  const effectiveNfeNumber = cleanText(nfeNumber || context.nfe_number || 'SN');
  const invoiceNumber = buildInvoiceNumber(effectiveNfeNumber, sequence);
  const description = buildDescription(effectiveNfeNumber, sequence);
  const collectionProvider = normalizeReceivableCollectionProvider(
    installment.collection_provider,
  );

  const existing = await client.query(
    `
      SELECT id
      FROM ${TB_AR}
      WHERE document_number = $1
         OR invoice_number = $2
      ORDER BY CASE WHEN document_number = $1 THEN 0 ELSE 1 END, id
      LIMIT 1
    `,
    [externalReference, invoiceNumber],
  );

  let arId = existing.rows[0]?.id || null;
  let created = false;

  if (arId) {
    await client.query(
      `
        UPDATE ${TB_AR}
        SET
          customer_id = $1,
          description = $2,
          value = $3,
          due_date = $4,
          invoice_number = $5,
          document_number = COALESCE(document_number, $6),
          issue_date = $7,
          payment_method_id = $8,
          collection_provider = $9,
          bank_account_id = $10,
          notes = COALESCE(notes, $11),
          updated_at = NOW()
        WHERE id = $12
      `,
      [
        context.customer_id,
        description,
        installment.value,
        installment.dueDate,
        invoiceNumber,
        externalReference,
        normalizeDate(context.issue_date),
        installment.payment_method_id || null,
        collectionProvider,
        installment.bank_account_id || null,
        `Criado automaticamente após autorização da NF-e. Origem: ${cleanText(installment.collection_provider) || 'NO_INTEGRATION'}. Ref.: ${externalReference}`,
        arId,
      ],
    );
  } else {
    const inserted = await client.query(
      `
        INSERT INTO ${TB_AR} (
          customer_id,
          description,
          value,
          amount_paid,
          due_date,
          payment_date,
          status,
          invoice_number,
          document_number,
          issue_date,
          payment_method_id,
          collection_provider,
          bank_account_id,
          fine,
          interest,
          charges,
          notes
        ) VALUES (
          $1,$2,$3,0,$4,NULL,'PENDING',$5,$6,$7,$8,$9,$10,0,0,0,$11
        )
        RETURNING id
      `,
      [
        context.customer_id,
        description,
        installment.value,
        installment.dueDate,
        invoiceNumber,
        externalReference,
        normalizeDate(context.issue_date),
        installment.payment_method_id || null,
        collectionProvider,
        installment.bank_account_id || null,
        `Criado automaticamente após autorização da NF-e. Origem: ${cleanText(installment.collection_provider) || 'NO_INTEGRATION'}. Ref.: ${externalReference}`,
      ],
    );

    arId = inserted.rows[0].id;
    created = true;
  }

  return {
    accountsReceivableId: arId,
    created,
    collectionProvider,
  };
}

async function persistLink(client, { order, installment, payment, externalReference, nfeNumber }) {
  const paymentId = cleanText(payment?.id);
  if (!paymentId) throw new Error('Asaas não retornou payment.id.');

  const status = mapAsaasStatus(payment.status);
  const paidValue = status === 'PAID'
    ? round2(payment.netValue ?? payment.value)
    : 0;

  const sequence = Number(installment.sequence || installment.installment || 1);
  const effectiveNfeNumber = cleanText(nfeNumber || order.nfe_number || 'SN');
  const invoiceNumber = buildInvoiceNumber(effectiveNfeNumber, sequence);
  const description = buildDescription(effectiveNfeNumber, sequence);

  const existingAr = await client.query(
    `
      SELECT id
      FROM ${TB_AR}
      WHERE document_number = $1
         OR invoice_number = $2
      ORDER BY CASE WHEN document_number = $1 THEN 0 ELSE 1 END, id
      LIMIT 1
    `,
    [externalReference, invoiceNumber],
  );

  let arId = existingAr.rows[0]?.id || null;

  if (arId) {
    await client.query(
      `
        UPDATE ${TB_AR}
        SET
          customer_id = $1,
          description = $2,
          value = $3,
          amount_paid = $4,
          due_date = $5,
          payment_date = $6,
          status = $7,
          invoice_number = $8,
          document_number = COALESCE(document_number, $9),
          issue_date = $10,
          payment_method_id = $11,
          collection_provider = 'ASAAS',
          bank_account_id = $12,
          updated_at = NOW()
        WHERE id = $13
      `,
      [
        order.customer_id,
        description,
        round2(payment.value ?? installment.value),
        paidValue,
        normalizeDate(payment.dueDate) || installment.dueDate,
        normalizeDate(payment.paymentDate),
        status,
        invoiceNumber,
        externalReference,
        normalizeDate(order.issue_date),
        installment.payment_method_id || null,
        installment.bank_account_id || null,
        arId,
      ],
    );
  } else {
    const inserted = await client.query(
      `
        INSERT INTO ${TB_AR} (
          customer_id,
          description,
          value,
          amount_paid,
          due_date,
          payment_date,
          status,
          invoice_number,
          document_number,
          issue_date,
          payment_method_id,
          collection_provider,
          bank_account_id,
          fine,
          interest,
          charges,
          notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ASAAS',$12,0,0,0,$13)
        RETURNING id
      `,
      [
        order.customer_id,
        description,
        round2(payment.value ?? installment.value),
        paidValue,
        normalizeDate(payment.dueDate) || installment.dueDate,
        normalizeDate(payment.paymentDate),
        status,
        invoiceNumber,
        externalReference,
        normalizeDate(order.issue_date),
        installment.payment_method_id || null,
        installment.bank_account_id || null,
        `Criado automaticamente após autorização da NF-e. Ref.: ${externalReference}`,
      ],
    );

    arId = inserted.rows[0].id;
  }

  const raw = {
    ...payment,
    externalReference,
    boleto_pdf_url_local: payment.boleto_pdf_url_local || null,
    boleto_pdf_abs_path: payment.boleto_pdf_abs_path || null,
  };

  await client.query(
    `
      INSERT INTO ${TB_BRIDGE} (
        accounts_receivable_id,
        asaas_payment_id,
        asaas_customer_id,
        asaas_customer_name,
        last_status,
        raw
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
      ON CONFLICT (asaas_payment_id)
      DO UPDATE SET
        accounts_receivable_id = EXCLUDED.accounts_receivable_id,
        asaas_customer_id = EXCLUDED.asaas_customer_id,
        asaas_customer_name = EXCLUDED.asaas_customer_name,
        last_status = EXCLUDED.last_status,
        raw = EXCLUDED.raw,
        updated_at = NOW()
    `,
    [
      arId,
      paymentId,
      order.asaas_id,
      order.legal_name || order.trade_name || null,
      payment.status || 'PENDING',
      JSON.stringify(raw),
    ],
  );

  return { accountsReceivableId: arId, asaasPaymentId: paymentId, status };
}

// ============================================================================
// PEDIDO → NF-e AUTORIZADA → CONTAS A RECEBER / ASAAS OPCIONAL
// ============================================================================

export async function syncAuthorizedNfe({ orderId, nfeNumber, nfeKey } = {}) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('orderId inválido.');

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [73114, id]);
    lockAcquired = true;

    const { order, installments } = await loadContext(client, id);
    const result = {
      ok: true,
      partial: false,
      orderId: id,
      budgetId: order.budget_id,
      found: installments.length,
      receivablesCreated: 0,
      receivablesReused: 0,
      created: 0,
      reused: 0,
      linked: 0,
      failed: [],
      skipped: installments.length ? 0 : 1,
      payments: [],
    };

    for (const installment of installments) {
      const externalReference = makeExternalReference({
        nfeKey: nfeKey || order.nfe_key,
        nfeNumber: nfeNumber || order.nfe_number,
        orderId: id,
        paymentId: installment.budget_payment_id,
        installment: installment.installment,
      });

      try {
        // 1) Financial title exists independently from the collection provider.
        await client.query('BEGIN');
        let localReceivable;
        try {
          localReceivable = await persistLocalReceivable(client, {
            context: order,
            installment,
            externalReference,
            nfeNumber: nfeNumber || order.nfe_number,
          });
          await client.query('COMMIT');
        } catch (persistError) {
          await client.query('ROLLBACK');
          throw persistError;
        }

        if (localReceivable.created) result.receivablesCreated += 1;
        else result.receivablesReused += 1;

        // 2) MANUAL / NO_INTEGRATION / other local methods stop here.
        if (!installment.automaticAsaas) {
          result.linked += 1;
          result.payments.push({
            installment: installment.sequence,
            sourceInstallment: installment.installment,
            dueDate: installment.dueDate,
            value: installment.value,
            externalReference,
            source: localReceivable.created ? 'local-created' : 'local-reused',
            accountsReceivableId: localReceivable.accountsReceivableId,
            collectionProvider: localReceivable.collectionProvider,
            boletoMode: installment.boleto_mode || null,
          });
          continue;
        }

        // 3) Only automatic ASAAS boleto reaches the remote provider.
        const localLink = await findLocalLink(client, externalReference);
        let payment = null;
        let source = 'created';

        if (localLink?.asaas_payment_id) {
          try {
            payment = await asaasApi.getPayment(localLink.asaas_payment_id);
          } catch {
            payment = {
              ...(localLink.raw || {}),
              id: localLink.asaas_payment_id,
              status: localLink.last_status || 'PENDING',
            };
          }
          source = 'local';
          result.reused += 1;
        } else {
          payment = await findRemotePayment(externalReference);

          if (payment?.id) {
            source = 'remote';
            result.reused += 1;
          } else {
            payment = await asaasApi.createCharge({
              customerId: order.asaas_id,
              billingType: 'BOLETO',
              value: installment.value,
              dueDate: installment.dueDate,
              description: buildDescription(
                nfeNumber || order.nfe_number || 'SN',
                installment.sequence,
              ),
              externalReference,
            });
            result.created += 1;
          }
        }

        await client.query('BEGIN');
        try {
          const linked = await persistLink(client, {
            order,
            installment,
            payment,
            externalReference,
            nfeNumber: nfeNumber || order.nfe_number,
          });

          await client.query('COMMIT');
          result.linked += 1;
          result.payments.push({
            installment: installment.sequence,
            sourceInstallment: installment.installment,
            dueDate: installment.dueDate,
            value: installment.value,
            externalReference,
            source,
            ...linked,
          });
        } catch (persistError) {
          await client.query('ROLLBACK');
          throw persistError;
        }
      } catch (error) {
        const errorMessage =
          error?.response?.data?.errors?.[0]?.description ||
          error?.response?.data?.message ||
          error?.message ||
          String(error);

        result.failed.push({
          installment: installment.sequence,
          sourceInstallment: installment.installment,
          dueDate: installment.dueDate,
          value: installment.value,
          externalReference,
          error: errorMessage,
        });

        console.error('[NFE][FINANCE][ORDER][PARCELA][ERRO]', {
          orderId: id,
          installment: installment.sequence,
          sourceInstallment: installment.installment,
          externalReference,
          error: errorMessage,
        });
      }
    }

    result.partial = result.failed.length > 0 && result.linked > 0;
    result.ok = result.failed.length === 0;

    return result;
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [73114, id]);
      } catch (unlockError) {
        console.error('[NFE][FINANCE][ORDER][UNLOCK][ERRO]', unlockError?.message || unlockError);
      }
    }
    client.release();
  }
}

// ============================================================================
// ORÇAMENTO → NF-e AUTORIZADA → CONTAS A RECEBER / ASAAS OPCIONAL
// ============================================================================

export async function syncAuthorizedBudgetNfe({
  budgetId,
  nfeNumber,
  nfeKey,
} = {}) {
  const id = Number(budgetId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('budgetId inválido.');
  }

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [73115, id]);
    lockAcquired = true;

    const { budget, installments } = await loadBudgetContext(client, id);
    const result = {
      ok: true,
      partial: false,
      budgetId: id,
      found: installments.length,
      receivablesCreated: 0,
      receivablesReused: 0,
      created: 0,
      reused: 0,
      linked: 0,
      failed: [],
      skipped: installments.length ? 0 : 1,
      payments: [],
    };

    if (!installments.length) {
      console.log('[BUDGET NFE][FINANCE] Nenhuma parcela financeira para sincronizar.', {
        budgetId: id,
        generatesReceivable: budget.generates_receivable,
      });
      return result;
    }

    for (const installment of installments) {
      const effectiveNfeNumber = nfeNumber || budget.nfe_number || 'SN';
      const effectiveNfeKey = nfeKey || budget.nfe_key || null;
      const externalReference = makeBudgetExternalReference({
        nfeKey: effectiveNfeKey,
        nfeNumber: effectiveNfeNumber,
        budgetId: id,
        paymentId: installment.budget_payment_id,
        installment: installment.installment,
      });

      try {
        // 1) Always create/reuse Accounts Receivable first.
        await client.query('BEGIN');
        let localReceivable;
        try {
          localReceivable = await persistLocalReceivable(client, {
            context: budget,
            installment,
            externalReference,
            nfeNumber: effectiveNfeNumber,
          });
          await client.query('COMMIT');
        } catch (persistError) {
          await client.query('ROLLBACK');
          throw persistError;
        }

        if (localReceivable.created) result.receivablesCreated += 1;
        else result.receivablesReused += 1;

        // 2) Manual boleto / no integration / other local collection stops here.
        if (!installment.automaticAsaas) {
          result.linked += 1;
          result.payments.push({
            installment: installment.sequence,
            sourceInstallment: installment.installment,
            dueDate: installment.dueDate,
            value: installment.value,
            externalReference,
            source: localReceivable.created ? 'local-created' : 'local-reused',
            accountsReceivableId: localReceivable.accountsReceivableId,
            collectionProvider: localReceivable.collectionProvider,
            originalCollectionProvider: installment.collection_provider || null,
            boletoMode: installment.boleto_mode || null,
          });
          continue;
        }

        // 3) ASAAS/AUTOMATIC: create or reuse the remote charge.
        const localLink = await findLocalLink(client, externalReference);
        let payment = null;
        let source = 'created';

        if (localLink?.asaas_payment_id) {
          try {
            payment = await asaasApi.getPayment(localLink.asaas_payment_id);
          } catch {
            payment = {
              ...(localLink.raw || {}),
              id: localLink.asaas_payment_id,
              status: localLink.last_status || 'PENDING',
            };
          }

          source = 'local';
          result.reused += 1;
        } else {
          payment = await findRemotePayment(externalReference);

          if (payment?.id) {
            source = 'remote';
            result.reused += 1;
          } else {
            payment = await asaasApi.createCharge({
              customerId: budget.asaas_id,
              billingType: 'BOLETO',
              value: installment.value,
              dueDate: installment.dueDate,
              description: buildDescription(effectiveNfeNumber, installment.sequence),
              externalReference,
            });
            result.created += 1;
          }
        }

        // 4) Persist/update AR from Asaas and bridge the remote payment.
        const context = {
          ...budget,
          nfe_number: effectiveNfeNumber,
        };

        await client.query('BEGIN');
        try {
          const linked = await persistLink(client, {
            order: context,
            installment,
            payment,
            externalReference,
            nfeNumber: effectiveNfeNumber,
          });

          await client.query('COMMIT');
          result.linked += 1;
          result.payments.push({
            installment: installment.sequence,
            sourceInstallment: installment.installment,
            dueDate: installment.dueDate,
            value: installment.value,
            externalReference,
            source,
            ...linked,
          });
        } catch (persistError) {
          await client.query('ROLLBACK');
          throw persistError;
        }
      } catch (error) {
        const errorMessage =
          error?.response?.data?.errors?.[0]?.description ||
          error?.response?.data?.message ||
          error?.message ||
          String(error);

        result.failed.push({
          installment: installment.sequence,
          sourceInstallment: installment.installment,
          dueDate: installment.dueDate,
          value: installment.value,
          externalReference,
          error: errorMessage,
        });

        console.error('[BUDGET NFE][FINANCE][PARCELA][ERRO]', {
          budgetId: id,
          installment: installment.sequence,
          sourceInstallment: installment.installment,
          externalReference,
          error: errorMessage,
        });
      }
    }

    result.partial = result.failed.length > 0 && result.linked > 0;
    result.ok = result.failed.length === 0;

    console.log('[BUDGET NFE][FINANCE][RESULT]', result);
    return result;
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [73115, id]);
      } catch (unlockError) {
        console.error('[BUDGET NFE][FINANCE][UNLOCK][ERRO]', unlockError?.message || unlockError);
      }
    }

    client.release();
  }
}

// ============================================================================
// EXPORTAÇÕES
// ============================================================================

export default {
  syncAuthorizedNfe,
  syncAuthorizedBudgetNfe,
};
