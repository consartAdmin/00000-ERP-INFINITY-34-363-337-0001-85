// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntries.classification.js — Plano de contas + Categoria +    ║
// ║ Subcategoria (CONSART ERP)                                           ║
// ║ Os valores são gravados na movimentação do Caixa ligada à entrada   ║
// ║ (chart_account_id, category e subcategory, como na tela Caixa).     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { createCashCategoryPair } from '/public/includes/js/cashCategorySelects.js';
import { openChartAccountsModalSearch } from '/public/modalsSearch/chartAccountsModalSearch.js';
import { $, toast } from './expenseEntries.utils.js';

let categoryPair = null;

function setChartAccount({ id = '', label = '' } = {}) {
  $('#chartAccountId').value = id ? String(id) : '';
  $('#chartAccountLabel').value = id ? label : '';
}

async function pickChartAccount() {
  try {
    const account = await openChartAccountsModalSearch({ onlyPosting: true, onlyActive: true });
    if (!account) return;
    setChartAccount({ id: account.id, label: `${account.code ?? ''} - ${account.description ?? ''}` });
  } catch (error) {
    toast(`Não foi possível abrir a busca de contas contábeis: ${error.message}`, 'error');
  }
}

export function setupClassification() {
  const categorySelect = $('#cashCategory');
  if (!categorySelect) return;

  categoryPair = createCashCategoryPair({
    categorySelect,
    subcategorySelect: $('#cashSubcategory'),
  });

  $('#btnSearchChartAccount')?.addEventListener('click', pickChartAccount);
  $('#chartAccountLabel')?.addEventListener('dblclick', pickChartAccount);
  $('#btnClearChartAccount')?.addEventListener('click', () => setChartAccount());
}

export function resetClassification() {
  setChartAccount();
  categoryPair?.reset();
}

// Edição: preenche a partir da movimentação do Caixa (nomes de categoria/subcategoria).
export async function fillClassification(movement = {}) {
  const chartId = movement.chart_account_id ?? null;
  setChartAccount({
    id: chartId,
    label: chartId ? `${movement.chart_account_code ?? ''} - ${movement.chart_account_description ?? ''}` : '',
  });

  if (!categoryPair) return;
  await categoryPair.setValue({ categoryName: movement.category || movement.categoria || '' });

  const subName = String(movement.subcategory || movement.subcategoria || '').trim().toLowerCase();
  const sub = $('#cashSubcategory');
  if (subName && sub) {
    const match = [...sub.options].find((o) => o.value && o.text.trim().toLowerCase() === subName);
    if (match) sub.value = match.value;
  }
}

// Payload com os nomes (o Caixa grava category/subcategory em texto).
export function readClassification() {
  const payload = categoryPair?.getPayload() || {};
  const sub = $('#cashSubcategory');
  const subOption = sub?.value ? sub.selectedOptions[0] : null;
  const chartId = $('#chartAccountId').value;
  return {
    chart_account_id: chartId ? Number(chartId) : null,
    categoria: payload.category || null,
    subcategoria: subOption ? subOption.text.trim() : null,
  };
}
