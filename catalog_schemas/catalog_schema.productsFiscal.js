// ╔════════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.productsFiscal.js — Snapshot Fiscal por Produto (CONSART)  ║
// ║ Descrição:                                                                ║
// ║   • Tabela desnormalizada que consolida dados de fiscalClassification     ║
// ║     e fiscalProfile no contexto de um produto (histórico + vigente).      ║
// ║   • Ideal para importações idempotentes e exportações sem conflitos.      ║
// ║ Padrão: ESM, imutável via Object.freeze                                   ║
// ╚════════════════════════════════════════════════════════════════════════════╝

export const PRODUCTS_FISCAL_SCHEMA = Object.freeze({
  table: 'productsFiscal',
  schema: 'public',
  fqtn: 'public."productsFiscal"', // fully-qualified table name
  alias: 'pf',

  // ──────────────────────────────────────────────────────────────────────────
  // Colunas
  // ──────────────────────────────────────────────────────────────────────────
  columns: {
    // 🧱 Identificação
    products_fiscal_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do snapshot fiscal do produto'
    },

    // 🔗 Relacionamentos
    product_id: {
      type: 'INTEGER',
      notNull: true,
      references: 'public."products"(product_id) ON UPDATE CASCADE ON DELETE CASCADE',
      comment: 'FK para products.product_id'
    },
    fiscal_classification_id: {
      type: 'INTEGER',
      references: 'public."fiscalClassification"(fiscal_classification_id) ON UPDATE CASCADE ON DELETE SET NULL',
      comment: 'FK opcional: origem da classificação fiscal utilizada no snapshot'
    },
    fiscal_profile_id: {
      type: 'INTEGER',
      references: 'public."fiscalProfile"(fiscal_profile_id) ON UPDATE CASCADE ON DELETE SET NULL',
      comment: 'FK opcional: origem do perfil fiscal utilizado no snapshot'
    },

    // 🧩 Campos espelhados de fiscalClassification
    classification_name: {
      type: 'VARCHAR(150)',
      notNull: true,
      comment: 'Nome da classificação fiscal no momento do snapshot'
    },
    description_class: {
      type: 'TEXT',
      comment: 'Descrição da classificação fiscal (snapshot)'
    },
    ncm_code: {
      type: 'VARCHAR(10)',
      comment: 'Código NCM do produto (snapshot)'
    },
    ncm_description: {
      type: 'TEXT',
      comment: 'Descrição do NCM (snapshot)'
    },
    cest_code: {
      type: 'VARCHAR(10)',
      comment: 'Código CEST do produto (snapshot)'
    },
    cest_description: {
      type: 'TEXT',
      comment: 'Descrição do CEST (snapshot)'
    },

    // 🧾 Campos espelhados de fiscalProfile (conforme estrutura real enviada)
    profile_name: {
      type: 'VARCHAR(120)',
      comment: 'Nome do perfil fiscal (snapshot)'
    },
    description_profile: {
      type: 'TEXT',
      comment: 'Descrição do perfil fiscal (snapshot)'
    },
    icms_cst: {
      type: 'VARCHAR(10)',
      comment: 'CST do ICMS (snapshot)'
    },
    icms_rate: {
      type: 'NUMERIC(6,2)',
      comment: 'Alíquota ICMS em % (snapshot)'
    },
    cfop_entry: {
      type: 'VARCHAR(10)',
      comment: 'CFOP de entrada (snapshot)'
    },
    cfop_exit: {
      type: 'VARCHAR(10)',
      comment: 'CFOP de saída (snapshot)'
    },
    origin_code: {
      type: 'VARCHAR(10)',
      comment: 'Código de origem do produto (snapshot)'
    },
    pis_cst: {
      type: 'VARCHAR(10)',
      comment: 'CST do PIS (snapshot)'
    },
    pis_rate: {
      type: 'NUMERIC(6,2)',
      comment: 'Alíquota PIS em % (snapshot)'
    },
    cofins_cst: {
      type: 'VARCHAR(10)',
      comment: 'CST do COFINS (snapshot)'
    },
    cofins_rate: {
      type: 'NUMERIC(6,2)',
      comment: 'Alíquota COFINS em % (snapshot)'
    },
    benefit_code: {
      type: 'VARCHAR(20)',
      comment: 'Código de benefício fiscal (UF/legislação) no snapshot'
    },

    // 🗓️ Vigência / versionamento do snapshot
    effective_from: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Início da vigência do snapshot'
    },
    effective_to: {
      type: 'TIMESTAMP',
      comment: 'Fim da vigência (NULL = vigente)'
    },
    version: {
      type: 'INTEGER',
      default: '1',
      comment: 'Versão sequencial do snapshot por produto'
    },
    is_active: {
      type: 'BOOLEAN',
      default: 'TRUE',
      comment: 'Ativo (snapshot válido) vs. inativo'
    },

    // ⚙️ Importação / rastreabilidade / idempotência
    source_system: {
      type: 'VARCHAR(60)',
      comment: 'Sistema/origem do dado importado (ex.: planilha, legado, integração X)'
    },
    source_reference: {
      type: 'VARCHAR(120)',
      comment: 'Referência externa (ex.: linha da planilha, ID do legado)'
    },
    source_hash: {
      type: 'TEXT',
      comment: 'Hash (ex.: SHA256) do payload normalizado para idempotência'
    },
    extra_payload: {
      type: 'JSONB',
      comment: 'Metadados adicionais flexíveis'
    },
    raw_payload: {
      type: 'JSONB',
      comment: 'Payload bruto importado'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Carimbo de criação'
    },
    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Carimbo de última atualização (auto via trigger)'
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Índices / unicidades (documentação para ensureTable/DDL)
  // ──────────────────────────────────────────────────────────────────────────
  indexes: [
    {
      name: 'idx_productsFiscal_product_id',
      columns: ['product_id'],
      using: 'btree'
    },
    {
      name: 'idx_productsFiscal_ncm',
      columns: ['ncm_code'],
      using: 'btree'
    },
    {
      name: 'idx_productsFiscal_cest',
      columns: ['cest_code'],
      using: 'btree'
    },
    {
      // Unicidade do snapshot vigente por produto
      name: 'ux_productsFiscal_current',
      expr: '(product_id)',
      unique: true,
      where: 'is_active IS TRUE AND effective_to IS NULL'
    },
    {
      // Idempotência por origem
      name: 'ux_productsFiscal_source_hash',
      columns: ['source_system', 'source_hash'],
      unique: true
    }
  ],

  // ──────────────────────────────────────────────────────────────────────────
  // Relações (para geradores/ORMs)
  // ──────────────────────────────────────────────────────────────────────────
  relations: {
    product: { fk: 'product_id', ref: 'public."products"(product_id)', onUpdate: 'CASCADE', onDelete: 'CASCADE' },
    fiscalClassification: { fk: 'fiscal_classification_id', ref: 'public."fiscalClassification"(fiscal_classification_id)', onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    fiscalProfile: { fk: 'fiscal_profile_id', ref: 'public."fiscalProfile"(fiscal_profile_id)', onUpdate: 'CASCADE', onDelete: 'SET NULL' }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Alias para SELECTs (facilita mapeamento em controllers)
  // ──────────────────────────────────────────────────────────────────────────
  selectMap: {
    id: 'pf.products_fiscal_id',
    product_id: 'pf.product_id',
    classification_name: 'pf.classification_name',
    ncm_code: 'pf.ncm_code',
    cest_code: 'pf.cest_code',
    profile_name: 'pf.profile_name',
    icms_cst: 'pf.icms_cst',
    icms_rate: 'pf.icms_rate',
    cfop_entry: 'pf.cfop_entry',
    cfop_exit: 'pf.cfop_exit',
    origin_code: 'pf.origin_code',
    pis_cst: 'pf.pis_cst',
    pis_rate: 'pf.pis_rate',
    cofins_cst: 'pf.cofins_cst',
    cofins_rate: 'pf.cofins_rate',
    benefit_code: 'pf.benefit_code',
    effective_from: 'pf.effective_from',
    effective_to: 'pf.effective_to',
    version: 'pf.version',
    is_active: 'pf.is_active',
    created_at: 'pf.created_at',
    updated_at: 'pf.updated_at'
  }
});

export default PRODUCTS_FISCAL_SCHEMA;
