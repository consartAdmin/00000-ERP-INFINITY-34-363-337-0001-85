// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.users.js — Catálogo da Tabela "users"                      ║
// ║ CONSART ERP — Estrutura de referência para camada de acesso a dados       ║
// ║ Inclui: colunas, tipos, defaults, constraints e aliases                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const CATALOG_SCHEMA_USERS = {
  schema: 'public',
  table: 'users',
  comment: 'Tabela de usuários do sistema — controle de login e permissões',

  columns: {
    id: {
      type: 'integer',
      pk: true,
      identity: true,
      nullable: false,
      comment: 'Identificador único do usuário (chave primária)',
    },

    name: {
      type: 'varchar(100)',
      nullable: false,
      comment: 'Nome completo ou identificação de login do usuário',
    },

    email: {
      type: 'varchar(100)',
      nullable: false,
      unique: true,
      comment: 'Endereço de e-mail usado para autenticação',
    },

    password_hash: {
      type: 'varchar(100)',
      nullable: false,
      comment: 'Hash da senha criptografada via bcrypt',
    },

    access_level: {
      type: 'varchar(50)',
      nullable: false,
      default: `'User'`,
      comment: 'Nível de acesso do usuário (ex: Administrador, Operador, etc.)',
    },

    created_at: {
      type: 'timestamp without time zone',
      nullable: false,
      default: 'NOW()',
      comment: 'Data e hora de criação do registro',
    },

    is_active: {
      type: 'boolean',
      nullable: false,
      default: true,
      comment: 'Status de atividade do usuário (TRUE = ativo, FALSE = inativo)',
    },
  },

  alias: {
    id: 'user_id',
    name: 'user_name',
    email: 'user_email',
    password_hash: 'user_password',
    access_level: 'user_access',
    created_at: 'user_created_at',
    is_active: 'user_is_active',
  },

  constraints: {
    pk: 'users_pkey',
    unique: ['email'],
  },

  relations: {
    // Exemplo:
    // userModules: { type: '1:N', fk: 'usuario_id', ref: 'userModules' },
  },
};

export default CATALOG_SCHEMA_USERS;
