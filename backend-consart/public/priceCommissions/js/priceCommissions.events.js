// ╔══════════════════════════════════════════════════════════════════════╗
// ║ priceCommissions.events.js — Eventos do módulo | CONSART ERP        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { dom } from './priceCommissions.config.js';
import {
  changePageSize,
  clearAndSearchPriceCommissions,
  duplicatePriceCommission,
  editPriceCommission,
  goToPage,
  newPriceCommission,
  removeCurrentPriceCommission,
  removePriceCommission,
  savePriceCommission,
  searchPriceCommissions
} from './priceCommissions.actions.js';
import { syncCommissionTypeFields } from './priceCommissions.form.js';
import { showToast } from './priceCommissions.utils.js';

let eventsBound = false;

export function runAsync(action) {
  Promise.resolve()
    .then(action)
    .catch((error) => {
      console.error('[priceCommissions]', error);
      showToast(error.message || 'Não foi possível concluir a operação.');
    });
}

export function bindPriceCommissionEvents() {
  if (eventsBound) return;
  eventsBound = true;

  const search = () => runAsync(() => searchPriceCommissions({ resetOffset: true }));

  dom.btnSearch.addEventListener('click', search);
  dom.fQ.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); search(); }
  });
  [dom.fPrice, dom.fSeller, dom.fActive].forEach((select) => select.addEventListener('change', search));

  dom.btnClear.addEventListener('click', () => runAsync(clearAndSearchPriceCommissions));
  dom.btnNew.addEventListener('click', newPriceCommission);

  dom.btnPrevious.addEventListener('click', () => runAsync(() => goToPage(-1)));
  dom.btnNext.addEventListener('click', () => runAsync(() => goToPage(1)));
  dom.pageSize.addEventListener('change', () => runAsync(() => changePageSize(dom.pageSize.value)));

  dom.commission_type.addEventListener('change', syncCommissionTypeFields);

  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    runAsync(() => savePriceCommission(event));
  });

  dom.btnDelete.addEventListener('click', () => runAsync(removeCurrentPriceCommission));

  // Clique na linha = editar; ícones = ação específica
  dom.tbody.addEventListener('click', (event) => {
    const tr = event.target?.closest('tr[data-id]');
    if (!tr) return;

    const button = event.target.closest('[data-action]');
    const id = Number(button?.dataset.id || tr.dataset.id);
    const action = button?.dataset.action || 'edit';

    if (action === 'copy') duplicatePriceCommission(id);
    else if (action === 'delete') runAsync(() => removePriceCommission(id));
    else editPriceCommission(id);
  });
}
