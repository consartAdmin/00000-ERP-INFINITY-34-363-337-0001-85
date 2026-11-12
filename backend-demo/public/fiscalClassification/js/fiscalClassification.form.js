// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalClassification.form.js                                 ║
// ║ MODULE: Fiscal Classification — Formulário do modal                ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { RATES_2026 } from './fiscalClassification.config.js';
import {
  $, $$, formatCest, formatDecimal, formatNcm, toNullableText, toNumber,
} from './fiscalClassification.utils.js';

const RATE_FIELDS = ['ibs_uf_rate', 'ibs_municipal_rate', 'cbs_rate', 'is_rate', 'is_specific_rate'];

const TEXT_FIELDS = [
  'classification_name', 'description', 'ncm_code', 'ex_tipi', 'cest_code',
  'ncm_description', 'cest_description', 'is_cst', 'is_classification',
  'ibscbs_cst', 'ibscbs_classification',
];

const field = (id) => $(`#${id}`);
const decimalsOf = (input) => Number(input?.dataset.decimals) || 4;

function setRate(id, value) {
  const input = field(id);
  if (input) input.value = formatDecimal(value ?? 0, decimalsOf(input));
}

export function getClassificationForm() {
  return $('#formFiscalClassification');
}

/** Formata as alíquotas com casas fixas ao sair do campo (0,1 → 0,1000). */
export function bindDecimalInputs() {
  $$('#formFiscalClassification input[data-decimals]').forEach((input) => {
    input.addEventListener('blur', () => {
      input.value = formatDecimal(input.value, decimalsOf(input));
    });
    input.addEventListener('focus', () => input.select());
  });
  field('ncm_code')?.addEventListener('blur', (event) => { event.target.value = formatNcm(event.target.value); });
  field('cest_code')?.addEventListener('blur', (event) => { event.target.value = formatCest(event.target.value); });
}

export function applyRates2026() {
  Object.entries(RATES_2026).forEach(([id, value]) => setRate(id, value));
}

function setToggleButton(row) {
  const button = $('#btnToggleActive');
  if (!button) return;
  const show = !!row?.fiscal_classification_id;
  button.style.display = show ? '' : 'none';
  if (!show) return;
  const active = row.is_active !== false;
  button.textContent = active ? '⏸ Desativar' : '▶ Reativar';
  button.className = `btn ${active ? 'btn-danger' : 'btn-new'} btn-sm btn-position-left`;
}

/**
 * Preenche o modal. row = null → nova; copy = true → duplicar (sem ID).
 */
export function fillClassificationForm(row = null, { copy = false } = {}) {
  const form = getClassificationForm();
  if (!form) return;
  form.reset();

  const data = row || {};
  const isEdit = !!data.fiscal_classification_id && !copy;

  field('fiscal_classification_id').value = isEdit ? data.fiscal_classification_id : '';
  TEXT_FIELDS.forEach((id) => {
    const input = field(id);
    if (input) input.value = data[id] ?? '';
  });
  if (copy && data.classification_name) {
    field('classification_name').value = `${data.classification_name} (cópia)`;
  }
  field('ncm_code').value = formatNcm(data.ncm_code);
  field('cest_code').value = formatCest(data.cest_code);
  field('is_unit').value = data.is_unit || 'UN';
  field('fiscal_profile_id').value = data.fiscal_profile_id == null ? '' : String(data.fiscal_profile_id);
  field('donation_indicator').value = String(data.donation_indicator ?? 1);
  field('is_active').value = String(copy ? true : data.is_active !== false);
  RATE_FIELDS.forEach((id) => setRate(id, data[id]));

  const title = $('#formTitulo');
  if (title) {
    if (isEdit) title.textContent = `Editar classificação #${data.fiscal_classification_id} — ${data.classification_name || ''}`;
    else if (copy) title.textContent = 'Duplicar classificação';
    else title.textContent = 'Nova classificação';
  }
  setToggleButton(isEdit ? data : null);
}

export function readClassificationForm() {
  const value = (id) => field(id)?.value;
  const id = value('fiscal_classification_id');

  return {
    id: id ? Number(id) : null,
    payload: {
      classification_name: String(value('classification_name') || '').trim(),
      description: toNullableText(value('description')),
      ncm_code: toNullableText(value('ncm_code')),
      ex_tipi: toNullableText(value('ex_tipi')),
      cest_code: toNullableText(value('cest_code')),
      ncm_description: toNullableText(value('ncm_description')),
      cest_description: toNullableText(value('cest_description')),
      fiscal_profile_id: value('fiscal_profile_id') ? Number(value('fiscal_profile_id')) : null,
      is_cst: toNullableText(value('is_cst')),
      is_classification: toNullableText(value('is_classification')),
      is_rate: toNumber(value('is_rate')),
      is_specific_rate: toNumber(value('is_specific_rate')),
      is_unit: toNullableText(value('is_unit')) || 'UN',
      ibscbs_cst: toNullableText(value('ibscbs_cst')),
      ibscbs_classification: toNullableText(value('ibscbs_classification')),
      ibs_uf_rate: toNumber(value('ibs_uf_rate')),
      ibs_municipal_rate: toNumber(value('ibs_municipal_rate')),
      cbs_rate: toNumber(value('cbs_rate')),
      donation_indicator: Number(value('donation_indicator') ?? 1),
      is_active: value('is_active') !== 'false',
    },
  };
}
