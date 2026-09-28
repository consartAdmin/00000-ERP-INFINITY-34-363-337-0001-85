// ╔════════════════════════════════════════════════════════════════════╗
// ║ schema_catalog.pdvSales.js — Catálogo da Tabela pdvSales          ║
// ║ CONSART ERP | PDV (Cabeçalho das vendas NFC-e)                    ║
// ║                                                                    ║
// ║ Tabela real: public."pdvSales"                                     ║
// ║ Chave primária: sale_id (BIGINT / BIGSERIAL)                       ║
// ║ Relacionamento: "pdvSalesItems".sale_id → "pdvSales".sale_id       ║
// ╚════════════════════════════════════════════════════════════════════╝

export const PDV_SALES_TABLE = 'public."pdvSales"';

export const pdvSalesSchema = {
  schema: 'public',
  tableName: 'pdvSales',
  fullTableName: PDV_SALES_TABLE,
  description:
    'Cabeçalho das vendas de PDV (NFC-e). Uma linha por venda/ cupom fiscal.',

  columns: [
    {
      name: 'sale_id',
      type: 'bigint',
      isPrimaryKey: true,
      isNullable: false,
      hasDefault: true,
      default:
        "nextval('pdv_sales_sale_id_seq'::regclass)",
      notes: 'Identificador da venda PDV (PK).'
    },
    {
      name: 'status',
      type: 'varchar(20)',
      isNullable: false,
      hasDefault: true,
      default: "'ABERTA'::character varying",
      notes: "Status interno da venda (ex.: 'ABERTA', 'FECHADA', 'CANCELADA')."
    },
    {
      name: 'terminal_id',
      type: 'varchar(50)',
      isNullable: true,
      notes: 'Identificação do terminal/caixa (ex.: CAIXA_01).'
    },
    {
      name: 'operator_id',
      type: 'varchar(50)',
      isNullable: true,
      notes: 'Identificação lógica do operador/usuário do PDV.'
    },
    {
      name: 'customer_name',
      type: 'text',
      isNullable: true,
      notes: 'Nome do cliente informado na venda (geralmente CONSUMIDOR FINAL).'
    },
    {
      name: 'customer_tax_id',
      type: 'varchar(20)',
      isNullable: true,
      notes: 'CPF/CNPJ do cliente quando informado.'
    },
    {
      name: 'recebido',
      type: 'numeric(14,2)',
      isNullable: true,
      notes: 'Valor total recebido em dinheiro/cartão/PIX (soma dos pagamentos).'
    },
    {
      name: 'troco',
      type: 'numeric(14,2)',
      isNullable: true,
      notes: 'Valor de troco devolvido ao cliente.'
    },
    {
      name: 'pagamento',
      type: 'varchar(30)',
      isNullable: true,
      notes: 'Resumo/texto do meio de pagamento principal (ex.: DINHEIRO, CARTAO).'
    },
    {
      name: 'pagamentos_json',
      type: 'jsonb',
      isNullable: true,
      notes:
        'Detalhamento estruturado dos pagamentos. Ex.: [{ amount, method }].'
    },
    {
      name: 'id_integracao',
      type: 'varchar(100)',
      isNullable: true,
      notes:
        'ID de integração usado para correlacionar PDV ↔ NFC-e / TecnoSpeed / PlugNotas.'
    },
    {
      name: 'created_at',
      type: 'timestamptz',
      isNullable: false,
      hasDefault: true,
      default: 'now()',
      notes: 'Data/hora de criação da venda.'
    },
    {
      name: 'updated_at',
      type: 'timestamptz',
      isNullable: false,
      hasDefault: true,
      default: 'now()',
      notes: 'Data/hora da última atualização (pode ter trigger de updated_at).'
    },
    {
      name: 'nfce_status',
      type: 'varchar(20)',
      isNullable: false,
      hasDefault: true,
      default: "'PENDENTE'::character varying",
      notes:
        "Status da NFC-e na SEFAZ (ex.: 'PENDENTE', 'AUTORIZADA', 'REJEITADA', 'CANCELADA')."
    },
    {
      name: 'nfce_id',
      type: 'varchar(100)',
      isNullable: true,
      notes: 'ID interno retornado pela TecnoSpeed/PlugNotas para esta NFC-e.'
    },
    {
      name: 'nfce_key',
      type: 'varchar(60)',
      isNullable: true,
      notes: 'Chave de acesso da NFC-e (44 dígitos).'
    },
    {
      name: 'nfce_number',
      type: 'varchar(20)',
      isNullable: true,
      notes: 'Número da NFC-e / número do cupom fiscal.'
    },
    {
      name: 'nfce_protocol',
      type: 'varchar(80)',
      isNullable: true,
      notes: 'Protocolo de autorização retornado pela SEFAZ.'
    },
    {
      name: 'nfce_environment',
      type: 'varchar(20)',
      isNullable: true,
      notes: "Ambiente de emissão (ex.: 'homologacao', 'producao')."
    },
    {
      name: 'nfce_pdf_url',
      type: 'text',
      isNullable: true,
      notes: 'URL do PDF da NFC-e retornado pela TecnoSpeed/PlugNotas.'
    },
    {
      name: 'nfce_xml_url',
      type: 'text',
      isNullable: true,
      notes: 'URL do XML da NFC-e retornado pela TecnoSpeed/PlugNotas.'
    },
    {
      name: 'nfce_integration_id',
      type: 'text',
      isNullable: true,
      notes:
        'ID alternativo de integração (separado de nfce_id) – pode guardar GUID externo.'
    }
  ],

  primaryKey: {
    name: 'pdv_sales_pkey',
    columns: ['sale_id']
  },

  foreignKeys: [
    {
      name: 'pdvSalesItems_sale_id_fkey',
      table: 'pdvSalesItems',
      column: 'sale_id',
      referencesTable: 'pdvSales',
      referencesColumn: 'sale_id',
      onDelete: 'CASCADE',
      notes: 'Cada item da venda (pdvSalesItems) pertence a um cabeçalho em pdvSales.'
    }
  ],

  indexes: [
    {
      name: 'pdv_sales_pkey',
      type: 'btree',
      columns: ['sale_id'],
      isUnique: true
    }
    // Se você criar mais índices (por status, nfce_key, id_integracao, etc.),
    // pode documentar aqui.
  ]
};

export default pdvSalesSchema;
