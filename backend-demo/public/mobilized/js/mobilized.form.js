'use strict';

import { DEFAULT_STATUS } from './mobilized.config.js';
import { dom, fields, itemFields, state } from './mobilized.state.js';
import { formatBRL, formatDateBR, formatDateTime, parseDateTimeLocal, setDisabled, toNumber } from './mobilized.utils.js';

// O <input type=datetime-local> pode estar com a máscara dd/mm/aaaa do
// brDateTimeInput: avisa o campo visível quando o valor muda por código.
function setDateValue(input, value) {
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setPdfButtons(enabled) {
  [dom.btnPdfDownload, dom.btnPdfPickUpload, dom.btnPdfGenerateUpload].forEach((button) => setDisabled(button, !enabled));
}

function renderPdfInfo(row) {
  const hasSaved = Boolean(String(row?.pdf_path || '').trim());
  setDisabled(dom.btnOpenPdf, !hasSaved);
  if (!dom.pdfInfo) return;
  if (!row?.mobilized_id) { dom.pdfInfo.textContent = 'Salve o mobilizado para gerar o PDF.'; return; }
  dom.pdfInfo.textContent = hasSaved
    ? `Último PDF salvo: ${formatDateBR(row.pdf_uploaded_at)} · versão ${row.pdf_version || 1}`
    : 'Nenhum PDF salvo no GCS. "Visualizar PDF" gera na hora com os itens atuais.';
}

export function resetEditor() {
  state.selectedId = null; state.selectedRow = null; state.items = []; state.attachments = []; state.selectedItemsTotal = 0;
  dom.form?.reset();
  if (fields.mobilized_id) fields.mobilized_id.value = '';
  if (fields.status) fields.status.value = DEFAULT_STATUS;
  setDateValue(fields.acquired_at, '');
  if (dom.detailsTitle) dom.detailsTitle.textContent = 'Novo mobilizado';
  [dom.btnSave, dom.btnDelete, dom.btnAddItem].forEach((button) => setDisabled(button, true));
  setPdfButtons(false); renderPdfInfo(null);
}
export function prepareNew() {
  resetEditor(); setDisabled(dom.btnSave, false);
  setDateValue(fields.acquired_at, formatDateTime(new Date()));
}
export function fillEditor(row) {
  state.selectedRow = row; state.selectedId = row.mobilized_id;
  Object.entries(fields).forEach(([key, field]) => {
    if (!field || key === 'acquired_at') return;
    field.value = row[key] ?? '';
  });
  setDateValue(fields.acquired_at, formatDateTime(row.acquired_at));
  fields.status.value ||= DEFAULT_STATUS;
  if (dom.detailsTitle) dom.detailsTitle.textContent = `Mobilizado — ${row.title || `#${row.mobilized_id}`}`;
  setDisabled(dom.btnSave, false); setDisabled(dom.btnDelete, false); setDisabled(dom.btnAddItem, false);
  setPdfButtons(true); renderPdfInfo(row);
}
// Metadados do PDF (storage, caminho, sha256...) são gravados só pelo backend
// no upload/geração; o formulário não os envia mais.
export function collectMobilized() {
  return {
    title: fields.title.value.trim(), status: fields.status.value,
    acquired_at: parseDateTimeLocal(fields.acquired_at.value),
    source_system: fields.source_system.value.trim() || null,
    external_ref: fields.external_ref.value.trim() || null, notes: fields.notes.value.trim() || null,
  };
}
export function fillItem(row = null) {
  Object.entries(itemFields).forEach(([key, field]) => { if (field) field.value = row?.[key] ?? ''; });
  itemFields.quantity.value = row?.quantity != null ? toNumber(row.quantity) : 1;
  itemFields.unit_price.value = row?.unit_price != null && row.unit_price !== '' ? toNumber(row.unit_price) : '';
  recalcItemTotal();
}
export function collectItem() {
  const quantity = toNumber(itemFields.quantity.value); const unitPrice = toNumber(itemFields.unit_price.value);
  return {
    sku: itemFields.sku.value.trim() || null, description: itemFields.description.value.trim(),
    model: itemFields.model.value.trim() || null, serial_number: itemFields.serial_number.value.trim() || null,
    nfe_ref: itemFields.nfe_ref.value.trim() || null, quantity,
    unit: itemFields.unit.value.trim() || null,
    unit_price: itemFields.unit_price.value !== '' ? unitPrice : null,
    notes: itemFields.notes.value.trim() || null,
  };
}
export function recalcItemTotal() {
  if (!itemFields.total_value) return;
  itemFields.total_value.value = formatBRL(toNumber(itemFields.quantity.value) * toNumber(itemFields.unit_price.value));
}
