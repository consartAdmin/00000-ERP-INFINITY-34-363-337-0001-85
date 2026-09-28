// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  catalog_schema.grades.js — Grades de Produtos (cores, tamanhos, etc.)     ║
// ║  Define estrutura base da tabela `grades`                                  ║
// ║  Relacionada a produtos via `grade_id`                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝

export const GRADES_SCHEMA = Object.freeze({
  table: 'grades',
  alias: 'gr',

  columns: {
    // 🧱 Identificação principal
    grade_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da grade'
    },

    // 🏷️ Informações gerais
    grade: {
      type: 'VARCHAR(50)',
      notNull: true,
      unique: true,
      comment: 'Nome da grade (ex: BRANCO, AZUL, TAMANHO G)'
    },

    description: {
      type: 'TEXT',
      comment: 'Descrição detalhada da grade'
    },

    // ⚙️ Controle de status
    is_active: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Define se a grade está ativa'
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
    },

    // 🔗 Metadados e versionamento
    version: {
      type: 'INTEGER',
      default: 1,
      comment: 'Controle de versão do registro'
    },
    source_system: {
      type: 'VARCHAR(50)',
      comment: 'Origem do registro (ex: ERP, importação, API externa)'
    },
    source_hash: {
      type: 'VARCHAR(120)',
      comment: 'Hash de integridade para controle de sincronização'
    }
  },

  // 📚 Metainformações e índices
  constraints: {
    unique: ['grade'],
    indexes: ['is_active', 'grade']
  },

  // 🧩 Comentário geral
  comment:
    'Tabela de grades de produtos. Utilizada para representar variações como cor, tamanho, acabamento ou outras classificações visuais dos produtos.'
});
