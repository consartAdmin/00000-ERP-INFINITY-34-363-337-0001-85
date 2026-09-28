// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.units.js — Tabela de Unidades (CONSART ERP)                ║
// ║ Define estrutura base da tabela `units`                                   ║
// ║ Utilizada para cadastro e vinculação de múltiplas unidades por produto.   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const UNITS_SCHEMA = Object.freeze({
  table: 'units',
  alias: 'u',

  columns: {
    // 🧱 Identificação principal
    unit_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único da unidade'
    },

    // 🧾 Informações principais
    unit: {
      type: 'VARCHAR(50)',
      notNull: true,
      unique: true,
      comment: 'Código ou sigla da unidade (ex: UN, CX, PC)'
    },

    description: {
      type: 'VARCHAR(100)',
      comment: 'Descrição completa da unidade (ex: Unidade, Caixa com 12, Peça, etc.)'
    },

    fator: {
      type: 'NUMERIC(10,2)',
      default: '1.00',
      notNull: true,
      comment: 'Fator multiplicador em relação à unidade base'
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
      comment: 'Data da última atualização'
    },

    is_active: {
      type: 'BOOLEAN',
      default: true,
      comment: 'Indica se a unidade está ativa para uso no sistema'
    }
  }
});
