// ╔══════════════════════════════════════════════════════════════════╗
// ║ accountsReceivableApi.js — Service/API Contas a Receber          ║
// ║ CONSART ERP — integração com Asaas via tabela ponte              ║
// ║                                                                  ║
// ║ ✅ FIXES (2026-02-23):                                            ║
// ║  - LIST/GET prioriza bankSlipPdfUrl (PDF)                         ║
// ║  - Fallback GET payment do Asaas cacheia URLs no raw (merge)      ║
// ║  - getBoletoDownloadInfo prioriza PDF e agora prioriza LOCAL      ║
// ║                                                                  ║
// ║ ✅ ADD (2026-02-23):                                              ║
// ║  - Baixa PDF do boleto e salva local em /public/boletos           ║
// ║  - Cacheia boleto_pdf_url_local no raw (PATCH/MERGE)              ║
// ║  - Não quebra fluxo se download falhar (best effort)              ║
// ║                                                                  ║
// ║ ✅ ADD (2026-09-16):                                              ║
// ║  - Coluna "Banco" (account_bank) via public."bankAccounts"        ║
// ║  - Ordenação e busca pelo banco                                   ║
// ║  - Contas do Asaas sem banco usam a conta bancária Asaas ativa    ║
// ║  - Sync do Asaas grava bank_account_id quando estiver vazio       ║
// ║  - Ordenação estável (desempate por ar.id) e por created_at       ║
// ║  - Cancelamento de boleto usa transação em um único client        ║
// ║  - Filtro por Conta Bancária (bankAccountId / NONE)               ║
// ║  - Lista de contas bancárias para o filtro                        ║
// ║  - "Conta Caixa" do formulário/recebimento grava bank_account_id  ║
// ║  - updateAccount só altera cash/bank_account_id se enviados       ║
// ║                                                                  ║
// ║ ✅ ADD (2026-09-23):                                              ║
// ║  - Recebimento (manual, cadastro/edição ou Asaas) gera ENTRADA    ║
// ║    em public."cashMoviments" (accounts_receivable_id)             ║
// ║  - Estorno desativa a ENTRADA (is_active = false)                 ║
// ║  - Receber/criar/editar gravam conta + caixa na mesma transação   ║
// ║                                                                  ║
// ║ Tabelas:                                                         ║
// ║   public."accountsReceivable"                                    ║
// ║   public."accountsReceivableAsaas" (PONTE)                        ║
// ║   public."customers"                                             ║
// ║   public."bankAccounts"                                          ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';
import * as asaasApi from './asaasApi.js';

import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TB = 'public."accountsReceivable"';
const TB_BRIDGE = 'public."accountsReceivableAsaas"';
const TB_CUSTOMERS = 'public."customers"';
const TB_BANK_ACCOUNTS = 'public."bankAccounts"';
const TB_CASH_CATEGORIES = 'public."cashCategories"';
const TB_CASH_SUBCATEGORIES = 'public."cashSubcategories"';
const TB_CASH_DOCUMENT_TYPES = 'public."cashDocumentTypes"';
const TB_CHART_OF_ACCOUNTS = 'public."chartOfAccounts"';

// -------------------------------------------------------------------
// Conta bancária Asaas padrão
// Usada para contas sincronizadas do Asaas que não têm bank_account_id.
// O PostgreSQL executa esta subquery uma única vez por consulta.
// -------------------------------------------------------------------
const ASAAS_BANK_ACCOUNT_ID_SQL = `(
  SELECT x.id
  FROM ${TB_BANK_ACCOUNTS} x
  WHERE x.integration_provider = 'ASAAS'
    AND x.is_active = TRUE
  ORDER BY x.is_default DESC, x.id ASC
  LIMIT 1
)`;

const ASAAS_BANK_ACCOUNT_NAME_SQL = `(
  SELECT x.name
  FROM ${TB_BANK_ACCOUNTS} x
  WHERE x.integration_provider = 'ASAAS'
    AND x.is_active = TRUE
  ORDER BY x.is_default DESC, x.id ASC
  LIMIT 1
)`;

/**
 * ID da conta bancária efetiva (mesma regra da coluna "Banco").
 * Usado pelo filtro "Conta Bancária" para bater com o que a tela mostra.
 */
function effectiveBankAccountIdSql(arAlias = 'ar', bridgeAlias = 'asa') {
  return `
    COALESCE(
      ${arAlias}.bank_account_id,
      CASE
        WHEN ${bridgeAlias}.id IS NOT NULL THEN ${ASAAS_BANK_ACCOUNT_ID_SQL}
      END
    )
  `;
}

/**
 * Nome do banco exibido na coluna "Banco".
 * 1) banco gravado na própria conta a receber (ar.bank_account_id)
 * 2) se a conta veio do Asaas (tem ponte), usa a conta Asaas ativa
 */
function accountBankSql(bankAlias = 'ba', bridgeAlias = 'asa') {
  return `
    COALESCE(
      ${bankAlias}.name,
      CASE
        WHEN ${bridgeAlias}.id IS NOT NULL THEN ${ASAAS_BANK_ACCOUNT_NAME_SQL}
      END
    )
  `;
}

const AR_DIAGNOSTIC_FIELDS = [
  'customer_id',
  'invoice_number',
  'document_number',
  'issue_date',
  'due_date',
  'payment_date',
  'payment_method_id',
  'document_type_id',
  'category_id',
  'subcategory_id',
  'cash_account_id',
  'bank_account_id',
  'chart_account_id',
  'fine',
  'interest',
  'charges',
  'status',
];

function persistenceDiagnostic(source = {}) {
  return Object.fromEntries(
    AR_DIAGNOSTIC_FIELDS.map((field) => [
      field,
      source[field] === undefined ? '[undefined]' : source[field],
    ])
  );
}

function postgresErrorDiagnostic(error) {
  return {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    detail: error?.detail,
    hint: error?.hint,
    constraint: error?.constraint,
    schema: error?.schema,
    table: error?.table,
    column: error?.column,
  };
}

async function runPersistenceQuery(operation, sql, params, context, executor = pool) {
  console.info(`[AR:PERSIST:${operation}] request`, context);

  try {
    const { rows } = await executor.query(sql, params);
    console.info(
      `[AR:PERSIST:${operation}] database-result`,
      rows[0]
        ? { id: rows[0].id, ...persistenceDiagnostic(rows[0]) }
        : { row: null }
    );
    return rows;
  } catch (error) {
    console.error(
      `[AR:PERSIST:${operation}] postgres-error`,
      postgresErrorDiagnostic(error)
    );
    throw error;
  }
}

// -------------------------------------------------------------------
// Paths (ESM)
// -------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// este arquivo geralmente fica em backend/services/apis/
// então ../../public aponta para backend/public
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const BOLETOS_DIR = path.resolve(PUBLIC_DIR, 'boletos');

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[AR] ensureDir falhou:', dir, e?.message || e);
  }
}

function safeFilename(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 180);
}

async function tryDownloadPdfBuffer(url) {
  if (!url) return null;

  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-store',
      },
    });

    const buf = Buffer.from(resp.data || []);
    const ct = String(resp.headers?.['content-type'] || '').toLowerCase();
    const sig = buf.slice(0, 4).toString(); // %PDF

    const isPdf = sig === '%PDF' || ct.includes('pdf');
    if (!isPdf || buf.length < 800) {
      console.warn('[AR] Conteúdo não é PDF válido ao baixar boleto.', {
        url: String(url).slice(0, 200),
        contentType: ct || null,
        signature: sig || null,
        size: buf.length || 0,
      });
      return null;
    }

    return buf;
  } catch (e) {
    console.warn('[AR] Falha ao baixar PDF do boleto:', e?.message || e);
    return null;
  }
}

function saveBoletoToDisk(pdfBuffer, asaasPaymentId, invoiceNumber = null) {
  if (!pdfBuffer || !asaasPaymentId) return null;

  ensureDir(BOLETOS_DIR);

  const base = invoiceNumber
    ? `boleto-${safeFilename(invoiceNumber)}-${safeFilename(asaasPaymentId)}.pdf`
    : `boleto-${safeFilename(asaasPaymentId)}.pdf`;

  const filename = safeFilename(base);
  const absPath = path.join(BOLETOS_DIR, filename);

  try {
    fs.writeFileSync(absPath, pdfBuffer);
    return `/public/boletos/${filename}`; // URL servida pelo Express estático
  } catch (e) {
    console.warn('[AR] Falha ao salvar boleto em disco:', e?.message || e);
    return null;
  }
}

// -------------------------------------------------------------------
// DDL da tabela ponte
// -------------------------------------------------------------------
const DDL = `
CREATE TABLE IF NOT EXISTS ${TB_BRIDGE} (
  id                      BIGSERIAL PRIMARY KEY,
  accounts_receivable_id  BIGINT REFERENCES ${TB}(id) ON DELETE CASCADE,
  asaas_payment_id        VARCHAR(80) UNIQUE NOT NULL,
  asaas_customer_id       VARCHAR(80),
  asaas_customer_name     TEXT,
  last_status             TEXT,
  raw                     JSONB,
  created_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  updated_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_accounts_receivable_asaas_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_accounts_receivable_asaas_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_accounts_receivable_asaas_set_updated_at
    BEFORE UPDATE ON ${TB_BRIDGE}
    FOR EACH ROW
    EXECUTE PROCEDURE trg_accounts_receivable_asaas_set_updated_at();
  END IF;
END;
$$;
`;

pool.query(DDL).catch((err) => {
  console.error('[AR][DDL] Erro ao criar tabela ponte Asaas:', err.message);
});

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function isAsaasCustomerId(v) {
  return /^cus_/i.test(String(v ?? '').trim());
}

function normalizeErpCustomerId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeBankAccountId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function mapStatusFromAsaas(asaasStatus) {
  switch (asaasStatus) {
    case 'PENDING': return 'PENDING';
    case 'RECEIVED': return 'PAID';
    case 'OVERDUE': return 'OVERDUE';
    case 'CONFIRMED': return 'PAID';
    case 'REFUNDED': return 'CANCELLED';
    case 'CANCELLED': return 'CANCELLED';
    default: return asaasStatus || 'UNKNOWN';
  }
}

/* ===================================================================
   CAIXA — ENTRADA automática para contas recebidas
   Toda conta a receber recebida (manual ou Asaas) gera 1 movimentação
   em public."cashMoviments", vinculada por accounts_receivable_id
   (índice único ux_cashmoviments_accounts_receivable_id).
   - Estorno (deixa de estar recebida) → movimentação fica is_active = false
   - Contas já recebidas antes deste recurso não geram movimentação:
     cria quando a conta PASSA a recebida ou quando o recebimento é
     a partir de AR_CASH_MOVEMENT_START_DATE (permite reprocessar o Asaas)
   =================================================================== */
const TB_CASH_MOVEMENTS = 'public."cashMoviments"';
const RECEIVED_STATUSES = new Set(['PAID', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const AR_CASH_MOVEMENT_START_DATE =
  process.env.AR_CASH_MOVEMENT_START_DATE || '2026-09-23';

function isReceivedStatus(status) {
  return RECEIVED_STATUSES.has(String(status || '').trim().toUpperCase());
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : null;
}

function cut(value, max) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str.slice(0, max) : null;
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cria / reativa / desativa a ENTRADA de caixa de uma conta a receber.
 *
 * @param {object} executor  pool ou client (dentro de transação)
 * @param {number|string} accountId
 * @param {object} [opts]
 * @param {boolean} [opts.isTransition=false] a conta acabou de passar a recebida
 * @param {boolean} [opts.refresh=false] atualiza a movimentação já existente
 * @param {string}  [opts.movementDate] data/hora do recebimento (YYYY-MM-DDTHH:mm)
 * @param {object}  [opts.breakdown] { amount, interest, charges } do recebimento manual
 * @returns {Promise<{ action: string, id?: number }>}
 */
export async function syncReceivableCashMovement(executor, accountId, {
  isTransition = false,
  refresh = false,
  movementDate = null,
  breakdown = null,
} = {}) {
  const { rows: accountRows } = await executor.query(
    `
    SELECT
      ar.id,
      ar.status,
      ar.value,
      ar.amount_paid,
      ar.payment_date,
      ar.description,
      ar.invoice_number,
      ar.document_number,
      ar.category_id,
      ar.subcategory_id,
      ar.chart_account_id,
      COALESCE(
        NULLIF(TRIM(c.trade_name), ''),
        NULLIF(TRIM(c.legal_name), ''),
        asa.asaas_customer_name
      ) AS customer_name,
      ${accountBankSql('ba', 'asa')} AS bank_name,
      ${effectiveBankAccountIdSql('ar', 'asa')} AS effective_bank_account_id,
      dt.name AS document_type_name,
      (asa.id IS NOT NULL) AS is_asaas
    FROM ${TB} ar
    LEFT JOIN ${TB_CUSTOMERS} c ON c.customer_id = ar.customer_id
    LEFT JOIN ${TB_BANK_ACCOUNTS} ba ON ba.id = ar.bank_account_id
    LEFT JOIN ${TB_CASH_DOCUMENT_TYPES} dt ON dt.id = ar.document_type_id
    LEFT JOIN LATERAL (
      SELECT b.id, b.asaas_customer_name
      FROM ${TB_BRIDGE} b
      WHERE b.accounts_receivable_id = ar.id
      ORDER BY b.id DESC
      LIMIT 1
    ) asa ON TRUE
    WHERE ar.id = $1
    `,
    [accountId]
  );

  const account = accountRows[0];
  if (!account) return { action: 'account-not-found' };

  const { rows: cashRows } = await executor.query(
    `
    SELECT id, is_active
    FROM ${TB_CASH_MOVEMENTS}
    WHERE accounts_receivable_id = $1
    FOR UPDATE
    `,
    [account.id]
  );
  const existing = cashRows[0] || null;

  // Estorno / cancelamento: desativa, mantendo o histórico
  if (!isReceivedStatus(account.status)) {
    if (existing?.is_active) {
      await executor.query(
        `UPDATE ${TB_CASH_MOVEMENTS} SET is_active = FALSE, updated_at = now() WHERE id = $1`,
        [existing.id]
      );
      return { action: 'deactivated', id: Number(existing.id) };
    }
    return { action: 'none' };
  }

  // Asaas RECEIVED_IN_CASH chega com amount_paid = 0 → usa o valor da conta
  const total = money(Number(account.amount_paid) > 0 ? account.amount_paid : account.value);
  if (total <= 0) return { action: 'skipped-zero' };

  let amount = total;
  let interest = 0;
  let charges = 0;
  if (breakdown) {
    interest = money(breakdown.interest);
    charges = money(breakdown.charges);
    amount = money(breakdown.amount);
    // Garante Total do caixa = valor recebido
    if (amount < 0 || money(amount + interest + charges) !== total) {
      amount = total;
      interest = 0;
      charges = 0;
    }
  }

  const paymentDate = toIsoDate(account.payment_date);
  const movementTimestamp = movementDate
    ? String(movementDate).replace('T', ' ').slice(0, 19)
    : `${paymentDate || toIsoDate(new Date())} 00:00:00`;

  const notes = [
    `Recebimento conta a receber #${account.id}`,
    account.description ? `– ${String(account.description).trim()}` : '',
    account.is_asaas ? '(Asaas)' : '',
  ].filter(Boolean).join(' ');

  const values = [
    movementTimestamp,                                              // $1 movement_date
    cut(account.bank_name, 50) || (account.is_asaas ? 'ASAAS' : 'CAIXA'), // $2 cash_account
    amount,                                                         // $3 amount
    cut(account.document_type_name, 20) || (account.is_asaas ? 'BOLETO' : null), // $4
    cut(account.invoice_number || account.document_number || `CR-${account.id}`, 50), // $5
    cut(account.customer_name, 255),                                // $6 supplier_name
    notes,                                                          // $7 notes
    interest,                                                       // $8 interest_amount
    charges,                                                        // $9 fee_amount
    account.category_id != null ? String(account.category_id) : null,       // $10
    account.subcategory_id != null ? String(account.subcategory_id) : null, // $11
    account.chart_account_id ?? null,                               // $12
    account.id,                                                     // $13
    account.effective_bank_account_id ?? null,                      // $14 bank_account_id
  ];

  if (existing) {
    if (!refresh && existing.is_active) return { action: 'unchanged', id: Number(existing.id) };

    await executor.query(
      `
      UPDATE ${TB_CASH_MOVEMENTS}
      SET
        movement_date    = $1,
        movement_type    = 'ENTRADA',
        cash_account     = $2,
        amount           = $3,
        document_type    = $4,
        document_number  = $5,
        supplier_name    = $6,
        notes            = $7,
        penalty_amount   = 0,
        interest_amount  = $8,
        fee_amount       = $9,
        category         = $10,
        subcategory      = $11,
        chart_account_id = $12,
        bank_account_id  = $14,
        is_active        = TRUE,
        updated_at       = now()
      WHERE accounts_receivable_id = $13
      `,
      values
    );
    return { action: existing.is_active ? 'updated' : 'reactivated', id: Number(existing.id) };
  }

  const isNewReceipt =
    isTransition || (paymentDate && paymentDate >= AR_CASH_MOVEMENT_START_DATE);
  if (!isNewReceipt) return { action: 'skipped-before-start-date' };

  const { rows: inserted } = await executor.query(
    `
    INSERT INTO ${TB_CASH_MOVEMENTS} (
      movement_date, movement_type, cash_account, amount,
      document_type, document_number, supplier_name, notes,
      penalty_amount, interest_amount, fee_amount,
      category, subcategory, chart_account_id,
      accounts_receivable_id, bank_account_id, is_active
    ) VALUES (
      $1, 'ENTRADA', $2, $3,
      $4, $5, $6, $7,
      0, $8, $9,
      $10, $11, $12,
      $13, $14, TRUE
    )
    ON CONFLICT (accounts_receivable_id) WHERE accounts_receivable_id IS NOT NULL
    DO NOTHING
    RETURNING id
    `,
    values
  );

  if (inserted[0]) {
    console.info('[AR:CAIXA] entrada criada', { accountId: account.id, cashMovementId: inserted[0].id, total });
    return { action: 'created', id: Number(inserted[0].id) };
  }
  return { action: 'already-exists' };
}

function effectiveStatusSql(alias = 'ar') {
  return `
    CASE
      WHEN UPPER(COALESCE(${alias}.status, 'PENDING')) = 'PENDING'
        AND ${alias}.due_date < CURRENT_DATE
      THEN 'OVERDUE'
      ELSE UPPER(COALESCE(${alias}.status, 'PENDING'))
    END
  `;
}

function normalizeStatusFilter(value) {
  const status = String(value || '').trim().toUpperCase();

  const aliases = {
    PENDENTE: 'PENDING',
    PAGO: 'PAID',
    VENCIDO: 'OVERDUE',
    PARCIAL: 'PARTIAL',
    CANCELADO: 'CANCELLED',
    CANCELED: 'CANCELLED',
  };

  return aliases[status] || status;
}

/* ===================================================================
   CATEGORIAS DO CAIXA — opções dos selects
   =================================================================== */
export async function listCashCategories() {
  const sql = `
    SELECT id, name
    FROM ${TB_CASH_CATEGORIES}
    WHERE is_active = TRUE
    ORDER BY name ASC, id ASC;
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

export async function listCashSubcategories({ categoryId } = {}) {
  const params = [];
  let categoryFilter = '';

  if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
    const normalizedCategoryId = Number(categoryId);

    if (!Number.isInteger(normalizedCategoryId) || normalizedCategoryId <= 0) {
      throw new Error('category_id inválido.');
    }

    params.push(normalizedCategoryId);
    categoryFilter = 'AND sc.category_id = $1';
  }

  const sql = `
    SELECT sc.id, sc.category_id, sc.name, sc.is_deductible, sc.dre_type
    FROM ${TB_CASH_SUBCATEGORIES} sc
    INNER JOIN ${TB_CASH_CATEGORIES} c
      ON c.id = sc.category_id
    WHERE sc.is_active = TRUE
      AND c.is_active = TRUE
      ${categoryFilter}
    ORDER BY sc.name ASC, sc.id ASC;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function listCashDocumentTypes() {
  const sql = `
    SELECT id, name
    FROM ${TB_CASH_DOCUMENT_TYPES}
    WHERE is_active = TRUE
    ORDER BY name ASC, id ASC;
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

export async function listChartOfAccounts() {
  const sql = `
    SELECT id, code, description, account_type, nature, level
    FROM ${TB_CHART_OF_ACCOUNTS}
    WHERE is_active = TRUE
      AND allows_posting = TRUE
    ORDER BY code ASC, description ASC, id ASC;
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

/* ===================================================================
   CONTAS BANCÁRIAS — opções do filtro "Conta Bancária"
   Inclui inativas (títulos antigos podem apontar para elas),
   listando as ativas primeiro.
   =================================================================== */
export async function listBankAccounts() {
  const sql = `
    SELECT
      id,
      name,
      agency,
      account_number,
      account_digit,
      integration_provider,
      is_default,
      is_active
    FROM ${TB_BANK_ACCOUNTS}
    ORDER BY is_active DESC, name ASC, id ASC;
  `;

  const { rows } = await pool.query(sql);
  return rows;
}

/**
 * PATCH/MERGE no raw da ponte sem apagar o que já existe.
 * Pode chamar por accounts_receivable_id.
 * Aceita um client opcional para rodar dentro de uma transação.
 */
async function persistAsaasRawForAr(accountsReceivableId, patchObj, db = pool) {
  const arId = toInt(accountsReceivableId, 0);
  if (!arId) return { ok: false, error: 'accountsReceivableId inválido' };

  const patch = JSON.stringify(patchObj || {});
  const sql = `
    UPDATE ${TB_BRIDGE}
       SET raw = COALESCE(raw, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
     WHERE accounts_receivable_id = $1
     RETURNING id, asaas_payment_id, accounts_receivable_id;
  `;
  const { rows } = await db.query(sql, [arId, patch]);
  return { ok: true, row: rows?.[0] || null };
}

/**
 * Busca info básica da ponte (urls + invoiceNumber + local)
 */
async function getBridgeBoletoFieldsByArId(arId) {
  const q = `
    SELECT
      asa.asaas_payment_id,
      COALESCE(asa.raw->>'invoiceNumber', asa.asaas_payment_id) AS invoice_number,

      -- ✅ prioriza coluna real
      asa.boleto_pdf_url_local AS boleto_pdf_url_local,

      -- ✅ melhor url para baixar/exibir (local > pdf > html)
      COALESCE(
        asa.boleto_pdf_url_local,
        asa.raw->>'bankSlipPdfUrl',
        asa.raw->>'bankSlipUrl',
        asa.raw->>'invoiceUrl',
        asa.raw->>'boleto_pdf_url_local'
      ) AS best_url,

      asa.raw->>'bankSlipPdfUrl' AS "bankSlipPdfUrl",
      asa.raw->>'bankSlipUrl' AS "bankSlipUrl",
      asa.raw->>'invoiceUrl' AS "invoiceUrl",

      -- ✅ billing type (para o controller)
      COALESCE(
        asa.raw->>'billingType',
        asa.raw->>'billing_type',
        asa.raw->>'type'
      ) AS billing_type

    FROM ${TB_BRIDGE} asa
    WHERE asa.accounts_receivable_id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(q, [arId]);
  return rows?.[0] || null;
}

/**----------------------------------------------------
 * Garante que exista boleto_pdf_url_local no raw.
 * Se já existe, retorna.
 * Se não, tenta:
 *  - usar bankSlipPdfUrl/bankSlipUrl já salvo
 *  - senão, faz GET /payments/:id e pega urls
 *  - baixa e salva local
 *  - faz PATCH/MERGE no raw
 **-----------------------------------------------------**/
async function ensureLocalBoletoForArId(accountsReceivableId) {
  const arId = toInt(accountsReceivableId, 0);
  if (!arId) return { ok: false, error: 'ID inválido' };

  const bridge = await getBridgeBoletoFieldsByArId(arId);
  if (!bridge?.asaas_payment_id) {
    return { ok: false, error: 'Conta não possui vínculo com Asaas (asaas_payment_id).' };
  }

  // 1) Já tem local
  const local = String(bridge.boleto_pdf_url_local || '').trim();
  if (local) return { ok: true, localUrl: local, asaas_payment_id: bridge.asaas_payment_id };

  // 2) Pega URL disponível no raw
  let url =
    bridge.bankSlipPdfUrl ||
    bridge.bankSlipUrl ||
    bridge.invoiceUrl ||
    null;

  // 3) Se não tem, faz GET payment no Asaas (read-only)
  let pay = null;
  if (!url) {
    try {
      pay = await asaasApi.getPayment(bridge.asaas_payment_id);
      url = pay?.bankSlipPdfUrl || pay?.bankSlipUrl || pay?.invoiceUrl || null;

      // cacheia urls úteis no raw (merge)
      await persistAsaasRawForAr(arId, {
        bankSlipPdfUrl: pay?.bankSlipPdfUrl || null,
        bankSlipUrl: pay?.bankSlipUrl || null,
        invoiceUrl: pay?.invoiceUrl || null,
      });
    } catch (e) {
      // best effort
      console.warn('[AR] ensureLocalBoletoForArId: falha GET payment:', e?.message || e);
    }
  }

  if (!url) return { ok: false, error: 'Boleto ainda não disponível no Asaas (sem URL).' };

  // 4) Baixa e salva local
  const pdf = await tryDownloadPdfBuffer(url);
  if (!pdf) return { ok: false, error: 'URL do boleto não retornou PDF válido (HTML ou inválido).' };

  const localUrl = saveBoletoToDisk(pdf, bridge.asaas_payment_id, bridge.invoice_number || null);
  if (!localUrl) return { ok: false, error: 'Falha ao salvar boleto local.' };

  // 5) grava local no raw (merge)
  await persistAsaasRawForAr(arId, { boleto_pdf_url_local: localUrl });

  return { ok: true, localUrl, asaas_payment_id: bridge.asaas_payment_id };
}

/* ===================================================================
   LISTAGEM — JOIN com customers (trade_name) e bankAccounts (banco)
   =================================================================== */
export async function listAccountsReceivable({
  status,
  search,
  bankAccountId,
  dateType,
  fromDate,
  toDate,
  fromIssueDate,
  toIssueDate,
  fromDueDate,
  toDueDate,
  page = 1,
  pageSize = 20,
  orderBy = 'id',
  orderDirection = 'asc',
} = {}) {
  page = toInt(page, 1);
  pageSize = toInt(pageSize, 20);
  const effectiveStatusExpression = effectiveStatusSql('ar');
  const accountBankExpression = accountBankSql('ba', 'asa');

  // Colunas autorizadas para ordenação.
  // Nunca inserir diretamente na SQL um nome recebido pela URL.
  const allowedOrderColumns = {
    id: 'ar.id',

    created_at: 'ar.created_at',

    customer_id: 'ar.customer_id',

    customer_name: `
    COALESCE(
      c.trade_name,
      asa.asaas_customer_name,
      asa.asaas_customer_id
    )
  `,

    account_bank: accountBankExpression,

    document_type_name: 'dt.name',

    invoice_number: `
    COALESCE(
      ar.invoice_number,
      asa.raw->>'invoiceNumber',
      asa.asaas_payment_id
    )
  `,

    issue_date: `
    COALESCE(
      ar.issue_date,
      (asa.raw->>'billingDate')::date,
      (asa.raw->>'dateCreated')::date,
      ar.created_at::date
    )
  `,

    due_date: 'ar.due_date',

    status: effectiveStatusExpression,

    total: 'ar.value',

    received: 'ar.amount_paid',

    balance: `
    (
      COALESCE(ar.value, 0) -
      COALESCE(ar.amount_paid, 0)
    )
  `,
  };

  const normalizedOrderBy =
    String(orderBy || 'id')
      .trim()
      .toLowerCase();

  const orderColumn =
    allowedOrderColumns[normalizedOrderBy] ||
    allowedOrderColumns.id;

  const direction =
    String(orderDirection || 'asc')
      .trim()
      .toLowerCase() === 'desc'
      ? 'DESC'
      : 'ASC';

  const where = [];
  const params = [];
  let idx = 1;

  const normalizedDateType =
    String(dateType || '').trim().toLowerCase() === 'issue_date' ||
      (!dateType && (fromIssueDate || toIssueDate))
      ? 'issue_date'
      : 'due_date';

  const selectedFromDate = fromDate || (
    normalizedDateType === 'issue_date' ? fromIssueDate : fromDueDate
  );
  const selectedToDate = toDate || (
    normalizedDateType === 'issue_date' ? toIssueDate : toDueDate
  );

  const issueDateExpression = `COALESCE(
    ar.issue_date,
    NULLIF(asa.raw->>'billingDate', '')::date,
    NULLIF(asa.raw->>'dateCreated', '')::date,
    ar.created_at::date
  )`;

  const dateExpression = normalizedDateType === 'issue_date'
    ? issueDateExpression
    : 'ar.due_date';

  if (status) {
    where.push(`${effectiveStatusExpression} = $${idx++}`);
    params.push(normalizeStatusFilter(status));
  }

  // Filtro "Conta Bancária":
  //  - vazio  => todas
  //  - NONE   => somente títulos sem banco
  //  - número => somente a conta bancária informada
  const normalizedBankAccountId =
    String(bankAccountId ?? '').trim().toUpperCase();

  if (normalizedBankAccountId === 'NONE') {
    where.push(`${effectiveBankAccountIdSql('ar', 'asa')} IS NULL`);
  } else if (/^\d+$/.test(normalizedBankAccountId)) {
    where.push(`${effectiveBankAccountIdSql('ar', 'asa')} = $${idx++}::bigint`);
    params.push(normalizedBankAccountId);
  }

  if (selectedFromDate) {
    where.push(`${dateExpression} >= $${idx++}::date`);
    params.push(selectedFromDate);
  }

  if (selectedToDate) {
    where.push(`${dateExpression} <= $${idx++}::date`);
    params.push(selectedToDate);
  }

  if (search) {
    where.push(`
      (
        ar.description ILIKE $${idx}
        OR ar.invoice_number ILIKE $${idx}
        OR ar.document_number ILIKE $${idx}
        OR LOWER(c.trade_name) LIKE LOWER($${idx})
        OR asa.asaas_customer_name ILIKE $${idx}
        OR (asa.raw->>'invoiceNumber') ILIKE $${idx}
        OR (asa.asaas_payment_id) ILIKE $${idx}
        OR ${accountBankExpression} ILIKE $${idx}
      )
    `);
    params.push(`%${search}%`);
    idx++;
  }

  const fromAndJoins = `
    FROM ${TB} ar
    LEFT JOIN ${TB_BRIDGE} asa
      ON asa.accounts_receivable_id = ar.id
    LEFT JOIN ${TB_CUSTOMERS} c
      ON c.customer_id = ar.customer_id
         OR (c.asaas_id IS NOT NULL AND c.asaas_id = asa.asaas_customer_id)
    LEFT JOIN ${TB_BANK_ACCOUNTS} ba
      ON ba.id = ar.bank_account_id
    LEFT JOIN ${TB_CASH_DOCUMENT_TYPES} dt
      ON dt.id = ar.document_type_id
  `;

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);

  const sql = `
    SELECT
      ar.id,
      ar.customer_id,
      asa.asaas_customer_id AS asaas_customer_id,

      COALESCE(c.trade_name, asa.asaas_customer_name, asa.asaas_customer_id) AS customer_name,

      ar.bank_account_id,
      ${accountBankExpression} AS account_bank,

      COALESCE(ar.invoice_number, asa.raw->>'invoiceNumber', asa.asaas_payment_id) AS invoice_number,
      ar.document_number,
      ar.document_type_id,
      dt.name AS document_type_name,
      ar.category_id,
      ar.subcategory_id,
      ar.payment_method_id,
      ar.cash_account_id,
      ar.chart_account_id,
      ar.fine,
      ar.interest,
      ar.charges,
      ar.notes,
      ar.attachment_url,
      COALESCE(
        ar.issue_date,
        (asa.raw->>'billingDate')::date,
        (asa.raw->>'dateCreated')::date,
        ar.created_at::date
      ) AS issue_date,

      COALESCE(
        asa.raw->>'boleto_pdf_url_local',
        asa.raw->>'bankSlipPdfUrl',
        asa.raw->>'bankSlipUrl',
        asa.raw->>'bank_slip_pdf_url',
        asa.raw->>'bank_slip_url',
        asa.raw->>'boleto_pdf_url',
        asa.raw->>'boleto_url'
      ) AS bank_slip_url,

      COALESCE(
        asa.raw->>'invoiceUrl',
        asa.raw->>'invoice_url'
      ) AS invoice_url,

      ar.description,
      ar.value,
      ar.amount_paid AS paid_value,
      ar.due_date,
      ar.payment_date,
      ${effectiveStatusExpression} AS status,
      ar.created_at,
      ar.updated_at
    ${fromAndJoins}
    ${whereSql}
    ORDER BY ${orderColumn} ${direction}, ar.id ${direction}
    LIMIT $${idx++} OFFSET $${idx};
  `;

  const { rows } = await pool.query(sql, params);

  const paramsCount = params.slice(0, params.length - 2);
  const sqlCount = `
    SELECT COUNT(*) AS total
    ${fromAndJoins}
    ${whereSql}
  `;
  const { rows: countRows } = await pool.query(sqlCount, paramsCount);
  const total = Number(countRows[0]?.total || 0);

  return {
    ok: true,
    data: rows,
    total,
    page,
    pageSize,
    pages: Math.ceil(total / pageSize) || 1,
  };
}

/* ===================================================================
   GET by ID
   =================================================================== */
export async function getById(id) {
  const sql = `
    SELECT
      ar.id,
      ar.customer_id,

      asa.asaas_payment_id,
      asa.asaas_customer_id AS asaas_customer_id,
      COALESCE(c.trade_name, asa.asaas_customer_name, asa.asaas_customer_id) AS customer_name,

      ar.bank_account_id,
      ${effectiveBankAccountIdSql('ar', 'asa')} AS effective_bank_account_id,
      ${accountBankSql('ba', 'asa')} AS account_bank,

      COALESCE(ar.invoice_number, asa.raw->>'invoiceNumber', asa.asaas_payment_id) AS invoice_number,
      ar.document_number,
      ar.document_type_id,
      ar.category_id,
      ar.subcategory_id,
      ar.payment_method_id,
      ar.cash_account_id,
      ar.chart_account_id,
      coa.code AS chart_account_code,
      coa.description AS chart_account_description,
      ar.fine,
      ar.interest,
      ar.charges,
      ar.notes,
      ar.attachment_url,
      COALESCE(
        ar.issue_date,
        (asa.raw->>'billingDate')::date,
        (asa.raw->>'dateCreated')::date,
        ar.created_at::date
      ) AS issue_date,

      -- ✅ billing type
      COALESCE(
        asa.raw->>'billingType',
        asa.raw->>'billing_type',
        asa.raw->>'type'
      ) AS billing_type,

      -- ✅ local salvo em coluna
      asa.boleto_pdf_url_local,

      -- ✅ URL do boleto priorizando local e PDF
      COALESCE(
        asa.boleto_pdf_url_local,
        asa.raw->>'bankSlipPdfUrl',
        asa.raw->>'bankSlipUrl',
        ar.boleto_url,
        asa.raw->>'invoiceUrl'
      ) AS bank_slip_url,

      COALESCE(
        asa.raw->>'invoiceUrl',
        asa.raw->>'invoice_url'
      ) AS invoice_url,

      ar.description,
      ar.value,
      ar.amount_paid AS paid_value,
      ar.due_date,
      ar.payment_date,
      ar.status,
      ar.created_at,
      ar.updated_at

    FROM ${TB} ar
    LEFT JOIN ${TB_BRIDGE} asa
      ON asa.accounts_receivable_id = ar.id
    LEFT JOIN ${TB_CUSTOMERS} c
      ON c.customer_id = ar.customer_id
         OR (c.asaas_id IS NOT NULL AND c.asaas_id = asa.asaas_customer_id)
    LEFT JOIN ${TB_BANK_ACCOUNTS} ba
      ON ba.id = ar.bank_account_id
    LEFT JOIN ${TB_CHART_OF_ACCOUNTS} coa
      ON coa.id = ar.chart_account_id
    WHERE ar.id = $1;
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

// -------------------------------------------------------------------
// CREATE / UPDATE
// -------------------------------------------------------------------
export async function createAccount(payload) {
  const {
    customer_id,
    description,
    value,
    due_date,
    payment_date,
    status,
    invoice_number,
    document_number,
    document_type_id,
    category_id,
    subcategory_id,
    issue_date,
    payment_method_id,
    cash_account_id,
    fine,
    interest,
    charges,
    notes,
    attachment_url,
    chart_account_id,
    bank_account_id,
  } = payload;

  if (isAsaasCustomerId(customer_id)) {
    throw new Error(
      '[accountsReceivableApi.createAccount] customer_id recebeu ID do Asaas. Use o customer_id interno do ERP.'
    );
  }

  const normalizedCustomerId = normalizeErpCustomerId(customer_id);

  const sql = `
    INSERT INTO ${TB} (
      customer_id,
      description,
      value,
      amount_paid,
      due_date,
      payment_date,
      status,
      invoice_number,
      document_number,
      document_type_id,
      category_id,
      subcategory_id,
      issue_date,
      payment_method_id,
      cash_account_id,
      fine,
      interest,
      charges,
      notes,
      attachment_url,
      chart_account_id,
      bank_account_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    RETURNING
      id,
      customer_id,
      description,
      value,
      amount_paid AS paid_value,
      due_date,
      payment_date,
      status,
      invoice_number,
      document_number,
      document_type_id,
      category_id,
      subcategory_id,
      issue_date,
      payment_method_id,
      cash_account_id,
      fine,
      interest,
      charges,
      notes,
      attachment_url,
      chart_account_id,
      bank_account_id,
      created_at,
      updated_at;
  `;

  const params = [
    normalizedCustomerId,
    description || '',
    Number(value || 0),
    Number(payload.paid_value || payload.amount_paid || 0),
    due_date,
    payment_date || null,
    status || 'PENDING',
    invoice_number || null,
    document_number || null,
    document_type_id || null,
    category_id || null,
    subcategory_id || null,
    issue_date || null,
    payment_method_id || null,
    cash_account_id || null,
    Number(fine || 0),
    Number(interest || 0),
    Number(charges || 0),
    notes || null,
    attachment_url || null,
    chart_account_id || null,
    normalizeBankAccountId(bank_account_id),
  ];

  return withTransaction(async (client) => {
    const rows = await runPersistenceQuery('CREATE', sql, params, {
      receivedKeys: Object.keys(payload).sort(),
      requested: persistenceDiagnostic(payload),
    }, client);
    const row = rows[0];

    // Conta já cadastrada como recebida → ENTRADA no caixa
    if (row && isReceivedStatus(row.status)) {
      await syncReceivableCashMovement(client, row.id, { isTransition: true });
    }
    return row;
  });
}

export async function updateAccount(id, payload) {
  const {
    customer_id,
    description,
    value,
    due_date,
    payment_date,
    status,
    paid_value,
    amount_paid,
    invoice_number,
    document_number,
    document_type_id,
    category_id,
    subcategory_id,
    issue_date,
    payment_method_id,
    cash_account_id,
    fine,
    interest,
    charges,
    notes,
    attachment_url,
    chart_account_id,
    bank_account_id,
  } = payload;

  if (isAsaasCustomerId(customer_id)) {
    throw new Error(
      '[accountsReceivableApi.updateAccount] customer_id recebeu ID do Asaas. Use o customer_id interno do ERP.'
    );
  }

  const normalizedCustomerId = normalizeErpCustomerId(customer_id);

  // cash_account_id e bank_account_id só mudam quando vierem no payload.
  // Assim, quem não envia esses campos não apaga o valor gravado.
  const sql = `
    UPDATE ${TB}
    SET
      customer_id  = $1,
      description  = $2,
      value        = $3,
      amount_paid  = $4,
      due_date     = $5,
      payment_date = $6,
      status       = $7,
      invoice_number = $8,
      document_number = $9,
      document_type_id = $10,
      category_id = $11,
      subcategory_id = $12,
      issue_date = $13,
      payment_method_id = $14,
      cash_account_id = CASE WHEN $23::boolean THEN $15 ELSE cash_account_id END,
      fine = $16,
      interest = $17,
      charges = $18,
      notes = $19,
      attachment_url = $20,
      chart_account_id = $21,
      bank_account_id = CASE WHEN $25::boolean THEN $24 ELSE bank_account_id END,
      updated_at   = now()
    WHERE id = $22
    RETURNING
      id,
      customer_id,
      description,
      value,
      amount_paid AS paid_value,
      due_date,
      payment_date,
      status,
      invoice_number,
      document_number,
      document_type_id,
      category_id,
      subcategory_id,
      issue_date,
      payment_method_id,
      cash_account_id,
      fine,
      interest,
      charges,
      notes,
      attachment_url,
      chart_account_id,
      bank_account_id,
      created_at,
      updated_at;
  `;

  const params = [
    normalizedCustomerId,
    description || '',
    Number(value || 0),
    Number(paid_value ?? amount_paid ?? 0),
    due_date,
    payment_date || null,
    status || 'PENDING',
    invoice_number || null,
    document_number || null,
    document_type_id || null,
    category_id || null,
    subcategory_id || null,
    issue_date || null,
    payment_method_id || null,
    cash_account_id || null,
    Number(fine || 0),
    Number(interest || 0),
    Number(charges || 0),
    notes || null,
    attachment_url || null,
    chart_account_id || null,
    id,
    hasOwn(payload, 'cash_account_id'),
    normalizeBankAccountId(bank_account_id),
    hasOwn(payload, 'bank_account_id'),
  ];

  return withTransaction(async (client) => {
    const { rows: previous } = await client.query(
      `SELECT status FROM ${TB} WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!previous[0]) return null;

    const rows = await runPersistenceQuery('UPDATE', sql, params, {
      accountId: id,
      receivedKeys: Object.keys(payload).sort(),
      requested: persistenceDiagnostic(payload),
    }, client);
    const row = rows[0] || null;

    // Passou a recebida → cria ENTRADA; deixou de ser recebida → desativa.
    // Edição de conta que continua recebida não sobrescreve o caixa.
    if (row) {
      await syncReceivableCashMovement(client, row.id, {
        isTransition: !isReceivedStatus(previous[0].status),
      });
    }
    return row;
  });
}

/* ===================================================================
   BOLETO — ATUALIZAR VENCIMENTO E VALOR
   Atualiza primeiro o Asaas e depois o PostgreSQL
=================================================================== */

export async function updateBoletoValueAndDueDate(
  accountsReceivableId,
  {
    due_date,
    value,
  } = {}
) {
  const id = Number(accountsReceivableId);
  const normalizedValue = Number(value);
  const normalizedDueDate =
    String(due_date || '').trim();

  /* -----------------------------------------------------------------
     1. Validação
  ----------------------------------------------------------------- */

  if (!Number.isInteger(id) || id <= 0) {
    const error =
      new Error('ID da conta a receber inválido.');

    error.statusCode = 400;
    throw error;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedDueDate
    )
  ) {
    const error =
      new Error('Informe um vencimento válido.');

    error.statusCode = 400;
    throw error;
  }

  if (
    !Number.isFinite(normalizedValue) ||
    normalizedValue <= 0
  ) {
    const error =
      new Error('Informe um valor maior que zero.');

    error.statusCode = 400;
    throw error;
  }

  /* -----------------------------------------------------------------
     2. Localiza a conta e seu boleto no Asaas
  ----------------------------------------------------------------- */

  const findSql = `
    SELECT
      ar.id,
      ar.status,
      ar.value,
      ar.amount_paid,
      ar.due_date,
      asa.asaas_payment_id
    FROM ${TB} ar
    LEFT JOIN ${TB_BRIDGE} asa
      ON asa.accounts_receivable_id = ar.id
    WHERE ar.id = $1
    LIMIT 1;
  `;

  const {
    rows: accountRows,
  } = await pool.query(findSql, [id]);

  const account = accountRows[0];

  if (!account) {
    const error =
      new Error('Conta a receber não encontrada.');

    error.statusCode = 404;
    throw error;
  }

  const currentStatus =
    String(account.status || '').toUpperCase();

  if (
    currentStatus === 'PAID' ||
    currentStatus === 'CANCELLED'
  ) {
    const error = new Error(
      currentStatus === 'PAID'
        ? 'Não é possível alterar um boleto já recebido.'
        : 'Não é possível alterar um boleto cancelado.'
    );

    error.statusCode = 409;
    throw error;
  }

  const amountPaid =
    Number(account.amount_paid || 0);

  if (normalizedValue < amountPaid) {
    const error = new Error(
      'O novo valor não pode ser menor que o valor já recebido.'
    );

    error.statusCode = 400;
    throw error;
  }

  const asaasPaymentId =
    String(account.asaas_payment_id || '').trim();

  if (!asaasPaymentId) {
    const error = new Error(
      'Esta conta não possui um boleto vinculado ao Asaas.'
    );

    error.statusCode = 400;
    throw error;
  }

  /* -----------------------------------------------------------------
     3. Atualiza primeiro no Asaas
  ----------------------------------------------------------------- */

  let updatedAsaasPayment;

  try {
    updatedAsaasPayment =
      await asaasApi.updatePayment(
        asaasPaymentId,
        {
          dueDate: normalizedDueDate,
          value: normalizedValue,
        }
      );
  } catch (error) {
    console.error(
      '[AR][UPDATE-BOLETO][ASAAS]',
      {
        accountsReceivableId: id,
        asaasPaymentId,
        dueDate: normalizedDueDate,
        value: normalizedValue,
        error: error?.message || String(error),
      }
    );

    const asaasError = new Error(
      error?.message ||
      'O Asaas recusou a alteração do boleto.'
    );

    asaasError.statusCode =
      Number(error?.response?.status) || 502;

    throw asaasError;
  }

  /* -----------------------------------------------------------------
     4. Atualiza PostgreSQL
  ----------------------------------------------------------------- */

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateAccountSql = `
      UPDATE ${TB}
      SET
        due_date  = $1,
        value     = $2,
        updated_at = now()
      WHERE id = $3
        AND UPPER(COALESCE(status, '')) NOT IN (
          'PAID',
          'CANCELLED'
        )
      RETURNING
        id,
        customer_id,
        invoice_number,
        description,
        due_date,
        value,
        amount_paid,
        status,
        created_at,
        updated_at;
    `;

    const {
      rows: updatedRows,
    } = await client.query(
      updateAccountSql,
      [
        normalizedDueDate,
        normalizedValue,
        id,
      ]
    );

    const updatedAccount =
      updatedRows[0];

    if (!updatedAccount) {
      const error = new Error(
        'A situação da conta mudou durante a atualização. Sincronize novamente com o Asaas.'
      );

      error.statusCode = 409;
      throw error;
    }

    const rawPatch = {
      dueDate:
        updatedAsaasPayment?.dueDate ||
        normalizedDueDate,

      value:
        Number(
          updatedAsaasPayment?.value ??
          normalizedValue
        ),

      updatedByErp: true,
      updatedByErpAt:
        new Date().toISOString(),
    };

    const updateBridgeSql = `
      UPDATE ${TB_BRIDGE}
      SET
        raw = COALESCE(raw, '{}'::jsonb)
          || $1::jsonb,
        updated_at = now()
      WHERE accounts_receivable_id = $2
        AND asaas_payment_id = $3;
    `;

    await client.query(
      updateBridgeSql,
      [
        JSON.stringify(rawPatch),
        id,
        asaasPaymentId,
      ]
    );

    await client.query('COMMIT');

    return {
      ...updatedAccount,

      asaas_payment_id:
        asaasPaymentId,

      asaas: {
        id:
          updatedAsaasPayment?.id ||
          asaasPaymentId,

        dueDate:
          updatedAsaasPayment?.dueDate ||
          normalizedDueDate,

        value:
          Number(
            updatedAsaasPayment?.value ??
            normalizedValue
          ),

        status:
          updatedAsaasPayment?.status ||
          currentStatus,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');

    console.error(
      '[AR][UPDATE-BOLETO][POSTGRES]',
      {
        accountsReceivableId: id,
        asaasPaymentId,
        error: error?.message || String(error),
      }
    );

    throw error;
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------------
// REGISTRO DE RECEBIMENTO
// -------------------------------------------------------------------
export async function receivePayment(id, payload) {
  const original = Number(payload.original_value || 0);
  const discount = Number(payload.discount || 0);
  const interest = Number(payload.interest || 0);
  const charges = Number(payload.charges || 0);

  const pago = original - discount + interest + charges;

  const sql = `
    UPDATE ${TB}
    SET
      amount_paid  = $1,
      payment_date = COALESCE($2::date, CURRENT_DATE),
      status       = 'PAID',
      document_type_id = COALESCE($3, document_type_id),
      category_id = COALESCE($4, category_id),
      subcategory_id = COALESCE($5, subcategory_id),
      cash_account_id = COALESCE($6, cash_account_id),
      chart_account_id = COALESCE($7, chart_account_id),
      interest = $8,
      charges = $9,
      notes = COALESCE($10, notes),
      bank_account_id = COALESCE($12, bank_account_id),
      updated_at   = now()
    WHERE id = $11
    RETURNING
      id,
      customer_id,
      description,
      value,
      amount_paid AS paid_value,
      due_date,
      payment_date,
      status,
      cash_account_id,
      bank_account_id,
      created_at,
      updated_at;
  `;

  const paymentDate = payload.payment_datetime
    ? payload.payment_datetime.substring(0, 10)
    : null;

  const queryParams = [
    pago,
    paymentDate,
    payload.document_type_id || null,
    payload.category_id || null,
    payload.subcategory_id || null,
    payload.cash_account_id || null,
    payload.chart_account_id || null,
    interest,
    charges,
    payload.notes || null,
    id,
    normalizeBankAccountId(payload.bank_account_id),
  ];

  // Baixa + ENTRADA no caixa na mesma transação (ou grava tudo, ou nada)
  return withTransaction(async (client) => {
    const { rows: previous } = await client.query(
      `SELECT status FROM ${TB} WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!previous[0]) return null;

    const rows = await runPersistenceQuery('RECEIVE', sql, queryParams, {
      accountId: id,
      receivedKeys: Object.keys(payload).sort(),
      requested: persistenceDiagnostic(payload),
      calculatedAmountPaid: pago,
    }, client);
    const row = rows[0] || null;
    if (!row) return null;

    const cash = await syncReceivableCashMovement(client, row.id, {
      isTransition: !isReceivedStatus(previous[0].status),
      refresh: true,
      movementDate: payload.payment_datetime || null,
      breakdown: { amount: original - discount, interest, charges },
    });

    return { ...row, cash_movement_id: cash.id ?? null };
  });
}

// -------------------------------------------------------------------
// UPSERT de um payment do Asaas -> tabela local + ponte
// -------------------------------------------------------------------
async function upsertFromAsaasPayment(payment) {
  const {
    id: asaas_payment_id,
    customer: asaas_customer_id,
    customerName,
    clientName,
    name,
    status: asaas_status,
    description,
    billingDate,
    dueDate,
    paymentDate,
    value,
    netValue,
  } = payment;

  let asaas_customer_name = customerName || clientName || name || null;

  // tenta mapear cliente ASAAS -> ERP
  let localCustomerId = null;

  if (asaas_customer_id) {
    try {
      // 1) tenta pelo asaas_id salvo no cadastro do cliente
      const qByAsaasId = `
        SELECT customer_id, trade_name
        FROM ${TB_CUSTOMERS}
        WHERE asaas_id = $1
        LIMIT 1;
      `;
      const { rows: byAsaasId } = await pool.query(qByAsaasId, [asaas_customer_id]);

      if (byAsaasId[0]) {
        localCustomerId = byAsaasId[0].customer_id;
        if (!asaas_customer_name) asaas_customer_name = byAsaasId[0].trade_name;
      }

      // 2) fallback: busca o cliente no Asaas e tenta localizar no ERP por CPF/CNPJ ou e-mail
      if (!localCustomerId) {
        let asaasCustomer = null;

        try {
          asaasCustomer = await asaasApi.getCustomer(asaas_customer_id);
        } catch (err) {
          console.warn(
            '[AR][upsertFromAsaasPayment] não foi possível consultar customer no Asaas:',
            err?.message || err
          );
        }

        const cpfCnpj = String(
          asaasCustomer?.cpfCnpj ||
          asaasCustomer?.cpf_cnpj ||
          ''
        ).replace(/\D+/g, '');

        const email = String(asaasCustomer?.email || '').trim().toLowerCase();

        if (!asaas_customer_name) {
          asaas_customer_name =
            asaasCustomer?.name ||
            asaasCustomer?.tradeName ||
            asaasCustomer?.company ||
            null;
        }

        if (cpfCnpj) {
          const qByDoc = `
            SELECT customer_id, trade_name
            FROM ${TB_CUSTOMERS}
            WHERE regexp_replace(COALESCE(tax_id, ''), '\\D', '', 'g') = $1
            LIMIT 1;
          `;
          const { rows: byDoc } = await pool.query(qByDoc, [cpfCnpj]);

          if (byDoc[0]) {
            localCustomerId = byDoc[0].customer_id;
            if (!asaas_customer_name) asaas_customer_name = byDoc[0].trade_name;

            // opcional: já grava o vínculo do asaas_id no cadastro do cliente
            await pool.query(
              `
              UPDATE ${TB_CUSTOMERS}
              SET asaas_id = COALESCE(asaas_id, $1)
              WHERE customer_id = $2
              `,
              [asaas_customer_id, localCustomerId]
            );
          }
        }

        if (!localCustomerId && email) {
          const qByEmail = `
            SELECT customer_id, trade_name
            FROM ${TB_CUSTOMERS}
            WHERE LOWER(COALESCE(email, '')) = $1
            LIMIT 1;
          `;
          const { rows: byEmail } = await pool.query(qByEmail, [email]);

          if (byEmail[0]) {
            localCustomerId = byEmail[0].customer_id;
            if (!asaas_customer_name) asaas_customer_name = byEmail[0].trade_name;

            // opcional: já grava o vínculo do asaas_id no cadastro do cliente
            await pool.query(
              `
              UPDATE ${TB_CUSTOMERS}
              SET asaas_id = COALESCE(asaas_id, $1)
              WHERE customer_id = $2
              `,
              [asaas_customer_id, localCustomerId]
            );
          }
        }
      }
    } catch (e) {
      console.error('[AR][upsertFromAsaasPayment] erro ao mapear cliente:', e?.message || e);
    }
  }

  // 1) Procura na ponte se já existe esse payment
  const qBridge = `
    SELECT accounts_receivable_id
    FROM ${TB_BRIDGE}
    WHERE asaas_payment_id = $1
  `;
  const { rows: bridgeRows } = await pool.query(qBridge, [asaas_payment_id]);
  let arId = bridgeRows[0]?.accounts_receivable_id || null;

  const mappedStatus = mapStatusFromAsaas(asaas_status);
  const desc = description || `Asaas ${asaas_payment_id}`;
  const val = Number(value || 0);
  const paid = ['RECEIVED', 'CONFIRMED'].includes(asaas_status)
    ? Number(netValue || value || 0)
    : 0;
  const due = dueDate || billingDate || null;
  const payDt = paymentDate || null;

  // Cobranças criadas após uma NF-e usam a descrição padronizada:
  // "NF-e 8866 - Parcela 002". O número fiscal é propriedade do ERP;
  // payment.invoiceNumber é apenas o identificador interno do Asaas.
  const fiscalDescriptionMatch = String(description || '').match(
    /NF-e\s+([0-9]+)\s*-\s*Parcela\s+([0-9]+)/i
  );
  const fiscalInvoiceNumber = fiscalDescriptionMatch
    ? `${fiscalDescriptionMatch[1]}/${String(
      Number(fiscalDescriptionMatch[2]) || 1
    ).padStart(3, '0')}`
    : null;
  const externalReference = String(
    payment?.externalReference || ''
  ).trim() || null;

  if (!arId) {
    // bank_account_id: cobrança do Asaas recebe a conta bancária Asaas ativa
    const sqlInsert = `
      INSERT INTO ${TB} (
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
        bank_account_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, ${ASAAS_BANK_ACCOUNT_ID_SQL})
      RETURNING id;
    `;
    const paramsInsert = [
      localCustomerId,
      desc,
      val,
      paid,
      due,
      payDt,
      mappedStatus,
      fiscalInvoiceNumber,
      externalReference,
      billingDate || null,
    ];
    const { rows: newRows } = await pool.query(sqlInsert, paramsInsert);
    arId = newRows[0].id;
  } else {
    // bank_account_id: só preenche quando estiver vazio (nunca sobrescreve)
    const sqlUpdate = `
      UPDATE ${TB}
      SET
        customer_id  = COALESCE($1, customer_id),
        description  = $2,
        value        = $3,
        amount_paid  = $4,
        due_date     = $5,
        payment_date = $6,
        status       = $7,
        invoice_number = COALESCE(
          NULLIF(TRIM(invoice_number), ''),
          $8
        ),
        document_number = COALESCE(
          NULLIF(TRIM(document_number), ''),
          $9
        ),
        issue_date = COALESCE(issue_date, $10::date),
        bank_account_id = COALESCE(bank_account_id, ${ASAAS_BANK_ACCOUNT_ID_SQL}),
        updated_at   = now()
      WHERE id = $11;
    `;
    const paramsUpdate = [
      localCustomerId,
      desc,
      val,
      paid,
      due,
      payDt,
      mappedStatus,
      fiscalInvoiceNumber,
      externalReference,
      billingDate || null,
      arId,
    ];
    await pool.query(sqlUpdate, paramsUpdate);
  }

  // Upsert na ponte (raw completo)
  const raw = JSON.stringify(payment);
  const sqlBridgeUpsert = `
    INSERT INTO ${TB_BRIDGE} (
      accounts_receivable_id,
      asaas_payment_id,
      asaas_customer_id,
      asaas_customer_name,
      last_status,
      raw
    ) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (asaas_payment_id)
    DO UPDATE SET
      accounts_receivable_id = EXCLUDED.accounts_receivable_id,
      asaas_customer_id      = EXCLUDED.asaas_customer_id,
      asaas_customer_name    = EXCLUDED.asaas_customer_name,
      last_status            = EXCLUDED.last_status,
      raw                    = EXCLUDED.raw,
      updated_at             = now();
  `;
  const paramsBridge = [
    arId,
    asaas_payment_id,
    asaas_customer_id || null,
    asaas_customer_name || null,
    asaas_status || null,
    raw,
  ];
  await pool.query(sqlBridgeUpsert, paramsBridge);

  // ENTRADA no caixa (após a ponte, para identificar a conta como Asaas).
  // Falha aqui não interrompe o sync: sem vínculo criado, o próximo sync
  // tenta de novo (recebimentos a partir de AR_CASH_MOVEMENT_START_DATE).
  try {
    await syncReceivableCashMovement(pool, arId);
  } catch (err) {
    console.error('[AR][upsertFromAsaasPayment] erro ao gerar movimentação de caixa:', {
      accountId: arId,
      asaasPaymentId: asaas_payment_id,
      error: err?.message || err,
    });
  }

  return arId;
}

// -------------------------------------------------------------------
// SYNC FROM ASAAS
// -------------------------------------------------------------------
export async function syncFromAsaas({ from, to, status } = {}) {
  const limit = 100;
  let offset = 0;
  let synced = 0;
  let pages = 0;

  while (true) {
    const data = await asaasApi.listPayments({
      tipoData: 'dueDate',
      dataInicio: from,
      dataFim: to,
      status,
      limit,
      offset,
      sort: 'dueDate',
      order: 'asc',
    });

    const list = Array.isArray(data?.data) ? data.data : [];

    for (const payment of list) {
      await upsertFromAsaasPayment(payment);
      synced += 1;
    }

    pages += 1;

    if (!data?.hasMore || list.length === 0) break;
    offset += limit;
  }

  return { ok: true, synced, pages };
}

// -------------------------------------------------------------------
// RESUMO MENSAL
// -------------------------------------------------------------------
export async function resumoMes({ year, month }) {
  const mm = String(month).padStart(2, '0');
  const inicio = `${year}-${mm}-01`;
  const fim = `${year}-${mm}-31`;

  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN ${effectiveStatusSql('ar')} IN ('PENDING','OVERDUE') THEN ar.value END), 0) AS total_aberto,
      COALESCE(SUM(CASE WHEN ${effectiveStatusSql('ar')} = 'PENDING' THEN ar.value END), 0)               AS total_pendente,
      COALESCE(SUM(CASE WHEN ${effectiveStatusSql('ar')} = 'OVERDUE' THEN ar.value END), 0)               AS total_vencido,
      COALESCE(SUM(CASE WHEN ${effectiveStatusSql('ar')} = 'PAID' THEN ar.amount_paid END), 0)            AS total_pago
    FROM ${TB} ar
    WHERE ar.due_date BETWEEN $1 AND $2;
  `;

  const { rows } = await pool.query(sql, [inicio, fim]);
  return rows[0] || {
    total_aberto: 0,
    total_pendente: 0,
    total_vencido: 0,
    total_pago: 0,
  };
}

// -------------------------------------------------------------------
// resolve asaas_payment_id pela conta local
// -------------------------------------------------------------------
export async function resolveAsaasPaymentIdByAccountsReceivableId(accountsReceivableId) {
  const id = toInt(accountsReceivableId, 0);
  if (!id) return null;

  const q = `
    SELECT asa.asaas_payment_id
      FROM ${TB_BRIDGE} asa
     WHERE asa.accounts_receivable_id = $1
     LIMIT 1;
  `;
  const { rows } = await pool.query(q, [id]);
  return rows[0]?.asaas_payment_id || null;
}

// -------------------------------------------------------------------
// getExistingBoletoDownloadInfoByPaymentId (read-only)
// -------------------------------------------------------------------
export async function getExistingBoletoDownloadInfoByPaymentId(asaasPaymentId) {
  const pid = String(asaasPaymentId || '').trim();
  if (!pid) throw new Error('asaas_payment_id inválido.');

  const qBridge = `
    SELECT
      asa.asaas_payment_id,
      COALESCE(asa.raw->>'invoiceNumber', asa.asaas_payment_id) AS invoice_number,
      COALESCE(
        asa.raw->>'boleto_pdf_url_local',
        asa.raw->>'bankSlipPdfUrl',
        asa.raw->>'bankSlipUrl',
        asa.raw->>'invoiceUrl'
      ) AS best_url,
      asa.accounts_receivable_id
    FROM ${TB_BRIDGE} asa
    WHERE asa.asaas_payment_id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(qBridge, [pid]);
  const row = rows[0] || null;

  let url = row?.best_url || null;

  if (!url) {
    const payment = await asaasApi.getPayment(pid);
    url = payment?.bankSlipPdfUrl || payment?.bankSlipUrl || payment?.invoiceUrl || null;

    if (url && row?.accounts_receivable_id) {
      await persistAsaasRawForAr(row.accounts_receivable_id, {
        bankSlipPdfUrl: payment?.bankSlipPdfUrl || null,
        bankSlipUrl: payment?.bankSlipUrl || null,
        invoiceUrl: payment?.invoiceUrl || null,
      });
    }
  }

  if (!url) throw new Error('Boleto ainda não disponível no Asaas para esta cobrança.');

  const invoice = String(row?.invoice_number || '').trim();
  const filename = invoice ? `boleto-${invoice}.pdf` : `boleto-${pid}.pdf`;

  return { url, filename, asaas_payment_id: pid };
}

export async function getExistingBoletoDownloadInfoByAccountsReceivableId(accountsReceivableId) {
  const pid = await resolveAsaasPaymentIdByAccountsReceivableId(accountsReceivableId);
  if (!pid) throw new Error('Esta conta não possui vínculo com cobrança do Asaas (asaas_payment_id).');
  return getExistingBoletoDownloadInfoByPaymentId(pid);
}

// -------------------------------------------------------------------
// ✅ BOLETO (DOWNLOAD PROXY) — compat + LOCAL
//  - Agora:
//    1) se existir boleto_pdf_url_local => retorna local
//    2) senão tenta gerar local (download + save + merge raw)
//    3) senão retorna URL remota (fallback)
// -------------------------------------------------------------------
export async function getBoletoDownloadInfo(accountsReceivableId) {
  const id = toInt(accountsReceivableId, 0);
  if (!id) throw new Error('ID inválido.');

  // 1) tenta garantir local
  const ensured = await ensureLocalBoletoForArId(id);
  if (ensured?.ok && ensured?.localUrl) {
    const filename = `boleto-${ensured.asaas_payment_id}.pdf`;
    return { url: ensured.localUrl, filename, local: true };
  }

  // 2) fallback: comportamento antigo (raw / GET payment)
  const q = `
    SELECT
      asa.asaas_payment_id,
      COALESCE(
        asa.raw->>'boleto_pdf_url_local',
        asa.raw->>'bankSlipPdfUrl',
        asa.raw->>'bankSlipUrl',
        asa.raw->>'invoiceUrl',
        asa.raw->>'bank_slip_pdf_url',
        asa.raw->>'bank_slip_url',
        asa.raw->>'boleto_pdf_url',
        asa.raw->>'boleto_url'
      ) AS bank_slip_url,
      COALESCE(asa.raw->>'invoiceNumber', asa.asaas_payment_id) AS invoice_number
    FROM ${TB_BRIDGE} asa
    WHERE asa.accounts_receivable_id = $1
    LIMIT 1;
  `;

  const { rows } = await pool.query(q, [id]);
  const row = rows[0];

  if (!row?.asaas_payment_id) {
    throw new Error('Esta conta não possui vínculo com cobrança do Asaas.');
  }

  let url = row.bank_slip_url || null;

  if (!url) {
    const payment = await asaasApi.getPayment(row.asaas_payment_id);
    url = payment?.bankSlipPdfUrl || payment?.bankSlipUrl || payment?.invoiceUrl || null;

    if (url) {
      await persistAsaasRawForAr(id, {
        bankSlipPdfUrl: payment?.bankSlipPdfUrl || null,
        bankSlipUrl: payment?.bankSlipUrl || null,
        invoiceUrl: payment?.invoiceUrl || null,
      });
    }
  }

  if (!url) throw new Error('Boleto ainda não disponível no Asaas para esta cobrança.');

  const invoice = String(row.invoice_number || '').trim();
  const filename = invoice ? `boleto-${invoice}.pdf` : `boleto-${row.asaas_payment_id}.pdf`;

  return { url, filename, local: false };
}

// -------------------------------------------------------------------
// CANCELAR / REMOVER BOLETO (ASAAS + ERP)
// -------------------------------------------------------------------
export async function cancelAsaasBoleto(accountsReceivableId, { reason } = {}) {
  const id = toInt(accountsReceivableId, 0);
  if (!id) throw new Error('ID inválido.');

  const q = `
    SELECT
      ar.id,
      ar.status,
      ar.amount_paid,
      asa.asaas_payment_id,
      asa.raw,
      asa.last_status
    FROM ${TB} ar
    LEFT JOIN ${TB_BRIDGE} asa
      ON asa.accounts_receivable_id = ar.id
    WHERE ar.id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(q, [id]);
  const row = rows[0];

  if (!row) throw new Error('Conta não encontrada.');
  if (!row.asaas_payment_id) throw new Error('Esta conta não possui cobrança vinculada no Asaas.');

  const st = String(row.status || '').toUpperCase();
  if (st === 'PAID') throw new Error('Não é permitido cancelar boleto com status PAID.');
  if (st === 'CANCELLED') return { ok: true, message: 'Boleto já estava cancelado.', id };

  let cancelledPayment = null;
  try {
    cancelledPayment = await asaasApi.cancelPayment(row.asaas_payment_id);
  } catch (e) {
    throw new Error(`Falha ao cancelar no Asaas: ${e.message}`);
  }

  // Transação em um único client: BEGIN/COMMIT via pool.query podem
  // cair em conexões diferentes e deixar uma transação aberta no pool.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updAR = `
      UPDATE ${TB}
      SET
        status = 'CANCELLED',
        updated_at = now()
      WHERE id = $1
      RETURNING id, status, updated_at;
    `;
    const { rows: arRows } = await client.query(updAR, [id]);

    const patch = {
      cancelledAt: new Date().toISOString(),
      cancelReason: reason || null,
      asaasCancelResponse: cancelledPayment || null,
    };

    await persistAsaasRawForAr(id, patch, client);

    const updBridge = `
      UPDATE ${TB_BRIDGE}
      SET
        last_status = 'CANCELLED',
        updated_at = now()
      WHERE asaas_payment_id = $1;
    `;
    await client.query(updBridge, [row.asaas_payment_id]);

    await client.query('COMMIT');
    return { ok: true, message: 'Boleto cancelado no Asaas e atualizado no ERP.', data: arRows[0] };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------------
// ✅ UPDATE: salva local do boleto na PONTE + raw (merge)
// -------------------------------------------------------------------
export async function updateBoletoLocalInfo(accountsReceivableId, {
  boleto_pdf_url_local = null,
  boleto_pdf_abs_path = null, // não existe em coluna -> salva no raw (opcional)
} = {}) {
  const id = toInt(accountsReceivableId, 0);
  if (!id) throw new Error('accountsReceivableId inválido.');

  // 1) atualiza coluna da ponte (se existir vínculo)
  const updBridge = `
    UPDATE ${TB_BRIDGE}
       SET boleto_pdf_url_local = COALESCE($2, boleto_pdf_url_local),
           updated_at = now()
     WHERE accounts_receivable_id = $1
     RETURNING id, asaas_payment_id, accounts_receivable_id, boleto_pdf_url_local;
  `;
  const { rows } = await pool.query(updBridge, [id, boleto_pdf_url_local]);

  // 2) merge no raw também (compatibilidade e para guardar abs_path)
  const patch = {
    boleto_pdf_url_local: boleto_pdf_url_local || null,
    boleto_pdf_abs_path: boleto_pdf_abs_path || null,
  };
  await persistAsaasRawForAr(id, patch);

  return { ok: true, bridge: rows?.[0] || null };
}

export default {
  listBankAccounts,
  listCashCategories,
  listCashSubcategories,
  listCashDocumentTypes,
  listChartOfAccounts,
  listAccountsReceivable,
  getById,
  createAccount,
  updateAccount,
  receivePayment,

  // Atualização do boleto
  updateBoletoValueAndDueDate,

  syncFromAsaas,
  resumoMes,

  // boleto
  getBoletoDownloadInfo,
  updateBoletoLocalInfo, // ✅ ADD

  // extras
  resolveAsaasPaymentIdByAccountsReceivableId,
  getExistingBoletoDownloadInfoByPaymentId,
  getExistingBoletoDownloadInfoByAccountsReceivableId,

  cancelAsaasBoleto,
};