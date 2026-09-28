// **╔════════════════════════════════════════════════════════════════════════════╗**
// **║ ⚖️ catalog_schema.productsUnits.js — Catálogo: ProductsUnits (CONSART)    ║**
// **║ Estrutura base e metadados da tabela `productsUnits`.                      ║**
// **║ Define múltiplas unidades de venda e conversão para produtos.              ║**
// **╚════════════════════════════════════════════════════════════════════════════╝**

export const PRODUCTS_UNITS_SCHEMA = Object.freeze({
  table: 'productsUnits',
  alias: 'pu',

  columns: {
  //🧱 Identificação principal**
    product_unit_id: { type: 'SERIAL', pk: true, comment: 'Identificador único da unidade vinculada ao produto' },

  //🔗 Relacionamentos (sem FK)**
    product_id:      { type: 'INTEGER', comment: 'Produto vinculado (products.product_id)' },
    unit_id:         { type: 'INTEGER', comment: 'Referência à unidade base (tabela de unidades)' },

  //⚖️ Dados de Unidade**
    unit:            { type: 'VARCHAR(50)', notNull: true, comment: 'Nome da unidade (ex: CX, PC, KG)' },
    fator:           { type: 'NUMERIC(10,3)', default: 1, comment: 'Fator de conversão em relação à unidade base' },
    description:     { type: 'TEXT', comment: 'Descrição adicional da unidade' },
    standard:        { type: 'BOOLEAN', default: false, comment: 'Define se é a unidade padrão do produto' },

  //🕓 Auditoria / controle**
    created_at:      { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data de criação' },
    updated_at:      { type: 'TIMESTAMP', default: 'NOW()', comment: 'Última atualização' }
  },

  //🔗 Estrutura simbólica para JOINs automáticos futuros**
  relations: {
    product: { table: 'products', key: 'product_id' },
    unit:    { table: 'units',    key: 'unit_id' }
  }
});

export default PRODUCTS_UNITS_SCHEMA;
