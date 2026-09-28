// ╔══════════════════════════════════════════════════════════════════════╗
// ║ licitationsApi.js — Acesso a dados de Licitações                    ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

const TABLE_NAME = 'public.licitationitems';

const ALLOWED_SORT_COLUMNS = new Set([
    'id',
    'process_number',
    'licitation_number',
    'agency_name',
    'modality',
    'state',
    'city',
    'session_date',
    'proposal_deadline',
    'lot_number',
    'item_number',
    'product_description',
    'quantity',
    'estimated_unit_price',
    'estimated_total_price',
    'cost_price',
    'minimum_sale_price',
    'proposed_price',
    'estimated_margin',
    'status',
    'created_at',
    'updated_at',
]);

function normalizePagination(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

function buildFilters(filters = {}) {
    const where = [];
    const values = [];

    const addValue = (value) => {
        values.push(value);
        return `$${values.length}`;
    };

    const {
        search,
        status,
        modality,
        state,
        city,
        agency_name,
        process_number,
        licitation_number,
        participation,
        session_date_from,
        session_date_to,
        proposal_deadline_from,
        proposal_deadline_to,
        product_id,
    } = filters;

    if (search) {
        const p = addValue(`%${String(search).trim()}%`);
        where.push(`(
      process_number ILIKE ${p}
      OR licitation_number ILIKE ${p}
      OR agency_name ILIKE ${p}
      OR product_description ILIKE ${p}
      OR sku ILIKE ${p}
      OR catmat_code ILIKE ${p}
      OR city ILIKE ${p}
    )`);
    }

    if (status) {
        where.push(`status = ${addValue(String(status).trim())}`);
    }

    if (modality) {
        where.push(`modality = ${addValue(String(modality).trim())}`);
    }

    if (state) {
        where.push(`state = ${addValue(String(state).trim().toUpperCase())}`);
    }

    if (city) {
        where.push(`city ILIKE ${addValue(`%${String(city).trim()}%`)}`);
    }

    if (agency_name) {
        where.push(`agency_name ILIKE ${addValue(`%${String(agency_name).trim()}%`)}`);
    }

    if (process_number) {
        where.push(`process_number ILIKE ${addValue(`%${String(process_number).trim()}%`)}`);
    }

    if (licitation_number) {
        where.push(`licitation_number ILIKE ${addValue(`%${String(licitation_number).trim()}%`)}`);
    }

    if (participation !== undefined && participation !== null && participation !== '') {
        const boolValue =
            participation === true ||
            participation === 'true' ||
            participation === '1' ||
            participation === 1;

        where.push(`participation = ${addValue(boolValue)}`);
    }

    if (session_date_from) {
        where.push(`session_date >= ${addValue(session_date_from)}`);
    }

    if (session_date_to) {
        where.push(`session_date <= ${addValue(session_date_to)}`);
    }

    if (proposal_deadline_from) {
        where.push(`proposal_deadline >= ${addValue(proposal_deadline_from)}`);
    }

    if (proposal_deadline_to) {
        where.push(`proposal_deadline <= ${addValue(proposal_deadline_to)}`);
    }

    if (product_id) {
        where.push(`product_id = ${addValue(Number(product_id))}`);
    }

    return {
        clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
        values,
    };
}

function sanitizePayload(payload = {}) {
    const allowed = [
        'process_number',
        'licitation_number',
        'portal',
        'portal_url',
        'agency_name',
        'agency_document',
        'modality',
        'state',
        'city',
        'session_date',
        'proposal_deadline',
        'lot_number',
        'item_number',
        'product_description',
        'catmat_code',
        'catser_code',
        'quantity',
        'unit',
        'estimated_unit_price',
        'estimated_total_price',
        'product_id',
        'sku',
        'brand',
        'manufacturer',
        'cost_price',
        'freight_cost',
        'tax_cost',
        'minimum_sale_price',
        'proposed_price',
        'estimated_margin',
        'participation',
        'status',
        'responsible',
        'observations',
    ];

    const result = {};

    for (const field of allowed) {
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
            result[field] = payload[field] === '' ? null : payload[field];
        }
    }

    if (result.state) {
        result.state = String(result.state).trim().toUpperCase();
    }

    if (result.status) {
        result.status = String(result.status).trim().toUpperCase();
    }

    if (Object.prototype.hasOwnProperty.call(result, 'participation')) {
        result.participation =
            result.participation === true ||
            result.participation === 'true' ||
            result.participation === 1 ||
            result.participation === '1';
    }

    return result;
}

export async function ensureLicitationItemsTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id                    SERIAL PRIMARY KEY,
      process_number        VARCHAR(100),
      licitation_number     VARCHAR(100),
      portal                VARCHAR(100),
      portal_url            TEXT,
      agency_name           VARCHAR(255) NOT NULL,
      agency_document       VARCHAR(20),
      modality              VARCHAR(50),
      state                 CHAR(2),
      city                  VARCHAR(120),
      session_date          TIMESTAMP,
      proposal_deadline     TIMESTAMP,
      lot_number            VARCHAR(30),
      item_number           VARCHAR(30),
      product_description   TEXT NOT NULL,
      catmat_code           VARCHAR(50),
      catser_code           VARCHAR(50),
      quantity              NUMERIC(15,4),
      unit                  VARCHAR(20),
      estimated_unit_price  NUMERIC(15,4),
      estimated_total_price NUMERIC(15,2),
      product_id            INTEGER,
      sku                   VARCHAR(30),
      brand                 VARCHAR(120),
      manufacturer          VARCHAR(120),
      cost_price            NUMERIC(15,4),
      freight_cost          NUMERIC(15,4),
      tax_cost              NUMERIC(15,4),
      minimum_sale_price    NUMERIC(15,4),
      proposed_price        NUMERIC(15,4),
      estimated_margin      NUMERIC(8,2),
      participation         BOOLEAN DEFAULT FALSE,
      status                VARCHAR(30) DEFAULT 'FOUND',
      responsible           VARCHAR(120),
      observations          TEXT,
      created_at            TIMESTAMP DEFAULT NOW(),
      updated_at            TIMESTAMP DEFAULT NOW()
    );
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licitation_items_status
      ON ${TABLE_NAME} (status);
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licitation_items_session_date
      ON ${TABLE_NAME} (session_date);
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licitation_items_agency_name
      ON ${TABLE_NAME} (agency_name);
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licitation_items_process_number
      ON ${TABLE_NAME} (process_number);
  `);
}

let tableReadyPromise = null;

async function ensureTableReady() {
    if (!tableReadyPromise) {
        tableReadyPromise = ensureLicitationItemsTable().catch((error) => {
            tableReadyPromise = null;
            throw error;
        });
    }

    return tableReadyPromise;
}

export async function listLicitations(filters = {}) {
    await ensureTableReady();

    const page = normalizePagination(filters.page, 1);
    const limit = normalizePagination(filters.limit ?? filters.per_page, 20, 200);
    const offset = (page - 1) * limit;

    const requestedSort = String(filters.sort_by || 'session_date');
    const sortBy = ALLOWED_SORT_COLUMNS.has(requestedSort)
        ? requestedSort
        : 'session_date';

    const sortOrder =
        String(filters.sort_order || 'asc').toLowerCase() === 'desc'
            ? 'DESC'
            : 'ASC';

    const { clause, values } = buildFilters(filters);

    const countResult = await pool.query(
        `SELECT COUNT(*)::INTEGER AS total FROM ${TABLE_NAME} ${clause}`,
        values,
    );

    const dataValues = [...values, limit, offset];
    const limitPlaceholder = `$${values.length + 1}`;
    const offsetPlaceholder = `$${values.length + 2}`;

    const dataResult = await pool.query(
        `
      SELECT *
      FROM ${TABLE_NAME}
      ${clause}
      ORDER BY ${sortBy} ${sortOrder} NULLS LAST, id DESC
      LIMIT ${limitPlaceholder}
      OFFSET ${offsetPlaceholder}
    `,
        dataValues,
    );

    const total = countResult.rows[0]?.total || 0;

    return {
        rows: dataResult.rows,
        pagination: {
            page,
            limit,
            total,
            total_pages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export async function getLicitationById(id) {
    await ensureTableReady();

    const result = await pool.query(
        `SELECT * FROM ${TABLE_NAME} WHERE id = $1 LIMIT 1`,
        [id],
    );

    return result.rows[0] || null;
}

export async function createLicitation(payload) {
    await ensureTableReady();

    const data = sanitizePayload(payload);

    if (!data.agency_name) {
        const error = new Error('O órgão responsável é obrigatório.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    if (!data.product_description) {
        const error = new Error('A descrição do item é obrigatória.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    const fields = Object.keys(data);

    if (!fields.length) {
        const error = new Error('Nenhum campo válido foi informado.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    const values = Object.values(data);
    const placeholders = values.map((_, index) => `$${index + 1}`);

    const result = await pool.query(
        `
      INSERT INTO ${TABLE_NAME} (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `,
        values,
    );

    return result.rows[0];
}

export async function updateLicitation(id, payload) {
    await ensureTableReady();

    const data = sanitizePayload(payload);
    const fields = Object.keys(data);

    if (!fields.length) {
        const error = new Error('Nenhum campo válido foi informado para atualização.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'agency_name') && !data.agency_name) {
        const error = new Error('O órgão responsável não pode ficar vazio.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    if (
        Object.prototype.hasOwnProperty.call(data, 'product_description') &&
        !data.product_description
    ) {
        const error = new Error('A descrição do item não pode ficar vazia.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    const values = [];
    const assignments = fields.map((field, index) => {
        values.push(data[field]);
        return `${field} = $${index + 1}`;
    });

    values.push(id);

    const result = await pool.query(
        `
      UPDATE ${TABLE_NAME}
      SET
        ${assignments.join(', ')},
        updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `,
        values,
    );

    return result.rows[0] || null;
}

export async function deleteLicitation(id) {
    await ensureTableReady();

    const result = await pool.query(
        `DELETE FROM ${TABLE_NAME} WHERE id = $1 RETURNING *`,
        [id],
    );

    return result.rows[0] || null;
}

export async function updateLicitationStatus(id, status) {
    await ensureTableReady();

    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (!normalizedStatus) {
        const error = new Error('O status é obrigatório.');
        error.code = 'VALIDATION_ERROR';
        throw error;
    }

    const result = await pool.query(
        `
      UPDATE ${TABLE_NAME}
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
        [id, normalizedStatus],
    );

    return result.rows[0] || null;
}

export async function getLicitationsSummary(filters = {}) {
    await ensureTableReady();

    const { clause, values } = buildFilters(filters);

    const result = await pool.query(
        `
      SELECT
        COUNT(*)::INTEGER AS total_items,
        COUNT(*) FILTER (WHERE participation = TRUE)::INTEGER AS participating_items,
        COUNT(*) FILTER (WHERE status = 'FOUND')::INTEGER AS found_items,
        COUNT(*) FILTER (WHERE status = 'UNDER_ANALYSIS')::INTEGER AS analysis_items,
        COUNT(*) FILTER (WHERE status = 'APPROVED')::INTEGER AS approved_items,
        COUNT(*) FILTER (WHERE status = 'PROPOSAL_SENT')::INTEGER AS proposal_sent_items,
        COUNT(*) FILTER (WHERE status = 'WON')::INTEGER AS won_items,
        COUNT(*) FILTER (WHERE status = 'LOST')::INTEGER AS lost_items,
        COALESCE(SUM(estimated_total_price), 0)::NUMERIC AS estimated_total,
        COALESCE(SUM(proposed_price * quantity), 0)::NUMERIC AS proposed_total
      FROM ${TABLE_NAME}
      ${clause}
    `,
        values,
    );

    return result.rows[0];
}

export async function diagnoseLicitationsDatabase() {
    const connection = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_schema() AS current_schema,
      current_user AS database_user
  `);

    const relations = await pool.query(`
    SELECT
      n.nspname AS schema_name,
      c.relname AS relation_name,
      c.relkind AS relation_kind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n
      ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND LOWER(c.relname) IN ('licitationitems', 'licitation_items')
    ORDER BY c.relname
  `);

    return {
        connection: connection.rows[0] || null,
        relations: relations.rows,
        configured_table: TABLE_NAME,
    };
}

