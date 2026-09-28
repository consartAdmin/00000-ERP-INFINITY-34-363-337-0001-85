// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.emailInbounds.js — Schema da Tabela EmailInbounds (ESM)   ║
// ║ CONSART ERP — Registro de E-mails Recebidos via IMAP Hostinger           ║
// ║ Cada e-mail processado é armazenado nesta tabela.                        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const EMAIL_INBOUNDS_TABLE = 'public."emailInbounds"';

export const EMAIL_INBOUNDS_SCHEMA = {
  table: EMAIL_INBOUNDS_TABLE,
  comment: 'E-mails recebidos e processados via Hostinger IMAP',

  columns: [
    // Identificador único
    { name: 'id',            type: 'BIGSERIAL', pk: true, notNull: true, comment: 'ID interno' },

    // Endereços
    { name: 'from_address',  type: 'TEXT',      notNull: true, comment: 'Remetente do e-mail' },
    { name: 'to_address',    type: 'TEXT',      notNull: true, comment: 'Destinatário do e-mail' },

    // Conteúdos
    { name: 'subject',       type: 'TEXT',      notNull: false, comment: 'Assunto do e-mail' },
    { name: 'body_text',     type: 'TEXT',      notNull: false, comment: 'Corpo do e-mail (texto)' },
    { name: 'body_html',     type: 'TEXT',      notNull: false, comment: 'Corpo do e-mail (HTML)' },

    // Datas
    { name: 'received_at',   type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()', comment: 'Data/hora de recebimento' },
    { name: 'created_at',    type: 'TIMESTAMPTZ', notNull: true, default: 'NOW()', comment: 'Data registro no sistema' }
  ]
};
