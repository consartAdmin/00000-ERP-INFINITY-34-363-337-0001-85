// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.trackingEvents.js — Eventos de Tracking                  ║
// ║ CONSART ERP                                                               ║
// ║ Modelo GA4-like com event_params em JSONB                                 ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const TRACKING_EVENTS_SCHEMA = Object.freeze({
  table: 'trackingEvents',
  alias: 'te',

  columns: {
    // 🧱 Identificação
    id: {
      type: 'BIGSERIAL',
      pk: true,
      comment: 'Identificador interno do evento'
    },

    // 🔗 Relacionamento com sessão
    session_id: {
      type: 'TEXT',
      notNull: true,
      fk: {
        table: 'trackingSessions',
        column: 'session_id',
        onDelete: 'CASCADE'
      },
      comment: 'Sessão associada ao evento'
    },

    // 🔔 Evento
    event_name: {
      type: 'TEXT',
      notNull: true,
      comment: 'Nome do evento (ex: page_view, add_to_cart, purchase)'
    },

    // 🧠 Parâmetros dinâmicos (GA4 style)
    event_params: {
      type: 'JSONB',
      comment: 'Parâmetros do evento (page_path, value, items, etc.)'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMPTZ',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora do evento'
    }
  },

  indexes: [
    { columns: ['session_id'], name: 'idx_trackingevents_session' },
    { columns: ['event_name'], name: 'idx_trackingevents_event_name' },
    { columns: ['created_at'], name: 'idx_trackingevents_created_at' },
    { columns: ['event_params'], using: 'GIN', name: 'idx_trackingevents_event_params' }
  ]
});
