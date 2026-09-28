// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.productsGrades.js — Grades por Produto (CONSART ERP)     ║
// ║ Estrutura base da tabela productsGrades                                 ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const PRODUCTS_GRADES_SCHEMA = Object.freeze({
  table: 'productsGrades',
  alias: 'pgs',

  columns: {
    // 🧱 Identificação principal
    product_grade_id: { type: 'SERIAL', pk: true, comment: 'Identificador único do registro (PK)' },

    // 🔗 Relacionamentos
    product_id: { type: 'VARCHAR(20)', notNull: true, comment: 'Identificador do produto (FK)' },
    grade_id: { type: 'INTEGER', notNull: true, comment: 'Identificador da grade (FK para grades)' },

    // 📦 Estoque da grade
    stock: { type: 'INTEGER', default: 0, comment: 'Quantidade em estoque desta variação' },

    // 🕓 Auditoria
    created_at: { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data de criação' },
    updated_at: { type: 'TIMESTAMP', default: 'NOW()', comment: 'Data de atualização' },

    // ⚙️ Status
    is_active: { type: 'BOOLEAN', default: true, comment: 'Registro ativo ou inativo' }
  },

  constraints: {
    unique: ['product_id', 'grade_id'],
    indexes: ['product_id', 'grade_id', 'is_active']
  },

  comment: 'Relaciona produtos às suas grades (cores, tamanhos, etc.), controlando o estoque por variação.'
});
