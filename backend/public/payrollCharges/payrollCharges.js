// ╔════════════════════════════════════════════════════════════════════╗
// ║ payrollCharges.js — Encargos e Rescisões (CONSART ERP | ESM)       ║
// ║ Aba "Encargos do mês" + aba "Rescisão" + modal de tabelas          ║
// ║ API: /api/payroll-charges                                          ║
// ╚════════════════════════════════════════════════════════════════════╝

'use strict';

import { apiFetch, getAuthToken } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';

const API = '/api/payroll-charges';
const $ = (selector) => document.querySelector(selector);

const state = {
  view: 'month',
  options: null,
  employees: [],
  month: null,
  termInput: null,
  termResult: null,
  savedId: null,
};

// ─────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function dateBR(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

function dateTimeBR(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function pill(label, value, color) {
  return `<div class="pc-pill pc-pill--${color}"><small>${esc(label)}</small><b>R$ ${money(value)}</b></div>`;
}

/** Baixa um arquivo (PDF/Excel) com o token do usuário. */
async function download(url, options = {}, fallbackName = 'arquivo') {
  try {
    const token = getAuthToken();
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { ...options, headers, credentials: 'include', cache: 'no-store' });
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(json?.error || `HTTP ${response.status}`);
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    console.error('[payrollCharges] download:', error);
    alert(`Erro ao gerar o arquivo: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Abas
// ─────────────────────────────────────────────────────────────────────

function setView(view) {
  state.view = view;
  document.body.dataset.pcView = view;
  document.querySelectorAll('[data-pc-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.pcTab === view);
  });
  if (view === 'termination') loadSaved();
}

// ─────────────────────────────────────────────────────────────────────
// Opções (regimes, motivos, avisos, tabelas)
// ─────────────────────────────────────────────────────────────────────

async function loadOptions() {
  const json = await apiFetch(`${API}/options`);
  state.options = json.data;
  const { regimes, reasons, settings } = state.options;

  $('#pc-regime').innerHTML = Object.entries(regimes)
    .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('');
  $('#pc-reason').innerHTML = Object.entries(reasons)
    .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join('');
  fillSettings(settings);
  updateNoticeOptions();
}

function fillSettings(settings) {
  $('#pc-regime').value = settings.regime;
  $('#pc-rat').value = Number(settings.rat_fap_rate);
  $('#pc-third').value = Number(settings.third_rate);
  syncRateInputs();
}

function syncRateInputs() {
  const regime = $('#pc-regime').value;
  $('#pc-rat').disabled = regime === 'SIMPLES';
  $('#pc-third').disabled = regime === 'SIMPLES' || regime === 'SIMPLES_ANEXO_IV';
}

async function saveSettings() {
  try {
    const json = await apiFetch(`${API}/settings`, {
      method: 'PUT',
      body: JSON.stringify({
        regime: $('#pc-regime').value,
        rat_fap_rate: $('#pc-rat').value,
        third_rate: $('#pc-third').value,
      }),
    });
    state.options.settings = json.data;
    syncRateInputs();
    loadMonth();
    if (state.termResult) calculate();
  } catch (error) {
    alert(`Erro ao salvar as alíquotas: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Aba 1 — Encargos do mês
// ─────────────────────────────────────────────────────────────────────

const MONTH_COLS = ['gross', 'dependents', 'inss', 'irrf', 'net', 'fgts', 'patronal', 'rat_third',
  'prov_13', 'prov_vacation', 'prov_charges', 'benefits', 'total_cost'];

function monthQuery() {
  const params = new URLSearchParams({ competence: $('#pc-competence').value });
  if ($('#pc-department').value) params.set('department', $('#pc-department').value);
  return params.toString();
}

async function loadMonth() {
  if (!$('#pc-competence').value) return;
  const body = $('#pc-month-body');
  try {
    const json = await apiFetch(`${API}/month?${monthQuery()}`);
    state.month = json.data;
    renderDepartments(json.data.departments);
    renderMonth(json.data);
  } catch (error) {
    console.error('[payrollCharges] month:', error);
    body.innerHTML = `<tr><td colspan="15" class="pc-empty">Erro ao carregar: ${esc(error.message)}</td></tr>`;
    $('#pc-month-foot').innerHTML = '';
    $('#pc-month-pills').innerHTML = '';
  }
}

function renderDepartments(list) {
  const select = $('#pc-department');
  const current = select.value;
  select.innerHTML = '<option value="">Todos</option>'
    + list.map((dep) => `<option value="${esc(dep)}">${esc(dep)}</option>`).join('');
  select.value = list.includes(current) ? current : '';
}

function cell(key, value) {
  if (key === 'dependents') return `<td class="num">${Number(value || 0)}</td>`;
  if (key === 'total_cost') return `<td class="num"><b>${money(value)}</b></td>`;
  return `<td class="num">${money(value)}</td>`;
}

function renderMonth(data) {
  const body = $('#pc-month-body');
  if (!data.rows.length) {
    body.innerHTML = '<tr><td colspan="15" class="pc-empty">Nenhum colaborador ativo nesta competência.</td></tr>';
  } else {
    body.innerHTML = data.rows.map((row) => `
      <tr class="${row.warnings.length ? 'pc-row--warn' : ''}">
        <td>${esc(row.full_name)}${row.days < 30 ? ` <span class="pc-days">(${row.days} dias)</span>` : ''}
          ${row.warnings.map((w) => `<span class="pc-warn">⚠ ${esc(w)}</span>`).join('')}</td>
        <td>${esc(row.position || '—')}</td>
        ${MONTH_COLS.map((key) => cell(key, row[key])).join('')}
      </tr>`).join('');
  }

  $('#pc-month-foot').innerHTML = `
    <tr><td>Total (${data.rows.length})</td><td></td>${MONTH_COLS.map((key) => cell(key, data.totals[key])).join('')}</tr>`;

  const g = data.guides;
  $('#pc-month-pills').innerHTML = [
    pill('Guia DCTFWeb — INSS (segurados + patronal + RAT + terceiros)', g.inss, 'blue'),
    pill('Guia FGTS Digital', g.fgts, 'blue'),
    pill('DARF IRRF (cód. 0561)', g.irrf, 'blue'),
    pill('Folha líquida a pagar', g.net_payroll, 'green'),
    pill('Custo total da folha', g.total_cost, 'red'),
  ].join('');

  $('#pc-month-note').textContent = `Tabelas INSS/IRRF de ${data.table_year}. `
    + 'Valores calculados a partir do cadastro de Colaboradores (salário base, admissão, dependentes, benefícios). '
    + 'Custo total inclui FGTS e INSS patronal sobre as provisões. Estimativa gerencial: não substitui a folha do contador.';
}

// ─────────────────────────────────────────────────────────────────────
// Aba 2 — Rescisão
// ─────────────────────────────────────────────────────────────────────

async function loadEmployees() {
  const json = await apiFetch(`${API}/employees`);
  state.employees = json.data || [];
  $('#pc-employee').innerHTML = '<option value="">Selecione...</option>'
    + state.employees.map((e) => `<option value="${e.employee_id}">${esc(e.full_name)}`
      + `${e.position ? `  •  ${esc(e.position)}` : ''}${e.active ? '' : ' (inativo)'}</option>`).join('');
}

function onEmployeeChange() {
  const employee = state.employees.find((e) => String(e.employee_id) === $('#pc-employee').value);
  $('#pc-admission').value = employee ? dateBR(employee.admission_date) : '';
  if (employee?.termination_date) $('#pc-term-date').value = String(employee.termination_date).slice(0, 10);
  resetResult();
}

/** Opções de aviso conforme o motivo. */
function updateNoticeOptions() {
  const notices = state.options?.notice_types || {};
  const reason = $('#pc-reason').value;
  let keys = [];
  if (reason === 'SEM_JUSTA_CAUSA' || reason === 'ACORDO') keys = ['INDENIZADO', 'TRABALHADO'];
  if (reason === 'PEDIDO_DEMISSAO') keys = ['TRABALHADO', 'DISPENSADO', 'NAO_CUMPRIDO'];

  const select = $('#pc-notice');
  const current = select.value;
  select.innerHTML = keys.length
    ? keys.map((key) => `<option value="${key}">${esc(notices[key])}</option>`).join('')
    : '<option value="">Não se aplica</option>';
  select.disabled = !keys.length;
  if (keys.includes(current)) select.value = current;
}

function termPayload() {
  return {
    employee_id: $('#pc-employee').value,
    termination_date: $('#pc-term-date').value,
    reason: $('#pc-reason').value,
    notice_type: $('#pc-notice').value || null,
    vacation_periods: $('#pc-vacation').value,
    fgts_balance: $('#pc-fgts').value,
    other_discounts: $('#pc-discounts').value,
  };
}

function resetResult() {
  state.termResult = null;
  state.savedId = null;
  $('#pc-term-result').hidden = true;
  $('#pc-term-empty').hidden = false;
}

async function calculate(event) {
  event?.preventDefault();
  const payload = termPayload();
  if (!payload.employee_id) return alert('Selecione o colaborador.');
  if (!payload.termination_date) return alert('Informe a data de desligamento.');

  try {
    const json = await apiFetch(`${API}/terminations/simulate`, { method: 'POST', body: JSON.stringify(payload) });
    state.termInput = payload;
    state.termResult = json.data;
    state.savedId = null;
    renderTermination(json.data, null);
  } catch (error) {
    alert(`Não foi possível calcular: ${error.message}`);
  }
}

function row(label, ref, value, cls = '') {
  const negative = cls.includes('neg');
  return `<tr class="${cls}"><td>${esc(label)}</td><td class="ref">${esc(ref || '')}</td>`
    + `<td class="v">${negative && value ? '− ' : ''}${money(value)}</td></tr>`;
}

function renderTermination(result, saved) {
  $('#pc-term-empty').hidden = true;
  $('#pc-term-result').hidden = false;

  const chip = [];
  if (result.notice_days) {
    chip.push(`Aviso prévio: ${result.notice_label}`);
    if (result.reason === 'SEM_JUSTA_CAUSA' || result.reason === 'ACORDO') {
      chip.push(`30 + ${result.notice_days - 30} dias (${result.years} ano${result.years === 1 ? '' : 's'}) = ${result.notice_days} dias`);
    }
    if (result.projected_end !== result.termination_date) chip.push(`projeção até ${dateBR(result.projected_end)}`);
  } else {
    chip.push(result.reason_label);
  }
  $('#pc-term-chip').textContent = chip.join('  •  ');

  $('#pc-term-earnings').innerHTML = [
    ...result.earnings.map((item) => row(item.label, item.ref, item.value)),
    row('Total de proventos', '', result.totals.earnings, 'tot'),
    ...result.discounts.map((item) => row(item.label, item.ref, item.value, 'neg')),
    row('Líquido a pagar ao colaborador', '', result.totals.net, 'tot'),
  ].join('');

  $('#pc-term-costs').innerHTML = [
    ...result.company_costs.map((item) => row(item.label, item.ref, item.value)),
    row('Custo total da rescisão', '', result.totals.cost, 'tot'),
  ].join('');

  $('#pc-term-pills').innerHTML = [
    pill('Pagar ao colaborador (até 10 dias)', result.totals.net, 'green'),
    pill('Guia FGTS Digital (mês + multa)', result.totals.fgts_guide, 'blue'),
    pill('Custo total', result.totals.cost, 'red'),
  ].join('');

  const meta = [];
  if (result.fgts_balance_estimated) meta.push(`Saldo do FGTS estimado em R$ ${money(result.fgts_balance)}; informe o extrato para o valor exato.`);
  if (saved) meta.push(`Simulação nº ${saved.id} • ${saved.status === 'CONFIRMADA' ? 'desligamento confirmado' : 'salva'}.`);
  $('#pc-term-meta').textContent = meta.join(' ');

  const confirmed = saved?.status === 'CONFIRMADA';
  $('#pc-btn-save').disabled = Boolean(saved);
  $('#pc-btn-confirm').disabled = confirmed;
}

async function saveSimulation() {
  if (!state.termResult) return null;
  try {
    const json = await apiFetch(`${API}/terminations`, { method: 'POST', body: JSON.stringify(state.termInput) });
    state.savedId = json.data.id;
    renderTermination(json.data.result, json.data);
    loadSaved();
    return json.data;
  } catch (error) {
    alert(`Erro ao salvar a simulação: ${error.message}`);
    return null;
  }
}

async function confirmDismissal() {
  if (!state.termResult) return;
  const ok = confirm(
    `Confirmar o desligamento de ${state.termResult.full_name} em ${dateBR(state.termResult.termination_date)}?\n\n`
    + 'A data de desligamento será gravada no cadastro e o colaborador ficará inativo.',
  );
  if (!ok) return;

  let id = state.savedId;
  if (!id) id = (await saveSimulation())?.id;
  if (!id) return;

  try {
    const json = await apiFetch(`${API}/terminations/${id}/confirm`, { method: 'POST' });
    renderTermination(json.data.result, json.data);
    await Promise.all([loadSaved(), loadEmployees()]);
    $('#pc-employee').value = String(json.data.employee_id);
    loadMonth();
  } catch (error) {
    alert(`Erro ao confirmar o desligamento: ${error.message}`);
  }
}

function termPdf() {
  if (!state.termResult) return alert('Calcule a rescisão primeiro.');
  if (state.savedId) return download(`${API}/terminations/${state.savedId}/pdf`, {}, 'rescisao.pdf');
  return download(`${API}/terminations/simulate/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.termInput),
  }, 'rescisao-simulacao.pdf');
}

async function loadSaved() {
  const body = $('#pc-saved-body');
  try {
    const json = await apiFetch(`${API}/terminations`);
    const reasons = state.options?.reasons || {};
    const list = json.data || [];
    body.innerHTML = list.length ? list.map((t) => `
      <tr>
        <td>${t.id}</td>
        <td>${esc(t.employee_name)}</td>
        <td>${dateBR(t.termination_date)}</td>
        <td>${esc(reasons[t.reason] || t.reason)}</td>
        <td class="num">${money(t.net_total)}</td>
        <td class="num">${money(t.cost_total)}</td>
        <td><span class="pc-status ${t.status === 'CONFIRMADA' ? 'pc-status--ok' : ''}">${t.status === 'CONFIRMADA' ? 'Confirmada' : 'Simulação'}</span></td>
        <td>${dateTimeBR(t.created_at)}${t.created_by_name ? ` • ${esc(t.created_by_name)}` : ''}</td>
        <td>${actionIconsHtml([
          { action: 'view', title: 'Abrir', attrs: { 'data-act': 'open', 'data-id': t.id } },
          { action: 'document', title: 'Gerar PDF', attrs: { 'data-act': 'pdf', 'data-id': t.id } },
          ...(t.status === 'CONFIRMADA' ? [] : [{ action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': t.id } }]),
        ])}</td>
      </tr>`).join('')
      : '<tr><td colspan="9" class="pc-empty">Nenhuma simulação salva.</td></tr>';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="9" class="pc-empty">Erro ao carregar: ${esc(error.message)}</td></tr>`;
  }
}

async function openSaved(id) {
  try {
    const json = await apiFetch(`${API}/terminations/${id}`);
    const saved = json.data;
    const input = saved.input || {};
    $('#pc-employee').value = String(saved.employee_id);
    $('#pc-admission').value = dateBR(saved.result?.admission_date);
    $('#pc-term-date').value = String(input.termination_date || '').slice(0, 10);
    $('#pc-reason').value = input.reason || saved.reason;
    updateNoticeOptions();
    if (input.notice_type) $('#pc-notice').value = input.notice_type;
    $('#pc-vacation').value = String(input.vacation_periods || 0);
    $('#pc-fgts').value = input.fgts_balance ?? '';
    $('#pc-discounts').value = input.other_discounts || '';
    state.termInput = input;
    state.termResult = saved.result;
    state.savedId = saved.id;
    renderTermination(saved.result, saved);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    alert(`Erro ao abrir a simulação: ${error.message}`);
  }
}

async function onSavedClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.act === 'open') return openSaved(id);
  if (button.dataset.act === 'pdf') return download(`${API}/terminations/${id}/pdf`, {}, `rescisao-${id}.pdf`);
  if (button.dataset.act === 'delete') {
    if (!confirm(`Excluir a simulação nº ${id}?`)) return;
    try {
      await apiFetch(`${API}/terminations/${id}`, { method: 'DELETE' });
      if (String(state.savedId) === String(id)) resetResult();
      loadSaved();
    } catch (error) {
      alert(`Erro ao excluir: ${error.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Modal de tabelas INSS / IRRF
// ─────────────────────────────────────────────────────────────────────

function tableInput(value, step = '0.01') {
  return `<input type="number" step="${step}" value="${value ?? ''}" />`;
}

function fillTableForm(table) {
  $('#pt-min-wage').value = Number(table.min_wage) || '';
  $('#pt-inss').innerHTML = [0, 1, 2, 3].map((i) => {
    const b = table.inss_brackets?.[i] || {};
    return `<tr><td>${tableInput(b.limit)}</td><td>${tableInput(b.rate)}</td></tr>`;
  }).join('');
  $('#pt-irrf').innerHTML = [0, 1, 2, 3, 4].map((i) => {
    const b = table.irrf_brackets?.[i] || {};
    return `<tr><td>${tableInput(b.limit)}</td><td>${tableInput(b.rate)}</td><td>${tableInput(b.deduction)}</td></tr>`;
  }).join('');
  $('#pt-dependent').value = Number(table.irrf_dependent) || '';
  $('#pt-simplified').value = Number(table.irrf_simplified) || '';
  const red = table.irrf_reduction || {};
  $('#pt-red-full').value = red.full_limit ?? '';
  $('#pt-red-partial').value = red.partial_limit ?? '';
  $('#pt-red-a').value = red.a ?? '';
  $('#pt-red-b').value = red.b ?? '';
}

function openTablesModal() {
  const { tables, settings } = state.options;
  const year = Number(($('#pc-competence').value || todayIso()).slice(0, 4));
  const select = $('#pt-year');
  select.innerHTML = tables.map((t) => `<option value="${t.year}">${t.year}</option>`).join('');
  select.value = tables.some((t) => t.year === year) ? String(year) : String(tables[0]?.year || '');
  fillTableForm(tables.find((t) => String(t.year) === select.value) || {});
  $('#pt-new-year').value = '';
  $('#pt-patronal').value = Number(settings.patronal_rate);
  $('#pt-fgts').value = Number(settings.fgts_rate);
  Modal.open('pc-tables-modal', { focusSelector: '#pt-year' });
}

function readRows(selector, fields) {
  return [...document.querySelectorAll(`${selector} tr`)].map((tr) => {
    const inputs = tr.querySelectorAll('input');
    return Object.fromEntries(fields.map((field, i) => [field, inputs[i].value === '' ? null : Number(inputs[i].value)]));
  }).filter((item) => item.rate !== null);
}

async function saveTables() {
  const year = $('#pt-new-year').value || $('#pt-year').value;
  const payload = {
    min_wage: $('#pt-min-wage').value,
    inss_brackets: readRows('#pt-inss', ['limit', 'rate']),
    irrf_brackets: readRows('#pt-irrf', ['limit', 'rate', 'deduction']),
    irrf_dependent: $('#pt-dependent').value,
    irrf_simplified: $('#pt-simplified').value,
    irrf_reduction: $('#pt-red-full').value ? {
      full_limit: $('#pt-red-full').value,
      partial_limit: $('#pt-red-partial').value,
      a: $('#pt-red-a').value,
      b: $('#pt-red-b').value,
    } : null,
  };

  try {
    await apiFetch(`${API}/tables/${encodeURIComponent(year)}`, { method: 'PUT', body: JSON.stringify(payload) });
    await apiFetch(`${API}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ patronal_rate: $('#pt-patronal').value, fgts_rate: $('#pt-fgts').value }),
    });
    await loadOptions();
    Modal.close('pc-tables-modal');
    loadMonth();
    if (state.termResult && !state.savedId) calculate();
  } catch (error) {
    alert(`Erro ao salvar as tabelas: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────

function bind() {
  document.querySelectorAll('[data-pc-tab]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.pcTab));
  });

  $('#pc-competence').addEventListener('change', loadMonth);
  $('#pc-department').addEventListener('change', loadMonth);
  $('#pc-regime').addEventListener('change', saveSettings);
  $('#pc-rat').addEventListener('change', saveSettings);
  $('#pc-third').addEventListener('change', saveSettings);

  $('#pc-term-form').addEventListener('submit', calculate);
  $('#pc-employee').addEventListener('change', onEmployeeChange);
  $('#pc-reason').addEventListener('change', () => { updateNoticeOptions(); resetResult(); });
  ['#pc-term-date', '#pc-notice', '#pc-vacation', '#pc-fgts', '#pc-discounts'].forEach((selector) => {
    $(selector).addEventListener('change', resetResult);
  });
  $('#pc-btn-save').addEventListener('click', saveSimulation);
  $('#pc-btn-confirm').addEventListener('click', confirmDismissal);
  $('#pc-btn-term-pdf').addEventListener('click', termPdf);
  $('#pc-saved-body').addEventListener('click', onSavedClick);

  $('#pc-btn-tables').addEventListener('click', openTablesModal);
  $('#pt-year').addEventListener('change', () => {
    fillTableForm(state.options.tables.find((t) => String(t.year) === $('#pt-year').value) || {});
  });
  $('#pt-save').addEventListener('click', saveTables);

  $('#pc-btn-excel').addEventListener('click', () => download(`${API}/month/excel?${monthQuery()}`, {}, 'encargos.xlsx'));
  $('#pc-btn-pdf').addEventListener('click', () => {
    if (state.view === 'termination') return termPdf();
    return download(`${API}/month/pdf?${monthQuery()}`, {}, 'encargos.pdf');
  });
}

async function init() {
  Modal.setup();
  bind();
  $('#pc-competence').value = todayIso().slice(0, 7);
  $('#pc-term-date').value = todayIso();

  try {
    await loadOptions();
    await Promise.all([loadMonth(), loadEmployees()]);
  } catch (error) {
    console.error('[payrollCharges] init:', error);
    alert(`Erro ao carregar o módulo: ${error.message}`);
  }
}

init();
