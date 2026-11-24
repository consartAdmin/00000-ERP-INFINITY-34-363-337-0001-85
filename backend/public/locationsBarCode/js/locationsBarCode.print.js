// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: locationsBarCode.print.js                                    ║
// ║ MODULE: Locations Barcode — Label Printing                         ║
// ║ Usa os modelos salvos em Parâmetros Etiqueta Localização           ║
// ║ (/public/includes/js/locationLabelPrint.js). O select #labelModel  ║
// ║ escolhe o modelo; o padrão vem marcado.                            ║
// ║ CONSART ERP · Frontend · ESM                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  FALLBACK_MODEL,
  downloadLocationLabelPdf,
  fetchLabelModels,
  printLocationLabels,
} from '/public/includes/js/locationLabelPrint.js';
import { showFeedback } from './locationsBarCode.modal.js';
import { escapeHtml } from './locationsBarCode.utils.js';

const STORAGE_KEY = 'locationsBarCode.labelModelId';
let models = [];

export async function loadLabelModels() {
  const select = document.getElementById('labelModel');
  try {
    models = await fetchLabelModels();
  } catch (error) {
    console.error('[locationsBarCode] loadLabelModels:', error);
    models = [];
  }
  if (!select) return;
  if (!models.length) {
    select.innerHTML = `<option value="">${escapeHtml(FALLBACK_MODEL.name)}</option>`;
    return;
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  const selected = models.find((m) => String(m.id) === saved) || models.find((m) => m.is_default) || models[0];
  select.innerHTML = models.map((m) => `<option value="${m.id}"${m.id === selected.id ? ' selected' : ''}>${escapeHtml(m.name)}` +
    `${m.is_default ? ' (padrão)' : ''}</option>`).join('');
  select.addEventListener('change', () => localStorage.setItem(STORAGE_KEY, select.value));
}

export function currentLabelModel() {
  const id = document.getElementById('labelModel')?.value;
  return models.find((m) => String(m.id) === String(id)) || models.find((m) => m.is_default) || FALLBACK_MODEL;
}

export async function printLabels(rows) {
  if (!rows?.length) {
    showFeedback('warning', 'Impressão', 'Selecione pelo menos uma localização para imprimir.');
    return;
  }
  try {
    await printLocationLabels(rows, currentLabelModel());
  } catch (error) {
    showFeedback('error', 'Impressão', error.message);
  }
}

export async function downloadLabelPdf(row) {
  if (!row) {
    showFeedback('warning', 'Etiqueta', 'Nenhuma localização selecionada.');
    return;
  }
  try {
    await downloadLocationLabelPdf(row, currentLabelModel());
  } catch (error) {
    showFeedback('error', 'PDF da etiqueta', error.message);
  }
}
