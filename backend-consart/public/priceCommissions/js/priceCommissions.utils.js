// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.utils.js — Utilitários | CONSART ERP               ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

/** Avisos no centerAlertModal (padrão CONSART). */
export function notify(message, type = 'success') {
  const variant = ['error', 'warning'].includes(type) ? type : 'success';
  if (variant === 'error') console.error('[priceCommissions]', message);
  showCenterModal({
    variant,
    title: variant === 'error' ? 'Erro' : (variant === 'warning' ? 'Atenção' : 'Comissões'),
    message: String(message ?? ''),
    timeoutMs: variant === 'success' ? 2500 : undefined
  });
}

/** Mantido para compatibilidade: erros vão para o centerAlertModal. */
export function showToast(message) {
  notify(message, 'error');
}

/** Confirmação no centerAlertModal. Resolve true/false. */
export async function confirmCenter(message, { title = 'Confirmar', confirmLabel = 'Excluir' } = {}) {
  const button = await showCenterModal({
    variant: 'warning',
    title,
    message: String(message ?? ''),
    timeoutMs: null,
    buttons: [
      { label: 'Cancelar', variant: 'cancel' },
      { label: confirmLabel, variant: 'confirm' }
    ]
  });
  return String(button?.variant || '').toLowerCase() === 'confirm';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatCommissionType(type) {
  return type === 'FIXED' ? 'Fixo (R$)' : 'Percentual (%)';
}

export function formatCommissionValue(row = {}) {
  if (row.commission_type === 'FIXED') {
    return Number(row.fixed_value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  return `${Number(row.percent_value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })}%`;
}

/** aaaa-mm-dd → dd/mm/aaaa (sem fuso). */
export function formatDateBR(value) {
  const ymd = value ? String(value).slice(0, 10) : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function todayYmd() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function fillSelect(
  select,
  rows,
  { valueKey, labelKey, firstLabel = 'Todos' } = {}
) {
  if (!select) return;

  select.innerHTML = '';

  if (firstLabel !== null) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = firstLabel;
    select.appendChild(option);
  }

  for (const row of rows || []) {
    const option = document.createElement('option');
    option.value = row[valueKey];
    option.textContent = row[labelKey];
    select.appendChild(option);
  }
}

