// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.ordersLogistics.js — Logística de Pedidos (CONSART ERP)    ║
// ║ Estrutura base da tabela `ordersLogistics`                                 ║
// ║ Controla picking → conferência cega → embalagem → expedição.              ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const ORDERS_LOGISTICS_SCHEMA = Object.freeze({
  table: 'ordersLogistics',
  alias: 'ol',

  columns: {
    // 🧱 Identificação principal
    logistics_id: {
      type: 'SERIAL',
      pk: true,
      comment: 'Identificador único do processo logístico'
    },

    order_id: {
      type: 'INTEGER',
      notNull: true,
      references: 'orders(order_id)',
      onDelete: 'CASCADE',
      comment: 'Relação direta com o pedido original'
    },

    // 📦 Status logístico geral
    status: {
      type: 'VARCHAR(50)',
      notNull: true,
      default: `'AGUARDANDO_SEPARACAO'`,
      comment: 'Status atual da logística (picking, conferência, expedição, etc.)'
    },

    // 👤 Responsáveis por etapa
    picker_user_id: {
      type: 'INTEGER',
      comment: 'Usuário responsável pela separação (picking)'
    },

    checker_user_id: {
      type: 'INTEGER',
      comment: 'Usuário responsável pela conferência cega'
    },

    packer_user_id: {
      type: 'INTEGER',
      comment: 'Usuário responsável pela embalagem'
    },

    shipper_user_id: {
      type: 'INTEGER',
      comment: 'Usuário responsável pela expedição'
    },

    // 📍 Picking
    picking_started_at: {
      type: 'TIMESTAMP',
      comment: 'Data/hora de início da separação'
    },

    picking_finished_at: {
      type: 'TIMESTAMP',
      comment: 'Data/hora de término da separação'
    },

    // 🔎 Conferência Cega
    checking_started_at: {
      type: 'TIMESTAMP',
      comment: 'Data/hora de início da conferência cega'
    },

    checking_finished_at: {
      type: 'TIMESTAMP',
      comment: 'Data/hora de término da conferência cega'
    },

    // 📦 Embalagem
    packing_started_at: {
      type: 'TIMESTAMP',
      comment: 'Data/hora em que a embalagem iniciou'
    },

    packing_finished_at: {
      type: 'TIMESTAMP',
      comment: 'Data/hora em que a embalagem foi concluída'
    },

    // 🚚 Expedição
    shipping_method: {
      type: 'VARCHAR(50)',
      comment: 'Método de envio (Correios, Transportadora, Retirada, etc.)'
    },

    shipping_code: {
      type: 'VARCHAR(200)',
      comment: 'Código de rastreio do envio'
    },

    shipping_date: {
      type: 'TIMESTAMP',
      comment: 'Data/hora em que o pedido foi expedido'
    },

    shipping_obs: {
      type: 'TEXT',
      comment: 'Observações gerais sobre a expedição'
    },

    // 📄 NF — usada para iniciar conferência cega via leitura do código de barras
    nfe_key: {
      type: 'VARCHAR(60)',
      comment: 'Chave de acesso NF-e/NFC-e (44 dígitos)'
    },

    nf_number: {
      type: 'INTEGER',
      comment: 'Número da nota fiscal'
    },

    nf_series: {
      type: 'VARCHAR(10)',
      comment: 'Série da nota fiscal'
    },

    // 👁️‍🗨️ Controle da Conferência Cega
    blind_check_enabled: {
      type: 'BOOLEAN',
      notNull: true,
      default: true,
      comment: 'Define se a conferência cega está habilitada'
    },

    blind_check_status: {
      type: 'VARCHAR(30)',
      default: `'PENDENTE'`,
      comment: 'PENDENTE | EM_ANDAMENTO | OK | DIVERGENCIA'
    },

    has_discrepancy: {
      type: 'BOOLEAN',
      default: false,
      comment: 'Indica se houve divergências na conferência cega'
    },

    discrepancy_note: {
      type: 'TEXT',
      comment: 'Descrição da divergência encontrada'
    },

    // 🕓 Auditoria
    created_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Data de criação do registro'
    },

    updated_at: {
      type: 'TIMESTAMP',
      default: 'NOW()',
      comment: 'Última atualização do registro'
    }
  }
});
