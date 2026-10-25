// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesGoalsConsart.js — Metas de Vendas (CONSART ERP)                 ║
// ║ • Cabeçalho no visual do CRM Consart: indicadores do mês + filtros   ║
// ║ • Aba "Por vendedor": painel (Chart.js) com atingido, meta x         ║
// ║   realizado por vendedor e evolução de 12 meses, alternando a        ║
// ║   métrica; um card por vendedor com todas as metas                   ║
// ║ • Métricas (METRICS): valor vendido e propostas aprovadas, propostas ║
// ║   enviadas, leads contatados e conversões (CRM Consart) e            ║
// ║   mensalidade de contratos assinados                                 ║
// ║ • Aba "Plano por estado": meta por UF (leads, conversões e valor) x  ║
// ║   realizado pela UF do cliente + desfechos dos leads por estado      ║
// ║ • Modais "Definir metas" (vendedor / estado, copiar do mês anterior) ║
// ║   e propostas aprovadas do vendedor                                  ║
// ║ API: /api/sales-goals-consart                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { apiFetch } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const API = '/api/sales-goals-consart';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

// Métricas das metas (chaves iguais às da API: goal_<chave> / done_<chave> / pct_<chave>)
const METRICS = {
  value: { label: 'Valor vendido', short: 'Valor (R$)', done: 'Vendido', money: true },
  count: { label: 'Propostas aprovadas', short: 'Aprovadas', done: 'Aprovadas' },
  sent: { label: 'Propostas enviadas', short: 'Enviadas', done: 'Enviadas' },
  leads: { label: 'Leads contatados', short: 'Leads', done: 'Contatados' },
  conversions: { label: 'Conversões no CRM', short: 'Conversões', done: 'Convertidos' },
  recurring: { label: 'Mensalidade de contratos', short: 'Mensalidade', done: 'Assinado', money: true },
};
const SELLER_KEYS = ['value', 'count', 'sent', 'leads', 'conversions', 'recurring'];
const STATE_KEYS = ['leads', 'conversions', 'value'];

const $ = (sel) => document.querySelector(sel);

const now = new Date();
const state = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  view: 'sellers',      // 'sellers' | 'states'
  sellerId: '',
  allSellers: [],
  rows: [],
  totals: null,
  history: [],
  measure: 'value',     // métrica dos gráficos por vendedor
  stateMeasure: 'leads', // métrica do gráfico por estado
  plan: [],             // plano por estado (GET /states)
  planTotals: null,
  outcomes: [],         // desfechos dos leads por UF (GET /leads-by-state)
};

// Cores dos gráficos (par validado p/ daltonismo): meta = índigo, realizado = verde Consart
const COLORS = { goal: '#6366f1', done: '#0f9d84', track: '#e2e8f0' };
// Desfechos dos leads (paleta validada): conversão, queda de venda, sem sucesso no contato
const OUTCOME_COLORS = { converted: '#0f9d84', lost: '#d97706', no_contact: '#6366f1' };
const LEVEL_COLORS = { done: '#16a34a', near: '#f59e0b', low: '#ef4444', none: '#cbd5e1' };
const charts = {};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseNumber(value) {
  let s = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moneyInput(n) {
  return Number(n) ? money(n) : '';
}

const int = (n) => Number(n || 0).toLocaleString('pt-BR');

/** Valor de uma métrica formatado (R$ para dinheiro, inteiro para contagem). */
function fmt(key, n) {
  return METRICS[key].money ? `R$ ${money(n)}` : int(n);
}

function pctText(p) {
  return p === null || p === undefined ? '—' : `${Number(p).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function dateBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function periodLabel(year = state.year, month = state.month) {
  return `${MONTHS[month - 1]}/${year}`;
}

function previousPeriod() {
  const d = new Date(state.year, state.month - 2, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Faixa da barra: atingida (>= 100), no caminho (>= 70) ou abaixo. */
function level(p) {
  if (p === null || p === undefined) return 'none';
  if (p >= 100) return 'done';
  if (p >= 70) return 'near';
  return 'low';
}

function notify(variant, title, message) {
  showCenterModal({ variant, title, message });
}

const hasAnyGoal = (r, keys) => keys.some((k) => Number(r[`goal_${k}`]) > 0);

// ─────────────────────────────────────────────────────────────────────
// Filtros / abas
// ─────────────────────────────────────────────────────────────────────

function fillPeriodSelects() {
  $('#sg-month').innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const years = [];
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y -= 1) years.push(y);
  $('#sg-year').innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  syncPeriodSelects();
}

function syncPeriodSelects() {
  const yearSel = $('#sg-year');
  if (![...yearSel.options].some((o) => Number(o.value) === state.year)) {
    yearSel.insertAdjacentHTML('beforeend', `<option value="${state.year}">${state.year}</option>`);
  }
  yearSel.value = String(state.year);
  $('#sg-month').value = String(state.month);
}

function shiftMonth(delta) {
  const d = new Date(state.year, state.month - 1 + delta, 1);
  state.year = d.getFullYear();
  state.month = d.getMonth() + 1;
  syncPeriodSelects();
  loadAll();
}

function fillSellerFilter() {
  const sel = $('#sg-seller');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os vendedores</option>' + state.allSellers
    .map((s) => `<option value="${s.seller_id}">${esc(s.seller_name)}</option>`).join('');
  sel.value = current;
}

function fillMeasureToggles() {
  const btn = (key, current, attr) =>
    `<button type="button" class="sg-toggle__btn${key === current ? ' is-active' : ''}" ${attr}="${key}">${METRICS[key].short}</button>`;
  $('#sg-measures').innerHTML = SELLER_KEYS.map((k) => btn(k, state.measure, 'data-measure')).join('');
  $('#sg-state-measures').innerHTML = STATE_KEYS.map((k) => btn(k, state.stateMeasure, 'data-state-measure')).join('');
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.sg-tabs__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
  $('#sg-view-sellers').hidden = view !== 'sellers';
  $('#sg-view-states').hidden = view !== 'states';
  $('#sg-btn-goals-text').textContent = view === 'states' ? 'Definir plano por estado' : 'Definir metas do mês';
  // Gráficos criados com o painel escondido ficam sem tamanho: redesenha ao mostrar
  if (view === 'states') renderStatesView();
  else renderCharts();
}

// ─────────────────────────────────────────────────────────────────────
// Carga
// ─────────────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    // Busca sempre o mês inteiro: indicadores e filtro usam todos os vendedores
    const [json] = await Promise.all([
      apiFetch(`${API}?year=${state.year}&month=${state.month}`),
      loadHistory(false),
      loadPlan(false),
      loadOutcomes(false),
    ]);
    state.allSellers = json.data || [];
    state.totals = json.totals || null;
    fillSellerFilter();
    render();
  } catch (error) {
    console.error('[salesGoalsConsart] mês:', error);
    notify('error', 'Erro', `Erro ao carregar as metas: ${error.message}`);
  }
}

async function loadHistory(redraw = true) {
  const params = new URLSearchParams({ year: state.year, month: state.month, months: 12 });
  if (state.sellerId) params.set('seller_id', state.sellerId);
  try {
    const json = await apiFetch(`${API}/history?${params}`);
    state.history = json.data || [];
  } catch (error) {
    console.error('[salesGoalsConsart] histórico:', error);
    state.history = [];
  }
  if (redraw && state.view === 'sellers') renderHistoryChart();
}

async function loadPlan(redraw = true) {
  try {
    const json = await apiFetch(`${API}/states?year=${state.year}&month=${state.month}`);
    state.plan = json.data || [];
    state.planTotals = json.totals || null;
  } catch (error) {
    console.error('[salesGoalsConsart] plano por estado:', error);
    state.plan = [];
    state.planTotals = null;
  }
  if (redraw && state.view === 'states') renderStatesView();
}

async function loadOutcomes(redraw = true) {
  const params = new URLSearchParams({ year: state.year, month: state.month });
  if (state.sellerId) params.set('seller_id', state.sellerId);
  try {
    const json = await apiFetch(`${API}/leads-by-state?${params}`);
    state.outcomes = json.data || [];
  } catch (error) {
    console.error('[salesGoalsConsart] leads por estado:', error);
    state.outcomes = [];
  }
  if (redraw && state.view === 'states') renderOutcomesChart();
}

function render() {
  const sid = Number(state.sellerId || 0);
  state.rows = sid ? state.allSellers.filter((r) => r.seller_id === sid) : state.allSellers;
  renderSummary();
  renderGrid();
  if (state.view === 'states') renderStatesView();
  else renderCharts();
}

// ─────────────────────────────────────────────────────────────────────
// Indicadores do topo (empresa)
// ─────────────────────────────────────────────────────────────────────

function renderSummary() {
  const t = state.totals || {};
  const withGoal = state.allSellers.filter((r) => hasAnyGoal(r, SELLER_KEYS));
  // Na meta = bateu todas as metas que tem
  const hit = withGoal.filter((r) => SELLER_KEYS.every((k) => !r[`goal_${k}`] || r[`done_${k}`] >= r[`goal_${k}`])).length;

  const metric = (label, value, sub, cls = '') => `
    <div class="sg-summary__metric ${cls}">
      <span class="sg-summary__label">${label}</span>
      <span class="sg-summary__value">${value}</span>
      <span class="sg-summary__sub">${sub}</span>
    </div>`;
  const ratio = (key, sub) => metric(METRICS[key].label, `${fmt(key, t[`done_${key}`])}`,
    `${sub} · meta ${t[`goal_${key}`] ? fmt(key, t[`goal_${key}`]) : '—'}`,
    `sg-summary__metric--${level(t[`pct_${key}`])}-soft`);

  $('#sg-summary').innerHTML = `
    <div class="sg-summary__row">
      ${metric('Meta de valor', `R$ ${money(t.goal_value)}`, periodLabel())}
      ${metric('Vendido', `R$ ${money(t.done_value)}`, 'propostas aprovadas', 'sg-summary__metric--done')}
      ${metric('Atingido', pctText(t.pct_value), t.goal_value > t.done_value
        ? `faltam R$ ${money(t.goal_value - t.done_value)}` : 'meta de valor batida', `sg-summary__metric--${level(t.pct_value)}`)}
      ${ratio('count', 'propostas')}
      ${ratio('sent', 'propostas')}
      ${ratio('leads', 'CRM')}
      ${ratio('conversions', 'CRM')}
      ${ratio('recurring', 'contratos')}
      ${metric('Na meta', `${hit} / ${withGoal.length}`, 'vendedores com todas as metas')}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────
// Painel por vendedor (Chart.js)
// ─────────────────────────────────────────────────────────────────────

const fmtAxis = (key) => (n) => (METRICS[key].money
  ? Number(n).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
  : Number(n).toLocaleString('pt-BR'));

function drawChart(key, canvasId, config) {
  if (!window.Chart) return;
  if (charts[key]) charts[key].destroy();
  charts[key] = new window.Chart(document.getElementById(canvasId), config);
}

function baseOptions(key, extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: '#475569', font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(key, ctx.parsed.y)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 11 } } },
      y: {
        beginAtZero: true,
        grid: { color: '#f1f5f9' },
        border: { display: false },
        ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0, callback: fmtAxis(key) },
      },
    },
    ...extra,
  };
}

/** Meta x realizado em colunas lado a lado (vendedores ou estados). */
function goalBarsConfig(key, labels, goals, dones) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Meta', data: goals, backgroundColor: COLORS.goal, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 },
        { label: METRICS[key].done, data: dones, backgroundColor: COLORS.done, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 },
      ],
    },
    options: baseOptions(key, { datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } } }),
  };
}

function renderCharts() {
  $('#sg-bars-measure').textContent = METRICS[state.measure].label;
  $('#sg-history-measure').textContent = METRICS[state.measure].label;
  renderGauge();
  renderSellersChart();
  renderHistoryChart();
}

/** Meia-rosca com o % atingido (empresa, ou do vendedor filtrado). */
function renderGauge() {
  const key = state.measure;
  const sid = Number(state.sellerId || 0);
  const src = sid ? (state.rows[0] || {}) : (state.totals || {});
  const goal = Number(src[`goal_${key}`] || 0);
  const done = Number(src[`done_${key}`] || 0);
  const pct = goal > 0 ? (done / goal) * 100 : null;
  const color = LEVEL_COLORS[level(pct)];
  const filled = pct === null ? 0 : Math.min(100, pct);

  drawChart('gauge', 'sg-chart-gauge', {
    type: 'doughnut',
    data: { datasets: [{ data: [filled, 100 - filled], backgroundColor: [color, COLORS.track], borderWidth: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      rotation: -90,
      circumference: 180,
      cutout: '74%',
      animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });

  $('#sg-gauge-title').textContent = `${sid ? 'Atingido do vendedor' : 'Atingido da empresa'} · ${METRICS[key].short}`;
  $('#sg-gauge-pct').textContent = pctText(pct === null ? null : Math.round(pct * 10) / 10);
  $('#sg-gauge-pct').style.color = pct === null ? '#94a3b8' : color;
  $('#sg-gauge-sub').textContent = sid ? (state.rows[0]?.seller_name || '') : periodLabel();
  $('#sg-gauge-legend').innerHTML = `
    <span><i style="background:${COLORS.done}"></i>${METRICS[key].done} <strong>${fmt(key, done)}</strong></span>
    <span><i style="background:${COLORS.goal}"></i>Meta <strong>${goal ? fmt(key, goal) : '—'}</strong></span>`;
}

function renderSellersChart() {
  const key = state.measure;
  const rows = state.rows;
  drawChart('sellers', 'sg-chart-sellers', goalBarsConfig(key,
    rows.map((r) => r.seller_name), rows.map((r) => r[`goal_${key}`]), rows.map((r) => r[`done_${key}`])));
}

function renderHistoryChart() {
  const key = state.measure;
  const rows = state.history;
  const short = (r) => `${MONTHS[r.month - 1].slice(0, 3)}/${String(r.year).slice(2)}`;
  drawChart('history', 'sg-chart-history', {
    type: 'bar',
    data: {
      labels: rows.map(short),
      datasets: [
        { type: 'line', label: 'Meta', data: rows.map((r) => r[`goal_${key}`]), borderColor: COLORS.goal,
          backgroundColor: COLORS.goal, borderWidth: 2, borderDash: [6, 4], pointRadius: 4,
          pointBackgroundColor: '#ffffff', pointBorderWidth: 2, tension: 0.25, order: 0 },
        { type: 'bar', label: METRICS[key].done, data: rows.map((r) => r[`done_${key}`]),
          backgroundColor: rows.map((r, i) => (i === rows.length - 1 ? COLORS.done : `${COLORS.done}99`)),
          borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34, order: 1 },
      ],
    },
    options: baseOptions(key),
  });
}

function setMeasure(measure) {
  state.measure = measure;
  document.querySelectorAll('[data-measure]').forEach((b) => b.classList.toggle('is-active', b.dataset.measure === measure));
  renderCharts();
}

// ─────────────────────────────────────────────────────────────────────
// Cards por vendedor
// ─────────────────────────────────────────────────────────────────────

/** Linha compacta: rótulo · barra · realizado / meta · %. */
function metricLine(key, r) {
  const pct = r[`pct_${key}`];
  const goal = r[`goal_${key}`];
  const width = Math.max(0, Math.min(100, Number(pct || 0)));
  return `
    <div class="sg-line">
      <span class="sg-line__label" title="${METRICS[key].label}">${METRICS[key].short}</span>
      <span class="sg-line__nums"><strong>${fmt(key, r[`done_${key}`])}</strong> / ${goal ? fmt(key, goal) : '—'}</span>
      <span class="sg-line__pct sg-pct--${level(pct)}">${pctText(pct)}</span>
      <div class="sg-line__track"><div class="sg-progress__fill sg-fill--${level(pct)}" style="width:${width}%"></div></div>
    </div>`;
}

function statusPill(r) {
  const keys = SELLER_KEYS.filter((k) => r[`goal_${k}`] > 0);
  if (!keys.length) return '<span class="sg-pill sg-pill--none">Sem meta</span>';
  // Pior meta manda no selo
  const worst = Math.min(...keys.map((k) => Number(r[`pct_${k}`] || 0)));
  const map = { done: 'Metas atingidas', near: 'No caminho', low: 'Abaixo da meta', none: 'Sem meta' };
  return `<span class="sg-pill sg-pill--${level(worst)}">${map[level(worst)]}</span>`;
}

function renderGrid() {
  $('#sg-grid').innerHTML = state.rows.map((r) => `
    <article class="sg-seller" data-id="${r.seller_id}">
      <div class="sg-seller__head">
        <span class="sg-seller__avatar">${esc((r.seller_name || '?').trim().charAt(0).toUpperCase())}</span>
        <div class="sg-seller__name">
          <strong title="${esc(r.seller_name)}">${esc(r.seller_name)}</strong>
          ${r.seller_active ? '' : '<small>inativo</small>'}
        </div>
        ${statusPill(r)}
      </div>
      <div class="sg-lines">${SELLER_KEYS.map((k) => metricLine(k, r)).join('')}</div>
      <div class="sg-seller__foot">
        <span class="sg-hint" title="${esc(r.notes)}">${esc(r.notes)}</span>
        ${actionIconsHtml([
          { action: 'view', title: 'Ver propostas aprovadas', attrs: { 'data-act': 'sales', 'data-id': r.seller_id } },
          { action: 'edit', title: 'Editar metas do mês', attrs: { 'data-act': 'goals', 'data-id': r.seller_id } },
        ])}
      </div>
    </article>
  `).join('');
  $('#sg-empty').hidden = state.rows.length > 0;
}

function onGridClick(event) {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.act === 'sales') openSales(id);
  if (btn.dataset.act === 'goals') openGoals(id);
}

// ─────────────────────────────────────────────────────────────────────
// Aba Plano por estado
// ─────────────────────────────────────────────────────────────────────

function renderStatesView() {
  $('#sg-state-measure-label').textContent = METRICS[state.stateMeasure].label;
  renderStateGoalsChart();
  renderPlanTable();
  renderOutcomesChart();
}

function renderStateGoalsChart() {
  const key = state.stateMeasure;
  const rows = state.plan.filter((r) => r[`goal_${key}`] || r[`done_${key}`]);
  drawChart('stateGoals', 'sg-chart-state-goals', goalBarsConfig(key,
    rows.map((r) => r.state), rows.map((r) => r[`goal_${key}`]), rows.map((r) => r[`done_${key}`])));
}

/** Célula meta x realizado com mini barra. */
function planCell(key, r) {
  const pct = r[`pct_${key}`];
  const goal = r[`goal_${key}`];
  const width = Math.max(0, Math.min(100, Number(pct || 0)));
  return `
    <td>
      <div class="sg-cell">
        <span class="sg-cell__nums"><strong>${fmt(key, r[`done_${key}`])}</strong> / ${goal ? fmt(key, goal) : '—'}</span>
        <span class="sg-cell__pct sg-pct--${level(pct)}">${pctText(pct)}</span>
      </div>
      <div class="sg-line__track"><div class="sg-progress__fill sg-fill--${level(pct)}" style="width:${width}%"></div></div>
    </td>`;
}

function renderPlanTable() {
  const rows = state.plan;
  $('#sg-plan-body').innerHTML = rows.map((r) => `
    <tr>
      <td class="sg-col-uf">${esc(r.state)}</td>
      ${planCell('leads', r)}
      ${planCell('conversions', r)}
      <td class="sg-col-rate">${pctText(r.conversion_rate)}</td>
      ${planCell('value', r)}
      <td class="sg-col-open">${int(r.open_leads)}</td>
      <td class="sg-col-left sg-col-notes" title="${esc(r.notes)}">${esc(r.notes)}</td>
    </tr>`).join('');

  const t = state.planTotals;
  $('#sg-plan-total').innerHTML = rows.length && t ? `
    <th class="sg-col-uf">Total</th>
    ${['leads', 'conversions'].map((k) => `<th>${fmt(k, t[`done_${k}`])} / ${t[`goal_${k}`] ? fmt(k, t[`goal_${k}`]) : '—'} <span class="sg-pct--${level(t[`pct_${k}`])}">${pctText(t[`pct_${k}`])}</span></th>`).join('')}
    <th class="sg-col-rate">${pctText(t.done_leads ? Math.round((t.done_conversions / t.done_leads) * 1000) / 10 : null)}</th>
    <th>${fmt('value', t.done_value)} / ${t.goal_value ? fmt('value', t.goal_value) : '—'} <span class="sg-pct--${level(t.pct_value)}">${pctText(t.pct_value)}</span></th>
    <th class="sg-col-open">${int(t.open_leads)}</th>
    <th></th>` : '';
  $('#sg-plan-empty').hidden = rows.length > 0;
}

/** Desfechos dos leads por UF: barras horizontais empilhadas. */
function renderOutcomesChart() {
  const rows = state.outcomes.filter((r) => r.contacted > 0);
  const seller = state.allSellers.find((s) => s.seller_id === Number(state.sellerId));
  $('#sg-outcomes-seller').textContent = seller ? ` · ${seller.seller_name}` : '';
  const ds = (key, label) => ({
    label, data: rows.map((r) => r[key]), backgroundColor: OUTCOME_COLORS[key],
    borderColor: '#ffffff', borderWidth: { right: 2 }, borderSkipped: false, maxBarThickness: 22,
  });

  document.querySelector('.sg-chart--states').style.height = `${Math.max(160, rows.length * 34 + 70)}px`;
  $('#sg-states-empty').hidden = rows.length > 0;

  drawChart('outcomes', 'sg-chart-states', {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.state),
      datasets: [
        ds('converted', 'Conversão'),
        ds('lost', 'Queda de venda'),
        ds('no_contact', 'Sem sucesso no contato'),
      ],
    },
    options: {
      ...baseOptions('leads'),
      indexAxis: 'y',
      interaction: { mode: 'index', intersect: false, axis: 'y' },
      plugins: {
        legend: baseOptions('leads').plugins.legend,
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x}` } },
      },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9' }, border: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0 } },
        y: { stacked: true, grid: { display: false }, ticks: { color: '#334155', font: { size: 12, weight: '600' } } },
      },
    },
  });
}

function setStateMeasure(measure) {
  state.stateMeasure = measure;
  document.querySelectorAll('[data-state-measure]').forEach((b) => b.classList.toggle('is-active', b.dataset.stateMeasure === measure));
  $('#sg-state-measure-label').textContent = METRICS[measure].label;
  renderStateGoalsChart();
}

// ─────────────────────────────────────────────────────────────────────
// Tabela de metas editável (vendedor e estado usam a mesma montagem)
// ─────────────────────────────────────────────────────────────────────

function goalInput(key, value) {
  if (METRICS[key].money) {
    return `<div class="fields fields-h-5 fields-w-full"><input type="text" inputmode="decimal" class="sg-in sg-in--money" data-key="${key}" value="${moneyInput(value)}" placeholder="0,00"></div>`;
  }
  return `<div class="fields fields-h-5 fields-w-full"><input type="number" min="0" step="1" class="sg-in sg-in--int" data-key="${key}" value="${value || ''}" placeholder="0"></div>`;
}

function goalsHead(firstLabel, keys) {
  return `<th class="sg-col-left sg-col-name">${firstLabel}</th>`
    + keys.map((k) => `<th class="${METRICS[k].money ? 'sg-col-value' : 'sg-col-count'}" title="${METRICS[k].label}">${METRICS[k].money ? METRICS[k].short.replace(' (R$)', '') + ' (R$)' : METRICS[k].short}</th>`).join('')
    + '<th class="sg-col-left">Observação</th>';
}

function goalsRow(attr, id, nameHtml, r, keys) {
  return `
    <tr ${attr}="${esc(id)}">
      <td class="sg-col-left sg-col-name">${nameHtml}</td>
      ${keys.map((k) => `<td>${goalInput(k, r[`goal_${k}`])}</td>`).join('')}
      <td><div class="fields fields-h-5 fields-w-full"><input type="text" maxlength="255" class="sg-in-notes" value="${esc(r.notes || '')}" placeholder="Opcional"></div></td>
    </tr>`;
}

function readGoalsRow(tr, keys) {
  const out = { notes: tr.querySelector('.sg-in-notes').value };
  keys.forEach((k) => {
    const n = parseNumber(tr.querySelector(`[data-key="${k}"]`).value);
    out[`goal_${k}`] = METRICS[k].money ? n : Math.trunc(n);
  });
  return out;
}

function updateTotals(bodySel, totalSel, keys) {
  const sums = Object.fromEntries(keys.map((k) => [k, 0]));
  document.querySelectorAll(`${bodySel} tr`).forEach((tr) => {
    const g = readGoalsRow(tr, keys);
    keys.forEach((k) => { sums[k] += g[`goal_${k}`]; });
  });
  $(totalSel).innerHTML = '<th class="sg-col-left sg-col-name">Total da empresa</th>'
    + keys.map((k) => `<th class="${METRICS[k].money ? 'sg-col-value' : 'sg-col-count'}">${fmt(k, sums[k])}</th>`).join('')
    + '<th></th>';
}

function fillRowGoals(tr, goal, keys) {
  keys.forEach((k) => {
    const input = tr.querySelector(`[data-key="${k}"]`);
    input.value = METRICS[k].money ? moneyInput(goal[`goal_${k}`]) : (goal[`goal_${k}`] || '');
  });
}

function onMoneyBlur(event) {
  const input = event.target.closest('.sg-in--money');
  if (input) input.value = moneyInput(parseNumber(input.value));
}

// ── Metas por vendedor ───────────────────────────────────────────────

const updateSellerTotals = () => updateTotals('#sg-goals-body', '#sg-goals-total', SELLER_KEYS);

function openGoals(focusSellerId = null) {
  $('#sgGoalsTitle').textContent = `Metas de ${periodLabel()} por vendedor`;
  $('#sg-goals-head').innerHTML = goalsHead('Vendedor', SELLER_KEYS);
  $('#sg-goals-body').innerHTML = state.allSellers.map((r) => goalsRow('data-seller', r.seller_id,
    `${esc(r.seller_name)}${r.seller_active ? '' : ' <small class="sg-hint">(inativo)</small>'}`, r, SELLER_KEYS)).join('');
  updateSellerTotals();
  const row = focusSellerId ? `tr[data-seller="${focusSellerId}"] ` : '';
  Modal.open('sg-goals-modal', { focusSelector: `#sg-goals-body ${row}.sg-in` });
}

async function copyPreviousSellers() {
  const prev = previousPeriod();
  try {
    const json = await apiFetch(`${API}?year=${prev.year}&month=${prev.month}`);
    const map = new Map((json.data || []).map((r) => [r.seller_id, r]));
    let copied = 0;
    document.querySelectorAll('#sg-goals-body tr').forEach((tr) => {
      const p = map.get(Number(tr.dataset.seller));
      if (!p || !hasAnyGoal(p, SELLER_KEYS)) return;
      fillRowGoals(tr, p, SELLER_KEYS);
      copied += 1;
    });
    updateSellerTotals();
    if (!copied) notify('info', 'Copiar metas', `${periodLabel(prev.year, prev.month)} não tem metas cadastradas.`);
  } catch (error) {
    notify('error', 'Erro', `Erro ao copiar o mês anterior: ${error.message}`);
  }
}

async function saveGoals() {
  const goals = [...document.querySelectorAll('#sg-goals-body tr')].map((tr) => ({
    seller_id: Number(tr.dataset.seller),
    ...readGoalsRow(tr, SELLER_KEYS),
  }));

  const btn = $('#sg-goals-save');
  btn.disabled = true;
  try {
    const json = await apiFetch(`${API}/${state.year}/${state.month}`, { method: 'PUT', body: JSON.stringify({ goals }) });
    state.allSellers = json.data || [];
    state.totals = json.totals || null;
    render();
    loadHistory();
    Modal.close('sg-goals-modal');
    notify('success', 'Metas salvas', `Metas de ${periodLabel()} salvas.`);
  } catch (error) {
    notify('error', 'Erro', `Erro ao salvar as metas: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ── Plano por estado ────────────────────────────────────────────────

const updateStateTotals = () => updateTotals('#sg-states-goals-body', '#sg-states-goals-total', STATE_KEYS);

function openStatesGoals() {
  $('#sgStatesTitle').textContent = `Plano por estado · ${periodLabel()}`;
  $('#sg-states-goals-head').innerHTML = goalsHead('UF', STATE_KEYS);
  // UFs com movimento ou plano primeiro, depois as demais
  const byUf = new Map(state.plan.map((r) => [r.state, r]));
  const ordered = [...state.plan.map((r) => r.state).filter((uf) => UFS.includes(uf)), ...UFS.filter((uf) => !byUf.has(uf))];
  $('#sg-states-goals-body').innerHTML = ordered.map((uf) => {
    const r = byUf.get(uf) || {};
    const hint = r.open_leads ? ` <small class="sg-hint">${int(r.open_leads)} em aberto</small>` : '';
    return goalsRow('data-state', uf, `<strong>${uf}</strong>${hint}`, r, STATE_KEYS);
  }).join('');
  updateStateTotals();
  Modal.open('sg-states-modal', { focusSelector: '#sg-states-goals-body .sg-in' });
}

async function copyPreviousStates() {
  const prev = previousPeriod();
  try {
    const json = await apiFetch(`${API}/states?year=${prev.year}&month=${prev.month}`);
    const map = new Map((json.data || []).map((r) => [r.state, r]));
    let copied = 0;
    document.querySelectorAll('#sg-states-goals-body tr').forEach((tr) => {
      const p = map.get(tr.dataset.state);
      if (!p || !hasAnyGoal(p, STATE_KEYS)) return;
      fillRowGoals(tr, p, STATE_KEYS);
      copied += 1;
    });
    updateStateTotals();
    if (!copied) notify('info', 'Copiar plano', `${periodLabel(prev.year, prev.month)} não tem plano por estado.`);
  } catch (error) {
    notify('error', 'Erro', `Erro ao copiar o mês anterior: ${error.message}`);
  }
}

async function saveStatesGoals() {
  const goals = [...document.querySelectorAll('#sg-states-goals-body tr')].map((tr) => ({
    state: tr.dataset.state,
    ...readGoalsRow(tr, STATE_KEYS),
  }));

  const btn = $('#sg-states-save');
  btn.disabled = true;
  try {
    const json = await apiFetch(`${API}/states/${state.year}/${state.month}`, { method: 'PUT', body: JSON.stringify({ goals }) });
    state.plan = json.data || [];
    state.planTotals = json.totals || null;
    renderStatesView();
    Modal.close('sg-states-modal');
    notify('success', 'Plano salvo', `Plano por estado de ${periodLabel()} salvo.`);
  } catch (error) {
    notify('error', 'Erro', `Erro ao salvar o plano: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Modal Propostas aprovadas do vendedor
// ─────────────────────────────────────────────────────────────────────

async function openSales(sellerId) {
  const seller = state.allSellers.find((r) => r.seller_id === sellerId);
  $('#sgSalesTitle').textContent = `Propostas aprovadas · ${seller?.seller_name || ''} · ${periodLabel()}`;
  $('#sg-sales-body').innerHTML = '';
  $('#sg-sales-empty').hidden = true;
  $('#sg-sales-info').textContent = 'Carregando...';
  Modal.open('sg-sales-modal');

  try {
    const json = await apiFetch(`${API}/sales?year=${state.year}&month=${state.month}&seller_id=${sellerId}`);
    const rows = json.data || [];
    $('#sg-sales-body').innerHTML = rows.map((p) => `
      <tr>
        <td>${esc(p.number)}</td>
        <td>${dateBR(p.issue_date)}</td>
        <td class="sg-col-left" title="${esc(p.customer_name)}">${esc(p.customer_name)}</td>
        <td class="sg-col-left" title="${esc(p.title)}">${esc(p.title)}</td>
        <td class="sg-col-value">${money(p.total)}</td>
        <td>${actionIconsHtml([{ action: 'document', title: 'Abrir proposta', attrs: { 'data-open': p.id } }])}</td>
      </tr>`).join('');
    $('#sg-sales-empty').hidden = rows.length > 0;
    const total = rows.reduce((acc, p) => acc + p.total, 0);
    $('#sg-sales-info').textContent = `${rows.length} ${rows.length === 1 ? 'proposta' : 'propostas'} · R$ ${money(total)}`;
  } catch (error) {
    $('#sg-sales-info').textContent = '';
    notify('error', 'Erro', `Erro ao carregar as propostas: ${error.message}`);
  }
}

function onSalesClick(event) {
  const btn = event.target.closest('[data-open]');
  if (btn) window.open(`/public/proposalsServicesConsart/proposalsServicesConsart.html?open=${btn.dataset.open}`, '_blank');
}

// ─────────────────────────────────────────────────────────────────────
// Eventos / Init
// ─────────────────────────────────────────────────────────────────────

function bindEvents() {
  $('#sg-month').addEventListener('change', (e) => { state.month = Number(e.target.value); loadAll(); });
  $('#sg-year').addEventListener('change', (e) => { state.year = Number(e.target.value); loadAll(); });
  $('#sg-seller').addEventListener('change', (e) => {
    state.sellerId = e.target.value;
    render();
    loadHistory();
    loadOutcomes();
  });
  document.querySelectorAll('.sg-tabs__btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#sg-measures').addEventListener('click', (e) => {
    const b = e.target.closest('[data-measure]');
    if (b) setMeasure(b.dataset.measure);
  });
  $('#sg-state-measures').addEventListener('click', (e) => {
    const b = e.target.closest('[data-state-measure]');
    if (b) setStateMeasure(b.dataset.stateMeasure);
  });
  $('#sg-prev').addEventListener('click', () => shiftMonth(-1));
  $('#sg-next').addEventListener('click', () => shiftMonth(1));
  $('#sg-today').addEventListener('click', () => {
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
    syncPeriodSelects();
    loadAll();
  });
  $('#sg-reload').addEventListener('click', loadAll);
  $('#sg-btn-goals').addEventListener('click', () => (state.view === 'states' ? openStatesGoals() : openGoals()));
  $('#sg-grid').addEventListener('click', onGridClick);

  const goalsBody = $('#sg-goals-body');
  goalsBody.addEventListener('input', updateSellerTotals);
  goalsBody.addEventListener('focusout', onMoneyBlur);
  $('#sg-copy-prev').addEventListener('click', copyPreviousSellers);
  $('#sg-goals-save').addEventListener('click', saveGoals);

  const statesBody = $('#sg-states-goals-body');
  statesBody.addEventListener('input', updateStateTotals);
  statesBody.addEventListener('focusout', onMoneyBlur);
  $('#sg-states-copy-prev').addEventListener('click', copyPreviousStates);
  $('#sg-states-save').addEventListener('click', saveStatesGoals);

  $('#sg-sales-body').addEventListener('click', onSalesClick);
}

Modal.setup();
fillPeriodSelects();
fillMeasureToggles();
bindEvents();
loadAll();
