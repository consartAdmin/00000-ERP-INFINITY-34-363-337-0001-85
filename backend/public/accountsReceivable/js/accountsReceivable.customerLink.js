// ╔══════════════════════════════════════════════════════════════════════╗
// ║ accountsReceivable.customerLink.js — Vínculo financeiro do cliente  ║
// ║ CONSART ERP                                                         ║
// ║ • Ícone 🔗 no Cliente: abre o vínculo do cliente com Categoria,     ║
// ║   Subcategoria e Plano de Contas (padrões do cadastro do cliente)   ║
// ║ • Salvar só grava o vínculo no cliente (não mexe na conta aberta)   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { showCenterModal } from './accountsReceivable.alert.js';
import {
  getChartAccount,
  getCustomer,
  updateCustomerFinancialDefaults,
} from './accountsReceivable.api.js';
import { refreshCashSubcategorySelect } from './accountsReceivable.categories.js';
import { setChartAccountPickerValue } from './accountsReceivable.chartAccountPicker.js';
import { $ } from './accountsReceivable.utils.js';
import { Modal } from './modal.js';

const MODAL_ID = 'arCustomerLinkModal';

function customerFrom(response) {
  return response?.data ?? response ?? null;
}

async function chartAccountFor(id) {
  if (!id) return null;
  try {
    const response = await getChartAccount(id);
    const account = response?.data ?? response;
    return account?.id ? account : null;
  } catch (error) {
    console.error('[accountsReceivable.customerLink] conta contábil:', error);
    return null;
  }
}

// Seleciona categoria → recarrega subcategorias → seleciona subcategoria
function setCategoryPair(categorySelector, subcategorySelector, categoryId, subcategoryId) {
  const categorySelect = $(categorySelector);
  if (!categorySelect) return;

  const hasCategory = [...categorySelect.options].some((option) => option.value === String(categoryId ?? ''));
  categorySelect.value = hasCategory ? String(categoryId ?? '') : '';
  refreshCashSubcategorySelect(categorySelector);

  const subcategorySelect = $(subcategorySelector);
  if (!subcategorySelect) return;

  const hasSubcategory = [...subcategorySelect.options].some((option) => option.value === String(subcategoryId ?? ''));
  subcategorySelect.value = hasSubcategory ? String(subcategoryId ?? '') : '';
}

async function loadCustomerDefaults(customerId) {
  const customer = customerFrom(await getCustomer(customerId));
  if (!customer) throw new Error('Cliente não encontrado.');

  return {
    customer,
    categoryId: customer.default_cash_category_id ?? '',
    subcategoryId: customer.default_cash_subcategory_id ?? '',
    chartAccount: await chartAccountFor(customer.default_chart_account_id),
  };
}

// -------------------------------------------------------------------
// MODAL
// -------------------------------------------------------------------

async function openCustomerLinkModal() {
  const customerId = $('#arCustomerId')?.value;
  const customerName = $('#arCustomerSearch')?.value || '';

  if (!customerId) {
    showCenterModal({
      type: 'warning',
      title: 'Selecione o cliente',
      message: 'Escolha o cliente antes de abrir o vínculo com Categoria, Subcategoria e Plano de Contas.',
    });
    return;
  }

  try {
    const defaults = await loadCustomerDefaults(customerId);

    $('#arLinkCustomerId').value = customerId;
    $('#arLinkCustomerName').value = customerName || defaults.customer.trade_name || defaults.customer.name || '';

    // Sem vínculo salvo: sugere o que já está preenchido na conta
    const hasLink = defaults.categoryId || defaults.chartAccount;
    setCategoryPair(
      '#arLinkCategoryId',
      '#arLinkSubcategoryId',
      hasLink ? defaults.categoryId : $('#arCategoryId')?.value,
      hasLink ? defaults.subcategoryId : $('#arSubcategoryId')?.value
    );

    if (hasLink) {
      setChartAccountPickerValue('link', defaults.chartAccount || {});
    } else {
      $('#arLinkChartAccountId').value = $('#arChartAccountId')?.value || '';
      $('#arLinkChartAccountSearch').value = $('#arChartAccountSearch')?.value || '';
    }

    $('#arLinkStatus').textContent = hasLink
      ? 'Vínculo atual do cadastro do cliente.'
      : 'O cliente ainda não tem vínculo. Os campos vieram da conta aberta.';

    Modal.open(MODAL_ID, { focusSelector: '#arLinkCategoryId' });
  } catch (error) {
    showCenterModal({ type: 'error', title: 'Erro ao carregar o cliente', message: error.message });
  }
}

async function saveCustomerLink(event) {
  event.preventDefault();

  const customerId = $('#arLinkCustomerId').value;
  const payload = {
    default_cash_category_id: $('#arLinkCategoryId').value || null,
    default_cash_subcategory_id: $('#arLinkSubcategoryId').value || null,
    default_chart_account_id: $('#arLinkChartAccountId').value || null,
  };

  const submitButton = $('#arCustomerLinkForm [type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    await updateCustomerFinancialDefaults(customerId, payload);

    Modal.close(MODAL_ID);
    showCenterModal({
      type: 'success',
      title: 'Vínculo salvo',
      message: 'Categoria, Subcategoria e Plano de Contas vinculados ao cliente.',
    });
  } catch (error) {
    showCenterModal({ type: 'error', title: 'Erro ao salvar o vínculo', message: error.message });
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

// -------------------------------------------------------------------
// API PÚBLICA
// -------------------------------------------------------------------

export function bindCustomerLink() {
  $('#btnCustomerLink')?.addEventListener('click', openCustomerLinkModal);
  $('#arCustomerLinkForm')?.addEventListener('submit', saveCustomerLink);
}
