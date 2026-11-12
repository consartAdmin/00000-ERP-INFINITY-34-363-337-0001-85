// ╔══════════════════════════════════════════════════════════════════════╗
// ║ reportsProductsStock.filtersModal.js — Modal de filtros             ║
// ║ Fornecedor, Grupo, Subgrupo, Marca, Ativo e Custo mín./máx.         ║
// ║ "Aplicar" grava no state e recarrega; Cancelar/✕/Esc desfaz.         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { getEls } from './reportsProductsStock.dom.js';
import { state } from './reportsProductsStock.state.js';
import { resolveSupplier } from './reportsProductsStock.filters.js';

const MODAL_ID = 'filtersModal';

// Valores da tela no momento em que o modal abriu (para o Cancelar).
let snapshot = null;
let applied = false;

function takeSnapshot() {
  const els = getEls();
  return {
    fornecedor: els.txtFornecedor?.value ?? '',
    fornecedorId: els.hidFornecedorId?.value ?? '',
    grupo: els.selGrupo?.value ?? '',
    subgrupoHtml: els.selSubgrupo?.innerHTML ?? '',
    subgrupoDisabled: !!els.selSubgrupo?.disabled,
    subgrupo: els.selSubgrupo?.value ?? '',
    marca: els.selMarca?.value ?? '',
    ativo: els.selAtivo?.value ?? '1',
    custoMin: els.numCustoMin?.value ?? '',
    custoMax: els.numCustoMax?.value ?? '',
  };
}

function restoreSnapshot(snap) {
  const els = getEls();
  if (!snap) return;
  if (els.txtFornecedor) els.txtFornecedor.value = snap.fornecedor;
  if (els.hidFornecedorId) els.hidFornecedorId.value = snap.fornecedorId;
  if (els.selGrupo) els.selGrupo.value = snap.grupo;
  if (els.selSubgrupo) {
    els.selSubgrupo.innerHTML = snap.subgrupoHtml;
    els.selSubgrupo.disabled = snap.subgrupoDisabled;
    els.selSubgrupo.value = snap.subgrupo;
  }
  if (els.selMarca) els.selMarca.value = snap.marca;
  if (els.selAtivo) els.selAtivo.value = snap.ativo;
  if (els.numCustoMin) els.numCustoMin.value = snap.custoMin;
  if (els.numCustoMax) els.numCustoMax.value = snap.custoMax;
}

function clearModalFields() {
  const els = getEls();
  if (els.txtFornecedor) els.txtFornecedor.value = '';
  if (els.hidFornecedorId) els.hidFornecedorId.value = '';
  if (els.selGrupo) els.selGrupo.value = '';
  if (els.selSubgrupo) {
    els.selSubgrupo.innerHTML = '<option value="">Todos</option>';
    els.selSubgrupo.disabled = true;
  }
  if (els.selMarca) els.selMarca.value = '';
  if (els.selAtivo) els.selAtivo.value = '1';
  if (els.numCustoMin) els.numCustoMin.value = '';
  if (els.numCustoMax) els.numCustoMax.value = '';
}

// Quantos filtros do modal estão ativos (o padrão "Somente ativos" não conta).
export function updateFiltersBadge() {
  const els = getEls();
  if (!els.filtersBadge) return;

  const n = [
    state.supplier_id,
    state.group_id,
    state.subgroup_id,
    state.brand_id,
    state.active !== '1' ? 'x' : '',
    state.cost_min !== '' && state.cost_min !== null ? 'x' : '',
    state.cost_max !== '' && state.cost_max !== null ? 'x' : '',
  ].filter(Boolean).length;

  els.filtersBadge.textContent = String(n);
  els.filtersBadge.hidden = n === 0;
}

export function bindFiltersModal(loadFn) {
  const els = getEls();
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;

  Modal.setup();

  modal.addEventListener('modal:open', () => {
    snapshot = takeSnapshot();
    applied = false;
  });

  modal.addEventListener('modal:close', () => {
    if (!applied) restoreSnapshot(snapshot);
    snapshot = null;
  });

  els.btnFiltrosLimpar?.addEventListener('click', () => clearModalFields());

  els.btnFiltrosAplicar?.addEventListener('click', async () => {
    const supplierId = await resolveSupplier();

    state.supplier_id = supplierId;
    state.group_id = String(els.selGrupo?.value || '');
    state.subgroup_id = String(els.selSubgrupo?.value || '');
    state.brand_id = String(els.selMarca?.value || '');
    state.active = String(els.selAtivo?.value ?? '');
    state.cost_min = els.numCustoMin?.value === '' ? '' : Number(els.numCustoMin.value);
    state.cost_max = els.numCustoMax?.value === '' ? '' : Number(els.numCustoMax.value);
    state.page = 1;

    applied = true;
    Modal.close(MODAL_ID);
    updateFiltersBadge();
    loadFn();
  });

  // O "Limpar" do cabeçalho também zera os filtros do modal.
  els.btnLimpar?.addEventListener('click', () => updateFiltersBadge());

  updateFiltersBadge();
}
