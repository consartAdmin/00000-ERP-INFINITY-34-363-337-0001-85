/* ╔══════════════════════════════════════════════════════════════════╗
   ║ inboundInvoices.quickUnit.js — Nova unidade pelo item da NF-e    ║
   ║ CONSART ERP | Frontend (ESM)                                     ║
   ║                                                                  ║
   ║ Ícone "+" ao lado do select de U.M (item já vinculado):          ║
   ║ abre #quickUnitModal e grava a unidade no produto pelo mesmo     ║
   ║ POST /api/barcodes da aba Unidades do cadastro. A unidade nova   ║
   ║ já fica selecionada no item.                                     ║
   ╚══════════════════════════════════════════════════════════════════╝ */

'use strict';

import { clearProductUnitsCache } from './inboundInvoices.api.js';

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function numberOrNull(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function formatFator(value) {
  return positiveOr(value, 1).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

// Mesmo código automático da aba Unidades (editProducts/js/tabUnits.js):
// 2 + SKU(6) + unidade(2) + fator×10(3) + dígito do EAN-13.
function buildAutoBarcode({ sku, unitId, fator }) {
  const skuDigits = onlyDigits(sku).padStart(6, '0').slice(-6);
  const unitDigits = onlyDigits(unitId).padStart(2, '0').slice(-2);
  const fatorDigits = String(Math.round(positiveOr(fator, 1) * 10)).padStart(3, '0').slice(-3);
  const base12 = `2${skuDigits}${unitDigits}${fatorDigits}`;

  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return `${base12}${(10 - (sum % 10)) % 10}`;
}

export function initQuickUnit({ core, ROUTES, state, refs }) {
  const modal = core.qs('#quickUnitModal');
  const form = core.qs('#formQuickUnit');

  if (!modal || !form) {
    console.warn('[INBOUND][QUICK_UNIT] Modal de unidade ausente no HTML.');
    return;
  }

  const f = {
    subtitle: core.qs('#quickUnitSubtitle'),
    unit: core.qs('#qu_unit_id'),
    fator: core.qs('#qu_fator'),
    barcode: core.qs('#qu_barcode'),
    standard: core.qs('#qu_standard'),
    width: core.qs('#qu_width_cm'),
    length: core.qs('#qu_length_cm'),
    height: core.qs('#qu_height_cm'),
    weight: core.qs('#qu_weight_kg'),
    btnSave: core.qs('#btnSaveQuickUnit'),
  };

  let current = null; // { index, item }

  const selectedCatalogUnit = () =>
    state.unitsList.find((unit) => String(unit.unit_id) === f.unit.value) || null;

  function fillUnitSelect(item) {
    const taken = new Set((item._productUnits || []).map((unit) => unit.unit));
    const units = state.unitsList
      .filter((unit) => unit.unit_id)
      .slice()
      .sort((a, b) => a.unit.localeCompare(b.unit));

    f.unit.innerHTML = '';
    f.unit.appendChild(new Option('Selecione...', ''));
    units.forEach((unit) => {
      const label = unit.description ? `${unit.unit} — ${unit.description}` : unit.unit;
      const option = new Option(taken.has(unit.unit) ? `${label} (já cadastrada)` : label, String(unit.unit_id));
      f.unit.appendChild(option);
    });

    // Sugere a unidade da NF-e quando o produto ainda não tem ela.
    const xmlUnit = String(item.xml_unit || '').trim().toUpperCase();
    const suggestion = units.find((unit) => unit.unit === xmlUnit && !taken.has(unit.unit));
    f.unit.value = suggestion ? String(suggestion.unit_id) : '';
    syncFator();
  }

  function syncFator() {
    const unit = selectedCatalogUnit();
    f.fator.value = unit ? formatFator(unit.fator) : '';
  }

  function closeModal() {
    modal.classList.remove('is-open');
    current = null;
  }

  function openQuickUnitModal(index) {
    const item = state.currentItems?.[index];
    if (!item || state.inboundInvoiceReadOnly) return;
    if (!String(item.product_code ?? '').trim()) return;

    current = { index, item };
    form.reset();

    const label = item.product_description
      ? `${item.product_code} — ${item.product_description}`
      : item.product_code;
    f.subtitle.textContent = `Item ${index + 1} · SKU ${label}`;

    fillUnitSelect(item);
    f.standard.checked = !(item._productUnits || []).length;

    modal.classList.add('is-open');
    f.unit.focus();
  }

  async function submitQuickUnit(event) {
    event?.preventDefault();
    if (!current) return;

    const { index, item } = current;
    const unit = selectedCatalogUnit();
    if (!unit) {
      core.toast.error('Unidade obrigatória', 'Selecione a unidade.');
      f.unit.focus();
      return;
    }

    const sku = String(item.product_code ?? '').trim();
    const barcode = onlyDigits(f.barcode.value)
      || buildAutoBarcode({ sku, unitId: unit.unit_id, fator: unit.fator });

    f.btnSave.disabled = true;
    f.btnSave.textContent = 'Salvando…';

    try {
      const response = await fetch(ROUTES.barcodesUpsert(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          product_code: sku,
          product_unit_id: unit.unit_id,
          unit_id: unit.unit_id,
          unit: unit.unit,
          fator: unit.fator,
          description: unit.description,
          barcode,
          standard: f.standard.checked,
          is_active: true,
          width_cm: numberOrNull(f.width.value),
          length_cm: numberOrNull(f.length.value),
          height_cm: numberOrNull(f.height.value),
          weight_kg: numberOrNull(f.weight.value),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false || json?.ok === false) {
        throw new Error(
          json?.code === 'BARCODE_ALREADY_LINKED'
            ? `O código de barras ${barcode} já pertence a outro produto ou unidade.`
            : json?.error || `Erro HTTP ${response.status}.`
        );
      }

      closeModal();
      if (state.currentItems?.[index] !== item) return;

      // A renderização recarrega as unidades do produto e aplica a nova.
      item.unit = unit.unit;
      clearProductUnitsCache(state, sku);
      await state.actions.renderItemsTable?.(state.currentItems);

      core.toast.success('Unidade cadastrada', `${unit.unit} adicionada ao SKU ${sku} e selecionada no item ${index + 1}.`);
    } catch (error) {
      console.error('[INBOUND][QUICK_UNIT][SAVE]', error);
      core.toast.error('Erro ao cadastrar unidade', error?.message || 'Não foi possível cadastrar a unidade.');
    } finally {
      f.btnSave.disabled = false;
      f.btnSave.textContent = 'Salvar unidade';
    }
  }

  refs.itemsTbody?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="create-unit"]');
    if (!button || button.disabled) return;
    openQuickUnitModal(Number(button.dataset.index));
  });

  form.addEventListener('submit', submitQuickUnit);
  f.unit?.addEventListener('change', syncFator);
  core.qs('#btnCloseQuickUnit')?.addEventListener('click', closeModal);
  core.qs('#btnCancelQuickUnit')?.addEventListener('click', closeModal);
  core.qs('#quickUnitBackdrop')?.addEventListener('click', closeModal);

  // Captura antes do Esc do modal da NF-e: fecha só este modal.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !modal.classList.contains('is-open')) return;
    event.preventDefault();
    event.stopPropagation();
    closeModal();
  }, true);

  state.actions.openQuickUnitModal = openQuickUnitModal;
}
