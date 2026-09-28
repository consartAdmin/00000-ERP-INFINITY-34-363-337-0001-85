// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.sellerByUser.js — Vínculo Usuário x Vendedor (CONSART ERP) ║
// ║ Define estrutura base da tabela `sellerByUser`                            ║
// ║ Utilizada para vincular usuários do sistema a vendedores (principal/ativo)║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const SELLER_BY_USER_SCHEMA = Object.freeze({
  table: 'sellerByUser',
  alias: 'sbu',

  columns: {
    // 🧱 Identificação principal
    id: {
      type: 'BIGSERIAL',
      pk: true,
      comment: 'Identificador único do vínculo usuário x vendedor'
    },

    // 🔗 Relacionamentos
    user_id: {
      type: 'BIGINT',
      notNull: true,
      comment: 'ID do usuário vinculado'
    },

    seller_id: {
      type: 'BIGINT',
      notNull: true,
      comment: 'ID do vendedor vinculado'
    },

    // ⭐ Regras do vínculo
    is_primary: {
      type: 'BOOLEAN',
      default: true,
      notNull: true,
      comment: 'Indica se este vendedor é o principal do usuário'
    },

    active: {
      type: 'BOOLEAN',
      default: true,
      notNull: true,
      comment: 'Indica se o vínculo está ativo'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data/hora de criação do registro'
    },

    updated_at: {
      type: 'TIMESTAMPTZ',
      default: 'NOW()',
      notNull: true,
      comment: 'Data/hora da última atualização'
    }
  }
});
