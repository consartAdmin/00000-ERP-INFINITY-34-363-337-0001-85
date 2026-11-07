// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalProfile.form.js                                          ║
// ║ MODULE: Fiscal Profile — Formulário do modal                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  $, $$, formatDecimal, toNullableNumber, toNullableText, toNumber,
} from './fiscalProfile.utils.js';

const TEXT_FIELDS = [
  'profile_name', 'description', 'icms_cst', 'benefit_code',
  'cfop_entry', 'cfop_exit', 'pis_cst', 'cofins_cst',
];

/** Alíquotas obrigatórias (NOT NULL no banco). */
const RATE_FIELDS = ['icms_rate', 'icms_base_pct', 'pis_rate', 'cofins_rate', 'ipi_rate'];

/** Colunas de ST: opcionais (vazio = sem ST). */
const ST_FIELDS = ['mva_pct', 'icms_st_base_pct', 'icms_st_rate', 'icms_st_ret_base_pct', 'icms_st_ret_rate'];

const field = (id) => $(`#${id}`);
const decimalsOf = (input) => Number(input?.dataset.decimals) || 4;

function setDecimal(id, value, { nullable = false } = {}) {
  const input = field(id);
  if (!input) return;
  input.value = nullable && (value == null || value === '') ? '' : formatDecimal(value ?? 0, decimalsOf(input));
}

export function getProfileForm() {
  return $('#formFiscalProfile');
}

/** Formata as alíquotas com casas fixas ao sair do campo (1,65 → 1,6500). */
export function bindDecimalInputs() {
  $$('#formFiscalProfile input[data-decimals]').forEach((input) => {
    input.addEventListener('blur', () => {
      if (input.hasAttribute('data-nullable') && !input.value.trim()) return;
      input.value = formatDecimal(input.value, decimalsOf(input));
    });
    input.addEventListener('focus', () => input.select());
  });
}

function setToggleButton(row) {
  const button = $('#btnToggleActive');
  if (!button) return;
  const show = !!row?.fiscal_profile_id;
  button.style.display = show ? '' : 'none';
  if (!show) return;
  const active = row.is_active !== false;
  button.textContent = active ? '⏸ Desativar' : '▶ Reativar';
  button.className = `btn ${active ? 'btn-danger' : 'btn-new'} btn-sm btn-position-left`;
}

/** Preenche o modal. row = null → novo; copy = true → duplicar (sem ID). */
export function fillProfileForm(row = null, { copy = false } = {}) {
  const form = getProfileForm();
  if (!form) return;
  form.reset();

  const data = row || {};
  const isEdit = !!data.fiscal_profile_id && !copy;

  field('fiscal_profile_id').value = isEdit ? data.fiscal_profile_id : '';
  TEXT_FIELDS.forEach((id) => {
    const input = field(id);
    if (input) input.value = data[id] ?? '';
  });
  if (copy && data.profile_name) field('profile_name').value = `${data.profile_name} (cópia)`;

  field('origin_code').value = data.origin_code == null ? '' : String(data.origin_code);
  field('is_active').value = String(copy ? true : data.is_active !== false);
  RATE_FIELDS.forEach((id) => setDecimal(id, data[id] ?? (id === 'icms_base_pct' ? 100 : 0)));
  ST_FIELDS.forEach((id) => setDecimal(id, data[id], { nullable: true }));

  const title = $('#formTitulo');
  if (title) {
    if (isEdit) title.textContent = `Editar perfil fiscal #${data.fiscal_profile_id} — ${data.profile_name || ''}`;
    else if (copy) title.textContent = 'Duplicar perfil fiscal';
    else title.textContent = 'Novo perfil fiscal';
  }
  setToggleButton(isEdit ? data : null);
}

export function readProfileForm() {
  const value = (id) => field(id)?.value;
  const id = value('fiscal_profile_id');

  const payload = {
    profile_name: String(value('profile_name') || '').trim(),
    origin_code: toNullableText(value('origin_code')),
    is_active: value('is_active') !== 'false',
  };
  TEXT_FIELDS.filter((key) => key !== 'profile_name')
    .forEach((key) => { payload[key] = toNullableText(value(key)); });
  RATE_FIELDS.forEach((key) => { payload[key] = toNumber(value(key), key === 'icms_base_pct' ? 100 : 0); });
  ST_FIELDS.forEach((key) => { payload[key] = toNullableNumber(value(key)); });

  return { id: id ? Number(id) : null, payload };
}
