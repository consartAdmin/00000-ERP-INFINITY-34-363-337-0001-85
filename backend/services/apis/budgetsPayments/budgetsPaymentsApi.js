/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: budgetsPaymentsApi.js                                         ║
   ║ MODULE: Budgets Payments                                            ║
   ║ DESCRIPTION: DAL/API para pagamentos do orçamento                   ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ║                                                                      ║
   ║ Tabelas relacionadas:                                                ║
   ║ - public.budgets                                                     ║
   ║ - public."budgetsPayments"                                           ║
   ║ - public."paymentMethods"                                            ║
   ║ - public."budgetsPaymentInstallments"                                ║
   ║                                                                      ║
   ║ Estrutura de public."budgetsPayments" vem do catalog_schema:         ║
   ║ nomes de tabela/colunas, defaults, enums (CHECK), tamanhos e FKs.    ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../../config/db.js';
import budgetsPaymentInstallmentsApi from '../budgetsPaymentInstallments/budgetsPaymentInstallmentsApi.js';
import budgetsPaymentsSchema, {
  BOLETO_MODES,
  COLLECTION_PROVIDERS
} from './catalog_schema.budgetsPayments.js';

/* ──────────────────────────────────────────────────────────────────────
 * Catálogo → SQL
 * ──────────────────────────────────────────────────────────────────── */

const CATALOG = budgetsPaymentsSchema;
const COLUMNS = CATALOG.columns;
const PK = CATALOG.primaryKey;

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qualifyTable(table, schema = CATALOG.schema) {
  return `${schema}.${quoteIdent(table)}`;
}

function foreignKeyFor(column) {
  const fk = CATALOG.foreignKeys.find((row) => row.column === column);
  if (!fk) {
    throw new Error(`[catalog_schema.budgetsPayments] FK ausente para a coluna ${column}.`);
  }
  return fk;
}

function referencingTable(table) {
  const ref = CATALOG.referencedBy.find((row) => row.table === table);
  if (!ref) {
    throw new Error(`[catalog_schema.budgetsPayments] referencedBy ausente para ${table}.`);
  }
  return ref;
}

const FK_METHOD = foreignKeyFor('payment_method_id');
const FK_BANK_ACCOUNT = foreignKeyFor('bank_account_id');
const REF_INSTALLMENTS = referencingTable('budgetsPaymentInstallments');

const TB_PAYMENTS = qualifyTable(CATALOG.table);
const TB_METHODS = qualifyTable(FK_METHOD.references.table);
const TB_BANK_ACCOUNTS = qualifyTable(FK_BANK_ACCOUNT.references.table);
const TB_INSTALLMENTS = qualifyTable(REF_INSTALLMENTS.table);
const TB_BUDGETS = 'public.budgets';
const TB_SHIPPING = 'public."budgetsShipping"';
/*
 * Itens do orçamento: tabela ATUAL (budgetsItems).
 * Antes apontava para a legada "budgetItens", que está congelada desde o
 * orçamento 160 — para qualquer orçamento novo a soma vinha zerada.
 * Verificado no schema em 16/09/2026.
 */
const TB_ITEMS = 'public."budgetsItems"';

const METHOD_PK = quoteIdent(FK_METHOD.references.column);
const BANK_ACCOUNT_PK = quoteIdent(FK_BANK_ACCOUNT.references.column);

const DEFAULT_COLLECTION_PROVIDER = COLUMNS.collection_provider.default;
const DEFAULT_BOLETO_MODE = COLUMNS.boleto_mode.default;

const PAYMENT_SELECT_COLUMNS = Object.keys(COLUMNS)
  .map((column) => `bp.${quoteIdent(column)}`)
  .join(',\n      ');

const PAYMENT_ORDER_BY = CATALOG.defaultOrderBy
  .map(({ column, direction }) => `bp.${quoteIdent(column)} ${direction === 'DESC' ? 'DESC' : 'ASC'}`)
  .join(', ');

const SELECT_PAYMENTS_SQL = `
    SELECT
      ${PAYMENT_SELECT_COLUMNS},
      pm.name AS payment_method_name,
      pm.type AS payment_method_type,
      pm.installments,
      pm.gap_one,
      pm.gap_two,
      pm.gap_three,
      pm.gap_four
    FROM ${TB_PAYMENTS} bp
    LEFT JOIN ${TB_METHODS} pm
      ON pm.${METHOD_PK} = bp.${quoteIdent(FK_METHOD.column)}
`;

const INSERT_PAYMENT_SQL = `
    INSERT INTO ${TB_PAYMENTS} (
      ${CATALOG.insertable.map(quoteIdent).join(',\n      ')}
    )
    VALUES (${CATALOG.insertable.map((_, i) => `$${i + 1}`).join(', ')})
    RETURNING ${quoteIdent(PK)}
`;

/*
 * updated_at não entra no SET: o trigger trg_budgetspayments_updated_at
 * (BEFORE UPDATE) já cuida dele.
 */
const UPDATE_PAYMENT_SQL = `
    UPDATE ${TB_PAYMENTS}
       SET ${CATALOG.updatable.map((column, i) => `${quoteIdent(column)} = $${i + 2}`).join(',\n           ')}
     WHERE ${quoteIdent(PK)} = $1
     RETURNING ${quoteIdent(PK)}
`;

/* ──────────────────────────────────────────────────────────────────────
 * Normalizadores
 * ──────────────────────────────────────────────────────────────────── */

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function normalizeIsoDate(value, fallback = null) {
  if (value == null || value === '') return fallback;

  const s = String(value).trim();
  if (!s) return fallback;

  const matchBr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (matchBr) {
    const [, dd, mm, yyyy] = matchBr;
    return `${yyyy}-${mm}-${dd}`;
  }

  const matchIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matchIso) {
    return `${matchIso[1]}-${matchIso[2]}-${matchIso[3]}`;
  }

  return fallback;
}

/*
 * O driver pg devolve colunas DATE como Date (meia-noite local) quando não há
 * type parser configurado; String(date).slice(0, 10) daria "Sat Sep 19".
 */
function formatDateColumn(value) {
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(value).slice(0, 10);
}

/* ──────────────────────────────────────────────────────────────────────
 * Validação e mapeamento pelo catálogo
 * ──────────────────────────────────────────────────────────────────── */

function validatePaymentRecord(record, columns, context = '') {
  const suffix = context ? ` ${context}` : '';

  for (const column of columns) {
    const def = COLUMNS[column];
    const value = record[column];

    if (value == null) {
      if (def.nullable === false) {
        throw new Error(`${column} é obrigatório${suffix}.`);
      }
      continue;
    }

    if (def.enum && !def.enum.includes(value)) {
      throw new Error(
        `${column} inválido${suffix}: "${value}". Valores aceitos: ${def.enum.join(', ')}.`
      );
    }

    if (def.maxLength && String(value).length > def.maxLength) {
      throw new Error(
        `${column} excede ${def.maxLength} caracteres${suffix}.`
      );
    }

    if (def.type === 'numeric' && def.precision != null) {
      const scale = def.scale ?? 0;
      const max = 10 ** (def.precision - scale) - 10 ** -scale;
      if (Math.abs(Number(value)) > max) {
        throw new Error(
          `${column} excede o limite de numeric(${def.precision},${scale})${suffix}.`
        );
      }
    }
  }
}

function buildPaymentRecord({
  budgetId,
  paymentMethodId,
  bankAccount,
  amount,
  notes,
  manualDueDate
}) {
  return {
    budget_id: budgetId,
    payment_method_id: paymentMethodId,
    bank_account_id: bankAccount.bank_account_id,
    collection_provider: bankAccount.collection_provider,
    boleto_mode: bankAccount.boleto_mode,
    amount,
    notes,
    manual_due_date: manualDueDate
  };
}

async function insertPayment(client, record, context = '') {
  validatePaymentRecord(record, CATALOG.insertable, context);

  const { rows } = await client.query(
    INSERT_PAYMENT_SQL,
    CATALOG.insertable.map((column) => record[column])
  );

  return Number(rows[0][PK]);
}

async function updatePayment(client, budgetPaymentId, record) {
  validatePaymentRecord(record, CATALOG.updatable);

  await client.query(UPDATE_PAYMENT_SQL, [
    budgetPaymentId,
    ...CATALOG.updatable.map((column) => record[column])
  ]);
}

function mapPaymentColumns(row) {
  const out = {};

  for (const [column, def] of Object.entries(COLUMNS)) {
    const value = row[column];

    if (value == null) {
      out[column] = def.enum ? def.default : null;
      continue;
    }

    switch (def.type) {
      case 'bigint':
      case 'integer':
        out[column] = Number(value);
        break;
      case 'numeric':
        out[column] = Number(toNumber(value, 0).toFixed(def.scale ?? 2));
        break;
      case 'date':
        out[column] = formatDateColumn(value);
        break;
      default:
        out[column] = value;
    }
  }

  return out;
}

function mapRow(row) {
  return {
    ...mapPaymentColumns(row),

    payment_method_name: row.payment_method_name || null,
    payment_method_type: row.payment_method_type || null,
    installments:
      row.installments != null
        ? Number(row.installments)
        : null,

    gap_one: row.gap_one != null ? Number(row.gap_one) : null,
    gap_two: row.gap_two != null ? Number(row.gap_two) : null,
    gap_three: row.gap_three != null ? Number(row.gap_three) : null,
    gap_four: row.gap_four != null ? Number(row.gap_four) : null
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * Consultas auxiliares
 * ──────────────────────────────────────────────────────────────────── */

async function getBudgetById(client, budgetId) {
  const sql = `
    SELECT
      b.budget_id,
      b.issue_date,
      b.status,
      b.customer_name,
      COALESCE(bs.freight_value, 0) AS freight_value
    FROM ${TB_BUDGETS} b
    LEFT JOIN ${TB_SHIPPING} bs
      ON bs.budget_shipping_id = b.budget_shipping_id
    WHERE b.budget_id = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [budgetId]);
  return rows[0] || null;
}

async function getPaymentMethodById(client, paymentMethodId) {
  const sql = `
    SELECT
      pm.${METHOD_PK},
      pm.name,
      pm.type,
      pm.installments,
      pm.gap_one,
      pm.gap_two,
      pm.gap_three,
      pm.gap_four,
      pm.active
    FROM ${TB_METHODS} pm
    WHERE pm.${METHOD_PK} = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [paymentMethodId]);
  return rows[0] || null;
}

async function resolveBankAccount(client, value) {
  const bankAccountId = toInt(value);

  if (!bankAccountId) {
    return {
      bank_account_id: null,
      collection_provider: DEFAULT_COLLECTION_PROVIDER,
      boleto_mode: DEFAULT_BOLETO_MODE
    };
  }

  const { rows } = await client.query(
    `
      SELECT
        ba.${BANK_ACCOUNT_PK} AS id,
        ba.integration_provider,
        ba.boleto_mode,
        ba.is_active
      FROM ${TB_BANK_ACCOUNTS} ba
      WHERE ba.${BANK_ACCOUNT_PK} = $1
      LIMIT 1
    `,
    [bankAccountId]
  );

  const account = rows[0];

  if (!account) {
    throw new Error(
      `Conta bancária não encontrada: ${bankAccountId}.`
    );
  }

  if (account.is_active === false) {
    throw new Error(
      `A conta bancária ${bankAccountId} está inativa.`
    );
  }

  const collectionProvider = String(
    account.integration_provider || DEFAULT_COLLECTION_PROVIDER
  ).toUpperCase();

  const boletoMode = String(
    account.boleto_mode || DEFAULT_BOLETO_MODE
  ).toUpperCase();

  /*
   * Os valores vêm de bankAccounts, mas precisam caber nos CHECKs de
   * budgetsPayments; sem isso o erro só apareceria como violação 23514.
   */
  if (!COLLECTION_PROVIDERS.includes(collectionProvider)) {
    throw new Error(
      `A conta bancária ${bankAccountId} usa integration_provider "${collectionProvider}", ` +
      `não aceito em pagamentos (${COLLECTION_PROVIDERS.join(', ')}).`
    );
  }

  if (!BOLETO_MODES.includes(boletoMode)) {
    throw new Error(
      `A conta bancária ${bankAccountId} usa boleto_mode "${boletoMode}", ` +
      `não aceito em pagamentos (${BOLETO_MODES.join(', ')}).`
    );
  }

  return {
    bank_account_id: Number(account.id),
    collection_provider: collectionProvider,
    boleto_mode: boletoMode
  };
}

async function getBudgetItemsTotal(client, budgetId) {
  /*
   * A coluna "total" não existe em budgetsItems (nem existia na legada
   * budgetItens): a query anterior sempre lançava 42703 e o catch devolvia 0,
   * zerando silenciosamente a validação de pagamentos. O valor por item é
   * quantidade × preço unitário, menos o desconto do item.
   */
  const sql = `
    SELECT
      COALESCE(SUM(
        (COALESCE(quantity, 0) * COALESCE(unit_price, 0))
        - COALESCE(discount_value, 0)
      ), 0)::numeric(14,2) AS items_total
    FROM ${TB_ITEMS}
    WHERE budget_id = $1
  `;
  try {
    const { rows } = await client.query(sql, [budgetId]);
    return round2(rows[0]?.items_total || 0);
  } catch (error) {
    // Nunca engolir em silêncio: um total zerado aqui invalida a conferência
    // financeira do orçamento inteiro.
    console.error('[budgetsPaymentsApi][getBudgetItemsTotal]', {
      budget_id: budgetId,
      error: error?.message || error,
    });
    throw error;
  }
}

async function getBudgetPaymentsSum(client, budgetId, exceptId = null) {
  let sql = `
    SELECT COALESCE(SUM(amount), 0)::numeric(14,2) AS total
    FROM ${TB_PAYMENTS}
    WHERE budget_id = $1
  `;
  const params = [budgetId];

  if (exceptId) {
    sql += ` AND ${quoteIdent(PK)} <> $2`;
    params.push(exceptId);
  }

  const { rows } = await client.query(sql, params);
  return round2(rows[0]?.total || 0);
}

async function getExpectedBudgetTotal(client, budgetId) {
  const budget = await getBudgetById(client, budgetId);
  if (!budget) return null;

  const itemsTotal = await getBudgetItemsTotal(client, budgetId);
  const freight = round2(budget.freight_value || 0);

  return {
    budget_id: Number(budget.budget_id),
    items_total: itemsTotal,
    freight_value: freight,
    expected_total: round2(itemsTotal + freight)
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * API pública
 * ──────────────────────────────────────────────────────────────────── */

async function getById(id) {
  const budgetPaymentId = toInt(id);
  if (!budgetPaymentId) {
    throw new Error('budget_payment_id inválido.');
  }

  const sql = `
    ${SELECT_PAYMENTS_SQL}
    WHERE bp.${quoteIdent(PK)} = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [budgetPaymentId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

async function listByBudget(budgetId) {
  const safeBudgetId = toInt(budgetId);
  if (!safeBudgetId) {
    throw new Error('budget_id inválido.');
  }

  const sql = `
    ${SELECT_PAYMENTS_SQL}
    WHERE bp.budget_id = $1
    ORDER BY ${PAYMENT_ORDER_BY}
  `;

  const { rows } = await pool.query(sql, [safeBudgetId]);
  return rows.map(mapRow);
}

async function create(payload = {}, options = {}) {
  const budgetId = toInt(payload.budget_id);
  const paymentMethodId = toInt(payload.payment_method_id);
  const amount = round2(payload.amount);
  const notes = normalizeText(payload.notes);
  const manualDueDate = normalizeIsoDate(payload.manual_due_date);

  const requestedBankAccountId = toInt(
    payload.bank_account_id
  );

  const autoGenerateInstallments = Boolean(
    payload.auto_generate_installments ?? options.auto_generate_installments ?? false
  );

  if (!budgetId) throw new Error('budget_id é obrigatório.');
  if (!paymentMethodId) throw new Error('payment_method_id é obrigatório.');
  if (amount < 0) throw new Error('amount não pode ser negativo.');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const budget = await getBudgetById(client, budgetId);
    if (!budget) {
      throw new Error('Budget não encontrado.');
    }

    const method = await getPaymentMethodById(client, paymentMethodId);
    if (!method) {
      throw new Error('Forma de pagamento não encontrada.');
    }

    if (method.active === false) {
      throw new Error('A forma de pagamento informada está inativa.');
    }

    const bankAccount = await resolveBankAccount(
      client,
      requestedBankAccountId
    );

    const budgetPaymentId = await insertPayment(
      client,
      buildPaymentRecord({
        budgetId,
        paymentMethodId,
        bankAccount,
        amount,
        notes,
        manualDueDate
      })
    );

    if (autoGenerateInstallments) {
      await budgetsPaymentInstallmentsApi.generateFromBudgetPayment(budgetPaymentId, { client });
    }

    await client.query('COMMIT');

    return getById(budgetPaymentId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function update(id, payload = {}, options = {}) {
  const budgetPaymentId = toInt(id);
  if (!budgetPaymentId) {
    throw new Error('budget_payment_id inválido.');
  }

  const current = await getById(budgetPaymentId);
  if (!current) return null;

  const paymentMethodId = payload.payment_method_id !== undefined
    ? toInt(payload.payment_method_id)
    : current.payment_method_id;

  const amount = payload.amount !== undefined
    ? round2(payload.amount)
    : current.amount;

  const notes = payload.notes !== undefined
    ? normalizeText(payload.notes)
    : current.notes;

  const manualDueDate = payload.manual_due_date !== undefined
    ? normalizeIsoDate(payload.manual_due_date)
    : current.manual_due_date;

  const requestedBankAccountId =
    payload.bank_account_id !== undefined
      ? toInt(payload.bank_account_id)
      : current.bank_account_id;

  const regenerateInstallments = Boolean(
    payload.regenerate_installments ?? options.regenerate_installments ?? false
  );

  if (!paymentMethodId) throw new Error('payment_method_id inválido.');
  if (amount < 0) throw new Error('amount não pode ser negativo.');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const method = await getPaymentMethodById(client, paymentMethodId);
    if (!method) {
      throw new Error('Forma de pagamento não encontrada.');
    }

    if (method.active === false) {
      throw new Error('A forma de pagamento informada está inativa.');
    }

    const bankAccount = await resolveBankAccount(
      client,
      requestedBankAccountId
    );

    await updatePayment(
      client,
      budgetPaymentId,
      buildPaymentRecord({
        budgetId: current.budget_id,
        paymentMethodId,
        bankAccount,
        amount,
        notes,
        manualDueDate
      })
    );

    if (regenerateInstallments) {
      await budgetsPaymentInstallmentsApi.generateFromBudgetPayment(budgetPaymentId, { client });
    }

    await client.query('COMMIT');

    return getById(budgetPaymentId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function remove(id) {
  const budgetPaymentId = toInt(id);
  if (!budgetPaymentId) {
    throw new Error('budget_payment_id inválido.');
  }

  const current = await getById(budgetPaymentId);
  if (!current) return null;

  await pool.query(
    `DELETE FROM ${TB_PAYMENTS} WHERE ${quoteIdent(PK)} = $1`,
    [budgetPaymentId]
  );

  return current;
}

async function removeByBudget(budgetId) {
  const safeBudgetId = toInt(budgetId);
  if (!safeBudgetId) {
    throw new Error('budget_id inválido.');
  }

  const rows = await listByBudget(safeBudgetId);

  await pool.query(
    `DELETE FROM ${TB_PAYMENTS} WHERE budget_id = $1`,
    [safeBudgetId]
  );

  return {
    budget_id: safeBudgetId,
    deleted_count: rows.length,
    rows
  };
}

async function regenerateInstallmentsFromPayment(id) {
  const budgetPaymentId = toInt(id);
  if (!budgetPaymentId) {
    throw new Error('budget_payment_id inválido.');
  }

  return budgetsPaymentInstallmentsApi.generateFromBudgetPayment(budgetPaymentId);
}

async function regenerateInstallmentsFromBudget(budgetId) {
  const safeBudgetId = toInt(budgetId);
  if (!safeBudgetId) {
    throw new Error('budget_id inválido.');
  }

  return budgetsPaymentInstallmentsApi.generateFromBudget(safeBudgetId);
}

async function validateBudgetPaymentsTotal(budgetId) {
  const safeBudgetId = toInt(budgetId);
  if (!safeBudgetId) {
    throw new Error('budget_id inválido.');
  }

  const client = await pool.connect();

  try {
    const budget = await getBudgetById(client, safeBudgetId);
    if (!budget) {
      throw new Error('Budget não encontrado.');
    }

    const expected = await getExpectedBudgetTotal(client, safeBudgetId);
    const paymentsTotal = await getBudgetPaymentsSum(client, safeBudgetId);

    return {
      budget_id: safeBudgetId,
      items_total: expected?.items_total ?? 0,
      freight_value: expected?.freight_value ?? 0,
      expected_total: expected?.expected_total ?? 0,
      payments_total: paymentsTotal,
      difference: round2(paymentsTotal - (expected?.expected_total ?? 0)),
      is_balanced: round2(paymentsTotal) === round2(expected?.expected_total ?? 0)
    };
  } finally {
    client.release();
  }
}

async function replaceBudgetPayments(budgetId, payments = [], options = {}) {
  const safeBudgetId = toInt(budgetId);

  if (!safeBudgetId) {
    throw new Error('budget_id inválido.');
  }

  if (!Array.isArray(payments)) {
    throw new Error('payments deve ser um array.');
  }

  const installments = Array.isArray(options.installments)
    ? options.installments
    : [];

  const autoGenerateInstallments = Boolean(
    options.auto_generate_installments ?? true
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const budget = await getBudgetById(client, safeBudgetId);

    if (!budget) {
      throw new Error('Budget não encontrado.');
    }

    /*
     * Mantém o vínculo entre o pagamento que veio do frontend
     * e o novo budget_payment_id criado pelo REPLACE.
     */
    const created = [];
    const paymentMap = [];

    /*
     * O replace recria os pagamentos.
     *
     * As parcelas antigas são removidas pelo ON DELETE CASCADE de
     * budgetsPaymentInstallments (ver referencedBy no catálogo).
     */
    await client.query(
      `DELETE FROM ${TB_PAYMENTS} WHERE budget_id = $1`,
      [safeBudgetId]
    );

    for (let paymentIndex = 0; paymentIndex < payments.length; paymentIndex += 1) {
      const item = payments[paymentIndex] || {};
      const lineLabel = `na linha ${paymentIndex + 1}`;

      const paymentMethodId = toInt(item.payment_method_id);
      const amount = round2(item.amount);
      const notes = normalizeText(item.notes);
      const manualDueDate = normalizeIsoDate(item.manual_due_date);

      if (!paymentMethodId) {
        throw new Error(
          `payment_method_id é obrigatório ${lineLabel}.`
        );
      }

      if (amount < 0) {
        throw new Error(
          `amount não pode ser negativo ${lineLabel}.`
        );
      }

      const method = await getPaymentMethodById(client, paymentMethodId);

      if (!method) {
        throw new Error(
          `Forma de pagamento não encontrada: ${paymentMethodId}`
        );
      }

      if (method.active === false) {
        throw new Error(
          `Forma de pagamento inativa: ${paymentMethodId}`
        );
      }

      const bankAccount = await resolveBankAccount(
        client,
        item.bank_account_id
      );

      const newBudgetPaymentId = await insertPayment(
        client,
        buildPaymentRecord({
          budgetId: safeBudgetId,
          paymentMethodId,
          bankAccount,
          amount,
          notes,
          manualDueDate
        }),
        lineLabel
      );

      /*
       * Guarda os dois IDs para conseguirmos associar as parcelas
       * que vieram do frontend às parcelas do novo pagamento.
       */
      paymentMap.push({
        payment_index: paymentIndex,

        old_budget_payment_id:
          toInt(
            item.budget_payment_id ??
            item.payment_id
          ),

        payment_method_id:
          paymentMethodId,

        bank_account_id:
          bankAccount.bank_account_id,

        collection_provider:
          bankAccount.collection_provider,

        boleto_mode:
          bankAccount.boleto_mode,

        new_budget_payment_id:
          newBudgetPaymentId
      });

      /*
       * Gera a estrutura base das parcelas.
       *
       * Depois, logo abaixo, os vencimentos manuais enviados
       * pelo frontend são reaplicados sobre essas parcelas.
       */
      if (autoGenerateInstallments) {
        await budgetsPaymentInstallmentsApi.generateFromBudgetPayment(
          newBudgetPaymentId,
          { client }
        );
      }

      created.push(newBudgetPaymentId);
    }

    /*
     * ============================================================
     * PRESERVA VENCIMENTOS EDITADOS MANUALMENTE
     * ============================================================
     *
     * O frontend deve enviar:
     *
     * {
     *   payments: [...],
     *   installments: [
     *     {
     *       budget_payment_id,
     *       payment_method_id,
     *       installment_number,
     *       due_date,
     *       amount,
     *       status
     *     }
     *   ]
     * }
     *
     * Como os pagamentos foram recriados, os IDs mudaram.
     * paymentMap faz a associação do ID antigo com o novo.
     */
    if (installments.length) {
      for (let installmentIndex = 0; installmentIndex < installments.length; installmentIndex += 1) {
        const installment = installments[installmentIndex] || {};

        const installmentNumber = toInt(
          installment.installment_number ??
          installment.parcela ??
          installment.number
        );

        if (!installmentNumber || installmentNumber < 1) {
          continue;
        }

        const dueDate = normalizeIsoDate(
          installment.due_date ??
          installment.manual_due_date ??
          installment.data_vencimento ??
          installment.vencimento
        );

        /*
         * Se não existe vencimento válido, não sobrescrevemos
         * a data calculada automaticamente.
         */
        if (!dueDate) {
          continue;
        }

        const oldBudgetPaymentId = toInt(
          installment.budget_payment_id ??
          installment.payment_id
        );

        const installmentPaymentMethodId = toInt(
          installment.payment_method_id ??
          installment.paymentMethods_id ??
          installment.method_id
        );

        const explicitPaymentIndex = toInt(
          installment.payment_index,
          null
        );

        let mappedPayment = null;

        /*
         * 1) Melhor associação: payment_index.
         *
         * Útil principalmente quando existem duas formas de
         * pagamento iguais no mesmo orçamento.
         */
        if (
          explicitPaymentIndex !== null &&
          explicitPaymentIndex >= 0
        ) {
          mappedPayment =
            paymentMap.find(
              (row) =>
                row.payment_index === explicitPaymentIndex
            ) || null;
        }

        /*
         * 2) Associação pelo budget_payment_id antigo.
         */
        if (!mappedPayment && oldBudgetPaymentId) {
          mappedPayment =
            paymentMap.find(
              (row) =>
                row.old_budget_payment_id === oldBudgetPaymentId
            ) || null;
        }

        /*
         * 3) Fallback pelo método de pagamento.
         */
        if (!mappedPayment && installmentPaymentMethodId) {
          mappedPayment =
            paymentMap.find(
              (row) =>
                row.payment_method_id === installmentPaymentMethodId
            ) || null;
        }

        /*
         * 4) Último fallback:
         * se há somente um pagamento, a associação é inequívoca.
         */
        if (!mappedPayment && paymentMap.length === 1) {
          mappedPayment = paymentMap[0];
        }

        if (!mappedPayment) {
          console.warn(
            '[budgetsPaymentsApi][replace] Não foi possível mapear parcela manual.',
            {
              installmentIndex,
              oldBudgetPaymentId,
              installmentPaymentMethodId,
              installmentNumber
            }
          );

          continue;
        }

        const params = [
          mappedPayment.new_budget_payment_id,
          installmentNumber,
          dueDate
        ];

        /*
         * Atualiza exatamente a parcela recém-gerada.
         */
        const updateSql = `
          UPDATE ${TB_INSTALLMENTS}
             SET due_date = $3
           WHERE ${quoteIdent(REF_INSTALLMENTS.column)} = $1
             AND installment_number = $2
        `;

        const updateResult = await client.query(
          updateSql,
          params
        );

        /*
         * Se auto_generate_installments=false e nenhuma parcela
         * existir, criamos a parcela com os dados enviados.
         */
        if (
          updateResult.rowCount === 0 &&
          !autoGenerateInstallments
        ) {
          const installmentAmount = round2(
            installment.amount
          );

          const status = normalizeText(
            installment.status,
            'PENDENTE'
          );

          const notesInstallment = normalizeText(
            installment.notes
          );

          await client.query(
            `
              INSERT INTO ${TB_INSTALLMENTS} (
                ${quoteIdent(REF_INSTALLMENTS.column)},
                budget_id,
                installment_number,
                due_date,
                amount,
                status,
                paid_amount,
                paid_at,
                notes
              )
              VALUES ($1,$2,$3,$4,$5,$6,0,NULL,$7)
            `,
            [
              mappedPayment.new_budget_payment_id,
              safeBudgetId,
              installmentNumber,
              dueDate,
              installmentAmount,
              status,
              notesInstallment
            ]
          );
        }
      }
    }

    await client.query('COMMIT');

    const rows = [];

    for (const id of created) {
      const row = await getById(id);

      if (row) {
        rows.push(row);
      }
    }

    const validation =
      await validateBudgetPaymentsTotal(
        safeBudgetId
      );

    return {
      budget_id: safeBudgetId,
      count: rows.length,
      rows,
      payment_map: paymentMap,
      installments_received: installments.length,
      validation
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
}


export default {
  getById,
  listByBudget,
  create,
  update,
  remove,
  removeByBudget,
  regenerateInstallmentsFromPayment,
  regenerateInstallmentsFromBudget,
  validateBudgetPaymentsTotal,
  replaceBudgetPayments
};
