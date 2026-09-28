// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  catalog_schema.emailSignatures.js — Assinaturas de E-mail (CONSART ERP)  ║
// ║  Define estrutura base da tabela `"emailSignatures"`                      ║
// ║  Usada pelo módulo de e-mail (Hostinger / SMTP / IMAP)                    ║
// ╚════════════════════════════════════════════════════════════════════════════╝

export const EMAIL_SIGNATURES_SCHEMA = Object.freeze({
  table: 'emailSignatures',
  alias: 'es',

  columns: {
    // 🧱 Identificação principal
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da assinatura de e-mail'
    },

    // 👤 Dono da assinatura (opcional, pode ser global)
    owneruserid: {
      type: 'INTEGER',
      comment: 'ID do usuário dono da assinatura (tabela cadastro_usuarios)'
    },

    // 🏷️ Nome de exibição da assinatura
    name: {
      type: 'VARCHAR(80)',
      notNull: true,
      comment: 'Nome da assinatura (ex: Assinatura Padrão BH3)'
    },

    // 🧾 Conteúdo HTML da assinatura
    html: {
      type: 'TEXT',
      notNull: true,
      comment: 'Conteúdo HTML completo da assinatura de e-mail'
    },

    // ⭐ Flag de assinatura padrão
    isdefault: {
      type: 'BOOLEAN',
      default: false,
      comment: 'Indica se esta é a assinatura padrão do usuário/sistema'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Data de criação do registro'
    },
    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Data da última atualização do registro'
    }
  },

  // 📚 Metainformações e índices
  constraints: {
    // Evita repetir o mesmo nome de assinatura para o mesmo usuário
    unique: ['owneruserid, name'],
    // Índices úteis para buscas
    indexes: ['owneruserid', 'isdefault']
  },

  // 🧩 Comentário geral
  comment:
    'Tabela de assinaturas de e-mail utilizadas pelo módulo de e-mail do CONSART ERP. Permite definir assinaturas HTML por usuário e marcar uma como padrão.'
});
