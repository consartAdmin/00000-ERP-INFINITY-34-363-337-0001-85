// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.modal.js — Controle do modal | CONSART ERP         ║
// ║ Modal global (modals.css + modal.js): ESC, backdrop e               ║
// ║ [data-modal-close] já são tratados pelo Modal.setup().              ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { dom } from './priceCommissions.config.js';
import { state } from './priceCommissions.state.js';
import { syncCommissionTypeFields } from './priceCommissions.form.js';
import { fillSelect, todayYmd } from './priceCommissions.utils.js';

function setDateValue(input, value) {
  input.value = value ? String(value).slice(0, 10) : '';
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setupPriceCommissionModal() {
  Modal.setup();
}

/**
 * Abre o modal.
 * @param {object|null} row  Regra a editar (null = nova)
 * @param {{ duplicate?: boolean }} options
 */
export function openPriceCommissionModal(row = null, { duplicate = false } = {}) {
  const editing = Boolean(row?.commission_id) && !duplicate;

  dom.commission_id.value = editing ? row.commission_id : '';
  dom.mTitle.textContent = editing
    ? `Editar comissão #${row.commission_id}`
    : (duplicate ? `Duplicar comissão #${row.commission_id}` : 'Nova comissão');

  dom.btnDelete.hidden = !editing;
  dom.btnDelete.style.display = editing ? '' : 'none';

  fillSelect(dom.price_id, state.prices, {
    valueKey: 'price_id',
    labelKey: 'name',
    firstLabel: 'Selecione...'
  });

  fillSelect(dom.seller_id, state.sellers, {
    valueKey: 'id',
    labelKey: 'name',
    firstLabel: 'Selecione...'
  });

  dom.price_id.value = row?.price_id ?? '';
  dom.seller_id.value = row?.seller_id ?? '';
  dom.commission_type.value = row?.commission_type ?? 'PERCENT';
  dom.percent_value.value = Number(row?.percent_value ?? 0);
  dom.fixed_value.value = Number(row?.fixed_value ?? 0);
  dom.active.value = String(row?.active ?? true);

  setDateValue(dom.valid_from, duplicate ? todayYmd() : (row?.valid_from || todayYmd()));
  setDateValue(dom.valid_to, duplicate ? '' : row?.valid_to);

  syncCommissionTypeFields();

  Modal.open(dom.modal, { focusSelector: '#price_id' });
}

export function closePriceCommissionModal() {
  Modal.close(dom.modal);
}
