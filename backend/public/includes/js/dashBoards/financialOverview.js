// ╔══════════════════════════════════════════════════════════════════════╗
// ║ financialOverview.js — Dashboard: Financeiro (Início, slide 1)      ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ Mesmo layout dos outros slides (modelo: Estoque):                    ║
// ║ barra do topo (resumo + período + link), 4 painéis e 4 KPIs.         ║
// ║                                                                      ║
// ║ ✅ A receber (resumo)        ✅ Previsto × recebido (linha)          ║
// ║ ✅ A pagar (resumo)          ✅ Previsto × pago (linha)              ║
// ║ ✅ KPIs: saldo do período, inadimplência, despesas atrasadas,       ║
// ║          saldo em aberto                                             ║
// ║                                                                      ║
// ║ Usa as mesmas rotas dos cards antigos (/api/dashboard/...).          ║
// ║ Cada parte respeita a permissão do card antigo correspondente.       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { moneyBR, fetchDashboard } from './dashboardUtils.js';
import { escapeHtml, formatInteger, formatPercentage } from './taxDashboardShared.js';
import { loadFinancialFlow, renderFinancialChart } from './financialChartUtils.js?v=20261106-1';
import {
    getFinancialPeriod,
    financialPeriodQuery,
    financialPeriodLabel,
    renderFinancialPeriodPicker,
    bindFinancialPeriodPicker,
    onFinancialPeriodChange,
} from './dashboardPeriod.js?v=20261106-1';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const DASHBOARD_KEY = 'financial-overview';
const RECEIVABLE_URL = '/public/accountsReceivable/accountsReceivable.html';
const PAYABLE_URL = '/public/accountsPayable/accountsPayable.html';

/** Cards antigos do slide Financeiro: a permissão de cada um continua valendo. */
export const FINANCIAL_ACCESS_KEYS = Object.freeze([
    'daily-receivables',
    'daily-payables',
    'monthly-receivables',
    'monthly-payables',
    'total-receivables',
    'total-payables',
    'customer-overdue',
    'overdue-expenses',
    'receivables-chart',
    'payables-chart',
]);

const COLORS = Object.freeze({
    receivable: '#2563eb',
    received: '#10b981',
    payable: '#f97316',
    paid: '#ef4444',
    overdue: '#dc2626',
    balance: '#1d4ed8',
    open: '#64748b',
});

function getCard(root) {
    return root.querySelector(`.dash-card[data-dashboard-key="${DASHBOARD_KEY}"]`);
}

function sum(rows, field) {
    return (Array.isArray(rows) ? rows : []).reduce((total, row) => total + Number(row?.[field] || 0), 0);
}

function safe(promise) {
    return promise.catch((error) => {
        console.warn('[dashboard][financial-overview] Partial load failed:', error);
        return null;
    });
}

function value(data) {
    return Number(data?.valor ?? data?.total ?? 0);
}

function titles(n) {
    return `${formatInteger(n)} ${Number(n) === 1 ? 'título' : 'títulos'}`;
}

export const financialOverviewDashboard = {

    key: DASHBOARD_KEY,

    /** Preenchido pelo includeDashboard.js antes do render(). */
    allowed: new Set(),

    can(side) {
        const a = this.allowed;
        if (side === 'receivable') return a.has('daily-receivables') || a.has('monthly-receivables') || a.has('total-receivables') || a.has('receivables-chart');
        if (side === 'payable') return a.has('daily-payables') || a.has('monthly-payables') || a.has('total-payables') || a.has('payables-chart');
        return a.has(side);
    },

    render() {
        const rec = this.can('receivable');
        const pay = this.can('payable');

        return `
          <article class="dash-card dash-card--analytics dash-card--block" data-dashboard-key="${DASHBOARD_KEY}">
            <div class="sales-analytics stock-lots-dash">

              <section class="sales-analytics__period stock-lots-dash__top dash-block__top">
                <span class="stock-lots-dash__caption" data-fin-caption>Carregando financeiro…</span>
                ${renderFinancialPeriodPicker()}
                <span class="dash-block__links">
                  ${rec ? `<a class="stock-lots-dash__link" href="${RECEIVABLE_URL}">Contas a Receber →</a>` : ''}
                  ${pay ? `<a class="stock-lots-dash__link" href="${PAYABLE_URL}">Contas a Pagar →</a>` : ''}
                </span>
              </section>

              <section class="sales-analytics__abc-row">

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking"${rec ? '' : ' hidden'}>
                  <header class="analytics-chart__header"><h3>A RECEBER</h3></header>
                  <div class="analytics-chart__body tax-panel__scroll" data-fin-list="receivable"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc"${rec ? '' : ' hidden'}>
                  <header class="analytics-chart__header"><h3>PREVISTO × RECEBIDO</h3></header>
                  <div class="analytics-chart__body financial-chart__body" data-fin-chart="receivable"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking"${pay ? '' : ' hidden'}>
                  <header class="analytics-chart__header"><h3>A PAGAR</h3></header>
                  <div class="analytics-chart__body tax-panel__scroll" data-fin-list="payable"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc"${pay ? '' : ' hidden'}>
                  <header class="analytics-chart__header"><h3>PREVISTO × PAGO</h3></header>
                  <div class="analytics-chart__body financial-chart__body" data-fin-chart="payable"></div>
                </section>

              </section>

              <section class="sales-analytics__kpi-row">
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:${COLORS.balance}" href="${RECEIVABLE_URL}"${rec && pay ? '' : ' hidden'}>
                  <span class="analytics-kpi__label">SALDO PREVISTO NO PERÍODO</span>
                  <strong class="analytics-kpi__value" data-fin-field="periodBalance">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint" data-fin-field="periodBalanceHint"></small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:${COLORS.overdue}" href="${RECEIVABLE_URL}"${this.can('customer-overdue') ? '' : ' hidden'}>
                  <span class="analytics-kpi__label">INADIMPLÊNCIA CLIENTES</span>
                  <strong class="analytics-kpi__value" data-fin-field="customerOverdue">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint" data-fin-field="customerOverdueHint"></small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#ea580c" href="${PAYABLE_URL}"${this.can('overdue-expenses') ? '' : ' hidden'}>
                  <span class="analytics-kpi__label">DESPESAS ATRASADAS</span>
                  <strong class="analytics-kpi__value" data-fin-field="overdueExpenses">0%</strong>
                  <small class="stock-lots-kpi__hint" data-fin-field="overdueExpensesHint"></small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:${COLORS.open}" href="${RECEIVABLE_URL}"${rec && pay ? '' : ' hidden'}>
                  <span class="analytics-kpi__label">SALDO EM ABERTO (GERAL)</span>
                  <strong class="analytics-kpi__value" data-fin-field="openBalance">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint" data-fin-field="openBalanceHint"></small>
                </a>
              </section>

            </div>
          </article>
        `;
    },

    async load(root) {
        const card = getCard(root);
        if (!card) return;

        if (card.dataset.finBound !== '1') {
            card.dataset.finBound = '1';
            bindFinancialPeriodPicker(card, {
                onError: (message) => showCenterModal({ variant: 'warning', title: 'Período', message }),
            });
            onFinancialPeriodChange(() => {
                card.classList.add('is-loading');
                loadAll(this, card).finally(() => card.classList.remove('is-loading'));
            });
        }

        await loadAll(this, card);
    },
};

async function loadAll(dashboard, card) {
    const period = getFinancialPeriod();
    const query = financialPeriodQuery(period);
    const rec = dashboard.can('receivable');
    const pay = dashboard.can('payable');
    const skip = Promise.resolve(null);

    const [flow, recDay, payDay, recPeriod, payPeriod, recOpen, payOpen, overdue, expenses] = await Promise.all([
        rec || pay ? safe(loadFinancialFlow(query)) : skip,
        rec ? safe(fetchDashboard('/api/dashboard/total-receber-dia')) : skip,
        pay ? safe(fetchDashboard('/api/dashboard/total-pagar-dia')) : skip,
        rec ? safe(fetchDashboard(`/api/dashboard/total-receber-mes?${query}`)) : skip,
        pay ? safe(fetchDashboard(`/api/dashboard/total-pagar-mes?${query}`)) : skip,
        rec ? safe(fetchDashboard('/api/dashboard/total-receber')) : skip,
        pay ? safe(fetchDashboard('/api/dashboard/total-pagar')) : skip,
        dashboard.can('customer-overdue') ? safe(fetchDashboard(`/api/dashboard/inadimplencia?${query}`)) : skip,
        dashboard.can('overdue-expenses') ? safe(fetchDashboard(`/api/dashboard/inadimplencia-despesas?${query}`)) : skip,
    ]);

    const label = financialPeriodLabel(period);
    const receivables = flow?.receivables || [];
    const payables = flow?.payables || [];

    card.querySelector('[data-fin-caption]').textContent =
        `Contas a receber e a pagar · ${label} · gráficos por dia de vencimento e de pagamento`;

    if (rec) {
        renderSummary(card, 'receivable', {
            today: value(recDay),
            period: value(recPeriod),
            settled: sum(receivables, 'settled'),
            settledLabel: 'Recebido no período',
            overdue: overdue ? Number(overdue.totalAberto || 0) : null,
            overdueCount: overdue ? Number(overdue.titulosAbertos ?? overdue.qtd ?? 0) : null,
            open: value(recOpen),
            openCount: Number(recOpen?.quantidade || 0),
            color: COLORS.receivable,
            url: RECEIVABLE_URL,
        });
        renderFinancialChart(card.querySelector('[data-fin-chart="receivable"]'), receivables, {
            id: 'fin-receivables',
            ariaLabel: 'Valores previstos e recebidos por dia',
            expected: { label: 'Previsto', color: COLORS.receivable },
            settled: { label: 'Recebido', color: COLORS.received },
        });
    }

    if (pay) {
        renderSummary(card, 'payable', {
            today: value(payDay),
            period: value(payPeriod),
            settled: sum(payables, 'settled'),
            settledLabel: 'Pago no período',
            overdue: null,
            overdueCount: expenses ? Number(expenses.titulosEmAtraso ?? expenses.qtd ?? 0) : null,
            open: value(payOpen),
            openCount: Number(payOpen?.quantidade || 0),
            color: COLORS.payable,
            url: PAYABLE_URL,
        });
        renderFinancialChart(card.querySelector('[data-fin-chart="payable"]'), payables, {
            id: 'fin-payables',
            ariaLabel: 'Valores previstos e pagos por dia',
            expected: { label: 'Previsto', color: COLORS.payable },
            settled: { label: 'Pago', color: COLORS.paid },
        });
    }

    const periodBalance = value(recPeriod) - value(payPeriod);
    setField(card, 'periodBalance', moneyBR(periodBalance));
    setField(card, 'periodBalanceHint', `a receber ${moneyBR(value(recPeriod))} − a pagar ${moneyBR(value(payPeriod))}`);

    if (overdue) {
        setField(card, 'customerOverdue', moneyBR(overdue.totalAberto || 0));
        setField(card, 'customerOverdueHint', `${titles(overdue.titulosAbertos ?? overdue.qtd ?? 0)} vencido(s) · ${label}`);
    }

    if (expenses) {
        setField(card, 'overdueExpenses', formatPercentage(expenses.percentual ?? expenses.perc ?? 0, 1));
        setField(card, 'overdueExpensesHint', `${titles(expenses.titulosEmAtraso ?? expenses.qtd ?? 0)} em atraso · ${label}`);
    }

    setField(card, 'openBalance', moneyBR(value(recOpen) - value(payOpen)));
    setField(card, 'openBalanceHint', `${titles(recOpen?.quantidade || 0)} a receber · ${titles(payOpen?.quantidade || 0)} a pagar`);
}

function setField(card, field, text) {
    const el = card.querySelector(`[data-fin-field="${field}"]`);
    if (el) el.textContent = text;
}

function renderSummary(card, side, s) {
    const container = card.querySelector(`[data-fin-list="${side}"]`);
    if (!container) return;

    const rows = [
        { label: 'Vence hoje', count: null, value: s.today, color: s.color },
        { label: 'A vencer no período', count: null, value: s.period, color: s.color },
        { label: s.settledLabel, count: null, value: s.settled, color: side === 'receivable' ? COLORS.received : COLORS.paid },
        s.overdueCount !== null
            ? { label: side === 'receivable' ? 'Vencidos no período' : 'Atrasados no período', count: s.overdueCount, value: s.overdue, color: COLORS.overdue }
            : null,
        { label: 'Em aberto (geral)', count: s.openCount, value: s.open, color: COLORS.open },
    ].filter(Boolean);

    container.innerHTML = `
      <table class="tax-table">
        <thead><tr><th>Situação</th><th>Títulos</th><th>Valor</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><i class="tax-dot" style="background:${escapeHtml(r.color)}"></i>${escapeHtml(r.label)}</td>
              <td>${r.count === null ? '—' : formatInteger(r.count)}</td>
              <td><strong>${r.value === null ? '—' : moneyBR(r.value)}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tax-table__footer">
        <span class="tax-rate-legend">Saldo em aberto = valor − pago</span>
        <a class="tax-link" href="${s.url}">Ver títulos</a>
      </div>`;
}

export default financialOverviewDashboard;
