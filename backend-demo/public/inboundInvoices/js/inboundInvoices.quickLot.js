/* ╔══════════════════════════════════════════════════════════════════╗
   ║ inboundInvoices.quickLot.js — Novo lote direto pelo item da NF-e ║
   ║ CONSART ERP | Frontend (ESM)                                     ║
   ║                                                                  ║
   ║ Ícone "+" ao lado do select de Lote (item já vinculado):         ║
   ║ abre #quickLotModal, cria o lote com saldo 0 em                  ║
   ║ POST /api/productsStockLots e já o seleciona no item.            ║
   ║ A quantidade entra no estoque na postagem da NF-e.               ║
   ╚══════════════════════════════════════════════════════════════════╝ */

'use strict';

import { clearLotsCaches } from './inboundInvoices.api.js';

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function positiveIntOrNull(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || `Erro HTTP ${response.status}.`);
  }
  return json;
}

export function initQuickLot({ core, ROUTES, state, refs }) {
  const modal = core.qs('#quickLotModal');
  const form = core.qs('#formQuickLot');

  if (!modal || !form) {
    console.warn('[INBOUND][QUICK_LOT] Modal de lote ausente no HTML.');
    return;
  }

  const f = {
    subtitle: core.qs('#quickLotSubtitle'),
    lotCode: core.qs('#ql_lot_code'),
    expiresAt: core.qs('#ql_expires_at'),
    costUnit: core.qs('#ql_cost_unit'),
    source: core.qs('#ql_source'),
    btnSave: core.qs('#btnSaveQuickLot'),
  };

  let current = null; // { index, item }

  // Itens vinculados pelo productsLmRef na importação podem vir sem
  // product_stock_id: busca no cadastro do produto.
  async function resolveProductStockId(item) {
    const known = positiveIntOrNull(item.product_stock_id);
    if (known) return known;

    const json = await readJson(await fetch(ROUTES.productByCode(item.product_code), {
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    const product = json?.data?.product ?? json?.data ?? json?.product ?? json;
    const stockId = positiveIntOrNull(product?.product_stock_id ?? product?.stock_id);
    if (!stockId) {
      throw new Error(
        `O SKU ${item.product_code} não tem estoque cadastrado. Abra o cadastro do produto para criar o estoque.`
      );
    }
    item.product_stock_id = stockId;
    return stockId;
  }

  function closeModal() {
    modal.classList.remove('is-open');
    current = null;
  }

  function openQuickLotModal(index) {
    const item = state.currentItems?.[index];
    if (!item || state.inboundInvoiceReadOnly) return;
    if (!String(item.product_code ?? '').trim()) return;

    current = { index, item };
    form.reset();

    const label = item.product_description
      ? `${item.product_code} — ${item.product_description}`
      : item.product_code;
    f.subtitle.textContent = `Item ${index + 1} · SKU ${label}`;

    f.lotCode.value = item.lot_code || item.nLote || '';
    f.expiresAt.value = String(item.expires_at || item.dVal || '').slice(0, 10);
    f.costUnit.value = item.unit_price != null
      ? Number(item.unit_price).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
      : '';

    const invoiceNumber = textOrNull(refs.fldNum?.value);
    const itemSeq = positiveIntOrNull(item.nfe_item_seq) ?? index + 1;
    f.source.value = [invoiceNumber, `item ${itemSeq}`].filter(Boolean).join(' · ');

    modal.classList.add('is-open');
    f.lotCode.focus();
  }

  async function submitQuickLot(event) {
    event?.preventDefault();
    if (!current) return;

    const { index, item } = current;
    const lotCode = textOrNull(f.lotCode.value);
    if (!lotCode) {
      core.toast.error('Código obrigatório', 'Informe o código do lote.');
      f.lotCode.focus();
      return;
    }

    f.btnSave.disabled = true;
    f.btnSave.textContent = 'Salvando…';

    try {
      const productStockId = await resolveProductStockId(item);

      const json = await readJson(await fetch(ROUTES.lotsCreate(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          product_stock_id: productStockId,
          product_grade_id: positiveIntOrNull(item.product_grade_id),
          lot_code: lotCode,
          expires_at: textOrNull(f.expiresAt.value),
          qty_on_hand: 0,
          cost_unit: item.unit_price ?? null,
          nfe_key: onlyDigits(refs.fldKey?.value) || null,
          nfe_item_seq: positiveIntOrNull(item.nfe_item_seq) ?? index + 1,
        }),
      }));

      const lot = json?.row ?? json?.data ?? null;
      const lotId = positiveIntOrNull(lot?.lot_id ?? lot?.id);
      if (!lotId) throw new Error('A API não retornou o lote criado.');

      closeModal();
      if (state.currentItems?.[index] !== item) return;

      item.lot_id = lotId;
      if (lot?.product_grade_id) item.product_grade_id = lot.product_grade_id;

      // Recarrega os lotes do item: o novo lote já vem selecionado.
      clearLotsCaches(state);
      await state.actions.renderItemsTable?.(state.currentItems);

      core.toast.success('Lote criado', `Lote ${lot.lot_code || lotCode} selecionado no item ${index + 1}.`);
    } catch (error) {
      console.error('[INBOUND][QUICK_LOT][SAVE]', error);
      core.toast.error('Erro ao criar lote', error?.message || 'Não foi possível criar o lote.');
    } finally {
      f.btnSave.disabled = false;
      f.btnSave.textContent = 'Salvar lote';
    }
  }

  refs.itemsTbody?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="create-lot"]');
    if (!button || button.disabled) return;
    openQuickLotModal(Number(button.dataset.index));
  });

  form.addEventListener('submit', submitQuickLot);
  core.qs('#btnCloseQuickLot')?.addEventListener('click', closeModal);
  core.qs('#btnCancelQuickLot')?.addEventListener('click', closeModal);
  core.qs('#quickLotBackdrop')?.addEventListener('click', closeModal);

  // Captura antes do Esc do modal da NF-e: fecha só este modal.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !modal.classList.contains('is-open')) return;
    event.preventDefault();
    event.stopPropagation();
    closeModal();
  }, true);

  state.actions.openQuickLotModal = openQuickLotModal;
}
