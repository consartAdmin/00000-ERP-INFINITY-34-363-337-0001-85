// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.trackingSessions.js — Sessões de Tracking                 ║
// ║ CONSART ERP                                                               ║
// ║ Representa sessões de usuários (ERP / Web / App)                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const TRACKING_SESSIONS_SCHEMA = Object.freeze({
  table: 'trackingSessions',
  alias: 'ts',

  columns: {
    // 🧱 Identificação
    id: {
      type: 'BIGSERIAL',
      pk: true,
      comment: 'Identificador interno da sessão'
    },

    session_id: {
      type: 'TEXT',
      notNull: true,
      unique: true,
      comment: 'Identificador único da sessão (UUID/string)'
    },

    // 👤 Relacionamentos
    user_id: {
      type: 'TEXT',
      comment: 'Usuário logado no ERP (se aplicável)'
    },

    customer_id: {
      type: 'TEXT',
      comment: 'Cliente associado à sessão (B2B/B2C)'
    },

    // 🌐 Contexto da sessão
    ip: {
      type: 'INET',
      comment: 'Endereço IP do usuário'
    },

    user_agent: {
      type: 'TEXT',
      comment: 'User-Agent do navegador ou app'
    },

    referrer: {
      type: 'TEXT',
      comment: 'URL de origem (referrer)'
    },

    first_path: {
      type: 'TEXT',
      comment: 'Primeira página acessada na sessão'
    },

    last_path: {
      type: 'TEXT',
      comment: 'Última página acessada'
    },

    // 🌍 Geolocalização
    country: {
      type: 'TEXT',
      comment: 'País detectado'
    },

    region: {
      type: 'TEXT',
      comment: 'Estado/região'
    },

    city: {
      type: 'TEXT',
      comment: 'Cidade'
    },

    // 🤖 Controle
    is_bot: {
      type: 'BOOLEAN',
      notNull: true,
      default: false,
      comment: 'Indica se a sessão foi identificada como bot'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de início da sessão'
    },

    last_seen_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: 'NOW()',
      comment: 'Última atividade registrada na sessão'
    }
  }
});
