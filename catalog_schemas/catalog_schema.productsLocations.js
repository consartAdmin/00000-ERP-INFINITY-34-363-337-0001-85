// **╔════════════════════════════════════════════════════════════════════════════╗**
// **║ 🗺️ catalog_schema.productsLocations.js — Catálogo: ProductsLocations     ║**
// **║ Estrutura base e metadados da tabela `productsLocations`.                 ║**
// **║ Define locais físicos de armazenagem de produtos (ex: corredor, bandeja). ║**
// **╚════════════════════════════════════════════════════════════════════════════╝**

export const PRODUCTS_LOCATIONS_SCHEMA = Object.freeze({
  table: 'productsLocations',
  alias: 'pl',

  columns: {
  //🧱 Identificação principal**
    product_location_id: { type: 'SERIAL', pk: true, comment: 'Identificador único da localização do produto' },

  //📍 Informações de Localização**
    name:                { type: 'VARCHAR(100)', notNull: true, comment: 'Nome ou identificação da localização (ex: Corredor A, Prateleira 2)' },

  //🕓 Auditoria / controle**
    created_at:          { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data de criação do registro' },
    updated_at:          { type: 'TIMESTAMP', default: 'NOW()', comment: 'Última atualização do registro' },
    is_active:           { type: 'BOOLEAN', default: true, comment: 'Status ativo/inativo da localização' }
  },

  //🔗 Estrutura simbólica para JOINs automáticos futuros**
  relations: {
    products: { table: 'products', key: 'product_location_id' }
  }
});

export default PRODUCTS_LOCATIONS_SCHEMA;
