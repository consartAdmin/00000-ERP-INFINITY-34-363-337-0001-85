// ╔══════════════════════════════════════════════════════════════╗
// ║ budgets.customerPriceTable.js — Vincular tabela de preço     ║
// ║ ao cliente sem sair do orçamento (CONSART ERP | ESM)         ║
// ║ Usa o vínculo existente: public."customerPriceTables"        ║
// ║ GET/PUT /api/customer-price-tables/customers/:id/price-table ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import { $, ROUTES, state } from './budgets.core.js';
import { authHeaders, fetchSafe, handleAuthFail, toast } from './budgets.infra.js';
import { loadCustomerPriceTable } from './budgets.items.js';
import { isSinglePriceMode } from './budgets.priceMode.js';
import { Modal } from '/public/includes/js/modal.js';

const MODAL_ID = 'customerPriceTableModal';

let currentCustomerId = null;
let saving = false;

function getCustomerId() {
  const id = Number(state.editing?.header?.customer_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getCustomerName() {
  const h = state.editing?.header || {};
  return (
    h.customer_name ||
    h.nome_razao_social ||
    $('#cliBusca')?.value ||
    ''
  ).toString().trim();
}

function setCurrentPill(name) {
  const pill = $('#customerPriceTableCurrent');
  if (!pill) return;

  pill.classList.remove('summary-pill--success', 'summary-pill--warning');
  if (name) {
    pill.classList.add('summary-pill--success');
    pill.textContent = name;
  } else {
    pill.classList.add('summary-pill--warning');
    pill.textContent = 'Sem tabela vinculada';
  }
}

async function fetchJson(url, options = {}) {
  const out = await fetchSafe(url, { headers: authHeaders(), method: 'GET', ...options });
  if (!out.ok && handleAuthFail(out.status, out.text)) {
    const err = new Error('AUTH');
    err.auth = true;
    throw err;
  }
  return out;
}

async function loadModalData(customerId) {
  const select = $('#customerPriceTableSelect');
  const saveBtn = $('#btnCustomerPriceTableSave');
  if (select) {
    select.disabled = true;
    select.innerHTML = '<option value="">Carregando…</option>';
  }
  if (saveBtn) saveBtn.disabled = true;

  const [tablesOut, assignmentOut] = await Promise.all([
    fetchJson(ROUTES.customerPriceTablesList),
    fetchJson(ROUTES.customerPriceTable(customerId)),
  ]);

  if (!tablesOut.ok) {
    throw new Error(
      tablesOut.json?.error || tablesOut.json?.message || `HTTP ${tablesOut.status}`
    );
  }

  const raw = tablesOut.json;
  const tables = Array.isArray(raw) ? raw : (raw?.data ?? raw?.rows ?? []);

  let assignedId = null;
  let assignedName = '';
  if (assignmentOut.ok) {
    const a = assignmentOut.json?.data ?? assignmentOut.json ?? {};
    assignedId = Number(a.price_id) || null;
    assignedName = a.name || a.description || (assignedId ? `Tabela ${assignedId}` : '');
  }

  setCurrentPill(assignedName);

  if (select) {
    select.innerHTML = '<option value="">Selecione a tabela…</option>';
    for (const t of tables) {
      const id = t.price_id ?? t.id;
      if (id == null) continue;
      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = t.name || t.description || `Tabela ${id}`;
      select.appendChild(opt);
    }
    if (assignedId) select.value = String(assignedId);
    select.disabled = false;
  }
  if (saveBtn) saveBtn.disabled = false;

  return { tables, assignedId };
}

export async function openCustomerPriceTableModal() {
  if (isSinglePriceMode()) return;

  const customerId = getCustomerId();
  if (!customerId) {
    toast.warn('Tabela de preço', 'Selecione um cliente antes de vincular a tabela de preço.');
    return;
  }

  currentCustomerId = customerId;

  const subtitle = $('#customerPriceTableModalSubtitle');
  if (subtitle) {
    const name = getCustomerName();
    subtitle.textContent = name ? `Cliente: ${name}` : `Cliente #${customerId}`;
  }

  Modal.open(MODAL_ID, { focusSelector: '#customerPriceTableSelect' });

  try {
    await loadModalData(customerId);
  } catch (error) {
    if (error?.auth) return;
    console.error('[budgets] customerPriceTable load:', error);
    Modal.close(MODAL_ID);
    toast.error('Tabela de preço', `Não foi possível carregar as tabelas de preço. (${error.message})`);
  }
}

async function saveCustomerPriceTable() {
  if (saving) return;

  const customerId = currentCustomerId;
  const select = $('#customerPriceTableSelect');
  const priceId = Number(select?.value);

  if (!customerId) return;
  if (!Number.isSafeInteger(priceId) || priceId <= 0) {
    toast.warn('Tabela de preço', 'Escolha a tabela de preço.');
    select?.focus();
    return;
  }

  const saveBtn = $('#btnCustomerPriceTableSave');
  saving = true;
  if (saveBtn) saveBtn.disabled = true;

  try {
    const out = await fetchJson(ROUTES.customerPriceTable(customerId), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ priceId }),
    });

    if (!out.ok) {
      throw new Error(
        out.json?.error || out.json?.message || `HTTP ${out.status}`
      );
    }

    Modal.close(MODAL_ID);

    // Recarrega o select "Tabela de preço" (e o preço do produto em edição)
    // só se o orçamento ainda estiver no mesmo cliente.
    if (getCustomerId() === customerId) {
      await loadCustomerPriceTable(customerId, { silent: true });
    }

    const name = select?.selectedOptions?.[0]?.textContent || `Tabela ${priceId}`;
    toast.success('Tabela de preço', `Cliente vinculado à tabela "${name}".`);
  } catch (error) {
    if (error?.auth) return;
    console.error('[budgets] customerPriceTable save:', error);
    toast.error('Tabela de preço', `Não foi possível salvar o vínculo. (${error.message})`);
  } finally {
    saving = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

export function initCustomerPriceTableLink() {
  Modal.setup();

  $('#btnLinkPriceTable')?.addEventListener('click', (event) => {
    event.preventDefault();
    openCustomerPriceTableModal();
  });

  $('#btnCustomerPriceTableSave')?.addEventListener('click', (event) => {
    event.preventDefault();
    saveCustomerPriceTable();
  });
}
