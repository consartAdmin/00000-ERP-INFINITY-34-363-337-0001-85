// ╔══════════════════════════════════════════════════════════════════════╗
// ║ taxAssessment.js — Dashboard: Apuração de Impostos (débito × crédito)║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Débito (vendas) × crédito (compras e despesas) por imposto       ║
// ║ ✅ Saldo a recolher / saldo credor                                  ║
// ║ ✅ IRPJ / CSLL pelo Regime Tributário cadastrado                    ║
// ║ ✅ Evolução mensal: a recolher × créditos (6 meses)                 ║
// ║ ✅ KPIs comparados com o período anterior                          ║
// ║ ✅ Mesmo filtro de período dos dashboards de Vendas e Impostos      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
    moneyBR,
    fetchDashboard,
} from './dashboardUtils.js';

import {
    PERIOD_OPTIONS_HTML,
    bindPeriodFilter,
    readPeriod,
    periodQuery,
    previousRange,
    formatDateBR,
    comparisonHtml,
    setKpiHint,
    donutSvg,
    legendHtml,
    monthlyColumnsSvg,
    monthTitle,
    downloadFile,
    escapeHtml,
    formatNumber,
    formatInteger,
} from './taxDashboardShared.js';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';


// ======================================================================
// CONFIG
// ======================================================================

const DASHBOARD_KEY =
    'tax-assessment';

const ENDPOINT =
    '/api/dashboard/tax-assessment';

const HISTORY_MONTHS = 6;

const COLORS = Object.freeze({
    debit: '#e11d48',
    debitText: '#be123c',
    credit: '#10b981',
    creditText: '#047857',
    balance: '#1e3a8a',
    toPay: '#1e3a8a',
    origins: ['#059669', '#6ee7b7', '#0d9488', '#a7f3d0', '#14b8a6'],
});


// ======================================================================
// DASHBOARD
// ======================================================================

export const taxAssessmentDashboard = {

    key: DASHBOARD_KEY,

    render() {

        return `
          <article
            class="dash-card dash-card--analytics dash-card--taxes"
            data-dashboard-key="${DASHBOARD_KEY}"
          >

            <div class="sales-analytics sales-taxes tax-assessment">

              <section class="sales-analytics__period" aria-label="Filtro por período">
                <label class="sales-analytics__period-field">
                  <span>Período</span>
                  <select data-ta-filter="periodMode">
                    ${PERIOD_OPTIONS_HTML}
                  </select>
                </label>

                <div class="sales-analytics__custom-dates" data-ta-period-custom hidden>
                  <label class="sales-analytics__period-field">
                    <span>Data inicial</span>
                    <input type="date" data-ta-filter="startDate" />
                  </label>

                  <label class="sales-analytics__period-field">
                    <span>Data final</span>
                    <input type="date" data-ta-filter="endDate" />
                  </label>

                  <button type="button" class="sales-analytics__period-apply" data-ta-action="applyPeriod">
                    Aplicar
                  </button>
                </div>

                <span class="sales-taxes__coverage" data-ta-coverage></span>
                <span class="sales-taxes__regime" data-ta-regime></span>

                <div class="tax-assessment__export" aria-label="Baixar memória de cálculo">
                  <button type="button" class="tax-assessment__export-btn is-xlsx" data-ta-export="xlsx"
                    title="Baixar a memória de cálculo em Excel">
                    Excel
                  </button>
                  <button type="button" class="tax-assessment__export-btn is-pdf" data-ta-export="pdf"
                    title="Baixar a memória de cálculo em PDF">
                    PDF
                  </button>
                </div>

                <span class="sales-analytics__period-caption" data-ta-period-caption></span>
              </section>


              <!-- ==================================================== -->
              <!-- PANELS                                               -->
              <!-- ==================================================== -->

              <section class="sales-analytics__abc-row">

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header">
                    <h3>APURAÇÃO POR IMPOSTO</h3>
                  </header>
                  <div class="analytics-chart__body tax-panel__scroll" data-ta-list="byTax" aria-label="Apuração por imposto"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc">
                  <header class="analytics-chart__header">
                    <h3>GRÁFICO: DÉBITO × CRÉDITO</h3>
                  </header>
                  <div
                    class="analytics-chart__body tax-dc"
                    data-ta-chart="bars"
                    role="img"
                    aria-label="Gráfico de débito e crédito por imposto"
                  ></div>
                </section>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header">
                    <h3>CRÉDITOS POR ORIGEM</h3>
                  </header>
                  <div class="analytics-chart__body tax-stack" aria-label="Créditos por origem">
                    <div class="tax-donut tax-donut--compact" data-ta-list="credits"></div>
                    <div class="tax-subsection-title">A RECOLHER × CRÉDITOS (${HISTORY_MONTHS} MESES)</div>
                    <div class="tax-columns" data-ta-chart="history"></div>
                  </div>
                </section>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header">
                    <h3>RESULTADO ESTIMADO</h3>
                  </header>
                  <div class="analytics-chart__body tax-panel__scroll" data-ta-list="result" aria-label="Resultado estimado"></div>
                </section>

              </section>


              <!-- ==================================================== -->
              <!-- KPI ROW                                              -->
              <!-- ==================================================== -->

              <section class="sales-analytics__kpi-row">

                <div class="analytics-kpi analytics-kpi--taxes kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">DÉBITOS (VENDAS)</span>
                  <strong class="analytics-kpi__value" data-ta-field="debits">R$ 0,00</strong>
                  <small class="tax-kpi-hint" data-ta-compare="debits" hidden></small>
                </div>

                <div class="analytics-kpi analytics-kpi--credits kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">CRÉDITOS (COMPRAS E DESPESAS)</span>
                  <strong class="analytics-kpi__value" data-ta-field="credits">R$ 0,00</strong>
                  <small class="tax-kpi-hint" data-ta-compare="credits" hidden></small>
                </div>

                <div class="analytics-kpi analytics-kpi--revenue kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">A RECOLHER</span>
                  <strong class="analytics-kpi__value" data-ta-field="toPay">R$ 0,00</strong>
                  <small class="tax-kpi-hint" data-ta-compare="toPay" hidden></small>
                </div>

                <div class="analytics-kpi analytics-kpi--ticket kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">SALDO CREDOR (PRÓXIMO PERÍODO)</span>
                  <strong class="analytics-kpi__value" data-ta-field="creditBalance">R$ 0,00</strong>
                  <small class="tax-kpi-hint" data-ta-compare="creditBalance" hidden></small>
                </div>

              </section>

            </div>

          </article>
        `;
    },

    async load(root) {

        const card = root.querySelector(`.dash-card[data-dashboard-key="${DASHBOARD_KEY}"]`);
        if (!card) return;

        try {
            bindPeriodFilter(card, 'ta', () => loadAssessment(card), warn);
            bindExport(card);
            await loadAssessment(card);
        } catch (error) {
            console.error('[dashboard][tax-assessment] Failed to load:', error);
            renderError(card);
        }
    },
};


// ======================================================================
// LOAD
// ======================================================================

function warn(message, variant = 'warning') {
    showCenterModal({ variant, title: variant === 'error' ? 'Erro' : 'Período', message: escapeHtml(message) });
}


async function loadAssessment(card) {
    const period = readPeriod(card, 'ta');
    const data = await fetchDashboard(`${ENDPOINT}?${periodQuery(period)}`);

    console.log('[dashboard][tax-assessment] Response:', data);

    const summary = data?.summary || {};
    const byTax = Array.isArray(data?.byTax) ? data.byTax : [];
    const filters = data?.filters || {};

    setText(card, 'debits', moneyBR(summary.debits || 0));
    setText(card, 'credits', moneyBR(summary.credits || 0));
    setText(card, 'toPay', moneyBR(summary.toPay || 0));
    setText(card, 'creditBalance', moneyBR(summary.creditBalance || 0));
    updateKpiHints(card, summary);

    updateCoverage(card, summary, data?.sources || {});
    updateRegime(card, data?.regime);
    renderTaxRows(card, byTax, summary);
    renderBars(
        card.querySelector('[data-ta-chart="bars"]'),
        byTax.filter((row) => row.debit > 0 || row.credit > 0)
    );
    renderCredits(card, Array.isArray(data?.creditOrigins) ? data.creditOrigins : [], summary);
    renderResult(card, data?.result || {}, byTax, data?.regime);
    updatePeriodCaption(card, filters);

    // Exports use the period on screen, not dates typed but not applied yet.
    card.dataset.taStartDate = filters.startDate || '';
    card.dataset.taEndDate = filters.endDate || '';

    // Secondary data: never blocks the main panels.
    const token = String(Date.now());
    card.dataset.taLoadToken = token;

    loadComparison(card, period, filters, summary, token);
    loadHistory(card, filters, token);
}


function renderError(card) {
    card.querySelectorAll('[data-ta-list], [data-ta-chart]').forEach((element) => {
        element.innerHTML = '<div class="analytics-abc-ranking__empty">Não foi possível carregar a apuração.</div>';
    });
}


// ======================================================================
// KPI HINTS + COMPARISON
// ======================================================================

function creditShare(summary) {
    const debits = Number(summary?.debits || 0);
    return debits > 0 ? (Number(summary?.credits || 0) / debits) * 100 : 0;
}

function updateKpiHints(card, summary) {
    setKpiHint(card, '[data-ta-compare="debits"]', '');
    setKpiHint(card, '[data-ta-compare="credits"]',
        `<span class="tax-kpi-delta is-flat">${formatNumber(creditShare(summary), 1)}% dos débitos</span>`);
    setKpiHint(card, '[data-ta-compare="toPay"]', '');
    setKpiHint(card, '[data-ta-compare="creditBalance"]', Number(summary?.creditBalance || 0) > 0
        ? '<span class="tax-kpi-delta is-flat">crédito que passa para o próximo período</span>'
        : '<span class="tax-kpi-delta is-flat">nenhum imposto com crédito sobrando</span>');
}

async function loadComparison(card, period, filters, summary, token) {
    const previous = previousRange(period.mode, filters.startDate, filters.endDate);
    if (!previous) return;

    try {
        const data = await fetchDashboard(`${ENDPOINT}?${periodQuery(previous)}`);
        if (card.dataset.taLoadToken !== token) return;

        const before = data?.summary || {};

        setKpiHint(card, '[data-ta-compare="debits"]',
            comparisonHtml(summary.debits, before.debits, previous.label, { invert: true }));
        setKpiHint(card, '[data-ta-compare="toPay"]',
            comparisonHtml(summary.toPay, before.toPay, previous.label, { invert: true }));
    } catch (error) {
        console.warn('[dashboard][tax-assessment] Comparison unavailable:', error);
    }
}


// ======================================================================
// A RECOLHER × CRÉDITOS (EVOLUÇÃO MENSAL)
// ======================================================================

async function loadHistory(card, filters, token) {
    const container = card.querySelector('[data-ta-chart="history"]');
    if (!container) return;

    container.innerHTML = '<div class="analytics-product-pie__empty">Carregando evolução...</div>';

    try {
        const params = new URLSearchParams({ months: String(HISTORY_MONTHS) });
        if (filters.endDate) params.set('endDate', filters.endDate);

        const data = await fetchDashboard(`${ENDPOINT}/history?${params.toString()}`);
        if (card.dataset.taLoadToken !== token) return;

        renderHistory(container, Array.isArray(data?.months) ? data.months : []);
    } catch (error) {
        console.warn('[dashboard][tax-assessment] History unavailable:', error);
        if (card.dataset.taLoadToken === token) {
            container.innerHTML = '<div class="analytics-product-pie__empty">Evolução indisponível.</div>';
        }
    }
}

function renderHistory(container, months) {
    if (!months.length || !months.some((month) => Number(month.toPay) > 0 || Number(month.credits) > 0)) {
        container.innerHTML = '<div class="analytics-product-pie__empty">Sem apuração nos últimos meses.</div>';
        return;
    }

    const partial = months.find((month) => month.partial);

    container.innerHTML = `
      ${monthlyColumnsSvg({
        months: months.map((month) => ({ ...month, title: monthTitle(month) })),
        series: [
            { label: 'A recolher', color: COLORS.toPay, values: months.map((month) => Number(month.toPay || 0)) },
            { label: 'Créditos', color: COLORS.credit, values: months.map((month) => Number(month.credits || 0)) },
        ],
        mode: 'grouped',
        height: 112,
    })}
      <ul class="tax-legend tax-legend--inline">
        <li><i style="background:${COLORS.toPay}"></i><span class="tax-legend__name">A recolher</span></li>
        <li><i style="background:${COLORS.credit}"></i><span class="tax-legend__name">Créditos</span></li>
        ${partial ? `<li class="tax-columns__note">* ${escapeHtml(partial.label)} até ${formatDateBR(partial.endDate)}</li>` : ''}
      </ul>
    `;
}


// ======================================================================
// CHIPS
// ======================================================================

function updateCoverage(card, summary, sources) {
    const element = card.querySelector('[data-ta-coverage]');
    if (!element) return;

    const purchases = Number(summary.purchaseInvoices || 0);
    const notPosted = Number(summary.purchasesNotPosted || 0);
    const expenses = Number(summary.expenseEntries || 0);
    const cmv = Number(summary.cmvMovements || 0);

    const warning = !sources.purchases || (purchases === 0 && cmv === 0) || notPosted > 0;
    element.classList.toggle('sales-taxes__coverage--warning', warning);

    if (!sources.purchases) {
        element.textContent = 'Notas de entrada não encontradas';
        element.title = 'Sem a tabela de notas de entrada não há créditos para abater.';
        return;
    }

    element.textContent = `${formatInteger(purchases)} notas de entrada · ${formatInteger(cmv)} C.M.V · ${formatInteger(expenses)} despesas`;
    element.title = [
        `${formatInteger(summary.salesInvoices)} notas de venda geram os débitos.`,
        `${formatInteger(purchases)} notas de entrada (${moneyBR(summary.purchasesTotal || 0)}) geram os créditos de ICMS, IPI, PIS e COFINS.`,
        notPosted > 0 ? `${formatInteger(notPosted)} delas ainda não foram lançadas, mas já entram no cálculo.` : '',
        cmv > 0 ? `${formatInteger(cmv)} saídas de C.M.V no Caixa (${moneyBR(summary.cmvPurchases || 0)}) contam como compras para o crédito de PIS/COFINS no Lucro Real.` : '',
        `${formatInteger(expenses)} despesas (${moneyBR(summary.expensesTotal || 0)}); ${moneyBR(summary.creditableExpenses || 0)} marcadas como "gera crédito".`,
    ].filter(Boolean).join('\n');
}


function updateRegime(card, regime) {
    const element = card.querySelector('[data-ta-regime]');
    if (!element) return;

    element.classList.toggle('sales-taxes__regime--missing', !regime);

    if (!regime) {
        element.textContent = 'Regime não cadastrado';
        element.title = 'Sem regime, débitos e créditos seguem o que está destacado nas notas e o IRPJ/CSLL não é estimado.';
        return;
    }

    element.textContent = regime.label;
    element.title = regime.summary || regime.label;
}


// ======================================================================
// APURAÇÃO POR IMPOSTO
// ======================================================================

function statusOf(row) {
    if (row.note === 'Recolhido dentro do DAS') return { text: 'DAS', tone: 'neutral' };
    if (row.balance > 0) return { text: 'PAGAR', tone: 'pay' };
    if (row.balance < 0) return { text: 'CREDOR', tone: 'credit' };
    return { text: 'ZERO', tone: 'neutral' };
}

// "PIS (NÃO CUMULATIVO)" → "PIS (não cumul.)" so the table fits.
function tableLabel(label) {
    return String(label || '')
        .replace(/\(NÃO CUMULATIVO\)/i, '(não cumul.)')
        .replace(/\(LUCRO REAL\)/i, '(Lucro Real)')
        .replace(/\(LUCRO PRESUMIDO\)/i, '(Presumido)');
}

function renderTaxRows(card, rows, summary = {}) {
    const container = card.querySelector('[data-ta-list="byTax"]');
    if (!container) return;

    if (!rows.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Sem movimento no período.</div>';
        return;
    }

    container.innerHTML = `
      <table class="tax-table">
        <thead>
          <tr><th>Imposto</th><th>Débito</th><th>Crédito</th><th>Saldo</th><th class="tax-col--status"></th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
        const status = statusOf(row);
        const title = [
            row.label,
            `Débito: ${moneyBR(row.debit)}`,
            `Crédito: ${moneyBR(row.credit)}`,
            row.balance >= 0 ? `A recolher: ${moneyBR(row.balance)}` : `Saldo credor: ${moneyBR(-row.balance)}`,
            row.estimated ? 'Valor estimado pelo Regime Tributário.' : '',
            row.note || '',
        ].filter(Boolean).join('\n');

        return `
              <tr title="${escapeHtml(title)}"${row.estimated ? ' class="is-estimated"' : ''}>
                <td>${escapeHtml(tableLabel(row.label))}</td>
                <td class="tax-debit">${formatNumber(row.debit)}</td>
                <td class="tax-credit">${formatNumber(row.credit)}</td>
                <td><strong class="tax-balance tax-balance--${status.tone}">${formatNumber(Math.abs(row.balance))}</strong></td>
                <td class="tax-col--status"><span class="tax-status tax-status--${status.tone}">${status.text}</span></td>
              </tr>`;
    }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td class="tax-debit">${formatNumber(summary.debits)}</td>
            <td class="tax-credit">${formatNumber(summary.credits)}</td>
            <td>${formatNumber(Number(summary.debits || 0) - Number(summary.credits || 0))}</td>
            <td class="tax-col--status"></td>
          </tr>
        </tfoot>
      </table>
      <p class="tax-panel__note">Passe o mouse em uma linha para ver o detalhe do imposto.</p>
    `;
}


// ======================================================================
// GRÁFICO: DÉBITO × CRÉDITO
// ======================================================================

// Deductions of the IRPJ/CSLL base are not tax credits: they are listed in
// "Resultado estimado", not here.
function renderBars(container, rows) {
    if (!container) return;

    if (!rows.length) {
        container.innerHTML = '<div class="analytics-product-pie__empty">Sem dados para exibir.</div>';
        return;
    }

    const visible = rows.slice(0, 8);
    const width = 360;
    const labelWidth = 62;
    const valueRoom = 56;
    const plotWidth = width - labelWidth - valueRoom;
    const barHeight = 13;
    const groupHeight = Math.max(36, Math.min(44, 230 / visible.length));
    const height = visible.length * groupHeight + 6;
    const maxValue = Math.max(...visible.map((row) => Math.max(row.debit, row.credit)), 1);
    const scale = (value) => (Math.max(0, Number(value || 0)) / maxValue) * plotWidth;

    const groups = visible.map((row, index) => {
        const y = 6 + index * groupHeight;
        const debitWidth = scale(row.debit);
        const creditWidth = scale(row.credit);
        const balance = Number(row.debit || 0) - Number(row.credit || 0);
        const showMarker = row.credit > 0 && row.debit > 0 && balance > 0;
        const creditLabelX = labelWidth + Math.max(creditWidth, 1, showMarker ? scale(balance) : 0) + 4;
        const marker = showMarker
            ? `<line x1="${(labelWidth + scale(balance)).toFixed(1)}" x2="${(labelWidth + scale(balance)).toFixed(1)}"
                 y1="${y - 3}" y2="${y + barHeight * 2 + 5}" stroke="${COLORS.balance}" stroke-width="2" stroke-dasharray="3 2">
                 <title>${escapeHtml(row.label)} — saldo a recolher ${moneyBR(balance)}</title></line>`
            : '';

        return `
          <g>
            <text class="tax-dc__label" x="${labelWidth - 8}" y="${y + barHeight + 1}" text-anchor="end" dominant-baseline="middle">${escapeHtml(shortLabel(row.label))}</text>
            <rect x="${labelWidth}" y="${y}" width="${Math.max(debitWidth, 1).toFixed(1)}" height="${barHeight}" rx="3" fill="${COLORS.debit}">
              <title>${escapeHtml(row.label)} — débito ${moneyBR(row.debit)}</title>
            </rect>
            <text class="tax-dc__value" x="${(labelWidth + debitWidth + 4).toFixed(1)}" y="${y + barHeight / 2 + 1}" dominant-baseline="middle" fill="${COLORS.debitText}">${formatNumber(row.debit)}</text>
            <rect x="${labelWidth}" y="${y + barHeight + 3}" width="${Math.max(creditWidth, 1).toFixed(1)}" height="${barHeight}" rx="3" fill="${COLORS.credit}">
              <title>${escapeHtml(row.label)} — crédito ${moneyBR(row.credit)}</title>
            </rect>
            <text class="tax-dc__value" x="${creditLabelX.toFixed(1)}" y="${y + barHeight * 1.5 + 4}" dominant-baseline="middle" fill="${COLORS.creditText}">${formatNumber(row.credit)}</text>
            ${marker}
          </g>`;
    }).join('');

    container.innerHTML = `
      <ul class="tax-legend tax-legend--inline">
        <li><i style="background:${COLORS.debit}"></i><span class="tax-legend__name">Débito</span></li>
        <li><i style="background:${COLORS.credit}"></i><span class="tax-legend__name">Crédito</span></li>
        <li><i class="is-line" style="background:${COLORS.balance}"></i><span class="tax-legend__name">Saldo a recolher</span></li>
      </ul>
      <svg class="tax-dc__svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
        ${groups}
      </svg>
    `;
}


// ======================================================================
// CRÉDITOS POR ORIGEM
// ======================================================================

function renderCredits(card, origins, summary = {}) {
    const container = card.querySelector('[data-ta-list="credits"]');
    if (!container) return;

    const items = origins
        .filter((origin) => Number(origin.value || 0) > 0)
        .sort((a, b) => Number(b.value) - Number(a.value))
        .map((origin, index) => ({
            label: tableLabel(origin.label) + (origin.estimated ? ' *' : ''),
            value: Number(origin.value || 0),
            color: COLORS.origins[index % COLORS.origins.length],
        }));

    if (!items.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Sem créditos no período.</div>';
        return;
    }

    const total = items.reduce((sum, item) => sum + item.value, 0);
    const estimated = origins.some((origin) => origin.estimated);

    container.innerHTML = `
      <div class="tax-donut__chart">
        ${donutSvg(items, { centerLabel: 'Créditos', centerValue: moneyBR(total), size: 170 })}
      </div>
      <div class="tax-donut__side">
        ${legendHtml(items, { showShare: false })}
        <p class="tax-panel__note">Aproveitamento: <strong>${formatNumber(creditShare(summary), 1)}%</strong> dos débitos</p>
        ${estimated ? '<p class="tax-panel__note">* calculado pela alíquota do regime (crédito não cumulativo)</p>' : ''}
      </div>
    `;
}


// ======================================================================
// RESULTADO ESTIMADO (IRPJ / CSLL)
// ======================================================================

function renderResult(card, result, rows, regime) {
    const container = card.querySelector('[data-ta-list="result"]');
    if (!container) return;

    const irpj = rows.find((row) => row.key === 'irpj');
    const csll = rows.find((row) => row.key === 'csll');
    const das = rows.find((row) => row.key === 'das');

    const bySub = Array.isArray(result.deductionsBySubcategory) ? result.deductionsBySubcategory : [];

    const lines = result.basis === 'caixa'
        ? [
            { label: 'Receita das vendas', value: result.revenue },
            {
                label: '(−) Saídas dedutíveis no IRPJ/CSLL',
                value: -Number(result.deductions || 0),
                hint: 'Saídas do Caixa com "Dedutível no IRPJ/CSLL" marcado (na movimentação ou na subcategoria). Valor + juros + multa + encargos; na opção "Só juros, multas e encargos", sem o valor principal.',
            },
            ...bySub.slice(0, 4).map((sub) => ({ label: sub.label, value: -Number(sub.value || 0), sub: true })),
            { label: '= Lucro estimado', value: result.profit, strong: true, share: true },
        ]
        : [
            { label: 'Receita das vendas', value: result.revenue },
            { label: '(−) Custo das mercadorias vendidas', value: -Number(result.costOfGoods || 0), hint: 'Quantidade vendida × preço de custo do cadastro do produto' },
            { label: '(−) Despesas lançadas', value: -Number(result.expenses || 0) },
            { label: '= Lucro estimado', value: result.profit, strong: true, share: true },
        ];

    const profit = Number(result.profit);
    const hasProfit = result.profit != null && Number.isFinite(profit);
    const rateOnProfit = (value) => (hasProfit && profit > 0 && result.method !== 'presumido'
        ? ` · ${formatNumber((Number(value || 0) / profit) * 100, 1)}%`
        : '');

    if (irpj) lines.push({ label: `(−) ${tableLabel(irpj.label)}${rateOnProfit(irpj.debit)}`, value: -Number(irpj.debit || 0), tax: true });
    if (csll) lines.push({ label: `(−) ${tableLabel(csll.label)}${rateOnProfit(csll.debit)}`, value: -Number(csll.debit || 0), tax: true });
    if (das) lines.push({ label: `(−) ${das.label}`, value: -Number(das.debit || 0), tax: true });

    if (hasProfit && (irpj || csll)) {
        const incomeTaxes = Number(irpj?.debit || 0) + Number(csll?.debit || 0);
        lines.push({
            label: '= Lucro após IRPJ/CSLL',
            value: profit - incomeTaxes,
            final: true,
            hint: profit > 0
                ? `IRPJ + CSLL = ${moneyBR(incomeTaxes)} (${formatNumber((incomeTaxes / profit) * 100, 1)}% do lucro estimado)`
                : '',
        });
    }

    const note = {
        presumido: 'IRPJ/CSLL pelo Lucro Presumido: calculados sobre a receita, não sobre o lucro.',
        lucro: result.basis === 'caixa'
            ? `IRPJ/CSLL pelo Lucro Real sobre o lucro acima. Saídas não dedutíveis fora da base: ${moneyBR(Number(result.nonDeductible || 0))}.`
            : 'IRPJ/CSLL pelo Lucro Real sobre o lucro estimado acima.',
        margem: 'IRPJ/CSLL pelo Lucro Real sobre a margem estimada do cadastro do regime.',
    }[result.method] || (
        ['SIMPLES', 'MEI'].includes(regime?.regime)
            ? 'No Simples o IRPJ e a CSLL estão dentro do DAS.'
            : regime ? 'Informe a margem estimada no Regime Tributário para estimar IRPJ/CSLL.'
                : 'Cadastre o Regime Tributário para estimar IRPJ e CSLL.'
    );

    container.innerHTML = `
      <div class="tax-assessment__result">
        ${lines.map((line) => `
          <div class="tax-assessment__result-line${line.strong ? ' is-strong' : ''}${line.tax ? ' is-tax' : ''}${line.sub ? ' is-sub' : ''}${line.final ? ' is-final' : ''}" ${line.hint ? `title="${escapeHtml(line.hint)}"` : ''}>
            <span>${escapeHtml(line.label)}</span>
            <strong>${moneyBR(Number(line.value || 0))}${line.share && Number(result.revenue) > 0
                ? ` <small>(${formatNumber((Number(line.value || 0) / Number(result.revenue)) * 100, 1)}%)</small>` : ''}</strong>
          </div>
        `).join('')}
        <p class="tax-assessment__result-note">${escapeHtml(note)}</p>
      </div>
    `;
}


// ======================================================================
// EXPORT — MEMÓRIA DE CÁLCULO (EXCEL / PDF)
// ======================================================================

function bindExport(card) {
    if (card.dataset.exportBound === 'true') return;

    card.querySelectorAll('[data-ta-export]').forEach((button) => {
        button.addEventListener('click', async () => {
            const format = button.dataset.taExport;
            const params = new URLSearchParams({ format });

            if (card.dataset.taStartDate) params.set('startDate', card.dataset.taStartDate);
            if (card.dataset.taEndDate) params.set('endDate', card.dataset.taEndDate);

            try {
                await downloadFile(`${ENDPOINT}/export?${params.toString()}`, button, `memoria_calculo_apuracao.${format}`);
            } catch (error) {
                console.error('[dashboard][tax-assessment] Failed to export:', error);
                warn('Não foi possível gerar a memória de cálculo.', 'error');
            }
        });
    });

    card.dataset.exportBound = 'true';
}


// ======================================================================
// FORMAT
// ======================================================================

function updatePeriodCaption(card, filters = {}) {
    const caption = card.querySelector('[data-ta-period-caption]');
    if (caption) caption.textContent = `${formatDateBR(filters.startDate)} até ${formatDateBR(filters.endDate)}`;
}

function setText(card, field, value) {
    const element = card.querySelector(`[data-ta-field="${field}"]`);
    if (element) element.textContent = value;
}

function shortLabel(label) {
    // "PIS (NÃO CUMULATIVO)" → "PIS" so the chart labels fit.
    return String(label || '').replace(/\s*\(.*\)\s*$/, '');
}
