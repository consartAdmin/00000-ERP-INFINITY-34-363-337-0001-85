//╔════════════════════════════════════════════════════════════════════════════╗**
//║  catalog_schema.productsSubgroups.js — Subgrupos de Produtos (CONSART)     ║**
//║ Define a estrutura base da tabela `productsSubgroups`                      ║**
//║ Relacionada a `productsGroups` e a `products` via FK simbólica.            ║**
//╚════════════════════════════════════════════════════════════════════════════╝**

export const PRODUCTS_SUBGROUPS_SCHEMA = Object.freeze({
  table: 'productsSubgroups',
  alias: 'psg',

  columns: {
//🧱 Identificação principal**
    product_subgroup_id: { type: 'SERIAL', pk: true, comment: 'Identificador único do subgrupo de produtos' },

//🏷️ Informações gerais**
    name:                { type: 'VARCHAR(100)', notNull: true, unique: true, comment: 'Nome do subgrupo de produtos' },

//🔗 Relacionamento simbólico com productsGroups**
    group_id:            { type: 'INTEGER', comment: 'Referência ao grupo de produtos (productsGroups)' },

//🕓 Auditoria / status**
    created_at:          { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data de criação do registro' },
    updated_at:          { type: 'TIMESTAMP', default: 'NOW()', comment: 'Última atualização do registro' },
    is_active:           { type: 'BOOLEAN', default: true, comment: 'Status ativo/inativo do subgrupo' }
  },

//🔗 Relacionamentos simbólicos (JOINs automáticos)**
  relations: {
    group:    { table: 'productsGroups', key: 'group_id' },
    products: { table: 'products',       key: 'product_subgroup_id' }
  }
});

export default PRODUCTS_SUBGROUPS_SCHEMA;
