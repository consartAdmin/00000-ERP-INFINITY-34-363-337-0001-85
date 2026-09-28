// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.manufacturers.js — Esquema da tabela de Fabricantes  ║
// ║ CONSART ERP | Catalog Schema (ESM)                                  ║
// ║                                                                      ║
// ║ - Define metadados da tabela public."manufacturers"                  ║
// ║ - Usado por camadas de DAL/API para padronizar colunas e DDL        ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const MANUFACTURERS_TABLE = Object.freeze({
  schema: 'public',
  tableName: 'manufacturers',
  primaryKey: 'manufacturer_id',

  // Sequência usada pelo campo ID
  idSequence: 'tabela_fabricantes_id_seq',

  // ─────────────────────────────────────────────────────────────────────
  // Definição das colunas (metadados)
  // ─────────────────────────────────────────────────────────────────────
  columns: Object.freeze({
    manufacturer_id: {
      name: 'manufacturer_id',
      type: 'integer',
      nullable: false,
      primaryKey: true,
      hasDefault: true,
      default: `nextval('tabela_fabricantes_id_seq'::regclass)`,
      description: 'ID interno do fabricante (PK)',
    },

    trade_name: {
      name: 'trade_name',
      type: 'varchar(200)',
      nullable: false,
      description: 'Nome fantasia do fabricante',
    },

    corporate_name: {
      name: 'corporate_name',
      type: 'varchar(200)',
      nullable: true,
      description: 'Razão social do fabricante',
    },

    tax_id: {
      name: 'tax_id',
      type: 'varchar(20)',
      nullable: true,
      description: 'CNPJ/CPF do fabricante',
    },

    state_registration: {
      name: 'state_registration',
      type: 'varchar(30)',
      nullable: true,
      description: 'Inscrição estadual',
    },

    municipal_registration: {
      name: 'municipal_registration',
      type: 'varchar(30)',
      nullable: true,
      description: 'Inscrição municipal',
    },

    email: {
      name: 'email',
      type: 'varchar(150)',
      nullable: true,
      description: 'E-mail principal',
    },

    phone: {
      name: 'phone',
      type: 'varchar(30)',
      nullable: true,
      description: 'Telefone fixo',
    },

    mobile: {
      name: 'mobile',
      type: 'varchar(30)',
      nullable: true,
      description: 'Celular / WhatsApp',
    },

    website: {
      name: 'website',
      type: 'varchar(200)',
      nullable: true,
      description: 'Site institucional',
    },

    street: {
      name: 'street',
      type: 'varchar(200)',
      nullable: true,
      description: 'Logradouro',
    },

    number: {
      name: 'number',
      type: 'varchar(20)',
      nullable: true,
      description: 'Número',
    },

    complement: {
      name: 'complement',
      type: 'varchar(100)',
      nullable: true,
      description: 'Complemento',
    },

    neighborhood: {
      name: 'neighborhood',
      type: 'varchar(100)',
      nullable: true,
      description: 'Bairro',
    },

    city: {
      name: 'city',
      type: 'varchar(150)',
      nullable: true,
      description: 'Cidade',
    },

    state: {
      name: 'state',
      type: 'varchar(2)',
      nullable: true,
      description: 'UF',
    },

    zipcode: {
      name: 'zipcode',
      type: 'varchar(20)',
      nullable: true,
      description: 'CEP',
    },

    country: {
      name: 'country',
      type: 'varchar(50)',
      nullable: true,
      hasDefault: true,
      default: `'BRAZIL'::character varying`,
      description: 'País (padrão BRAZIL)',
    },

    active: {
      name: 'active',
      type: 'boolean',
      nullable: true,
      hasDefault: true,
      default: 'true',
      description: 'Se o fabricante está ativo',
    },

    notes: {
      name: 'notes',
      type: 'text',
      nullable: true,
      description: 'Observações gerais',
    },

    created_at: {
      name: 'created_at',
      type: 'timestamp without time zone',
      nullable: true,
      hasDefault: true,
      default: 'now()',
      description: 'Data de criação do registro',
    },

    updated_at: {
      name: 'updated_at',
      type: 'timestamp without time zone',
      nullable: true,
      hasDefault: true,
      default: 'now()',
      description: 'Data da última atualização',
    },
  }),

  // ─────────────────────────────────────────────────────────────────────
  // Colunas utilitárias para DAL
  // ─────────────────────────────────────────────────────────────────────
  selectableColumns: Object.freeze([
    'manufacturer_id',
    'trade_name',
    'corporate_name',
    'tax_id',
    'state_registration',
    'municipal_registration',
    'email',
    'phone',
    'mobile',
    'website',
    'street',
    'number',
    'complement',
    'neighborhood',
    'city',
    'state',
    'zipcode',
    'country',
    'active',
    'notes',
    'created_at',
    'updated_at',
  ]),

  insertableColumns: Object.freeze([
    'trade_name',
    'corporate_name',
    'tax_id',
    'state_registration',
    'municipal_registration',
    'email',
    'phone',
    'mobile',
    'website',
    'street',
    'number',
    'complement',
    'neighborhood',
    'city',
    'state',
    'zipcode',
    'country',
    'active',
    'notes',
  ]),

  updatableColumns: Object.freeze([
    'trade_name',
    'corporate_name',
    'tax_id',
    'state_registration',
    'municipal_registration',
    'email',
    'phone',
    'mobile',
    'website',
    'street',
    'number',
    'complement',
    'neighborhood',
    'city',
    'state',
    'zipcode',
    'country',
    'active',
    'notes',
    'updated_at',
  ]),

  requiredOnInsert: Object.freeze([
    'trade_name',
  ]),

  // Índices conhecidos (para referência/logs/validações)
  indexes: Object.freeze([
    {
      name: 'idx_manufacturers_tax_id',
      columns: ['tax_id'],
      unique: false,
    },
    {
      name: 'idx_manufacturers_trade_name',
      columns: ['trade_name'],
      unique: false,
    },
  ]),

  // Opcional: DDL de referência (não precisa ser usado se a tabela já existe)
  createTableSQL: `
    CREATE TABLE IF NOT EXISTS public."manufacturers" (
      manufacturer_id        integer PRIMARY KEY
                             DEFAULT nextval('tabela_fabricantes_id_seq'::regclass),
      trade_name             varchar(200) NOT NULL,
      corporate_name         varchar(200),
      tax_id                 varchar(20),
      state_registration     varchar(30),
      municipal_registration varchar(30),
      email                  varchar(150),
      phone                  varchar(30),
      mobile                 varchar(30),
      website                varchar(200),
      street                 varchar(200),
      number                 varchar(20),
      complement             varchar(100),
      neighborhood           varchar(100),
      city                   varchar(150),
      state                  varchar(2),
      zipcode                varchar(20),
      country                varchar(50) DEFAULT 'BRAZIL',
      active                 boolean     DEFAULT true,
      notes                  text,
      created_at             timestamp without time zone DEFAULT now(),
      updated_at             timestamp without time zone DEFAULT now()
    );
  `.trim(),
});

export default Object.freeze(MANUFACTURERS_TABLE);
