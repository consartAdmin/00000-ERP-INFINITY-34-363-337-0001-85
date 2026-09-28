// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.emailOutbounds.js — Schema E-mails Enviados (ESM)    ║
// ║ CONSART ERP — Hostinger / SMTP                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const EMAIL_OUTBOUNDS_TABLE = 'public."emailOutbounds"';

export const EMAIL_OUTBOUNDS_SCHEMA = {
  table: EMAIL_OUTBOUNDS_TABLE,
  comment: 'E-mails enviados pelo CONSART ERP via Hostinger/SMTP',
  columns: [
    { name: 'id',              type: 'BIGSERIAL',  pk: true,  notNull: true, comment: 'PK do e-mail enviado' },

    // Endereços
    { name: 'from_address',    type: 'TEXT',       notNull: true, comment: 'Remetente' },
    { name: 'to_address',      type: 'TEXT',       notNull: true, comment: 'Destinatário principal' },
    { name: 'cc_address',      type: 'TEXT[]',                  comment: 'Destinatários em cópia (CC)' },
    { name: 'bcc_address',     type: 'TEXT[]',                  comment: 'Destinatários ocultos (BCC)' },

    // Conteúdo
    { name: 'subject',         type: 'TEXT',       comment: 'Assunto' },
    { name: 'body_text',       type: 'TEXT',       comment: 'Corpo em texto simples' },
    { name: 'body_html',       type: 'TEXT',       comment: 'Corpo em HTML' },

    // Datas
    { name: 'sent_at',         type: 'TIMESTAMPTZ', notNull: true, default: 'now()', comment: 'Data/hora envio' },
    { name: 'created_at',      type: 'TIMESTAMPTZ', notNull: true, default: 'now()', comment: 'Data do registro' },

    // Metadata do provedor
    { name: 'message_id',      type: 'TEXT',       comment: 'ID da mensagem no provedor' },
    { name: 'provider',        type: 'TEXT',       comment: 'Provedor (hostinger, smtp, etc.)' },
    { name: 'provider_status', type: 'TEXT',       comment: 'Status do envio (QUEUED, SENT, ERROR...)' },
    { name: 'provider_error',  type: 'TEXT',       comment: 'Mensagem de erro retornada pelo provedor' },
  ],
};
