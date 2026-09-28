// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  catalog_schema.productsGroups.js — Grupos de Produtos (CONSART ERP)      ║
// ║  Define estrutura base da tabela `productsGroups`                         ║
// ║  Relacionada a produtos via `product_group_id`                            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const PRODUCTS_GROUPS_SCHEMA = Object.freeze({
  table: 'productsGroups',
  alias: 'pg',

  columns: {
    // 🧱 Identificação principal
    product_group_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do grupo de produtos'
    },

    // 🏷️ Informações gerais
    name: {
      type: 'VARCHAR(100)',
      notNull: true,
      unique: true,
      comment: 'Nome do grupo de produtos'
    },

    // 🕓 Auditoria / status
    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Data de criação do registro'
    },
    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Última atualização do registro'
    },
    is_active: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Status ativo/inativo do grupo'
    }
  },

  // 🔗 Relacionamentos simbólicos (para joins automáticos)
  relations: {
    products: { table: 'products', key: 'product_group_id' }
  }
});

export default PRODUCTS_GROUPS_SCHEMA;
