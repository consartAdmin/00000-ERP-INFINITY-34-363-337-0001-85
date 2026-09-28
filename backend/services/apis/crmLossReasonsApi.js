/*||============================================||
  ||--------------------------------------------||
  ||-------- crmLossReasonsApi.js --------------||
  ||--------------------------------------------||
  ||============================================||*/

import pool from '../../config/db.js';

/*================================================
 * CATALOG_SCHEMA
 *================================================*/
const catalog_schema = {
  table: 'crmLossReasons',

  idField: 'id',

  fields: [
    'reason_name',
    'is_active',
    'created_at'
  ],

  searchFields: [
    'reason_name'
  ],

  defaultOrder: 'reason_name ASC'
};

/*======================================
 * HELPERS
 *======================================*/
function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;

  const v = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;

  return fallback;
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function normalizeId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid id.');
  }

  return id;
}

function mapRow(r) {
  if (!r) return null;

  return {
    id: r.id ?? null,
    reason_name: r.reason_name ?? null,
    is_active: r.is_active ?? true,
    created_at: r.created_at ?? null,
    reason_label: r.reason_name ?? null
  };
}

/*======================================
 * API
 *======================================*/
const crmLossReasonsApi = {
  async listAll({ onlyActive = false } = {}) {
    const params = [];
    let whereClause = '';

    if (onlyActive) {
      params.push(true);
      whereClause = `WHERE is_active = $${params.length}`;
    }

    const sql = `
      SELECT
        id,
        reason_name,
        is_active,
        created_at
      FROM "crmLossReasons"
      ${whereClause}
      ORDER BY reason_name ASC, id ASC
    `;

    const { rows } = await pool.query(sql, params);
    return rows.map(mapRow);
  },

  async listActive() {
    return this.listAll({ onlyActive: true });
  },

  async getById(id) {
    const normalizedId = normalizeId(id);

    const sql = `
      SELECT
        id,
        reason_name,
        is_active,
        created_at
      FROM "crmLossReasons"
      WHERE id = $1
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [normalizedId]);
    return mapRow(rows[0] || null);
  },

  async create(data = {}) {
    const reasonName = sanitizeText(data.reason_name);
    const isActive = normalizeBoolean(data.is_active, true);

    if (!reasonName) {
      throw new Error('reason_name is required.');
    }

    const duplicatedSql = `
      SELECT id
      FROM "crmLossReasons"
      WHERE LOWER(reason_name) = LOWER($1)
      LIMIT 1
    `;

    const duplicated = await pool.query(duplicatedSql, [reasonName]);

    if (duplicated.rows.length > 0) {
      throw new Error('A loss reason with this name already exists.');
    }

    const insertSql = `
      INSERT INTO "crmLossReasons" (
        reason_name,
        is_active
      )
      VALUES ($1, $2)
      RETURNING
        id,
        reason_name,
        is_active,
        created_at
    `;

    const { rows } = await pool.query(insertSql, [reasonName, isActive]);
    return mapRow(rows[0]);
  }
};

export default crmLossReasonsApi;