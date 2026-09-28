/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: budgetsPaymentInstallmentsApi.js                              ║
   ║ MODULE: Budget Payment Installments                                 ║
   ║ DESCRIPTION: DAL/API para parcelas de pagamento dos budgets         ║
   ║ CONSART ERP · PostgreSQL · ESM                                      ║
   ║                                                                      ║
   ║ Tabelas relacionadas:                                                ║
   ║ - public."budgetsPayments"                                           ║
   ║ - public."budgetsPaymentInstallments"                                ║
   ║ - public."paymentMethods"                                            ║
   ║ - public.budgets                                                     ║
   ║                                                                      ║
   ║ Estrutura de public."budgetsPaymentInstallments" vem do              ║
   ║ catalog_schema: colunas, defaults, enums/CHECKs, tamanhos, UNIQUE    ║
   ║ e FK. Tabelas de pagamentos/formas de pagamento vêm do catálogo      ║
   ║ de budgetsPayments.                                                  ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import pool from '../../../config/db.js';
import installmentsSchema, {
  INSTALLMENT_STATUSES
} from './catalog_schema.budgetsPaymentInstallments.js';

import budgetsPaymentsSchema from '../budgetsPayments/catalog_schema.budgetsPayments.js';

/* ──────────────────────────────────────────────────────────────────────
 * Catálogo → SQL
 * ──────────────────────────────────────────────────────────────────── */

const CATALOG = installmentsSchema;
const COLUMNS = CATALOG.columns;
const PK = CATALOG.primaryKey;

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function qualifyTable(schema, table) {
  return `${schema}.${quoteIdent(table)}`;
}

function foreignKeyFor(catalog, column) {
  const fk = catalog.foreignKeys.find((row) => row.column === column);
  if (!fk) {
    throw new Error(`[catalog_schema.${catalog.table}] FK ausente para a coluna ${column}.`);
  }
  return fk;
}

const FK_PAYMENT = foreignKeyFor(CATALOG, 'budget_payment_id');
const FK_METHOD = foreignKeyFor(budgetsPaymentsSchema, 'payment_method_id');

const TB_INSTALLMENTS = qualifyTable(CATALOG.schema, CATALOG.table);
const TB_BUDGETS_PAYMENTS = qualifyTable(budgetsPaymentsSchema.schema, FK_PAYMENT.references.table);
const TB_PAYMENT_METHODS = qualifyTable(budgetsPaymentsSchema.schema, FK_METHOD.references.table);
const TB_BUDGETS = 'public.budgets';

const Q_PK = quoteIdent(PK);
const Q_PAYMENT_FK = quoteIdent(FK_PAYMENT.column);
const Q_PAYMENT_PK = quoteIdent(FK_PAYMENT.references.column);
const Q_METHOD_FK = quoteIdent(FK_METHOD.column);
const Q_METHOD_PK = quoteIdent(FK_METHOD.references.column);

const DEFAULT_STATUS = COLUMNS.status.default;
const DEFAULT_PAID_AMOUNT = COLUMNS.paid_amount.default;

const UNIQUE_INSTALLMENT_NUMBER = CATALOG.uniques.find(
  (row) => row.columns.includes('installment_number')
);

function orderBySql(orderBy) {
  return orderBy
    .map(({ column, direction }) => `i.${quoteIdent(column)} ${direction === 'DESC' ? 'DESC' : 'ASC'}`)
    .join(', ');
}

const ORDER_BY_BUDGET = orderBySql([
  ...CATALOG.defaultOrderBy,
  { column: PK, direction: 'ASC' }
]);

const ORDER_BY_PAYMENT = orderBySql([
  { column: 'installment_number', direction: 'ASC' },
  { column: PK, direction: 'ASC' }
]);

const SELECT_INSTALLMENTS_SQL = `
    SELECT
      ${Object.keys(COLUMNS).map((column) => `i.${quoteIdent(column)}`).join(',\n      ')},
      bp.${Q_METHOD_FK} AS payment_method_id,
      pm.name AS payment_method_name,
      pm.type AS payment_method_type
    FROM ${TB_INSTALLMENTS} i
    LEFT JOIN ${TB_BUDGETS_PAYMENTS} bp
      ON bp.${Q_PAYMENT_PK} = i.${Q_PAYMENT_FK}
    LEFT JOIN ${TB_PAYMENT_METHODS} pm
      ON pm.${Q_METHOD_PK} = bp.${Q_METHOD_FK}
`;

const INSERT_INSTALLMENT_SQL = `
    INSERT INTO ${TB_INSTALLMENTS} (
      ${CATALOG.insertable.map(quoteIdent).join(',\n      ')}
    )
    VALUES (${CATALOG.insertable.map((_, i) => `$${i + 1}`).join(', ')})
    RETURNING ${Q_PK}
`;

/*
 * updated_at não entra no SET: o trigger
 * trg_budgetspaymentinstallments_updated_at (BEFORE UPDATE) cuida dele.
 */
const UPDATE_INSTALLMENT_SQL = `
    UPDATE ${TB_INSTALLMENTS}
       SET ${CATALOG.updatable.map((column, i) => `${quoteIdent(column)} = $${i + 2}`).join(',\n           ')}
     WHERE ${Q_PK} = $1
     RETURNING ${Q_PK}
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

function normalizeStatus(status, fallback = DEFAULT_STATUS) {
  const value = String(status ?? '').trim().toUpperCase();
  if (!value) return fallback;

  if (!INSTALLMENT_STATUSES.includes(value)) {
    throw new Error(
      `status inválido: "${status}". Valores aceitos: ${INSTALLMENT_STATUSES.join(', ')}.`
    );
  }

  return value;
}

function normalizeNotes(value) {
  return value != null ? String(value).trim() : null;
}

function toTimestamp(value, column) {
  if (value == null || value === '') return null;

  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`${column} inválido: "${value}".`);
  }

  return dt;
}

/*
 * O driver pg devolve colunas DATE como Date na meia-noite LOCAL.
 * toISOString() converteria para UTC e, num servidor com fuso positivo,
 * voltaria um dia; por isso Date usa os componentes locais.
 */
function toDateOnly(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  const asString = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;

  const dt = new Date(asString);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/*
 * Aritmética de datas inteiramente em UTC: sem o "Z" a data-base era lida
 * no fuso do servidor e podia deslocar um dia fora de UTC-3.
 */
function addDays(dateInput, days = 0) {
  const base = new Date(`${toDateOnly(dateInput)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function splitAmount(total, parts) {
  const totalCents = Math.round(toNumber(total, 0) * 100);
  const qty = Math.max(toInt(parts, 1) || 1, 1);

  const base = Math.floor(totalCents / qty);
  let remainder = totalCents - (base * qty);

  const result = [];
  for (let i = 0; i < qty; i += 1) {
    const cents = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    result.push(Number((cents / 100).toFixed(2)));
  }

  return result;
}

function normalizeInstallmentsCount(methodRow) {
  const raw = toInt(methodRow?.installments, 1) || 1;
  return Math.max(raw, 1);
}

function extractGaps(methodRow, installmentsCount) {
  const gaps = [
    toInt(methodRow?.gap_one, 0) || 0,
    toInt(methodRow?.gap_two, 0) || 0,
    toInt(methodRow?.gap_three, 0) || 0,
    toInt(methodRow?.gap_four, 0) || 0,
    toInt(methodRow?.gap_five, 0) || 0,
    toInt(methodRow?.gap_six, 0) || 0,
    toInt(methodRow?.gap_seven, 0) || 0,
    toInt(methodRow?.gap_eight, 0) || 0,
    toInt(methodRow?.gap_nine, 0) || 0,
    toInt(methodRow?.gap_ten, 0) || 0
  ];

  const normalized = [];

  for (let i = 0; i < installmentsCount; i += 1) {
    normalized.push(gaps[i] ?? 0);
  }

  if (normalized.length === 0) {
    normalized.push(0);
  }

  return normalized;
}

/* ──────────────────────────────────────────────────────────────────────
 * Validação, escrita e mapeamento pelo catálogo
 * ──────────────────────────────────────────────────────────────────── */

function fitText(value, column) {
  const max = COLUMNS[column].maxLength;
  if (value == null || !max) return value;
  return value.length > max ? value.slice(0, max) : value;
}

function validateInstallmentRecord(record, columns) {
  for (const column of columns) {
    const def = COLUMNS[column];
    const value = record[column];

    if (value == null) {
      if (def.nullable === false) {
        throw new Error(`${column} é obrigatório.`);
      }
      continue;
    }

    if (def.enum && !def.enum.includes(value)) {
      throw new Error(
        `${column} inválido: "${value}". Valores aceitos: ${def.enum.join(', ')}.`
      );
    }

    if (def.maxLength && String(value).length > def.maxLength) {
      throw new Error(`${column} excede ${def.maxLength} caracteres.`);
    }

    if (def.min != null && Number(value) < def.min) {
      throw new Error(`${column} não pode ser negativo.`);
    }

    if (def.type === 'numeric' && def.precision != null) {
      const scale = def.scale ?? 0;
      const max = 10 ** (def.precision - scale) - 10 ** -scale;
      if (Math.abs(Number(value)) > max) {
        throw new Error(
          `${column} excede o limite de numeric(${def.precision},${scale}).`
        );
      }
    }
  }
}

function translateDbError(error, record = {}) {
  if (
    error?.code === '23505' &&
    error.constraint === UNIQUE_INSTALLMENT_NUMBER?.name
  ) {
    return new Error(
      `Já existe a parcela ${record.installment_number} para o pagamento ${record.budget_payment_id}.`
    );
  }

  if (error?.code === '23503' && error.constraint === FK_PAYMENT.name) {
    return new Error(
      `Linha de pagamento do budget não encontrada: ${record.budget_payment_id}.`
    );
  }

  return error;
}

async function insertInstallment(db, record) {
  validateInstallmentRecord(record, CATALOG.insertable);

  try {
    const { rows } = await db.query(
      INSERT_INSTALLMENT_SQL,
      CATALOG.insertable.map((column) => record[column])
    );
    return Number(rows[0][PK]);
  } catch (error) {
    throw translateDbError(error, record);
  }
}

async function updateInstallment(db, installmentId, record) {
  validateInstallmentRecord(record, CATALOG.updatable);

  await db.query(UPDATE_INSTALLMENT_SQL, [
    installmentId,
    ...CATALOG.updatable.map((column) => record[column])
  ]);
}

function mapInstallmentColumns(row) {
  const out = {};

  for (const [column, def] of Object.entries(COLUMNS)) {
    const value = row[column];

    if (value == null) {
      out[column] = null;
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
        out[column] = toDateOnly(value);
        break;
      default:
        out[column] = value;
    }
  }

  return out;
}

function mapInstallment(row) {
  return {
    ...mapInstallmentColumns(row),

    payment_method_id: row.payment_method_id != null ? Number(row.payment_method_id) : null,
    payment_method_name: row.payment_method_name || null,
    payment_method_type: row.payment_method_type || null
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * Leituras (aceitam pool ou client de transação)
 * ──────────────────────────────────────────────────────────────────── */

async function fetchById(db, installmentId) {
  const sql = `
    ${SELECT_INSTALLMENTS_SQL}
    WHERE i.${Q_PK} = $1
    LIMIT 1
  `;

  const { rows } = await db.query(sql, [installmentId]);
  return rows[0] ? mapInstallment(rows[0]) : null;
}

async function fetchByBudgetPayment(db, budgetPaymentId) {
  const sql = `
    ${SELECT_INSTALLMENTS_SQL}
    WHERE i.${Q_PAYMENT_FK} = $1
    ORDER BY ${ORDER_BY_PAYMENT}
  `;

  const { rows } = await db.query(sql, [budgetPaymentId]);
  return rows.map(mapInstallment);
}

async function getBudgetPaymentSource(client, budgetPaymentId) {
  const sql = `
    SELECT
      bp.${Q_PAYMENT_PK} AS budget_payment_id,
      bp.budget_id,
      bp.${Q_METHOD_FK} AS payment_method_id,
      bp.amount,
      bp.notes,
      bp.manual_due_date,

      b.issue_date,
      b.status AS budget_status,

      pm.${Q_METHOD_PK} AS payment_method_id_ref,
      pm.name AS payment_method_name,
      pm.type AS payment_method_type,
      pm.installments,
      pm.gap_one,
      pm.gap_two,
      pm.gap_three,
      pm.gap_four,
      pm.gap_five,
      pm.gap_six,
      pm.gap_seven,
      pm.gap_eight,
      pm.gap_nine,
      pm.gap_ten,
      pm.active
    FROM ${TB_BUDGETS_PAYMENTS} bp
    LEFT JOIN ${TB_BUDGETS} b
      ON b.budget_id = bp.budget_id
    LEFT JOIN ${TB_PAYMENT_METHODS} pm
      ON pm.${Q_METHOD_PK} = bp.${Q_METHOD_FK}
    WHERE bp.${Q_PAYMENT_PK} = $1
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [budgetPaymentId]);
  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────────────
 * API pública
 * ──────────────────────────────────────────────────────────────────── */

async function getById(id) {
  const installmentId = toInt(id);
  if (!installmentId) {
    throw new Error('ID da parcela inválido.');
  }

  return fetchById(pool, installmentId);
}

async function listByBudget(budgetId) {
  const safeBudgetId = toInt(budgetId);
  if (!safeBudgetId) {
    throw new Error('budget_id inválido.');
  }

  const sql = `
    ${SELECT_INSTALLMENTS_SQL}
    WHERE i.budget_id = $1
    ORDER BY ${ORDER_BY_BUDGET}
  `;

  const { rows } = await pool.query(sql, [safeBudgetId]);
  return rows.map(mapInstallment);
}

async function listByBudgetPayment(budgetPaymentId) {
  const safeBudgetPaymentId = toInt(budgetPaymentId);
  if (!safeBudgetPaymentId) {
    throw new Error('budget_payment_id inválido.');
  }

  return fetchByBudgetPayment(pool, safeBudgetPaymentId);
}

async function create(payload = {}) {
  const record = {
    budget_payment_id: toInt(payload.budget_payment_id),
    budget_id: toInt(payload.budget_id),
    installment_number: toInt(payload.installment_number),
    due_date: toDateOnly(payload.due_date),
    amount: round2(payload.amount),
    status: normalizeStatus(payload.status),
    paid_amount: round2(payload.paid_amount ?? DEFAULT_PAID_AMOUNT),
    paid_at: toTimestamp(payload.paid_at, 'paid_at'),
    notes: normalizeNotes(payload.notes)
  };

  if (!record.budget_payment_id) throw new Error('budget_payment_id é obrigatório.');
  if (!record.budget_id) throw new Error('budget_id é obrigatório.');
  if (!record.installment_number || record.installment_number < 1) {
    throw new Error('installment_number inválido.');
  }

  const installmentId = await insertInstallment(pool, record);
  return getById(installmentId);
}

async function update(id, payload = {}) {
  const installmentId = toInt(id);
  if (!installmentId) throw new Error('ID da parcela inválido.');

  const current = await getById(installmentId);
  if (!current) return null;

  const next = {
    due_date: payload.due_date !== undefined ? toDateOnly(payload.due_date) : current.due_date,
    amount: payload.amount !== undefined ? round2(payload.amount) : current.amount,
    status: payload.status !== undefined ? normalizeStatus(payload.status, current.status) : current.status,
    paid_amount: payload.paid_amount !== undefined ? round2(payload.paid_amount) : current.paid_amount,
    paid_at: payload.paid_at !== undefined ? toTimestamp(payload.paid_at, 'paid_at') : current.paid_at,
    notes: payload.notes !== undefined ? normalizeNotes(payload.notes) : current.notes
  };

  await updateInstallment(pool, installmentId, next);

  return getById(installmentId);
}

async function remove(id) {
  const installmentId = toInt(id);
  if (!installmentId) throw new Error('ID da parcela inválido.');

  const current = await getById(installmentId);
  if (!current) return null;

  await pool.query(
    `DELETE FROM ${TB_INSTALLMENTS} WHERE ${Q_PK} = $1`,
    [installmentId]
  );

  return current;
}

async function removeByBudgetPayment(budgetPaymentId) {
  const safeBudgetPaymentId = toInt(budgetPaymentId);
  if (!safeBudgetPaymentId) throw new Error('budget_payment_id inválido.');

  const deleted = await listByBudgetPayment(safeBudgetPaymentId);

  await pool.query(
    `DELETE FROM ${TB_INSTALLMENTS} WHERE ${Q_PAYMENT_FK} = $1`,
    [safeBudgetPaymentId]
  );

  return {
    deleted_count: deleted.length,
    rows: deleted
  };
}

async function generateFromBudgetPayment(budgetPaymentId, options = {}) {
  const safeBudgetPaymentId = toInt(budgetPaymentId);
  if (!safeBudgetPaymentId) throw new Error('budget_payment_id inválido.');

  const externalClient = options.client || null;
  const client = externalClient || await pool.connect();

  try {
    if (!externalClient) await client.query('BEGIN');

    const source = await getBudgetPaymentSource(client, safeBudgetPaymentId);
    if (!source) {
      throw new Error('Linha de pagamento do budget não encontrada.');
    }

    if (!source.payment_method_id_ref) {
      throw new Error('payment_method_id da budgetsPayments não encontrado em paymentMethods.');
    }

    const budgetId = toInt(source.budget_id);
    const totalAmount = round2(source.amount);
    // ========================================================================
    // REGRA DE GERAÇÃO DAS DATAS
    // ========================================================================
    //
    // O prazo normal parte da data corrente em São Paulo, salvo base_date
    // explícita. Se existir manual_due_date, ela representa o vencimento
    // real da PRIMEIRA parcela, e não uma nova data-base para somar gap_1.
    //
    // ========================================================================
    // DATA-BASE / VENCIMENTO MANUAL
    // ========================================================================
    //
    // Regra:
    // - Sem manual_due_date:
    //     cada gap é absoluto em relação à data-base.
    //
    //   Ex.: base 23/08 + gaps 7/14
    //        => 30/08 e 06/09
    //
    // - Com manual_due_date:
    //     a primeira parcela vence EXATAMENTE na data informada.
    //     As próximas preservam o intervalo entre gap_1 e gap_n.
    //
    //   Ex.: manual 30/08 + gaps 7/14
    //        => 30/08 e 06/09
    //
    const configuredBaseDate = toDateOnly(
      options.base_date ||
      todayInSaoPaulo()
    );

    const manualDueDate = toDateOnly(
      source.manual_due_date
    );

    if (!budgetId) throw new Error('budget_id inválido para geração de parcelas.');
    if (totalAmount < 0) throw new Error('amount da linha de pagamento é inválido.');

    const installmentsCount = normalizeInstallmentsCount(source);
    const gaps = extractGaps(source, installmentsCount);
    const amounts = splitAmount(totalAmount, installmentsCount);

    await client.query(
      `DELETE FROM ${TB_INSTALLMENTS} WHERE ${Q_PAYMENT_FK} = $1`,
      [safeBudgetPaymentId]
    );

    /*
     * notes da parcela tem o mesmo limite que notes do pagamento; com o
     * prefixo, uma observação longa estourava varchar(255) e abortava a
     * geração inteira.
     */
    const note = fitText(
      source.notes
        ? `Gerado automaticamente | ${String(source.notes).trim()}`
        : 'Gerado automaticamente',
      'notes'
    );

    for (let i = 0; i < installmentsCount; i += 1) {
      const installmentNumber = i + 1;
      let dueDate = null;

      if (manualDueDate) {
        if (i === 0) {
          // Primeira parcela = exatamente a data informada pelo usuário.
          dueDate = manualDueDate;
        } else {
          // Próximas parcelas mantêm o espaçamento configurado
          // em relação à primeira condição (gap_1).
          const firstGap = Number(gaps[0] || 0);
          const currentGap = Number(gaps[i] || 0);
          const relativeDays = currentGap - firstGap;

          dueDate = addDays(
            manualDueDate,
            relativeDays
          );
        }
      } else {
        // Sem vencimento manual:
        // cada gap é absoluto em relação à data-base.
        dueDate = addDays(
          configuredBaseDate,
          gaps[i] || 0
        );
      }

      if (!dueDate) {
        throw new Error(
          `Não foi possível calcular o vencimento da parcela ${installmentNumber}.`
        );
      }

      await insertInstallment(client, {
        budget_payment_id: safeBudgetPaymentId,
        budget_id: budgetId,
        installment_number: installmentNumber,
        due_date: dueDate,
        amount: amounts[i],
        status: DEFAULT_STATUS,
        paid_amount: DEFAULT_PAID_AMOUNT,
        paid_at: null,
        notes: note
      });
    }

    if (!externalClient) await client.query('COMMIT');

    /*
     * Lê pelo MESMO client: com transação externa as parcelas ainda não
     * foram commitadas, e uma leitura pelo pool devolvia rows vazio.
     */
    const generatedRows = await fetchByBudgetPayment(client, safeBudgetPaymentId);

    return {
      budget_payment_id: safeBudgetPaymentId,
      budget_id: budgetId,
      payment_method_id: Number(source.payment_method_id_ref),
      payment_method_name: source.payment_method_name || null,
      payment_method_type: source.payment_method_type || null,
      installments_count: installmentsCount,
      total_amount: totalAmount,
      base_date: configuredBaseDate,
      manual_due_date: manualDueDate,
      rows: generatedRows
    };
  } catch (error) {
    if (!externalClient) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (!externalClient) client.release();
  }
}

async function generateFromBudget(budgetId, options = {}) {
  const safeBudgetId = toInt(budgetId);
  if (!safeBudgetId) throw new Error('budget_id inválido.');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
      SELECT ${Q_PAYMENT_PK} AS budget_payment_id
        FROM ${TB_BUDGETS_PAYMENTS}
       WHERE budget_id = $1
       ORDER BY ${Q_PAYMENT_PK} ASC
      `,
      [safeBudgetId]
    );

    const results = [];

    for (const row of rows) {
      const generated = await generateFromBudgetPayment(row.budget_payment_id, {
        client,
        base_date: options.base_date
      });
      results.push(generated);
    }

    await client.query('COMMIT');

    return {
      budget_id: safeBudgetId,
      payments_count: rows.length,
      generated: results
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
  listByBudgetPayment,
  create,
  update,
  remove,
  removeByBudgetPayment,
  generateFromBudgetPayment,
  generateFromBudget
};
