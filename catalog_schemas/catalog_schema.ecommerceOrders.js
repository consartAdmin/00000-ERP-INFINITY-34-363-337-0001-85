// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.ecommerceOrders.js — Pedidos E-commerce (Cabeçalho)   ║
// ║ CONSART ERP / BH3 E-commerce                                         ║
/* ╚══════════════════════════════════════════════════════════════════════╝ */

export const ECOMMERCE_ORDERS_TABLE = 'public."ecommerceOrders"';

export const ECOMMERCE_ORDERS_SCHEMA = {
  table: ECOMMERCE_ORDERS_TABLE,
  comment: 'Pedidos do e-commerce (cabeçalho) — totais, pagamento Asaas e frete',

  columns: [
    // PK
    { name: 'id',                  type: 'BIGSERIAL', pk: true, notNull: true, comment: 'PK do pedido e-commerce' },

    // Totais
    { name: 'subtotal',            type: 'NUMERIC(12,2)', comment: 'Subtotal dos itens (sem frete/descontos adicionais)' },

    // Datas
    { name: 'created_at',          type: 'TIMESTAMP WITHOUT TIME ZONE', notNull: true, default: 'NOW()', comment: 'Data/hora de criação do pedido' },

    // Integração Asaas
    { name: 'asaas_payment_id',      type: 'VARCHAR(80)', comment: 'ID do pagamento Asaas (payment.id)' },
    { name: 'asaas_invoice_url',     type: 'TEXT',        comment: 'URL do boleto/fatura Asaas' },
    { name: 'asaas_pix_qr_code',     type: 'TEXT',        comment: 'Conteúdo do QRCode PIX (payload)' },
    { name: 'asaas_pix_qr_code_url', type: 'TEXT',        comment: 'URL da imagem do QRCode PIX' },
    { name: 'asaas_billing_type',    type: 'VARCHAR(20)', comment: 'BILLING_TYPE (PIX, BOLETO, CREDIT_CARD, etc.)' },

    // Frete
    { name: 'shipping_value',      type: 'NUMERIC(10,2)', notNull: true, default: '0',     comment: 'Valor do frete aplicado' },
    { name: 'shipping_free',       type: 'BOOLEAN',       notNull: true, default: 'FALSE', comment: 'Indica se frete foi grátis por regra' },
    { name: 'shipping_rule',       type: 'TEXT',          comment: 'Regra de frete aplicada (descrição legível)' },
    { name: 'shipping_service',    type: 'TEXT',          comment: 'Serviço de frete (PAC, SEDEX, MOTOBOY, etc.)' },
    { name: 'shipping_provider',   type: 'TEXT',          comment: 'Provedor/logística (Correios, MelhorEnvio, etc.)' },
  ],

  // Índices recomendados
  indexes: [
    { name: 'idx_ecom_orders_created_at',   on: ['created_at'] },
    { name: 'idx_ecom_orders_asaas_pay_id', on: ['asaas_payment_id'] },
    { name: 'idx_ecom_orders_billing_type', on: ['asaas_billing_type'] },
  ],

  // Campos de busca (para /search genérico)
  search: {
    textFields: [
      { expr: 'asaas_payment_id',        weight: 3 },
      { expr: 'LOWER(asaas_billing_type)', weight: 1 },
      { expr: 'LOWER(shipping_provider)',  weight: 1 },
      { expr: 'LOWER(shipping_service)',   weight: 1 },
      { expr: 'LOWER(shipping_rule)',      weight: 1 },
    ],
    dateFields: ['created_at'],
    // não há status nesse cabeçalho ainda
    statusField: null,
  },

  // Projeção padrão para listagem
  selectProjection: `
    id,
    subtotal,
    created_at,
    asaas_payment_id,
    asaas_invoice_url,
    asaas_pix_qr_code,
    asaas_pix_qr_code_url,
    asaas_billing_type,
    shipping_value,
    shipping_free,
    shipping_rule,
    shipping_service,
    shipping_provider
  `,

  // Aliases de payload (entrada/saída)
  apiPayloadMap: {
    in: {
      subtotal:            ['subtotal'],
      created_at:          ['created_at'],
      asaas_payment_id:    ['asaas_payment_id'],
      asaas_invoice_url:   ['asaas_invoice_url'],
      asaas_pix_qr_code:   ['asaas_pix_qr_code'],
      asaas_pix_qr_code_url: ['asaas_pix_qr_code_url'],
      asaas_billing_type:  ['asaas_billing_type'],

      shipping_value:      ['shipping_value', 'frete', 'valor_frete'],
      shipping_free:       ['shipping_free', 'frete_gratis'],
      shipping_rule:       ['shipping_rule'],
      shipping_service:    ['shipping_service'],
      shipping_provider:   ['shipping_provider'],
    },

    out: {
      // aqui não precisamos de aliases complexos, só devolvemos o próprio row
      // (o mapper genérico deve mesclar row + essas funções se existirem)
    },
  },

  // Campos obrigatórios mínimos (lógica de negócio)
  required: [
    // Em muitos cenários o subtotal pode ser 0 (pedido vazio ainda), então deixo sem required forte.
    // Se você quiser travar, é só adicionar: 'subtotal'
  ],

  // Colunas permitidas em INSERT/UPDATE (whitelist)
  upsertColumns: [
    'subtotal',
    'created_at',
    'asaas_payment_id',
    'asaas_invoice_url',
    'asaas_pix_qr_code',
    'asaas_pix_qr_code_url',
    'asaas_billing_type',
    'shipping_value',
    'shipping_free',
    'shipping_rule',
    'shipping_service',
    'shipping_provider',
  ],
};

export default ECOMMERCE_ORDERS_SCHEMA;
