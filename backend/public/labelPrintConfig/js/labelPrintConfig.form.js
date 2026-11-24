// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: labelPrintConfig.form.js                                      ║
// ║ MODULE: Parâmetros Etiqueta Localização — Formulário + preview      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  BARCODE_TYPE_LABELS,
  FALLBACK_MODEL,
  LOCATION_WRAP_LABELS,
  PAPER_LABELS,
  labelHtml,
  loadBarcodeLibs,
  normalizeModel,
} from '/public/includes/js/locationLabelPrint.js';
import { $, escapeHtml, formatMm } from './labelPrintConfig.utils.js';

const NUMBER_FIELDS = [
  'width_mm', 'height_mm', 'margin_mm', 'copies', 'barcode_height_mm', 'barcode_width_pct',
  'barcode_text_font_pt', 'title_font_pt', 'location_font_pt',
];
const BOOL_FIELDS = [
  'is_default', 'is_active', 'show_barcode_text', 'show_title', 'show_location', 'show_footer', 'show_border',
];
const TEXT_FIELDS = ['name', 'description', 'paper', 'barcode_type', 'location_wrap', 'title_text', 'footer_text'];

export const FORM_FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS, ...BOOL_FIELDS];

export function fillSelectOptions() {
  $('#paper').innerHTML = Object.entries(PAPER_LABELS)
    .map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  $('#location_wrap').innerHTML = Object.entries(LOCATION_WRAP_LABELS)
    .map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  $('#barcode_type').innerHTML = Object.entries(BARCODE_TYPE_LABELS)
    .map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
}

export function readForm() {
  const data = {};
  TEXT_FIELDS.forEach((id) => { data[id] = $(`#${id}`).value.trim(); });
  NUMBER_FIELDS.forEach((id) => {
    const raw = String($(`#${id}`).value).replace(',', '.');
    data[id] = raw === '' ? null : Number(raw);
  });
  BOOL_FIELDS.forEach((id) => { data[id] = $(`#${id}`).value === 'true'; });
  return data;
}

export function fillForm(raw = {}) {
  const model = { ...normalizeModel({ ...FALLBACK_MODEL, ...raw }) };
  $('#model_id').value = raw.id ?? '';
  TEXT_FIELDS.forEach((id) => { $(`#${id}`).value = model[id] ?? ''; });
  $('#name').value = raw.name ?? '';
  $('#description').value = raw.description ?? '';
  NUMBER_FIELDS.forEach((id) => { $(`#${id}`).value = model[id] ?? ''; });
  BOOL_FIELDS.forEach((id) => {
    const value = id === 'is_default' ? Boolean(raw.is_default)
      : id === 'is_active' ? raw.is_active !== false : Boolean(model[id]);
    $(`#${id}`).value = value ? 'true' : 'false';
  });
}

/** Campos dependentes ficam desabilitados quando o item está oculto. */
export function syncDependentFields() {
  const pairs = [
    ['show_title', ['title_text', 'title_font_pt']],
    ['show_location', ['location_font_pt', 'location_wrap']],
    ['show_footer', ['footer_text']],
    ['show_barcode_text', ['barcode_text_font_pt']],
  ];
  pairs.forEach(([toggle, deps]) => {
    const off = $(`#${toggle}`).value !== 'true';
    deps.forEach((id) => { $(`#${id}`).disabled = off; });
  });
  $('#barcode_width_pct').disabled = $('#barcode_type').value === 'QR';
}

let previewSeq = 0;

export async function renderPreview() {
  const box = $('#labelPreview');
  if (!box) return;
  syncDependentFields();

  const model = normalizeModel(readForm());
  const seq = ++previewSeq;
  $('#previewInfo').textContent =
    `${formatMm(model.width_mm)} × ${formatMm(model.height_mm)} mm · ${model.barcode_type}` +
    `${model.paper === 'a4' ? ' · Folha A4' : ' · Térmica'}`;

  const row = {
    barcode: $('#sampleBarcode').value.trim() || 'LOC-0001',
    label: $('#sampleLocation').value.trim(),
  };

  try {
    await loadBarcodeLibs(model);
    if (seq !== previewSeq) return;
    box.innerHTML = labelHtml(row, model);
  } catch (error) {
    if (seq !== previewSeq) return;
    box.innerHTML = `<div class="summary-pill summary-pill--danger">${escapeHtml(error.message)}</div>`;
  }
}
