// **╔════════════════════════════════════════════════════════════════════════════╗**
// **║ 🏬 catalog_schema.productsStock.js — Catálogo: ProductsStock (CONSART)   ║**
// **║ Estrutura base e metadados da tabela `productsStock`.                     ║**
// **║ Define os controles de estoque por produto (quantidade, mínimo, máximo).  ║**
// **╚════════════════════════════════════════════════════════════════════════════╝**

export const PRODUCTS_STOCK_SCHEMA = Object.freeze({
  table: 'productsStock',
  alias: 'ps',

  columns: {
  //🧱 Identificação principal**
    product_stock_id: { type: 'SERIAL', pk: true, comment: 'Identificador único do registro de estoque' },

  //📦 Controle de estoque**
    stock_qty:        { type: 'NUMERIC(14,3)', default: 0, comment: 'Quantidade atual em estoque' },
    stock_min:        { type: 'NUMERIC(14,3)', default: 0, comment: 'Estoque mínimo permitido' },
    stock_max:        { type: 'NUMERIC(14,3)', default: 0, comment: 'Estoque máximo permitido' },

  //🕓 Auditoria / controle**
    created_at:       { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data de criação' },
    updated_at:       { type: 'TIMESTAMP', default: 'NOW()', comment: 'Última atualização' }
  },

  //🔗 Estrutura simbólica para JOINs automáticos futuros**
  relations: {
    product: { table: 'products', key: 'product_stock_id' }
  }
});

export default PRODUCTS_STOCK_SCHEMA;
