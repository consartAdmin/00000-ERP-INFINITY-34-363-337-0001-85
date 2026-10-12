// menuConsart.js — Menu Global CONSART ERP (ESM)
// Busca mostra somente links existentes e não bloqueados no menu.
// O script de permissões deve marcar links bloqueados com hidden=true,
// style.display='none' ou class='modulo-bloqueado'.
// Itens com `feature` ficam ocultos quando a appFeature correspondente está desativada.

import { initProductLocationsFeature } from './productLocationsFeature.js';

const MENU_CONFIG = [
  { type: 'link', id: 1, label: '🏠 Início', href: '../home/home.html', className: 'link-inicio' },
  {
    type: 'dropdown', id: 2, htmlId: 'gestao-erp', label: '🌐 Gestão ERP ', children: [
      {
        type: 'submenu', id: 3, label: '👥 Clientes ▹', children: [
          { type: 'link', id: 4, label: '📋 Listagem de Clientes', href: '../customersList/customersList.html' },
          { type: 'link', id: 5, label: '➕ Cadastro de Clientes', href: '../customersRegistration/customersRegistration.html' },
          { type: 'link', id: 121, label: '🗂️ Cadastro de Status de Clientes', href: '../customerStatusTypes/customerStatusTypes.html' },
          //  { type: 'link', id: 6, label: '✏️ Edição de Clientes', href: '../customersEdit/customersEdit.html' },
          // { type: 'link', id: 7, label: '📈 Acompanhamento de Clientes', href: '../customerActivity/customerActivity.html' },
          { type: 'link', id: 118, label: '📊 Segmentos de Cliente', href: '../customerSegments/customerSegments.html' },
          { type: 'link', id: 145, label: '🎓 Treinamentos de Clientes', href: '../customerTrainings/customerTrainings.html' },
        ]
      },
      {
        type: 'submenu', id: 8, label: '📦 Produtos ▹', children: [
          { type: 'link', id: 9, label: '📋 Lista de Produtos', href: '../products/products.html' },
          { type: 'link', id: 10, label: '➕ Novo Produto', href: '../../createProduct/createProduct.html' },
          { type: 'link', id: 11, label: '🏷️ Impressão de Etiquetas', href: '../labels/labels.html' },
          { type: 'link', id: 12, label: '⚙️ Parâmetros de Etiquetas', href: '../labelParameters/labelParameters.html' },
          { type: 'link', id: 13, label: '🖼️ Imagens dos Produtos', href: '../productsImagens/productsImagens.html' },
          { type: 'link', id: 14, label: '💲 Tabela de Preços', href: '../prices/prices.html' },
          { type: 'link', id: 15, label: '📍 Código de Barras Por Localização', href: '../locationsBarCode/locationsBarCode.html', feature: 'PRODUCT_LOCATIONS' },
          { type: 'link', id: 16, label: '✏️ Parâmetros Etiqueta Localização', href: '../labelPrintConfig/labelPrintConfig.html', feature: 'PRODUCT_LOCATIONS' },
          { type: 'link', id: 143, label: '📚 Vinculo Ref. LIMPMAX X Ref. LLV (Entradas NF-e)', href: '../productsLmRef/productsLmRef.html' },

          // { type: 'link', id: 17, label: '🛒 Ordem de Compra', href: '../manufacturesOrders/manufacturesOrders.html' },
          // { type: 'link', id: 18, label: '🧩 Criação de Kits de Produtos', href: '../productsKits/productsKits.html' },
        ]
      },
      {
        type: 'submenu', id: 19, label: '📦 Ajustes em Lote ▹', children: [
          { type: 'link', id: 20, label: '🧾 Vínculos Fiscais de Produtos', href: '../productsFiscalBatch/productsFiscalBatch.html' },
          // { type: 'link', id: 21, label: '💲 Reajuste de Preços', href: '../batchProductsPrices/batchProductsPrices.html' },
          { type: 'link', id: 22, label: '🗂️ Reajuste de Grupos e Subgrupos', href: '../groupsAndSubgroupsBatch/groupsAndSubgroupsBatch.html' },
          { type: 'link', id: 23, label: '🔄 Ativar / Inativar Produtos', href: '../productsActiveBatch/productsActiveBatch.html' },
          { type: 'link', id: 24, label: '👥 Ajuste de Segmentos de Clientes', href: '../customersSegmentsBatch/customersSegmentsBatch.html' },
        ]
      },
      {
        type: 'submenu', id: 25, label: '📦 Cadastros Secundários ▹', children: [
          { type: 'link', id: 26, label: '🔢 Cadastro de Grades', href: '../grades/grades.html' },
          { type: 'link', id: 27, label: '📏 Cadastro de Unidades', href: '../units/units.html' },
          { type: 'link', id: 28, label: '📦 Código de Barras Secundário', href: '../productBarCodeSecond/productBarCodeSecond.html' },
          { type: 'link', id: 29, label: '📚 Grupos & Subgrupos', href: '../groupsAndSubgroups/groupsAndSubgroups.html' },
          { type: 'link', id: 30, label: '🏢 Fornecedores', href: '../suppliers/suppliers.html' },
          { type: 'link', id: 31, label: '🏭 Fabricantes', href: '../manufacturers/manufacturers.html' },
        ]
      },
      {
        type: 'submenu', id: 32, label: '📦 Cadastros Fiscais ▹', children: [
          { type: 'link', id: 33, label: '📑 Produtos Fiscais (Vínculo)', href: '../productsFiscal/productsFiscal.html' },
          { type: 'link', id: 34, label: '🧾 Classificação Fiscal', href: '../fiscalClassification/fiscalClassification.html' },
          { type: 'link', id: 35, label: '📘 Perfil Fiscal', href: '../fiscalProfile/fiscalProfile.html' },
        ]
      },
      {
        type: 'submenu', id: 36, label: '📥 Estoque ▹', children: [
          { type: 'link', id: 37, label: '📥 Entradas Fiscais', href: '../inboundInvoices/inboundInvoices.html' },
          { type: 'link', id: 38, label: '💳 Entradas de Despesas', href: '../expenseEntries/expenseEntries.html' },
          { type: 'link', id: 39, label: '📦 Inventário de Produtos', href: '../inventory/inventory.html' },
          { type: 'link', id: 40, label: '📱 Inventário Mobile', href: '../inventoryMobile/inventoryMobile.html' },
          { type: 'link', id: 41, label: '🗺️ Localização de Produtos', href: '../productsLocations/productsLocations.html', feature: 'PRODUCT_LOCATIONS' },
          { type: 'link', id: 42, label: '📍 Cadastro de Localizações', href: '../locations/locations.html', feature: 'PRODUCT_LOCATIONS' },
          { type: 'link', id: 43, label: '📊 Gestão de Estoque Min./Máx.', href: '../productsStock/productsStock.html' },
          { type: 'link', id: 44, label: '🏷️ Estoque por Lote', href: '../productsStockLots/productsStockLots.html' },
          { type: 'link', id: 142, label: '📚 Conciliação Entradas X Saídas', href: '../conciliationSalesxStock/conciliationSalesxStock.html' },
        ]
      },
      {
        type: 'submenu', id: 45, label: '📈 Fiscal ▹', children: [
          { type: 'link', id: 46, label: '🧾 Notas Fiscais Emitidas', href: '../invoicesIssued/invoicesIssued.html' },
          { type: 'link', id: 48, label: '🚫 Inutilizar NF-e', href: '../nfeInutilizarEvents/nfeInutilizarEvents.html' },
          { type: 'link', id: 49, label: '✏️ Carta de Correção Eletrônica', href: '../nfeCce/nfeCce.html' },
          { type: 'link', id: 50, label: '❌ Cancelar NF-e', href: '../cancelarNfe/cancelarNfe.html' },
          { type: 'link', id: 51, label: '📥 Gestão DF-e', href: '../nfeInbox/nfeInbox.html' },
          { type: 'link', id: 52, label: '🛒 Uso e Consumo', href: '../usoConsumo/usoConsumo.html' },
          { type: 'link', id: 53, label: '↩️ Devolução de Mercadoria Fornecedor', href: '../supplierReturns/supplierReturns.html' },
        ]
      },
      {
        type: 'submenu', id: 54, label: '📥 Transportadoras ▹', children: [
          { type: 'link', id: 55, label: '📄 Transportadoras', href: '../transporters/transporters.html' },
        ]
      },
    ]
  },
  {
    type: 'dropdown', id: 56, htmlId: 'Vendas', label: '📈 Vendas', children: [
      { type: 'link', id: 57, label: '📑 Orçamentos', href: '../budgets/budgets.html' },
      { type: 'link', id: 58, label: '📝 Pedidos', href: '../orders/orders.html' },
      // { type: 'link', id: 60, label: '📊 Orçamento Inteligente', href: '../iaBudgets/iaBudgets.html' },
      { type: 'link', id: 61, label: '📊 Relatório de Vendas', href: '../salesReport/salesReport.html' },
      { type: 'link', id: 62, label: '🚚 Montar Pedido Para Despacho', href: '../OrdersLogisticsPacking/OrdersLogisticsPacking.html' },
      { type: 'link', id: 63, label: '🚚 Etiquetas de Entrega', href: '../deliveryLabels/deliveryLabels.html' },
      { type: 'link', id: 64, label: 'Canhoto de Entregas Digital', href: '../nfeReceipts/nfeReceipts.html' },
      { type: 'link', id: 65, label: 'Relação de Canhotos de Entregas Digital', href: '../nfeReceiptsList/nfeReceiptsList.html' },
      // { type: 'submenu', id: 66, label: '📈 Licitações ▸', children: [
      //   { type: 'link', id: 67, label: '📉 Licitações', href: '../licitations/licitations.html' },
      // ]},
    ]
  },
  {
    type: 'dropdown', id: 68, htmlId: 'gestao-comercial', label: '🛒 Gestão Comercial ', children: [
      { type: 'link', id: 69, label: '🚚 Logística', href: '../deliveryRoutes/deliveryRoutes.html' },
      { type: 'link', id: 144, label: '🚛 Entregas e Motoristas', href: '../deliveryTrips/deliveryTrips.html' },
      { type: 'link', id: 70, label: '📃 Crm Gestão de Vendas ', href: '../crmDeals/crmDeals.html' },
      { type: 'link', id: 71, label: '🗂️ Kanban Pedidos', href: '../ordersKanban/ordersKanban.html' },
      // { type: 'link', id: 72, label: '📝 Desempenho De Vendas', href: '../salesPerformance/salesPerformance.html' },
      // { type: 'link', id: 73, label: '📝 Notas Fiscais Sistema Antigo', href: '../painelNotasFiscais/painelNotasFiscais.html' },
    ]
  },
  {
    type: 'dropdown', id: 74, htmlId: 'gestao-financeira', label: '💰 Financeiro ', children: [
      { type: 'link', id: 75, label: '👍 Contas a Pagar', href: '../accountsPayable/accountsPayable.html' },
      { type: 'link', id: 76, label: '📥 Contas a Receber', href: '../accountsReceivable/accountsReceivable.html' },
      { type: 'link', id: 140, label: '📥 Cadastro de Bancos', href: '../banks/banks.html' },
      { type: 'link', id: 76, label: '📥 Contas Bancárias', href: '../bankAccounts/bankAccounts.html' },
      { type: 'link', id: 76, label: '💰 Saldos Bancários', href: '../bankAccountsBalance/bankAccountsBalance.html' },
      {
        type: 'submenu', id: 77, label: '📑 Despesas ▸', children: [
          { type: 'link', id: 78, label: '📌 Gestão de Despesas', href: '../expenses/expenses.html' },
          { type: 'link', id: 79, label: '📦 Mobilizado (Controle)', href: '../mobilized/mobilized.html' },
          { type: 'link', id: 80, label: '📥 Débitos', href: '../debts/debts.html' },
        ]
      },
      {
        type: 'submenu', id: 81, label: '💵 Movimentações de Caixa', children: [
          { type: 'link', id: 82, label: '💵 Caixa', href: '../cashMoviments/cashMoviments.html' },
          { type: 'link', id: 83, label: '🧾 Caixa Categorias', href: '../caixaCategories/caixaCategories.html' },
        ]
      },
      // { type: 'submenu', id: 85, label: '💸 Cobrança ▸', children: [
      //   { type: 'link', id: 86, label: '🧾 Extrajudicial', href: '../cobrancaExtraJudicial/cobrancaExtraJudicial.html' },
      // ]},
      { type: 'link', id: 87, label: '🔗 Integração Asaas', href: '../cobrancas/asaas.html' },
    ]
  },
  {
    type: 'dropdown', id: 88, htmlId: 'relatorios', label: '📊 Relatórios', children: [
      {
        type: 'submenu', id: 89, label: '📈 Vendas ▸', children: [
          { type: 'link', id: 90, label: '📊 Comissão Vendeores', href: '../salesCommissionsFromInvoices/salesCommissionsFromInvoices.html' },
          { type: 'link', id: 91, label: '📊 Relatório de Vendas', href: '../salesReport/salesReport.html' },
          //   { type: 'link', id: 92, label: '🧾 Relatório de Vendas PDV', href: '../pdvSalesReport/pdvSalesReport.html' },
          { type: 'link', id: 93, label: '📉 Painel de Vendas (Dark)', href: '../salesDashboard/salesDashboard.html' },
          // id 94 removido em 16/09/2026: a página "Comissão de Vendas"
          // (por orçamento) foi descontinuada. A apuração de comissão é
          // exclusivamente por nota emitida — ver id 90 acima.
          { type: 'link', id: 95, label: '📊 Posição de Estoque', href: '../reportsProductsStock/reportsProductsStock.html' },
          { type: 'link', id: 96, label: '🗂️ Cadastro de Comissões', href: '../priceCommissions/priceCommissions.html' },
          //    { type: 'link', id: 97, label: '📊 Better Date To Buy', href: '../betterDateToBuy/betterDateToBuy.html' },
        ]
      },
    ]
  },
  {
    type: 'dropdown', id: 98, htmlId: 'Contabilidade', label: '📊 Contabilidade', children: [
      {
        type: 'submenu', id: 99, label: '📈 Impostos ▸', children: [
          { type: 'link', id: 100, label: '🧮 Cálculo de Impostos', href: '../salesTaxCalculation/salesTaxCalculation.html' },
          { type: 'link', id: 101, label: '📊 Apuração de Impostos', href: '../fiscalApuracao/fiscalApuracao.html' },
          { type: 'link', id: 102, label: '📑 SPED Fiscal', href: '../spedFiscal/spedFiscal.html' },
          { type: 'link', id: 103, label: '🏢 Empresas', href: '../enterprise/enterprise.html' },
          { type: 'link', id: 104, label: '📚 Planos de Contas', href: '../chartOfAccounts/chartOfAccounts.html' },
          //    { type: 'link', id: 105, label: '📉 DRE Gerencial', href: '../dreGerencial/dreGerencial.html' },
        ]
      },
      {
        type: 'submenu', id: 106, label: '📦 R.H ▹', children: [
          { type: 'link', id: 107, label: '🗂️ Colaboradores', href: '../employees/employees.html' },
        ]
      },
    ]
  },
  {
    type: 'dropdown', id: 108, htmlId: 'configuracoes', label: '📋 Configurações ', children: [
      {
        type: 'submenu', id: 109, label: '💰 Cadastros Auxiliares ▸', children: [
          { type: 'link', id: 110, label: '👤 Usuários', href: '../users/users.html' },
          { type: 'link', id: 111, label: '🧩 Módulos Por Usuários', href: '../userModules/userModules.html' },
          { type: 'link', id: 112, label: '🧩 Criação de Módulos', href: '../moduleSystem/moduleSystem.html' },
          { type: 'link', id: 113, label: '💳 Formas de Pagamento', href: '../paymentMethods/paymentMethods.html' },
          { type: 'link', id: 114, label: '🏢 Fornecedores', href: '../suppliers/suppliers.html' },
          { type: 'link', id: 115, label: '⏱️ TimeOut', href: '../includes/sessionTimeout-config.html' },
          { type: 'link', id: 116, label: '🏭 Fabricantes', href: '../manufacturers/manufacturers.html' },
          { type: 'link', id: 117, label: '🧑‍💼 Vendedores', href: '../sellers/sellers.html' },
          { type: 'link', id: 118, label: '📊 Segmentos de Cliente', href: '../customerSegments/customerSegments.html' },
          { type: 'link', id: 119, label: '🗺️ IBGE Ufs And Cities', href: '../ibgeLocations/ibgeLocations.html' },
          { type: 'link', id: 120, label: '🗂️ Cadastro de Vendedor Por Usuário', href: '../sellerByUser/sellerByUser.html' },
          { type: 'link', id: 122, label: '🗂️ Contas de E-mail', href: '../emailAccounts/emailAccounts.html' },
          { type: 'link', id: 123, label: '🗂️ Vinculo de E-mail e Usuários', href: '../userEmailAccounts/userEmailAccounts.html' },
          { type: 'link', id: 139, label: '🗂️ Dash Boards', href: '../usersDashboardAccess/usersDashboardAccess.html' },
          { type: 'link', id: 146, label: '🔑 Senhas dos Módulos', href: '../modulePasswords/modulePasswords.html' },
        ]
      },
    ]
  },
  {
    type: 'dropdown', id: 124, htmlId: 'ferramentas-utilitarias', label: '🗂️ Ferramentas Utilitárias', children: [
      { type: 'link', id: 125, label: '📋 ShortCuts Programation ', href: '../shortCutsProgramation/shortCutsProgramation.html' },
      { type: 'link', id: 126, label: '📋 Tarefas ', href: '../tasks/tasks.html' },
      { type: 'link', id: 127, label: '📧 Email Inbox', href: '../emailInbox/emailInbox.html' },
      { type: 'link', id: 128, label: '🏷️ Product Labels', href: '../labels/labels.html' },
      // { type: 'link', id: 129, label: '🧾 Webhook PlugNotas Monitor', href: '../webhookPlugNotas/webhookPlugNotas.html' },
      // { type: 'link', id: 130, label: '📂 Processos', href: '../processes/processes.html' },
      // { type: 'link', id: 131, label: '📦 Conferência Cega (Logística)', href: '../logistics/ordersLogisticsBlindCheck.html' },
      // { type: 'link', id: 132, label: '📦 Mobilizado (Controle)', href: '../mobilized/mobilized.html' },
      // { type: 'link', id: 133, label: '📦 Products Boxes (Organization)', href: '../productsBoxes/productsBoxes.html' },
    ]
  },
  // { type: 'dropdown', id: 134, htmlId: 'ecommerce', label: '🛒 Ecommerce', children: [
  //   { type: 'link', id: 135, label: '📦 Pedidos', href: '../ecommerceOrders/ecommerceOrders.html' },
  //   { type: 'link', id: 136, label: '📊 Gestão Tráfego Google Ads', href: '../marketing/googleAdsDashboard.html' },
  //   { type: 'link', id: 137, label: '🛰️ Trackeamento & SEO', href: '../trackingManager/trackingManager.html' },
  //   { type: 'link', id: 138, label: '🛰️ Acompanhamentos de Trackeamento', href: '../analyticsTracking/analyticsTracking.html' },
  // ]},
  // Sem id de módulo: o botão de suporte fica visível para todos os usuários.
  { type: 'link', label: '💬 Suporte', href: 'https://wa.me/5531989230220', className: 'link-suporte', external: true },
];

function createLink(item, extraClass = '') {
  const a = document.createElement('a');
  a.textContent = item.label;
  a.href = (item.href || '#').trim();
  if (item.id != null) a.dataset.moduloId = String(item.id);
  if (item.feature) a.dataset.feature = item.feature;
  if (extraClass) a.classList.add(extraClass);
  if (item.external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Suporte via WhatsApp: (31) 9 8923-0220';
  }
  return a;
}

function createSubmenu(item) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('dropdown-submenu');
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = item.label;
  const content = document.createElement('div');
  content.classList.add('dropdown-submenu-content');
  (item.children || []).forEach(child => content.appendChild(createLink(child)));
  wrapper.append(link, content);
  let openTimeout;
  let closeTimeout;
  wrapper.addEventListener('mouseenter', () => {
    clearTimeout(closeTimeout);
    openTimeout = setTimeout(() => {
      content.classList.add('open');
      const rect = content.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        content.style.left = 'auto';
        content.style.right = '100%';
      }
    }, 120);
  });
  wrapper.addEventListener('mouseleave', () => {
    clearTimeout(openTimeout);
    closeTimeout = setTimeout(() => content.classList.remove('open'), 220);
  });
  return wrapper;
}

function createDropdown(item) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('dropdown');
  if (item.id != null) wrapper.dataset.moduloId = String(item.id);
  if (item.htmlId) wrapper.id = item.htmlId;
  const btn = document.createElement('div');
  btn.classList.add('menu-item');
  btn.textContent = item.label;
  const content = document.createElement('div');
  content.classList.add('dropdown-content');
  (item.children || []).forEach(child => {
    if (child.type === 'submenu') content.appendChild(createSubmenu(child));
    else if (child.type === 'link') content.appendChild(createLink(child));
  });
  wrapper.append(btn, content);
  let openTimeout;
  let closeTimeout;
  wrapper.addEventListener('mouseenter', () => {
    clearTimeout(closeTimeout);
    openTimeout = setTimeout(() => {
      content.classList.add('open');
      const rect = content.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        content.style.left = 'auto';
        content.style.right = '0';
      }
    }, 120);
  });
  wrapper.addEventListener('mouseleave', () => {
    clearTimeout(openTimeout);
    closeTimeout = setTimeout(() => content.classList.remove('open'), 220);
  });
  return wrapper;
}

function flattenMenu(items, parentPath = '') {
  return items.flatMap(item => {
    const path = parentPath ? `${parentPath} › ${item.label}` : item.label;
    const current = item.type === 'link' ? [{
      id: String(item.id), label: item.label, href: item.href.trim(), path,
    }] : [];
    return item.children ? current.concat(flattenMenu(item.children, path)) : current;
  });
}

function mountMenuSearch(menuElement) {
  const searchWrapper = document.createElement('div');
  searchWrapper.classList.add('menu-search-wrapper');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = '🔍 Buscar módulos...';
  input.classList.add('menu-search-input');
  input.autocomplete = 'off';
  const resultsBox = document.createElement('div');
  resultsBox.classList.add('menu-search-results');
  resultsBox.hidden = true;
  const flatIndex = flattenMenu(MENU_CONFIG);
  let activeIndex = -1;
  let currentResults = [];

  // Não usa getClientRects/offsetParent: dropdown fechado não significa bloqueado.
  function moduloEstaLiberado(moduloId, href) {
    const links = menuElement.querySelectorAll('a[data-modulo-id]');
    return Array.from(links).some(link => {
      if (link.dataset.moduloId !== String(moduloId)) return false;
      if (href && link.getAttribute('href')?.trim() !== href.trim()) return false;
      const style = getComputedStyle(link);
      return link.isConnected && !link.hidden &&
        link.style.display !== 'none' && style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !link.classList.contains('modulo-bloqueado');
    });
  }

  const closeResults = () => {
    resultsBox.hidden = true;
    resultsBox.replaceChildren();
    activeIndex = -1;
    currentResults = [];
  };
  const setActive = index => {
    const rows = [...resultsBox.querySelectorAll('.menu-search-item')];
    rows.forEach(row => row.classList.remove('active'));
    if (rows[index]) {
      rows[index].classList.add('active');
      rows[index].scrollIntoView({ block: 'nearest' });
    }
  };
  const goToActive = () => {
    const item = currentResults[activeIndex];
    if (item?.href) location.assign(item.href);
  };

  input.addEventListener('input', () => {
    const value = input.value.trim().toLocaleLowerCase('pt-BR');
    if (!value) return closeResults();
    currentResults = flatIndex.filter(item => {
      const match = item.label.toLocaleLowerCase('pt-BR').includes(value) ||
        item.path.toLocaleLowerCase('pt-BR').includes(value);
      return match && moduloEstaLiberado(item.id, item.href);
    }).slice(0, 12);
    resultsBox.replaceChildren();
    activeIndex = -1;
    if (!currentResults.length) {
      const empty = document.createElement('div');
      empty.classList.add('no-results');
      empty.textContent = 'Nenhum módulo encontrado';
      resultsBox.appendChild(empty);
    } else {
      currentResults.forEach((item, index) => {
        const row = document.createElement('div');
        row.classList.add('menu-search-item');
        row.textContent = item.path;
        row.tabIndex = 0;
        row.addEventListener('mouseenter', () => {
          activeIndex = index;
          setActive(index);
        });
        row.addEventListener('click', () => location.assign(item.href));
        resultsBox.appendChild(row);
      });
    }
    resultsBox.hidden = false;
  });

  input.addEventListener('keydown', event => {
    const count = resultsBox.querySelectorAll('.menu-search-item').length;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeResults();
      input.blur();
      return;
    }
    if (!count) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % count;
      setActive(activeIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + count) % count;
      setActive(activeIndex);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      goToActive();
    }
  });

  document.addEventListener('click', event => {
    if (!searchWrapper.contains(event.target)) closeResults();
  });
  searchWrapper.append(input, resultsBox);
  menuElement.prepend(searchWrapper);
}

function buildMenuPrincipal() {
  if (document.querySelector('.menu-principal')) return;
  const menu = document.createElement('div');
  menu.classList.add('menu-principal');
  Object.assign(menu.style, {
    height: 'auto', minHeight: '0', bottom: 'auto', pointerEvents: 'none',
  });
  mountMenuSearch(menu);
  MENU_CONFIG.forEach(item => {
    if (item.type === 'link') menu.appendChild(createLink(item, item.className || ''));
    else if (item.type === 'dropdown') menu.appendChild(createDropdown(item));
  });
  [...menu.children].forEach(child => { child.style.pointerEvents = 'auto'; });
  const mount = document.getElementById('menuConsartMount') ||
    document.getElementById('menu-consart-mount');
  if (mount) mount.appendChild(menu);
  else document.body.prepend(menu);

  // appFeature PRODUCT_LOCATIONS: LOCATIONS_DISABLED → oculta os links de localização
  initProductLocationsFeature({ root: menu }).catch(() => { });

  // Dispara somente depois que todos os links existem no DOM.
  try {
    window.CONSART_MENU_CONFIG = MENU_CONFIG;
    window.dispatchEvent(new CustomEvent('consart:menu-ready', {
      detail: { MENU_CONFIG, menuElement: menu },
    }));
  } catch (error) {
    console.warn('[MENU] Não foi possível emitir consart:menu-ready:', error);
  }
  console.log('[MENU] Menu principal gerado e fixado no topo.');
}

function initMenuConsart() {
  try { buildMenuPrincipal(); }
  catch (error) { console.error('[MENU] Erro ao montar menu:', error); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMenuConsart, { once: true });
} else {
  initMenuConsart();
}
