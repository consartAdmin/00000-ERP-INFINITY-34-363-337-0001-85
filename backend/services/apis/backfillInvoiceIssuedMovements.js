// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backfillInvoiceIssuedMovements.js — Backfill histórico de saídas NF-e ║
// ║ CONSART ERP                                                         ║
// ║                                                                      ║
// ║ ✅ Não emite NF-e                                                    ║
// ║ ✅ Não chama PlugNotas / SEFAZ                                       ║
// ║ ✅ Não baixa estoque novamente                                       ║
// ║ ✅ Reutiliza invoicesIssuedApi para criar PRODUCT_STOCK_OUT faltantes ║
// ║ ✅ ORDER e BUDGET                                                    ║
// ║ ✅ Idempotente: movimentações existentes são preservadas             ║
// ║ ✅ DRY-RUN por padrão                                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// Uso local (a partir da pasta backend):
//
//   DRY-RUN:
//   node --env-file=.env.local services/apis/backfillInvoiceIssuedMovements.js
//
//   APLICAR:
//   node --env-file=.env.local services/apis/backfillInvoiceIssuedMovements.js --apply
//
//   Somente BUDGET:
//   node --env-file=.env.local services/apis/backfillInvoiceIssuedMovements.js --apply --source=BUDGET
//
//   Somente ORDER:
//   node --env-file=.env.local services/apis/backfillInvoiceIssuedMovements.js --apply --source=ORDER
//
//   Uma NF-e específica:
//   node --env-file=.env.local services/apis/backfillInvoiceIssuedMovements.js --apply --invoice-id=868
//
//   Limitar quantidade:
//   node --env-file=.env.local services/apis/backfillInvoiceIssuedMovements.js --apply --limit=100
//
// IMPORTANTE:
// - Este script usa as mesmas funções já testadas do invoicesIssuedApi.js.
// - Para BUDGET, createBudgetInvoiceIssuedAudit() só cria saída quando
//   nfeOperationTypes.moves_stock = TRUE.
// - O script NÃO altera productsStock/productsStockLots.
// - Por padrão, após criar um audit histórico, ajusta created_at para a data
//   original da NF-e, preservando a ordenação correta em "Registros do Produto".

const { default: pool } = await import('../../config/db.js');
const { default: invoicesIssuedApi } = await import('../../repositories/invoicesIssued/invoicesIssued.index.js');

/* =========================================================================
 * CLI
 * ========================================================================= */

function getArgValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function parsePositiveInt(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

const APPLY = hasFlag('apply');
const DRY_RUN = !APPLY;

const SOURCE = String(getArgValue('source') || 'ALL')
  .trim()
  .toUpperCase();

const LIMIT = parsePositiveInt(getArgValue('limit'), null);
const INVOICE_ID = parsePositiveInt(getArgValue('invoice-id'), null);

// --keep-backfill-date mantém auditLogs.created_at no momento do backfill.
// Sem essa flag, usamos a data original da NF-e.
const PRESERVE_ISSUED_DATE = !hasFlag('keep-backfill-date');

if (!['ALL', 'ORDER', 'BUDGET'].includes(SOURCE)) {
  console.error(
    `[BACKFILL][ERROR] --source inválido: ${SOURCE}. Use ALL, ORDER ou BUDGET.`
  );
  process.exit(1);
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

function normalizeStatus(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isAuthorizedStatus(value) {
  return ['AUTORIZADO', 'AUTORIZADA', 'CONCLUIDO', 'CONCLUIDA']
    .includes(normalizeStatus(value));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function invoiceOriginalDate(invoice) {
  return (
    invoice.issued_at ||
    invoice.issued_date ||
    invoice.created_at ||
    null
  );
}

async function listAuthorizedInvoices() {
  const params = [];
  const where = [
    `COALESCE(ii.source_type, CASE
       WHEN ii.budget_id IS NOT NULL THEN 'BUDGET'
       WHEN ii.order_id IS NOT NULL THEN 'ORDER'
       ELSE NULL
     END) IN ('ORDER', 'BUDGET')`,
    `(
       COALESCE(nsm.is_authorized, FALSE) = TRUE
       OR UPPER(
         TRANSLATE(
           COALESCE(ii.nfe_status, ''),
           'ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ',
           'AAAAEEEIIIOOOOUUUC'
         )
       ) IN ('AUTORIZADO', 'AUTORIZADA', 'CONCLUIDO', 'CONCLUIDA')
     )`,
  ];

  if (SOURCE !== 'ALL') {
    params.push(SOURCE);
    where.push(`
      COALESCE(ii.source_type, CASE
        WHEN ii.budget_id IS NOT NULL THEN 'BUDGET'
        WHEN ii.order_id IS NOT NULL THEN 'ORDER'
        ELSE NULL
      END) = $${params.length}
    `);
  }

  if (INVOICE_ID) {
    params.push(INVOICE_ID);
    where.push(`ii.invoice_id = $${params.length}`);
  }

  const limitSql = LIMIT ? `LIMIT ${LIMIT}` : '';

  const { rows } = await pool.query(
    `
      SELECT
        ii.invoice_id,
        ii.order_id,
        ii.budget_id,
        COALESCE(
          ii.source_type,
          CASE
            WHEN ii.budget_id IS NOT NULL THEN 'BUDGET'
            WHEN ii.order_id IS NOT NULL THEN 'ORDER'
            ELSE NULL
          END
        ) AS source_type,

        ii.nfe_number,
        ii.nfe_key,
        ii.nfe_provider_id,
        ii.nfe_status_id,
        ii.nfe_status,
        ii.nfe_protocol,
        ii.nfe_environment,
        ii.xml_url,
        ii.danfe_url,
        ii.issued_at,
        ii.issued_date,
        ii.total_amount,
        ii.customer_name,
        ii.customer_tax_id,
        ii.customer_email,
        ii.created_at,
        ii.updated_at,

        COALESCE(nsm.is_authorized, FALSE) AS mapped_is_authorized

      FROM public."invoicesIssued" ii

      LEFT JOIN public."nfeStatusMap" nsm
        ON nsm.nfe_status_id = ii.nfe_status_id

      WHERE ${where.join('\n AND ')}

      ORDER BY
        COALESCE(ii.issued_at, ii.issued_date::timestamptz, ii.created_at) ASC,
        ii.invoice_id ASC

      ${limitSql}
    `,
    params
  );

  return rows;
}

async function getBudgetOperation(budgetId) {
  if (!budgetId) return null;

  const { rows } = await pool.query(
    `
      SELECT
        b.budget_id,
        b.operation_type_id,
        op.code AS operation_code,
        op.name AS operation_name,
        COALESCE(op.moves_stock, FALSE) AS moves_stock
      FROM public.budgets b
      LEFT JOIN public."nfeOperationTypes" op
        ON op.operation_type_id = b.operation_type_id
      WHERE b.budget_id = $1
      LIMIT 1
    `,
    [budgetId]
  );

  return rows[0] || null;
}

async function countExpectedItems(invoice) {
  if (invoice.source_type === 'ORDER') {
    const { rows } = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM public."orderItems"
        WHERE order_id = $1
          AND COALESCE(quantity, 0) > 0
      `,
      [invoice.order_id]
    );

    return Number(rows[0]?.total || 0);
  }

  if (invoice.source_type === 'BUDGET') {
    const { rows } = await pool.query(
      `
        -- budgetsItems é a tabela atual; a legada "budgetItens" estava
        -- congelada no orçamento 160 e zerava esta contagem para notas
        -- recentes com origem BUDGET. Lá a coluna de SKU é product_code.
        SELECT COUNT(*)::int AS total
        FROM public."budgetsItems"
        WHERE budget_id = $1
          AND COALESCE(quantity, 0) > 0
          AND NULLIF(BTRIM(COALESCE(product_code, '')), '') IS NOT NULL
      `,
      [invoice.budget_id]
    );

    return Number(rows[0]?.total || 0);
  }

  return 0;
}

async function getExistingStockOutAudits(invoice) {
  const params = [String(invoice.invoice_id)];

  let extra = '';

  if (invoice.source_type === 'ORDER' && invoice.order_id) {
    params.push(String(invoice.order_id));
    extra = `
      AND (
        al.after->>'invoice_id' = $1
        OR (
          al.after->>'order_id' = $2
          AND COALESCE(al.after->>'source_type', 'ORDER') = 'ORDER'
        )
      )
    `;
  } else if (invoice.source_type === 'BUDGET' && invoice.budget_id) {
    params.push(String(invoice.budget_id));
    extra = `
      AND (
        al.after->>'invoice_id' = $1
        OR (
          al.after->>'budget_id' = $2
          AND COALESCE(al.after->>'source_type', 'BUDGET') = 'BUDGET'
        )
      )
    `;
  } else {
    extra = `AND al.after->>'invoice_id' = $1`;
  }

  const { rows } = await pool.query(
    `
      SELECT
        al.id,
        al.register_id AS sku,
        al.operation,
        al.after->>'source_type' AS source_type,
        al.after->>'order_id' AS order_id,
        al.after->>'budget_id' AS budget_id,
        al.after->>'invoice_id' AS invoice_id,
        al.after->>'order_item_id' AS order_item_id,
        al.after->>'budget_item_id' AS budget_item_id,
        al.after->>'nfe_number' AS nfe_number,
        al.after->>'quantity_out' AS quantity_out,
        al.created_at
      FROM public."auditLogs" al
      WHERE al.tabela = 'invoicesIssued'
        AND al.operation = 'PRODUCT_STOCK_OUT'
        ${extra}
      ORDER BY al.id ASC
    `,
    params
  );

  return rows;
}

async function adjustNewAuditDates(invoice, beforeIds) {
  if (!PRESERVE_ISSUED_DATE) return 0;

  const originalDate = invoiceOriginalDate(invoice);
  if (!originalDate) return 0;

  const before = Array.isArray(beforeIds) ? beforeIds : [];
  const params = [
    String(invoice.invoice_id),
    originalDate,
  ];

  let notInSql = '';

  if (before.length) {
    params.push(before.map((id) => String(id)));
    notInSql = `AND NOT (al.id::text = ANY($3::text[]))`;
  }

  const { rowCount } = await pool.query(
    `
      UPDATE public."auditLogs" al
      SET created_at = $2::timestamptz
      WHERE al.tabela = 'invoicesIssued'
        AND al.operation = 'PRODUCT_STOCK_OUT'
        AND al.after->>'invoice_id' = $1
        ${notInSql}
    `,
    params
  );

  return rowCount;
}

async function processOrder(invoice) {
  const orderId = Number(invoice.order_id);

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return {
      ok: false,
      skipped: true,
      reason: 'ORDER sem order_id válido',
    };
  }

  const result = await invoicesIssuedApi.upsertFromOrder(orderId);

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error || 'upsertFromOrder() falhou',
    };
  }

  return { ok: true };
}

async function processBudget(invoice) {
  const budgetId = Number(invoice.budget_id);

  if (!Number.isSafeInteger(budgetId) || budgetId <= 0) {
    return {
      ok: false,
      skipped: true,
      reason: 'BUDGET sem budget_id válido',
    };
  }

  const operation = await getBudgetOperation(budgetId);

  if (!operation) {
    return {
      ok: false,
      skipped: true,
      reason: `Budget ${budgetId} não encontrado`,
    };
  }

  if (!operation.moves_stock) {
    return {
      ok: true,
      skipped: true,
      reason: `Operação ${operation.operation_code || operation.operation_type_id} não movimenta estoque`,
    };
  }

  const status = isAuthorizedStatus(invoice.nfe_status)
    ? 'AUTORIZADO'
    : invoice.nfe_status;

  const result = await invoicesIssuedApi.upsertFromBudget({
    budget_id: budgetId,
    nfe_number: invoice.nfe_number,
    nfe_key: invoice.nfe_key,
    nfe_provider_id: invoice.nfe_provider_id,
    nfe_status: status,
    nfe_protocol: invoice.nfe_protocol,
    nfe_environment: invoice.nfe_environment,
    xml_url: invoice.xml_url,
    danfe_url: invoice.danfe_url,
    issued_at: invoice.issued_at,
    issued_date: invoice.issued_date,
    total_amount: toNumber(invoice.total_amount, 0),
    customer_name: invoice.customer_name,
    customer_tax_id: invoice.customer_tax_id,
    customer_email: invoice.customer_email,
  });

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error || 'upsertFromBudget() falhou',
    };
  }

  return { ok: true };
}

/* =========================================================================
 * Main
 * ========================================================================= */

async function main() {
  console.log('='.repeat(78));
  console.log('[BACKFILL INVOICE ISSUED MOVEMENTS][START]');
  console.log(`Mode       : ${DRY_RUN ? 'DRY-RUN (sem alterações)' : 'APPLY'}`);
  console.log(`Source     : ${SOURCE}`);
  console.log(`Invoice ID : ${INVOICE_ID ?? 'ALL'}`);
  console.log(`Limit      : ${LIMIT ?? 'ALL'}`);
  console.log(
    `Audit date : ${PRESERVE_ISSUED_DATE ? 'NF-e issued_at/issued_date' : 'backfill time'}`
  );
  console.log('='.repeat(78));

  await invoicesIssuedApi.ensureTable();

  const invoices = await listAuthorizedInvoices();

  console.log(`[BACKFILL] NF-es autorizadas encontradas: ${invoices.length}`);

  const summary = {
    scanned: 0,
    alreadyComplete: 0,
    wouldRepair: 0,
    repaired: 0,
    newAudits: 0,
    skipped: 0,
    failed: 0,
  };

  for (const invoice of invoices) {
    summary.scanned += 1;

    const sourceType = String(invoice.source_type || '').toUpperCase();
    const expected = await countExpectedItems(invoice);
    const before = await getExistingStockOutAudits(invoice);
    const missingEstimate = Math.max(expected - before.length, 0);

    console.log('');
    console.log('-'.repeat(78));
    console.log('[BACKFILL][INVOICE]', {
      invoice_id: invoice.invoice_id,
      source_type: sourceType,
      order_id: invoice.order_id,
      budget_id: invoice.budget_id,
      nfe_number: invoice.nfe_number,
      nfe_status: invoice.nfe_status,
      expected_items: expected,
      existing_audits: before.length,
      missing_estimate: missingEstimate,
    });

    if (sourceType === 'BUDGET') {
      const operation = await getBudgetOperation(invoice.budget_id);

      if (!operation) {
        summary.skipped += 1;
        console.warn('[BACKFILL][SKIP] Budget/operation não encontrado.');
        continue;
      }

      if (!operation.moves_stock) {
        summary.skipped += 1;
        console.log('[BACKFILL][SKIP] Operação não movimenta estoque:', {
          operation_type_id: operation.operation_type_id,
          operation_code: operation.operation_code,
        });
        continue;
      }
    }

    if (expected <= 0) {
      summary.skipped += 1;
      console.log('[BACKFILL][SKIP] Nenhum item válido encontrado.');
      continue;
    }

    if (before.length >= expected) {
      summary.alreadyComplete += 1;
      console.log('[BACKFILL][OK] Já possui os audits esperados.');
      continue;
    }

    summary.wouldRepair += 1;

    if (DRY_RUN) {
      console.log(
        `[BACKFILL][DRY-RUN] Criaria até ${missingEstimate} PRODUCT_STOCK_OUT faltante(s).`
      );
      continue;
    }

    try {
      const beforeIds = before.map((row) => row.id);

      let result;

      if (sourceType === 'ORDER') {
        result = await processOrder(invoice);
      } else if (sourceType === 'BUDGET') {
        result = await processBudget(invoice);
      } else {
        summary.skipped += 1;
        console.warn(`[BACKFILL][SKIP] source_type não suportado: ${sourceType}`);
        continue;
      }

      if (result?.skipped) {
        summary.skipped += 1;
        console.log(`[BACKFILL][SKIP] ${result.reason}`);
        continue;
      }

      if (!result?.ok) {
        summary.failed += 1;
        console.error('[BACKFILL][FAIL]', result?.error || 'Erro desconhecido');
        continue;
      }

      const after = await getExistingStockOutAudits(invoice);
      const created = Math.max(after.length - before.length, 0);

      if (created > 0) {
        const adjustedDates = await adjustNewAuditDates(invoice, beforeIds);

        summary.repaired += 1;
        summary.newAudits += created;

        console.log('[BACKFILL][REPAIRED]', {
          invoice_id: invoice.invoice_id,
          before: before.length,
          after: after.length,
          created,
          adjusted_dates: adjustedDates,
        });
      } else if (after.length >= expected) {
        summary.alreadyComplete += 1;
        console.log('[BACKFILL][OK] Audit já estava completo após revalidação.');
      } else {
        summary.failed += 1;
        console.error('[BACKFILL][FAIL] A função executou, mas ainda faltam audits.', {
          expected,
          before: before.length,
          after: after.length,
        });
      }
    } catch (error) {
      summary.failed += 1;

      console.error('[BACKFILL][ERROR]', {
        invoice_id: invoice.invoice_id,
        source_type: sourceType,
        order_id: invoice.order_id,
        budget_id: invoice.budget_id,
        message: error?.message,
        code: error?.code,
        detail: error?.detail,
        table: error?.table,
        column: error?.column,
        constraint: error?.constraint,
        stack: error?.stack,
      });
    }
  }

  console.log('');
  console.log('='.repeat(78));
  console.log('[BACKFILL INVOICE ISSUED MOVEMENTS][SUMMARY]');
  console.log(JSON.stringify(summary, null, 2));
  console.log('='.repeat(78));

  if (DRY_RUN && summary.wouldRepair > 0) {
    console.log('');
    console.log(
      'DRY-RUN concluído. Para aplicar: adicione --apply ao mesmo comando.'
    );
  }

  if (summary.failed > 0) {
    process.exitCode = 2;
  }
}

try {
  await main();
} catch (error) {
  console.error('='.repeat(78));
  console.error('[BACKFILL INVOICE ISSUED MOVEMENTS][FATAL]');
  console.error({
    message: error?.message,
    code: error?.code,
    detail: error?.detail,
    table: error?.table,
    column: error?.column,
    constraint: error?.constraint,
    stack: error?.stack,
  });
  console.error('='.repeat(78));
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
