//╔════════════════════════════════════════════════════════════════════════════╗
//║ 🔑 schema_catalog.productsKey.js — Catálogo: ProductsKey (CONSART)        ║
//║ Estrutura base e metadados da tabela `productsKey`.                       ║
//║ - Dicionário de palavras-chave do cliente → produto real                  ║
//║ - Base para IA Budgets (auto-map / matching / budgets builder)            ║
//╚════════════════════════════════════════════════════════════════════════════╝

export const PRODUCTS_KEY_SCHEMA = Object.freeze({
  table: 'productsKey',
  alias: 'pk',

  columns: {
    // 🧱 Identificação principal
    products_key_id: {
      type: 'BIGSERIAL',
      pk: true,
      comment: 'Identificador único do registro de palavra-chave (key) do produto',
    },

    // 🔗 Relacionamento (pode ser FK física no banco — aqui é metadado)
    product_code: {
      type: 'VARCHAR(50)',
      notNull: true,
      comment: 'Código do produto (products.product_code)',
    },

    // 🧠 Palavras para filtro / matching
    word_keys: {
      type: 'TEXT',
      notNull: true,
      comment: 'Palavra/frase original usada no filtro para localizar o produto',
    },

    word_keys_norm: {
      type: 'TEXT',
      notNull: true,
      comment: 'Texto normalizado (IA / matching). Ex: sem acento, lower, trim, etc.',
    },

    // 🕓 Auditoria / controle
    created_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora de criação do registro',
    },

    updated_at: {
      type: 'TIMESTAMP',
      notNull: true,
      default: 'NOW()',
      comment: 'Data/hora da última atualização do registro',
    },
  },

  // 🔗 Estrutura simbólica para JOINs automáticos futuros
  relations: {
    product: { table: 'products', key: 'product_code' },
  },

  //️ // 🔒 Regras de unicidade (validação lógica)
  uniques: [
    ['product_code', 'word_keys_norm'], // evita repetir a mesma key normalizada para o mesmo produto
  ],

  // ⚡ Índices recomendados (metadado)
  indexes: [
    { name: 'idx_productsKey_word_keys_norm', columns: ['word_keys_norm'] },
    { name: 'idx_productsKey_product_code', columns: ['product_code'] },
  ],
});

export default PRODUCTS_KEY_SCHEMA;
