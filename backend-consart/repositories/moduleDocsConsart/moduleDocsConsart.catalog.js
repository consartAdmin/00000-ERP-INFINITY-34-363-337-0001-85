// ╔════════════════════════════════════════════════════════════════════╗
// ║ moduleDocsConsart.catalog.js — Textos comerciais do ERP Infinity   ║
// ║ Usados pelo "Importar do ERP Infinity" para preencher a descrição ║
// ║ e as funções dos itens que ainda estão vazios (status "Revisar"). ║
// ║                                                                    ║
// ║ SCREENS: chave = pasta da tela no endereço do menu                 ║
// ║   ("../budgets/budgets.html" → "budgets")                          ║
// ║ GROUPS:  chave = nome do módulo/submenu sem ícone, acento e "▹"    ║
// ║                                                                    ║
// ║ Telas internas (ferramentas de TI, itens só da BH3, módulos        ║
// ║ desativados) ficam de fora de propósito: continuam "Pendente" e    ║
// ║ não aparecem no Catálogo comercial.                                ║
// ╚════════════════════════════════════════════════════════════════════╝

const s = (description, ...functions) => ({ description, functions });

export const SCREENS = Object.freeze({
  // ── Início ────────────────────────────────────────────────────────
  home: s('Painel de entrada com os números que importam: vendas, financeiro e estoque assim que o usuário entra no sistema.',
    'Painéis de vendas, contas a pagar e a receber', 'Período ajustável (dia, mês, ano)', 'Cada usuário vê só os painéis liberados para ele', 'Avisos de reposição e melhor data de compra'),

  // ── Clientes ──────────────────────────────────────────────────────
  customersList: s('Lista completa da carteira de clientes, com busca rápida e filtros por status e segmento.',
    'Busca por nome, CNPJ/CPF, cidade ou código', 'Filtros por status, segmento e vendedor', 'Acesso direto ao cadastro e aos orçamentos do cliente', 'Exportação da lista'),
  customersRegistration: s('Cadastro de clientes com consulta automática dos dados pelo CNPJ e endereço pelo CEP.',
    'Preenchimento automático por CNPJ e CEP', 'Dados fiscais (IE, regime, contribuinte)', 'Contatos, endereços de entrega e observações', 'Vínculo com vendedor, segmento e tabela de preço'),
  customersEdit: s('Edição dos dados de clientes já cadastrados, com histórico preservado.',
    'Alteração de dados cadastrais e fiscais', 'Ativar ou inativar cliente', 'Atualização de contatos e endereços'),
  customerStatusTypes: s('Status personalizados para classificar a carteira (ativo, prospect, inadimplente etc.).',
    'Cadastro de status com cor', 'Uso nos filtros de clientes e no CRM'),
  customerActivity: s('Acompanhamento do relacionamento com cada cliente: visitas, ligações e próximos passos.',
    'Registro de atividades por cliente', 'Agenda de retornos', 'Histórico completo do relacionamento'),
  customerSegments: s('Segmentação da carteira por ramo de atividade para campanhas e análise de vendas.',
    'Cadastro de segmentos e subsegmentos', 'Relatórios de venda por segmento'),
  customerTrainings: s('Controle dos treinamentos realizados com cada cliente.',
    'Registro de treinamentos por cliente', 'Datas, participantes e conteúdo', 'Histórico para pós-venda'),
  customersSegmentsBatch: s('Ajuste de segmento de vários clientes de uma só vez.',
    'Seleção de clientes por filtro', 'Troca de segmento em lote'),

  // ── Produtos ──────────────────────────────────────────────────────
  products: s('Catálogo de produtos com busca, estoque e preço na mesma tela.',
    'Busca por nome, código, referência ou código de barras', 'Estoque atual e preço de venda', 'Edição completa com unidades, grades, imagens e fiscal', 'Filtros por grupo, fabricante e status'),
  createProduct: s('Cadastro de novos produtos com todos os dados comerciais, de estoque e fiscais.',
    'Unidades de compra e venda com conversão', 'Código de barras, grade e lote', 'Dados fiscais (NCM, CST, CFOP)', 'Imagens do produto'),
  editProducts: s('Edição completa do produto em abas: dados gerais, unidades, preços, estoque e fiscal.',
    'Unidades e códigos de barras', 'Grades e lotes com validade', 'Imagens', 'Dados fiscais'),
  labels: s('Impressão de etiquetas de produto com código de barras.',
    'Etiquetas por produto ou em lote', 'Código de barras e preço', 'Modelos configuráveis'),
  labelParameters: s('Configuração do layout das etiquetas de produto.',
    'Tamanho, margens e colunas', 'Campos que aparecem na etiqueta'),
  productsImagens: s('Galeria de imagens dos produtos para catálogo, orçamento e e-commerce.',
    'Envio de várias imagens por produto', 'Imagem principal', 'Uso no orçamento e no PDF'),
  prices: s('Tabelas de preço por cliente, região ou canal de venda.',
    'Várias tabelas de preço', 'Preço por produto e unidade', 'Vínculo da tabela ao cliente e ao orçamento'),
  locationsBarCode: s('Etiquetas com código de barras para os endereços do depósito.',
    'Etiqueta por rua, prateleira e posição', 'Leitura no inventário e na separação'),
  labelPrintConfig: s('Configuração do layout das etiquetas de localização.',
    'Tamanho e campos da etiqueta', 'Pré-visualização antes de imprimir'),
  manufacturesOrders: s('Ordens de compra para fornecedores e fabricantes.',
    'Pedido de compra por fornecedor', 'Itens, quantidades e prazos', 'Acompanhamento até a entrada da nota'),
  productsKits: s('Montagem de kits a partir de produtos do estoque.',
    'Kit com vários produtos e quantidades', 'Venda do kit como um item só', 'Baixa automática dos componentes'),

  // ── Ajustes em lote ───────────────────────────────────────────────
  productsFiscalBatch: s('Aplica a tributação correta em muitos produtos de uma vez.',
    'Seleção de produtos por filtro', 'Vínculo da classificação fiscal em lote', 'Conferência antes de gravar'),
  batchProductsPrices: s('Reajuste de preços de vários produtos de uma vez.',
    'Reajuste por percentual ou valor', 'Filtro por grupo, fabricante ou tabela', 'Prévia antes de aplicar'),
  groupsAndSubgroupsBatch: s('Troca de grupo e subgrupo de vários produtos de uma só vez.',
    'Seleção por filtro', 'Novo grupo, subgrupo e família em lote'),
  productsActiveBatch: s('Ativa ou inativa muitos produtos em uma só operação.',
    'Seleção por filtro', 'Ativar ou inativar em lote'),
  productsLocationsBatch: s('Define a localização de vários produtos no depósito de uma vez.',
    'Seleção de produtos', 'Endereço do depósito em lote'),

  // ── Cadastros secundários ─────────────────────────────────────────
  grades: s('Grades de tamanhos, cores e variações dos produtos.',
    'Cadastro de grades e opções', 'Estoque por variação'),
  units: s('Unidades de medida usadas na compra e na venda (UN, CX, KG, FD...).',
    'Cadastro de unidades', 'Fator de conversão entre unidades'),
  productBarCodeSecond: s('Códigos de barras adicionais para o mesmo produto.',
    'Vários códigos por produto e unidade', 'Leitura em vendas, entradas e inventário'),
  groupsAndSubgroups: s('Organização do catálogo em grupos, subgrupos e famílias.',
    'Até três níveis de classificação', 'Uso nos filtros, relatórios e reajustes'),
  suppliers: s('Cadastro de fornecedores com dados fiscais e contatos.',
    'Preenchimento por CNPJ', 'Contatos e condições de compra', 'Histórico de notas de entrada'),
  manufacturers: s('Cadastro de fabricantes e marcas dos produtos.',
    'Cadastro de fabricantes', 'Filtro de produtos e relatórios por marca'),

  // ── Cadastros fiscais ─────────────────────────────────────────────
  productsFiscal: s('Vínculo fiscal de cada produto: NCM, CEST, origem e tributação.',
    'NCM, CEST e origem da mercadoria', 'Classificação fiscal por produto', 'Base para NF-e, NFC-e e apuração'),
  fiscalClassification: s('Regras de tributação (CST, CFOP, alíquotas) reaproveitadas em vários produtos.',
    'ICMS, ICMS-ST, IPI, PIS e COFINS', 'CFOP por operação', 'Uma regra para muitos produtos'),
  classificacaoFiscal: s('Regras de tributação (CST, CFOP, alíquotas) reaproveitadas em vários produtos.',
    'ICMS, ICMS-ST, IPI, PIS e COFINS', 'CFOP por operação', 'Uma regra para muitos produtos'),
  fiscalProfile: s('Perfis fiscais por tipo de operação e de cliente.',
    'Perfil por operação (venda, devolução, bonificação)', 'Regras por UF e tipo de cliente'),
  nfeOperationTypes: s('Tipos de operação fiscal usados na emissão das notas.',
    'Natureza da operação e CFOP padrão', 'Uso na emissão da NF-e'),
  taxRegimes: s('Regimes tributários da empresa e dos parceiros.',
    'Simples Nacional, Lucro Presumido e Real', 'Uso no cálculo de impostos'),

  // ── Estoque ───────────────────────────────────────────────────────
  inboundInvoices: s('Entrada de notas fiscais de compra pela importação do XML do fornecedor.',
    'Importação do XML da NF-e', 'Cadastro rápido de produto novo na própria entrada', 'Conversão de unidade e lote', 'Entrada automática no estoque e no contas a pagar'),
  expenseEntries: s('Lançamento de notas de despesa (serviços, consumo) com anexos que vão para o Caixa.',
    'Despesas com fornecedor e categoria', 'Anexo da nota e do comprovante', 'Integração com o Caixa'),
  inventory: s('Inventário de estoque pelo computador, com custo unitário e total.',
    'Contagem por produto, lote e localização', 'Cadastro rápido de unidade, lote e localização', 'Custo unitário e total da contagem', 'Ajuste automático do estoque'),
  inventoryMobile: s('Inventário pelo celular ou coletor, lendo o código de barras.',
    'Leitura de código de barras pela câmera ou coletor', 'Contagem por localização', 'Envio direto para o inventário'),
  productsMobile: s('Consulta de produtos pelo celular, com estoque e preço.',
    'Busca por código de barras', 'Estoque e preço na hora'),
  productsLocations: s('Endereçamento dos produtos no depósito (rua, prateleira, posição).',
    'Localização por produto', 'Busca do produto pelo endereço', 'Uso na separação e no inventário'),
  locations: s('Cadastro dos endereços do depósito.',
    'Ruas, prateleiras e posições', 'Cadastro em lote', 'Etiquetas de localização'),
  productsStock: s('Estoque mínimo e máximo por produto, com alerta de reposição.',
    'Mínimo e máximo por produto', 'Lista do que precisa comprar', 'Sugestão de quantidade de compra'),
  productsStockLots: s('Controle de estoque por lote e validade.',
    'Estoque separado por lote', 'Data de validade e alertas de vencimento', 'Rastreabilidade na venda'),
  conciliationSalesxStock: s('Auditoria do estoque que explica cada diferença entre entradas e saídas.',
    'Entradas, saídas, ajustes e inventários por produto', 'Alerta de saltos sem movimento', 'Estoque calculado x estoque atual'),

  // ── Fiscal ────────────────────────────────────────────────────────
  invoicesIssued: s('Emissão e consulta das NF-e, com DANFE e envio ao cliente.',
    'Emissão da NF-e a partir do pedido', 'DANFE em PDF e XML', 'Envio por e-mail ao cliente', 'Consulta da situação na SEFAZ'),
  nfeInutilizarEvents: s('Inutilização de numeração de NF-e não usada, direto na SEFAZ.',
    'Inutilização por faixa de números', 'Protocolo e histórico'),
  nfeCce: s('Carta de Correção Eletrônica para corrigir dados da NF-e já autorizada.',
    'Emissão da CC-e', 'PDF da carta', 'Histórico de correções por nota'),
  cancelarNfe: s('Cancelamento de NF-e dentro do prazo legal.',
    'Cancelamento com justificativa', 'Protocolo da SEFAZ', 'Estorno do estoque'),
  nfeInbox: s('Recebe automaticamente as notas emitidas contra o CNPJ da empresa.',
    'Busca automática das NF-e na SEFAZ', 'Manifestação do destinatário direto na lista', 'Download do XML para dar entrada'),
  usoConsumo: s('Saída de material para uso e consumo interno com a nota correta.',
    'Seleção dos itens e quantidades', 'Emissão da nota de uso e consumo', 'Baixa do estoque'),
  supplierReturns: s('Devolução de mercadoria ao fornecedor a partir da nota de entrada.',
    'Seleção dos itens da entrada', 'Emissão da NF-e de devolução', 'Baixa do estoque'),
  painelNfce: s('Painel das NFC-e emitidas no PDV.',
    'Situação de cada cupom fiscal', 'Reenvio e consulta na SEFAZ', 'XML e DANFE NFC-e'),
  empresaFiscal: s('Dados fiscais da empresa emitente.',
    'Certificado digital', 'Série e numeração das notas', 'Regime tributário'),
  parametrosFiscais: s('Parâmetros fiscais gerais usados na emissão.',
    'Padrões de CFOP e CST', 'Ambiente de produção ou homologação'),
  certificado: s('Gerenciamento do certificado digital A1 da empresa.',
    'Envio do certificado', 'Aviso de vencimento'),

  // ── Transportadoras / logística ───────────────────────────────────
  transporters: s('Cadastro de transportadoras e vínculo com os pedidos e notas.',
    'Cadastro por CNPJ', 'Transportadora no pedido e na NF-e'),
  OrdersLogisticsPacking: s('Separação e conferência dos pedidos antes do despacho.',
    'Lista de separação por pedido', 'Conferência por código de barras', 'Volumes e peso'),
  deliveryLabels: s('Etiquetas de entrega para os volumes despachados.',
    'Etiqueta com cliente, endereço e nota', 'Impressão por pedido ou em lote'),
  nfeReceipts: s('Canhoto digital: comprovante de entrega assinado no celular.',
    'Assinatura do recebedor na tela', 'Foto da entrega', 'Vínculo com a NF-e'),
  nfeReceiptsList: s('Relação dos canhotos de entrega digitais.',
    'Consulta por data, cliente e nota', 'Entregas pendentes e concluídas'),
  ordersLogisticsSignature: s('Assinatura digital do recebimento dos pedidos.',
    'Assinatura na tela', 'Comprovante vinculado ao pedido'),
  deliveryRoutes: s('Roteiros de entrega por região e motorista.',
    'Montagem das rotas', 'Pedidos por rota'),
  deliveryTrips: s('Viagens de entrega e controle dos motoristas.',
    'Viagem com pedidos e motorista', 'Saída e retorno', 'Situação de cada entrega'),
  logistics: s('Conferência cega dos volumes na logística.',
    'Conferência sem mostrar a quantidade esperada', 'Divergências destacadas'),

  // ── Vendas ────────────────────────────────────────────────────────
  budgets: s('Orçamentos rápidos com a tabela de preço do cliente e a margem antes de fechar a venda.',
    'Busca de produtos por nome, código ou código de barras', 'Tabela de preço, desconto e lote por item', 'Rentabilidade com os impostos já calculados', 'Envio por e-mail e PDF com a marca da empresa', 'Copiar orçamento e transformar em pedido'),
  orders: s('Acompanhamento dos pedidos do fechamento ao faturamento.',
    'Pedido gerado a partir do orçamento', 'Situação de cada pedido', 'Emissão da NF-e direto do pedido', 'Baixa automática do estoque'),
  ordersKanban: s('Quadro Kanban dos pedidos: cada coluna é uma etapa, basta arrastar o cartão.',
    'Colunas por etapa do pedido', 'Arrastar e soltar (também no tablet)', 'Visão rápida do que está parado'),
  crmDeals: s('Funil de vendas (CRM) com negociações em cartões e histórico do cliente.',
    'Negociações por etapa do funil', 'Contatos e atividades registrados', 'Valor previsto e probabilidade', 'Arrastar cartões entre etapas'),
  crmDealsPerformance: s('Desempenho do funil de vendas por vendedor e etapa.',
    'Conversão por etapa', 'Ranking de vendedores'),
  iaBudgets: s('Sugere o que oferecer a cada cliente com base no que ele já comprou.',
    'Histórico de compras do cliente', 'Sugestão de itens e quantidades', 'Orçamento pronto em poucos cliques'),
  sellers: s('Cadastro da equipe de vendas.',
    'Vendedores internos e externos', 'Comissão padrão', 'Metas e carteira'),
  sellerByUser: s('Vínculo de cada usuário do sistema ao seu vendedor.',
    'Usuário x vendedor', 'Orçamentos e pedidos saem no nome certo'),
  priceCommissions: s('Regras de comissão por produto, grupo ou faixa de preço.',
    'Comissão por produto ou grupo', 'Faixas por desconto concedido', 'Relatório em PDF e Excel'),
  salesReport: s('Relatório de vendas por período, vendedor, cliente e produto.',
    'Filtros por período, vendedor e cliente', 'Totais e gráficos', 'PDF e Excel'),
  salesCommissionsFromInvoices: s('Comissão dos vendedores calculada a partir das notas emitidas.',
    'Comissão por vendedor e período', 'Detalhe por nota e item', 'PDF para pagamento'),
  salesPerformance: s('Desempenho de vendas com comparação entre períodos.',
    'Vendas por vendedor e período', 'Comparativo com o período anterior'),
  pdvSalesReport: s('Relatório das vendas feitas no PDV (balcão).',
    'Vendas por dia, operador e forma de pagamento', 'Totais do caixa'),
  salesDashboard: s('Painel de vendas em tela cheia para acompanhar o dia.',
    'Indicadores em tempo real', 'Ideal para TV na área comercial'),
  betterDateToBuy: s('Indica a melhor data para comprar cada produto com base no histórico.',
    'Histórico de compras pelas NF-e', 'Giro do produto', 'Sugestão de data e quantidade'),
  reportsProductsStock: s('Posição do estoque atual com quantidade e valor.',
    'Estoque por produto, grupo e localização', 'Valor pelo custo', 'Resumo e PDF'),
  rentabilidade: s('Margem real de cada venda já descontando os impostos.',
    'Custo, impostos e margem por item', 'Alerta de venda abaixo da margem'),

  // ── Financeiro ────────────────────────────────────────────────────
  accountsPayable: s('Todos os compromissos da empresa num só lugar, com vencimentos e comprovantes.',
    'Títulos e parcelas por fornecedor', 'Baixa em lote de vários títulos', 'Anexo de boleto e comprovante', 'Filtro por grupo e plano de contas'),
  accountsReceivable: s('Quem deve, quanto e quando, com recebimento por boleto ou PIX.',
    'Recebimentos por cliente e vencimento', 'Edição e baixa em lote', 'Vínculo com cliente e nota', 'Anexos'),
  accountsReceivableReports: s('Relatórios de contas a receber e recebimentos.',
    'Recebido x a receber por período', 'Inadimplência por cliente', 'PDF e Excel'),
  banks: s('Cadastro dos bancos usados pela empresa.',
    'Código e nome do banco'),
  bankAccounts: s('Contas bancárias da empresa.',
    'Agência, conta e saldo inicial', 'Uso no Caixa e nas baixas'),
  bankAccountsBalance: s('Saldos de todas as contas bancárias numa só tela.',
    'Saldo atual por conta', 'Posição consolidada'),
  expenses: s('Gestão das despesas fixas e variáveis da empresa.',
    'Despesas por categoria', 'Recorrência mensal', 'Geração no contas a pagar'),
  fixedExpenses: s('Despesas fixas mensais da empresa.',
    'Cadastro com valor e vencimento', 'Lançamento automático todo mês'),
  mobilized: s('Controle dos bens da empresa (imobilizado).',
    'Cadastro de bens com valor', 'Localização e responsável'),
  debts: s('Controle de débitos e parcelamentos (empréstimos, impostos parcelados).',
    'Parcelas e saldo devedor', 'Integração com o contas a pagar'),
  cashMoviments: s('Entradas e saídas do dia a dia com categorias e relatório pronto para o contador.',
    'Lançamento individual ou em lote', 'Transferência entre contas', 'Anexos e vínculo com notas', 'Relatório em PDF e ZIP com anexos'),
  caixaCategories: s('Categorias das movimentações de caixa.',
    'Categorias de entrada e saída', 'Vínculo com o plano de contas'),
  cashDocumentTypes: s('Tipos de documento usados no Caixa.',
    'Nota, recibo, boleto e outros'),
  accountReleases: s('Lançamentos contábeis e financeiros manuais.',
    'Débito e crédito por conta', 'Histórico'),
  cobrancas: s('Integração com o Asaas para boletos e PIX com baixa automática.',
    'Emissão de boleto e PIX', 'Baixa automática no contas a receber', 'Envio da cobrança ao cliente'),
  paymentMethods: s('Formas de pagamento aceitas nas vendas.',
    'Dinheiro, cartão, PIX, boleto e prazo', 'Uso no orçamento, pedido e PDV'),

  // ── Contábil ──────────────────────────────────────────────────────
  salesTaxCalculation: s('Cálculo dos impostos das vendas do período.',
    'ICMS, ICMS-ST, IPI, PIS e COFINS', 'Conferência por nota e item'),
  fiscalApuracao: s('Apuração dos impostos do período com dashboards.',
    'Débitos e créditos por imposto', 'Saldo a recolher', 'Gráficos por período'),
  spedFiscal: s('Geração do arquivo SPED Fiscal validado no PVA.',
    'Arquivo EFD ICMS/IPI', 'Validação antes de enviar'),
  enterprise: s('Dados das empresas do grupo.',
    'Razão social, CNPJ e endereço', 'Logo usado nos PDFs'),
  chartOfAccounts: s('Plano de contas contábil e gerencial.',
    'Estrutura em níveis', 'Vínculo com Caixa e contas a pagar'),
  dreGerencial: s('DRE gerencial: resultado da empresa por período.',
    'Receitas, custos e despesas', 'Lucro por mês', 'Comparativo entre períodos'),
  balancoPatrimonial: s('Balanço patrimonial da empresa.',
    'Ativo, passivo e patrimônio', 'Posição em qualquer data'),

  // ── RH ────────────────────────────────────────────────────────────
  employees: s('Ficha completa dos colaboradores.',
    'Dados pessoais e documentos', 'Benefícios e experiência', 'Endereço e contatos', 'Relatórios'),
  employeesDepartments: s('Departamentos da empresa.',
    'Cadastro de departamentos', 'Colaboradores por departamento'),
  employeesPositions: s('Cargos e funções da empresa.',
    'Cadastro de cargos', 'Uso na ficha do colaborador'),
  payrollCharges: s('Encargos trabalhistas e cálculo de rescisão.',
    'Encargos sobre a folha', 'Simulação de rescisão'),

  // ── Configurações ─────────────────────────────────────────────────
  users: s('Usuários do sistema e seus acessos.',
    'Cadastro de usuários', 'Perfil e módulos liberados', 'Bloqueio de acesso'),
  userModules: s('Escolha das telas que cada usuário pode abrir.',
    'Liberação por tela', 'Cópia de acessos de outro usuário'),
  accessProfiles: s('Perfis de acesso (vendedor, financeiro, gerente...).',
    'Cadastro de perfis', 'Telas liberadas por perfil'),
  usersProfile: s('Vínculo dos usuários aos perfis de acesso.',
    'Perfil por usuário', 'Mudança de perfil em um clique'),
  usersDashboardAccess: s('Quais painéis da tela inicial cada usuário vê.',
    'Painéis por usuário', 'Cópia de outro usuário'),
  emailAccounts: s('Contas de e-mail usadas para enviar orçamentos, notas e cobranças.',
    'Configuração SMTP', 'Teste de envio'),
  userEmailAccounts: s('Vínculo de cada usuário à conta de e-mail que ele usa.',
    'E-mail de envio por usuário'),
  appFeatures: s('Funcionalidades e opções do sistema liberadas por empresa.',
    'Ligar e desligar recursos', 'Opções por funcionalidade'),
  segmentsAndSubSegments: s('Segmentos e subsegmentos de mercado.',
    'Cadastro em dois níveis', 'Uso em clientes e relatórios'),
});

export const GROUPS = Object.freeze({
  'gestao erp': s('O coração do ERP: clientes, produtos, estoque, compras e fiscal.'),
  clientes: s('Tudo sobre a carteira de clientes: cadastro, status, segmentos e relacionamento.'),
  produtos: s('Catálogo de produtos, preços, etiquetas e kits.'),
  'ajustes em lote': s('Alterações em massa para ganhar tempo: preços, grupos, fiscal e status.'),
  'cadastros secundarios': s('Cadastros de apoio: grades, unidades, grupos, códigos de barras.'),
  'cadastros fiscais': s('Tributação dos produtos sem dor de cabeça.'),
  'compras / parceiros': s('Fornecedores e fabricantes num só lugar.'),
  estoque: s('Entradas, inventário, lotes, localização e reposição.'),
  fiscal: s('NF-e, eventos fiscais e notas recebidas.'),
  transportadoras: s('Transportadoras e frete.'),
  vendas: s('Orçamentos, pedidos, CRM, equipe e relatórios de venda.'),
  operacao: s('O dia a dia da venda: orçamento, pedido, Kanban e CRM.'),
  equipe: s('Vendedores, vínculo com usuários e comissões.'),
  relatorios: s('Relatórios de vendas, estoque, compras, financeiro e contábil.'),
  logistica: s('Separação, despacho, entregas e canhoto digital.'),
  financeiro: s('Contas a pagar e a receber, Caixa, bancos e cobrança.'),
  despesas: s('Despesas, bens e parcelamentos.'),
  'movimentacoes de caixa': s('Caixa do dia a dia e suas categorias.'),
  cobranca: s('Boletos e PIX com baixa automática.'),
  contabilidade: s('Impostos, SPED, plano de contas e DRE.'),
  impostos: s('Cálculo e apuração de impostos e SPED Fiscal.'),
  'r.h': s('Colaboradores, departamentos, cargos e encargos.'),
  rh: s('Colaboradores, departamentos, cargos e encargos.'),
  configuracoes: s('Usuários, acessos, e-mail e parâmetros do sistema.'),
  'usuarios e acessos': s('Quem acessa o quê no sistema.'),
  'e-mail': s('Contas de e-mail do sistema.'),
  sistema: s('Parâmetros gerais do sistema.'),
  'cadastros auxiliares': s('Cadastros de apoio: usuários, perfis, formas de pagamento, vendedores e e-mail.'),
});

/** "../budgets/budgets.html" → "budgets" (pasta da tela) */
export function screenKey(path) {
  const parts = String(path || '').split('?')[0].split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/** "📦 Ajustes em Lote ▹" → "ajustes em lote" */
export function groupKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s./-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Texto comercial do item do menu (ou null quando é interno / sem texto) */
export function catalogTextFor({ path, name, menu_type }) {
  const screen = SCREENS[screenKey(path)];
  if (screen && menu_type !== 'dropdown' && menu_type !== 'submenu') return screen;
  return GROUPS[groupKey(name)] || null;
}
