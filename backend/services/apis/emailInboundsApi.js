// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ emailInboundsApi.js — API emailInbounds (ESM, IDÊMPOTENTE)               ║
// ║ CONSART ERP — IMAP Inbounds                                             ║
// ║ ✅ Logs detalhados para debug                                            ║
// ║ ✅ Normalização segura de account_id / limit / offset                    ║
// ║ ✅ Deduplicação REAL: account_id + imap_uid                              ║
// ║ ✅ Suporte a attachments_meta JSONB                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const EMAIL_INBOUNDS_TABLE = 'public."emailInbounds"';

const DEBUG_EMAIL_INBOUNDS =
  process.env.DEBUG_EMAIL_INBOUNDS === '1' ||
  process.env.EMAIL_DEBUG === '1' ||
  process.env.NODE_ENV !== 'production';

function log(step, payload = {}) {
  if (!DEBUG_EMAIL_INBOUNDS) return;
  console.log(`[emailInboundsApi][${step}]`, {
    ts: new Date().toISOString(),
    ...payload,
  });
}

function warn(step, payload = {}) {
  console.warn(`[emailInboundsApi][${step}]`, {
    ts: new Date().toISOString(),
    ...payload,
  });
}

function errorLog(step, err, payload = {}) {
  console.error(`[emailInboundsApi][${step}]`, {
    ts: new Date().toISOString(),
    message: err?.message,
    code: err?.code,
    detail: err?.detail,
    table: err?.table,
    column: err?.column,
    stack: err?.stack,
    ...payload,
  });
}

async function withClient(pgPool, fn, label = 'query') {
  const startedAt = Date.now();
  const client = await pgPool.connect();

  log('DB_CLIENT_ACQUIRED', { label });

  try {
    const result = await fn(client);

    log('DB_CLIENT_SUCCESS', {
      label,
      ms: Date.now() - startedAt,
    });

    return result;
  } catch (err) {
    errorLog('DB_CLIENT_ERROR', err, {
      label,
      ms: Date.now() - startedAt,
    });

    throw err;
  } finally {
    client.release();

    log('DB_CLIENT_RELEASED', {
      label,
      ms: Date.now() - startedAt,
    });
  }
}

function toPositiveIntOrNull(value) {
  if (value == null || String(value).trim() === '') return null;

  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function toSafeLimit(value, fallback = 50, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), max);
}

function toSafeOffset(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function safeDate(value) {
  if (!value) return new Date();

  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function safeText(value, fallback = null) {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function safeJsonArrayParse(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeAttachments(email = {}) {
  const rawAtts = Array.isArray(email.attachments) ? email.attachments : [];

  const metaFromEmail =
    Array.isArray(email.attachments_meta) ? email.attachments_meta :
    Array.isArray(email.attachmentsMeta) ? email.attachmentsMeta :
    null;

  const metaFromJsonString =
    typeof email.attachments_meta === 'string' && email.attachments_meta.trim()
      ? safeJsonArrayParse(email.attachments_meta)
      : typeof email.attachmentsMeta === 'string' && email.attachmentsMeta.trim()
        ? safeJsonArrayParse(email.attachmentsMeta)
        : null;

  const attachments =
    metaFromEmail ||
    metaFromJsonString ||
    rawAtts.map((a) => ({
      filename: a?.filename || a?.name || 'attachment',
      contentType: a?.contentType || a?.mimeType || a?.mime || '',
      size: Number(a?.size || a?.length || a?.content?.length || 0) || 0,
      url: a?.url || a?.downloadUrl || a?.signedUrl || '',
    }));

  return Array.isArray(attachments) ? attachments : [];
}

function normalizeAddress(value, fallback) {
  if (!value) return fallback;

  if (typeof value === 'string') {
    return value.trim() || fallback;
  }

  if (Array.isArray(value)) {
    return value.map((v) => normalizeAddress(v, '')).filter(Boolean).join(', ') || fallback;
  }

  if (value?.text) return String(value.text).trim() || fallback;
  if (value?.value && Array.isArray(value.value)) {
    return value.value
      .map((v) => v?.address || v?.name || '')
      .filter(Boolean)
      .join(', ') || fallback;
  }

  return String(value).trim() || fallback;
}

function normalizeEmail(email = {}, account_id) {
  const accountId = toPositiveIntOrNull(account_id);

  if (!accountId) {
    throw new Error('[emailInboundsApi] account_id inválido');
  }

  const attachments_meta = normalizeAttachments(email);

  const normalized = {
    account_id: accountId,
    imap_uid: email.uid ?? email.imap_uid ?? null,

    from_address: normalizeAddress(email.from || email.from_address, '(remetente indefinido)'),
    to_address: normalizeAddress(email.to || email.to_address, '(destinatário indefinido)'),
    subject: safeText(email.subject, null),

    body_text: email.text ?? email.body_text ?? null,
    body_html: email.html ?? email.body_html ?? null,

    received_at: safeDate(email.date || email.received_at),

    attachments_meta,
  };

  log('NORMALIZE_EMAIL', {
    account_id: normalized.account_id,
    imap_uid: normalized.imap_uid,
    from_address: normalized.from_address,
    to_address: normalized.to_address,
    subject: normalized.subject,
    has_body_text: !!normalized.body_text,
    body_text_length: String(normalized.body_text || '').length,
    has_body_html: !!normalized.body_html,
    body_html_length: String(normalized.body_html || '').length,
    attachments_count: normalized.attachments_meta.length,
    received_at: normalized.received_at,
  });

  return normalized;
}

function normalizeRow(row) {
  if (!row) return null;

  if (row.attachments_meta == null) {
    row.attachments_meta = [];
  }

  if (typeof row.attachments_meta === 'string') {
    row.attachments_meta = safeJsonArrayParse(row.attachments_meta) || [];
  }

  if (!Array.isArray(row.attachments_meta)) {
    row.attachments_meta = [];
  }

  return row;
}

export async function saveInboundEmail(pgPool, account_id, email) {
  const data = normalizeEmail(email, account_id);

  log('SAVE_START', {
    account_id: data.account_id,
    imap_uid: data.imap_uid,
    subject: data.subject,
  });

  return withClient(pgPool, async (client) => {
    if (data.imap_uid != null) {
      const { rows } = await client.query(
        `
        SELECT id
        FROM ${EMAIL_INBOUNDS_TABLE}
        WHERE account_id = $1
          AND imap_uid = $2
        LIMIT 1;
        `,
        [data.account_id, data.imap_uid]
      );

      if (rows.length) {
        log('SAVE_DUPLICATE_SKIPPED', {
          existing_id: rows[0].id,
          account_id: data.account_id,
          imap_uid: data.imap_uid,
        });

        return rows[0];
      }
    }

    const { rows } = await client.query(
      `
      INSERT INTO ${EMAIL_INBOUNDS_TABLE}
        (
          account_id,
          imap_uid,
          from_address,
          to_address,
          subject,
          body_text,
          body_html,
          received_at,
          attachments_meta
        )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      RETURNING
        id,
        account_id,
        imap_uid,
        from_address,
        to_address,
        subject,
        body_text,
        body_html,
        received_at,
        created_at,
        is_read,
        attachments_meta;
      `,
      [
        data.account_id,
        data.imap_uid,
        data.from_address,
        data.to_address,
        data.subject,
        data.body_text,
        data.body_html,
        data.received_at,
        JSON.stringify(data.attachments_meta || []),
      ]
    );

    const row = normalizeRow(rows[0]);

    log('SAVE_INSERTED', {
      id: row?.id,
      account_id: row?.account_id,
      imap_uid: row?.imap_uid,
      subject: row?.subject,
      attachments_count: row?.attachments_meta?.length || 0,
    });

    return row;
  }, 'saveInboundEmail');
}

export async function listInbounds(
  pgPool,
  { account_id = null, limit = 50, offset = 0 } = {}
) {
  const accountId = toPositiveIntOrNull(account_id);
  const safeLimit = toSafeLimit(limit, 50, 200);
  const safeOffset = toSafeOffset(offset, 0);

  log('LIST_START', {
    account_id_raw: account_id,
    account_id: accountId,
    limit_raw: limit,
    limit: safeLimit,
    offset_raw: offset,
    offset: safeOffset,
  });

  return withClient(pgPool, async (client) => {
    const { rows } = await client.query(
      `
      SELECT
        id,
        account_id,
        imap_uid,
        from_address,
        to_address,
        subject,
        body_text,
        body_html,
        received_at,
        created_at,
        is_read,
        attachments_meta
      FROM ${EMAIL_INBOUNDS_TABLE}
      WHERE ($1::bigint IS NULL OR account_id = $1)
      ORDER BY received_at DESC NULLS LAST, id DESC
      LIMIT $2 OFFSET $3;
      `,
      [accountId, safeLimit, safeOffset]
    );

    const normalizedRows = rows.map(normalizeRow);

    log('LIST_RESULT', {
      count: normalizedRows.length,
      sample: normalizedRows.slice(0, 3).map((r) => ({
        id: r.id,
        account_id: r.account_id,
        subject: r.subject,
        from_address: r.from_address,
        is_read: r.is_read,
        received_at: r.received_at,
        attachments_count: r.attachments_meta?.length || 0,
      })),
    });

    return normalizedRows;
  }, 'listInbounds');
}

export async function getInboundById(pgPool, id) {
  const numericId = toPositiveIntOrNull(id);

  log('GET_START', {
    id_raw: id,
    id: numericId,
  });

  if (!numericId) {
    throw new Error('ID inválido para emailInbounds');
  }

  return withClient(pgPool, async (client) => {
    const { rows } = await client.query(
      `
      SELECT
        id,
        account_id,
        imap_uid,
        from_address,
        to_address,
        subject,
        body_text,
        body_html,
        received_at,
        created_at,
        is_read,
        attachments_meta
      FROM ${EMAIL_INBOUNDS_TABLE}
      WHERE id = $1
      LIMIT 1;
      `,
      [numericId]
    );

    const row = normalizeRow(rows[0] || null);

    if (!row) {
      warn('GET_NOT_FOUND', { id: numericId });
      return null;
    }

    log('GET_RESULT', {
      id: row.id,
      account_id: row.account_id,
      subject: row.subject,
      has_body_text: !!row.body_text,
      body_text_length: String(row.body_text || '').length,
      has_body_html: !!row.body_html,
      body_html_length: String(row.body_html || '').length,
      attachments_count: row.attachments_meta?.length || 0,
      is_read: row.is_read,
    });

    return row;
  }, 'getInboundById');
}

export async function countUnreadInbounds(pgPool, { account_id = null } = {}) {
  const accountId = toPositiveIntOrNull(account_id);

  log('COUNT_UNREAD_START', {
    account_id_raw: account_id,
    account_id: accountId,
  });

  return withClient(pgPool, async (client) => {
    const { rows } = await client.query(
      `
      SELECT COUNT(*)::int AS unread
      FROM ${EMAIL_INBOUNDS_TABLE}
      WHERE is_read = false
        AND ($1::bigint IS NULL OR account_id = $1);
      `,
      [accountId]
    );

    const unread = rows[0]?.unread ?? 0;

    log('COUNT_UNREAD_RESULT', {
      unread,
      account_id: accountId,
    });

    return unread;
  }, 'countUnreadInbounds');
}

export async function markInboundAsRead(pgPool, id) {
  const numericId = toPositiveIntOrNull(id);

  log('MARK_READ_START', {
    id_raw: id,
    id: numericId,
  });

  if (!numericId) {
    throw new Error('ID inválido para marcar email como lido');
  }

  return withClient(pgPool, async (client) => {
    const { rows } = await client.query(
      `
      UPDATE ${EMAIL_INBOUNDS_TABLE}
      SET is_read = true
      WHERE id = $1
      RETURNING id, is_read;
      `,
      [numericId]
    );

    const row = rows[0] || null;

    log('MARK_READ_RESULT', {
      id: numericId,
      found: !!row,
      is_read: row?.is_read,
    });

    return row;
  }, 'markInboundAsRead');
}

export async function clearInbounds(pgPool) {
  warn('CLEAR_START', {
    table: EMAIL_INBOUNDS_TABLE,
  });

  return withClient(pgPool, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM ${EMAIL_INBOUNDS_TABLE};`
    );

    warn('CLEAR_DONE', {
      deleted: rowCount,
    });

    return rowCount;
  }, 'clearInbounds');
}

const emailInboundsApi = {
  EMAIL_INBOUNDS_TABLE,

  saveInboundEmail,
  listInbounds,
  getInboundById,
  countUnreadInbounds,
  markInboundAsRead,
  clearInbounds,
};

export default emailInboundsApi;