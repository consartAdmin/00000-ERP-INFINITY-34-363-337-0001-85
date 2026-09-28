// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.fiscalClassification.js — Classificação Fiscal (CONSART)   ║
// ║ Define estrutura base da tabela `fiscalClassification`                    ║
// ║ Relacionada ao módulo Fiscal (NCM / CEST / Perfil Fiscal)                 ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const FISCAL_CLASSIFICATION_SCHEMA = Object.freeze({
  table: 'fiscalClassification',
  alias: 'fc',

  columns: {
    // 🧱 Identificação principal
    fiscal_classification_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da classificação fiscal'
    },

    // 🏷️ Dados descritivos
    classification_name: {
      type: 'VARCHAR(150)',
      notNull: true,
      comment: 'Nome da classificação fiscal'
    },
    description: {
      type: 'TEXT',
      comment: 'Descrição detalhada da classificação fiscal'
    },

    // 🧮 Códigos fiscais
    ncm_code: {
      type: 'VARCHAR(10)',
      comment: 'Código NCM vinculado à classificação'
    },
    cest_code: {
      type: 'VARCHAR(10)',
      comment: 'Código CEST vinculado à classificação'
    },

    // 📜 Descrições fiscais
    ncm_description: {
      type: 'TEXT',
      comment: 'Descrição do código NCM'
    },
    cest_description: {
      type: 'TEXT',
      comment: 'Descrição do código CEST'
    },

    // ⚙️ Perfil fiscal vinculado
    fiscal_profile_id: {
      type: 'INTEGER',
      fk: 'fiscalProfile.fiscal_profile_id',
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Chave estrangeira para o perfil fiscal'
    },

    // ⚖️ Status e auditoria
    is_active: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Define se o registro está ativo'
    },
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

  indexes: [
    { name: 'idx_fiscalclassification_ncm', columns: ['ncm_code'] },
    { name: 'idx_fiscalclassification_cest', columns: ['cest_code'] }
  ],

  comment: 'Classificação fiscal de produtos (NCM/CEST/Perfis fiscais)'
});
