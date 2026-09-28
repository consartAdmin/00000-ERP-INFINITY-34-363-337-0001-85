// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 📦 catalog_schema.productsLocalizationStore.js — Schema da Tabela       ║
// ║ CONSART ERP — Localização de Produtos na Loja                           ║
// ║ Estrutura base + metadados + alias padrão do catálogo                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const PRODUCTS_LOCALIZATION_STORE_SCHEMA = Object.freeze({
  table: 'productsLocalizationStore',
  alias: 'pls',

  columns: {
    // 🧱 Identificação
    id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da localização'
    },

    // 🔗 SKU do produto (não usa mais product_id)
    product_code: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'SKU do produto vinculado'
    },

    // 🏬 Loja / unidade operacional (opcional)
    store_id: {
      type: 'INTEGER',
      notNull: false,
      comment: 'Identificador da loja (multi-lojas)'
    },

    // 📍 Localização física
    corredor:   { type: 'VARCHAR(50)', notNull: false, comment: 'Corredor físico' },
    prateleira: { type: 'VARCHAR(50)', notNull: false, comment: 'Prateleira física' },
    bandeja:    { type: 'VARCHAR(50)', notNull: false, comment: 'Bandeja da prateleira' },
    box:        { type: 'VARCHAR(50)', notNull: false, comment: 'Box / gaveta (opcional)' },

    // 📝 Observações livres
    observacao: {
      type: 'TEXT',
      notNull: false,
      comment: 'Observações gerais da localização'
    },

    // ⚡ Ativo/Inativo
    ativo: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Status da localização'
    },

    // 🕒 Auditoria
    criado_em: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Data/hora de criação do registro'
    },

    atualizado_em: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Data/hora da última atualização'
    }
  }
});
