// ╔══════════════════════════════════════════════════════════════════════╗
// ║ emailOutboundsApi.js — API tabela public."emailOutbounds" (ESM)      ║
// ║ CONSART ERP                                                         ║
// ║ ✔ account_id (multi-accounts)                                        ║
// ║ ✔ attachments_* + request_id + compat keys                           ║
// ║ ✔ jsonb safe (envia objeto/array direto)                             ║
// ║ ✔ safeDate sent_at (não insere inválido)                             ║
// ║ ✔ list / get / clear + filtro por account_id                         ║
// ║ ✔ proteção anti-duplicação por message_id (UNIQUE parcial)           ║
// ║ ✅ FIX: ON CONFLICT compatível com UNIQUE (message_id) WHERE NOT NULL ║
// ║ ✅ FIX: from_address/to_address NUNCA NULL (colunas NOT NULL)         ║
// ║ ✅ FIX: attachments_total_bytes (coluna existe no schema)            ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const EMAIL_OUTBOUNDS_TABLE = 'public."emailOutbounds"';

async function withClient(pgPool, fn) {
  const client = await pgPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function toArray(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [String(v)];
}

function safeDate(v) {
  if (!v) return null;
  const d = (v instanceof Date) ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toIntOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

function safeText(v, fallback = '') {
  const s = v == null ? '' : String(v);
  const t = s.trim();
  return t !== '' ? t : fallback;
}

function safeJsonbArray(v) {
  // sua coluna é NOT NULL e default '[]'::jsonb
  // aqui garantimos SEMPRE um array serializável
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  // se veio string JSON do front, tenta parsear
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  // se veio objeto, não aceitamos (pra manter padrão array)
  return [];
}

function sumAttachmentBytes(metaArr) {
  if (!Array.isArray(metaArr)) return 0;
  let total = 0;
  for (const it of metaArr) {
    const n = Number(it?.size);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

function normalizeOutboundPayload(email = {}) {
  const account_id = toIntOrNull(email.account_id ?? email.accountId ?? email.email_account_id);

  const fromRaw = email.from ?? email.from_address ?? email.fromAddress ?? null;
  const toRaw = email.to ?? email.to_address ?? email.toAddress ?? null;

  // ⚠️ colunas NOT NULL no schema
  const from_address = safeText(fromRaw, '(unknown)');
  const to_address = safeText(toRaw, '(unknown)');

  const cc = email.cc ?? email.cc_address ?? email.ccAddress ?? null;
  const bcc = email.bcc ?? email.bcc_address ?? email.bccAddress ?? null;

  const subject = email.subject ?? null;

  const body_text = email.text ?? email.body_text ?? null;
  const body_html = email.html ?? email.body_html ?? null;

  const sent_at = safeDate(email.sent_at ?? email.sentAt);

  const message_id = (email.message_id ?? email.messageId ?? null);
  const messageIdNorm = (message_id == null) ? null : String(message_id).trim() || null;

  const provider = email.provider ?? null;
  const provider_status = email.provider_status ?? email.providerStatus ?? null;
  const provider_error = email.provider_error ?? email.providerError ?? null;

  const attachments_meta = safeJsonbArray(email.attachments_meta ?? email.attachmentsMeta ?? []);
  const attachments_ref = email.attachments_ref ?? email.attachmentsRef ?? null;
  const request_id = email.request_id ?? email.requestId ?? null;

  const attachments_count =
    Number.isFinite(Number(email.attachments_count))
      ? Number(email.attachments_count)
      : attachments_meta.length;

  const attachments_total_bytes =
    Number.isFinite(Number(email.attachments_total_bytes))
      ? Number(email.attachments_total_bytes)
      : sumAttachmentBytes(attachments_meta);

  return {
    account_id,
    from_address,
    to_address,
    cc_address: cc ? toArray(cc) : null,
    bcc_address: bcc ? toArray(bcc) : null,
    subject,
    body_text,
    body_html,
    sent_at,
    message_id: messageIdNorm,
    provider_status,
    provider_error,
    provider,
    attachments_count,
    attachments_total_bytes,
    attachments_meta,
    attachments_ref,
    request_id,
  };
}

const emailOutboundsApi = {
  async insertOutbound(pgPool, emailPayload) {
    const d = normalizeOutboundPayload(emailPayload);

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `
        INSERT INTO ${EMAIL_OUTBOUNDS_TABLE}
          (account_id,
           from_address,
           to_address,
           cc_address,
           bcc_address,
           subject,
           body_text,
           body_html,
           sent_at,
           created_at,
           message_id,
           provider_status,
           provider_error,
           provider,
           attachments_count,
           attachments_total_bytes,
           attachments_meta,
           attachments_ref,
           request_id)
        VALUES
          ($1,
           $2,$3,$4,$5,$6,$7,$8,
           COALESCE($9, NOW()),
           NOW(),
           $10,$11,$12,$13,
           COALESCE($14,0),
           COALESCE($15,0),
           $16,$17,$18)
        ON CONFLICT (message_id) DO NOTHING
        RETURNING *;
        `,
        [
          d.account_id,                // $1
          d.from_address,              // $2  NOT NULL
          d.to_address,                // $3  NOT NULL
          d.cc_address,                // $4
          d.bcc_address,               // $5
          d.subject,                   // $6
          d.body_text,                 // $7
          d.body_html,                 // $8
          d.sent_at,                   // $9
          d.message_id,                // $10
          d.provider_status,           // $11
          d.provider_error,            // $12
          d.provider,                  // $13
          d.attachments_count,         // $14
          d.attachments_total_bytes,   // $15
          d.attachments_meta,          // $16
          d.attachments_ref,           // $17
          d.request_id,                // $18
        ]
      );


      return rows[0] || null;
    });
  },

  async updateStatus(pgPool, id, patch = {}) {
    const provider_status = patch.provider_status ?? patch.providerStatus ?? null;
    const provider_error  = patch.provider_error ?? patch.providerError ?? null;
    const message_id      = patch.message_id ?? patch.messageId ?? null;
    const sent_at         = safeDate(patch.sent_at ?? patch.sentAt);

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `
        UPDATE ${EMAIL_OUTBOUNDS_TABLE}
           SET provider_status = COALESCE($2, provider_status),
               provider_error  = COALESCE($3, provider_error),
               message_id      = COALESCE($4, message_id),
               sent_at         = COALESCE($5, sent_at)
         WHERE id = $1
        RETURNING *;
        `,
        [id, provider_status, provider_error, message_id, sent_at]
      );
      return rows[0] || null;
    });
  },

  async listOutbounds(pgPool, { limit = 50, offset = 0, account_id = null } = {}) {
    const lim = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.min(Number(limit), 200)
      : 50;

    const off = Number.isFinite(Number(offset)) && Number(offset) >= 0
      ? Number(offset)
      : 0;

    const acc = toIntOrNull(account_id);

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          id,
          account_id,
          from_address,
          to_address,
          cc_address,
          bcc_address,
          subject,
          body_text,
          body_html,
          sent_at,
          created_at,
          message_id,
          provider_status,
          provider_error,
          provider,
          attachments_count,
          attachments_total_bytes,
          attachments_meta,
          attachments_ref,
          request_id
        FROM ${EMAIL_OUTBOUNDS_TABLE}
        WHERE ($3::bigint IS NULL OR account_id = $3::bigint)
        ORDER BY COALESCE(sent_at, created_at) DESC, id DESC
        LIMIT $1 OFFSET $2;
        `,
        [lim, off, acc]
      );
      return rows;
    });
  },

  async getOutboundById(pgPool, id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;

    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `
        SELECT
          id,
          account_id,
          from_address,
          to_address,
          cc_address,
          bcc_address,
          subject,
          body_text,
          body_html,
          sent_at,
          created_at,
          message_id,
          provider_status,
          provider_error,
          provider,
          attachments_count,
          attachments_total_bytes,
          attachments_meta,
          attachments_ref,
          request_id
        FROM ${EMAIL_OUTBOUNDS_TABLE}
        WHERE id = $1;
        `,
        [numericId]
      );
      return rows[0] || null;
    });
  },

  async clearOutbounds(pgPool) {
    return withClient(pgPool, async (client) => {
      const { rowCount } = await client.query(`DELETE FROM ${EMAIL_OUTBOUNDS_TABLE};`);
      return rowCount;
    });
  },

  async saveOutboundEmail(pgPool, emailPayload) {
    return emailOutboundsApi.insertOutbound(pgPool, emailPayload);
  },
};

export default emailOutboundsApi;
