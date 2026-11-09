// ╔══════════════════════════════════════════════════════════════════════╗
// ║ usersDashboardAccess.config.js — Indicadores da Home por slide      ║
// ║ CONSART ERP                                                         ║
// ║                                                                     ║
// ║ Cada item da tela pode gravar mais de uma chave (ex.: "Contas a     ║
// ║ Receber" grava daily-receivables e monthly-receivables, que hoje    ║
// ║ liberam a mesma parte do slide Financeiro).                         ║
// ║ As chaves antigas daily-nfce / daily-sales / monthly-nfce /         ║
// ║ monthly-sales não aparecem mais na Home e saíram da tela.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

export const SLIDES = Object.freeze([
  {
    id: 'finance',
    title: 'Financeiro',
    items: [
      {
        id: 'receivables',
        label: 'Contas a Receber',
        hint: 'Total a receber do período, recebido e gráfico de recebimentos.',
        keys: ['daily-receivables', 'monthly-receivables'],
      },
      {
        id: 'payables',
        label: 'Contas a Pagar',
        hint: 'Total a pagar do período, pago e gráfico de pagamentos.',
        keys: ['daily-payables', 'monthly-payables'],
      },
      {
        id: 'customer-overdue',
        label: 'Inadimplência de Clientes',
        hint: 'Títulos a receber vencidos e não recebidos.',
        keys: ['customer-overdue'],
      },
      {
        id: 'overdue-expenses',
        label: 'Despesas em Atraso',
        hint: 'Títulos a pagar vencidos e não pagos.',
        keys: ['overdue-expenses'],
      },
    ],
  },
  {
    id: 'analytics',
    title: 'Vendas',
    items: [
      {
        id: 'sales-analytics',
        label: 'Análise de Vendas',
        hint: 'Curvas ABC, lucro bruto e indicadores comerciais.',
        keys: ['sales-analytics'],
      },
    ],
  },
  {
    id: 'taxes',
    title: 'Impostos e Apuração',
    items: [
      {
        id: 'sales-taxes',
        label: 'Impostos sobre Vendas',
        hint: 'Impostos destacados nas vendas do período.',
        keys: ['sales-taxes'],
      },
      {
        id: 'tax-assessment',
        label: 'Apuração Débito × Crédito',
        hint: 'Saldo a recolher e estimativa de IRPJ/CSLL.',
        keys: ['tax-assessment'],
      },
    ],
  },
  {
    id: 'stock',
    title: 'Estoque',
    items: [
      {
        id: 'stock-lots-expiry',
        label: 'Validade dos Lotes',
        hint: 'Lotes vencidos e a vencer (FEFO).',
        keys: ['stock-lots-expiry'],
      },
      {
        id: 'stock-replenishment',
        label: 'Reposição de Estoque',
        hint: 'O que comprar: abaixo do mínimo, prazo e pedido mínimo do fabricante.',
        keys: ['stock-replenishment'],
      },
    ],
  },
]);

export const ITEMS = Object.freeze(SLIDES.flatMap((slide) => slide.items));

export const TOTAL_ITEMS = ITEMS.length;
