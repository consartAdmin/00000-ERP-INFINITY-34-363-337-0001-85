// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 🧩 userModules — Controle de Permissões de Módulos por Usuário          ║
// ║ Relaciona cada usuário ao conjunto de módulos que ele pode acessar.    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const USER_MODULES_SCHEMA = {
  table: 'userModules',
  schema: 'public',
  comment: 'Relação de permissões entre usuários e módulos do sistema (ACL modular).',

  columns: {
    id: {
      type: 'integer',
      pk: true,
      generated: true,
      comment: 'Chave primária da relação.',
    },

    usuario_id: {
      type: 'integer',
      fk: 'users.user_id',
      notNull: true,
      comment: 'ID do usuário referenciado na tabela users.',
    },

    modulo_id: {
      type: 'integer',
      fk: 'systemModules.id',
      notNull: true,
      comment: 'ID do módulo referenciado na tabela systemModules.',
    },

    pode_acessar: {
      type: 'boolean',
      default: false,
      comment: 'Define se o usuário possui permissão de acesso ao módulo.',
    },

    created_at: {
      type: 'timestamp',
      default: 'CURRENT_TIMESTAMP',
      comment: 'Data/hora de criação do vínculo.',
    },

    updated_at: {
      type: 'timestamp',
      default: 'CURRENT_TIMESTAMP',
      onUpdate: true,
      comment: 'Data/hora da última atualização.',
    },
  },

  constraints: {
    unique_user_module: {
      type: 'unique',
      columns: ['usuario_id', 'modulo_id'],
      comment: 'Impede duplicidade de permissões para o mesmo módulo e usuário.',
    },
  },
};
