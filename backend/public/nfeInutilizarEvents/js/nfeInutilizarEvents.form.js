// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfeInutilizarEvents.form.js — Formulário de nova inutilização       ║
// ║ MODULE: NF-e Inutilização de Numeração                              ║
// ║ CONSART ERP                                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { RULES } from './nfeInutilizarEvents.config.js';
import {
  $, formatCnpj, onlyDigits, plural, toInt,
} from './nfeInutilizarEvents.utils.js';

export const getForm = () => $('#formInutilizacao');

export function buildPayload() {
  return {
    companyCnpj: onlyDigits($('#companyCnpj')?.value),
    model: String($('#model')?.value || '55'),
    serie: toInt($('#serie')?.value, -1),
    numberStart: toInt($('#numberStart')?.value, 0),
    numberEnd: toInt($('#numberEnd')?.value, 0),
    year: toInt($('#year')?.value, 0),
    justification: String($('#justification')?.value || '').trim(),
  };
}

export function validatePayload(payload) {
  const errors = [];
  if (payload.companyCnpj.length !== RULES.CNPJ_LENGTH) errors.push('Informe um CNPJ válido com 14 dígitos.');
  if (payload.serie < 0) errors.push('Informe a série.');
  if (payload.numberStart < 1) errors.push('Informe o número inicial.');
  if (payload.numberEnd < 1) errors.push('Informe o número final.');
  if (payload.numberStart && payload.numberEnd && payload.numberEnd < payload.numberStart) {
    errors.push('O número final não pode ser menor que o inicial.');
  }
  if (payload.year < RULES.MIN_YEAR) errors.push('Informe o ano.');
  const size = payload.justification.length;
  if (size < RULES.MIN_JUSTIFICATION || size > RULES.MAX_JUSTIFICATION) {
    errors.push(`A justificativa deve ter entre ${RULES.MIN_JUSTIFICATION} e ${RULES.MAX_JUSTIFICATION} caracteres.`);
  }
  return errors;
}

export function updateSummary() {
  const start = toInt($('#numberStart')?.value, 0);
  const end = toInt($('#numberEnd')?.value, 0);
  const total = start > 0 && end >= start ? end - start + 1 : 0;

  const range = $('#summaryRange');
  if (range) range.textContent = total ? `Faixa: ${start === end ? start : `${start} a ${end}`}` : 'Faixa: —';
  const count = $('#summaryTotal');
  if (count) count.textContent = plural(total, 'número', 'números');
}

export function updateJustificationCounter() {
  const counter = $('#justificationCounter');
  if (!counter) return;
  const size = ($('#justification')?.value || '').trim().length;
  counter.textContent = `${size} / ${RULES.MAX_JUSTIFICATION} · mínimo ${RULES.MIN_JUSTIFICATION}`;
  counter.classList.toggle('summary-pill--warning', size < RULES.MIN_JUSTIFICATION);
  counter.classList.toggle('summary-pill--success', size >= RULES.MIN_JUSTIFICATION);
}

/** Preenche o formulário (nova em branco ou usando um registro como modelo). */
export function fillForm(base = {}) {
  getForm()?.reset();
  const set = (selector, value) => { const el = $(selector); if (el) el.value = value ?? ''; };
  set('#companyCnpj', formatCnpj(base.companyCnpj || ''));
  set('#model', String(base.model || '55'));
  set('#serie', base.serie ?? '1');
  set('#year', base.year || new Date().getFullYear());
  set('#numberStart', base.numberStart ?? '');
  set('#numberEnd', base.numberEnd ?? '');
  set('#justification', base.justification || '');
  updateSummary();
  updateJustificationCounter();
}

export function bindFormInputs() {
  const cnpj = $('#companyCnpj');
  cnpj?.addEventListener('input', () => { cnpj.value = formatCnpj(cnpj.value); });
  ['#serie', '#year', '#numberStart', '#numberEnd', '#filtroSerie', '#filtroAno', '#filtroNumero'].forEach((selector) => {
    const input = $(selector);
    input?.addEventListener('input', () => { input.value = onlyDigits(input.value); });
  });
  $('#numberStart')?.addEventListener('input', updateSummary);
  $('#numberEnd')?.addEventListener('input', updateSummary);
  $('#justification')?.addEventListener('input', updateJustificationCounter);
}
