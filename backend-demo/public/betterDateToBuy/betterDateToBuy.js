// ╔════════════════════════════════════════════════════════════════════╗
// ║ betterDateToBuy.js — Melhor Data de Compra | CONSART ERP           ║
// ║ Lembrete mensal de recompra por cliente.                           ║
// ║  - Lista com situação do mês (contatar agora / próximos dias /     ║
// ║    contatado / pausado) e histórico de NF-e de cada cliente        ║
// ║  - Modal do alerta com dia sugerido pelo histórico                 ║
// ║  - Sugestões: clientes frequentes sem alerta, criação em lote      ║
// ╚════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { createSortableTable } from '/public/includes/js/sortableTable.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { openCustomersModalSearch } from '/public/modalsSearch/customersModalSearch.js';

const API = '/api/betterDateToBuy';
const COLSPAN = 11;
const SITUATION_RANK = { due: 0, upcoming: 1, contacted: 2, paused: 3 };

const $ = (id) => document.getElementById(id);

const state = {
  rows: [],
  suggestions: [],
  leadDays: 3,
  sortColumn: 'alert_day',
  sortDirection: 'asc',
  profile: null
};

// ──────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateBR(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function formatMoney(value) {
  if (value == null || value === '') return '';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function formatPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  // Espaço e hífen não quebráveis: o telefone fica numa linha só
  if (digits.length === 11) return `(${digits.slice(0, 2)})\u00a0${digits.slice(2, 7)}\u2011${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)})\u00a0${digits.slice(2, 6)}\u2011${digits.slice(6)}`;
  return String(raw ?? '');
}

/** Telefone com link para o WhatsApp (celular primeiro). */
function contactHtml(row) {
  const phone = row.mobile_number || row.phone_number;
  if (!phone) return '<span class="td-muted">—</span>';

  const digits = String(phone).replace(/\D/g, '');
  const wa = digits.length >= 10 ? `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}` : '';
  const label = escapeHtml(formatPhone(phone));

  return wa
    ? `<a href="${wa}" target="_blank" rel="noopener" title="Abrir conversa no WhatsApp">${label}</a>`
    : label;
}

function customerName(row) {
  return row.trade_name || row.legal_name || `Cliente #${row.customer_id}`;
}

function lastPurchaseText(row) {
  if (!row.last_purchase_date) return '';
  const nfe = row.last_nfe_number ? ` · NF-e ${row.last_nfe_number}` : '';
  return `${formatDateBR(row.last_purchase_date)}${nfe}`;
}

function usualDayText(row) {
  return row.usual_day ? `dia ${row.usual_day}` : '';
}

function intervalText(row) {
  return row.avg_interval_days ? `${row.avg_interval_days} dias` : '';
}

function notify(message, variant = 'success') {
  if (variant === 'error') console.error('[betterDateToBuy]', message);
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Melhor Data de Compra'),
    message: String(message ?? ''),
    timeoutMs: variant === 'success' ? 2500 : undefined
  });
}

async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Confirmar' } = {}) {
  const button = await showCenterModal({
    variant: 'warning',
    title,
    message,
    timeoutMs: null,
    buttons: [
      { label: 'Cancelar', variant: 'cancel' },
      { label: confirmLabel, variant: 'confirm' }
    ]
  });
  return String(button?.variant || '').toLowerCase() === 'confirm';
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }
  return data;
}

// ──────────────────────────────────────────────────────────────────────
// SITUAÇÃO
// ──────────────────────────────────────────────────────────────────────
function situationPill(row) {
  const days = Number(row.days_until);

  switch (row.situation) {
    case 'due': {
      const when = days === 0 ? 'hoje' : `há ${plural(-days, 'dia', 'dias')}`;
      return `<span class="summary-pill summary-pill--warning" title="Dia do alerta: ${when}">Contatar agora</span>`;
    }
    case 'upcoming':
      return `<span class="summary-pill summary-pill--info">${days === 1 ? 'Amanhã' : `Em ${days} dias`}</span>`;
    case 'contacted':
      return `<span class="summary-pill summary-pill--success">Contatado ${escapeHtml(formatDateBR(row.last_alert_sent).slice(0, 5))}</span>`;
    default:
      return '<span class="summary-pill">Pausado</span>';
  }
}

function matchesSituation(row, filter) {
  if (!filter) return true;
  if (filter === 'week') return row.situation === 'upcoming' && Number(row.days_until) <= 7;
  return row.situation === filter;
}

// ──────────────────────────────────────────────────────────────────────
// LISTA
// ──────────────────────────────────────────────────────────────────────
function visibleRows() {
  const q = $('fQ').value.trim().toLowerCase();
  const situation = $('fSituation').value;
  const dir = state.sortDirection === 'desc' ? -1 : 1;
  const col = state.sortColumn;

  const filtered = state.rows.filter((row) => {
    if (!matchesSituation(row, situation)) return false;
    if (!q) return true;
    const hay = [
      customerName(row), row.legal_name, row.notes, row.mobile_number, row.phone_number
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  return filtered.sort((a, b) => {
    const va = col === 'trade_name' ? customerName(a) : a[col];
    const vb = col === 'trade_name' ? customerName(b) : b[col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' || typeof vb === 'number') return (Number(va) - Number(vb)) * dir;
    return String(va).localeCompare(String(vb), 'pt-BR') * dir;
  });
}

function renderSummary() {
  const due = state.rows.filter((r) => r.situation === 'due').length;
  const week = state.rows.filter((r) => matchesSituation(r, 'week')).length;
  const contacted = state.rows.filter((r) => r.situation === 'contacted').length;

  $('sumDue').textContent = due;
  $('sumWeek').textContent = week;
  $('sumContacted').textContent = contacted;

  const today = state.rows[0]?.today;
  $('todayInfo').textContent = today ? `Hoje: ${formatDateBR(today)}` : '';
}

function renderTable() {
  const rows = visibleRows();
  const tbody = $('tbody');

  $('tableInfo').textContent = rows.length === state.rows.length
    ? plural(rows.length, 'alerta', 'alertas')
    : `${rows.length} de ${plural(state.rows.length, 'alerta', 'alertas')}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="td-center">${
      state.rows.length
        ? 'Nenhum alerta para este filtro.'
        : 'Nenhum alerta cadastrado. Use <b>Sugerir pelo histórico</b> ou <b>Novo Alerta</b>.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const id = row.better_date_to_buy_id;
    const contacted = row.situation === 'contacted';
    const paused = row.situation === 'paused';

    return `
    <tr data-id="${escapeHtml(id)}">
      <td class="td-left">${escapeHtml(customerName(row))}</td>
      <td>${contactHtml(row)}</td>
      <td>${escapeHtml(row.alert_day)}</td>
      <td>${situationPill(row)}</td>
      <td>${escapeHtml(lastPurchaseText(row)) || '<span class="td-muted">Sem NF-e</span>'}</td>
      <td class="td-right">${escapeHtml(formatMoney(row.last_purchase_total))}</td>
      <td>${row.purchases_12m ? escapeHtml(row.purchases_12m) : ''}</td>
      <td>${escapeHtml(usualDayText(row))}</td>
      <td>${escapeHtml(formatDateBR(row.next_expected_date))}</td>
      <td class="td-left">${escapeHtml(row.notes || '')}</td>
      <td>${actionIconsHtml([
        contacted
          ? { action: 'undo', title: 'Desfazer contato (volta para pendente)', attrs: { 'data-action': 'unmark', 'data-id': id } }
          : { action: 'confirm', title: 'Marcar como contatado neste mês', attrs: { 'data-action': 'mark', 'data-id': id }, disabled: paused },
        { action: 'edit', title: 'Editar', attrs: { 'data-action': 'edit', 'data-id': id } },
        paused
          ? { action: 'play', title: 'Reativar alerta', attrs: { 'data-action': 'activate', 'data-id': id } }
          : { action: 'pause', title: 'Pausar alerta', attrs: { 'data-action': 'pause', 'data-id': id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-action': 'delete', 'data-id': id } }
      ])}</td>
    </tr>`;
  }).join('');
}

async function loadAlerts() {
  try {
    const response = await requestJSON(API);
    state.leadDays = Number(response.lead_days) || state.leadDays;
    state.rows = (response.data || []).map((row) => ({
      ...row,
      alert_day: Number(row.alert_day),
      situation_rank: SITUATION_RANK[row.situation] ?? 9
    }));
    renderSummary();
    renderTable();
  } catch (err) {
    $('tbody').innerHTML = `<tr><td colspan="${COLSPAN}" class="td-center">Não foi possível carregar os alertas: ${escapeHtml(err.message)}</td></tr>`;
    notify(err.message, 'error');
  }
}

const findRow = (id) => state.rows.find((row) => String(row.better_date_to_buy_id) === String(id));

// ──────────────────────────────────────────────────────────────────────
// AÇÕES DA LINHA
// ──────────────────────────────────────────────────────────────────────
async function onTableClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;

  const { action, id } = button.dataset;
  const row = findRow(id);
  if (!row) return;

  try {
    if (action === 'edit') return openAlertModal(row);

    if (action === 'mark') {
      await requestJSON(`${API}/${id}/mark-sent`, { method: 'PATCH' });
      notify(`${customerName(row)} marcado como contatado.`);
    } else if (action === 'unmark') {
      await requestJSON(`${API}/${id}/unmark-sent`, { method: 'PATCH' });
    } else if (action === 'pause' || action === 'activate') {
      await requestJSON(`${API}/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: action === 'pause' ? 'inactive' : 'active' })
      });
    } else if (action === 'delete') {
      if (!(await removeAlert(row))) return;
    }

    await loadAlerts();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function removeAlert(row) {
  const ok = await confirmCenter(`Excluir o alerta de ${customerName(row)}?`, {
    title: 'Excluir alerta',
    confirmLabel: 'Excluir'
  });
  if (!ok) return false;

  await requestJSON(`${API}/${row.better_date_to_buy_id}`, { method: 'DELETE' });
  notify('Alerta excluído.');
  return true;
}

// ──────────────────────────────────────────────────────────────────────
// MODAL DO ALERTA
// ──────────────────────────────────────────────────────────────────────
function fillProfile(profile) {
  state.profile = profile || null;
  const p = profile || {};

  $('pLast').value = lastPurchaseText(p) || (profile === null ? 'Sem NF-e emitida' : '');
  $('pTotal').value = formatMoney(p.last_purchase_total);
  $('pCount').value = p.purchases_12m ? plural(p.purchases_12m, 'NF-e', 'NF-e') : '';
  $('pInterval').value = intervalText(p) ? `a cada ${intervalText(p)}` : '';
  $('pUsual').value = p.usual_day ? `por volta do dia ${p.usual_day}` : '';
  $('pNext').value = formatDateBR(p.next_expected_date);

  const button = $('btnUseSuggested');
  button.disabled = !p.suggested_day;
  $('btnUseSuggestedText').textContent = p.suggested_day
    ? `Usar dia sugerido: ${p.suggested_day} (${state.leadDays} dias antes)`
    : 'Sem histórico para sugerir o dia';
}

async function loadProfile(customerId, { applySuggestion = false } = {}) {
  fillProfile(undefined);
  $('pLast').value = 'Carregando...';

  try {
    const response = await requestJSON(`${API}/purchase-profile/${customerId}`);
    state.leadDays = Number(response.lead_days) || state.leadDays;
    fillProfile(response.data);

    const editingId = $('alert_id').value;
    if (response.existing_alert_id && String(response.existing_alert_id) !== String(editingId)) {
      notify('Este cliente já tem um alerta. Edite o alerta existente na lista.', 'warning');
    }

    if (applySuggestion && response.data?.suggested_day && !$('alert_day').value) {
      $('alert_day').value = response.data.suggested_day;
    }
  } catch (err) {
    fillProfile(null);
    console.warn('[betterDateToBuy] histórico', err);
  }
}

function openAlertModal(row = null) {
  const editing = Boolean(row?.better_date_to_buy_id);

  $('form').reset();
  $('alert_id').value = editing ? row.better_date_to_buy_id : '';
  $('customer_id').value = row?.customer_id ?? '';
  $('customer_name').value = row ? customerName(row) : '';
  $('alert_day').value = row?.alert_day ?? '';
  $('status').value = row?.status === 'inactive' ? 'inactive' : 'active';
  $('notes').value = row?.notes ?? '';
  $('mTitle').textContent = editing ? `Editar alerta · ${customerName(row)}` : 'Novo alerta';
  $('btnDelete').hidden = !editing;
  $('btnDelete').style.display = editing ? '' : 'none'; // .btn sobrepõe [hidden]

  if (editing) fillProfile(row.last_purchase_date ? row : null);
  else fillProfile(undefined);

  Modal.open($('modal'), { focusSelector: editing ? '#alert_day' : '#btnPickCustomer' });
}

function pickCustomer() {
  openCustomersModalSearch({
    onPick(customer) {
      const id = customer.customer_id || customer.id || '';
      $('customer_id').value = id;
      $('customer_name').value =
        customer.trade_name || customer.nome_fantasia ||
        customer.legal_name || customer.razao_social || customer.nome || '';
      if (id) loadProfile(id, { applySuggestion: true });
    }
  });
}

async function saveAlert(event) {
  event?.preventDefault?.();

  const id = $('alert_id').value;
  const payload = {
    customer_id: Number($('customer_id').value),
    alert_day: Number($('alert_day').value),
    status: $('status').value,
    notes: $('notes').value.trim()
  };

  if (!payload.customer_id) return notify('Selecione o cliente.', 'warning');
  if (!Number.isInteger(payload.alert_day) || payload.alert_day < 1 || payload.alert_day > 31) {
    return notify('O dia do alerta deve ser entre 1 e 31.', 'warning');
  }

  try {
    await requestJSON(id ? `${API}/${id}` : API, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    Modal.close($('modal'));
    notify(id ? 'Alerta atualizado.' : 'Alerta criado.');
    await loadAlerts();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function deleteFromModal() {
  const row = findRow($('alert_id').value);
  if (!row) return;
  try {
    if (await removeAlert(row)) {
      Modal.close($('modal'));
      await loadAlerts();
    }
  } catch (err) {
    notify(err.message, 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────
// SUGESTÕES PELO HISTÓRICO
// ──────────────────────────────────────────────────────────────────────
function renderSuggestions() {
  const tbody = $('suggestTbody');

  if (!state.suggestions.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="td-center">Nenhuma sugestão: todos os clientes frequentes já têm alerta.</td></tr>';
  } else {
    tbody.innerHTML = state.suggestions.map((row, index) => `
      <tr>
        <td><input type="checkbox" data-index="${index}" checked aria-label="Selecionar ${escapeHtml(customerName(row))}" /></td>
        <td class="td-left">${escapeHtml(customerName(row))}</td>
        <td>${contactHtml(row)}</td>
        <td>${escapeHtml(row.purchases_12m)}</td>
        <td>${escapeHtml(lastPurchaseText(row))}</td>
        <td>${escapeHtml(intervalText(row))}</td>
        <td>${escapeHtml(usualDayText(row))}</td>
        <td><div class="fields fields-h-5 fields-w-full fields-font-3"><input type="number" min="1" max="31" step="1" data-day="${index}" value="${escapeHtml(row.suggested_day)}" aria-label="Dia do alerta" /></div></td>
      </tr>`).join('');
  }

  $('suggestAll').checked = state.suggestions.length > 0;
  updateSuggestCount();
}

function selectedSuggestions() {
  return [...$('suggestTbody').querySelectorAll('input[data-index]:checked')].map((box) => {
    const index = Number(box.dataset.index);
    const row = state.suggestions[index];
    const dayInput = $('suggestTbody').querySelector(`input[data-day="${index}"]`);
    return { customer_id: row.customer_id, alert_day: Number(dayInput?.value) };
  });
}

function updateSuggestCount() {
  const count = selectedSuggestions().length;
  $('suggestInfo').textContent = state.suggestions.length
    ? `${count} de ${plural(state.suggestions.length, 'cliente', 'clientes')} selecionados`
    : '';
  $('btnCreateSuggested').disabled = count === 0;
  $('btnCreateSuggestedText').textContent = count ? `Criar ${plural(count, 'alerta', 'alertas')}` : 'Criar alertas';
}

async function openSuggestions() {
  $('suggestTbody').innerHTML = '<tr><td colspan="8" class="td-center">Analisando o histórico de NF-e...</td></tr>';
  $('suggestInfo').textContent = '';
  $('btnCreateSuggested').disabled = true;
  Modal.open($('modalSuggest'));

  try {
    const response = await requestJSON(`${API}/suggestions`);
    state.leadDays = Number(response.lead_days) || state.leadDays;
    state.suggestions = response.data || [];
    renderSuggestions();
  } catch (err) {
    $('suggestTbody').innerHTML = `<tr><td colspan="8" class="td-center">Não foi possível gerar sugestões: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function createSuggested() {
  const items = selectedSuggestions();
  if (items.some((item) => !Number.isInteger(item.alert_day) || item.alert_day < 1 || item.alert_day > 31)) {
    return notify('Confira o dia do alerta: deve ser entre 1 e 31.', 'warning');
  }

  try {
    const result = await requestJSON(`${API}/bulk`, {
      method: 'POST',
      body: JSON.stringify({ items })
    });
    Modal.close($('modalSuggest'));
    notify(`${plural(result.created, 'alerta criado', 'alertas criados')}.`);
    await loadAlerts();
  } catch (err) {
    notify(err.message, 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────────
function bindEvents() {
  $('fQ').addEventListener('input', renderTable);
  $('fSituation').addEventListener('change', renderTable);
  $('btnClear').addEventListener('click', () => {
    $('fQ').value = '';
    $('fSituation').value = '';
    renderTable();
  });

  $('summaryPills').addEventListener('click', (event) => {
    const pill = event.target.closest('[data-situation]');
    if (!pill) return;
    const fs = $('fSituation');
    fs.value = fs.value === pill.dataset.situation ? '' : pill.dataset.situation;
    renderTable();
  });

  $('btnNew').addEventListener('click', () => openAlertModal(null));
  $('btnSuggest').addEventListener('click', openSuggestions);
  $('tbody').addEventListener('click', onTableClick);
  $('tbody').addEventListener('dblclick', (event) => {
    if (event.target.closest('a, button')) return;
    const tr = event.target.closest('tr[data-id]');
    const row = tr && findRow(tr.dataset.id);
    if (row) openAlertModal(row);
  });

  $('form').addEventListener('submit', saveAlert);
  $('btnPickCustomer').addEventListener('click', pickCustomer);
  $('customer_name').addEventListener('click', pickCustomer);
  $('btnUseSuggested').addEventListener('click', () => {
    if (state.profile?.suggested_day) $('alert_day').value = state.profile.suggested_day;
  });
  $('btnDelete').addEventListener('click', deleteFromModal);

  $('suggestAll').addEventListener('change', (event) => {
    $('suggestTbody').querySelectorAll('input[data-index]').forEach((box) => {
      box.checked = event.target.checked;
    });
    updateSuggestCount();
  });
  $('suggestTbody').addEventListener('change', updateSuggestCount);
  $('btnCreateSuggested').addEventListener('click', createSuggested);
}

function init() {
  Modal.setup();
  bindEvents();

  // Link da Home abre já filtrado (?situacao=due)
  const preset = new URLSearchParams(window.location.search).get('situacao');
  if (preset && [...$('fSituation').options].some((o) => o.value === preset)) {
    $('fSituation').value = preset;
  }

  createSortableTable({
    table: $('alertsTable'),
    defaultColumn: state.sortColumn,
    defaultDirection: state.sortDirection,
    allowedColumns: [
      'trade_name', 'alert_day', 'situation_rank', 'last_purchase_date',
      'last_purchase_total', 'purchases_12m', 'usual_day', 'next_expected_date'
    ],
    onSort: ({ column, direction }) => {
      state.sortColumn = column;
      state.sortDirection = direction;
      renderTable();
    }
  });

  loadAlerts();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
