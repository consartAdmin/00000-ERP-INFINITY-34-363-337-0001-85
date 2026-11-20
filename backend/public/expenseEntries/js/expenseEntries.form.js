// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.form.js — Form handling (CONSART ERP)                ║
// ║ Path: backend/public/expenseEntries/expenseEntries.form.js           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { state } from './expenseEntries.state.js';
import { $, escapeHtml, moneyBR, toISODate } from './expenseEntries.utils.js';
import { apiBase } from './expenseEntries.config.js';
import { resetAttachments } from './expenseEntries.attachments.js';
import { readClassification, resetClassification } from './expenseEntries.classification.js';

// Veículos (frota de Entregas) para o select "Veículo (combustível)".
export async function loadVehicleOptions() {
  const select = $('#vehicleId');
  if (!select) return;
  try {
    const response = await fetch(`${apiBase}/api/delivery-trips/vehicles`);
    const json = await response.json().catch(() => null);
    const rows = Array.isArray(json) ? json : (json?.data || []);
    const current = select.value;
    select.innerHTML = '<option value="">Nenhum</option>' + rows.map((v) => {
      const label = [v.plate, v.description || v.brand].filter(Boolean).join(' • ');
      const inactive = v.is_active === false ? ' (inativo)' : '';
      return `<option value="${escapeHtml(v.vehicle_id)}">${escapeHtml(label || `Veículo ${v.vehicle_id}`)}${inactive}</option>`;
    }).join('');
    setVehicleValue(current);
  } catch {
    // Sem frota cadastrada: o select fica só com "Nenhum".
  }
}

// Garante que um veículo gravado continue visível mesmo se não estiver na lista.
function setVehicleValue(id) {
  const select = $('#vehicleId');
  const value = id === null || id === undefined ? '' : String(id);
  if (value && ![...select.options].some((o) => o.value === value)) {
    select.add(new Option(`Veículo ${value}`, value));
  }
  select.value = value;
}

function setTaxCredit(on) {
  $('#taxCreditOption').value = on ? '1' : '0';
}

export function setModalTitle(title, subtitle = '') {
  $('#modalTitle').textContent = title;
  $('#modalSub').textContent = subtitle;
}

export function renderItemsPreview(items = []) {
  const section = $('#itemsSection');
  const hint = $('#itemsHint');
  const tbody = $('#itemsTbody');

  if (!items.length) {
    section.style.display = 'none';
    hint.textContent = '';
    tbody.innerHTML = '';
    return;
  }

  section.style.display = 'block';
  hint.textContent = `${items.length} item(ns) detectado(s) no XML`;
  tbody.innerHTML = items.map((item) => {
    const sku = escapeHtml(item.sku || '-');
    const description = escapeHtml(item.description || '');
    const unit = escapeHtml(item.unit || '');
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const totalValue = Number(item.totalValue || 0);

    return `
      <tr>
        <td>${sku}</td>
        <td title="${description}">${description}</td>
        <td>${unit}</td>
        <td class="ee-right">${quantity.toLocaleString('pt-BR')}</td>
        <td class="ee-right">${moneyBR(unitPrice)}</td>
        <td class="ee-right">${moneyBR(totalValue)}</td>
      </tr>
    `;
  }).join('');
}

export function clearForm() {
  $('#expenseEntryId').value = '';
  $('#documentType').value = 'NFE';
  $('#issueDate').value = '';
  $('#entryDate').value = '';
  $('#status').value = 'OPEN';
  $('#documentNumber').value = '';
  $('#documentSeries').value = '';
  $('#documentKey').value = '';
  $('#supplierName').value = '';
  $('#supplierDocument').value = '';
  $('#totalProductsValue').value = 0;
  $('#totalDiscountValue').value = 0;
  $('#totalTaxValue').value = 0;
  $('#totalExpenseValue').value = 0;
  $('#costCenterId').value = '';
  setVehicleValue('');
  $('#notes').value = '';
  $('#xmlPath').value = '';
  $('#pdfPath').value = '';
  setTaxCredit(false);
  $('#fiscalStatus').value = 'NO_CREDIT';

  state.xmlItems = [];
  renderItemsPreview([]);
  resetAttachments();
  resetClassification();
}

export function fillForm(row = {}) {
  $('#expenseEntryId').value = row.expenseEntryId ?? '';
  $('#documentType').value = (row.documentType || 'NFE').toUpperCase();
  $('#issueDate').value = toISODate(row.issueDate);
  $('#entryDate').value = toISODate(row.entryDate);
  $('#status').value = (row.status || 'OPEN').toUpperCase();
  $('#documentNumber').value = row.documentNumber ?? '';
  $('#documentSeries').value = row.documentSeries ?? '';
  $('#documentKey').value = row.documentKey ?? '';
  $('#supplierName').value = row.supplierName ?? '';
  $('#supplierDocument').value = row.supplierDocument ?? '';
  $('#totalProductsValue').value = Number(row.totalProductsValue || 0);
  $('#totalDiscountValue').value = Number(row.totalDiscountValue || 0);
  $('#totalTaxValue').value = Number(row.totalTaxValue || 0);
  $('#totalExpenseValue').value = Number(row.totalExpenseValue || 0);
  $('#costCenterId').value = row.costCenterId ?? '';
  setVehicleValue(row.vehicleId ?? '');
  $('#notes').value = row.notes ?? '';
  $('#xmlPath').value = row.xmlPath ?? '';
  $('#pdfPath').value = row.pdfPath ?? '';
  setTaxCredit(row.generatesTaxCredit);
  $('#fiscalStatus').value = row.fiscalStatus ?? 'NO_CREDIT';
}

export function readForm() {
  return {
    documentType: $('#documentType').value,
    issueDate: $('#issueDate').value,
    entryDate: $('#entryDate').value || null,
    status: $('#status').value,
    documentNumber: $('#documentNumber').value.trim() || null,
    documentSeries: $('#documentSeries').value.trim() || null,
    documentKey: $('#documentKey').value.trim() || null,
    supplierName: $('#supplierName').value.trim() || null,
    supplierDocument: $('#supplierDocument').value.trim() || null,
    totalProductsValue: Number($('#totalProductsValue').value || 0),
    totalDiscountValue: Number($('#totalDiscountValue').value || 0),
    totalTaxValue: Number($('#totalTaxValue').value || 0),
    totalExpenseValue: Number($('#totalExpenseValue').value || 0),
    costCenterId: $('#costCenterId').value ? Number($('#costCenterId').value) : null,
    vehicleId: $('#vehicleId').value ? Number($('#vehicleId').value) : null,
    notes: $('#notes').value.trim() || null,
    xmlPath: $('#xmlPath').value.trim() || null,
    pdfPath: $('#pdfPath').value.trim() || null,
    generatesTaxCredit: $('#taxCreditOption').value === '1',
    fiscalStatus: $('#fiscalStatus').value.trim() || 'NO_CREDIT',
    // Vai para a movimentação do Caixa (não é coluna da entrada)
    cashClassification: readClassification(),
  };
}

