// ╔══════════════════════════════════════════════════════════════════════╗
// ║ usoConsumo.js — Frontend Uso e Consumo                              ║
// ║ Path: backend/public/usoConsumo/usoConsumo.js                       ║
// ║ CONSART ERP | ESM                                                   ║
// ║ ✔ Itens lançados direto no módulo (sem orçamento)                   ║
// ║ ✔ Rascunho / Finalizar (baixa estoque e lote) / Excluir com estorno ║
// ║ ✔ NF-e: emitir, atualizar, reenviar, XML, DANFE, cancelar           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { openProductsModalSearch } from '/public/modalsSearch/productsModalSearch.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import { getAuthToken } from '/public/includes/js/apiFetch.js';
import { enhanceBrDateTime } from '/public/includes/js/brDateTimeInput.js?v=2';

const API_BASE = window.location.origin;
const API = `${API_BASE}/api/uso-consumo`;
const $ = (id) => document.getElementById(id);

const state = {
  page: 1,
  pageSize: 50,
  total: 0,
  rows: [],
  product: null, // produto carregado no editor de itens
  items: [],
  editingId: null,
};

const safe = (value, fallback = '-') => value === null || value === undefined || value === '' ? fallback : String(value);
const escapeHtml = (value) => safe(value, '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const moneyBR = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numBR = (value, digits = 4) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits });
const dateBR = (value) => { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('pt-BR') : '-'; };
const onlyDateBR = (value) => {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const round4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;

// ======================================================================
// Avisos (centerAlertModal)
// ======================================================================

// O centerAlertModal monta a mensagem como HTML: escapa o texto e troca \n por <br>.
const toHtml = (text) => escapeHtml(text).replace(/\n/g, '<br>');

function notify(message, variant = 'info', title = 'Uso e Consumo', { html = false } = {}) {
  return showCenterModal({
    variant,
    title: variant === 'error' ? 'Atenção' : title,
    message: html ? message : toHtml(message),
  });
}

async function confirmBox(message, { title = 'Confirmar', confirmLabel = 'Confirmar', danger = false } = {}) {
  let confirmed = false;
  await showCenterModal({
    variant: danger ? 'warning' : 'info',
    title,
    message: toHtml(message),
    timeoutMs: null,
    buttons: [
      { label: 'Cancelar', variant: 'cancel' },
      { label: confirmLabel, variant: danger ? 'danger' : 'primary', action: () => { confirmed = true; } },
    ],
  });
  return confirmed;
}

// ======================================================================
// HTTP
// ======================================================================

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(url, { ...options, headers });
  let json;
  try { json = await response.json(); } catch { json = {}; }
  if (!response.ok || json.ok === false) {
    const error = new Error(json.message || json.error || `Erro HTTP ${response.status}.`);
    error.payload = json;
    throw error;
  }
  return json;
}

// ======================================================================
// Modal
// ======================================================================

function openUsoConsumoModal() {
  const modal = $('modalUsoConsumo');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('is-open');
  document.body.classList.add('uc-modal-open');
  window.setTimeout(() => $('productSearch')?.focus(), 0);
}

function closeUsoConsumoModal() {
  const modal = $('modalUsoConsumo');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-open');
  document.body.classList.remove('uc-modal-open');
}

function setMovementDate(iso) {
  const input = $('movementDate');
  if (!input) return;
  input.value = iso || todayIso();
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ======================================================================
// Departamentos e Colaboradores (cadastros do R.H)
// ======================================================================

async function loadCatalogs() {
  const [departments, employees] = await Promise.allSettled([
    request(`${API_BASE}/api/employees-departments?active=true`),
    request(`${API_BASE}/api/employees?active=true&limit=500`),
  ]);

  const deptRows = departments.status === 'fulfilled' ? (departments.value.data || departments.value.rows || []) : [];
  const empRows = employees.status === 'fulfilled' ? (employees.value.rows || employees.value.data || []) : [];

  let deptOptions = deptRows
    .filter((d) => d.is_active !== false && d.active !== false)
    .map((d) => `<option value="${escapeHtml(d.employee_department_id)}" data-name="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`);

  // Sem cadastro de Departamentos: usa os departamentos escritos nos colaboradores.
  if (!deptOptions.length) {
    const names = [...new Set(empRows.map((e) => String(e.department || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    deptOptions = names.map((name) => `<option value="text:${escapeHtml(name)}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
  }

  $('departmentId').innerHTML = '<option value="">Selecione...</option>' + deptOptions.join('');

  $('employeeId').innerHTML = '<option value="">Selecione...</option>' + empRows
    .map((e) => {
      const name = e.full_name || e.name || e.nome || '';
      const dept = e.employee_department_id || '';
      return `<option value="${escapeHtml(e.employee_id)}" data-name="${escapeHtml(name)}" data-department="${escapeHtml(dept)}" data-department-name="${escapeHtml(e.department || '')}">${escapeHtml(name)}</option>`;
    })
    .join('');
}

/** Garante que um valor antigo (texto livre) apareça no select. */
function selectByIdOrName(select, id, name) {
  if (!select) return;
  if (id && select.querySelector(`option[value="${CSS.escape(String(id))}"]`)) {
    select.value = String(id);
    return;
  }
  const upper = String(name || '').trim().toUpperCase();
  const byName = Array.from(select.options).find((o) => String(o.dataset.name || '').trim().toUpperCase() === upper && upper);
  if (byName) { select.value = byName.value; return; }
  if (name) {
    const opt = document.createElement('option');
    opt.value = `text:${name}`;
    opt.dataset.name = name;
    opt.textContent = name;
    select.appendChild(opt);
    select.value = opt.value;
  } else {
    select.value = '';
  }
}

function selectedCatalog(select) {
  const opt = select?.selectedOptions?.[0];
  if (!opt || !opt.value) return { id: null, name: '' };
  const id = /^\d+$/.test(opt.value) ? Number(opt.value) : null;
  return { id, name: opt.dataset.name || opt.textContent || '' };
}

// ======================================================================
// Editor de itens
// ======================================================================

function resetItemEditor({ keepSearch = false } = {}) {
  state.product = null;
  if (!keepSearch) $('productSearch').value = '';
  for (const id of ['itemGrade', 'itemUnit', 'itemLot']) {
    $(id).innerHTML = '<option value="">—</option>';
    $(id).disabled = true;
  }
  $('itemQty').value = '1';
  $('itemCost').value = '';
  $('itemStock').value = '';
  $('btnAddItem').disabled = true;
}

function expiryClass(expiresAt) {
  if (!expiresAt) return '';
  const days = (new Date(expiresAt) - new Date()) / 86400000;
  if (days < 0) return 'is-expired';
  if (days <= 90) return 'is-near';
  return '';
}

function selectedUnit() {
  const opt = $('itemUnit').selectedOptions?.[0];
  return { unit: opt?.value || 'UN', factor: Number(opt?.dataset.factor || 1) || 1 };
}

function refreshCostPreview() {
  if (!state.product) return;
  const { factor } = selectedUnit();
  $('itemCost').value = numBR(round4(state.product.cost_price * factor), 4);
}

function renderLots(lots = []) {
  const select = $('itemLot');
  if (!state.product?.require_lot) {
    select.innerHTML = '<option value="">Sem controle por lote</option>';
    select.disabled = true;
    return;
  }
  if (!lots.length) {
    // Estoque zerado/negativo não trava: o item entra sem lote e não baixa lote.
    select.innerHTML = '<option value="">Sem lote (sem saldo)</option>';
    select.disabled = true;
    return;
  }
  // Já vem em ordem FEFO (vence primeiro no topo) e o primeiro fica selecionado.
  select.innerHTML = lots.map((lot) => {
    const validity = lot.expires_at ? ` · val. ${onlyDateBR(lot.expires_at)}` : ' · sem validade';
    return `<option value="${escapeHtml(lot.lot_id)}" data-code="${escapeHtml(lot.lot_code)}" data-expires="${escapeHtml(lot.expires_at || '')}" data-available="${escapeHtml(lot.qty_available)}">${escapeHtml(lot.lot_code)}${validity} · saldo ${numBR(lot.qty_available)}</option>`;
  }).join('');
  select.disabled = false;
}

async function loadProduct(productCode, description = '') {
  const code = String(productCode || '').trim();
  if (!code) return;
  try {
    const json = await request(`${API}/product-info/${encodeURIComponent(code)}`);
    const product = json.data;
    state.product = product;

    $('productSearch').value = `${product.product_code} - ${product.description || description}`;
    $('itemStock').value = numBR(product.stock_qty);

    $('itemUnit').innerHTML = (product.units || []).map((u) =>
      `<option value="${escapeHtml(u.unit)}" data-factor="${escapeHtml(u.factor)}" ${u.standard ? 'selected' : ''}>${escapeHtml(u.unit)}${Number(u.factor) > 1 ? ` (${numBR(u.factor)})` : ''}</option>`
    ).join('');
    $('itemUnit').disabled = false;

    if (product.grades?.length) {
      $('itemGrade').innerHTML = '<option value="">Selecione...</option>' + product.grades.map((g) =>
        `<option value="${escapeHtml(g.product_grade_id)}">${escapeHtml(g.label)}</option>`).join('');
      $('itemGrade').disabled = false;
      if (product.grades.length === 1) $('itemGrade').value = String(product.grades[0].product_grade_id);
    } else {
      $('itemGrade').innerHTML = '<option value="">Única</option>';
      $('itemGrade').disabled = true;
    }

    renderLots(product.lots || []);
    refreshCostPreview();
    $('btnAddItem').disabled = false;
    $('itemQty').focus();
    $('itemQty').select();
  } catch (error) {
    console.error('[usoConsumo][loadProduct]', error);
    resetItemEditor({ keepSearch: true });
    notify(error.message, 'error');
  }
}

async function reloadLotsForGrade() {
  if (!state.product?.require_lot) return;
  const gradeId = $('itemGrade').value;
  try {
    const url = new URL(`${API}/product-info/${encodeURIComponent(state.product.product_code)}`);
    if (gradeId) url.searchParams.set('product_grade_id', gradeId);
    const json = await request(url);
    state.product.lots = json.data.lots || [];
    renderLots(state.product.lots);
  } catch (error) {
    console.error('[usoConsumo][reloadLotsForGrade]', error);
  }
}

function openProductPicker() {
  const typed = $('productSearch').value.trim();
  openProductsModalSearch({
    apiBase: API_BASE,
    onPick(product) {
      const code = product.product_code ?? product.sku ?? product.codigo ?? product.code ?? '';
      loadProduct(code, product.description || '');
    },
  });

  // Já abre o modal pesquisando o que foi digitado no campo Produto.
  const query = state.product ? '' : typed;
  const modalInput = document.getElementById('pms-q');
  if (query && modalInput) {
    modalInput.value = query;
    document.getElementById('pms-btn')?.click();
  }
}

function addItem() {
  const product = state.product;
  if (!product) return notify('Escolha um produto.', 'error');

  const quantity = Number(String($('itemQty').value).replace(',', '.'));
  if (!(quantity > 0)) return notify('Informe a quantidade.', 'error');

  const gradeSelect = $('itemGrade');
  if (product.grades?.length && !gradeSelect.value) return notify('Escolha a grade do produto.', 'error');

  const { unit, factor } = selectedUnit();
  const lotOpt = $('itemLot').selectedOptions?.[0];
  const lotId = product.require_lot ? Number(lotOpt?.value || 0) || null : null;

  // Estoque zerado ou negativo não bloqueia: o item entra assim mesmo e a NF-e
  // pode ser emitida. Só avisamos quando passa do saldo do lote.
  const qtyBase = quantity * factor;
  if (product.require_lot && lotId) {
    const alreadyInLot = state.items
      .filter((i) => i.lot_id === lotId)
      .reduce((acc, i) => acc + i.quantity * i.unit_factor, 0);
    const available = Number(lotOpt?.dataset.available || 0);
    if (qtyBase + alreadyInLot > available) {
      notify(`A quantidade passa do saldo do lote ${lotOpt?.dataset.code} (disponível ${numBR(available)}).\nO item foi adicionado; ao finalizar, o lote baixa só o saldo que tem.`, 'warning');
    }
  }

  const costPrice = round4(product.cost_price * factor);
  state.items.push({
    product_code: product.product_code,
    description: product.description,
    product_grade_id: gradeSelect.value ? Number(gradeSelect.value) : null,
    grade_label: gradeSelect.value ? gradeSelect.selectedOptions[0].textContent : 'Única',
    unit,
    unit_factor: factor,
    lot_id: lotId,
    lot_code: lotId ? lotOpt.dataset.code : null,
    expires_at: lotId ? (lotOpt.dataset.expires || null) : null,
    quantity,
    cost_price: costPrice,
    total_cost: Math.round(costPrice * quantity * 100) / 100,
  });

  renderItems();
  resetItemEditor();
  $('productSearch').focus();
}

function renderItems() {
  const body = $('itemsBody');
  if (!state.items.length) {
    body.innerHTML = '<tr><td colspan="9" class="uc-empty">Nenhum item adicionado.</td></tr>';
  } else {
    body.innerHTML = state.items.map((item, index) => {
      const lot = item.lot_code
        ? `${escapeHtml(item.lot_code)}${item.expires_at ? ` <span class="uc-lot-date ${expiryClass(item.expires_at)}">· ${escapeHtml(onlyDateBR(item.expires_at))}</span>` : ''}`
        : '— <span class="uc-lot-date">(sem lote)</span>';
      return `<tr>
        <td>${escapeHtml(item.product_code)}</td>
        <td class="uc-left">${escapeHtml(item.description)}</td>
        <td>${escapeHtml(item.grade_label || 'Única')}</td>
        <td>${escapeHtml(item.unit)}</td>
        <td>${lot}</td>
        <td>${numBR(item.quantity)}</td>
        <td>${moneyBR(item.cost_price)}</td>
        <td>${moneyBR(item.total_cost)}</td>
        <td>${actionIconsHtml([{ action: 'delete', title: 'Remover item', attrs: { 'data-remove': index } }])}</td>
      </tr>`;
    }).join('');
  }

  $('totItems').textContent = String(state.items.length);
  $('totQty').textContent = numBR(state.items.reduce((acc, i) => acc + Number(i.quantity || 0), 0));
  $('totCost').textContent = moneyBR(state.items.reduce((acc, i) => acc + Number(i.total_cost || 0), 0));
}

// ======================================================================
// Formulário (novo / editar rascunho)
// ======================================================================

function clearForm() {
  state.editingId = null;
  state.items = [];
  $('usoConsumoId').value = '';
  $('modalUsoConsumoTitle').textContent = 'Novo Uso e Consumo';
  setMovementDate(todayIso());
  $('cfop').value = '5.949';
  $('departmentId').value = '';
  $('employeeId').value = '';
  $('reason').value = '';
  resetItemEditor();
  renderItems();
}

async function openEdit(id) {
  try {
    const json = await request(`${API}/${encodeURIComponent(id)}`);
    const { header, items } = json.data || {};
    if (!header) throw new Error('Registro não encontrado.');

    clearForm();
    state.editingId = header.uso_consumo_id;
    $('usoConsumoId').value = header.uso_consumo_id;
    $('modalUsoConsumoTitle').textContent = `Editar rascunho ${header.number}`;
    setMovementDate(String(header.movement_date || header.created_at || '').slice(0, 10) || todayIso());
    $('cfop').value = header.cfop || '5.949';
    selectByIdOrName($('departmentId'), header.employee_department_id, header.department);
    selectByIdOrName($('employeeId'), header.employee_id, header.responsible);
    $('reason').value = header.reason || '';

    state.items = (items || []).map((i) => ({
      product_code: i.product_code,
      description: i.description,
      product_grade_id: i.product_grade_id || null,
      grade_label: i.grade_label || 'Única',
      unit: i.unit || 'UN',
      unit_factor: Number(i.unit_factor || 1) || 1,
      lot_id: i.lot_id || null,
      lot_code: i.lot_code || null,
      expires_at: i.expires_at || null,
      quantity: Number(i.quantity || 0),
      cost_price: Number(i.cost_price || 0),
      total_cost: Number(i.total_cost || 0),
    }));
    renderItems();
    openUsoConsumoModal();
  } catch (error) {
    console.error('[usoConsumo][openEdit]', error);
    notify(error.message, 'error');
  }
}

function getPayload() {
  const department = selectedCatalog($('departmentId'));
  const employee = selectedCatalog($('employeeId'));
  return {
    movement_date: $('movementDate').value || todayIso(),
    cfop: $('cfop').value,
    employee_department_id: department.id,
    department: department.name,
    employee_id: employee.id,
    responsible: employee.name,
    reason: $('reason').value.trim(),
    items: state.items,
  };
}

function validatePayload(p) {
  if (!p.department) return 'Escolha o departamento.';
  if (!p.responsible) return 'Escolha o responsável.';
  if (!p.reason) return 'Informe o motivo.';
  if (!p.items.length) return 'Adicione pelo menos um item.';
  return null;
}

async function save({ finish = false } = {}) {
  const payload = getPayload();
  const problem = validatePayload(payload);
  if (problem) return notify(problem, 'error');

  if (finish) {
    const ok = await confirmBox(
      `Finalizar este uso e consumo?\n\n${payload.items.length} item(ns), total ${$('totCost').textContent}.\nO estoque e os lotes serão baixados agora.`,
      { title: 'Finalizar e baixar estoque', confirmLabel: 'Finalizar' },
    );
    if (!ok) return;
  }

  const buttons = [$('btnSaveDraft'), $('btnFinish')];
  buttons.forEach((b) => { b.disabled = true; });

  try {
    const id = state.editingId;
    const json = await request(id ? `${API}/${encodeURIComponent(id)}` : API, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({ ...payload, finish }),
    });
    closeUsoConsumoModal();
    clearForm();
    await loadRows();
    notify(json.message || (finish ? 'Uso e consumo finalizado.' : 'Rascunho salvo.'), 'success');
  } catch (error) {
    console.error('[usoConsumo][save]', error);
    // Se o rascunho foi salvo mas a baixa falhou, continua editando o rascunho.
    const savedId = error.payload?.data?.header?.uso_consumo_id;
    if (savedId) {
      state.editingId = savedId;
      $('usoConsumoId').value = savedId;
      $('modalUsoConsumoTitle').textContent = `Editar rascunho ${error.payload.data.header.number}`;
      loadRows();
    }
    notify(savedId ? `Rascunho salvo, mas não foi possível finalizar: ${error.message}` : error.message, 'error');
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// ======================================================================
// Lista
// ======================================================================

function normalizeNfeStatus(row) { return String(row.nfe_status || (row.invoice_id ? 'PENDENTE' : 'NÃO EMITIDA')).trim().toUpperCase(); }
function statusClass(status) { return status === 'AUTORIZADA' ? 'is-success' : ['REJEITADA', 'CANCELADA', 'CANCELADO'].includes(status) ? 'is-error' : ['PROCESSANDO', 'PENDENTE'].includes(status) ? 'is-warning' : 'is-muted'; }
const isDraft = (row) => String(row.status || '').toUpperCase() === 'RASCUNHO';
const nfeBlocksDelete = (row) => row.invoice_id && !['REJEITADA', 'CANCELADA', 'CANCELADO', 'DENEGADA'].includes(normalizeNfeStatus(row));

function actionButtons(row) {
  const id = escapeHtml(row.uso_consumo_id);
  const status = normalizeNfeStatus(row);
  const buttons = [];

  if (isDraft(row)) {
    buttons.push(`<button class="uc-action is-primary" data-action="finish" data-id="${id}">Finalizar</button>`);
  } else {
    if (!row.invoice_id) buttons.push(`<button class="uc-action is-primary" data-action="emit" data-id="${id}">Emitir NF-e</button>`);
    if (row.invoice_id) buttons.push(`<button class="uc-action" data-action="status" data-id="${id}">Atualizar</button>`);
    if (status === 'REJEITADA') buttons.push(`<button class="uc-action is-danger" data-action="retry" data-id="${id}">Reenviar</button>`);
    if (row.xml_url) buttons.push(`<a class="uc-action" href="${escapeHtml(row.xml_url)}" target="_blank" rel="noopener noreferrer">XML</a>`);
    if (status === 'AUTORIZADA') {
      buttons.push(`<a class="uc-action is-success" href="${API}/${encodeURIComponent(row.uso_consumo_id)}/nfe/danfe-consart" target="_blank" rel="noopener noreferrer" title="Abrir DANFE personalizado da Consart">Imprimir DANFE</a>`);
    }
  }

  const icons = [
    isDraft(row)
      ? { action: 'edit', title: 'Editar rascunho', attrs: { 'data-action': 'edit', 'data-id': row.uso_consumo_id } }
      : { action: 'view', title: 'Ver itens', attrs: { 'data-action': 'view', 'data-id': row.uso_consumo_id } },
    status === 'AUTORIZADA'
      ? { action: 'cancel', title: 'Cancelar NF-e', attrs: { 'data-action': 'cancel-nfe', 'data-id': row.uso_consumo_id } }
      : null,
    {
      action: 'delete',
      title: nfeBlocksDelete(row) ? 'Cancele a NF-e antes de excluir' : (isDraft(row) ? 'Excluir rascunho' : 'Excluir e estornar estoque'),
      disabled: Boolean(nfeBlocksDelete(row)),
      attrs: { 'data-action': 'delete', 'data-id': row.uso_consumo_id },
    },
  ];

  return buttons.join(' ') + actionIconsHtml(icons);
}

function renderFooter() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  $('apTableInfo').textContent = `${state.total} ${state.total === 1 ? 'Registro' : 'Registros'}`;
  $('apPageInfo').textContent = `Página ${state.page} de ${totalPages}`;
  $('btnPreviousPage').disabled = state.page <= 1;
  $('btnNextPage').disabled = state.page >= totalPages;
}

async function loadRows() {
  const tbody = $('rows');
  const q = $('search')?.value?.trim() || '';
  tbody.innerHTML = '<tr><td colspan="13">Carregando...</td></tr>';
  try {
    const url = new URL(API);
    if (q) url.searchParams.set('q', q);
    url.searchParams.set('limit', String(state.pageSize));
    url.searchParams.set('offset', String((state.page - 1) * state.pageSize));
    const json = await request(url);
    const rows = json.data || [];
    state.rows = rows;
    state.total = Number(json.total ?? rows.length) || 0;
    renderFooter();

    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="13">Nenhum registro encontrado.</td></tr>'; return; }

    tbody.innerHTML = rows.map((row) => {
      const nfeStatus = isDraft(row) ? '—' : normalizeNfeStatus(row);
      const origin = row.budget_id
        ? `Orçamento ${escapeHtml(row.budget_id)}`
        : '<span class="uc-origin">Direto</span>';
      const situation = isDraft(row)
        ? '<span class="uc-status is-draft">RASCUNHO</span>'
        : '<span class="uc-status is-success">FINALIZADO</span>';
      return `<tr>
        <td>${escapeHtml(row.uso_consumo_id)}</td>
        <td class="uc-nowrap">${escapeHtml(row.number)}</td>
        <td class="uc-nowrap">${origin}</td>
        <td>${escapeHtml(row.department)}</td>
        <td>${escapeHtml(row.responsible)}</td>
        <td>${escapeHtml(row.cfop)}</td>
        <td>${escapeHtml(row.items_count ?? '')}</td>
        <td>${moneyBR(row.total_amount)}</td>
        <td>${situation}</td>
        <td>${escapeHtml(row.nfe_number)}</td>
        <td>${isDraft(row) ? '—' : `<span class="uc-status ${statusClass(nfeStatus)}">${escapeHtml(nfeStatus)}</span>`}</td>
        <td>${row.movement_date ? onlyDateBR(row.movement_date) : dateBR(row.created_at)}</td>
        <td><div class="uc-row-actions">${actionButtons(row)}</div></td>
      </tr>`;
    }).join('');
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="13">${escapeHtml(error.message)}</td></tr>`;
  }
}

// ======================================================================
// Ações da lista
// ======================================================================

async function showItems(id) {
  try {
    const json = await request(`${API}/${encodeURIComponent(id)}`);
    const { header, items = [] } = json.data || {};
    const lines = items.map((i) => `<tr>
        <td>${escapeHtml(i.product_code)}</td>
        <td style="text-align:left">${escapeHtml(i.description)}</td>
        <td>${numBR(i.quantity)} ${escapeHtml(i.unit || '')}</td>
        <td>${escapeHtml(i.lot_code || '—')}</td>
        <td>${moneyBR(i.total_cost)}</td>
      </tr>`).join('');
    const html = `
      <div style="text-align:left;font-size:12px;margin-bottom:8px">
        <b>${escapeHtml(header?.department)}</b> · ${escapeHtml(header?.responsible)}<br>${escapeHtml(header?.reason || '')}
      </div>
      <table class="uc-items" style="margin-top:0">
        <thead><tr><th>SKU</th><th style="text-align:left">Descrição</th><th>Qtd</th><th>Lote</th><th>Total</th></tr></thead>
        <tbody>${lines || '<tr><td colspan="5">Sem itens.</td></tr>'}</tbody>
      </table>
      <div style="text-align:right;margin-top:8px;font-size:12px"><b>Total: ${moneyBR(header?.total_amount)}</b></div>`;
    showCenterModal({ variant: 'info', title: `Itens de ${header?.number || id}`, message: html, timeoutMs: null });
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function removeRow(id) {
  const row = state.rows.find((r) => String(r.uso_consumo_id) === String(id));
  const draft = row && isDraft(row);
  const ok = await confirmBox(
    draft
      ? `Excluir o rascunho ${row?.number || id}?`
      : `Excluir o registro ${row?.number || id}?\n\nO estoque baixado será devolvido (estorno) e o movimento fica registrado no Kardex.`,
    { title: draft ? 'Excluir rascunho' : 'Excluir e estornar estoque', confirmLabel: 'Excluir', danger: true },
  );
  if (!ok) return;
  try {
    const json = await request(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadRows();
    notify(json.message || 'Registro excluído.', 'success');
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function finishRow(id) {
  const row = state.rows.find((r) => String(r.uso_consumo_id) === String(id));
  const ok = await confirmBox(
    `Finalizar o rascunho ${row?.number || id}?\nO estoque e os lotes serão baixados agora.`,
    { title: 'Finalizar e baixar estoque', confirmLabel: 'Finalizar' },
  );
  if (!ok) return;
  try {
    const json = await request(`${API}/${encodeURIComponent(id)}/finish`, { method: 'POST' });
    await loadRows();
    notify(json.message || 'Uso e consumo finalizado.', 'success');
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function cancelNfe(id) {
  const row = state.rows.find((r) => String(r.uso_consumo_id) === String(id));
  if (!row?.invoice_id) return;
  try {
    const { openNfeCancellation } = await import('/public/includes/js/nfeCancellation.js');
    await openNfeCancellation(Number(row.invoice_id), {
      onCompleted: () => loadRows(),
    });
  } catch (error) {
    notify(error.message, 'error');
  }
}

async function fiscalAction(action, id, button) {
  const config = {
    emit: { method: 'POST', path: `${id}/emit-nfe`, confirm: `Emitir a NF-e do registro ${id}?`, loading: 'Emitindo...' },
    retry: { method: 'POST', path: `${id}/nfe/retry`, confirm: `Reenviar a NF-e rejeitada do registro ${id}?`, loading: 'Reenviando...' },
    status: { method: 'GET', path: `${id}/nfe/status`, loading: 'Consultando...' },
  }[action];
  if (!config) return;
  if (config.confirm && !(await confirmBox(config.confirm, { title: 'NF-e de Uso e Consumo' }))) return;
  const original = button.textContent; button.disabled = true; button.textContent = config.loading;
  try {
    const json = await request(`${API}/${config.path}`, { method: config.method, ...(config.method === 'POST' ? { headers: { 'Content-Type': 'application/json' } } : {}) });
    await loadRows();
    notify(json.message || 'Operação realizada com sucesso.', 'success');
  } catch (error) { console.error(error); notify(error.message, 'error'); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = original; } }
}

function handleRowAction(event) {
  const button = event.target.closest('[data-action][data-id]');
  if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  if (action === 'edit') return openEdit(id);
  if (action === 'view') return showItems(id);
  if (action === 'delete') return removeRow(id);
  if (action === 'finish') return finishRow(id);
  if (action === 'cancel-nfe') return cancelNfe(id);
  return fiscalAction(action, id, button);
}

// ======================================================================
// Eventos
// ======================================================================

function bindEvents() {
  $('btnNewUsoConsumo')?.addEventListener('click', () => { clearForm(); openUsoConsumoModal(); });
  $('btnCloseUsoConsumo')?.addEventListener('click', closeUsoConsumoModal);
  $('modalUsoConsumo')?.addEventListener('click', (event) => { if (event.target === $('modalUsoConsumo')) closeUsoConsumoModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && $('modalUsoConsumo')?.getAttribute('aria-hidden') === 'false') closeUsoConsumoModal(); });

  $('btnSearchProduct')?.addEventListener('click', openProductPicker);
  $('productSearch')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openProductPicker(); } });
  $('productSearch')?.addEventListener('input', () => { if (state.product) resetItemEditor({ keepSearch: true }); });
  $('itemUnit')?.addEventListener('change', refreshCostPreview);
  $('itemGrade')?.addEventListener('change', reloadLotsForGrade);
  $('itemQty')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
  $('btnAddItem')?.addEventListener('click', addItem);
  $('itemsBody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    state.items.splice(Number(button.dataset.remove), 1);
    renderItems();
  });

  $('employeeId')?.addEventListener('change', () => {
    // Sugere o departamento do colaborador, se ainda não foi escolhido.
    const opt = $('employeeId').selectedOptions?.[0];
    const deptId = opt?.dataset.department;
    const deptName = opt?.dataset.departmentName;
    if ((deptId || deptName) && !$('departmentId').value) selectByIdOrName($('departmentId'), deptId, deptName);
  });

  $('btnClear')?.addEventListener('click', clearForm);
  $('btnSaveDraft')?.addEventListener('click', () => save({ finish: false }));
  $('btnFinish')?.addEventListener('click', () => save({ finish: true }));

  $('btnSearch')?.addEventListener('click', () => { state.page = 1; loadRows(); });
  $('search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); state.page = 1; loadRows(); } });
  $('btnPreviousPage')?.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadRows(); } });
  $('btnNextPage')?.addEventListener('click', () => { state.page += 1; loadRows(); });
  $('apRowsPerPage')?.addEventListener('change', () => { state.pageSize = Number($('apRowsPerPage').value) || 50; state.page = 1; loadRows(); });
  $('rows')?.addEventListener('click', handleRowAction);
}

document.addEventListener('DOMContentLoaded', () => {
  state.pageSize = Number($('apRowsPerPage')?.value) || 50;
  try { enhanceBrDateTime($('movementDate')); } catch (error) { console.warn('[usoConsumo] data dd/mm/aaaa', error); }
  bindEvents();
  clearForm();
  loadCatalogs().catch((error) => console.warn('[usoConsumo] cadastros R.H', error));
  loadRows();
});
