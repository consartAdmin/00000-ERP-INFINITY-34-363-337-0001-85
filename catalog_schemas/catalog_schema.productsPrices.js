//╔════════════════════════════════════════════════════════════════════════════╗**
//║ 💲 catalog_schema.productsPrices.js — Catálogo: ProductsPrices (CONSART)  ║**
//║ Estrutura base e metadados da tabela `productsPrices`.                    ║**
//*║ Define os preços vinculados aos produtos e tabelas de preço.              ║**
//╚════════════════════════════════════════════════════════════════════════════╝**

export const PRODUCTS_PRICES_SCHEMA = Object.freeze({
  table: 'productsPrices',
  alias: 'pp',

  columns: {
    //🧱 Identificação principal**
    product_price_id: { type: 'SERIAL', pk: true, comment: 'Identificador único do registro de preço do produto' },

  //🔗 Relacionamentos (sem FK)**
    product_id:       { type: 'INTEGER', comment: 'Referência ao produto (products.product_id)' },
    price_id:         { type: 'INTEGER', comment: 'Referência à tabela de preço (priceTables ou prices)' },

  //💲 Dados de Preço**
    sale_price:       { type: 'NUMERIC(14,2)', default: 0, comment: 'Preço de venda aplicado ao produto' },
    markup_percent:   { type: 'NUMERIC(7,4)',  default: 0, comment: 'Percentual de markup (%) sobre o custo' },
    gross_profit_pct: { type: 'NUMERIC(7,4)',  default: 0, comment: 'Percentual de lucro bruto (%)' },

  //🕓 Auditoria / controle**
    updated_at:       { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data/hora da última atualização do registro' }
  },

  //🔗 Estrutura simbólica para JOINs automáticos futuros**
  relations: {
    product: { table: 'products', key: 'product_id' },
    price:   { table: 'prices',   key: 'price_id' }
  },

  //🔒 Regras de unicidade (validação lógica, sem FK explícita)**
  uniques: [
    ['product_id', 'price_id'] // Cada produto + tabela de preço deve ser único
  ]
});

export default PRODUCTS_PRICES_SCHEMA;
