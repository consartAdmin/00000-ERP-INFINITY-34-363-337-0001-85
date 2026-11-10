/* ╔══════════════════════════════════════════════════════════════════╗
 * ║ nfeInbox.validation.js — Validações | CONSART ERP (ESM)         ║
 * ╚══════════════════════════════════════════════════════════════════╝ */
'use strict';

import { getPeriodo } from './nfeInbox.form.js';

export function validateFilters(dom) {
  const { dataIni: start, dataFim: end } = getPeriodo(dom);
  if (start && end && start > end) return 'A data inicial não pode ser posterior à data final.';
  return null;
}

export function getSelectedRow(dom, state) {
  return state.selectedRowEl || dom.$tbody?.querySelector('tr.nfi-row-selected') || null;
}

export function validateSelectedRow(dom, state) {
  const row = getSelectedRow(dom, state);
  if (!row) return { error: 'Selecione uma NF na lista.', row: null };
  if (!row.dataset.id) return { error: 'A linha selecionada não possui um identificador válido.', row: null };
  return { error: null, row };
}

export const MANIFEST_REASON_MIN = 15;
export const MANIFEST_REASON_MAX = 255;

/** Valida operação + justificativa (obrigatória em "Operação não realizada"). */
export function validateManifest(operation, reason = '') {
  if (!operation) return 'Selecione o tipo de manifestação.';
  if (operation === 'NAO_REALIZADA') {
    const size = String(reason).trim().length;
    if (size < MANIFEST_REASON_MIN || size > MANIFEST_REASON_MAX) {
      return `Informe a justificativa com ${MANIFEST_REASON_MIN} a ${MANIFEST_REASON_MAX} caracteres (hoje: ${size}).`;
    }
  }
  return null;
}

export function validateXmlFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return { files, error: null };
  const invalid = files.find((file) => !file.name.toLowerCase().endsWith('.xml'));
  return {
    files,
    error: invalid ? `O arquivo "${invalid.name}" não é um XML.` : null,
  };
}
