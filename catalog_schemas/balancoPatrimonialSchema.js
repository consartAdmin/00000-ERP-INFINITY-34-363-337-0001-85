// ╔══════════════════════════════════════════════════════════════════════╗
// ║ balancoPatrimonialSchema.js — Schema das tabelas patrimoniais        ║
// ║ Padrão: ESM + compatível com Controllers/DAO                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const BALANCO_PATRIMONIAL_SCHEMA = {
  table: 'balancoPatrimonial',
  alias: 'bp',
  comment: 'Tabela principal de bens do ativo imobilizado (Balanço Patrimonial).',
  columns: {
    id:                   { type: 'BIGSERIAL', pk: true, nullable: false, comment: 'Identificador único do imobilizado' },
    asset_code:           { type: 'VARCHAR(50)', nullable: false, comment: 'Código interno ou patrimonial do bem' },
    descricao:            { type: 'VARCHAR(255)', nullable: false, comment: 'Descrição detalhada do bem' },
    categoria:            { type: 'VARCHAR(100)', nullable: true, comment: 'Categoria ou grupo contábil (ex: Máquinas, Veículos, Informática)' },
    data_aquisicao:       { type: 'DATE', nullable: false, comment: 'Data da aquisição do bem' },
    valor_aquisicao:      { type: 'NUMERIC(14,2)', nullable: false, comment: 'Valor de aquisição em reais (R$)' },
    vida_util_meses:      { type: 'INTEGER', nullable: true, comment: 'Vida útil estimada em meses (para cálculo de depreciação)' },
    metodo_depreciacao:   { type: 'VARCHAR(30)', nullable: true, comment: 'Método de depreciação (ex: linear)' },
    taxa_anual:           { type: 'NUMERIC(6,3)', nullable: true, comment: 'Taxa de depreciação anual (%)' },
    valor_residual:       { type: 'NUMERIC(14,2)', nullable: true, comment: 'Valor residual estimado após vida útil' },
    centro_custo_id:      { type: 'INTEGER', nullable: true, fk: 'centrosCusto.id', comment: 'Centro de custo associado (FK futura)' },
    nfe_chave:            { type: 'VARCHAR(60)', nullable: true, comment: 'Chave de acesso da NFe de aquisição' },
    nfe_arquivo_url:      { type: 'TEXT', nullable: true, comment: 'URL ou caminho para o arquivo XML/PDF da NFe principal' },
    anexos_count:         { type: 'INTEGER', nullable: false, default: 0, comment: 'Quantidade de anexos registrados' },
    observacao:           { type: 'TEXT', nullable: true, comment: 'Observações gerais sobre o bem' },
    ativo:                { type: 'BOOLEAN', nullable: false, default: true, comment: 'Indica se o bem está ativo ou baixado' },
    created_at:           { type: 'TIMESTAMPTZ', nullable: false, default: 'NOW()', comment: 'Data de criação do registro' },
    updated_at:           { type: 'TIMESTAMPTZ', nullable: false, default: 'NOW()', comment: 'Última atualização do registro' }
  },
  indexes: [
    { name: 'idx_bp_asset_code', columns: ['asset_code'] },
    { name: 'idx_bp_categoria', columns: ['categoria'] },
    { name: 'idx_bp_data_aquisicao', columns: ['data_aquisicao'] }
  ]
};

export const BALANCO_PATRIMONIAL_ANEXOS_SCHEMA = {
  table: 'balancoPatrimonialAnexos',
  alias: 'bpa',
  comment: 'Tabela de anexos vinculados a bens do balanço patrimonial.',
  columns: {
    id:                { type: 'BIGSERIAL', pk: true, nullable: false, comment: 'Identificador único do anexo' },
    balanco_id:        { type: 'BIGINT', nullable: false, fk: 'balancoPatrimonial.id', comment: 'ID do bem patrimonial (FK)' },
    tipo:              { type: 'VARCHAR(20)', nullable: false, comment: 'Tipo do anexo (XML, PDF, OUTRO)' },
    filename:          { type: 'VARCHAR(255)', nullable: false, comment: 'Nome original do arquivo' },
    url:               { type: 'TEXT', nullable: false, comment: 'URL pública ou assinada do arquivo no GCS' },
    mime:              { type: 'VARCHAR(100)', nullable: true, comment: 'MIME Type do arquivo' },
    tamanho_bytes:     { type: 'BIGINT', nullable: true, comment: 'Tamanho do arquivo em bytes' },
    created_at:        { type: 'TIMESTAMPTZ', nullable: false, default: 'NOW()', comment: 'Data do upload' }
  },
  indexes: [
    { name: 'idx_bpa_balanco_id', columns: ['balanco_id'] }
  ],
  relations: [
    { fk: 'balanco_id', references: 'balancoPatrimonial.id', onDelete: 'CASCADE' }
  ]
};
