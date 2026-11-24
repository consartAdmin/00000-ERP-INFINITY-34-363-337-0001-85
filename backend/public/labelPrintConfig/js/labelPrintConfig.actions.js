// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: labelPrintConfig.actions.js                                   ║
// ║ MODULE: Parâmetros Etiqueta Localização — Ações                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { normalizeModel, printLocationLabels } from '/public/includes/js/locationLabelPrint.js';
import {
  createModel, deleteModel, listModels, setDefaultModel, updateModel,
} from './labelPrintConfig.api.js';
import { fillForm, readForm, renderPreview } from './labelPrintConfig.form.js';
import { renderTable } from './labelPrintConfig.render.js';
import { $, confirmCenter, notify, state } from './labelPrintConfig.utils.js';

const MODAL_ID = 'modelModal';

const handlers = {
  onEdit: (row) => openModel(row),
  onCopy: (row) => openModel({ ...row, id: null, name: `${row.name} (cópia)`, is_default: false }),
  onDefault: (row) => makeDefault(row),
  onDelete: (row) => removeModel(row),
};

export function refreshTable() {
  renderTable(handlers);
}

export async function loadModels() {
  try {
    const rows = await listModels();
    state.models = (Array.isArray(rows) ? rows : []).map(normalizeModel);
  } catch (error) {
    console.error('[labelPrintConfig] loadModels', error);
    state.models = [];
    notify(`Não foi possível carregar os modelos de etiqueta. ${error.message}`, 'error');
  }
  refreshTable();
}

export function openModel(row = null) {
  state.editing = row?.id ? row : null;
  fillForm(row || { name: '', is_active: true, is_default: state.models.length === 0 });
  $('#formTitulo').textContent = state.editing ? `Editar modelo — ${row.name}` : 'Novo modelo de etiqueta';
  const del = $('#btnExcluir');
  del.style.display = state.editing && !state.editing.is_default ? '' : 'none';
  Modal.open(MODAL_ID, { focusSelector: '#name' });
  renderPreview();
}

function validate(data) {
  if (!data.name) return 'Informe o nome do modelo.';
  const checks = [
    ['width_mm', 'A largura', 10, 300], ['height_mm', 'A altura', 10, 300],
    ['margin_mm', 'A margem', 0, 20], ['copies', 'As cópias', 1, 50],
    ['barcode_height_mm', 'A altura do código', 3, 200], ['barcode_width_pct', 'A largura do código', 30, 100],
  ];
  for (const [key, label, min, max] of checks) {
    const v = data[key];
    if (v === null || !Number.isFinite(v) || v < min || v > max) {
      return `${label} deve estar entre ${min} e ${max}.`;
    }
  }
  if (data.barcode_height_mm > data.height_mm - 2 * data.margin_mm) {
    return 'A altura do código é maior que o espaço útil da etiqueta (altura − 2 × margem).';
  }
  if (state.editing?.is_default && !data.is_active) {
    return 'O modelo padrão não pode ficar inativo. Defina outro modelo como padrão antes.';
  }
  return '';
}

export async function saveModel(event) {
  event?.preventDefault();
  const data = readForm();
  const error = validate(data);
  if (error) { notify(error, 'warning'); return; }

  const button = $('#btnSalvar');
  button.disabled = true;
  try {
    if (state.editing) await updateModel(state.editing.id, data);
    else await createModel(data);
    Modal.close(MODAL_ID);
    notify(state.editing ? 'Modelo atualizado com sucesso.' : 'Modelo criado com sucesso.');
    await loadModels();
  } catch (err) {
    notify(err.message || 'Não foi possível salvar o modelo.', 'error');
  } finally {
    button.disabled = false;
  }
}

export async function makeDefault(row) {
  const ok = await confirmCenter(
    `Usar "${row.name}" como modelo padrão das etiquetas de Localização?`,
    { title: 'Modelo padrão', confirmLabel: 'Definir como padrão' }
  );
  if (!ok) return;
  try {
    await setDefaultModel(row.id);
    notify(`"${row.name}" agora é o modelo padrão.`);
    await loadModels();
  } catch (err) {
    notify(err.message, 'error');
  }
}

export async function removeModel(row) {
  const target = row || state.editing;
  if (!target) return;
  const ok = await confirmCenter(
    `Excluir o modelo "${target.name}"? Esta ação não pode ser desfeita.`,
    { title: 'Excluir modelo', confirmLabel: 'Excluir' }
  );
  if (!ok) return;
  try {
    await deleteModel(target.id);
    Modal.close(MODAL_ID);
    notify('Modelo excluído.');
    await loadModels();
  } catch (err) {
    notify(err.message, 'error');
  }
}

export async function printTest() {
  const data = readForm();
  const error = validate({ ...data, name: data.name || 'Teste' });
  if (error) { notify(error, 'warning'); return; }
  try {
    await printLocationLabels([{
      barcode: $('#sampleBarcode').value.trim() || 'LOC-0001',
      label: $('#sampleLocation').value.trim(),
    }], { ...data, copies: 1 });
  } catch (err) {
    notify(err.message, 'error');
  }
}
