// ╔══════════════════════════════════════════════════════════════════════╗
// ║ labelParametersApi.js — API for label parameters + price helpers    ║
// ║ CONSART ERP — Visual label layout + pricing helpers for labels      ║
// ║ UPDATE: simplified payload + layout_json support                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// Tabela real no Postgres
export const LABEL_PARAMETERS_TABLE = 'public."labelParameters"';

// Price tables used by Labels module
export const PRICES_TABLE = 'public.prices';
export const PRODUCTS_PRICES_TABLE = 'public."productsPrices"';

/**
 * Helper: executes callback with dedicated client (pool.connect)
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/* ======================================================================
   WRITABLE COLUMNS
   ====================================================================== */

const WRITABLE_COLUMNS = [
  'user_id',
  'name',
  'page_width_mm',
  'page_height_mm',
  'label_width_mm',
  'label_height_mm',
  'active',
  'layout_json',
];

/* ======================================================================
   NORMALIZATION
   ====================================================================== */

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;

  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;

  const n = parseInt(String(value), 10);
  return Number.isInteger(n) ? n : fallback;
}

function parseLayoutJson(raw) {
  if (!raw) {
    return {
      version: 1,
      elements: [],
    };
  }

  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    console.warn('[labelParametersApi] Invalid layout_json, using default.', err);
    return {
      version: 1,
      elements: [],
    };
  }
}

function sanitizeDesignerElement(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;

  const align = ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'left';
  const weight = String(raw.weight || '400');

  return {
    id: String(raw.id || `el_${Date.now()}_${index}`),
    type: String(raw.type || 'custom'),
    key: String(raw.key || raw.type || 'custom'),
    text: String(raw.text ?? ''),
    x: normalizeNumber(raw.x, 0),
    y: normalizeNumber(raw.y, 0),
    w: Math.max(2, normalizeNumber(raw.w, 20)),
    h: Math.max(2, normalizeNumber(raw.h, 5)),
    fontSize: Math.max(3, normalizeNumber(raw.fontSize, 6)),
    align,
    weight,
    visible: normalizeBoolean(raw.visible, true),
  };
}

function normalizeLayoutJson(raw) {
  const parsed = parseLayoutJson(raw);

  const elements = Array.isArray(parsed?.elements)
    ? parsed.elements.map(sanitizeDesignerElement).filter(Boolean)
    : [];

  return {
    version: normalizeInteger(parsed?.version, 1) || 1,
    elements,
  };
}

function normalizePayload(payload = {}) {
  const normalized = {};

  if ('user_id' in payload) {
    normalized.user_id = normalizeInteger(payload.user_id, null);
  }

  if ('name' in payload) {
    normalized.name = String(payload.name ?? '').trim();
  }

  if ('page_width_mm' in payload) {
    normalized.page_width_mm = normalizeNumber(payload.page_width_mm, null);
  }

  if ('page_height_mm' in payload) {
    normalized.page_height_mm = normalizeNumber(payload.page_height_mm, null);
  }

  if ('label_width_mm' in payload) {
    normalized.label_width_mm = normalizeNumber(payload.label_width_mm, null);
  }

  if ('label_height_mm' in payload) {
    normalized.label_height_mm = normalizeNumber(payload.label_height_mm, null);
  }

  if ('active' in payload) {
    normalized.active = normalizeBoolean(payload.active, true);
  }

  if ('layout_json' in payload) {
    normalized.layout_json = normalizeLayoutJson(payload.layout_json);
  }

  return normalized;
}

/* ======================================================================
   VALIDATION
   ====================================================================== */

function validateCreatePayload(payload) {
  if (!payload.name) {
    throw new Error('O campo "name" é obrigatório.');
  }

  if (payload.page_width_mm == null) {
    throw new Error('O campo "page_width_mm" é obrigatório.');
  }

  if (payload.page_height_mm == null) {
    throw new Error('O campo "page_height_mm" é obrigatório.');
  }

  if (payload.label_width_mm == null) {
    throw new Error('O campo "label_width_mm" é obrigatório.');
  }

  if (payload.label_height_mm == null) {
    throw new Error('O campo "label_height_mm" é obrigatório.');
  }

  if (!payload.layout_json || !Array.isArray(payload.layout_json.elements)) {
    throw new Error('O campo "layout_json" é obrigatório e deve conter um layout válido.');
  }
}

function validateUpdatePayload(payload) {
  if ('name' in payload && !String(payload.name || '').trim()) {
    throw new Error('O campo "name" não pode ficar vazio.');
  }

  if ('layout_json' in payload) {
    if (!payload.layout_json || !Array.isArray(payload.layout_json.elements)) {
      throw new Error('O campo "layout_json" deve conter um layout válido.');
    }
  }
}

/* ======================================================================
   QUERY BUILDERS
   ====================================================================== */

function buildInsertQuery(payload) {
  const keys = Object.keys(payload).filter((k) => WRITABLE_COLUMNS.includes(k));

  if (!keys.length) {
    throw new Error('[labelParametersApi] No valid columns provided for INSERT');
  }

  const columnsSql = keys.join(', ');
  const valuesSql = keys
    .map((key, idx) => (key === 'layout_json' ? `$${idx + 1}::jsonb` : `$${idx + 1}`))
    .join(', ');

  const values = keys.map((k) => (k === 'layout_json' ? JSON.stringify(payload[k]) : payload[k]));

  const text = `
    INSERT INTO ${LABEL_PARAMETERS_TABLE} (${columnsSql})
    VALUES (${valuesSql})
    RETURNING *
  `;

  return { text, values };
}

function buildUpdateQuery(id, payload) {
  const keys = Object.keys(payload).filter((k) => WRITABLE_COLUMNS.includes(k));

  if (!keys.length) {
    throw new Error('[labelParametersApi] No valid columns provided for UPDATE');
  }

  const setSql = keys
    .map((k, idx) => {
      if (k === 'layout_json') {
        return `${k} = $${idx + 1}::jsonb`;
      }
      return `${k} = $${idx + 1}`;
    })
    .join(', ');

  const values = keys.map((k) => (k === 'layout_json' ? JSON.stringify(payload[k]) : payload[k]));
  values.push(id);

  const text = `
    UPDATE ${LABEL_PARAMETERS_TABLE}
       SET ${setSql},
           updated_at = now()
     WHERE id = $${values.length}
     RETURNING *
  `;

  return { text, values };
}

/* ======================================================================
   PUBLIC API — labelParameters
   ====================================================================== */

/**
 * List label parameters (optionally filtered by userId and active)
 * @param {{ userId?: number | null, active?: boolean | null }} [filters]
 */
async function listLabelParameters(filters = {}) {
  const { userId = null, active = null } = filters;

  return withClient(async (client) => {
    const where = [];
    const values = [];

    if (userId !== null && !Number.isNaN(Number(userId))) {
      values.push(Number(userId));
      where.push(`user_id = $${values.length}`);
    }

    if (active !== null) {
      values.push(Boolean(active));
      where.push(`active = $${values.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const query = `
      SELECT
        id,
        user_id,
        name,
        page_width_mm,
        page_height_mm,
        label_width_mm,
        label_height_mm,
        active,
        layout_json,
        created_at,
        updated_at
      FROM ${LABEL_PARAMETERS_TABLE}
      ${whereSql}
      ORDER BY created_at DESC, id DESC;
    `;

    const result = await client.query(query, values);
    return result.rows;
  });
}

/**
 * Get label parameters by ID
 * @param {number} id
 */
async function getLabelParametersById(id) {
  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT
        id,
        user_id,
        name,
        page_width_mm,
        page_height_mm,
        label_width_mm,
        label_height_mm,
        active,
        layout_json,
        created_at,
        updated_at
      FROM ${LABEL_PARAMETERS_TABLE}
      WHERE id = $1
      `,
      [id],
    );

    return result.rows[0] || null;
  });
}

/**
 * Create a new label parameter entry
 * @param {object} payload
 */
async function createLabelParameters(payload) {
  return withClient(async (client) => {
    const normalized = normalizePayload(payload);
    validateCreatePayload(normalized);

    const { text, values } = buildInsertQuery(normalized);
    const result = await client.query(text, values);

    return result.rows[0];
  });
}

/**
 * Update an existing label parameter entry
 * @param {number} id
 * @param {object} payload
 */
async function updateLabelParameters(id, payload) {
  return withClient(async (client) => {
    const normalized = normalizePayload(payload);
    validateUpdatePayload(normalized);

    const { text, values } = buildUpdateQuery(id, normalized);
    const result = await client.query(text, values);

    return result.rows[0] || null;
  });
}

/**
 * Delete label parameters by ID
 * @param {number} id
 */
async function deleteLabelParameters(id) {
  return withClient(async (client) => {
    const result = await client.query(
      `
      DELETE FROM ${LABEL_PARAMETERS_TABLE}
      WHERE id = $1
      RETURNING *
      `,
      [id],
    );

    return result.rows[0] || null;
  });
}

/* ======================================================================
   PUBLIC API — prices / productsPrices (for labelsController)
   ====================================================================== */

/**
 * List available price tables
 */
async function listPriceTables() {
  return withClient(async (client) => {
    const result = await client.query(`
      SELECT
        price_id,
        name,
        description,
        active
      FROM ${PRICES_TABLE}
      ORDER BY price_id ASC;
    `);

    return result.rows;
  });
}

/**
 * Get product price for label generation
 *
 * @param {string|number} productCodeOrBarcode
 * @param {number} priceTableId
 * @returns {Promise<number|null>}
 */
async function getProductPriceForLabel(productCodeOrBarcode, priceTableId) {
  const code = String(productCodeOrBarcode ?? '').trim();
  const priceId = Number(priceTableId);

  if (!code || !Number.isInteger(priceId) || priceId <= 0) {
    console.warn('[labelParametersApi] Invalid productCodeOrBarcode or priceTableId', {
      productCodeOrBarcode,
      priceTableId,
      code,
      priceId,
    });
    return null;
  }

  return withClient(async (client) => {
    const query = `
      SELECT
        pp.sale_price AS price
      FROM public.products p
      LEFT JOIN ${PRODUCTS_PRICES_TABLE} pp
        ON pp.product_id::varchar = p.product_id::varchar
      WHERE
        pp.price_id = $1::INTEGER
        AND (
             p.product_code::varchar = $2::varchar
          OR p.barcode::varchar      = $2::varchar
          OR p.product_id::varchar   = $2::varchar
        )
      ORDER BY pp.updated_at DESC NULLS LAST
      LIMIT 1;
    `;

    const { rows } = await client.query(query, [priceId, code]);

    if (!rows.length) return null;

    const value = rows[0].price;
    return value != null ? Number(value) : null;
  });
}

const labelParametersApi = {
  listLabelParameters,
  getLabelParametersById,
  createLabelParameters,
  updateLabelParameters,
  deleteLabelParameters,
  listPriceTables,
  getProductPriceForLabel,
};

export default labelParametersApi;