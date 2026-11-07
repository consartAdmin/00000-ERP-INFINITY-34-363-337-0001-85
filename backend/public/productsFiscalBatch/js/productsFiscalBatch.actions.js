// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsFiscalBatch.actions.js                               ║
// ║ MODULE: Products Fiscal Batch — Actions                            ║
// ║ CONSART ERP                                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { Modal } from '/public/includes/js/modal.js';
import { openFiscalClassificationModal } from '/public/modalsSearch/fiscalClassificationModalSearch.js';

import {
  linkProductsFiscal,
  listProducts,
  unlinkProductFiscal,
} from './productsFiscalBatch.api.js';
import { API_BASE } from './productsFiscalBatch.config.js';
import { buildListParams } from './productsFiscalBatch.filters.js';
import {
  clearSelection,
  isLinked,
  refreshSelectedFromRows,
  updateSelectionSummary,
} from './productsFiscalBatch.products.js';
import {
  renderLoadingRow,
  renderPagination,
  renderProducts,
  setLoading,
} from './productsFiscalBatch.render.js';
import { dom, state } from './productsFiscalBatch.state.js';
import { escapeHtml, getErrorMessage } from './productsFiscalBatch.utils.js';

const LINK_MODAL_ID = 'pfb-link-modal';

// Produtos que o modal de vínculo vai gravar (lote selecionado ou um produto da linha).
let linkTargets = [];

const handlers = {
  onLink: (product) => openLinkModal([toTarget(product)]),
  onUnlink: (products) => unlinkProducts(products.map(toTarget)),
};

function toTarget(product) {
  return {
    id: product.product_id ?? product.id,
    code: String(product.product_code ?? product.code ?? '').trim(),
    description: product.product_description ?? product.description ?? '',
    linked: product.linked ?? isLinked(product),
  };
}

function errorMessage(error, fallback) {
  const message = escapeHtml(getErrorMessage(error, fallback));
  const requestId = error?.requestId || error?.request_id;
  return requestId
    ? `${message}<br><br><small>Referência da requisição: <strong>${escapeHtml(requestId)}</strong></small>`
    : message;
}

function describeTargets(targets, max = 3) {
  const names = targets.slice(0, max).map((item) => `${item.code} — ${item.description}`.trim());
  const rest = targets.length - names.length;
  return rest > 0 ? `${names.join(' · ')} · +${rest} produto(s)` : names.join(' · ');
}

// ============================================================================
// LISTAGEM
// ============================================================================

export async function loadProducts({ force = false } = {}) {
  if (state.loading && !force) return false;

  setLoading(true);
  if (!state.products.length) renderLoadingRow();

  try {
    let result = await listProducts(buildListParams());
    let totalPages = Math.max(1, Math.ceil(result.total / state.pageSize));

    // A página atual deixou de existir depois de um filtro/vínculo: volta para a última.
    if (state.page > totalPages) {
      state.page = totalPages;
      result = await listProducts(buildListParams());
      totalPages = Math.max(1, Math.ceil(result.total / state.pageSize));
    }

    state.products = result.rows;
    state.total = result.total;
    state.totalPages = totalPages;
    state.linkedTotal = result.linkedTotal;
    state.unlinkedTotal = result.unlinkedTotal;

    refreshSelectedFromRows();
    renderProducts(handlers);
    return true;
  } catch (error) {
    console.error('[ProductsFiscalBatch] Erro ao buscar produtos.', error);

    state.products = [];
    state.total = 0;
    state.totalPages = 1;
    state.linkedTotal = 0;
    state.unlinkedTotal = 0;
    renderProducts(handlers);

    showCenterModal({
      variant: 'error',
      title: 'Erro ao buscar produtos',
      message: errorMessage(error, 'Não foi possível consultar os produtos.'),
    });
    return false;
  } finally {
    setLoading(false);
    renderPagination();
  }
}

// ============================================================================
// MODAL DE VÍNCULO
// ============================================================================

function setClassification(classification) {
  state.classification = classification;

  if (dom.classificationName) dom.classificationName.value = classification?.name || '';
  if (dom.classificationNcm) dom.classificationNcm.value = classification?.ncm || '';
  if (dom.classificationCest) dom.classificationCest.value = classification?.cest || '';
  if (dom.classificationProfile) {
    dom.classificationProfile.value = classification
      ? (classification.profileName || 'Sem perfil fiscal na classificação')
      : '';
  }
}

export function openLinkModal(targets = null) {
  linkTargets = targets || [...state.selected.values()];

  if (!linkTargets.length) {
    showCenterModal({
      variant: 'warning',
      title: 'Nenhum produto selecionado',
      message: 'Marque ao menos um produto na lista para vincular.',
    });
    return;
  }

  const count = linkTargets.length;
  if (dom.linkCount) {
    dom.linkCount.textContent = `${count} produto${count === 1 ? '' : 's'} selecionado${count === 1 ? '' : 's'}`;
  }
  if (dom.linkProducts) {
    dom.linkProducts.value = describeTargets(linkTargets);
    dom.linkProducts.title = linkTargets.map((item) => `${item.code} — ${item.description}`).join('\n');
  }

  setClassification(null);
  Modal.open(LINK_MODAL_ID, { focusSelector: '#pfb-pick-classification' });
}

export function pickClassification() {
  openFiscalClassificationModal({
    apiBase: API_BASE,
    onPick(row) {
      setClassification({
        id: row.fiscal_classification_id ?? row.id,
        name: row.classification_name ?? row.description ?? '',
        ncm: row.ncm_code ?? row.ncm ?? '',
        cest: row.cest_code ?? row.cest ?? '',
        profileName: row.profile_name ?? row.profile_description ?? '',
      });
    },
  });
}

function setApplying(applying) {
  if (!dom.applyButton) return;
  dom.applyButton.disabled = applying;
  dom.applyButton.textContent = applying ? 'Aplicando...' : '🔗 Aplicar vínculo';
}

export async function applyBatchLink() {
  if (!state.classification?.id) {
    showCenterModal({
      variant: 'warning',
      title: 'Classificação fiscal obrigatória',
      message: 'Clique em <strong>Selecionar classificação</strong> e escolha o NCM/CEST.',
    });
    return;
  }

  const codes = linkTargets.map((item) => item.code).filter(Boolean);
  if (!codes.length) return;

  setApplying(true);

  try {
    await linkProductsFiscal({
      product_codes: codes,
      fiscal_classification_id: Number(state.classification.id),
      source_system: 'productsFiscalBatch',
    });

    Modal.close(LINK_MODAL_ID);
    codes.forEach((code) => state.selected.delete(code));
    updateSelectionSummary();
    await loadProducts({ force: true });

    showCenterModal({
      variant: 'success',
      title: 'Vínculo aplicado',
      message: `Classificação <strong>${escapeHtml(state.classification.name)}</strong> ` +
        `vinculada a ${codes.length} produto(s).`,
    });
  } catch (error) {
    console.error('[ProductsFiscalBatch] Erro ao aplicar vínculo.', error);
    showCenterModal({
      variant: 'error',
      title: 'Erro ao aplicar vínculo',
      message: errorMessage(error, 'Não foi possível aplicar o vínculo.'),
    });
  } finally {
    setApplying(false);
  }
}

// ============================================================================
// DESVINCULAR (uma linha ou os selecionados)
// ============================================================================

export function unlinkSelected() {
  return unlinkProducts([...state.selected.values()]);
}

async function unlinkProducts(targets) {
  const linked = targets.filter((item) => item.linked && item.code);

  if (!linked.length) {
    showCenterModal({
      variant: 'info',
      title: 'Nada para desvincular',
      message: 'Os produtos selecionados não têm vínculo fiscal.',
    });
    return;
  }

  const confirmed = await showCenterModal({
    variant: 'warning',
    title: 'Desvincular classificação fiscal',
    message: linked.length === 1
      ? `Remover o vínculo fiscal do produto <strong>${escapeHtml(linked[0].code)}</strong> — ${escapeHtml(linked[0].description)}?`
      : `Remover o vínculo fiscal de <strong>${linked.length}</strong> produtos selecionados?`,
    okText: 'Sim, desvincular',
    closeText: 'Cancelar',
  });

  if (confirmed !== true) return;

  const failures = [];
  dom.unlinkSelectedButton && (dom.unlinkSelectedButton.disabled = true);

  for (const item of linked) {
    try {
      await unlinkProductFiscal(item.code);
      state.selected.delete(item.code);
    } catch (error) {
      console.error('[ProductsFiscalBatch] Erro ao desvincular.', item.code, error);
      failures.push(`${item.code}: ${getErrorMessage(error, 'erro')}`);
    }
  }

  updateSelectionSummary();
  await loadProducts({ force: true });

  const done = linked.length - failures.length;

  if (failures.length) {
    showCenterModal({
      variant: 'error',
      title: 'Alguns produtos não foram desvinculados',
      message: `${done} desvinculado(s), ${failures.length} com erro:<br>${failures.map(escapeHtml).join('<br>')}`,
    });
    return;
  }

  showCenterModal({
    variant: 'success',
    title: 'Vínculo removido',
    message: done === 1
      ? `Vínculo fiscal removido do produto ${escapeHtml(linked[0].code)}.`
      : `Vínculo fiscal removido de ${done} produtos.`,
  });
}

export { clearSelection };
