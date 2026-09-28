// **╔════════════════════════════════════════════════════════════════════════════╗**
// **║ 🖼️ catalog_schema.productsImagens.js — Catálogo: ProductsImagens (CONSART)║**
// **║ Estrutura base e metadados da tabela `productsImagens`.                    ║**
// **║ Gerencia múltiplas imagens por produto, com posições e destaque principal. ║**
// **╚════════════════════════════════════════════════════════════════════════════╝**

export const PRODUCTS_IMAGENS_SCHEMA = Object.freeze({
  table: 'productsImagens',
  alias: 'pi',

  columns: {
  //🧱 Identificação principal**
    product_imagem_id: { type: 'SERIAL', pk: true, comment: 'Identificador único da imagem do produto' },

  //🔗 Relacionamentos (sem FK)**
    product_id:        { type: 'INTEGER', comment: 'Produto vinculado (products.product_id)' },

  //🖼️ Dados da Imagem**
    image_url:         { type: 'TEXT', comment: 'URL pública da imagem do produto' },
    image_path:        { type: 'TEXT', comment: 'Caminho local no servidor (storage interno)' },
    image_alt:         { type: 'TEXT', comment: 'Texto alternativo para acessibilidade e SEO' },
    is_primary:        { type: 'BOOLEAN', default: false, comment: 'Define se a imagem é principal' },
    position:          { type: 'INTEGER', default: 1, comment: 'Ordem de exibição da imagem' },

  //🕓 Auditoria / controle**
    created_at:        { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data de criação do registro' },
    updated_at:        { type: 'TIMESTAMP', default: 'NOW()', comment: 'Última atualização do registro' },
    is_active:         { type: 'BOOLEAN', default: true, comment: 'Status ativo/inativo da imagem' }
  },

  //🔗 Estrutura simbólica para JOINs automáticos futuros**
  relations: {
    product: { table: 'products', key: 'product_id' }
  },

  //🔒 Regras de unicidade (validação lógica, sem FK explícita)**
  uniques: [
    ['product_id', 'image_path']
  ]
});

export default PRODUCTS_IMAGENS_SCHEMA;
