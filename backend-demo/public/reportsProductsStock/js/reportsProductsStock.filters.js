// ╔══════════════════════════════════════════════════════════════════════╗
// ║ reportsProductsStock.filters.js — Filtros                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { getEls } from './reportsProductsStock.dom.js';
import { debounce, sanitize } from './reportsProductsStock.utils.js';
import { state } from './reportsProductsStock.state.js';
import {
  loadSuppliersSuggest,
  loadSubgroups,
} from './reportsProductsStock.lookups.js';

export function clearFiltersUI() {
  const els = getEls();

  if (els.txtBusca) els.txtBusca.value = '';
  if (els.txtFornecedor) els.txtFornecedor.value = '';
  if (els.hidFornecedorId) els.hidFornecedorId.value = '';
  if (els.selGrupo) els.selGrupo.value = '';
  if (els.selSubgrupo) {
    els.selSubgrupo.value = '';
    els.selSubgrupo.disabled = true;
    els.selSubgrupo.innerHTML = '<option value="">Todos</option>';
  }
  if (els.selMarca) els.selMarca.value = '';
  if (els.chkOnlyStock) els.chkOnlyStock.checked = false;
  if (els.selAtivo) els.selAtivo.value = '1';
  if (els.numCustoMin) els.numCustoMin.value = '';
  if (els.numCustoMax) els.numCustoMax.value = '';
  if (els.apRowsPerPage) els.apRowsPerPage.value = '50';
}

export function bindFilters(loadFn) {
  const els = getEls();

  if (els.txtBusca) {
    const run = debounce(() => {
      state.q = (els.txtBusca.value || '').trim();
      state.page = 1;
      loadFn();
    }, 350);
    els.txtBusca.addEventListener('input', run);
  }

  els.btnBuscar?.addEventListener('click', () => {
    state.q = (els.txtBusca?.value || '').trim();
    state.page = 1;
    loadFn();
  });

  els.btnLimpar?.addEventListener('click', () => {
    clearFiltersUI();

    state.page = 1;
    state.limit = 50;
    state.q = '';
    state.order = 'description_asc';
    state.supplier_id = '';
    state.group_id = '';
    state.subgroup_id = '';
    state.brand_id = '';
    state.only_stock = false;
    state.active = '1';
    state.cost_min = '';
    state.cost_max = '';

    loadFn();
  });

  // Campos do modal de filtros: só preparam a tela; o state muda no "Aplicar"
  // (ver reportsProductsStock.filtersModal.js).
  if (els.txtFornecedor && els.dlFornecedores && els.hidFornecedorId) {
    const suggest = debounce(async () => {
      const q = (els.txtFornecedor.value || '').trim();
      if (q.length < 2) {
        els.dlFornecedores.innerHTML = '';
        return;
      }

      const list = await loadSuppliersSuggest(q);
      els.dlFornecedores.innerHTML = list
        .map(s => `<option value="${sanitize(s.name)}"></option>`)
        .join('');
    }, 250);

    els.txtFornecedor.addEventListener('input', () => {
      els.hidFornecedorId.value = '';
      suggest();
    });

    els.txtFornecedor.addEventListener('change', () => { resolveSupplier(); });
  }

  if (els.selGrupo && els.selSubgrupo) {
    els.selGrupo.addEventListener('change', async () => {
      const gid = String(els.selGrupo.value || '');

      els.selSubgrupo.innerHTML = '<option value="">Todos</option>';
      els.selSubgrupo.disabled = true;

      if (gid) {
        const subs = await loadSubgroups(gid);
        els.selSubgrupo.innerHTML =
          '<option value="">Todos</option>' +
          subs.map(s => `<option value="${sanitize(s.id)}">${sanitize(s.name)}</option>`).join('');
        els.selSubgrupo.disabled = false;
      }
    });
  }

  els.chkOnlyStock?.addEventListener('change', () => {
    state.only_stock = !!els.chkOnlyStock.checked;
    state.page = 1;
    loadFn();
  });
}

// Localiza o id do fornecedor digitado (nome exato da lista de sugestões).
export async function resolveSupplier() {
  const els = getEls();
  if (!els.txtFornecedor || !els.hidFornecedorId) return '';

  const q = (els.txtFornecedor.value || '').trim();
  if (!q) {
    els.hidFornecedorId.value = '';
    return '';
  }
  if (els.hidFornecedorId.value) return els.hidFornecedorId.value;

  const list = await loadSuppliersSuggest(q);
  const found = list.find(x => (x.name || '').toLowerCase() === q.toLowerCase()) || null;
  els.hidFornecedorId.value = found?.id != null ? String(found.id) : '';
  return els.hidFornecedorId.value;
}
