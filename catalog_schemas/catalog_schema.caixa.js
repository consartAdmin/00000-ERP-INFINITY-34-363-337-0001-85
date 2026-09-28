// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.caixa.js — Schemas do módulo de Caixa (CONSART ERP)  ║
// ║ Padrão: ESM, com PK/FK/Índices, aliasMap e comentários               ║
// ╚══════════════════════════════════════════════════════════════════════╝

/**
 * Convenções adotadas:
 * - Mantidos os nomes EXATOS das tabelas e colunas fornecidas (ex.: movimentacoesCaixa).
 * - Tipos Postgres sugeridos; ajuste precisões se necessário.
 * - Todas as tabelas de domínio recebem created_at/updated_at/is_active (quando fizer sentido).
 * - aliasMap: ajuda controllers/services a mapear campos do front para o banco.
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

const auditCols = [
  { name: 'created_at', type: types.TIMESTAMPTZ, default: 'now()', comment: 'Carimbo de criação' },
  { name: 'updated_at', type: types.TIMESTAMPTZ, default: 'now()', comment: 'Última atualização' },
];

const activeCol = { name: 'is_active', type: types.BOOL, default: 'true', comment: 'Registro ativo?' };

/* =========================================================================
   TABELAS DE DOMÍNIO
   - caixaCategorias
   - caixaSubCategorias
============================================================================*/

/** Categorias de movimentações de caixa */
export const CAIXA_CATEGORIAS = {
  table: 'caixaCategorias',
  pk: 'id',
  columns: [
    { name: 'id', type: types.BIGINT, identity: true, notNull: true, comment: 'PK' },
    { name: 'nome', type: types.VARCHAR(120), notNull: true, comment: 'Nome da categoria' },
    activeCol,
    ...auditCols,
  ],
  indexes: [
    { name: 'idx_caixa_categorias_nome', cols: ['nome'] },
    { name: 'idx_caixa_categorias_unique_nome', unique: true, cols: ['nome'] },
  ],
  aliasMap: { categoria_id: 'id', categoria_nome: 'nome' },
  comment: 'Domínio de categorias para movimentações de caixa.',
};

/** Subcategorias, vinculadas a uma categoria */
export const CAIXA_SUBCATEGORIAS = {
  table: 'caixaSubCategorias',
  pk: 'id',
  columns: [
    { name: 'id', type: types.BIGINT, identity: true, notNull: true, comment: 'PK' },
    {
      name: 'categoria_id',
      type: types.BIGINT,
      notNull: true,
      ref: { table: CAIXA_CATEGORIAS.table, col: CAIXA_CATEGORIAS.pk, onDelete: 'RESTRICT' },
      comment: 'FK → caixaCategorias.id',
    },
    { name: 'nome', type: types.VARCHAR(120), notNull: true, comment: 'Nome da subcategoria' },
    activeCol,
    ...auditCols,
  ],
  indexes: [
    { name: 'idx_caixa_subcategorias_categoria', cols: ['categoria_id'] },
    { name: 'idx_caixa_subcategorias_nome', cols: ['nome'] },
    { name: 'idx_caixa_subcategorias_unique_cat_nome', unique: true, cols: ['categoria_id', 'nome'] },
  ],
  aliasMap: {
    subcategoria_id: 'id',
    subcategoria_nome: 'nome',
    categoria_id: 'categoria_id',
  },
  comment: 'Domínio de subcategorias por categoria.',
};

/* =========================================================================
   MOVIMENTAÇÕES
   - movimentacoesCaixa
   - movimentacoesCaixaAnexos
============================================================================*/

/**
 * Lançamentos de caixa (entradas/saídas).
 * FKs confirmadas: categoria → caixaCategorias.id, subcategoria → caixaSubCategorias.id
 */
export const MOVIMENTACOES_CAIXA = {
  table: 'movimentacoesCaixa',
  pk: 'id',
  columns: [
    { name: 'id', type: types.BIGINT, identity: true, notNull: true, comment: 'PK' },

    { name: 'data_hora', type: types.TIMESTAMPTZ, notNull: true, comment: 'Data/hora do lançamento' },

    // Valor e encargos
    { name: 'valor', type: types.NUMERIC(16, 2), notNull: true, default: '0', comment: 'Valor principal (positivo = entrada; negativo = saída, se preferir inverter por tipo use sempre positivo aqui)' },
    { name: 'multa', type: types.NUMERIC(16, 2), default: '0', comment: 'Multa (se houver)' },
    { name: 'juros', type: types.NUMERIC(16, 2), default: '0', comment: 'Juros (se houver)' },
    { name: 'encargos', type: types.NUMERIC(16, 2), default: '0', comment: 'Encargos/outros acréscimos' },

    // Classificação do movimento
    { name: 'tipo_movimentacao', type: types.VARCHAR(20), notNull: true, comment: 'ENTRADA | SAIDA (string livre por ora)' },

    // Conta/Origem: mantido como campo simples (poderá evoluir para FK quando você enviar a tabela de contas/caixas)
    { name: 'conta_caixa', type: types.BIGINT, comment: 'Conta/caixa de origem/destino (pode virar FK futuramente)' },

    // Documento
    { name: 'tipo_documento', type: types.VARCHAR(40), comment: 'Ex.: NF, PIX, BOLETO, RECIBO, etc.' },
    { name: 'numero_documento', type: types.VARCHAR(80), comment: 'Número do documento' },

    // Contraparte / Observações
    { name: 'fornecedor', type: types.VARCHAR(160), comment: 'Fornecedor/Cliente/Contraparte (texto livre ou FK futura)' },
    { name: 'observacao', type: types.TEXT, comment: 'Observações gerais' },

    // FKs confirmadas
    {
      name: 'categoria',
      type: types.BIGINT,
      notNull: true,
      ref: { table: CAIXA_CATEGORIAS.table, col: CAIXA_CATEGORIAS.pk, onDelete: 'RESTRICT' },
      comment: 'FK → caixaCategorias.id',
    },
    {
      name: 'subcategoria',
      type: types.BIGINT,
      ref: { table: CAIXA_SUBCATEGORIAS.table, col: CAIXA_SUBCATEGORIAS.pk, onDelete: 'RESTRICT' },
      comment: 'FK → caixaSubCategorias.id',
    },

    activeCol,
    ...auditCols,
  ],
  indexes: [
    { name: 'idx_mov_caixa_data', cols: ['data_hora'] },
    { name: 'idx_mov_caixa_tipo', cols: ['tipo_movimentacao'] },
    { name: 'idx_mov_caixa_conta', cols: ['conta_caixa'] },
    { name: 'idx_mov_caixa_categoria', cols: ['categoria'] },
    { name: 'idx_mov_caixa_subcategoria', cols: ['subcategoria'] },
    // Busca mista comum: período + conta
    { name: 'idx_mov_caixa_data_conta', cols: ['data_hora', 'conta_caixa'] },
  ],
  aliasMap: {
    id: 'id',
    dataHora: 'data_hora',
    tipo: 'tipo_movimentacao',
    conta: 'conta_caixa',
    valor: 'valor',
    tipoDocumento: 'tipo_documento',
    numeroDocumento: 'numero_documento',
    fornecedor: 'fornecedor',
    observacao: 'observacao',
    multa: 'multa',
    juros: 'juros',
    encargos: 'encargos',
    categoriaId: 'categoria',
    subcategoriaId: 'subcategoria',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    isActive: 'is_active',
  },
  comment: 'Lançamentos de caixa (entradas/saídas) com classificação por categoria/subcategoria.',
};

/**
 * Anexos vinculados à movimentação.
 * FK confirmada: movimentacao_id → movimentacoesCaixa.id (ON DELETE CASCADE).
 */
export const MOVIMENTACOES_CAIXA_ANEXOS = {
  table: 'movimentacoesCaixaAnexos',
  pk: 'id',
  columns: [
    { name: 'id', type: types.BIGINT, identity: true, notNull: true, comment: 'PK' },
    {
      name: 'movimentacao_id',
      type: types.BIGINT,
      notNull: true,
      ref: { table: MOVIMENTACOES_CAIXA.table, col: MOVIMENTACOES_CAIXA.pk, onDelete: 'CASCADE' },
      comment: 'FK → movimentacoesCaixa.id (cascade para apagar anexos junto com a movimentação)',
    },
    { name: 'filename', type: types.VARCHAR(255), notNull: true, comment: 'Nome do arquivo' },
    { name: 'mime_type', type: types.VARCHAR(120), notNull: true, comment: 'MIME type (ex.: application/pdf)' },
    { name: 'size_bytes', type: types.BIGINT, notNull: true, comment: 'Tamanho em bytes' },
    { name: 'gcs_bucket', type: types.VARCHAR(120), comment: 'Bucket (se usar GCS)' },
    { name: 'gcs_path', type: types.VARCHAR(512), comment: 'Caminho/Key do arquivo' },
    { name: 'created_at', type: types.TIMESTAMPTZ, default: 'now()', comment: 'Carimbo do upload' },
  ],
  indexes: [
    { name: 'idx_mov_caixa_anexos_mov', cols: ['movimentacao_id'] },
    { name: 'idx_mov_caixa_anexos_bucket_path', cols: ['gcs_bucket', 'gcs_path'] },
  ],
  aliasMap: {
    id: 'id',
    movimentacaoId: 'movimentacao_id',
    nomeArquivo: 'filename',
    mimeType: 'mime_type',
    tamanhoBytes: 'size_bytes',
    bucket: 'gcs_bucket',
    path: 'gcs_path',
    createdAt: 'created_at',
  },
  comment: 'Arquivos anexados a uma movimentação de caixa.',
};

/* =========================================================================
   AGREGAÇÃO (export único para consumo nos generators/migrators)
============================================================================*/

export const SCHEMA_CAIXA = {
  domain: 'caixa',
  tables: [
    CAIXA_CATEGORIAS,
    CAIXA_SUBCATEGORIAS,
    MOVIMENTACOES_CAIXA,
    MOVIMENTACOES_CAIXA_ANEXOS,
  ],
  comment:
    'Schema unificado do módulo de Caixa com domínios (categorias/subcategorias), movimentações e anexos.',
};
