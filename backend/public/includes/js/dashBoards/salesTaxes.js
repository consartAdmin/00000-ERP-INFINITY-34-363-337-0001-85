// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesTaxes.js — Dashboard: Impostos sobre Vendas                   ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Impostos por tipo (tabela) + composição em rosca com legenda     ║
// ║ ✅ Impostos por produto (tabela, carga colorida por faixa)          ║
// ║ ✅ Evolução mensal (6 meses) por imposto + carga %                  ║
// ║ ✅ KPIs comparados com o período anterior                          ║
// ║ ✅ Períodos: mês atual/anterior, trimestre, ano, personalizado      ║
// ║ ✅ Exportar Excel / PDF                                             ║
// ║                                                                      ║
// ║ Fonte: snapshot fiscal por item gravado na emissão da NF-e.         ║
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
    buildColorMap,
    colorFor,
    donutSvg,
    legendHtml,
    monthlyColumnsSvg,
    monthTitle,
    downloadFile,
    escapeHtml,
    formatPercentage,
    formatInteger,
} from './taxDashboardShared.js';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';


// ======================================================================
// CONFIG
// ======================================================================

const DASHBOARD_KEY =
    'sales-taxes';

const ENDPOINT =
    '/api/dashboard/sales-taxes';

// Rows shown before "Ver todos".
const PRODUCT_PREVIEW = 8;

const HISTORY_MONTHS = 6;

const RATE_LINE_COLOR = '#f97316';


// ======================================================================
// DASHBOARD
// ======================================================================

export const salesTaxesDashboard = {

    key: DASHBOARD_KEY,


    // ==================================================================
    // RENDER
    // ==================================================================

    render() {

        return `
          <article
            class="dash-card dash-card--analytics dash-card--taxes dash-card--block"
            data-dashboard-key="${DASHBOARD_KEY}"
          >

            <div class="sales-analytics sales-taxes">

              <section class="sales-analytics__period stock-lots-dash__top dash-block__top" aria-label="Filtro por período">
                <span class="stock-lots-dash__caption dash-block__caption">Impostos sobre vendas por tipo, por produto e evolução mensal</span>
                <label class="sales-analytics__period-field">
                  <span>Período</span>
                  <select data-tax-filter="periodMode">
                    ${PERIOD_OPTIONS_HTML}
                  </select>
                </label>

                <div class="sales-analytics__custom-dates" data-tax-period-custom hidden>
                  <label class="sales-analytics__period-field">
                    <span>Data inicial</span>
                    <input type="date" data-tax-filter="startDate" />
                  </label>

                  <label class="sales-analytics__period-field">
                    <span>Data final</span>
                    <input type="date" data-tax-filter="endDate" />
                  </label>

                  <button type="button" class="sales-analytics__period-apply" data-tax-action="applyPeriod">
                    Aplicar
                  </button>
                </div>

                <span class="sales-taxes__coverage" data-tax-coverage></span>
                <span class="sales-taxes__regime" data-tax-regime></span>

                <div class="tax-assessment__export" aria-label="Baixar impostos sobre vendas">
                  <button type="button" class="tax-assessment__export-btn is-xlsx" data-tax-export="xlsx"
                    title="Baixar os impostos do período em Excel">
                    Excel
                  </button>
                  <button type="button" class="tax-assessment__export-btn is-pdf" data-tax-export="pdf"
                    title="Baixar os impostos do período em PDF">
                    PDF
                  </button>
                </div>

                <span class="sales-analytics__period-caption" data-tax-period-caption></span>
                <a class="stock-lots-dash__link" href="/public/salesTaxCalculation/salesTaxCalculation.html" title="Abrir Cálculo de Impostos">Abrir Cálculo de Impostos →</a>
              </section>


              <!-- ==================================================== -->
              <!-- TAX PANELS                                           -->
              <!-- ==================================================== -->

              <section class="sales-analytics__abc-row">

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header">
                    <h3>IMPOSTOS POR TIPO</h3>
                  </header>
                  <div class="analytics-chart__body tax-panel__scroll" data-tax-list="byTax" aria-label="Impostos por tipo"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc">
                  <header class="analytics-chart__header">
                    <h3>COMPOSIÇÃO DOS IMPOSTOS</h3>
                  </header>
                  <div class="analytics-chart__body tax-donut" data-tax-chart="byTaxDonut"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header">
                    <h3>IMPOSTOS POR PRODUTO</h3>
                  </header>
                  <div class="analytics-chart__body tax-panel__scroll" data-tax-list="byProduct" aria-label="Impostos por produto"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc">
                  <header class="analytics-chart__header">
                    <h3>EVOLUÇÃO MENSAL (${HISTORY_MONTHS} MESES)</h3>
                  </header>
                  <div class="analytics-chart__body tax-columns" data-tax-chart="history"></div>
                </section>

              </section>


              <!-- ==================================================== -->
              <!-- KPI ROW                                              -->
              <!-- ==================================================== -->

              <section class="sales-analytics__kpi-row">

                <div class="analytics-kpi analytics-kpi--revenue kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">TOTAL FATURAMENTO</span>
                  <strong class="analytics-kpi__value" data-tax-field="revenue">R$ 0,00</strong>
                  <small class="tax-kpi-hint" data-tax-compare="revenue" hidden></small>
                </div>

                <div class="analytics-kpi analytics-kpi--taxes kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">TOTAL IMPOSTOS</span>
                  <strong class="analytics-kpi__value" data-tax-field="totalTaxes">R$ 0,00</strong>
                  <small class="tax-kpi-hint" data-tax-compare="totalTaxes" hidden></small>
                </div>

                <div class="analytics-kpi analytics-kpi--invoices kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">CARGA TRIBUTÁRIA SOBRE FATURAMENTO</span>
                  <strong class="analytics-kpi__value" data-tax-field="effectiveRate">0,00%</strong>
                  <small class="tax-kpi-hint" data-tax-compare="effectiveRate" hidden></small>
                </div>

                <div class="analytics-kpi analytics-kpi--ticket kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6">
                  <span class="analytics-kpi__label">LÍQUIDO APÓS IMPOSTOS</span>
                  <strong class="analytics-kpi__value" data-tax-field="netAfterTaxes">R$ 0,00</strong>
                  <small class="tax-kpi-hint" data-tax-compare="netAfterTaxes" hidden></small>
                </div>

              </section>

            </div>

          </article>
        `;
    },


    // ==================================================================
    // LOAD
    // ==================================================================

    async load(root) {

        const card = getCard(root);
        if (!card) return;

        try {
            bindPeriodFilter(card, 'tax', () => loadSalesTaxes(card), warn);
            bindExport(card);
            bindProductToggle(card);
            await loadSalesTaxes(card);
        } catch (error) {
            console.error('[dashboard][sales-taxes] Failed to load:', error);
            renderError(card);
        }
    },
};


// ======================================================================
// LOAD
// ======================================================================

function getCard(root) {
    return root.querySelector(`.dash-card[data-dashboard-key="${DASHBOARD_KEY}"]`);
}


function warn(message, variant = 'warning') {
    showCenterModal({ variant, title: variant === 'error' ? 'Erro' : 'Período', message: escapeHtml(message) });
}


async function loadSalesTaxes(card) {
    const period = readPeriod(card, 'tax');
    const data = await fetchDashboard(`${ENDPOINT}?${periodQuery(period)}`);

    console.log('[dashboard][sales-taxes] Response:', data);

    const summary = data?.summary || {};
    const filters = data?.filters || {};

    // Exports use the period on screen, not dates typed but not applied yet.
    card.dataset.taxStartDate = filters.startDate || '';
    card.dataset.taxEndDate = filters.endDate || '';

    updateSummary(card, summary);
    updateCoverage(card, summary, data?.sourcesAvailable !== false, data?.regime);
    updateRegime(card, data?.regime);
    updatePeriodCaption(card, filters);

    const byTax = (Array.isArray(data?.byTax) ? data.byTax : [])
        .filter((tax) => Number(tax?.value || 0) > 0);
    const counted = byTax.filter((tax) => !tax.informative);

    // One color per tax, shared by table, donut and monthly chart.
    const colors = buildColorMap(counted.map((tax) => tax.key));
    card._taxColors = colors;

    renderTaxTable(card, byTax, summary, colors);
    renderTaxDonut(card, counted, summary, colors);
    renderProductTable(card, Array.isArray(data?.byProduct) ? data.byProduct : []);

    // Secondary data: never blocks the main panels.
    const token = String(Date.now());
    card.dataset.taxLoadToken = token;

    loadComparison(card, period, filters, summary, token);
    loadHistory(card, filters, colors, token);
}


function renderError(card) {
    card.querySelectorAll('[data-tax-list], [data-tax-chart]').forEach((element) => {
        element.innerHTML =
            '<div class="analytics-abc-ranking__empty">Não foi possível carregar os impostos.</div>';
    });
}


// ======================================================================
// PERIOD CAPTION
// ======================================================================

function updatePeriodCaption(card, filters = {}) {
    const caption = card.querySelector('[data-tax-period-caption]');
    if (caption) caption.textContent = `${formatDateBR(filters.startDate)} até ${formatDateBR(filters.endDate)}`;
}


// ======================================================================
// SUMMARY + COMPARISON
// ======================================================================

function netAfterTaxes(summary) {
    return summary?.netAfterTaxes != null
        ? Number(summary.netAfterTaxes)
        : Number(summary?.coveredRevenue || 0) - Number(summary?.totalTaxes || 0);
}

function updateSummary(card, summary) {
    setText(card, 'revenue', moneyBR(Number(summary?.totalRevenue || 0)));
    setText(card, 'totalTaxes', moneyBR(Number(summary?.totalTaxes || 0)));
    setText(card, 'effectiveRate', formatPercentage(summary?.effectiveRate));
    setText(card, 'netAfterTaxes', moneyBR(netAfterTaxes(summary)));

    ['revenue', 'totalTaxes', 'effectiveRate', 'netAfterTaxes'].forEach((field) => {
        setKpiHint(card, `[data-tax-compare="${field}"]`, '');
    });
}

async function loadComparison(card, period, filters, summary, token) {
    const previous = previousRange(period.mode, filters.startDate, filters.endDate);
    if (!previous) return;

    try {
        const data = await fetchDashboard(`${ENDPOINT}?${periodQuery(previous)}`);
        if (card.dataset.taxLoadToken !== token) return;

        const before = data?.summary || {};
        const label = previous.label;

        setKpiHint(card, '[data-tax-compare="revenue"]',
            comparisonHtml(summary.totalRevenue, before.totalRevenue, label));
        setKpiHint(card, '[data-tax-compare="totalTaxes"]',
            comparisonHtml(summary.totalTaxes, before.totalTaxes, label, { invert: true }));
        setKpiHint(card, '[data-tax-compare="effectiveRate"]',
            `<span class="tax-kpi-delta is-flat" title="${formatDateBR(previous.startDate)} até ${formatDateBR(previous.endDate)}">` +
            `${escapeHtml(label)}: ${formatPercentage(before.effectiveRate)}</span>`);
        setKpiHint(card, '[data-tax-compare="netAfterTaxes"]',
            comparisonHtml(netAfterTaxes(summary), netAfterTaxes(before), label));
    } catch (error) {
        console.warn('[dashboard][sales-taxes] Comparison unavailable:', error);
    }
}


// ======================================================================
// IMPOSTOS POR TIPO
// ======================================================================

function cleanInformativeLabel(label) {
    return String(label || '').replace(/\s*\(INFORMATIVO[^)]*\)\s*/i, '').trim();
}

function renderTaxTable(card, items, summary, colors) {
    const container = card.querySelector('[data-tax-list="byTax"]');
    if (!container) return;

    const counted = items.filter((tax) => !tax.informative);
    const informative = items.filter((tax) => tax.informative);

    if (!items.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Sem impostos no período.</div>';
        return;
    }

    const rows = counted.map((tax) => {
        const title = `${tax.label} — ${moneyBR(tax.value)} — ${formatPercentage(tax.rateOverRevenue)} do faturamento — ` +
            `${formatPercentage(tax.percentage, 1)} dos impostos` +
            (tax.estimated ? ' — estimado pelo Regime Tributário cadastrado' : '');

        return `
          <tr title="${escapeHtml(title)}"${tax.estimated ? ' class="is-estimated"' : ''}>
            <td><i class="tax-dot" style="background:${colorFor(colors, tax.key)}"></i>${escapeHtml(tax.label)}</td>
            <td>${moneyBR(tax.value)}</td>
            <td>${formatPercentage(tax.rateOverRevenue)}</td>
            <td><strong>${formatPercentage(tax.percentage, 1)}</strong></td>
          </tr>`;
    }).join('');

    const informativeBlock = informative.length ? `
      <div class="tax-informative" title="Valores informativos: não entram no total de impostos.">
        <div class="tax-informative__title">Reforma tributária · informativo, fora do total</div>
        ${informative.map((tax) => `
          <div class="tax-informative__row">
            <span>${escapeHtml(cleanInformativeLabel(tax.label))} (${formatPercentage(tax.rateOverRevenue)})</span>
            <strong>${moneyBR(tax.value)}</strong>
          </div>`).join('')}
      </div>` : '';

    container.innerHTML = `
      <table class="tax-table">
        <thead>
          <tr><th>Imposto</th><th>Valor</th><th>% fatur.</th><th>% impostos</th></tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="4" class="tax-table__empty">Sem impostos somados no período.</td></tr>'}
        </tbody>
        ${counted.length ? `
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td>${moneyBR(summary?.totalTaxes)}</td>
            <td>${formatPercentage(summary?.effectiveRate)}</td>
            <td>100%</td>
          </tr>
        </tfoot>` : ''}
      </table>
      ${informativeBlock}
    `;
}


// ======================================================================
// COMPOSIÇÃO (ROSCA)
// ======================================================================

function renderTaxDonut(card, counted, summary, colors) {
    const container = card.querySelector('[data-tax-chart="byTaxDonut"]');
    if (!container) return;

    if (!counted.length) {
        container.innerHTML = '<div class="analytics-product-pie__empty">Sem dados para exibir.</div>';
        return;
    }

    const items = counted.map((tax) => ({
        label: tax.label,
        value: Number(tax.value || 0),
        color: colorFor(colors, tax.key),
    }));

    container.innerHTML = `
      <div class="tax-donut__chart">
        ${donutSvg(items, { centerLabel: 'Total', centerValue: moneyBR(summary?.totalTaxes) })}
      </div>
      ${legendHtml(items)}
    `;
}


// ======================================================================
// IMPOSTOS POR PRODUTO
// ======================================================================

function rateTone(rate) {
    const value = Number(rate || 0);
    if (value > 20) return 'high';
    if (value > 10) return 'mid';
    return 'low';
}

function renderProductTable(card, items) {
    const container = card.querySelector('[data-tax-list="byProduct"]');
    if (!container) return;

    if (!items.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Sem impostos no período.</div>';
        return;
    }

    const expanded = card.dataset.taxProductsExpanded === 'true';
    const visible = expanded ? items : items.slice(0, PRODUCT_PREVIEW);

    container.classList.toggle('is-expanded', expanded);
    container.innerHTML = `
      <table class="tax-table tax-table--products">
        <thead>
          <tr><th>Produto</th><th class="tax-col--sold">Vendido</th><th>Imposto</th><th>Carga</th></tr>
        </thead>
        <tbody>
          ${visible.map((item) => `
            <tr title="${escapeHtml(item.label)} — impostos ${moneyBR(item.value)} sobre ${moneyBR(item.netTotal)} vendidos — carga ${formatPercentage(item.effectiveRate)}">
              <td class="tax-table__product">${escapeHtml(item.label)}</td>
              <td class="tax-col--sold">${moneyBR(item.netTotal)}</td>
              <td><strong>${moneyBR(item.value)}</strong></td>
              <td><span class="tax-rate tax-rate--${rateTone(item.effectiveRate)}">${formatPercentage(item.effectiveRate)}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tax-table__footer">
        <span class="tax-rate-legend">Carga:
          <span class="tax-rate tax-rate--low">até 10%</span>
          <span class="tax-rate tax-rate--mid">10–20%</span>
          <span class="tax-rate tax-rate--high">acima de 20%</span>
        </span>
        ${items.length > PRODUCT_PREVIEW ? `
          <button type="button" class="tax-link" data-tax-action="toggleProducts">
            ${expanded ? 'Ver menos' : `Ver todos (${formatInteger(items.length)})`}
          </button>` : ''}
      </div>
    `;

    card._taxProducts = items;
}

function bindProductToggle(card) {
    if (card.dataset.productToggleBound === 'true') return;

    card.addEventListener('click', (event) => {
        if (!event.target.closest('[data-tax-action="toggleProducts"]')) return;

        card.dataset.taxProductsExpanded = card.dataset.taxProductsExpanded === 'true' ? 'false' : 'true';
        renderProductTable(card, card._taxProducts || []);
    });

    card.dataset.productToggleBound = 'true';
}


// ======================================================================
// EVOLUÇÃO MENSAL
// ======================================================================

async function loadHistory(card, filters, colors, token) {
    const container = card.querySelector('[data-tax-chart="history"]');
    if (!container) return;

    container.innerHTML = '<div class="analytics-product-pie__empty">Carregando evolução...</div>';

    try {
        const params = new URLSearchParams({ months: String(HISTORY_MONTHS) });
        if (filters.endDate) params.set('endDate', filters.endDate);

        const data = await fetchDashboard(`${ENDPOINT}/history?${params.toString()}`);
        if (card.dataset.taxLoadToken !== token) return;

        renderHistory(container, Array.isArray(data?.months) ? data.months : [], colors);
    } catch (error) {
        console.warn('[dashboard][sales-taxes] History unavailable:', error);
        if (card.dataset.taxLoadToken === token) {
            container.innerHTML = '<div class="analytics-product-pie__empty">Evolução indisponível.</div>';
        }
    }
}

function renderHistory(container, months, colors) {
    if (!months.length || !months.some((month) => Number(month.totalTaxes) > 0)) {
        container.innerHTML = '<div class="analytics-product-pie__empty">Sem impostos nos últimos meses.</div>';
        return;
    }

    // Series ordered by the total of the whole window, biggest at the bottom.
    const totals = new Map();
    const labels = new Map();
    months.forEach((month) => (month.byTax || []).forEach((tax) => {
        totals.set(tax.key, (totals.get(tax.key) || 0) + Number(tax.value || 0));
        labels.set(tax.key, tax.label);
    }));

    const keys = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
    const series = keys.map((key) => ({
        label: labels.get(key),
        color: colorFor(colors, key),
        values: months.map((month) => Number((month.byTax || []).find((tax) => tax.key === key)?.value || 0)),
    }));

    const monthInfo = months.map((month) => ({ ...month, title: monthTitle(month) }));
    const partial = months.find((month) => month.partial);

    container.innerHTML = `
      ${monthlyColumnsSvg({
        months: monthInfo,
        series,
        mode: 'stacked',
        line: {
            label: 'Carga',
            color: RATE_LINE_COLOR,
            values: months.map((month) => Number(month.effectiveRate || 0)),
            format: (value) => formatPercentage(value),
        },
    })}
      <ul class="tax-legend tax-legend--inline">
        ${series.map((item) => `<li><i style="background:${item.color}"></i><span class="tax-legend__name">${escapeHtml(item.label)}</span></li>`).join('')}
        <li><i class="is-line" style="background:${RATE_LINE_COLOR}"></i><span class="tax-legend__name">Carga %</span></li>
      </ul>
      ${partial ? `<p class="tax-columns__note">* ${escapeHtml(partial.label)} até ${formatDateBR(partial.endDate)}</p>` : ''}
    `;
}


// ======================================================================
// EXPORT
// ======================================================================

function bindExport(card) {
    if (card.dataset.exportBound === 'true') return;

    card.querySelectorAll('[data-tax-export]').forEach((button) => {
        button.addEventListener('click', async () => {
            const format = button.dataset.taxExport;
            const params = new URLSearchParams({ format });

            if (card.dataset.taxStartDate) params.set('startDate', card.dataset.taxStartDate);
            if (card.dataset.taxEndDate) params.set('endDate', card.dataset.taxEndDate);

            try {
                await downloadFile(`${ENDPOINT}/export?${params.toString()}`, button, `impostos_vendas.${format}`);
            } catch (error) {
                console.error('[dashboard][sales-taxes] Failed to export:', error);
                warn('Não foi possível gerar o arquivo de impostos.', 'error');
            }
        });
    });

    card.dataset.exportBound = 'true';
}


// ======================================================================
// CHIPS (REGIME / COBERTURA)
// ======================================================================

function updateRegime(card, regime) {
    const element = card.querySelector('[data-tax-regime]');
    if (!element) return;

    element.classList.toggle('sales-taxes__regime--missing', !regime);

    if (!regime) {
        element.textContent = 'Regime não cadastrado';
        element.title = 'Cadastre o Regime Tributário da empresa para estimar DAS, IRPJ e CSLL neste painel.';
        return;
    }

    element.textContent = regime.label;
    element.title = regime.summary || regime.label;
}


function updateCoverage(card, summary, sourcesAvailable, regime) {
    const element = card.querySelector('[data-tax-coverage]');
    if (!element) return;

    const total = Number(summary?.totalInvoices || 0);
    const covered = Number(summary?.coveredInvoices || 0);
    const missing = Math.max(0, total - covered);

    element.classList.toggle('sales-taxes__coverage--warning', missing > 0 || !sourcesAvailable);

    if (!sourcesAvailable) {
        element.textContent = 'Impostos não registrados nas notas emitidas';
        element.title = 'As tabelas de emissão de NF-e com os impostos por item não foram encontradas.';
        return;
    }

    if (!total) {
        element.textContent = 'Nenhuma nota no período';
        element.title = '';
        return;
    }

    const items = Number(summary?.items || 0);
    const itemsWithRates = Number(summary?.itemsWithRates || 0);

    // Simples/MEI notes carry no item rates by design: the DAS estimate covers them.
    const simplesLike = ['SIMPLES', 'MEI'].includes(regime?.regime);

    if (!simplesLike && covered > 0 && items > 0 && itemsWithRates === 0) {
        element.classList.add('sales-taxes__coverage--warning');
        element.textContent = 'Produtos sem alíquotas na emissão';
        element.title = 'As notas do período foram emitidas sem alíquotas de ICMS/PIS/COFINS. ' +
            'Configure o Perfil Fiscal e a Classificação Fiscal dos produtos (e o CRT da empresa) ' +
            'para que as próximas notas tragam os impostos.';
        return;
    }

    element.textContent = missing > 0
        ? `${formatInteger(covered)} de ${formatInteger(total)} notas com impostos`
        : `${formatInteger(total)} notas com impostos`;

    element.title = missing > 0
        ? `${formatInteger(missing)} nota(s) do período não têm os impostos gravados na emissão e ficaram fora do cálculo. ` +
        'Líquido e carga tributária consideram apenas as notas com impostos.'
        : 'Todas as notas do período têm os impostos gravados na emissão.';
}


function setText(card, field, value) {
    const element = card.querySelector(`[data-tax-field="${field}"]`);
    if (element) element.textContent = value;
}
