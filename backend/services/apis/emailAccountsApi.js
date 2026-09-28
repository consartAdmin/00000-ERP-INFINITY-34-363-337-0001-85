// ╔══════════════════════════════════════════════════════════════════════╗
// ║ emailAccountsApi.js — API tabela public."emailAccounts" (ESM)         ║
// ║ CONSART ERP                                                          ║
// ║ ✔ CRUD completo (create/update/get/list/deactivate)                   ║
// ║ ✔ update NÃO sobrescreve senha quando patch não envia                 ║
// ║ ✔ filtros is_active + paginação                                       ║
// ║ ✔ includeSecrets (somente quando solicitado)                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

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

function toInt(v, def) {
  if (v == null || String(v).trim() === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function normStr(v) {
  const s = (v == null) ? '' : String(v);
  return s.trim();
}

function nullableStr(v) {
  const s = normStr(v);
  return s ? s : null;
}

function normalizeAccountPayload(payload = {}) {
  return {
    label: normStr(payload.label),
    email_address: normStr(payload.email_address ?? payload.email ?? payload.address),
    provider: normStr(payload.provider || 'custom') || 'custom',

    smtp_host: normStr(payload.smtp_host ?? payload.smtpHost),
    smtp_port: toInt(payload.smtp_port ?? payload.smtpPort, 587),
    smtp_secure: toBool(payload.smtp_secure ?? payload.smtpSecure, false),
    smtp_user: normStr(payload.smtp_user ?? payload.smtpUser),
    smtp_pass: normStr(payload.smtp_pass ?? payload.smtpPass),

    imap_host: nullableStr(payload.imap_host ?? payload.imapHost),
    imap_port: (payload.imap_port != null || payload.imapPort != null) ? toInt(payload.imap_port ?? payload.imapPort, null) : null,
    imap_secure: toBool(payload.imap_secure ?? payload.imapSecure, true),
    imap_user: nullableStr(payload.imap_user ?? payload.imapUser),
    imap_pass: nullableStr(payload.imap_pass ?? payload.imapPass),

    is_active: toBool(payload.is_active ?? payload.isActive, true),
  };
}

function validateAccount(d) {
  const errs = [];
  if (!d.label) errs.push({ field: 'label', message: 'label é obrigatório.' });
  if (!d.email_address) errs.push({ field: 'email_address', message: 'email_address é obrigatório.' });

  if (!d.smtp_host) errs.push({ field: 'smtp_host', message: 'smtp_host é obrigatório.' });
  if (!Number.isFinite(d.smtp_port) || d.smtp_port <= 0) errs.push({ field: 'smtp_port', message: 'smtp_port inválido.' });
  if (!d.smtp_user) errs.push({ field: 'smtp_user', message: 'smtp_user é obrigatório.' });
  if (!d.smtp_pass) errs.push({ field: 'smtp_pass', message: 'smtp_pass é obrigatório.' });

  return errs;
}

// ✅ patch normalizer: só considera senha se veio explicitamente
function normalizePatchPayload(payload = {}) {
  const base = normalizeAccountPayload(payload);

  const hasSmtpPass = Object.prototype.hasOwnProperty.call(payload, 'smtp_pass')
    || Object.prototype.hasOwnProperty.call(payload, 'smtpPass');

  const hasImapPass = Object.prototype.hasOwnProperty.call(payload, 'imap_pass')
    || Object.prototype.hasOwnProperty.call(payload, 'imapPass');

  return {
    ...base,
    __hasSmtpPass: hasSmtpPass,
    __hasImapPass: hasImapPass,
  };
}

const emailAccountsApi = {
  normalizeAccountPayload,

  async createAccount(pgPool, payload) {
    const d = normalizeAccountPayload(payload);
    const fieldErrors = validateAccount(d);
    if (fieldErrors.length) {
      const e = new Error('Validation error');
      e.fieldErrors = fieldErrors;
      e.code = 'EMAIL_ACCOUNTS_VALIDATION';
      throw e;
    }

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `
        INSERT INTO ${EMAIL_ACCOUNTS_TABLE}
          (label, email_address, provider,
           smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass,
           imap_host, imap_port, imap_secure, imap_user, imap_pass,
           is_active, created_at, updated_at)
        VALUES
          ($1,$2,$3,
           $4,$5,$6,$7,$8,
           $9,$10,$11,$12,$13,
           $14,NOW(),NOW())
        RETURNING *;
        `,
        [
          d.label, d.email_address, d.provider,
          d.smtp_host, d.smtp_port, d.smtp_secure, d.smtp_user, d.smtp_pass,
          d.imap_host, d.imap_port, d.imap_secure, d.imap_user, d.imap_pass,
          d.is_active,
        ]
      );
      return rows[0] || null;
    });
  },

  async updateAccount(pgPool, id, patch) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;

    const d = normalizePatchPayload(patch);

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `
        UPDATE ${EMAIL_ACCOUNTS_TABLE}
           SET label         = COALESCE(NULLIF($2,''), label),
               email_address = COALESCE(NULLIF($3,''), email_address),
               provider      = COALESCE(NULLIF($4,''), provider),

               smtp_host     = COALESCE(NULLIF($5,''), smtp_host),
               smtp_port     = COALESCE($6, smtp_port),
               smtp_secure   = COALESCE($7, smtp_secure),
               smtp_user     = COALESCE(NULLIF($8,''), smtp_user),
               smtp_pass     = CASE WHEN $9::boolean IS TRUE THEN COALESCE(NULLIF($10,''), smtp_pass) ELSE smtp_pass END,

               imap_host     = COALESCE($11, imap_host),
               imap_port     = COALESCE($12, imap_port),
               imap_secure   = COALESCE($13, imap_secure),
               imap_user     = COALESCE($14, imap_user),
               imap_pass     = CASE WHEN $15::boolean IS TRUE THEN COALESCE($16, imap_pass) ELSE imap_pass END,

               is_active     = COALESCE($17, is_active),
               updated_at    = NOW()
         WHERE id = $1
        RETURNING *;
        `,
        [
          numericId,

          d.label || '',
          d.email_address || '',
          d.provider || '',

          d.smtp_host || '',
          Number.isFinite(d.smtp_port) ? d.smtp_port : null,
          typeof d.smtp_secure === 'boolean' ? d.smtp_secure : null,
          d.smtp_user || '',
          d.__hasSmtpPass,
          d.smtp_pass || '',

          d.imap_host,
          Number.isFinite(d.imap_port) ? d.imap_port : null,
          typeof d.imap_secure === 'boolean' ? d.imap_secure : null,
          d.imap_user,
          d.__hasImapPass,
          d.imap_pass,

          typeof d.is_active === 'boolean' ? d.is_active : null,
        ]
      );
      return rows[0] || null;
    });
  },

  async listAccounts(pgPool, { onlyActive = true, search = '', limit = 100, offset = 0 } = {}) {
    const lim = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.min(Number(limit), 200)
      : 100;

    const off = Number.isFinite(Number(offset)) && Number(offset) >= 0
      ? Number(offset)
      : 0;

    const wantOnlyActive = toBool(onlyActive, true);
    const q = normStr(search);

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `
      SELECT
        id, label, email_address, provider,
        smtp_host, smtp_port, smtp_secure, smtp_user,
        imap_host, imap_port, imap_secure, imap_user,
        is_active, created_at, updated_at
      FROM ${EMAIL_ACCOUNTS_TABLE}
      WHERE
        (($1::boolean IS FALSE) OR (is_active IS TRUE))
        AND (
          $2::text = ''
          OR label ILIKE ('%' || $2 || '%')
          OR email_address ILIKE ('%' || $2 || '%')
          OR provider ILIKE ('%' || $2 || '%')
          OR smtp_host ILIKE ('%' || $2 || '%')
          OR COALESCE(imap_host, '') ILIKE ('%' || $2 || '%')
        )
      ORDER BY is_active DESC, label ASC, id ASC
      LIMIT $3 OFFSET $4;
      `,
        [wantOnlyActive, q, lim, off]
      );
      return rows;
    });
  },

  async getAccountById(pgPool, id, { includeSecrets = false } = {}) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        includeSecrets
          ? `
            SELECT *
            FROM ${EMAIL_ACCOUNTS_TABLE}
            WHERE id = $1;
            `
          : `
            SELECT
              id, label, email_address, provider,
              smtp_host, smtp_port, smtp_secure, smtp_user,
              imap_host, imap_port, imap_secure, imap_user,
              is_active, created_at, updated_at
            FROM ${EMAIL_ACCOUNTS_TABLE}
            WHERE id = $1;
            `,
        [numericId]
      );
      return rows[0] || null;
    });
  },

  async deactivateAccount(pgPool, id) {
    return emailAccountsApi.updateAccount(pgPool, id, { is_active: false });
  },
};

export default emailAccountsApi;
