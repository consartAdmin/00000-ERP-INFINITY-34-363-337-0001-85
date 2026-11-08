// ╔══════════════════════════════════════════════════════════════════════╗
// ║ stockReplenishment.js — Dashboard: Reposição de estoque (Início)    ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Comprar agora (no ponto de pedido ou abaixo)                     ║
// ║ ✅ Pedido mínimo por fornecedor (Σ comprar × cost_price)            ║
// ║ ✅ Vai faltar nos próximos 30 dias (pedir até)                      ║
// ║ ✅ Cobertura do estoque em dias                                      ║
// ║ ✅ KPIs: itens p/ comprar, compra estimada, fornecedors prontos,    ║
// ║          acima do máximo                                             ║
// ║                                                                      ║
// ║ Fonte: GET /api/productsStock/replenishment/dashboard                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { moneyBR, fetchDashboard } from './dashboardUtils.js';
import { monthlyColumnsSvg, escapeHtml, formatInteger } from './taxDashboardShared.js';

const DASHBOARD_KEY = 'stock-replenishment';
const ENDPOINT = '/api/productsStock/replenishment/dashboard';
const MODULE_URL = '/public/productsStock/productsStock.html';

function qty(value) {
    return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function dayMonth(value) {
    const iso = String(value || '').slice(0, 10);
    if (!iso) return '—';
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
}

function getCard(root) {
    return root.querySelector(`.dash-card[data-dashboard-key="${DASHBOARD_KEY}"]`);
}

export const stockReplenishmentDashboard = {

    key: DASHBOARD_KEY,

    render() {
        return `
          <article class="dash-card dash-card--analytics dash-card--replenishment dash-card--block" data-dashboard-key="${DASHBOARD_KEY}">
            <div class="sales-analytics stock-lots-dash">

              <section class="sales-analytics__period stock-lots-dash__top">
                <span class="stock-lots-dash__caption" data-rep-caption>Carregando reposição…</span>
                <a class="stock-lots-dash__link" href="${MODULE_URL}" title="Abrir Estoque Mín./Máx.">Abrir Estoque Mín./Máx. →</a>
              </section>

              <section class="sales-analytics__abc-row">

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header"><h3>COMPRAR AGORA</h3></header>
                  <div class="analytics-chart__body tax-panel__scroll" data-rep-list="buy"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header"><h3>PEDIDO MÍNIMO POR FORNECEDOR</h3></header>
                  <div class="analytics-chart__body tax-panel__scroll" data-rep-list="orders"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header"><h3>VAI FALTAR NOS PRÓXIMOS 30 DIAS</h3></header>
                  <div class="analytics-chart__body tax-panel__scroll" data-rep-list="soon"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc">
                  <header class="analytics-chart__header"><h3>COBERTURA DO ESTOQUE (DIAS)</h3></header>
                  <div class="analytics-chart__body tax-columns" data-rep-chart="coverage"></div>
                </section>

              </section>

              <section class="sales-analytics__kpi-row">
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#dc2626" href="${MODULE_URL}">
                  <span class="analytics-kpi__label">ITENS PARA COMPRAR AGORA</span>
                  <strong class="analytics-kpi__value" data-rep-field="buyItems">0</strong>
                  <small class="stock-lots-kpi__hint" data-rep-field="buyHint">no ponto de pedido ou abaixo</small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#1d4ed8" href="${MODULE_URL}">
                  <span class="analytics-kpi__label">COMPRA ESTIMADA</span>
                  <strong class="analytics-kpi__value" data-rep-field="buyValue">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint">comprar × custo do produto</small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#7c3aed" href="${MODULE_URL}">
                  <span class="analytics-kpi__label">FORNECEDORS PRONTOS P/ PEDIR</span>
                  <strong class="analytics-kpi__value" data-rep-field="readyValue">0 de 0</strong>
                  <small class="stock-lots-kpi__hint" data-rep-field="readyHint"></small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#0891b2" href="${MODULE_URL}">
                  <span class="analytics-kpi__label">ACIMA DO MÁXIMO</span>
                  <strong class="analytics-kpi__value" data-rep-field="overValue">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint" data-rep-field="overHint"></small>
                </a>
              </section>

            </div>
          </article>
        `;
    },

    async load(root) {
        const card = getCard(root);
        if (!card) return;
        try {
            const data = await fetchDashboard(`${ENDPOINT}?limit=6`);
            renderAll(card, data || {});
        } catch (error) {
            console.error('[dashboard][stock-replenishment] Failed to load:', error);
            card.querySelector('[data-rep-caption]').textContent = 'Não foi possível carregar a reposição de estoque.';
            card.querySelectorAll('[data-rep-list], [data-rep-chart]').forEach((el) => {
                el.innerHTML = '<div class="analytics-abc-ranking__empty">Sem dados.</div>';
            });
        }
    },
};

function setField(card, field, text) {
    const el = card.querySelector(`[data-rep-field="${field}"]`);
    if (el) el.textContent = text;
}

function renderAll(card, data) {
    const s = data.settings || {};
    const situations = Array.isArray(data.situations) ? data.situations : [];
    const by = (key) => situations.find((x) => x.key === key) || { items: 0, buy_value: 0, over_value: 0, color: '#64748b' };

    card.querySelector('[data-rep-caption]').textContent =
        `REPOSIÇÃO DE ESTOQUE · mínimo, máximo e prazo de entrega do fornecedor · consumo dos últimos ${s.consumption_days || 90} dias`;

    renderBuy(card, data.buyNow || [], by('BUY').items + by('ZERO_SALES').items);
    renderOrders(card, data.orders || []);
    renderSoon(card, data.willRunOut || [], data.willRunOutTotal || 0, situations);
    renderCoverage(card, data.coverage || []);

    const buy = by('BUY');
    const zero = by('ZERO_SALES');
    const over = by('OVER');
    const orders = data.orders || [];
    const withMin = orders.filter((o) => o.min_order_value > 0);
    const ready = withMin.filter((o) => o.reached).length;

    setField(card, 'buyItems', formatInteger(buy.items + zero.items));
    setField(card, 'buyHint', `no ponto de pedido ou abaixo · ${formatInteger(zero.items)} zerado(s) com venda`);
    setField(card, 'buyValue', moneyBR(buy.buy_value + zero.buy_value));
    setField(card, 'readyValue', `${formatInteger(ready)} de ${formatInteger(withMin.length)}`);
    setField(card, 'readyHint', withMin.length
        ? 'atingem o pedido mínimo'
        : 'cadastre o pedido mínimo em Parâmetros de reposição');
    setField(card, 'overValue', moneyBR(over.over_value));
    setField(card, 'overHint', `${formatInteger(over.items)} itens · capital parado`);
}

function renderBuy(card, rows, total) {
    const container = card.querySelector('[data-rep-list="buy"]');
    if (!rows.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Nenhum produto no ponto de pedido.</div>';
        return;
    }
    container.innerHTML = `
      <table class="tax-table tax-table--products">
        <thead><tr><th>Produto</th><th>Atual</th><th>Ponto</th><th>Comprar</th><th>Chega</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr title="${escapeHtml(`${r.product_code || ''} ${r.product_description || ''} · ${r.supplier_name || 'sem fornecedor'} · prazo ${r.lead_days} d`)}">
              <td class="tax-table__product">${escapeHtml(r.product_description || r.product_code || '—')}</td>
              <td${r.stock_qty <= 0 ? ' style="color:#7c3aed;font-weight:800"' : ''}>${qty(r.stock_qty)}</td>
              <td>${qty(Math.round(r.reorder_point))}</td>
              <td><strong>${qty(r.suggestion)}</strong></td>
              <td>${dayMonth(r.arrives_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tax-table__footer">
        <span class="tax-rate-legend">Ordenado pelo que acaba primeiro</span>
        <a class="tax-link" href="${MODULE_URL}">Ver todos (${formatInteger(total)})</a>
      </div>`;
}

function renderOrders(card, orders) {
    const container = card.querySelector('[data-rep-list="orders"]');
    if (!orders.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Nenhum fornecedor com itens para comprar.</div>';
        return;
    }
    const pill = (o) => {
        if (!(o.min_order_value > 0)) return '<span class="stock-lots-dash__pill" style="--lc:#64748b">sem mínimo</span>';
        return o.reached
            ? '<span class="stock-lots-dash__pill" style="--lc:#16a34a">pode pedir</span>'
            : `<span class="stock-lots-dash__pill" style="--lc:#d97706">faltam ${moneyBR(o.missing)}</span>`;
    };
    container.innerHTML = `
      <table class="tax-table tax-table--products">
        <thead><tr><th>Fornecedor</th><th>Sugerido</th><th>Mínimo</th><th>Situação</th></tr></thead>
        <tbody>
          ${orders.slice(0, 8).map((o) => `
            <tr title="${escapeHtml(`${o.supplier_name} · ${o.items} item(ns) · prazo ${o.lead_days} d`)}">
              <td class="tax-table__product">${escapeHtml(o.supplier_name)}</td>
              <td><strong>${moneyBR(o.total)}</strong></td>
              <td>${o.min_order_value > 0 ? moneyBR(o.min_order_value) : '—'}</td>
              <td>${pill(o)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tax-table__footer">
        <span class="tax-rate-legend">Sugerido = comprar × custo (cost_price)</span>
        <a class="tax-link" href="${MODULE_URL}">Pedidos por fornecedor</a>
      </div>`;
}

function renderSoon(card, rows, total, situations) {
    const container = card.querySelector('[data-rep-list="soon"]');
    const colorOf = (key) => situations.find((s) => s.key === key)?.color || '#d97706';
    if (!rows.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Nada vai faltar nos próximos 30 dias.</div>';
        return;
    }
    container.innerHTML = `
      <table class="tax-table tax-table--products">
        <thead><tr><th>Produto</th><th>Cobertura</th><th>Acaba em</th><th>Pedir até</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr title="${escapeHtml(`${r.product_code || ''} ${r.product_description || ''} · prazo ${r.lead_days} d`)}">
              <td class="tax-table__product">${escapeHtml(r.product_description || r.product_code || '—')}</td>
              <td><span class="stock-lots-dash__pill" style="--lc:${escapeHtml(colorOf(r.situation))}">${formatInteger(Math.floor(r.coverage_days))} d</span></td>
              <td>${dayMonth(r.runs_out_at)}</td>
              <td>${dayMonth(r.order_by)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tax-table__footer">
        <span class="tax-rate-legend">Pedir até = acaba em − prazo do fornecedor</span>
        <a class="tax-link" href="${MODULE_URL}">Ver todos (${formatInteger(total)})</a>
      </div>`;
}

function renderCoverage(card, buckets) {
    const container = card.querySelector('[data-rep-chart="coverage"]');
    if (!buckets.length || !buckets.some((b) => b.value > 0)) {
        container.innerHTML = '<div class="analytics-product-pie__empty">Sem produtos com consumo no período.</div>';
        return;
    }
    container.innerHTML = `
      ${monthlyColumnsSvg({
        months: buckets.map((b) => ({ label: b.label, title: `${b.label}: ${formatInteger(b.value)} produto(s)` })),
        series: [{ label: 'Produtos', color: '#1d4ed8', values: buckets.map((b) => Number(b.value || 0)) }],
        mode: 'stacked',
        format: (v) => formatInteger(v),
    })}
      <div class="tax-columns__note">Quantos produtos duram cada faixa de dias, pelo consumo médio</div>`;
}
