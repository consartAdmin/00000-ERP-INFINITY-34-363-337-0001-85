// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: customersListConsart.crm.js                                   ║
// ║ MODULE: Clientes Consart — Enviar ao CRM                            ║
// ║ CONSART ERP                                                         ║
// ║ Caixa de seleção por linha (+ selecionar todos da página) e botão   ║
// ║ "Enviar ao CRM": cria 1 card por cliente no CRM Consart ERP         ║
// ║ (POST /api/crm/deals/from-customers). A seleção vale entre páginas  ║
// ║ e filtros; cliente que já tem card aberto não é duplicado.          ║
// ║ Não mexe no render compartilhado (customersList.render.js): a       ║
// ║ célula de seleção entra em cada linha que o render coloca no tbody. ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { fetchJSON } from '/crmDeals/js/fetchJSON.js';
import { apiUrl } from '/crmDeals/js/config.js';

const CRM_COMPANY = 'CONSART';
const CRM_PAGE = '/crmConsartErp/crmConsartErp.html';
const MODAL_ID = 'crmSendModal';

const selected = new Map(); // customer_id → nome fantasia
let stagesLoaded = false;

const $ = (sel) => document.querySelector(sel);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const crmFetch = (path, options = {}) => fetchJSON(apiUrl(path), {
  ...options,
  headers: { 'X-CRM-Company': CRM_COMPANY, ...(options.headers || {}) },
});

/* ---------------------------------------------------------------- linhas */

function rowCustomer(tr) {
  const id = tr.querySelector('[data-edit]')?.getAttribute('data-edit');
  if (!id) return null;
  // Nome Fantasia = 2ª coluna do render (antes da célula de seleção)
  const nameCell = tr.querySelector('.table-cell-select') ? tr.cells[2] : tr.cells[1];
  return { id: String(id), name: nameCell?.textContent.trim() || `Cliente ${id}` };
}

function decorateRow(tr) {
  if (tr.querySelector('.table-cell-select')) return;
  const customer = rowCustomer(tr);
  if (!customer) return;

  const td = document.createElement('td');
  td.className = 'table-cell-select';
  td.innerHTML = `<input type="checkbox" data-crm-select="${esc(customer.id)}"
    aria-label="Selecionar ${esc(customer.name)}" title="Selecionar para enviar ao CRM" />`;
  tr.insertBefore(td, tr.firstChild);

  const checkbox = td.querySelector('input');
  checkbox.checked = selected.has(customer.id);
  tr.classList.toggle('is-selected', checkbox.checked);

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selected.set(customer.id, customer.name);
    else selected.delete(customer.id);
    tr.classList.toggle('is-selected', checkbox.checked);
    refreshSelectionUi();
  });
}

function visibleCheckboxes() {
  return [...document.querySelectorAll('#tbody input[data-crm-select]')];
}

/* ---------------------------------------------------------------- estado visual */

function refreshSelectionUi() {
  const count = selected.size;

  const button = $('#btnSendCrm');
  if (button) {
    button.disabled = count === 0;
    button.title = count
      ? `Enviar ${count} ${count === 1 ? 'cliente' : 'clientes'} ao CRM Consart ERP`
      : 'Marque os clientes na lista para enviar ao CRM';
  }
  const badge = $('#crmSelectedCount');
  if (badge) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  const all = $('#crmSelectAll');
  if (all) {
    const boxes = visibleCheckboxes();
    const marked = boxes.filter((b) => b.checked).length;
    all.checked = boxes.length > 0 && marked === boxes.length;
    all.indeterminate = marked > 0 && marked < boxes.length;
  }
}

function toggleVisible(checked) {
  for (const box of visibleCheckboxes()) {
    if (box.checked === checked) continue;
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
  }
  refreshSelectionUi();
}

function clearSelection() {
  selected.clear();
  for (const box of visibleCheckboxes()) {
    box.checked = false;
    box.closest('tr')?.classList.remove('is-selected');
  }
  refreshSelectionUi();
}

/* ---------------------------------------------------------------- modal */

async function loadStages() {
  if (stagesLoaded) return;
  const select = $('#crmSendStage');
  const result = await crmFetch('/crm/stages');
  const stages = Array.isArray(result?.data) ? result.data : [];
  if (!result?.ok || !stages.length) return;

  select.innerHTML = stages
    .filter((s) => s.is_active !== false)
    .map((s) => `<option value="${esc(s.id)}">${esc(s.stage_name || s.name || s.code)}</option>`)
    .join('');
  stagesLoaded = true;
}

function renderModalList() {
  const count = selected.size;
  $('#crmSendCount').textContent =
    `${count} ${count === 1 ? 'cliente selecionado' : 'clientes selecionados'}`;
  $('#crmSendList').innerHTML = [...selected.entries()]
    .map(([id, name]) => `
      <li class="crm-send-list__item">
        <span class="crm-send-list__id">${esc(id)}</span>
        <span class="crm-send-list__name">${esc(name)}</span>
        <button type="button" class="crm-send-list__remove" data-crm-unselect="${esc(id)}"
          title="Tirar da seleção" aria-label="Tirar ${esc(name)} da seleção">&times;</button>
      </li>`)
    .join('');
}

async function openSendModal() {
  if (!selected.size) return;
  renderModalList();
  Modal.open(MODAL_ID, { focusSelector: '#crmSendStage' });
  try {
    await loadStages();
  } catch (error) {
    console.warn('[customersListConsart.crm] etapas do CRM', error);
  }
}

function unselect(id) {
  selected.delete(id);
  const box = document.querySelector(`#tbody input[data-crm-select="${CSS.escape(id)}"]`);
  if (box) {
    box.checked = false;
    box.closest('tr')?.classList.remove('is-selected');
  }
  refreshSelectionUi();
  if (!selected.size) Modal.close(MODAL_ID);
  else renderModalList();
}

async function send() {
  const button = $('#crmSendConfirm');
  const stageSelect = $('#crmSendStage');
  const stageName = stageSelect.selectedOptions[0]?.textContent || 'Triagem';

  button.disabled = true;
  const result = await crmFetch('/crm/deals/from-customers', {
    method: 'POST',
    body: {
      customer_ids: [...selected.keys()].map(Number),
      stage_id: Number(stageSelect.value) || null,
    },
  });
  button.disabled = false;

  if (!result?.ok) {
    showCenterModal({
      variant: 'error',
      title: 'Enviar ao CRM',
      message: `Não foi possível enviar os clientes ao CRM (${esc(result?.error || 'erro')}).`,
    });
    return;
  }

  const { summary = {}, results = [], stage = {} } = result.data || {};
  const lines = [
    `<b>${summary.created || 0}</b> ${summary.created === 1 ? 'card criado' : 'cards criados'} em <b>${esc(stage.name || stageName)}</b>.`,
  ];
  if (summary.skipped) {
    lines.push(`<b>${summary.skipped}</b> já ${summary.skipped === 1 ? 'tinha card aberto' : 'tinham card aberto'} no CRM (não duplicado).`);
  }
  if (summary.failed) {
    const names = results.filter((r) => !r.ok).map((r) => esc(r.customer_name || r.customer_id)).join(', ');
    lines.push(`<b>${summary.failed}</b> com erro: ${names}.`);
  }

  Modal.close(MODAL_ID);
  // Quem foi criado ou já estava no CRM sai da seleção; quem deu erro continua marcado
  for (const r of results) if (r.ok) unselect(String(r.customer_id));

  const action = await showCenterModal({
    variant: summary.failed ? 'warning' : 'success',
    title: 'Enviado ao CRM',
    message: lines.join('<br>'),
    buttons: [
      { label: 'Fechar', variant: 'cancel' },
      { label: 'Abrir CRM', variant: 'primary', action: () => 'open' },
    ],
  });
  if (action === 'open') location.href = CRM_PAGE;
}

/* ---------------------------------------------------------------- boot */

function boot() {
  const tbody = $('#tbody');
  if (!tbody) return;

  new MutationObserver(() => {
    tbody.querySelectorAll(':scope > tr').forEach(decorateRow);
    refreshSelectionUi();
  }).observe(tbody, { childList: true });

  $('#crmSelectAll')?.addEventListener('change', (e) => toggleVisible(e.target.checked));
  $('#btnSendCrm')?.addEventListener('click', () => void openSendModal());
  $('#crmSendConfirm')?.addEventListener('click', () => void send());
  $('#crmSendClear')?.addEventListener('click', () => {
    clearSelection();
    Modal.close(MODAL_ID);
  });
  $('#crmSendList')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-crm-unselect]')?.getAttribute('data-crm-unselect');
    if (id) unselect(id);
  });

  refreshSelectionUi();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
