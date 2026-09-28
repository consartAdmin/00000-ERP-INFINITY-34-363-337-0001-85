// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.moduleSystem.js — Schema do módulo de Módulos        ║
// ║ Padrão: ESM, com PK/Índices, aliasMap e comentários                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

/**
 * Convenções:
 * - Nomes FÍSICOS das colunas em inglês (name, path, is_active, ...).
 * - Nomes LÓGICOS (front) em camelCase via aliasMap (isActive, createdAt…).
 * - Tipos pensados para Postgres; ajuste se necessário.
 */

export const types = Object.freeze({
  BIGINT: 'bigint',
  INT: 'int',
  NUMERIC: (p = 14, s = 2) => `numeric(${p},${s})`,
  TEXT: 'text',
  VARCHAR: (n = 255) => `varchar(${n})`,
  TIMESTAMPTZ: 'timestamptz',
  DATE: 'date',
  BOOL: 'boolean',
});

// colunas padrão de auditoria
const auditCols = [
  {
    name: 'created_at',
    type: types.TIMESTAMPTZ,
    default: 'now()',
    comment: 'Timestamp de criação do módulo',
  },
  {
    name: 'updated_at',
    type: types.TIMESTAMPTZ,
    default: 'now()',
    comment: 'Última atualização do registro do módulo',
  },
];

// coluna de ativo
const activeCol = {
  name: 'is_active',
  type: types.BOOL,
  default: 'true',
  comment: 'Módulo ativo no sistema?',
};

/* =========================================================================
   TABELA moduleSystem
   -------------------------------------------------------------------------
   Tabela que registra os módulos/telas do sistema e seus caminhos.
   Colunas físicas em inglês, equivalentes às atuais:
     nome    → name
     caminho → path
     ativo   → is_active
============================================================================*/

export const MODULE_SYSTEM = {
  table: 'moduleSystem', // atenção: mantém o nome físico da tabela
  pk: 'id',
  columns: [
    {
      name: 'id',
      type: types.BIGINT,
      identity: true,
      notNull: true,
      comment: 'PK do módulo/tela do sistema',
    },

    {
      name: 'name',
      type: types.VARCHAR(100),
      notNull: true,
      comment: 'Nome amigável do módulo (para menus, telas, etc.)',
    },

    {
      name: 'path',
      type: types.VARCHAR(200),
      notNull: true,
      comment: 'Caminho/rota do arquivo HTML ou endpoint do módulo',
    },

    activeCol,
    ...auditCols,
  ],

  // índices e constraints adicionais
  indexes: [
    {
      name: 'idx_moduleSystem_name',
      cols: ['name'],
    },
    {
      name: 'idx_moduleSystem_is_active',
      cols: ['is_active'],
    },
  ],

  /**
   * aliasMap:
   *  - chave: nome usado no código/front (camelCase)
   *  - valor: nome físico da coluna no banco
   */
  aliasMap: {
    id: 'id',
    name: 'name',
    path: 'path',
    isActive: 'is_active',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },

  comment: 'Cadastro de módulos/telas do CONSART ERP (menus, rotas e estado ativo).',
};

/* =========================================================================
   AGREGAÇÃO
   -------------------------------------------------------------------------
   Export único para uso por generators/migrators de schema.
============================================================================*/

export const SCHEMA_MODULE_SYSTEM = {
  domain: 'moduleSystem',
  tables: [MODULE_SYSTEM],
  comment: 'Schema unificado do cadastro de módulos do CONSART ERP.',
};
