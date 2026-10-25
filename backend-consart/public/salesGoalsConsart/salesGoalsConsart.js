// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesGoalsConsart.js — Metas de Vendas (CONSART ERP)                 ║
// ║ • Cabeçalho no visual do CRM Consart: indicadores do mês + filtros   ║
// ║ • Painel (Chart.js): atingido da empresa, meta x vendido por         ║
// ║   vendedor e evolução de 12 meses · alterna Valor (R$)/Quantidade    ║
// ║ • Um card por vendedor: meta x realizado (valor e qtd. de propostas) ║
// ║ • Realizado = Propostas de Serviços APROVADAS (data da proposta)     ║
// ║ • Modal "Definir metas" (todos os vendedores do mês, copiar do mês   ║
// ║   anterior) e modal com as propostas aprovadas do vendedor           ║
// ║ API: /api/sales-goals-consart                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { apiFetch } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

const API = '/api/sales-goals-consart';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const $ = (sel) => document.querySelector(sel);

const now = new Date();
const state = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  sellerId: '',
  rows: [],
  totals: null,
  history: [],
  measure: 'value', // 'value' | 'count' (gráficos)
};

// Cores dos gráficos (par validado p/ daltonismo): meta = índigo, vendido = verde Consart
const COLORS = { goal: '#6366f1', done: '#0f9d84', track: '#e2e8f0' };
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

// ─────────────────────────────────────────────────────────────────────
// Filtros
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
  loadMonth();
}

function fillSellerFilter() {
  const sel = $('#sg-seller');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os vendedores</option>' + state.allSellers
    .map((s) => `<option value="${s.seller_id}">${esc(s.seller_name)}</option>`).join('');
  sel.value = current;
}

// ─────────────────────────────────────────────────────────────────────
// Lista (cards por vendedor)
// ─────────────────────────────────────────────────────────────────────

async function loadMonth() {
  try {
    // Busca sempre o mês inteiro: os indicadores e o filtro de vendedor
    // usam todos; o filtro só esconde cards.
    const [json] = await Promise.all([
      apiFetch(`${API}?year=${state.year}&month=${state.month}`),
      loadHistory(false),
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
  if (redraw) renderHistoryChart();
}

function render() {
  const sid = Number(state.sellerId || 0);
  state.rows = sid ? state.allSellers.filter((r) => r.seller_id === sid) : state.allSellers;
  renderSummary();
  renderCharts();
  renderGrid();
}

// ─────────────────────────────────────────────────────────────────────
// Painel (Chart.js)
// ─────────────────────────────────────────────────────────────────────

const isValue = () => state.measure === 'value';
const fmtMeasure = (n) => (isValue() ? `R$ ${money(n)}` : Number(n || 0).toLocaleString('pt-BR'));
const fmtAxis = (n) => (isValue()
  ? Number(n).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
  : Number(n).toLocaleString('pt-BR'));

function drawChart(key, canvasId, config) {
  if (!window.Chart) return;
  if (charts[key]) charts[key].destroy();
  charts[key] = new window.Chart(document.getElementById(canvasId), config);
}

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: '#475569', font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMeasure(ctx.parsed.y)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 11 } } },
      y: {
        beginAtZero: true,
        grid: { color: '#f1f5f9' },
        border: { display: false },
        ticks: { color: '#94a3b8', font: { size: 10 }, precision: 0, callback: fmtAxis },
      },
    },
    ...extra,
  };
}

function renderCharts() {
  renderGauge();
  renderSellersChart();
  renderHistoryChart();
}

/** Meia-rosca com o % atingido (empresa, ou do vendedor filtrado). */
function renderGauge() {
  const sid = Number(state.sellerId || 0);
  const src = sid ? (state.rows[0] || {}) : (state.totals || {});
  const key = isValue() ? 'value' : 'count';
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

  $('#sg-gauge-title').textContent = sid ? 'Atingido do vendedor' : 'Atingido da empresa';
  $('#sg-gauge-pct').textContent = pctText(pct === null ? null : Math.round(pct * 10) / 10);
  $('#sg-gauge-pct').style.color = pct === null ? '#94a3b8' : color;
  $('#sg-gauge-sub').textContent = sid ? (state.rows[0]?.seller_name || '') : periodLabel();
  $('#sg-gauge-legend').innerHTML = `
    <span><i style="background:${COLORS.done}"></i>Vendido <strong>${fmtMeasure(done)}</strong></span>
    <span><i style="background:${COLORS.goal}"></i>Meta <strong>${goal ? fmtMeasure(goal) : '—'}</strong></span>`;
}

function renderSellersChart() {
  const key = isValue() ? 'value' : 'count';
  const rows = state.rows;
  drawChart('sellers', 'sg-chart-sellers', {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.seller_name),
      datasets: [
        { label: 'Meta', data: rows.map((r) => r[`goal_${key}`]), backgroundColor: COLORS.goal,
          borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 },
        { label: 'Vendido', data: rows.map((r) => r[`done_${key}`]), backgroundColor: COLORS.done,
          borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 },
      ],
    },
    options: baseOptions({ datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } } }),
  });
}

function renderHistoryChart() {
  const key = isValue() ? 'value' : 'count';
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
        { type: 'bar', label: 'Vendido', data: rows.map((r) => r[`done_${key}`]),
          backgroundColor: rows.map((r, i) => (i === rows.length - 1 ? COLORS.done : `${COLORS.done}99`)),
          borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34, order: 1 },
      ],
    },
    options: baseOptions(),
  });
}

function setMeasure(measure) {
  state.measure = measure;
  document.querySelectorAll('.sg-toggle__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.measure === measure));
  renderCharts();
}

function renderSummary() {
  const t = state.totals || {};
  const withGoal = state.allSellers.filter((r) => r.goal_value > 0);
  const hit = withGoal.filter((r) => r.done_value >= r.goal_value).length;

  const metric = (label, value, sub, cls = '') => `
    <div class="sg-summary__metric ${cls}">
      <span class="sg-summary__label">${label}</span>
      <span class="sg-summary__value">${value}</span>
      <span class="sg-summary__sub">${sub}</span>
    </div>`;

  $('#sg-summary').innerHTML = `
    <div class="sg-summary__row">
      ${metric('Meta do mês', `R$ ${money(t.goal_value)}`, periodLabel())}
      ${metric('Vendido', `R$ ${money(t.done_value)}`, 'propostas aprovadas', 'sg-summary__metric--done')}
      ${metric('Atingido', pctText(t.pct_value), t.goal_value > t.done_value
        ? `faltam R$ ${money(t.goal_value - t.done_value)}` : 'meta batida', `sg-summary__metric--${level(t.pct_value)}`)}
      ${metric('Propostas', `${t.done_count || 0} / ${t.goal_count || 0}`, 'aprovadas / meta')}
      ${metric('Na meta', `${hit} / ${withGoal.length}`, 'vendedores')}
    </div>`;
}

function bar(label, doneText, goalText, pct) {
  const width = Math.max(0, Math.min(100, Number(pct || 0)));
  return `
    <div class="sg-progress">
      <div class="sg-progress__head">
        <span class="sg-progress__label">${label}</span>
        <span class="sg-progress__pct sg-pct--${level(pct)}">${pctText(pct)}</span>
      </div>
      <div class="sg-progress__track"><div class="sg-progress__fill sg-fill--${level(pct)}" style="width:${width}%"></div></div>
      <div class="sg-progress__nums"><strong>${doneText}</strong><span>meta ${goalText}</span></div>
    </div>`;
}

function statusPill(r) {
  if (!r.goal_value && !r.goal_count) return '<span class="sg-pill sg-pill--none">Sem meta</span>';
  const p = r.goal_value ? r.pct_value : r.pct_count;
  const map = { done: 'Meta atingida', near: 'No caminho', low: 'Abaixo da meta', none: 'Sem meta' };
  return `<span class="sg-pill sg-pill--${level(p)}">${map[level(p)]}</span>`;
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
      ${bar('Valor vendido', `R$ ${money(r.done_value)}`, r.goal_value ? `R$ ${money(r.goal_value)}` : '—', r.pct_value)}
      ${bar('Propostas aprovadas', String(r.done_count), r.goal_count ? String(r.goal_count) : '—', r.pct_count)}
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
// Modal Definir metas
// ─────────────────────────────────────────────────────────────────────

function goalRowHtml(r) {
  return `
    <tr data-seller="${r.seller_id}">
      <td class="sg-col-left" title="${esc(r.seller_name)}">${esc(r.seller_name)}${r.seller_active ? '' : ' <small class="sg-hint">(inativo)</small>'}</td>
      <td><div class="fields fields-h-5 fields-w-full"><input type="text" inputmode="decimal" class="sg-in-value" value="${moneyInput(r.goal_value)}" placeholder="0,00"></div></td>
      <td><div class="fields fields-h-5 fields-w-full"><input type="number" min="0" step="1" class="sg-in-count" value="${r.goal_count || ''}" placeholder="0"></div></td>
      <td><div class="fields fields-h-5 fields-w-full"><input type="text" maxlength="255" class="sg-in-notes" value="${esc(r.notes)}" placeholder="Opcional"></div></td>
    </tr>`;
}

function updateGoalsTotals() {
  let value = 0;
  let count = 0;
  document.querySelectorAll('#sg-goals-body tr').forEach((tr) => {
    value += parseNumber(tr.querySelector('.sg-in-value').value);
    count += Math.trunc(parseNumber(tr.querySelector('.sg-in-count').value));
  });
  $('#sg-goals-total-value').textContent = `R$ ${money(value)}`;
  $('#sg-goals-total-count').textContent = String(count);
}

function openGoals(focusSellerId = null) {
  $('#sgGoalsTitle').textContent = `Metas de ${periodLabel()}`;
  $('#sg-goals-body').innerHTML = state.allSellers.map(goalRowHtml).join('');
  updateGoalsTotals();
  const focus = focusSellerId ? `#sg-goals-body tr[data-seller="${focusSellerId}"] .sg-in-value` : '#sg-goals-body .sg-in-value';
  Modal.open('sg-goals-modal', { focusSelector: focus });
}

async function copyPreviousMonth() {
  const d = new Date(state.year, state.month - 2, 1);
  try {
    const json = await apiFetch(`${API}?year=${d.getFullYear()}&month=${d.getMonth() + 1}`);
    const prev = new Map((json.data || []).map((r) => [r.seller_id, r]));
    let copied = 0;
    document.querySelectorAll('#sg-goals-body tr').forEach((tr) => {
      const p = prev.get(Number(tr.dataset.seller));
      if (!p || (!p.goal_value && !p.goal_count)) return;
      tr.querySelector('.sg-in-value').value = moneyInput(p.goal_value);
      tr.querySelector('.sg-in-count').value = p.goal_count || '';
      copied += 1;
    });
    updateGoalsTotals();
    if (!copied) notify('info', 'Copiar metas', `${periodLabel(d.getFullYear(), d.getMonth() + 1)} não tem metas cadastradas.`);
  } catch (error) {
    notify('error', 'Erro', `Erro ao copiar o mês anterior: ${error.message}`);
  }
}

function onGoalValueBlur(event) {
  const input = event.target.closest('.sg-in-value');
  if (input) input.value = moneyInput(parseNumber(input.value));
}

async function saveGoals() {
  const goals = [...document.querySelectorAll('#sg-goals-body tr')].map((tr) => ({
    seller_id: Number(tr.dataset.seller),
    goal_value: parseNumber(tr.querySelector('.sg-in-value').value),
    goal_count: Math.trunc(parseNumber(tr.querySelector('.sg-in-count').value)),
    notes: tr.querySelector('.sg-in-notes').value,
  }));

  const btn = $('#sg-goals-save');
  btn.disabled = true;
  try {
    const json = await apiFetch(`${API}/${state.year}/${state.month}`, {
      method: 'PUT',
      body: JSON.stringify({ goals }),
    });
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
  $('#sg-month').addEventListener('change', (e) => { state.month = Number(e.target.value); loadMonth(); });
  $('#sg-year').addEventListener('change', (e) => { state.year = Number(e.target.value); loadMonth(); });
  $('#sg-seller').addEventListener('change', (e) => {
    state.sellerId = e.target.value;
    render();
    loadHistory();
  });
  document.querySelectorAll('.sg-toggle__btn').forEach((b) => b.addEventListener('click', () => setMeasure(b.dataset.measure)));
  $('#sg-prev').addEventListener('click', () => shiftMonth(-1));
  $('#sg-next').addEventListener('click', () => shiftMonth(1));
  $('#sg-today').addEventListener('click', () => {
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
    syncPeriodSelects();
    loadMonth();
  });
  $('#sg-reload').addEventListener('click', loadMonth);
  $('#sg-btn-goals').addEventListener('click', () => openGoals());
  $('#sg-grid').addEventListener('click', onGridClick);

  const goalsBody = $('#sg-goals-body');
  goalsBody.addEventListener('input', updateGoalsTotals);
  goalsBody.addEventListener('focusout', onGoalValueBlur);
  $('#sg-copy-prev').addEventListener('click', copyPreviousMonth);
  $('#sg-goals-save').addEventListener('click', saveGoals);
  $('#sg-sales-body').addEventListener('click', onSalesClick);
}

state.allSellers = [];
Modal.setup();
fillPeriodSelects();
bindEvents();
loadMonth();
