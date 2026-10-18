// ╔══════════════════════════════════════════════════════════════════════╗
// ║ proposalsConsart.js — Propostas comerciais (CONSART ERP)             ║
// ║ • Lista com filtros e paginação                                      ║
// ║ • Editor em modal (cliente/vendedor por duplo clique, itens livres   ║
// ║   ou do cadastro de serviços, condições, escopo e observações)       ║
// ║ • PDF, duplicar e excluir                                            ║
// ║ API: /api/proposals-consart                                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { apiFetch, getAuthToken } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import {
  openCrmCustomerSearchModal,
  openCrmSellerSearchModal,
} from '/public/modalsSearch/crmConsartModalsSearch.js';
import { openServicesConsartModalSearch } from '/public/modalsSearch/servicesConsartModalSearch.js';

const API = '/api/proposals-consart';

const STATUS_LABELS = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  APROVADA: 'Aprovada',
  RECUSADA: 'Recusada',
  VENCIDA: 'Vencida',
};

const $ = (sel) => document.querySelector(sel);

const state = {
  page: 1,
  pages: 1,
  rows: [],
  editingId: null,
  customer: null, // { id, name }
  seller: null,   // { id, name }
  items: [],
  dirty: false,
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(n) {
  return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function dateBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function formatDoc(value) {
  const d = String(value || '').replace(/\D+/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(value || '');
}

function statusBadge(status) {
  const key = String(status || 'RASCUNHO').toUpperCase();
  return `<span class="proposal-status proposal-status--${key.toLowerCase()}">${esc(STATUS_LABELS[key] || key)}</span>`;
}

// ─────────────────────────────────────────────────────────────────────
// Combos (vendedores / formas de pagamento)
// ─────────────────────────────────────────────────────────────────────

async function loadSellers() {
  try {
    const json = await apiFetch('/api/sellers?active=true&limit=500');
    const sellers = Array.isArray(json?.data) ? json.data : (json?.data?.rows || []);
    const select = $('#filterSeller');
    sellers.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.nickname || s.name;
      select.appendChild(opt);
    });
  } catch (error) {
    console.warn('[proposalsConsart] vendedores:', error);
  }
}

async function loadPaymentMethods() {
  try {
    const json = await apiFetch('/api/payment-methods?limit=200');
    const rows = json?.rows || json?.data || [];
    const select = $('#pf-payment-method');
    rows.forEach((pm) => {
      if (pm.active === false || pm.is_active === false) return;
      const opt = document.createElement('option');
      opt.value = pm.name || pm.description || '';
      opt.textContent = opt.value;
      if (opt.value) select.appendChild(opt);
    });
  } catch (error) {
    console.warn('[proposalsConsart] formas de pagamento:', error);
  }
}

function ensurePaymentOption(value) {
  const select = $('#pf-payment-method');
  if (value && ![...select.options].some((o) => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
  select.value = value || '';
}

// ─────────────────────────────────────────────────────────────────────
// Lista
// ─────────────────────────────────────────────────────────────────────

async function loadList() {
  const params = new URLSearchParams({
    page: String(state.page),
    limit: $('#pageSize').value,
  });
  const q = $('#q').value.trim();
  if (q) params.set('q', q);
  if ($('#filterStatus').value) params.set('status', $('#filterStatus').value);
  if ($('#filterSeller').value) params.set('seller_id', $('#filterSeller').value);
  if ($('#filterFrom').value) params.set('from', $('#filterFrom').value);
  if ($('#filterTo').value) params.set('to', $('#filterTo').value);

  try {
    const json = await apiFetch(`${API}?${params}`);
    state.rows = json.data || [];
    state.pages = json.pages || 1;
    state.page = Math.min(state.page, state.pages);
    renderList(json);
  } catch (error) {
    console.error('[proposalsConsart] lista:', error);
    alert(`Erro ao carregar propostas: ${error.message}`);
  }
}

function renderList(json) {
  const body = $('#proposalsBody');
  body.innerHTML = state.rows.map((p) => `
    <tr data-id="${p.id}">
      <td>${esc(p.number)}</td>
      <td>${dateBR(p.issue_date)}</td>
      <td class="proposals-col-left" title="${esc(p.customer_name)}">${esc(p.customer_name)}</td>
      <td>${esc(formatDoc(p.customer_tax_id))}</td>
      <td class="proposals-col-left" title="${esc(p.title)}">${esc(p.title)}</td>
      <td>${esc(p.seller_name || '—')}</td>
      <td>${dateBR(p.valid_until)}</td>
      <td class="proposals-col-money">${money(p.total)}</td>
      <td>${statusBadge(p.status_effective)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': p.id } },
        { action: 'document', title: 'Gerar PDF', attrs: { 'data-act': 'pdf', 'data-id': p.id } },
        { action: 'copy', title: 'Duplicar', attrs: { 'data-act': 'duplicate', 'data-id': p.id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': p.id } },
      ])}</td>
    </tr>
  `).join('');

  $('#proposalsEmpty').hidden = state.rows.length > 0;

  const count = Number(json?.count || 0);
  $('#proposalsInfo').textContent =
    `${count} ${count === 1 ? 'proposta' : 'propostas'} · R$ ${money(json?.total)}`;
  $('#pageInfo').textContent = `Página ${state.page} de ${state.pages}`;
  $('#btnPrevious').disabled = state.page <= 1;
  $('#btnNext').disabled = state.page >= state.pages;
}

async function onListClick(event) {
  const btn = event.target.closest('[data-act]');
  const tr = event.target.closest('tr[data-id]');
  if (!tr) return;
  const id = Number(btn?.dataset.id || tr.dataset.id);

  switch (btn?.dataset.act || 'edit') {
    case 'edit': return openEditor(id);
    case 'pdf': return downloadPdf(id);
    case 'duplicate': return duplicateProposal(id);
    case 'delete': return deleteProposal(id);
    default: return undefined;
  }
}

async function deleteProposal(id) {
  const row = state.rows.find((r) => r.id === id);
  if (!confirm(`Excluir a proposta ${row?.number || id}? Essa ação não pode ser desfeita.`)) return;
  try {
    await apiFetch(`${API}/${id}`, { method: 'DELETE' });
    await loadList();
  } catch (error) {
    alert(`Erro ao excluir: ${error.message}`);
  }
}

async function duplicateProposal(id) {
  try {
    const json = await apiFetch(`${API}/${id}/duplicate`, { method: 'POST' });
    await loadList();
    await openEditor(json.data.id);
  } catch (error) {
    alert(`Erro ao duplicar: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────

async function downloadPdf(id) {
  try {
    const token = getAuthToken();
    const response = await fetch(`${API}/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } : { Accept: 'application/pdf' },
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(json?.error || `HTTP ${response.status}`);
    }

    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `Proposta_${id}.pdf`;

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    console.error('[proposalsConsart] pdf:', error);
    alert(`Erro ao gerar PDF: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────────────

function setCustomer(customer) {
  state.customer = customer;
  $('#pf-customer').value = customer
    ? [customer.name, formatDoc(customer.tax_id)].filter(Boolean).join(' — ')
    : '';
}

function setSeller(seller) {
  state.seller = seller;
  $('#pf-seller').value = seller?.name || '';
}

function updateValidUntil() {
  const until = addDays($('#pf-date').value || todayISO(), $('#pf-valid-days').value);
  $('#pf-valid-until').value = dateBR(until);
}

function fillForm(p = {}) {
  state.editingId = p.id || null;
  $('#proposalModalTitle').textContent = p.id ? `Proposta ${p.number}` : 'Nova Proposta';

  setCustomer(p.customer_id ? { id: p.customer_id, name: p.customer_name, tax_id: p.customer_tax_id } : null);
  setSeller(p.seller_id ? { id: p.seller_id, name: p.seller_name } : null);

  $('#pf-contact').value = p.contact_name || '';
  $('#pf-status').value = p.status || 'RASCUNHO';
  $('#pf-title').value = p.title || '';
  $('#pf-date').value = p.issue_date || todayISO();
  $('#pf-valid-days').value = p.valid_days ?? 15;
  ensurePaymentOption(p.payment_method || '');
  $('#pf-payment-terms').value = p.payment_terms || '';
  $('#pf-delivery').value = p.delivery_time || '';
  $('#pf-freight').value = p.freight || '';
  $('#pf-scope').value = p.scope || '';
  $('#pf-notes').value = p.notes || '';

  state.items = (p.items || []).map((it) => ({
    product_id: it.product_id || null,
    product_code: it.product_code || '',
    description: it.description || '',
    unit: it.unit || '',
    quantity: Number(it.quantity || 0),
    unit_price: Number(it.unit_price || 0),
    discount_percent: Number(it.discount_percent || 0),
  }));
  if (!state.items.length) state.items.push(emptyItem());

  const created = p.created_at
    ? `Criada${p.created_by_name ? ` por ${p.created_by_name}` : ''} em ${new Date(p.created_at).toLocaleString('pt-BR')}`
    : '';
  $('#pf-meta').textContent = created;
  $('#pf-duplicate').style.display = p.id ? '' : 'none';

  updateValidUntil();
  renderItems();
  state.dirty = false;
}

async function openEditor(id = null) {
  if (id) {
    try {
      const json = await apiFetch(`${API}/${id}`);
      fillForm(json.data);
    } catch (error) {
      alert(`Erro ao abrir a proposta: ${error.message}`);
      return;
    }
  } else {
    fillForm();
  }
  Modal.open('proposal-modal', { focusSelector: id ? '#pf-title' : '#pf-customer' });
}

// ── Itens ─────────────────────────────────────────────────────────

function emptyItem() {
  return { product_id: null, product_code: '', description: '', unit: 'UN', quantity: 1, unit_price: 0, discount_percent: 0 };
}

function itemTotal(it) {
  const gross = round2(it.quantity * it.unit_price);
  return round2(gross * (1 - Math.min(Math.max(it.discount_percent, 0), 100) / 100));
}

function renderItems() {
  const body = $('#pf-items');
  if (!state.items.length) {
    body.innerHTML = '<tr class="proposal-items__empty"><td colspan="8">Nenhum item. Use os botões abaixo para adicionar.</td></tr>';
  } else {
    body.innerHTML = state.items.map((it, i) => `
      <tr data-index="${i}">
        <td>${i + 1}</td>
        <td><input data-field="description" value="${esc(it.product_code ? `${it.product_code} - ${it.description}` : it.description)}" placeholder="Descrição do produto ou serviço"></td>
        <td><input data-field="unit" value="${esc(it.unit)}" maxlength="10"></td>
        <td><input data-field="quantity" value="${qty(it.quantity)}" inputmode="decimal"></td>
        <td><input data-field="unit_price" value="${money(it.unit_price)}" inputmode="decimal"></td>
        <td><input data-field="discount_percent" value="${qty(it.discount_percent)}" inputmode="decimal"></td>
        <td class="pi-col-total" data-total>${money(itemTotal(it))}</td>
        <td>${actionIconsHtml([{ action: 'delete', title: 'Remover item', attrs: { 'data-remove': i } }])}</td>
      </tr>
    `).join('');
  }
  renderTotals();
}

function renderTotals() {
  const subtotal = round2(state.items.reduce((a, it) => a + round2(it.quantity * it.unit_price), 0));
  const total = round2(state.items.reduce((a, it) => a + itemTotal(it), 0));
  $('#pf-subtotal').textContent = money(subtotal);
  $('#pf-discount').textContent = money(subtotal - total);
  $('#pf-total').textContent = `R$ ${money(total)}`;
}

function onItemInput(event) {
  const input = event.target.closest('input[data-field]');
  if (!input) return;
  const tr = input.closest('tr[data-index]');
  const it = state.items[Number(tr.dataset.index)];
  const field = input.dataset.field;

  if (field === 'description') {
    // Texto editado à mão: o código do produto passa a fazer parte da descrição
    it.description = input.value;
    it.product_code = '';
  } else if (field === 'unit') {
    it.unit = input.value;
  } else {
    it[field] = parseNumber(input.value);
  }

  tr.querySelector('[data-total]').textContent = money(itemTotal(it));
  renderTotals();
  state.dirty = true;
}

function onItemBlur(event) {
  const input = event.target.closest('input[data-field]');
  if (!input) return;
  const it = state.items[Number(input.closest('tr[data-index]').dataset.index)];
  if (input.dataset.field === 'unit_price') input.value = money(it.unit_price);
  if (input.dataset.field === 'quantity' || input.dataset.field === 'discount_percent') {
    input.value = qty(it[input.dataset.field]);
  }
}

function onItemsClick(event) {
  const btn = event.target.closest('[data-remove]');
  if (!btn) return;
  state.items.splice(Number(btn.dataset.remove), 1);
  renderItems();
  state.dirty = true;
}

function addItem(item = emptyItem()) {
  // Reaproveita uma linha vazia no fim (a que o formulário novo já traz)
  const last = state.items.at(-1);
  if (last && !last.description.trim() && !last.unit_price) state.items.pop();
  state.items.push(item);
  renderItems();
  state.dirty = true;
  const inputs = document.querySelectorAll('#pf-items input[data-field="description"]');
  inputs[inputs.length - 1]?.focus();
}

// Serviço do cadastro de serviços (servicesConsart): o código vai em product_code
// para sair "S0001 - Descrição" na tela e no PDF; product_id fica vazio.
function addServiceItem() {
  openServicesConsartModalSearch({
    onPick(service) {
      addItem({
        product_id: null,
        product_code: String(service.code || ''),
        description: String(service.description || ''),
        unit: String(service.unit || 'SV').slice(0, 10),
        quantity: 1,
        unit_price: parseNumber(service.price),
        discount_percent: 0,
      });
    },
  });
}

// ── Salvar ────────────────────────────────────────────────────────

function buildPayload() {
  return {
    customer_id: state.customer?.id || null,
    contact_name: $('#pf-contact').value,
    seller_id: state.seller?.id || null,
    status: $('#pf-status').value,
    title: $('#pf-title').value,
    issue_date: $('#pf-date').value || null,
    valid_days: Number($('#pf-valid-days').value || 0),
    payment_method: $('#pf-payment-method').value,
    payment_terms: $('#pf-payment-terms').value,
    delivery_time: $('#pf-delivery').value,
    freight: $('#pf-freight').value,
    scope: $('#pf-scope').value,
    notes: $('#pf-notes').value,
    items: state.items.filter((it) => it.description.trim()),
  };
}

async function saveProposal({ keepOpen = false } = {}) {
  const payload = buildPayload();
  if (!payload.customer_id) {
    alert('Selecione o cliente (duplo clique no campo Cliente).');
    $('#pf-customer').focus();
    return null;
  }
  if (!payload.title.trim()) {
    alert('Informe o título da proposta.');
    $('#pf-title').focus();
    return null;
  }

  const btn = $('#pf-save');
  btn.disabled = true;
  try {
    const json = state.editingId
      ? await apiFetch(`${API}/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await apiFetch(API, { method: 'POST', body: JSON.stringify(payload) });

    state.dirty = false;
    await loadList();

    if (keepOpen) fillForm(json.data);
    else Modal.close('proposal-modal');
    return json.data;
  } catch (error) {
    alert(`Erro ao salvar: ${error.message}`);
    return null;
  } finally {
    btn.disabled = false;
  }
}

async function pdfFromEditor() {
  let id = state.editingId;
  if (!id || state.dirty) {
    const saved = await saveProposal({ keepOpen: true });
    if (!saved) return;
    id = saved.id;
  }
  await downloadPdf(id);
}

async function duplicateFromEditor() {
  if (!state.editingId) return;
  if (state.dirty && !confirm('Há alterações não salvas. Duplicar mesmo assim (a cópia usa a versão salva)?')) return;
  Modal.close('proposal-modal');
  await duplicateProposal(state.editingId);
}

// ── Seletores (cliente / vendedor) ────────────────────────────────

function pickCustomer() {
  openCrmCustomerSearchModal({
    onPick(customer) {
      setCustomer({
        id: Number(customer.customer_id ?? customer.id),
        name: customer.trade_name || customer.legal_name || customer.name,
        tax_id: customer.tax_id || customer.cnpj_cpf || '',
      });
      if (!$('#pf-contact').value && customer.contact_name) $('#pf-contact').value = customer.contact_name;
      state.dirty = true;
    },
  });
}

function pickSeller() {
  openCrmSellerSearchModal({
    onPick(seller) {
      setSeller({ id: Number(seller.id ?? seller.seller_id), name: seller.nickname || seller.name });
      state.dirty = true;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────────────────────────────

function bindEvents() {
  const search = () => { state.page = 1; loadList(); };

  $('#btnSearch').addEventListener('click', search);
  $('#btnReload').addEventListener('click', () => loadList());
  $('#btnNew').addEventListener('click', () => openEditor());
  $('#btnBack').addEventListener('click', () => history.back());
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  ['#filterStatus', '#filterSeller', '#filterFrom', '#filterTo', '#pageSize']
    .forEach((sel) => $(sel).addEventListener('change', search));
  $('#btnPrevious').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadList(); } });
  $('#btnNext').addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; loadList(); } });
  $('#proposalsBody').addEventListener('click', onListClick);

  // Cliente e vendedor só mudam pelo seletor: bloqueia digitação/colar
  ['#pf-customer', '#pf-seller'].forEach((sel) => {
    $(sel).addEventListener('beforeinput', (e) => e.preventDefault());
  });

  const customer = $('#pf-customer');
  customer.addEventListener('dblclick', pickCustomer);
  customer.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pickCustomer(); } });

  const seller = $('#pf-seller');
  seller.addEventListener('dblclick', pickSeller);
  seller.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); pickSeller(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setSeller(null); state.dirty = true; }
  });

  $('#pf-date').addEventListener('change', updateValidUntil);
  $('#pf-valid-days').addEventListener('input', updateValidUntil);
  $('#proposal-form').addEventListener('input', () => { state.dirty = true; });

  const items = $('#pf-items');
  items.addEventListener('input', onItemInput);
  items.addEventListener('focusout', onItemBlur);
  items.addEventListener('click', onItemsClick);

  $('#pf-add-item').addEventListener('click', () => addItem());
  $('#pf-add-service').addEventListener('click', addServiceItem);
  $('#pf-save').addEventListener('click', () => saveProposal());
  $('#pf-pdf').addEventListener('click', pdfFromEditor);
  $('#pf-duplicate').addEventListener('click', duplicateFromEditor);
}

// ─────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────

Modal.setup();
bindEvents();
loadSellers();
loadPaymentMethods();
loadList();
