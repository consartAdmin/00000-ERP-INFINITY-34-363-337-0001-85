// ╔══════════════════════════════════════════════════════════════════════╗
// ║ contractsConsart.js — Contratos de Serviços (CONSART ERP)            ║
// ║ • Lista com filtros e paginação                                      ║
// ║ • Editor em modal: cliente/vendedor por duplo clique, vigência e     ║
// ║   pagamento, serviços (mensais ou de cobrança única, ex. implantação)║
// ║   do cadastro ou avulsos, objeto e cláusulas                         ║
// ║   editáveis com campos automáticos ({CAMPO})                         ║
// ║ • "Da proposta aprovada": gera o contrato a partir de uma Proposta   ║
// ║   de Serviços APROVADA                                               ║
// ║ • PDF, duplicar e excluir · ?open=ID abre o contrato direto          ║
// ║ API: /api/contracts-consart                                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { apiFetch, getAuthToken } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import {
  openCrmCustomerSearchModal,
  openCrmSellerSearchModal,
} from '/public/modalsSearch/crmConsartModalsSearch.js';
import { openServicesConsartModalSearch } from '/public/modalsSearch/servicesConsartModalSearch.js';

const API = '/api/contracts-consart';
const API_PROPOSALS = '/api/proposals-services-consart';

const STATUS_LABELS = {
  RASCUNHO: 'Rascunho',
  ATIVO: 'Ativo',
  VENCIDO: 'Vencido',
  ENCERRADO: 'Encerrado',
  CANCELADO: 'Cancelado',
};

const TOTAL_LABELS = { MENSAL: 'Valor mensal', UNICO: 'Valor total', PARCELADO: 'Valor total' };
const RECURRING_LABELS = { MENSAL: 'Mensal', UNICO: 'Total do contrato', PARCELADO: 'Parcelada' };

const $ = (sel) => document.querySelector(sel);

const state = {
  page: 1,
  pages: 1,
  rows: [],
  editingId: null,
  proposal: null, // { id, number }
  customer: null, // { id, name }
  seller: null,   // { id, name }
  reps: [],       // representantes/sócios do cliente
  repSnapshot: null, // representante gravado no contrato (pode ter saído do cadastro)
  items: [],
  clauses: [],
  template: { clauses: [], placeholders: [], roles: [] },
  lastClauseField: null,
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

/** Término = início + meses - 1 dia (igual ao backend). */
function endDate(startIso, months) {
  const m = Math.trunc(Number(months || 0));
  if (!startIso || m <= 0) return '';
  const [y, mo, d] = startIso.split('-').map(Number);
  const target = new Date(Date.UTC(y, mo - 1 + m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  target.setUTCDate(target.getUTCDate() - 1);
  return target.toISOString().slice(0, 10);
}

function formatDoc(value) {
  const d = String(value || '').replace(/\D+/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(value || '');
}

function statusBadge(status) {
  const key = String(status || 'RASCUNHO').toUpperCase();
  return `<span class="contract-status contract-status--${key.toLowerCase()}">${esc(STATUS_LABELS[key] || key)}</span>`;
}

function termText(c) {
  const months = Number(c.term_months || 0);
  if (!c.start_date) return months ? `${months} meses` : 'Indeterminado';
  return c.end_date ? `${dateBR(c.start_date)} a ${dateBR(c.end_date)}` : `Desde ${dateBR(c.start_date)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Combos (vendedores / formas de pagamento) e modelo de cláusulas
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
    console.warn('[contractsConsart] vendedores:', error);
  }
}

async function loadPaymentMethods() {
  try {
    const json = await apiFetch('/api/payment-methods?limit=200');
    const rows = json?.rows || json?.data || [];
    const select = $('#cf-payment-method');
    rows.forEach((pm) => {
      if (pm.active === false || pm.is_active === false) return;
      const opt = document.createElement('option');
      opt.value = pm.name || pm.description || '';
      opt.textContent = opt.value;
      if (opt.value) select.appendChild(opt);
    });
  } catch (error) {
    console.warn('[contractsConsart] formas de pagamento:', error);
  }
}

function ensurePaymentOption(value) {
  const select = $('#cf-payment-method');
  if (value && ![...select.options].some((o) => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
  select.value = value || '';
}

async function loadTemplate() {
  try {
    const json = await apiFetch(`${API}/template`);
    state.template = json.data || state.template;
  } catch (error) {
    console.warn('[contractsConsart] modelo de cláusulas:', error);
  }
  $('#cf-placeholders').innerHTML = 'Campos automáticos: ' + state.template.placeholders
    .map((p) => `<button type="button" data-ph="${esc(p.key)}" title="${esc(p.label)}">{${esc(p.key)}}</button>`)
    .join('');
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
    console.error('[contractsConsart] lista:', error);
    alert(`Erro ao carregar contratos: ${error.message}`);
  }
}

function renderList(json) {
  const body = $('#contractsBody');
  body.innerHTML = state.rows.map((c) => `
    <tr data-id="${c.id}">
      <td>${esc(c.number)}</td>
      <td>${dateBR(c.issue_date)}</td>
      <td class="contracts-col-left" title="${esc(c.customer_name)}">${esc(c.customer_name)}</td>
      <td>${esc(formatDoc(c.customer_tax_id))}</td>
      <td class="contracts-col-left" title="${esc(c.title)}">${esc(c.title)}</td>
      <td>${esc(c.proposal_number || '—')}</td>
      <td>${esc(termText(c))}</td>
      <td class="contracts-col-money">${money(c.recurring_total ?? c.total)}${Number(c.one_time_total) ? `<span class="contracts-one-time">+ ${money(c.one_time_total)} impl.</span>` : ''}</td>
      <td>${statusBadge(c.status_effective)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: 'Editar', attrs: { 'data-act': 'edit', 'data-id': c.id } },
        { action: 'document', title: 'Gerar PDF', attrs: { 'data-act': 'pdf', 'data-id': c.id } },
        { action: 'copy', title: 'Duplicar', attrs: { 'data-act': 'duplicate', 'data-id': c.id } },
        { action: 'delete', title: 'Excluir', attrs: { 'data-act': 'delete', 'data-id': c.id } },
      ])}</td>
    </tr>
  `).join('');

  $('#contractsEmpty').hidden = state.rows.length > 0;

  const count = Number(json?.count || 0);
  $('#contractsInfo').textContent =
    `${count} ${count === 1 ? 'contrato' : 'contratos'} · R$ ${money(json?.total)}`;
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
    case 'duplicate': return duplicateContract(id);
    case 'delete': return deleteContract(id);
    default: return undefined;
  }
}

async function deleteContract(id) {
  const row = state.rows.find((r) => Number(r.id) === id);
  if (!confirm(`Excluir o contrato ${row?.number || id}? Essa ação não pode ser desfeita.`)) return;
  try {
    await apiFetch(`${API}/${id}`, { method: 'DELETE' });
    await loadList();
  } catch (error) {
    alert(`Erro ao excluir: ${error.message}`);
  }
}

async function duplicateContract(id) {
  try {
    const json = await apiFetch(`${API}/${id}/duplicate`, { method: 'POST' });
    await loadList();
    await openEditor(json.data.id);
  } catch (error) {
    alert(`Erro ao duplicar: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// A partir de proposta aprovada
// ─────────────────────────────────────────────────────────────────────

async function createFromProposal(proposalId) {
  try {
    const json = await apiFetch(`${API}/from-proposal/${proposalId}`, { method: 'POST' });
    if (json.existed) alert(`Essa proposta já tem o contrato ${json.data.number}. Abrindo o contrato existente.`);
    await loadList();
    await openEditor(json.data.id);
  } catch (error) {
    alert(`Erro ao gerar o contrato: ${error.message}`);
  }
}

function openProposalPicker() {
  const overlay = document.createElement('div');
  overlay.className = 'modal contract-pick-modal';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="modal__backdrop" data-modal-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-8" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
        <div class="modal__header modal-header-color-3">
          <h2 class="modal__title" id="cpTitle">Gerar contrato da proposta aprovada</h2>
          <button type="button" class="modal__close" data-modal-close aria-label="Fechar" title="Fechar">&times;</button>
        </div>
        <div class="modal__body">
          <div class="btn-inline btn-gap-3" style="align-items:flex-end">
            <div class="fields fields-h-6" style="flex:1 1 280px">
              <label for="cpQ">Proposta aprovada</label>
              <input type="search" id="cpQ" autocomplete="off" placeholder="Nº, cliente, CNPJ, título...">
            </div>
            <button type="button" class="btn btn-search btn-sm" data-search>Buscar</button>
          </div>
          <div class="contract-pick__wrap">
            <table class="contract-pick__table">
              <thead>
                <tr>
                  <th style="width:90px">Nº</th>
                  <th style="width:90px">Data</th>
                  <th>Cliente</th>
                  <th>Título</th>
                  <th style="width:110px">Total (R$)</th>
                </tr>
              </thead>
              <tbody data-body></tbody>
            </table>
          </div>
        </div>
        <footer class="modal__footer modal-footer-color-3">
          <button type="button" class="btn btn-cancel btn-sm" data-modal-close>Fechar</button>
        </footer>
      </section>
    </div>
  `;

  const input = overlay.querySelector('#cpQ');
  const body = overlay.querySelector('[data-body]');
  let rows = [];

  const setMessage = (msg) => { body.innerHTML = `<tr><td colspan="5" class="contract-pick__msg">${esc(msg)}</td></tr>`; };

  async function search() {
    const params = new URLSearchParams({ status: 'APROVADA', limit: '200' });
    if (input.value.trim()) params.set('q', input.value.trim());
    setMessage('Buscando propostas aprovadas...');
    try {
      const json = await apiFetch(`${API_PROPOSALS}?${params}`);
      rows = json.data || [];
      if (!rows.length) {
        setMessage('Nenhuma proposta de serviços aprovada encontrada.');
        return;
      }
      body.innerHTML = rows.map((p, i) => `
        <tr tabindex="0" data-index="${i}">
          <td><strong>${esc(p.number)}</strong></td>
          <td>${dateBR(p.issue_date)}</td>
          <td class="cp-left">${esc(p.customer_name)}</td>
          <td class="cp-left">${esc(p.title)}</td>
          <td class="cp-money">${money(p.total)}</td>
        </tr>
      `).join('');
    } catch (error) {
      setMessage(`Erro ao buscar propostas: ${error.message}`);
    }
  }

  function pick(index) {
    const proposal = rows[index];
    if (!proposal) return;
    if (!Modal.close(overlay)) overlay.remove();
    createFromProposal(proposal.id);
  }

  body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (tr) pick(Number(tr.dataset.index));
  });
  body.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (tr && e.key === 'Enter') pick(Number(tr.dataset.index));
  });
  overlay.querySelector('[data-search]').addEventListener('click', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); search(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); body.querySelector('tr[data-index]')?.focus(); }
  });
  overlay.addEventListener('modal:close', () => overlay.remove());

  document.body.appendChild(overlay);
  Modal.open(overlay);
  input.focus();
  search();
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
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `Contrato_${id}.pdf`;

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    console.error('[contractsConsart] pdf:', error);
    alert(`Erro ao gerar PDF: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────────────

function setCustomer(customer) {
  state.customer = customer;
  $('#cf-customer').value = customer
    ? [customer.name, formatDoc(customer.tax_id)].filter(Boolean).join(' — ')
    : '';
}

function setSeller(seller) {
  state.seller = seller;
  $('#cf-seller').value = seller?.name || '';
}

function updateEndDate() {
  const months = Number($('#cf-term').value || 0);
  const end = endDate($('#cf-start').value, months);
  $('#cf-end').value = months <= 0 ? 'Indeterminado' : dateBR(end);
}

function updateTotalLabel() {
  $('#cf-total-label').textContent = TOTAL_LABELS[$('#cf-billing').value] || 'Valor total';
}

function fillForm(c = {}) {
  state.editingId = c.id || null;
  $('#contractModalTitle').textContent = c.id ? `Contrato de Serviços ${c.number}` : 'Novo Contrato de Serviços';

  state.proposal = c.proposal_id ? { id: c.proposal_id, number: c.proposal_number } : null;
  $('#cf-proposal').value = c.proposal_number || '';

  setCustomer(c.customer_id ? { id: c.customer_id, name: c.customer_name, tax_id: c.customer_tax_id } : null);
  setSeller(c.seller_id ? { id: c.seller_id, name: c.seller_name } : null);
  state.repSnapshot = c.representative_id || c.representative_name
    ? {
      id: c.representative_id || null,
      name: c.representative_name,
      role: c.representative_role,
      cpf: c.representative_cpf,
      address: c.representative_address,
    }
    : null;
  loadRepresentatives(c.customer_id, c.representative_id, c.representative_role);

  $('#cf-contact').value = c.contact_name || '';
  $('#cf-status').value = c.status || 'RASCUNHO';
  $('#cf-title').value = c.title || '';
  $('#cf-date').value = c.issue_date || todayISO();
  $('#cf-start').value = c.id ? (c.start_date || '') : todayISO();
  $('#cf-term').value = c.term_months ?? 12;
  $('#cf-renew').value = c.auto_renew ? 'true' : 'false';
  $('#cf-billing').value = c.billing_type || 'MENSAL';
  ensurePaymentOption(c.payment_method || '');
  $('#cf-payment-terms').value = c.payment_terms || '';
  $('#cf-due-day').value = c.due_day || '';
  $('#cf-readjust').value = c.id ? (c.readjustment_index || '') : 'IPCA';
  $('#cf-place').value = c.execution_place || '';
  $('#cf-delivery').value = c.delivery_time || '';
  $('#cf-forum').value = c.forum_city || '';
  $('#cf-signing-city').value = c.signing_city || '';
  $('#cf-signing-date').value = c.signing_date || '';
  $('#cf-object').value = c.object || '';
  $('#cf-notes').value = c.notes || '';

  state.items = (c.items || []).map((it) => ({
    charge_type: it.charge_type === 'UNICA' ? 'UNICA' : 'RECORRENTE',
    service_id: it.service_id || null,
    service_code: it.service_code || '',
    description: it.description || '',
    unit: it.unit || '',
    quantity: Number(it.quantity || 0),
    unit_price: Number(it.unit_price || 0),
    discount_percent: Number(it.discount_percent || 0),
  }));
  if (!state.items.length) state.items.push(emptyItem());

  const clauses = c.id ? (c.clauses || []) : state.template.clauses;
  state.clauses = clauses.map((cl) => ({ title: cl.title || '', body: cl.body || '' }));

  const created = c.created_at
    ? `Criado${c.created_by_name ? ` por ${c.created_by_name}` : ''} em ${new Date(c.created_at).toLocaleString('pt-BR')}`
    : '';
  $('#cf-meta').textContent = created;
  $('#cf-duplicate').style.display = c.id ? '' : 'none';

  updateEndDate();
  updateTotalLabel();
  renderItems();
  renderClauses();
  state.dirty = false;
}

async function openEditor(id = null) {
  if (id) {
    try {
      const json = await apiFetch(`${API}/${id}`);
      fillForm(json.data);
    } catch (error) {
      alert(`Erro ao abrir o contrato: ${error.message}`);
      return;
    }
  } else {
    fillForm();
  }
  Modal.open('contract-modal', { focusSelector: id ? '#cf-title' : '#cf-customer' });
}

// ── Itens ─────────────────────────────────────────────────────────

function emptyItem() {
  return { charge_type: 'RECORRENTE', service_id: null, service_code: '', description: '', unit: 'SV', quantity: 1, unit_price: 0, discount_percent: 0 };
}

function itemTotal(it) {
  const gross = round2(it.quantity * it.unit_price);
  return round2(gross * (1 - Math.min(Math.max(it.discount_percent, 0), 100) / 100));
}

function renderItems() {
  const body = $('#cf-items');
  if (!state.items.length) {
    body.innerHTML = '<tr class="contract-items__empty"><td colspan="9">Nenhum serviço. Use os botões abaixo para adicionar.</td></tr>';
  } else {
    body.innerHTML = state.items.map((it, i) => `
      <tr data-index="${i}" class="${it.charge_type === 'UNICA' ? 'is-one-time' : ''}">
        <td>${i + 1}</td>
        <td><input data-field="description" value="${esc(it.service_code ? `${it.service_code} - ${it.description}` : it.description)}" placeholder="Descrição do serviço"></td>
        <td>
          <select data-field="charge_type">
            <option value="RECORRENTE" ${it.charge_type === 'UNICA' ? '' : 'selected'}>${esc(RECURRING_LABELS[$('#cf-billing').value] || 'Recorrente')}</option>
            <option value="UNICA" ${it.charge_type === 'UNICA' ? 'selected' : ''}>Única</option>
          </select>
        </td>
        <td><input data-field="unit" value="${esc(it.unit)}" maxlength="10"></td>
        <td><input data-field="quantity" value="${qty(it.quantity)}" inputmode="decimal"></td>
        <td><input data-field="unit_price" value="${money(it.unit_price)}" inputmode="decimal"></td>
        <td><input data-field="discount_percent" value="${qty(it.discount_percent)}" inputmode="decimal"></td>
        <td class="ci-col-total" data-total>${money(itemTotal(it))}</td>
        <td>${actionIconsHtml([{ action: 'delete', title: 'Remover item', attrs: { 'data-remove': i } }])}</td>
      </tr>
    `).join('');
  }
  renderTotals();
}

function renderTotals() {
  const subtotal = round2(state.items.reduce((a, it) => a + round2(it.quantity * it.unit_price), 0));
  const total = round2(state.items.reduce((a, it) => a + itemTotal(it), 0));
  const oneTime = round2(state.items.filter((it) => it.charge_type === 'UNICA').reduce((a, it) => a + itemTotal(it), 0));
  $('#cf-subtotal').textContent = money(subtotal);
  $('#cf-discount').textContent = money(subtotal - total);
  $('#cf-total').textContent = `R$ ${money(total - oneTime)}`;
  $('#cf-one-time').textContent = `R$ ${money(oneTime)}`;
  $('#cf-one-time-box').hidden = !oneTime;
}

function onItemChange(event) {
  const select = event.target.closest('select[data-field="charge_type"]');
  if (!select) return;
  const tr = select.closest('tr[data-index]');
  state.items[Number(tr.dataset.index)].charge_type = select.value;
  tr.classList.toggle('is-one-time', select.value === 'UNICA');
  renderTotals();
  state.dirty = true;
}

function onItemInput(event) {
  const input = event.target.closest('input[data-field]');
  if (!input) return;
  const tr = input.closest('tr[data-index]');
  const it = state.items[Number(tr.dataset.index)];
  const field = input.dataset.field;

  if (field === 'description') {
    // Texto editado à mão: o código do serviço passa a fazer parte da descrição
    it.description = input.value;
    it.service_code = '';
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
  const inputs = document.querySelectorAll('#cf-items input[data-field="description"]');
  inputs[inputs.length - 1]?.focus();
}

function addServiceItem() {
  openServicesConsartModalSearch({
    onPick(service) {
      addItem({
        charge_type: /implant|instala|setup|configura/i.test(service.description || '') ? 'UNICA' : 'RECORRENTE',
        service_id: Number(service.id) || null,
        service_code: String(service.code || ''),
        description: String(service.description || ''),
        unit: String(service.unit || 'SV').slice(0, 10),
        quantity: 1,
        unit_price: parseNumber(service.price),
        discount_percent: 0,
      });
    },
  });
}

// ── Cláusulas ─────────────────────────────────────────────────────

const ORDINALS = ['Primeira', 'Segunda', 'Terceira', 'Quarta', 'Quinta', 'Sexta', 'Sétima', 'Oitava',
  'Nona', 'Décima', 'Décima primeira', 'Décima segunda', 'Décima terceira', 'Décima quarta',
  'Décima quinta', 'Décima sexta', 'Décima sétima', 'Décima oitava', 'Décima nona', 'Vigésima'];

function renderClauses() {
  const box = $('#cf-clauses');
  if (!state.clauses.length) {
    box.innerHTML = '<div class="contracts-empty">Nenhuma cláusula. Use "➕ Nova cláusula" ou "Restaurar modelo padrão".</div>';
    return;
  }
  const last = state.clauses.length - 1;
  box.innerHTML = state.clauses.map((cl, i) => `
    <div class="contract-clause" data-clause="${i}">
      <div class="contract-clause__head">
        <span class="contract-clause__n">Cláusula ${esc(ORDINALS[i] || `${i + 1}ª`)}</span>
        <input class="contract-clause__title" data-cfield="title" value="${esc(cl.title)}" maxlength="200" placeholder="Título (ex.: DO OBJETO)">
        <button type="button" class="contract-clause__btn" data-move="-1" title="Subir" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="contract-clause__btn" data-move="1" title="Descer" ${i === last ? 'disabled' : ''}>▼</button>
        <button type="button" class="contract-clause__btn" data-del-clause title="Remover cláusula">✕</button>
      </div>
      <textarea class="contract-clause__body" data-cfield="body" rows="3" placeholder="Texto da cláusula">${esc(cl.body)}</textarea>
    </div>
  `).join('');
}

function onClauseInput(event) {
  const field = event.target.closest('[data-cfield]');
  if (!field) return;
  const index = Number(field.closest('[data-clause]').dataset.clause);
  state.clauses[index][field.dataset.cfield] = field.value;
  state.dirty = true;
}

function onClausesClick(event) {
  const card = event.target.closest('[data-clause]');
  if (!card) return;
  const index = Number(card.dataset.clause);

  const move = event.target.closest('[data-move]');
  if (move) {
    const to = index + Number(move.dataset.move);
    if (to < 0 || to >= state.clauses.length) return;
    [state.clauses[index], state.clauses[to]] = [state.clauses[to], state.clauses[index]];
    renderClauses();
    state.dirty = true;
    return;
  }

  if (event.target.closest('[data-del-clause]')) {
    const title = state.clauses[index].title || 'sem título';
    if (!confirm(`Remover a cláusula "${title}"?`)) return;
    state.clauses.splice(index, 1);
    renderClauses();
    state.dirty = true;
  }
}

function addClause() {
  state.clauses.push({ title: '', body: '' });
  renderClauses();
  state.dirty = true;
  const titles = document.querySelectorAll('#cf-clauses [data-cfield="title"]');
  titles[titles.length - 1]?.focus();
}

function resetClauses() {
  if (state.clauses.length && !confirm('Trocar todas as cláusulas deste contrato pelo modelo padrão?')) return;
  state.clauses = state.template.clauses.map((cl) => ({ title: cl.title, body: cl.body }));
  renderClauses();
  state.dirty = true;
}

/** Insere {CAMPO} na posição do cursor do último texto de cláusula focado. */
function insertPlaceholder(key) {
  const field = state.lastClauseField && document.body.contains(state.lastClauseField)
    ? state.lastClauseField
    : document.querySelector('#cf-clauses [data-cfield="body"]');
  if (!field) return;
  const token = `{${key}}`;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.setRangeText(token, start, end, 'end');
  field.focus();
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Salvar ────────────────────────────────────────────────────────

function buildPayload() {
  return {
    customer_id: state.customer?.id || null,
    contact_name: $('#cf-contact').value,
    seller_id: state.seller?.id || null,
    representative_id: Number($('#cf-rep').value) || null,
    proposal_id: state.proposal?.id || null,
    proposal_number: state.proposal?.number || null,
    status: $('#cf-status').value,
    title: $('#cf-title').value,
    issue_date: $('#cf-date').value || null,
    start_date: $('#cf-start').value || null,
    term_months: Number($('#cf-term').value || 0),
    auto_renew: $('#cf-renew').value === 'true',
    billing_type: $('#cf-billing').value,
    payment_method: $('#cf-payment-method').value,
    payment_terms: $('#cf-payment-terms').value,
    due_day: $('#cf-due-day').value || null,
    readjustment_index: $('#cf-readjust').value,
    execution_place: $('#cf-place').value,
    delivery_time: $('#cf-delivery').value,
    forum_city: $('#cf-forum').value,
    signing_city: $('#cf-signing-city').value,
    signing_date: $('#cf-signing-date').value || null,
    object: $('#cf-object').value,
    notes: $('#cf-notes').value,
    items: state.items.filter((it) => it.description.trim()),
    clauses: state.clauses.filter((cl) => cl.title.trim() || cl.body.trim()),
  };
}

async function saveContract({ keepOpen = false } = {}) {
  const payload = buildPayload();
  if (!payload.customer_id) {
    alert('Selecione o cliente (duplo clique no campo Cliente).');
    $('#cf-customer').focus();
    return null;
  }
  if (!payload.title.trim()) {
    alert('Informe o título do contrato.');
    $('#cf-title').focus();
    return null;
  }

  const btn = $('#cf-save');
  btn.disabled = true;
  try {
    const json = state.editingId
      ? await apiFetch(`${API}/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await apiFetch(API, { method: 'POST', body: JSON.stringify(payload) });

    state.dirty = false;
    await loadList();

    if (keepOpen) fillForm(json.data);
    else Modal.close('contract-modal');
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
    const saved = await saveContract({ keepOpen: true });
    if (!saved) return;
    id = saved.id;
  }
  await downloadPdf(id);
}

async function duplicateFromEditor() {
  if (!state.editingId) return;
  if (state.dirty && !confirm('Há alterações não salvas. Duplicar mesmo assim (a cópia usa a versão salva)?')) return;
  Modal.close('contract-modal');
  await duplicateContract(state.editingId);
}

// ── Representante / sócio do cliente (quem assina) ────────────────

const repAddress = (r) => [r.address, [r.city, r.state].filter(Boolean).join('/'), r.postal_code ? `CEP ${r.postal_code}` : '']
  .filter(Boolean).join(' · ');

async function loadRepresentatives(customerId, selectedId = null, selectedRole = '') {
  state.reps = [];
  if (customerId) {
    try {
      const json = await apiFetch(`${API}/customers/${customerId}/representatives`);
      state.reps = json.data || [];
    } catch (error) {
      console.warn('[contractsConsart] representantes:', error);
    }
  }
  renderRepSelects(selectedId, selectedRole);
}

function renderRepSelects(selectedId = null, selectedRole = null) {
  const roleSel = $('#cf-rep-role');
  const repSel = $('#cf-rep');
  const role = selectedRole ?? roleSel.value;
  const roles = [...new Set(state.reps.map((r) => r.role))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  roleSel.innerHTML = '<option value="">Todos os cargos</option>'
    + roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  roleSel.value = roles.includes(role) ? role : '';

  const list = state.reps.filter((r) => !roleSel.value || r.role === roleSel.value);
  const snapshotMissing = state.repSnapshot?.id && !state.reps.some((r) => Number(r.id) === Number(state.repSnapshot.id));

  if (!state.customer) {
    repSel.innerHTML = '<option value="">Selecione o cliente primeiro</option>';
  } else if (!state.reps.length && !snapshotMissing) {
    repSel.innerHTML = '<option value="">Nenhum representante cadastrado (use "👤 Representantes do cliente")</option>';
  } else {
    repSel.innerHTML = '<option value="">Selecione quem assina...</option>'
      + list.map((r) => `<option value="${r.id}">${esc(r.name)} — ${esc(r.role)}</option>`).join('')
      + (snapshotMissing
        ? `<option value="" data-snapshot>${esc(state.repSnapshot.name)} — ${esc(state.repSnapshot.role)} (fora do cadastro)</option>`
        : '');
  }

  const wanted = selectedId ?? (Number(repSel.dataset.current) || null);
  if (wanted && list.some((r) => Number(r.id) === Number(wanted))) repSel.value = String(wanted);
  else if (!wanted && list.length === 1 && roleSel.value) repSel.value = String(list[0].id);
  else repSel.value = '';
  repSel.dataset.current = repSel.value;
  renderRepInfo();
}

function renderRepInfo() {
  const info = $('#cf-rep-info');
  const rep = state.reps.find((r) => String(r.id) === $('#cf-rep').value);
  if (rep) {
    info.className = 'contract-rep-info';
    info.innerHTML = [
      `<strong>${esc(rep.name)}</strong> — ${esc(rep.role)}`,
      rep.cpf ? `CPF ${esc(rep.cpf)}` : '<em>sem CPF</em>',
      esc(repAddress(rep)) || '<em>sem endereço</em>',
    ].join(' · ');
    info.hidden = false;
  } else {
    info.hidden = true;
  }
}

function onRepRoleChange() {
  $('#cf-rep').dataset.current = '';
  renderRepSelects(null);
  state.dirty = true;
}

function onRepChange() {
  const repSel = $('#cf-rep');
  repSel.dataset.current = repSel.value;
  const rep = state.reps.find((r) => String(r.id) === repSel.value);
  if (rep && $('#cf-rep-role').value !== rep.role) renderRepSelects(rep.id, rep.role);
  else renderRepInfo();
  state.dirty = true;
}

function openRepresentativesModal() {
  if (!state.customer) {
    alert('Selecione o cliente primeiro (duplo clique no campo Cliente).');
    return;
  }
  const customerId = state.customer.id;
  const overlay = document.createElement('div');
  overlay.className = 'modal rep-modal';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="modal__backdrop" data-modal-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-8" role="dialog" aria-modal="true" aria-labelledby="repTitle">
        <div class="modal__header modal-header-color-3">
          <h2 class="modal__title" id="repTitle">Representantes / Sócios — ${esc(state.customer.name)}</h2>
          <button type="button" class="modal__close" data-modal-close aria-label="Fechar" title="Fechar">&times;</button>
        </div>
        <div class="modal__body">
          <form class="rep-form" data-form novalidate>
            <div class="fields fields-w-full fields-h-6">
              <label for="repName">Nome completo *</label>
              <input id="repName" maxlength="200">
            </div>
            <div class="fields fields-w-full fields-h-6">
              <label for="repRole">Cargo *</label>
              <input id="repRole" maxlength="80" list="repRoleList" placeholder="Ex.: Sócio-Administrador">
              <datalist id="repRoleList">${state.template.roles.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>
            </div>
            <div class="fields fields-w-full fields-h-6">
              <label for="repCpf">CPF</label>
              <input id="repCpf" maxlength="14" inputmode="numeric" placeholder="000.000.000-00">
            </div>
            <div class="fields fields-w-full fields-h-6 rep-span-3">
              <label for="repAddress">Endereço (rua, número, complemento, bairro)</label>
              <input id="repAddress" maxlength="255">
            </div>
            <div class="fields fields-w-full fields-h-6">
              <label for="repCity">Cidade</label>
              <input id="repCity" maxlength="120">
            </div>
            <div class="fields fields-w-full fields-h-6">
              <label for="repState">UF</label>
              <input id="repState" maxlength="2">
            </div>
            <div class="fields fields-w-full fields-h-6">
              <label for="repCep">CEP</label>
              <input id="repCep" maxlength="9" inputmode="numeric">
            </div>
            <div class="rep-form__bar rep-span-3">
              <button type="button" class="btn btn-cancel btn-sm" data-clear>Limpar</button>
              <button type="button" class="btn btn-save btn-sm" data-save>Salvar representante</button>
            </div>
          </form>
          <div class="rep-table-wrap">
            <table class="rep-table">
              <thead><tr><th>Nome</th><th>Cargo</th><th>CPF</th><th>Endereço</th><th style="width:80px"></th></tr></thead>
              <tbody data-body></tbody>
            </table>
          </div>
        </div>
        <footer class="modal__footer modal-footer-color-3">
          <button type="button" class="btn btn-cancel btn-sm" data-modal-close>Fechar</button>
        </footer>
      </section>
    </div>
  `;

  const q = (sel) => overlay.querySelector(sel);
  const fields = { name: '#repName', role: '#repRole', cpf: '#repCpf', address: '#repAddress', city: '#repCity', state: '#repState', postal_code: '#repCep' };
  let editingId = null;
  let lastSavedId = null;

  function clearForm() {
    editingId = null;
    Object.values(fields).forEach((sel) => { q(sel).value = ''; });
    q('[data-save]').textContent = 'Salvar representante';
    q('#repName').focus();
  }

  function renderTable() {
    const body = q('[data-body]');
    if (!state.reps.length) {
      body.innerHTML = '<tr><td colspan="5" class="rep-table__msg">Nenhum representante cadastrado para este cliente.</td></tr>';
      return;
    }
    body.innerHTML = state.reps.map((r, i) => `
      <tr data-index="${i}">
        <td><strong>${esc(r.name)}</strong></td>
        <td>${esc(r.role)}</td>
        <td>${esc(r.cpf || '—')}</td>
        <td>${esc(repAddress(r) || '—')}</td>
        <td>${actionIconsHtml([
          { action: 'edit', title: 'Editar', attrs: { 'data-edit': i } },
          { action: 'delete', title: 'Excluir', attrs: { 'data-del': i } },
        ])}</td>
      </tr>
    `).join('');
  }

  async function reload() {
    const json = await apiFetch(`${API}/customers/${customerId}/representatives`);
    state.reps = json.data || [];
    renderTable();
  }

  async function save() {
    const payload = Object.fromEntries(Object.entries(fields).map(([k, sel]) => [k, q(sel).value]));
    if (!payload.name.trim() || !payload.role.trim()) {
      alert('Informe o nome e o cargo do representante.');
      return;
    }
    const btn = q('[data-save]');
    btn.disabled = true;
    try {
      const json = editingId
        ? await apiFetch(`${API}/representatives/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiFetch(`${API}/customers/${customerId}/representatives`, { method: 'POST', body: JSON.stringify(payload) });
      lastSavedId = json.data.id;
      await reload();
      clearForm();
    } catch (error) {
      alert(`Erro ao salvar o representante: ${error.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  q('[data-body]').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      const r = state.reps[Number(edit.dataset.edit)];
      editingId = r.id;
      Object.entries(fields).forEach(([k, sel]) => { q(sel).value = r[k] || ''; });
      q('[data-save]').textContent = 'Salvar alterações';
      q('#repName').focus();
    }
    if (del) {
      const r = state.reps[Number(del.dataset.del)];
      if (!confirm(`Excluir o representante ${r.name}? Contratos já salvos mantêm os dados dele.`)) return;
      try {
        await apiFetch(`${API}/representatives/${r.id}`, { method: 'DELETE' });
        await reload();
      } catch (error) {
        alert(`Erro ao excluir: ${error.message}`);
      }
    }
  });
  q('[data-save]').addEventListener('click', save);
  q('[data-clear]').addEventListener('click', clearForm);

  overlay.addEventListener('modal:close', () => {
    overlay.remove();
    // Atualiza os selects do contrato; o recém-salvo já fica escolhido se nada estava escolhido
    const current = Number($('#cf-rep').value) || null;
    const pick = current || lastSavedId;
    const rep = state.reps.find((r) => Number(r.id) === Number(pick));
    renderRepSelects(pick, rep?.role || '');
    if (pick && pick !== current) state.dirty = true;
  });

  document.body.appendChild(overlay);
  Modal.open(overlay);
  renderTable();
  q('#repName').focus();
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
      if (!$('#cf-contact').value && customer.contact_name) $('#cf-contact').value = customer.contact_name;
      state.repSnapshot = null;
      loadRepresentatives(state.customer.id);
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
  $('#btnFromProposal').addEventListener('click', openProposalPicker);
  $('#btnBack').addEventListener('click', () => history.back());
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  ['#filterStatus', '#filterSeller', '#filterFrom', '#filterTo', '#pageSize']
    .forEach((sel) => $(sel).addEventListener('change', search));
  $('#btnPrevious').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadList(); } });
  $('#btnNext').addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; loadList(); } });
  $('#contractsBody').addEventListener('click', onListClick);

  // Cliente e vendedor só mudam pelo seletor: bloqueia digitação/colar
  ['#cf-customer', '#cf-seller'].forEach((sel) => {
    $(sel).addEventListener('beforeinput', (e) => e.preventDefault());
  });

  const customer = $('#cf-customer');
  customer.addEventListener('dblclick', pickCustomer);
  customer.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pickCustomer(); } });

  const seller = $('#cf-seller');
  seller.addEventListener('dblclick', pickSeller);
  seller.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); pickSeller(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setSeller(null); state.dirty = true; }
  });

  $('#cf-rep-role').addEventListener('change', onRepRoleChange);
  $('#cf-rep').addEventListener('change', onRepChange);
  $('#cf-rep-manage').addEventListener('click', openRepresentativesModal);

  $('#cf-start').addEventListener('change', updateEndDate);
  $('#cf-term').addEventListener('input', updateEndDate);
  $('#cf-billing').addEventListener('change', () => { updateTotalLabel(); renderItems(); });
  $('#contract-form').addEventListener('input', () => { state.dirty = true; });

  const items = $('#cf-items');
  items.addEventListener('input', onItemInput);
  items.addEventListener('change', onItemChange);
  items.addEventListener('focusout', onItemBlur);
  items.addEventListener('click', onItemsClick);

  const clauses = $('#cf-clauses');
  clauses.addEventListener('input', onClauseInput);
  clauses.addEventListener('click', onClausesClick);
  clauses.addEventListener('focusin', (e) => {
    if (e.target.matches('[data-cfield="body"]')) state.lastClauseField = e.target;
  });
  // Botão do campo não rouba o foco (mantém a posição do cursor)
  $('#cf-placeholders').addEventListener('mousedown', (e) => { if (e.target.closest('[data-ph]')) e.preventDefault(); });
  $('#cf-placeholders').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ph]');
    if (btn) insertPlaceholder(btn.dataset.ph);
  });

  $('#cf-add-item').addEventListener('click', () => addItem());
  $('#cf-add-service').addEventListener('click', addServiceItem);
  $('#cf-add-clause').addEventListener('click', addClause);
  $('#cf-reset-clauses').addEventListener('click', resetClauses);
  $('#cf-save').addEventListener('click', () => saveContract());
  $('#cf-pdf').addEventListener('click', pdfFromEditor);
  $('#cf-duplicate').addEventListener('click', duplicateFromEditor);
}

// ─────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────

Modal.setup();
bindEvents();
loadSellers();
loadPaymentMethods();
await loadTemplate();
await loadList();

// ?open=ID (vindo da tela de Propostas de Serviços) abre o contrato direto
const openId = Number(new URLSearchParams(location.search).get('open'));
if (openId > 0) {
  history.replaceState(null, '', location.pathname);
  openEditor(openId);
}
