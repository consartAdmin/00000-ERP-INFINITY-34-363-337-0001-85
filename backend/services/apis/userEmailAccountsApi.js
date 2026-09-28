// ╔══════════════════════════════════════════════════════════════════════╗
// ║ userEmailAccountsApi.js — API tabela public."userEmailAccounts"     ║
// ║ CONSART ERP                                                         ║
// ║ ✔ CRUD completo                                                     ║
// ║ ✔ vínculo users ↔ emailAccounts                                     ║
// ║ ✔ controle de is_default                                            ║
// ║ ✔ joins com usuário e conta de e-mail                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const USER_EMAIL_ACCOUNTS_TABLE = 'public."userEmailAccounts"';
export const USERS_TABLE = 'public."users"';
export const EMAIL_ACCOUNTS_TABLE = 'public."emailAccounts"';

async function withClient(pgPool, fn) {
  const client = await pgPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function toBool(v, def = false) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return def;
}

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isInteger(n) ? n : def;
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function normalizePayload(input = {}) {
  return {
    user_id: toIntOrNull(input.user_id),
    email_account_id: toIntOrNull(input.email_account_id),
    is_default: toBool(input.is_default, false),
    can_read: toBool(input.can_read, true),
    can_send: toBool(input.can_send, true),
  };
}

function normalizePatch(input = {}) {
  const out = {};

  if ('user_id' in input) out.user_id = toIntOrNull(input.user_id);
  if ('email_account_id' in input) out.email_account_id = toIntOrNull(input.email_account_id);
  if ('is_default' in input) out.is_default = toBool(input.is_default, false);
  if ('can_read' in input) out.can_read = toBool(input.can_read, true);
  if ('can_send' in input) out.can_send = toBool(input.can_send, true);

  return out;
}

function validateCreatePayload(payload) {
  const errors = [];

  if (!payload.user_id) errors.push('user_id is required');
  if (!payload.email_account_id) errors.push('email_account_id is required');

  return errors;
}

function buildBaseSelect() {
  return `
    SELECT
      uea.id,
      uea.user_id,
      uea.email_account_id,
      uea.is_default,
      uea.can_read,
      uea.can_send,
      uea.created_at,

      u.id AS user_ref_id,
      u.name AS user_name,
      u.email AS user_email,
      u.access_level AS user_access_level,
      u.is_active AS user_is_active,

      ea.id AS email_account_ref_id,
      ea.label AS email_account_label,
      ea.email_address AS email_account_address,
      ea.provider AS email_account_provider,
      ea.is_active AS email_account_is_active

    FROM ${USER_EMAIL_ACCOUNTS_TABLE} uea
    LEFT JOIN ${USERS_TABLE} u
      ON u.id = uea.user_id
    LEFT JOIN ${EMAIL_ACCOUNTS_TABLE} ea
      ON ea.id = uea.email_account_id
  `;
}

async function ensureUserExists(client, userId) {
  const sql = `
    SELECT id
    FROM ${USERS_TABLE}
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [userId]);
  return rows[0] || null;
}

async function ensureEmailAccountExists(client, emailAccountId) {
  const sql = `
    SELECT id
    FROM ${EMAIL_ACCOUNTS_TABLE}
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await client.query(sql, [emailAccountId]);
  return rows[0] || null;
}

async function clearDefaultFromOtherLinks(client, { user_id, except_id = null }) {
  const params = [user_id];
  let sql = `
    UPDATE ${USER_EMAIL_ACCOUNTS_TABLE}
       SET is_default = false
     WHERE user_id = $1
  `;

  if (except_id) {
    params.push(except_id);
    sql += ` AND id <> $2`;
  }

  await client.query(sql, params);
}

async function maybePromoteOneDefault(client, user_id) {
  const hasDefaultSql = `
    SELECT id
      FROM ${USER_EMAIL_ACCOUNTS_TABLE}
     WHERE user_id = $1
       AND is_default = true
     LIMIT 1
  `;
  const hasDefault = await client.query(hasDefaultSql, [user_id]);
  if (hasDefault.rowCount > 0) return;

  const pickSql = `
    SELECT id
      FROM ${USER_EMAIL_ACCOUNTS_TABLE}
     WHERE user_id = $1
     ORDER BY id ASC
     LIMIT 1
  `;
  const picked = await client.query(pickSql, [user_id]);
  if (picked.rowCount === 0) return;

  await client.query(
    `
      UPDATE ${USER_EMAIL_ACCOUNTS_TABLE}
         SET is_default = true
       WHERE id = $1
    `,
    [picked.rows[0].id]
  );
}

export async function getById(pgPool, id) {
  const rowId = toIntOrNull(id);
  if (!rowId) return null;

  return withClient(pgPool, async (client) => {
    const sql = `
      ${buildBaseSelect()}
      WHERE uea.id = $1
      LIMIT 1
    `;
    const { rows } = await client.query(sql, [rowId]);
    return rows[0] || null;
  });
}

export async function list(pgPool, filters = {}) {
  const page = Math.max(1, toInt(filters.page, 1));
  const pageSize = Math.min(200, Math.max(1, toInt(filters.pageSize, 50)));
  const offset = (page - 1) * pageSize;

  const clauses = [];
  const params = [];
  let p = 1;

  const userId = toIntOrNull(filters.user_id);
  const emailAccountId = toIntOrNull(filters.email_account_id);
  const isDefault =
    filters.is_default === '' || filters.is_default === undefined
      ? null
      : toBool(filters.is_default, false);
  const canRead =
    filters.can_read === '' || filters.can_read === undefined
      ? null
      : toBool(filters.can_read, true);
  const canSend =
    filters.can_send === '' || filters.can_send === undefined
      ? null
      : toBool(filters.can_send, true);

  if (userId) {
    clauses.push(`uea.user_id = $${p++}`);
    params.push(userId);
  }

  if (emailAccountId) {
    clauses.push(`uea.email_account_id = $${p++}`);
    params.push(emailAccountId);
  }

  if (isDefault !== null) {
    clauses.push(`uea.is_default = $${p++}`);
    params.push(isDefault);
  }

  if (canRead !== null) {
    clauses.push(`uea.can_read = $${p++}`);
    params.push(canRead);
  }

  if (canSend !== null) {
    clauses.push(`uea.can_send = $${p++}`);
    params.push(canSend);
  }

  if (filters.q) {
    clauses.push(`
      (
        CAST(uea.id AS TEXT) ILIKE $${p}
        OR CAST(uea.user_id AS TEXT) ILIKE $${p}
        OR CAST(uea.email_account_id AS TEXT) ILIKE $${p}
        OR COALESCE(u.name, '') ILIKE $${p}
        OR COALESCE(u.email, '') ILIKE $${p}
        OR COALESCE(ea.label, '') ILIKE $${p}
        OR COALESCE(ea.email_address, '') ILIKE $${p}
      )
    `);
    params.push(`%${String(filters.q).trim()}%`);
    p++;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return withClient(pgPool, async (client) => {
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM ${USER_EMAIL_ACCOUNTS_TABLE} uea
      LEFT JOIN ${USERS_TABLE} u ON u.id = uea.user_id
      LEFT JOIN ${EMAIL_ACCOUNTS_TABLE} ea ON ea.id = uea.email_account_id
      ${where}
    `;
    const countRes = await client.query(countSql, params);
    const total = countRes.rows[0]?.total || 0;

    const listSql = `
      ${buildBaseSelect()}
      ${where}
      ORDER BY uea.id ASC
      LIMIT $${p++}
      OFFSET $${p++}
    `;
    const listParams = [...params, pageSize, offset];
    const { rows } = await client.query(listSql, listParams);

    return {
      items: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });
}

export async function listByUserId(pgPool, userId) {
  const uid = toIntOrNull(userId);
  if (!uid) return [];

  return withClient(pgPool, async (client) => {
    const sql = `
      ${buildBaseSelect()}
      WHERE uea.user_id = $1
      ORDER BY uea.is_default DESC, uea.id ASC
    `;
    const { rows } = await client.query(sql, [uid]);
    return rows;
  });
}

export async function listByEmailAccountId(pgPool, emailAccountId) {
  const eid = toIntOrNull(emailAccountId);
  if (!eid) return [];

  return withClient(pgPool, async (client) => {
    const sql = `
      ${buildBaseSelect()}
      WHERE uea.email_account_id = $1
      ORDER BY uea.is_default DESC, uea.id ASC
    `;
    const { rows } = await client.query(sql, [eid]);
    return rows;
  });
}

export async function create(pgPool, input = {}) {
  const payload = normalizePayload(input);
  const errors = validateCreatePayload(payload);

  if (errors.length) {
    const err = new Error('Validation error');
    err.code = 'VALIDATION_ERROR';
    err.details = errors;
    throw err;
  }

  return withClient(pgPool, async (client) => {
    await client.query('BEGIN');
    try {
      const user = await ensureUserExists(client, payload.user_id);
      if (!user) {
        const err = new Error(`User not found for user_id=${payload.user_id}`);
        err.code = 'USER_NOT_FOUND';
        throw err;
      }

      const email = await ensureEmailAccountExists(client, payload.email_account_id);
      if (!email) {
        const err = new Error(`Email account not found for email_account_id=${payload.email_account_id}`);
        err.code = 'EMAIL_ACCOUNT_NOT_FOUND';
        throw err;
      }

      if (payload.is_default) {
        await clearDefaultFromOtherLinks(client, { user_id: payload.user_id });
      }

      const insertSql = `
        INSERT INTO ${USER_EMAIL_ACCOUNTS_TABLE}
          (user_id, email_account_id, is_default, can_read, can_send)
        VALUES
          ($1, $2, $3, $4, $5)
        RETURNING id
      `;
      const insertParams = [
        payload.user_id,
        payload.email_account_id,
        payload.is_default,
        payload.can_read,
        payload.can_send,
      ];

      const inserted = await client.query(insertSql, insertParams);
      const id = inserted.rows[0].id;

      await maybePromoteOneDefault(client, payload.user_id);

      await client.query('COMMIT');
      return getById(pgPool, id);
    } catch (error) {
      await client.query('ROLLBACK');

      if (error?.code === '23505') {
        const err = new Error('This user is already linked to this email account');
        err.code = 'DUPLICATE_LINK';
        throw err;
      }

      throw error;
    }
  });
}

export async function update(pgPool, id, patch = {}) {
  const rowId = toIntOrNull(id);
  if (!rowId) return null;

  const normalizedPatch = normalizePatch(patch);
  const keys = Object.keys(normalizedPatch);
  if (!keys.length) return getById(pgPool, rowId);

  return withClient(pgPool, async (client) => {
    await client.query('BEGIN');
    try {
      const currentSql = `
        SELECT *
        FROM ${USER_EMAIL_ACCOUNTS_TABLE}
        WHERE id = $1
        LIMIT 1
      `;
      const currentRes = await client.query(currentSql, [rowId]);
      const current = currentRes.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }

      const nextUserId =
        'user_id' in normalizedPatch ? normalizedPatch.user_id : current.user_id;
      const nextEmailAccountId =
        'email_account_id' in normalizedPatch
          ? normalizedPatch.email_account_id
          : current.email_account_id;
      const nextIsDefault =
        'is_default' in normalizedPatch
          ? normalizedPatch.is_default
          : current.is_default;

      if (!nextUserId) {
        const err = new Error('user_id cannot be null');
        err.code = 'VALIDATION_ERROR';
        err.details = ['user_id cannot be null'];
        throw err;
      }

      if (!nextEmailAccountId) {
        const err = new Error('email_account_id cannot be null');
        err.code = 'VALIDATION_ERROR';
        err.details = ['email_account_id cannot be null'];
        throw err;
      }

      const user = await ensureUserExists(client, nextUserId);
      if (!user) {
        const err = new Error(`User not found for user_id=${nextUserId}`);
        err.code = 'USER_NOT_FOUND';
        throw err;
      }

      const email = await ensureEmailAccountExists(client, nextEmailAccountId);
      if (!email) {
        const err = new Error(`Email account not found for email_account_id=${nextEmailAccountId}`);
        err.code = 'EMAIL_ACCOUNT_NOT_FOUND';
        throw err;
      }

      if (nextIsDefault) {
        await clearDefaultFromOtherLinks(client, { user_id: nextUserId, except_id: rowId });
      }

      const setParts = [];
      const params = [];
      let p = 1;

      for (const key of keys) {
        setParts.push(`${key} = $${p++}`);
        params.push(normalizedPatch[key]);
      }

      params.push(rowId);

      const updateSql = `
        UPDATE ${USER_EMAIL_ACCOUNTS_TABLE}
           SET ${setParts.join(', ')}
         WHERE id = $${p}
         RETURNING id
      `;
      await client.query(updateSql, params);

      await maybePromoteOneDefault(client, nextUserId);

      if (nextUserId !== current.user_id) {
        await maybePromoteOneDefault(client, current.user_id);
      }

      await client.query('COMMIT');
      return getById(pgPool, rowId);
    } catch (error) {
      await client.query('ROLLBACK');

      if (error?.code === '23505') {
        const err = new Error('Duplicate link or conflicting default email for this user');
        err.code = 'DUPLICATE_LINK';
        throw err;
      }

      throw error;
    }
  });
}

export async function remove(pgPool, id) {
  const rowId = toIntOrNull(id);
  if (!rowId) return false;

  return withClient(pgPool, async (client) => {
    await client.query('BEGIN');
    try {
      const currentRes = await client.query(
        `
          SELECT id, user_id, is_default
          FROM ${USER_EMAIL_ACCOUNTS_TABLE}
          WHERE id = $1
          LIMIT 1
        `,
        [rowId]
      );

      const current = currentRes.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(
        `
          DELETE FROM ${USER_EMAIL_ACCOUNTS_TABLE}
          WHERE id = $1
        `,
        [rowId]
      );

      await maybePromoteOneDefault(client, current.user_id);

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}