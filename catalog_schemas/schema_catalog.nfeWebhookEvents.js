// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.nfeWebhookEvents.js — Webhook de NF-e (CONSART ERP)       ║
// ║ Estrutura declarativa da tabela `nfeWebhookEvents`                        ║
// ║ Permite padronização do catálogo de tabelas e metadados fiscais.         ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const NFE_WEBHOOK_EVENTS_SCHEMA = Object.freeze({
  table: 'nfeWebhookEvents',
  schema: 'public',
  alias: 'nfev',

  columns: {
    // 🧱 Identificador primário
    id: {
      type: 'BIGSERIAL',
      pk: true,
      comment: 'Identificador único do evento do webhook da NF-e'
    },

    // 🔗 Fonte do evento (PlugNotas, TecnoSpeed, etc.)
    provider: {
      type: 'VARCHAR(50)',
      notNull: true,
      default: `'PLUGNOTAS'`,
      comment: 'Origem do evento fiscal (ex: PLUGNOTAS, TECNOSPEED)'
    },

    // 🔗 ID interno do ERP (pedido, orçamento, ordem)
    integration_id: {
      type: 'VARCHAR(80)',
      comment: 'ID da integração do ERP (ex: ORD-113)'
    },

    // 🔢 Chave de acesso da NF-e
    chave: {
      type: 'VARCHAR(60)',
      comment: 'Chave de acesso da NF-e associada ao evento'
    },

    // 📌 Status retornado pelo provedor / SEFAZ
    status: {
      type: 'VARCHAR(40)',
      comment: 'Status da operação enviado pelo webhook (AUTHORIZED, REJECTED, etc.)'
    },

    // 📘 Código SEFAZ
    sefaz_code: {
      type: 'VARCHAR(20)',
      comment: 'Código de retorno SEFAZ quando houver rejeição ou aviso'
    },

    // 📙 Mensagem SEFAZ
    sefaz_message: {
      type: 'TEXT',
      comment: 'Mensagem textual da SEFAZ (ex: rejeição, aviso, autorização)'
    },

    // 📦 Payload bruto do webhook
    raw_payload: {
      type: 'JSONB',
      comment: 'Payload completo recebido no webhook'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data de criação do registro'
    },

    updated_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data da última atualização do registro'
    }
  }
});
