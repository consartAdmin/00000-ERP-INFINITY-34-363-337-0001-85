// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeBonusIssuedApi.js — API Service de NF-e Bonificação                   ║
// ║ CONSART ERP | PostgreSQL | ESM                                     ║
// ║ ✅ CRUD do cabeçalho da bonificação                                ║
// ║ ✅ CRUD dos itens                                                   ║
// ║ ✅ Integração com produtos / grades / lotes                         ║
// ║ ✅ Recalcula total automaticamente                                 ║
// ║ ✅ Operação fiscal BONUS via nfeOperationTypes                      ║
// ║ ✅ Auditoria via auditLogs                                          ║
// ║ ✅ Não movimenta estoque enquanto estiver em DRAFT                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';
import { createAuditLog } from './auditLogsApi.js';
import customersApi from '../../repositories/customers/customers.index.js';
import invoicesIssuedApi from './invoicesIssued/invoicesIssuedApi.js';
import * as tecnospeedNfeApi from './tecnoSpeedNfeApi.js';


// ======================================================================
// TABLES
// ======================================================================

const TB_BONUS = 'public."nfeBonus"';
const TB_BONUS_ITEMS = 'public."nfeBonusItems"';
const TB_OPERATION_TYPES = 'public."nfeOperationTypes"';

const TB_CUSTOMERS = 'public."customers"';
const TB_PRODUCTS = 'public."products"';
const TB_PRODUCT_GRADES = 'public."productsGrades"';
const TB_STOCK = 'public."productsStock"';
const TB_STOCK_LOTS = 'public."productsStockLots"';


// ======================================================================
// HELPERS
// ======================================================================

function normalizeText(value, def = null) {
  if (value === undefined || value === null) return def;

  const s = String(value).trim();

  return s || def;
}


function normalizeInteger(value, def = null) {
  if (value === undefined || value === null || value === '') {
    return def;
  }

  const n = Number(value);

  return Number.isSafeInteger(n)
    ? n
    : def;
}


function normalizePositiveInteger(value, def = null) {
  const n = normalizeInteger(value, def);

  return Number.isSafeInteger(n) && n > 0
    ? n
    : def;
}


function normalizeDecimal(value, def = 0, decimals = 3) {
  const n = Number(value ?? def);

  if (!Number.isFinite(n)) {
    return Number(def);
  }

  return Number(n.toFixed(decimals));
}


function normalizeMoney(value, def = 0) {
  return normalizeDecimal(value, def, 2);
}


function normalizeUserId(value) {
  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}


async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');

    throw error;
  } finally {
    client.release();
  }
}


// ======================================================================
// ROW MAPPERS
// ======================================================================

function rowToBonus(row) {
  if (!row) return null;

  return {
    bonus_id: Number(row.bonus_id),

    customer_id:
      row.customer_id !== null
        ? Number(row.customer_id)
        : null,

    operation_type_id:
      row.operation_type_id !== null
        ? Number(row.operation_type_id)
        : null,

    operation_code: row.operation_code ?? null,
    operation_name: row.operation_name ?? null,
    nature_operation: row.nature_operation ?? null,

    cfop_internal: row.cfop_internal ?? null,
    cfop_interstate: row.cfop_interstate ?? null,

    generates_receivable:
      row.generates_receivable !== undefined
        ? Boolean(row.generates_receivable)
        : null,

    moves_stock:
      row.moves_stock !== undefined
        ? Boolean(row.moves_stock)
        : null,

    status: row.status,

    total_amount: Number(row.total_amount || 0),

    observations: row.observations ?? null,

    invoice_id:
      row.invoice_id !== null && row.invoice_id !== undefined
        ? Number(row.invoice_id)
        : null,

    created_by:
      row.created_by !== null && row.created_by !== undefined
        ? Number(row.created_by)
        : null,

    customer_name:
      row.customer_name ?? null,

    customer_trade_name:
      row.customer_trade_name ?? null,

    customer_tax_id:
      row.customer_tax_id ?? null,

    customer_state:
      row.customer_state ?? null,

    customer_city:
      row.customer_city ?? null,

    customer_email:
      row.customer_email ?? null,

    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}


function rowToBonusItem(row) {
  if (!row) return null;

  return {
    bonus_item_id: Number(row.bonus_item_id),
    bonus_id: Number(row.bonus_id),

    product_id: Number(row.product_id),
    product_code: row.product_code,

    description:
      row.description ?? null,

    manufacturer_ref:
      row.manufacturer_ref ?? null,

    product_grade_id:
      row.product_grade_id !== null &&
      row.product_grade_id !== undefined
        ? Number(row.product_grade_id)
        : null,

    grade_id:
      row.grade_id !== null &&
      row.grade_id !== undefined
        ? Number(row.grade_id)
        : null,

    grade_name:
      row.grade_name ?? null,

    lot_id:
      row.lot_id !== null &&
      row.lot_id !== undefined
        ? Number(row.lot_id)
        : null,

    lot_code:
      row.lot_code ?? null,

    expires_at:
      row.expires_at ?? null,

    qty_on_hand:
      row.qty_on_hand !== null &&
      row.qty_on_hand !== undefined
        ? Number(row.qty_on_hand)
        : null,

    qty_reserved:
      row.qty_reserved !== null &&
      row.qty_reserved !== undefined
        ? Number(row.qty_reserved)
        : null,

    qty_available:
      row.qty_available !== null &&
      row.qty_available !== undefined
        ? Number(row.qty_available)
        : null,

    quantity: Number(row.quantity || 0),

    unit_value: Number(row.unit_value || 0),
    total_value: Number(row.total_value || 0),

    item_sequence: Number(row.item_sequence || 0),

    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}


// ======================================================================
// ENSURE TABLES
// ======================================================================

export async function ensureTables() {
  const sql = `
    CREATE TABLE IF NOT EXISTS ${TB_OPERATION_TYPES} (
      operation_type_id BIGSERIAL PRIMARY KEY,

      code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,

      nature_operation VARCHAR(120) NOT NULL,

      cfop_internal VARCHAR(4),
      cfop_interstate VARCHAR(4),

      generates_receivable BOOLEAN NOT NULL DEFAULT FALSE,
      moves_stock BOOLEAN NOT NULL DEFAULT TRUE,

      active BOOLEAN NOT NULL DEFAULT TRUE,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );


    CREATE TABLE IF NOT EXISTS ${TB_BONUS} (
      bonus_id BIGSERIAL PRIMARY KEY,

      customer_id INTEGER NOT NULL
        REFERENCES ${TB_CUSTOMERS}(customer_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      operation_type_id BIGINT NOT NULL
        REFERENCES ${TB_OPERATION_TYPES}(operation_type_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',

      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,

      observations TEXT,

      invoice_id BIGINT,

      nfe_issue_status VARCHAR(40),
      nfe_provider_id TEXT,
      nfe_id_integracao TEXT,
      nfe_protocol TEXT,
      nfe_environment VARCHAR(20),
      nfe_access_key VARCHAR(44),
      nfe_issue_error TEXT,
      nfe_issued_at TIMESTAMPTZ,
      nfe_issued_by BIGINT,
      nfe_last_checked_at TIMESTAMPTZ,
      nfe_stock_moved_at TIMESTAMPTZ,

      created_by BIGINT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );


    CREATE TABLE IF NOT EXISTS ${TB_BONUS_ITEMS} (
      bonus_item_id BIGSERIAL PRIMARY KEY,

      bonus_id BIGINT NOT NULL
        REFERENCES ${TB_BONUS}(bonus_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,

      product_id INTEGER NOT NULL
        REFERENCES ${TB_PRODUCTS}(product_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      product_code VARCHAR(50) NOT NULL
        REFERENCES ${TB_PRODUCTS}(product_code)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

      product_grade_id INTEGER
        REFERENCES ${TB_PRODUCT_GRADES}(product_grade_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

      lot_id BIGINT
        REFERENCES ${TB_STOCK_LOTS}(lot_id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,

      quantity NUMERIC(14,3) NOT NULL,

      unit_value NUMERIC(14,6) NOT NULL DEFAULT 0,
      total_value NUMERIC(14,2) NOT NULL DEFAULT 0,

      item_sequence INTEGER NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT chk_nfe_bonus_items_quantity
        CHECK (quantity > 0),

      CONSTRAINT chk_nfe_bonus_items_unit_value
        CHECK (unit_value >= 0),

      CONSTRAINT chk_nfe_bonus_items_total_value
        CHECK (total_value >= 0),

      CONSTRAINT ux_nfe_bonus_items_sequence
        UNIQUE (bonus_id, item_sequence)
    );


    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_customer
      ON ${TB_BONUS}(customer_id);

    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_status
      ON ${TB_BONUS}(status);

    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_invoice
      ON ${TB_BONUS}(invoice_id);

    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_created_at
      ON ${TB_BONUS}(created_at);


    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_items_bonus
      ON ${TB_BONUS_ITEMS}(bonus_id);

    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_items_product
      ON ${TB_BONUS_ITEMS}(product_id);

    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_items_product_code
      ON ${TB_BONUS_ITEMS}(product_code);

    CREATE INDEX IF NOT EXISTS idx_nfe_bonus_items_lot
      ON ${TB_BONUS_ITEMS}(lot_id);

    ALTER TABLE ${TB_BONUS}
      ADD COLUMN IF NOT EXISTS nfe_issue_status VARCHAR(40),
      ADD COLUMN IF NOT EXISTS nfe_provider_id TEXT,
      ADD COLUMN IF NOT EXISTS nfe_id_integracao TEXT,
      ADD COLUMN IF NOT EXISTS nfe_protocol TEXT,
      ADD COLUMN IF NOT EXISTS nfe_environment VARCHAR(20),
      ADD COLUMN IF NOT EXISTS nfe_access_key VARCHAR(44),
      ADD COLUMN IF NOT EXISTS nfe_issue_error TEXT,
      ADD COLUMN IF NOT EXISTS nfe_issued_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS nfe_issued_by BIGINT,
      ADD COLUMN IF NOT EXISTS nfe_last_checked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS nfe_stock_moved_at TIMESTAMPTZ;
  `;

  await pool.query(sql);

  return {
    ok: true,
  };
}


// ======================================================================
// GET BONUS OPERATION
// ======================================================================

export async function getBonusOperation({
  db = pool,
} = {}) {
  const { rows } = await db.query(
    `
    SELECT
      operation_type_id,
      code,
      name,
      nature_operation,
      cfop_internal,
      cfop_interstate,
      generates_receivable,
      moves_stock,
      active
    FROM ${TB_OPERATION_TYPES}
    WHERE UPPER(code) = 'BONUS'
      AND active = TRUE
    LIMIT 1
    `
  );

  return rows[0] || null;
}


// ======================================================================
// CHECK CUSTOMER
// ======================================================================

async function getCustomerForBonus(
  customerId,
  {
    db = pool,
  } = {}
) {
  const id = normalizePositiveInteger(customerId);

  if (!id) {
    return null;
  }

  const { rows } = await db.query(
    `
    SELECT
      customer_id,
      legal_name,
      trade_name,
      tax_id,
      state,
      city,
      email,
      invoice_email,
      is_active
    FROM ${TB_CUSTOMERS}
    WHERE customer_id = $1
    LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}


// ======================================================================
// RECALCULATE TOTAL
// ======================================================================

export async function recalculateBonusTotal(
  bonusId,
  {
    db = pool,
  } = {}
) {
  const id = normalizePositiveInteger(bonusId);

  if (!id) {
    return {
      ok: false,
      error: 'bonus_id inválido',
    };
  }

  const { rows } = await db.query(
    `
    UPDATE ${TB_BONUS} b
    SET
      total_amount = COALESCE(
        (
          SELECT SUM(i.total_value)
          FROM ${TB_BONUS_ITEMS} i
          WHERE i.bonus_id = b.bonus_id
        ),
        0
      ),
      updated_at = NOW()
    WHERE b.bonus_id = $1
    RETURNING *
    `,
    [id]
  );

  if (!rows.length) {
    return {
      ok: false,
      error: 'NOT_FOUND',
    };
  }

  return {
    ok: true,
    total_amount: Number(rows[0].total_amount || 0),
  };
}


// ======================================================================
// CREATE BONUS
// ======================================================================

export async function create(
  data = {},
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const customerId = normalizePositiveInteger(
    data.customer_id
  );

  if (!customerId) {
    return {
      ok: false,
      error: 'customer_id inválido',
    };
  }

  const created = await withTransaction(
    async (client) => {

      // --------------------------------------------------------------
      // CUSTOMER
      // --------------------------------------------------------------

      const customer = await getCustomerForBonus(
        customerId,
        {
          db: client,
        }
      );

      if (!customer) {
        return {
          ok: false,
          error: 'CUSTOMER_NOT_FOUND',
        };
      }

      if (customer.is_active === false) {
        return {
          ok: false,
          error: 'CUSTOMER_INACTIVE',
        };
      }


      // --------------------------------------------------------------
      // OPERATION TYPE
      // --------------------------------------------------------------

      const operation = await getBonusOperation({
        db: client,
      });

      if (!operation) {
        return {
          ok: false,
          error:
            'Operação BONUS não encontrada em nfeOperationTypes',
        };
      }


      // --------------------------------------------------------------
      // CREATE
      // --------------------------------------------------------------

      const { rows } = await client.query(
        `
        INSERT INTO ${TB_BONUS} (
          customer_id,
          operation_type_id,
          status,
          total_amount,
          observations,
          invoice_id,
          created_by
        )
        VALUES (
          $1,
          $2,
          'DRAFT',
          0,
          $3,
          NULL,
          $4
        )
        RETURNING *
        `,
        [
          customerId,
          operation.operation_type_id,
          normalizeText(data.observations),
          normalizeUserId(userId),
        ]
      );

      const bonus = rows[0];


      // --------------------------------------------------------------
      // AUDIT
      // --------------------------------------------------------------

      await createAuditLog({
        tabela: 'nfeBonus',
        register_id: bonus.bonus_id,
        operation: 'CREATE',
        user_id: normalizeUserId(userId),

        before: null,

        after: {
          ...rowToBonus(bonus),

          customer_name:
            customer.legal_name ||
            customer.trade_name ||
            null,

          customer_tax_id:
            customer.tax_id || null,

          operation_code:
            operation.code,
        },

        db: client,
      });


      return {
        ok: true,
        bonus_id: Number(bonus.bonus_id),
      };
    }
  );

  if (!created?.ok) {
    return created;
  }

  return getById(created.bonus_id);
}


// ======================================================================
// GET BY ID
// ======================================================================

export async function getById(bonusId) {
  await ensureTables();

  const id = normalizePositiveInteger(bonusId);

  if (!id) {
    return {
      ok: false,
      error: 'bonus_id inválido',
    };
  }

  const { rows } = await pool.query(
    `
    SELECT
      b.*,

      c.legal_name AS customer_name,
      c.trade_name AS customer_trade_name,
      c.tax_id AS customer_tax_id,
      c.state AS customer_state,
      c.city AS customer_city,

      COALESCE(
        NULLIF(TRIM(c.invoice_email), ''),
        NULLIF(TRIM(c.email), '')
      ) AS customer_email,

      ot.code AS operation_code,
      ot.name AS operation_name,
      ot.nature_operation,

      ot.cfop_internal,
      ot.cfop_interstate,

      ot.generates_receivable,
      ot.moves_stock

    FROM ${TB_BONUS} b

    INNER JOIN ${TB_CUSTOMERS} c
      ON c.customer_id = b.customer_id

    INNER JOIN ${TB_OPERATION_TYPES} ot
      ON ot.operation_type_id = b.operation_type_id

    WHERE b.bonus_id = $1

    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) {
    return {
      ok: false,
      error: 'NOT_FOUND',
    };
  }

  const itemsResult = await listItems(id);

  return {
    ok: true,

    bonus: rowToBonus(rows[0]),

    items:
      itemsResult.ok
        ? itemsResult.rows
        : [],
  };
}


// ======================================================================
// SEARCH / LIST
// ======================================================================

export async function search({
  q = '',
  status = null,
  customerId = null,
  limit = 50,
  offset = 0,
} = {}) {
  await ensureTables();

  const where = [];
  const args = [];

  let ai = 1;


  // ------------------------------------------------------------------
  // SEARCH
  // ------------------------------------------------------------------

  if (q && String(q).trim()) {
    const value =
      `%${String(q).trim().toLowerCase()}%`;

    where.push(`
      (
        LOWER(COALESCE(c.legal_name, '')) LIKE $${ai}
        OR LOWER(COALESCE(c.trade_name, '')) LIKE $${ai}
        OR LOWER(COALESCE(c.tax_id, '')) LIKE $${ai}
        OR CAST(b.bonus_id AS TEXT) LIKE $${ai}
      )
    `);

    args.push(value);

    ai++;
  }


  // ------------------------------------------------------------------
  // STATUS
  // ------------------------------------------------------------------

  if (
    status &&
    String(status).trim().toUpperCase() !== 'TODOS'
  ) {
    where.push(
      `UPPER(b.status) = UPPER($${ai})`
    );

    args.push(
      String(status).trim()
    );

    ai++;
  }


  // ------------------------------------------------------------------
  // CUSTOMER
  // ------------------------------------------------------------------

  const safeCustomerId =
    normalizePositiveInteger(customerId);

  if (safeCustomerId) {
    where.push(
      `b.customer_id = $${ai}`
    );

    args.push(safeCustomerId);

    ai++;
  }


  const whereSql =
    where.length
      ? `WHERE ${where.join(' AND ')}`
      : '';


  // ------------------------------------------------------------------
  // LIMIT
  // ------------------------------------------------------------------

  const safeLimit =
    Math.min(
      Math.max(
        normalizePositiveInteger(limit, 50) || 50,
        1
      ),
      500
    );

  const safeOffset =
    Math.max(
      normalizeInteger(offset, 0) || 0,
      0
    );


  // ------------------------------------------------------------------
  // QUERY
  // ------------------------------------------------------------------

  const sqlRows = `
    SELECT
      b.*,

      c.legal_name AS customer_name,
      c.trade_name AS customer_trade_name,
      c.tax_id AS customer_tax_id,
      c.state AS customer_state,
      c.city AS customer_city,

      ot.code AS operation_code,
      ot.name AS operation_name,
      ot.nature_operation,

      ot.cfop_internal,
      ot.cfop_interstate,

      ot.generates_receivable,
      ot.moves_stock

    FROM ${TB_BONUS} b

    INNER JOIN ${TB_CUSTOMERS} c
      ON c.customer_id = b.customer_id

    INNER JOIN ${TB_OPERATION_TYPES} ot
      ON ot.operation_type_id = b.operation_type_id

    ${whereSql}

    ORDER BY
      b.created_at DESC,
      b.bonus_id DESC

    LIMIT $${ai}
    OFFSET $${ai + 1}
  `;


  const sqlCount = `
    SELECT
      COUNT(*) AS total

    FROM ${TB_BONUS} b

    INNER JOIN ${TB_CUSTOMERS} c
      ON c.customer_id = b.customer_id

    INNER JOIN ${TB_OPERATION_TYPES} ot
      ON ot.operation_type_id = b.operation_type_id

    ${whereSql}
  `;


  const rowsArgs = [
    ...args,
    safeLimit,
    safeOffset,
  ];


  const [
    rowsRes,
    countRes,
  ] = await Promise.all([
    pool.query(
      sqlRows,
      rowsArgs
    ),

    pool.query(
      sqlCount,
      args
    ),
  ]);


  return {
    ok: true,

    rows:
      rowsRes.rows.map(
        rowToBonus
      ),

    total:
      Number(
        countRes.rows?.[0]?.total || 0
      ),
  };
}


// ======================================================================
// UPDATE BONUS HEADER
// ======================================================================

export async function update(
  bonusId,
  patch = {},
  {
    userId = null,
    operation = 'UPDATE',
  } = {}
) {
  await ensureTables();

  const id =
    normalizePositiveInteger(bonusId);

  if (!id) {
    return {
      ok: false,
      error: 'bonus_id inválido',
    };
  }


  // ------------------------------------------------------------------
  // FIELDS
  // ------------------------------------------------------------------

  const allowed = {
    customer_id:
      patch.customer_id,

    observations:
      patch.observations,

    status:
      patch.status,

    invoice_id:
      patch.invoice_id,
  };


  const sets = [];
  const args = [];

  let ai = 1;


  for (
    const [key, rawValue]
    of Object.entries(allowed)
  ) {

    if (rawValue === undefined) {
      continue;
    }


    let value = rawValue;


    if (key === 'customer_id') {
      value =
        normalizePositiveInteger(rawValue);

      if (!value) {
        return {
          ok: false,
          error:
            'customer_id inválido',
        };
      }
    }


    if (key === 'invoice_id') {
      value =
        rawValue === null
          ? null
          : normalizePositiveInteger(
              rawValue
            );

      if (
        rawValue !== null &&
        !value
      ) {
        return {
          ok: false,
          error:
            'invoice_id inválido',
        };
      }
    }


    if (key === 'observations') {
      value =
        normalizeText(rawValue);
    }


    if (key === 'status') {
      value =
        String(rawValue || '')
          .trim()
          .toUpperCase();

      const validStatuses = new Set([
        'DRAFT',
        'READY',
        'PROCESSING',
        'AUTHORIZED',
        'REJECTED',
        'CANCELLED',
      ]);

      if (
        !validStatuses.has(value)
      ) {
        return {
          ok: false,
          error:
            `Status inválido: ${value}`,
        };
      }
    }


    sets.push(
      `${key} = $${ai++}`
    );

    args.push(value);
  }


  if (!sets.length) {
    return {
      ok: false,
      error:
        'Nenhum campo para atualizar',
    };
  }


  args.push(id);


  // ------------------------------------------------------------------
  // TRANSACTION
  // ------------------------------------------------------------------

  const result =
    await withTransaction(
      async (client) => {

        const beforeRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS}
            WHERE bonus_id = $1
            FOR UPDATE
            `,
            [id]
          );


        if (!beforeRes.rows.length) {
          return null;
        }


        const current =
          beforeRes.rows[0];


        // Don't edit an already issued bonus
        if (
          ['AUTHORIZED', 'CANCELLED']
            .includes(
              String(current.status)
                .toUpperCase()
            )
        ) {
          throw new Error(
            `Bonificação ${id} não pode ser alterada no status ${current.status}`
          );
        }


        // Validate customer if changing customer
        if (
          patch.customer_id !== undefined
        ) {
          const customer =
            await getCustomerForBonus(
              patch.customer_id,
              {
                db: client,
              }
            );

          if (!customer) {
            throw new Error(
              'Cliente não encontrado'
            );
          }
        }


        const { rows } =
          await client.query(
            `
            UPDATE ${TB_BONUS}
            SET
              ${sets.join(', ')},
              updated_at = NOW()
            WHERE bonus_id = $${ai}
            RETURNING *
            `,
            args
          );


        const after =
          rows[0];


        await createAuditLog({
          tabela: 'nfeBonus',
          register_id: id,

          operation:
            String(
              operation || 'UPDATE'
            ).toUpperCase(),

          user_id:
            normalizeUserId(userId),

          before:
            rowToBonus(
              beforeRes.rows[0]
            ),

          after:
            rowToBonus(after),

          db: client,
        });


        return after;
      }
    );


  if (!result) {
    return {
      ok: false,
      error: 'NOT_FOUND',
    };
  }


  return getById(id);
}


// ======================================================================
// RESOLVE PRODUCT
// ======================================================================

async function resolveProduct(
  productCode,
  {
    db = pool,
  } = {}
) {
  const code =
    normalizeText(productCode);

  if (!code) {
    return null;
  }

  const { rows } =
    await db.query(
      `
      SELECT
        p.product_id,
        p.product_code,
        p.description,
        p.manufacturer_ref,

        p.product_grade_id,
        p.product_stock_id,

        COALESCE(
          ps.stock_qty,
          0
        ) AS stock_qty

      FROM ${TB_PRODUCTS} p

      LEFT JOIN ${TB_STOCK} ps
        ON ps.product_stock_id =
           p.product_stock_id

      WHERE
        p.product_code = $1

        OR regexp_replace(
             p.product_code,
             '^0+',
             ''
           ) =
           regexp_replace(
             $1,
             '^0+',
             ''
           )

      LIMIT 1
      `,
      [code]
    );

  return rows[0] || null;
}


// ======================================================================
// RESOLVE LOT
// ======================================================================

async function resolveLot(
  lotId,
  {
    productStockId = null,
    db = pool,
  } = {}
) {
  const id =
    normalizePositiveInteger(lotId);

  if (!id) {
    return null;
  }


  const args = [id];

  let stockFilter = '';


  if (
    normalizePositiveInteger(
      productStockId
    )
  ) {
    args.push(
      normalizePositiveInteger(
        productStockId
      )
    );

    stockFilter =
      `AND l.product_stock_id = $2`;
  }


  const { rows } =
    await db.query(
      `
      SELECT
        l.lot_id,
        l.product_stock_id,

        l.product_grade_id,

        l.lot_code,
        l.expires_at,

        l.qty_on_hand,
        l.qty_reserved,

        (
          l.qty_on_hand -
          l.qty_reserved
        ) AS qty_available,

        l.cost_unit,

        l.is_active

      FROM ${TB_STOCK_LOTS} l

      WHERE
        l.lot_id = $1

        ${stockFilter}

        AND COALESCE(
          l.is_active,
          TRUE
        ) = TRUE

      LIMIT 1
      `,
      args
    );


  return rows[0] || null;
}


// ======================================================================
// NEXT ITEM SEQUENCE
// ======================================================================

async function getNextItemSequence(
  bonusId,
  {
    db = pool,
  } = {}
) {
  const { rows } =
    await db.query(
      `
      SELECT
        COALESCE(
          MAX(item_sequence),
          0
        ) + 1 AS next_sequence

      FROM ${TB_BONUS_ITEMS}

      WHERE bonus_id = $1
      `,
      [bonusId]
    );


  return Number(
    rows?.[0]?.next_sequence || 1
  );
}


// ======================================================================
// ADD ITEM
// ======================================================================

export async function addItem(
  bonusId,
  data = {},
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const safeBonusId =
    normalizePositiveInteger(bonusId);

  if (!safeBonusId) {
    return {
      ok: false,
      error: 'bonus_id inválido',
    };
  }


  const productCode =
    normalizeText(
      data.product_code
    );

  if (!productCode) {
    return {
      ok: false,
      error:
        'product_code é obrigatório',
    };
  }


  const quantity =
    normalizeDecimal(
      data.quantity,
      0,
      3
    );

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return {
      ok: false,
      error:
        'quantity deve ser maior que zero',
    };
  }


  const unitValue =
    normalizeDecimal(
      data.unit_value,
      0,
      6
    );

  if (unitValue < 0) {
    return {
      ok: false,
      error:
        'unit_value inválido',
    };
  }


  // Fiscal total remains with 2 decimal places.
  const totalValue =
    normalizeMoney(
      quantity * unitValue,
      0
    );


  const result =
    await withTransaction(
      async (client) => {

        // ------------------------------------------------------------
        // LOCK BONUS
        // ------------------------------------------------------------

        const bonusRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS}
            WHERE bonus_id = $1
            FOR UPDATE
            `,
            [safeBonusId]
          );


        if (!bonusRes.rows.length) {
          return {
            ok: false,
            error:
              'BONUS_NOT_FOUND',
          };
        }


        const bonus =
          bonusRes.rows[0];


        if (
          String(bonus.status)
            .toUpperCase() !== 'DRAFT'
        ) {
          return {
            ok: false,
            error:
              `Itens só podem ser alterados em DRAFT. Status atual: ${bonus.status}`,
          };
        }


        // ------------------------------------------------------------
        // PRODUCT
        // ------------------------------------------------------------

        const product =
          await resolveProduct(
            productCode,
            {
              db: client,
            }
          );


        if (!product) {
          return {
            ok: false,
            error:
              'PRODUCT_NOT_FOUND',
          };
        }


        // ------------------------------------------------------------
        // LOT
        // ------------------------------------------------------------

        let lot = null;

        if (data.lot_id) {
          lot =
            await resolveLot(
              data.lot_id,
              {
                productStockId:
                  product.product_stock_id,

                db: client,
              }
            );


          if (!lot) {
            return {
              ok: false,
              error:
                'LOT_NOT_FOUND_OR_INVALID',
            };
          }


          const available =
            Number(
              lot.qty_available || 0
            );


          if (quantity > available) {
            return {
              ok: false,

              error:
                'INSUFFICIENT_LOT_STOCK',

              available,
              requested:
                quantity,
            };
          }
        }


        // ------------------------------------------------------------
        // GRADE
        // ------------------------------------------------------------

        const productGradeId =
          lot?.product_grade_id
          ??
          normalizePositiveInteger(
            data.product_grade_id
          )
          ??
          normalizePositiveInteger(
            product.product_grade_id
          )
          ??
          null;


        // ------------------------------------------------------------
        // SEQUENCE
        // ------------------------------------------------------------

        const itemSequence =
          data.item_sequence
            ? normalizePositiveInteger(
                data.item_sequence
              )
            : await getNextItemSequence(
                safeBonusId,
                {
                  db: client,
                }
              );


        if (!itemSequence) {
          return {
            ok: false,
            error:
              'item_sequence inválido',
          };
        }


        // ------------------------------------------------------------
        // INSERT
        // ------------------------------------------------------------

        const { rows } =
          await client.query(
            `
            INSERT INTO ${TB_BONUS_ITEMS} (
              bonus_id,

              product_id,
              product_code,

              product_grade_id,
              lot_id,

              quantity,

              unit_value,
              total_value,

              item_sequence
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9
            )
            RETURNING *
            `,
            [
              safeBonusId,

              product.product_id,
              product.product_code,

              productGradeId,
              lot?.lot_id ?? null,

              quantity,

              unitValue,
              totalValue,

              itemSequence,
            ]
          );


        const created =
          rows[0];


        // ------------------------------------------------------------
        // RECALCULATE HEADER TOTAL
        // ------------------------------------------------------------

        await recalculateBonusTotal(
          safeBonusId,
          {
            db: client,
          }
        );


        // ------------------------------------------------------------
        // AUDIT
        // ------------------------------------------------------------

        await createAuditLog({
          tabela:
            'nfeBonusItems',

          register_id:
            created.bonus_item_id,

          operation:
            'CREATE',

          user_id:
            normalizeUserId(userId),

          before:
            null,

          after: {
            ...rowToBonusItem(
              created
            ),

            description:
              product.description,

            lot_code:
              lot?.lot_code || null,

            qty_available:
              lot
                ? Number(
                    lot.qty_available || 0
                  )
                : null,
          },

          db: client,
        });


        return {
          ok: true,

          bonus_item_id:
            Number(
              created.bonus_item_id
            ),
        };
      }
    );


  if (!result?.ok) {
    return result;
  }


  return getById(
    safeBonusId
  );
}


// ======================================================================
// LIST ITEMS
// ======================================================================

export async function listItems(
  bonusId
) {
  await ensureTables();

  const id =
    normalizePositiveInteger(
      bonusId
    );


  if (!id) {
    return {
      ok: false,
      error:
        'bonus_id inválido',
    };
  }


  const { rows } =
    await pool.query(
      `
      SELECT
        i.*,

        p.description,
        p.manufacturer_ref,

        pg.grade_id,

        l.lot_code,
        l.expires_at,

        l.qty_on_hand,
        l.qty_reserved,

        CASE
          WHEN l.lot_id IS NULL
            THEN NULL
          ELSE (
            l.qty_on_hand -
            l.qty_reserved
          )
        END AS qty_available

      FROM ${TB_BONUS_ITEMS} i

      INNER JOIN ${TB_PRODUCTS} p
        ON p.product_id =
           i.product_id

      LEFT JOIN ${TB_PRODUCT_GRADES} pg
        ON pg.product_grade_id =
           i.product_grade_id

      LEFT JOIN ${TB_STOCK_LOTS} l
        ON l.lot_id =
           i.lot_id

      WHERE i.bonus_id = $1

      ORDER BY
        i.item_sequence ASC,
        i.bonus_item_id ASC
      `,
      [id]
    );


  return {
    ok: true,

    rows:
      rows.map(
        rowToBonusItem
      ),

    total:
      rows.length,
  };
}


// ======================================================================
// UPDATE ITEM
// ======================================================================

export async function updateItem(
  bonusId,
  bonusItemId,
  patch = {},
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const safeBonusId =
    normalizePositiveInteger(
      bonusId
    );

  const safeItemId =
    normalizePositiveInteger(
      bonusItemId
    );


  if (!safeBonusId) {
    return {
      ok: false,
      error:
        'bonus_id inválido',
    };
  }


  if (!safeItemId) {
    return {
      ok: false,
      error:
        'bonus_item_id inválido',
    };
  }


  const result =
    await withTransaction(
      async (client) => {

        // ------------------------------------------------------------
        // BONUS
        // ------------------------------------------------------------

        const bonusRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS}
            WHERE bonus_id = $1
            FOR UPDATE
            `,
            [safeBonusId]
          );


        if (!bonusRes.rows.length) {
          return {
            ok: false,
            error:
              'BONUS_NOT_FOUND',
          };
        }


        if (
          String(
            bonusRes.rows[0].status
          ).toUpperCase() !==
          'DRAFT'
        ) {
          return {
            ok: false,
            error:
              'Itens só podem ser alterados enquanto a bonificação estiver em DRAFT',
          };
        }


        // ------------------------------------------------------------
        // ITEM
        // ------------------------------------------------------------

        const itemRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS_ITEMS}
            WHERE
              bonus_item_id = $1
              AND bonus_id = $2
            FOR UPDATE
            `,
            [
              safeItemId,
              safeBonusId,
            ]
          );


        if (!itemRes.rows.length) {
          return {
            ok: false,
            error:
              'ITEM_NOT_FOUND',
          };
        }


        const before =
          itemRes.rows[0];


        // ------------------------------------------------------------
        // QUANTITY
        // ------------------------------------------------------------

        const quantity =
          patch.quantity !== undefined
            ? normalizeDecimal(
                patch.quantity,
                0,
                3
              )
            : Number(
                before.quantity || 0
              );


        if (quantity <= 0) {
          return {
            ok: false,
            error:
              'quantity deve ser maior que zero',
          };
        }


        // ------------------------------------------------------------
        // UNIT VALUE
        // ------------------------------------------------------------

        const unitValue =
          patch.unit_value !== undefined
            ? normalizeDecimal(
                patch.unit_value,
                0,
                6
              )
            : Number(
                before.unit_value || 0
              );


        if (unitValue < 0) {
          return {
            ok: false,
            error:
              'unit_value inválido',
          };
        }


        // ------------------------------------------------------------
        // LOT
        // ------------------------------------------------------------

        let lotId =
          before.lot_id;

        let productGradeId =
          before.product_grade_id;


        if (
          patch.lot_id !== undefined
        ) {
          if (
            patch.lot_id === null ||
            patch.lot_id === ''
          ) {
            lotId = null;
          } else {

            const productRes =
              await client.query(
                `
                SELECT
                  product_id,
                  product_stock_id
                FROM ${TB_PRODUCTS}
                WHERE product_id = $1
                LIMIT 1
                `,
                [
                  before.product_id,
                ]
              );


            const product =
              productRes.rows[0];


            const lot =
              await resolveLot(
                patch.lot_id,
                {
                  productStockId:
                    product?.product_stock_id,

                  db: client,
                }
              );


            if (!lot) {
              return {
                ok: false,
                error:
                  'LOT_NOT_FOUND_OR_INVALID',
              };
            }


            const available =
              Number(
                lot.qty_available || 0
              );


            if (
              quantity > available
            ) {
              return {
                ok: false,

                error:
                  'INSUFFICIENT_LOT_STOCK',

                available,

                requested:
                  quantity,
              };
            }


            lotId =
              lot.lot_id;

            productGradeId =
              lot.product_grade_id
              ?? productGradeId;
          }
        }


        // ------------------------------------------------------------
        // VALIDATE EXISTING LOT
        // ------------------------------------------------------------

        if (
          patch.lot_id === undefined &&
          lotId
        ) {
          const lot =
            await resolveLot(
              lotId,
              {
                db: client,
              }
            );


          if (lot) {
            const available =
              Number(
                lot.qty_available || 0
              );

            if (
              quantity > available
            ) {
              return {
                ok: false,

                error:
                  'INSUFFICIENT_LOT_STOCK',

                available,

                requested:
                  quantity,
              };
            }
          }
        }


        // ------------------------------------------------------------
        // TOTAL
        // ------------------------------------------------------------

        const totalValue =
          normalizeMoney(
            quantity *
            unitValue,
            0
          );


        // ------------------------------------------------------------
        // UPDATE
        // ------------------------------------------------------------

        const { rows } =
          await client.query(
            `
            UPDATE ${TB_BONUS_ITEMS}
            SET
              quantity = $1,
              unit_value = $2,
              total_value = $3,
              lot_id = $4,
              product_grade_id = $5,
              updated_at = NOW()
            WHERE
              bonus_item_id = $6
              AND bonus_id = $7
            RETURNING *
            `,
            [
              quantity,
              unitValue,
              totalValue,

              lotId,
              productGradeId,

              safeItemId,
              safeBonusId,
            ]
          );


        const after =
          rows[0];


        // ------------------------------------------------------------
        // TOTAL
        // ------------------------------------------------------------

        await recalculateBonusTotal(
          safeBonusId,
          {
            db: client,
          }
        );


        // ------------------------------------------------------------
        // AUDIT
        // ------------------------------------------------------------

        await createAuditLog({
          tabela:
            'nfeBonusItems',

          register_id:
            safeItemId,

          operation:
            'UPDATE',

          user_id:
            normalizeUserId(userId),

          before:
            rowToBonusItem(before),

          after:
            rowToBonusItem(after),

          db: client,
        });


        return {
          ok: true,
        };
      }
    );


  if (!result.ok) {
    return result;
  }


  return getById(
    safeBonusId
  );
}


// ======================================================================
// REMOVE ITEM
// ======================================================================

export async function removeItem(
  bonusId,
  bonusItemId,
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const safeBonusId =
    normalizePositiveInteger(
      bonusId
    );

  const safeItemId =
    normalizePositiveInteger(
      bonusItemId
    );


  if (!safeBonusId) {
    return {
      ok: false,
      error:
        'bonus_id inválido',
    };
  }


  if (!safeItemId) {
    return {
      ok: false,
      error:
        'bonus_item_id inválido',
    };
  }


  const result =
    await withTransaction(
      async (client) => {

        // ------------------------------------------------------------
        // BONUS
        // ------------------------------------------------------------

        const bonusRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS}
            WHERE bonus_id = $1
            FOR UPDATE
            `,
            [safeBonusId]
          );


        if (!bonusRes.rows.length) {
          return {
            ok: false,
            error:
              'BONUS_NOT_FOUND',
          };
        }


        if (
          String(
            bonusRes.rows[0].status
          ).toUpperCase() !==
          'DRAFT'
        ) {
          return {
            ok: false,
            error:
              'Itens só podem ser removidos enquanto a bonificação estiver em DRAFT',
          };
        }


        // ------------------------------------------------------------
        // DELETE
        // ------------------------------------------------------------

        const { rows } =
          await client.query(
            `
            DELETE FROM ${TB_BONUS_ITEMS}
            WHERE
              bonus_item_id = $1
              AND bonus_id = $2
            RETURNING *
            `,
            [
              safeItemId,
              safeBonusId,
            ]
          );


        if (!rows.length) {
          return {
            ok: false,
            error:
              'ITEM_NOT_FOUND',
          };
        }


        const deleted =
          rows[0];


        // ------------------------------------------------------------
        // TOTAL
        // ------------------------------------------------------------

        await recalculateBonusTotal(
          safeBonusId,
          {
            db: client,
          }
        );


        // ------------------------------------------------------------
        // AUDIT
        // ------------------------------------------------------------

        await createAuditLog({
          tabela:
            'nfeBonusItems',

          register_id:
            safeItemId,

          operation:
            'DELETE',

          user_id:
            normalizeUserId(userId),

          before:
            rowToBonusItem(
              deleted
            ),

          after:
            null,

          db: client,
        });


        return {
          ok: true,
        };
      }
    );


  if (!result.ok) {
    return result;
  }


  return getById(
    safeBonusId
  );
}


// ======================================================================
// DELETE BONUS
// ======================================================================

export async function remove(
  bonusId,
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const id =
    normalizePositiveInteger(
      bonusId
    );


  if (!id) {
    return {
      ok: false,
      error:
        'bonus_id inválido',
    };
  }


  const result =
    await withTransaction(
      async (client) => {

        // ------------------------------------------------------------
        // LOCK
        // ------------------------------------------------------------

        const beforeRes =
          await client.query(
            `
            SELECT *
            FROM ${TB_BONUS}
            WHERE bonus_id = $1
            FOR UPDATE
            `,
            [id]
          );


        if (!beforeRes.rows.length) {
          return {
            ok: true,
            deleted: 0,
          };
        }


        const before =
          beforeRes.rows[0];


        const status =
          String(
            before.status || ''
          ).toUpperCase();


        if (
          status !== 'DRAFT' &&
          status !== 'REJECTED'
        ) {
          return {
            ok: false,

            error:
              `Bonificação não pode ser excluída no status ${status}`,
          };
        }


        // ------------------------------------------------------------
        // DELETE
        // ------------------------------------------------------------

        await client.query(
          `
          DELETE FROM ${TB_BONUS}
          WHERE bonus_id = $1
          `,
          [id]
        );


        // ------------------------------------------------------------
        // AUDIT
        // ------------------------------------------------------------

        await createAuditLog({
          tabela:
            'nfeBonus',

          register_id:
            id,

          operation:
            'DELETE',

          user_id:
            normalizeUserId(userId),

          before:
            rowToBonus(before),

          after:
            null,

          db: client,
        });


        return {
          ok: true,
          deleted: 1,
        };
      }
    );


  return result;
}


// ======================================================================
// MARK READY
// ======================================================================

export async function markReady(
  bonusId,
  {
    userId = null,
  } = {}
) {
  await ensureTables();

  const id =
    normalizePositiveInteger(
      bonusId
    );


  if (!id) {
    return {
      ok: false,
      error:
        'bonus_id inválido',
    };
  }


  const current =
    await getById(id);


  if (!current.ok) {
    return current;
  }


  if (
    !Array.isArray(
      current.items
    ) ||
    current.items.length === 0
  ) {
    return {
      ok: false,
      error:
        'A bonificação precisa possuir pelo menos um item',
    };
  }


  return update(
    id,
    {
      status: 'READY',
    },
    {
      userId,
      operation:
        'MARK_READY',
    }
  );
}

// ======================================================================
// NF-e ISSUANCE
// ======================================================================

function providerDocuments(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(providerDocuments);
  if (Array.isArray(data.documents)) return data.documents.flatMap(providerDocuments);
  if (Array.isArray(data.data)) return data.data.flatMap(providerDocuments);
  if (Array.isArray(data.resumo)) return data.resumo.flatMap(providerDocuments);
  if (data.data && typeof data.data === 'object') return providerDocuments(data.data);
  if (data.resumo && typeof data.resumo === 'object') return providerDocuments(data.resumo);
  return typeof data === 'object' ? [data] : [];
}

function providerValue(document, data, keys) {
  for (const source of [document, data]) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return value;
    }
  }
  return null;
}

function providerStatus(document, data) {
  const raw = String(providerValue(document, data, ['status','situacao','state']) || '').toUpperCase();
  const message = String(providerValue(document, data, ['mensagem','message','motivo']) || '');
  if (['AUTORIZADA','AUTORIZADO','CONCLUIDO','CONCLUÍDO'].includes(raw) || /autorizad[ao]/i.test(message)) return 'AUTORIZADA';
  if (['REJEITADA','REJEITADO'].includes(raw) || /rejei[cç][aã]o/i.test(message)) return 'REJEITADA';
  if (['CANCELADA','CANCELADO'].includes(raw)) return 'CANCELADA';
  if (['DENEGADA','DENEGADO'].includes(raw)) return 'DENEGADA';
  if (['PROCESSANDO','PROCESSAMENTO','ENVIANDO','PENDENTE'].includes(raw)) return 'PROCESSANDO';
  return raw || 'PROCESSANDO';
}

function unwrapCustomer(value) {
  return value?.data?.customer || value?.data || value?.customer || value || {};
}

function selectOperationCfop(bonus) {
  const issuerState = String(process.env.NFE_EMPRESA_UF || process.env.EMPRESA_UF || '').trim().toUpperCase();
  const customerState = String(bonus.customer_state || '').trim().toUpperCase();
  if (!customerState) throw Object.assign(new Error('UF do destinatário não informada.'), { status: 422, code: 'BONUS_CUSTOMER_STATE_MISSING' });
  if (!issuerState && bonus.cfop_internal !== bonus.cfop_interstate) {
    throw Object.assign(new Error('Configure NFE_EMPRESA_UF para selecionar o CFOP da bonificação.'), { status: 500, code: 'ISSUER_STATE_NOT_CONFIGURED' });
  }
  const cfop = issuerState && issuerState === customerState
    ? bonus.cfop_internal
    : bonus.cfop_interstate;
  if (!/^\d{4}$/.test(String(cfop || ''))) {
    throw Object.assign(new Error('Configure o CFOP interno/interestadual da operação de bonificação.'), { status: 422, code: 'BONUS_OPERATION_CFOP_MISSING' });
  }
  return String(cfop);
}

export async function getBonusNfePreparedData(bonusId) {
  const result = await getById(bonusId);
  if (!result.ok) throw Object.assign(new Error('Bonificação não encontrada.'), { status: 404, code: 'BONUS_NOT_FOUND' });
  const { bonus } = result;
  if (!result.items.length) throw Object.assign(new Error('A bonificação não possui itens.'), { status: 422, code: 'BONUS_WITHOUT_ITEMS' });
  if (String(bonus.operation_code).toUpperCase() !== 'BONUS') {
    throw Object.assign(new Error('A operação fiscal selecionada não é de bonificação.'), { status: 422, code: 'INVALID_BONUS_OPERATION' });
  }
  const cfop = selectOperationCfop(bonus);
  const customer = unwrapCustomer(await customersApi.getById(bonus.customer_id));
  return {
    ...bonus,
    ...customer,
    id: null,
    order_id: null,
    budget_id: null,
    bonus_id: bonus.bonus_id,
    customer_name: bonus.customer_name || customer.legal_name || customer.trade_name,
    customer_tax_id: bonus.customer_tax_id || customer.tax_id,
    consumidor_final: false,
    generates_receivable: false,
    fiscal_operation: {
      code: bonus.operation_code,
      nature_operation: bonus.nature_operation,
      cfop,
      generates_receivable: false,
      moves_stock: bonus.moves_stock,
    },
    items: result.items.map((item) => ({
      ...item,
      sku: item.product_code,
      unit: item.unit || 'UN',
      unit_price: Number(item.unit_value || 0),
      discount_value: 0,
      operation_cfop: cfop,
    })),
  };
}

async function claimForIssuance(bonusId, userId) {
  const { rows } = await pool.query(`
    UPDATE ${TB_BONUS}
       SET nfe_issue_status = 'ENVIANDO', nfe_issue_error = NULL,
           nfe_issued_by = $2, nfe_issued_at = COALESCE(nfe_issued_at, NOW()),
           status = 'PROCESSING', updated_at = NOW()
     WHERE bonus_id = $1
       AND UPPER(status) IN ('READY','REJECTED')
       AND COALESCE(UPPER(nfe_issue_status), '') = ANY($3::text[])
    RETURNING bonus_id
  `, [bonusId, normalizeUserId(userId), ['', 'ERRO', 'REJEITADA']]);
  if (rows[0]) return;
  throw Object.assign(new Error('Esta bonificação já foi enviada ou não está pronta para emissão.'), { status: 409, code: 'BONUS_NFE_ALREADY_ISSUED_OR_NOT_READY' });
}

export async function issueBonusNfe(bonusId, { userId = null } = {}) {
  await ensureTables();
  const prepared = await getBonusNfePreparedData(bonusId);
  await claimForIssuance(prepared.bonus_id, userId);
  try {
    const payload = await tecnospeedNfeApi.buildNFeFromOrder({ header: prepared, items: prepared.items });
    let idIntegracao = `BON-${prepared.bonus_id}`;
    payload.idIntegracao = idIntegracao;
    const listed = await tecnospeedNfeApi.listarNFe({ q: idIntegracao });
    const existing = listed?.ok ? providerDocuments(listed.data).find((doc) => String(doc?.idIntegracao || '') === idIntegracao) : null;
    let response;
    if (existing && !['REJEITADA','REJEITADO','ERRO'].includes(String(existing.status || '').toUpperCase())) {
      response = { ok: true, data: existing, recovered: true };
    } else {
      if (existing) { idIntegracao = `BON-${prepared.bonus_id}-R${Date.now()}`; payload.idIntegracao = idIntegracao; }
      response = await tecnospeedNfeApi.emitirNFe(payload);
    }
    if (!response?.ok) throw Object.assign(new Error(String(response?.error?.message || response?.message || 'O provedor recusou a NF-e.')), { status: Number(response?.status) || 502, code: 'NFE_PROVIDER_ERROR' });
    const document = providerDocuments(response.data)[0] || {};
    const providerId = providerValue(document, response.data, ['id','_id','documentId','document_id','idDocumento']);
    if (!providerId) throw Object.assign(new Error('O provedor não retornou o identificador da NF-e.'), { status: 502, code: 'NFE_PROVIDER_ID_MISSING' });
    const status = providerStatus(document, response.data);
    const protocol = providerValue(document, response.data, ['protocolo','protocol','numeroProtocolo']);
    await pool.query(`UPDATE ${TB_BONUS} SET nfe_issue_status=$2, nfe_provider_id=$3, nfe_id_integracao=$4, nfe_protocol=$5, nfe_environment=$6, nfe_issue_error=NULL, updated_at=NOW() WHERE bonus_id=$1`, [prepared.bonus_id, status, String(providerId), idIntegracao, protocol, document.ambiente || process.env.NFE_AMBIENTE || null]);
    return { bonus_id: prepared.bonus_id, provider_id: String(providerId), id_integracao: idIntegracao, protocol, status, recovered: Boolean(response.recovered) };
  } catch (error) {
    await pool.query(`UPDATE ${TB_BONUS} SET status='REJECTED', nfe_issue_status='ERRO', nfe_issue_error=LEFT($2,2000), updated_at=NOW() WHERE bonus_id=$1`, [prepared.bonus_id, String(error.message || error)]).catch(() => {});
    throw error;
  }
}

async function getNfeReference(bonusId) {
  const id = normalizePositiveInteger(bonusId);
  const { rows } = await pool.query(`SELECT * FROM ${TB_BONUS} WHERE bonus_id=$1`, [id]);
  if (!rows[0]) throw Object.assign(new Error('Bonificação não encontrada.'), { status: 404, code: 'BONUS_NOT_FOUND' });
  if (!rows[0].nfe_provider_id && !rows[0].nfe_id_integracao) throw Object.assign(new Error('A bonificação ainda não possui NF-e vinculada.'), { status: 404, code: 'BONUS_NFE_NOT_FOUND' });
  return rows[0];
}

async function resolveProviderId(reference) {
  if (reference.nfe_provider_id) return String(reference.nfe_provider_id);
  const listed = await tecnospeedNfeApi.listarNFe({ q: reference.nfe_id_integracao });
  const exact = providerDocuments(listed?.data).find((doc) => String(doc?.idIntegracao || '') === String(reference.nfe_id_integracao));
  const id = providerValue(exact, exact, ['id','_id','documentId','document_id','idDocumento']);
  if (!id) throw Object.assign(new Error('NF-e não localizada no provedor.'), { status: 404, code: 'NFE_PROVIDER_DOCUMENT_NOT_FOUND' });
  return String(id);
}

async function moveBonusStockOnce(bonusId, userId) {
  return withTransaction(async (client) => {
    const lock = await client.query(`SELECT nfe_stock_moved_at FROM ${TB_BONUS} WHERE bonus_id=$1 FOR UPDATE`, [bonusId]);
    if (lock.rows[0]?.nfe_stock_moved_at) return false;
    const { rows: items } = await client.query(`SELECT * FROM ${TB_BONUS_ITEMS} WHERE bonus_id=$1 ORDER BY item_sequence FOR UPDATE`, [bonusId]);
    for (const item of items) {
      if (!item.lot_id) throw Object.assign(new Error(`Item ${item.product_code} sem lote para movimentar estoque.`), { code: 'BONUS_ITEM_WITHOUT_LOT' });
      const lot = await client.query(`UPDATE ${TB_STOCK_LOTS} SET qty_on_hand=qty_on_hand-$2, updated_at=NOW() WHERE lot_id=$1 AND (qty_on_hand-qty_reserved) >= $2 RETURNING *`, [item.lot_id, item.quantity]);
      if (!lot.rows[0]) throw Object.assign(new Error(`Estoque insuficiente no lote do produto ${item.product_code}.`), { code: 'BONUS_INSUFFICIENT_STOCK' });
      const product = await client.query(`SELECT product_stock_id FROM ${TB_PRODUCTS} WHERE product_id=$1`, [item.product_id]);
      if (product.rows[0]?.product_stock_id) await client.query(`UPDATE ${TB_STOCK} SET stock_qty=stock_qty-$2 WHERE product_stock_id=$1`, [product.rows[0].product_stock_id, item.quantity]);
      await createAuditLog({ tabela:'nfeBonusItems', register_id:item.bonus_item_id, operation:'BONUS_STOCK_OUT', user_id:normalizeUserId(userId), before:{ quantity:Number(item.quantity), lot_id:Number(item.lot_id) }, after:{ quantity:Number(item.quantity), lot_id:Number(item.lot_id), nfe_bonus_id:Number(bonusId) }, db:client });
    }
    await client.query(`UPDATE ${TB_BONUS} SET nfe_stock_moved_at=NOW(), updated_at=NOW() WHERE bonus_id=$1`, [bonusId]);
    return true;
  });
}

export async function reconcileBonusNfe(bonusId, { userId = null } = {}) {
  const reference = await getNfeReference(bonusId);
  const providerId = await resolveProviderId(reference);
  const response = await tecnospeedNfeApi.consultarNFe(providerId);
  if (!response?.ok) throw Object.assign(new Error('Falha ao consultar a NF-e no provedor.'), { status: Number(response?.status)||502, code:'NFE_PROVIDER_STATUS_FAILED' });
  const document = providerDocuments(response.data)[0] || {};
  const status = providerStatus(document, response.data);
  const protocol = providerValue(document, response.data, ['protocolo','protocol','numeroProtocolo']) || reference.nfe_protocol;
  const accessKey = providerValue(document, response.data, ['chave','chaveAcesso','chave_acesso','accessKey']);
  await pool.query(`UPDATE ${TB_BONUS} SET nfe_provider_id=$2,nfe_issue_status=$3,nfe_protocol=$4,nfe_access_key=COALESCE($5,nfe_access_key),nfe_issue_error=$6,nfe_last_checked_at=NOW(),status=CASE WHEN $3='AUTORIZADA' THEN 'AUTHORIZED' WHEN $3 IN ('REJEITADA','DENEGADA') THEN 'REJECTED' ELSE status END,updated_at=NOW() WHERE bonus_id=$1`, [reference.bonus_id,providerId,status,protocol,accessKey,['REJEITADA','DENEGADA','ERRO'].includes(status)?String(providerValue(document,response.data,['mensagem','message','motivo'])||'NF-e não autorizada.'):null]);
  let invoice = null;
  if (status === 'AUTORIZADA') {
    const prepared = await getBonusNfePreparedData(reference.bonus_id);
    const sync = await invoicesIssuedApi.upsertFromBonus({ bonus_id:reference.bonus_id,nfe_number:document.numero?Number(document.numero):null,nfe_key:accessKey,nfe_status:status,nfe_protocol:protocol,nfe_environment:reference.nfe_environment||process.env.NFE_AMBIENTE||null,xml_url:`/api/nfe-bonus/${reference.bonus_id}/xml`,danfe_url:`/api/nfe-bonus/${reference.bonus_id}/danfe.pdf`,issued_at:reference.nfe_issued_at||new Date(),total_amount:prepared.total_amount,customer_name:prepared.customer_name,customer_tax_id:prepared.customer_tax_id,customer_email:prepared.customer_email }, { userId });
    if (!sync.ok) throw Object.assign(new Error(sync.error), { status:500, code:'INVOICES_ISSUED_SYNC_FAILED' });
    invoice = sync.invoice;
    await pool.query(`UPDATE ${TB_BONUS} SET invoice_id=$2 WHERE bonus_id=$1`, [reference.bonus_id, invoice.invoice_id]);
    if (prepared.moves_stock) await moveBonusStockOnce(reference.bonus_id, userId);
  }
  return { bonus_id:Number(reference.bonus_id),provider_id:providerId,status,protocol,access_key:accessKey||null,xml_url:status==='AUTORIZADA'?`/api/nfe-bonus/${reference.bonus_id}/xml`:null,danfe_url:status==='AUTORIZADA'?`/api/nfe-bonus/${reference.bonus_id}/danfe.pdf`:null,invoices_issued:invoice };
}

export async function getBonusNfeXml(bonusId) {
  const reference = await getNfeReference(bonusId); const providerId = await resolveProviderId(reference); const response = await tecnospeedNfeApi.obterXml(providerId);
  if (!response?.ok || !response.xml) throw Object.assign(new Error('Não foi possível obter o XML da NF-e.'), { status:Number(response?.status)||502, code:'BONUS_NFE_XML_FAILED' });
  return { xml:response.xml, providerId };
}

export async function getBonusNfeDanfe(bonusId) {
  const reference = await getNfeReference(bonusId); const providerId = await resolveProviderId(reference); const response = await tecnospeedNfeApi.obterPdf(providerId);
  if (!response?.ok || !response.buffer) throw Object.assign(new Error('Não foi possível obter o DANFE da NF-e.'), { status:Number(response?.status)||502, code:'BONUS_NFE_DANFE_FAILED' });
  return { buffer:Buffer.from(response.buffer), providerId };
}


// ======================================================================
// DEFAULT EXPORT
// ======================================================================

export default {
  ensureTables,

  getBonusOperation,

  create,
  getById,
  search,
  update,
  remove,

  addItem,
  listItems,
  updateItem,
  removeItem,

  recalculateBonusTotal,

  markReady,

  getBonusNfePreparedData,
  issueBonusNfe,
  reconcileBonusNfe,
  getBonusNfeXml,
  getBonusNfeDanfe,
};
