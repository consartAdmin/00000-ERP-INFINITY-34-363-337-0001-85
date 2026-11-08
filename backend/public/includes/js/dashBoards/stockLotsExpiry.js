// ╔══════════════════════════════════════════════════════════════════════╗
// ║ stockLotsExpiry.js — Dashboard: Validade dos lotes (Início)         ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Lotes por situação (faixas de Estoque por Lote → Alertas)        ║
// ║ ✅ Valor em estoque por situação (rosca)                            ║
// ║ ✅ Próximos a vencer (FEFO)                                          ║
// ║ ✅ Vencimentos por mês (próximos 6 meses)                           ║
// ║ ✅ KPIs: vencido, primeira faixa, bloqueados, sem validade          ║
// ║                                                                      ║
// ║ Fonte: GET /api/productsStockLots/dashboard                          ║
// ║ Liga/desliga: "Card no Dashboard / início" nos parâmetros de alerta ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { moneyBR, fetchDashboard } from './dashboardUtils.js';
import {
    donutSvg,
    legendHtml,
    monthlyColumnsSvg,
    escapeHtml,
    formatInteger,
} from './taxDashboardShared.js';

const DASHBOARD_KEY = 'stock-lots-expiry';
const ENDPOINT = '/api/productsStockLots/dashboard';
const MODULE_URL = '/public/productsStockLots/productsStockLots.html';
const MONTHS = 6;
const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function qty(value) {
    return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function dateBR(value) {
    const iso = String(value || '').slice(0, 10);
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function lotsLabel(n) {
    return `${formatInteger(n)} ${Number(n) === 1 ? 'lote' : 'lotes'}`;
}

function getCard(root) {
    return root.querySelector(`.dash-card[data-dashboard-key="${DASHBOARD_KEY}"]`);
}

export const stockLotsExpiryDashboard = {

    key: DASHBOARD_KEY,

    render() {
        return `
          <article class="dash-card dash-card--analytics dash-card--lots dash-card--block" data-dashboard-key="${DASHBOARD_KEY}">
            <div class="sales-analytics stock-lots-dash">

              <section class="sales-analytics__period stock-lots-dash__top">
                <span class="stock-lots-dash__caption" data-lots-caption>Carregando lotes…</span>
                <a class="stock-lots-dash__link" href="${MODULE_URL}" title="Abrir Estoque por Lote">Abrir Estoque por Lote →</a>
              </section>

              <div class="stock-lots-dash__off" data-lots-off hidden>
                O card de validade está desligado em <b>Estoque por Lote → Alertas de validade → Card no Dashboard / início</b>.
              </div>

              <section class="sales-analytics__abc-row" data-lots-panels>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header"><h3>LOTES POR SITUAÇÃO</h3></header>
                  <div class="analytics-chart__body tax-panel__scroll" data-lots-list="situations"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc">
                  <header class="analytics-chart__header"><h3>VALOR EM ESTOQUE POR SITUAÇÃO</h3></header>
                  <div class="analytics-chart__body tax-donut" data-lots-chart="donut"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc analytics-chart--ranking">
                  <header class="analytics-chart__header"><h3>PRÓXIMOS A VENCER</h3></header>
                  <div class="analytics-chart__body tax-panel__scroll" data-lots-list="upcoming"></div>
                </section>

                <section class="analytics-chart analytics-chart--abc">
                  <header class="analytics-chart__header"><h3>VENCIMENTOS POR MÊS (${MONTHS} MESES)</h3></header>
                  <div class="analytics-chart__body tax-columns" data-lots-chart="months"></div>
                </section>

              </section>

              <section class="sales-analytics__kpi-row" data-lots-kpis>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#dc2626" href="${MODULE_URL}" data-lots-kpi="expired">
                  <span class="analytics-kpi__label">VALOR VENCIDO EM ESTOQUE</span>
                  <strong class="analytics-kpi__value" data-lots-field="expiredValue">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint" data-lots-field="expiredHint"></small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#ea580c" href="${MODULE_URL}" data-lots-kpi="first">
                  <span class="analytics-kpi__label" data-lots-field="firstLabel">VENCE EM ATÉ 30 DIAS</span>
                  <strong class="analytics-kpi__value" data-lots-field="firstValue">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint" data-lots-field="firstHint"></small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#d97706" href="${MODULE_URL}" data-lots-kpi="window">
                  <span class="analytics-kpi__label" data-lots-field="windowLabel">VENCE EM ATÉ 180 DIAS</span>
                  <strong class="analytics-kpi__value" data-lots-field="windowValue">R$ 0,00</strong>
                  <small class="stock-lots-kpi__hint" data-lots-field="windowHint"></small>
                </a>
                <a class="analytics-kpi stock-lots-kpi kpi-w-20 kpi-h-2 kpi-p-1 kpi-radius-6" style="--lk:#64748b" href="${MODULE_URL}" data-lots-kpi="pending">
                  <span class="analytics-kpi__label">SEM VALIDADE · BLOQUEADOS</span>
                  <strong class="analytics-kpi__value" data-lots-field="pendingValue">0 · 0</strong>
                  <small class="stock-lots-kpi__hint" data-lots-field="pendingHint"></small>
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
            const data = await fetchDashboard(`${ENDPOINT}?months=${MONTHS}&limit=8`);
            renderAll(card, data || {});
        } catch (error) {
            console.error('[dashboard][stock-lots-expiry] Failed to load:', error);
            renderError(card, error);
        }
    },
};

function setField(card, field, text) {
    const el = card.querySelector(`[data-lots-field="${field}"]`);
    if (el) el.textContent = text;
}

function renderError(card, error) {
    const lotMode = /lote/i.test(String(error?.message || ''));
    card.querySelector('[data-lots-caption]').textContent = lotMode
        ? 'O estoque desta empresa não está no modo por lote.'
        : 'Não foi possível carregar a validade dos lotes.';
    card.querySelectorAll('[data-lots-list], [data-lots-chart]').forEach((el) => {
        el.innerHTML = '<div class="analytics-abc-ranking__empty">Sem dados.</div>';
    });
}

function renderAll(card, data) {
    const situations = Array.isArray(data.situations) ? data.situations : [];
    const enabled = data.enabled !== false;

    card.querySelector('[data-lots-off]').hidden = enabled;
    card.querySelector('[data-lots-panels]').hidden = !enabled;
    card.querySelector('[data-lots-kpis]').hidden = !enabled;

    const total = situations.reduce((sum, s) => sum + Number(s.lots || 0), 0);
    card.querySelector('[data-lots-caption]').textContent = enabled
        ? `${lotsLabel(total)} com saldo · faixas definidas em Alertas de validade`
        : 'Validade dos lotes';
    if (!enabled) return;

    renderSituations(card, situations);
    renderDonut(card, situations);
    renderUpcoming(card, Array.isArray(data.upcoming) ? data.upcoming : [], situations);
    renderMonths(card, Array.isArray(data.byMonth) ? data.byMonth : [], situations);
    renderKpis(card, data, situations);
}

function renderSituations(card, situations) {
    const container = card.querySelector('[data-lots-list="situations"]');
    const sumLots = situations.reduce((s, x) => s + x.lots, 0);
    const sumValue = situations.reduce((s, x) => s + x.value, 0);

    container.innerHTML = `
      <table class="tax-table">
        <thead><tr><th>Situação</th><th>Lotes</th><th>Qtd.</th><th>Valor</th></tr></thead>
        <tbody>
          ${situations.map((s) => `
            <tr title="${escapeHtml(s.label)}${s.days !== undefined ? ` — vence em até ${s.days} dias` : ''}">
              <td><i class="tax-dot" style="background:${escapeHtml(s.color)}"></i>${escapeHtml(s.label)}${s.days !== undefined ? ` <small class="stock-lots-dash__days">≤ ${s.days} d</small>` : ''}</td>
              <td>${formatInteger(s.lots)}</td>
              <td>${qty(s.qty)}</td>
              <td><strong>${moneyBR(s.value)}</strong></td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><td>TOTAL</td><td>${formatInteger(sumLots)}</td><td></td><td>${moneyBR(sumValue)}</td></tr></tfoot>
      </table>`;
}

function renderDonut(card, situations) {
    const container = card.querySelector('[data-lots-chart="donut"]');
    const items = situations
        .filter((s) => s.value > 0)
        .map((s) => ({ label: s.label, value: s.value, color: s.color }));

    if (!items.length) {
        container.innerHTML = '<div class="analytics-product-pie__empty">Sem lotes com custo para exibir.</div>';
        return;
    }

    const total = items.reduce((sum, item) => sum + item.value, 0);
    container.innerHTML = `
      <div class="tax-donut__chart">${donutSvg(items, { centerLabel: 'Em estoque', centerValue: moneyBR(total) })}</div>
      ${legendHtml(items)}`;
}

function renderUpcoming(card, rows, situations) {
    const container = card.querySelector('[data-lots-list="upcoming"]');
    const colorOf = (key) => situations.find((s) => s.key === key)?.color || '#64748b';

    if (!rows.length) {
        container.innerHTML = '<div class="analytics-abc-ranking__empty">Nenhum lote com saldo a vencer.</div>';
        return;
    }

    container.innerHTML = `
      <table class="tax-table tax-table--products stock-lots-dash__upcoming">
        <thead><tr><th>Produto</th><th>Lote</th><th>Validade</th><th>Dias</th><th>Disp.</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr title="${escapeHtml(`${r.product_code || ''} ${r.product_description || ''} — lote ${r.lot_code}`)}">
              <td class="tax-table__product">${escapeHtml(r.product_description || `Estoque ${r.product_stock_id || ''}`)}</td>
              <td>${escapeHtml(r.lot_code)}${r.blocked_at ? ' 🔒' : ''}</td>
              <td>${dateBR(r.expires_at)}</td>
              <td><span class="stock-lots-dash__pill" style="--lc:${escapeHtml(colorOf(r.situation))}">${formatInteger(r.days_left)} d</span></td>
              <td>${qty(r.qty_available)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tax-table__footer">
        <span class="tax-rate-legend">Ordem FEFO: primeiro a vencer, primeiro a sair</span>
        <a class="tax-link" href="${MODULE_URL}">Ver todos</a>
      </div>`;
}

function renderMonths(card, months, situations) {
    const container = card.querySelector('[data-lots-chart="months"]');
    if (!months.length || !months.some((m) => m.value > 0)) {
        container.innerHTML = '<div class="analytics-product-pie__empty">Nenhum vencimento nos próximos meses.</div>';
        return;
    }

    const keys = situations.filter((s) => months.some((m) => Number(m.bySituation?.[s.key] || 0) > 0));
    const monthInfo = months.map((m, index) => {
        const [y, mo] = String(m.month).split('-');
        const label = `${MONTH_NAMES[Number(mo) - 1]}/${String(y).slice(2)}`;
        return { label, partial: index === 0, title: `${label} — ${lotsLabel(m.lots)}` };
    });

    container.innerHTML = `
      ${monthlyColumnsSvg({
        months: monthInfo,
        series: keys.map((s) => ({
            label: s.label,
            color: s.color,
            values: months.map((m) => Number(m.bySituation?.[s.key] || 0)),
        })),
        mode: 'stacked',
    })}
      <ul class="tax-legend tax-legend--inline">
        ${keys.map((s) => `<li><i style="background:${escapeHtml(s.color)}"></i><span class="tax-legend__name">${escapeHtml(s.label)}</span></li>`).join('')}
      </ul>
      <div class="tax-columns__note">Valor (custo) dos lotes que vencem em cada mês · * mês atual a partir de hoje</div>`;
}

function renderKpis(card, data, situations) {
    const bands = situations.filter((s) => /^B\d$/.test(s.key));
    const first = bands[0];
    const last = bands[bands.length - 1];
    const sumOf = (list) => list.reduce((acc, s) => ({ lots: acc.lots + s.lots, value: acc.value + s.value, qty: acc.qty + s.qty }), { lots: 0, value: 0, qty: 0 });

    const expired = situations.find((s) => s.key === 'EXPIRED') || { lots: 0, value: 0, qty: 0 };
    setField(card, 'expiredValue', moneyBR(expired.value));
    setField(card, 'expiredHint', `${lotsLabel(expired.lots)} · ${qty(expired.qty)} un.`);

    if (first) {
        const f = sumOf([first]);
        setField(card, 'firstLabel', `VENCE EM ATÉ ${first.days} DIAS`);
        setField(card, 'firstValue', moneyBR(f.value));
        setField(card, 'firstHint', `${lotsLabel(f.lots)} · faixa ${first.label}`);
    }

    if (last) {
        const w = sumOf(bands);
        setField(card, 'windowLabel', `VENCE EM ATÉ ${last.days} DIAS`);
        setField(card, 'windowValue', moneyBR(w.value));
        setField(card, 'windowHint', `${lotsLabel(w.lots)} somando ${bands.length} faixa(s)`);
    }

    const none = situations.find((s) => s.key === 'NONE') || { lots: 0 };
    setField(card, 'pendingValue', `${formatInteger(none.lots)} · ${formatInteger(data.blockedLots || 0)}`);
    setField(card, 'pendingHint', 'lotes sem validade · lotes bloqueados');
}
