/* ╔══════════════════════════════════════════════════════════════════╗
   ║ inboundInvoices.quickProduct.js — Cadastro rápido de produto     ║
   ║ CONSART ERP | Frontend (ESM)                                     ║
   ║                                                                  ║
   ║ Ícone "+" na coluna "Produto (cadastro)" dos itens sem vínculo:  ║
   ║ abre #quickProductModal pré-preenchido com os dados da NF-e,     ║
   ║ cria produto + estoque + lote (POST /quick-product) e vincula    ║
   ║ o produto ao item pelo mesmo fluxo da lupa.                      ║
   ╚══════════════════════════════════════════════════════════════════╝ */

'use strict';

import { isSimpleStockMode } from './inboundInvoices.stock.js';

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

// Mesmos formatos de resposta aceitos pelo createProduct.
function rowsOf(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.rows)) return json.rows;
  const inner = json.data;
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === 'object') {
    if (Array.isArray(inner.rows)) return inner.rows;
    const list = Object.values(inner).find(Array.isArray);
    if (list) return list;
  }
  return Object.values(json).find(Array.isArray) || [];
}

async function getRows(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return rowsOf(await response.json());
}

function fillSelect(select, rows, { idKey, textKeys, placeholder = 'Selecione...' }) {
  if (!select) return;
  select.innerHTML = '';
  select.appendChild(new Option(placeholder, ''));
  rows.forEach((row) => {
    const id = row?.[idKey] ?? row?.id;
    if (id == null) return;
    const text = textKeys.map((key) => row?.[key]).find((value) => textOrNull(value)) || `#${id}`;
    select.appendChild(new Option(String(text), String(id)));
  });
}

export function initQuickProduct({ core, ROUTES, state, refs }) {
  const modal = core.qs('#quickProductModal');
  const form = core.qs('#formQuickProduct');

  if (!modal || !form) {
    console.warn('[INBOUND][QUICK_PRODUCT] Modal de produto ausente no HTML.');
    return;
  }

  const f = {
    subtitle: core.qs('#quickProductSubtitle'),
    description: core.qs('#qp_description'),
    barcode: core.qs('#qp_barcode'),
    manufacturerRef: core.qs('#qp_manufacturer_ref'),
    costPrice: core.qs('#qp_cost_price'),
    group: core.qs('#qp_product_group_id'),
    subgroup: core.qs('#qp_product_subgroup_id'),
    manufacturer: core.qs('#qp_manufacturer_id'),
    ncm: core.qs('#qp_ncm'),
    unit: core.qs('#qp_unit'),
    supplier: core.qs('#qp_supplier'),
    lotSection: core.qs('#qpLotSection'),
    lotCode: core.qs('#qp_lot_code'),
    expiresAt: core.qs('#qp_expires_at'),
    btnSave: core.qs('#btnSaveQuickProduct'),
  };

  const base = () => core.getBase();
  let current = null; // { index, item }
  let combosLoaded = null;

  function loadCombos() {
    // Grupos e fabricantes mudam pouco: carrega uma vez por tela.
    combosLoaded ??= Promise.all([
      getRows(`${base()}/api/products/products-groups`)
        .then((rows) => fillSelect(f.group, rows, { idKey: 'product_group_id', textKeys: ['name'] })),
      getRows(`${base()}/api/manufacturers?page=1&limit=500&sort=trade_name&dir=asc`)
        .then((rows) => fillSelect(f.manufacturer, rows, {
          idKey: 'manufacturer_id',
          textKeys: ['trade_name', 'corporate_name', 'name'],
        })),
    ]).catch((error) => {
      combosLoaded = null;
      console.warn('[INBOUND][QUICK_PRODUCT][COMBOS]', error);
    });
    return combosLoaded;
  }

  async function loadSubgroups() {
    const groupId = positiveIntOrNull(f.group?.value);
    f.subgroup.disabled = true;
    fillSelect(f.subgroup, [], { placeholder: groupId ? 'Carregando...' : 'Selecione um grupo primeiro...' });
    if (!groupId) return;

    try {
      // Mesma rota do createProduct (a tabela usa group_id).
      const rows = await getRows(
        `${base()}/api/products-subgroups?group_id=${groupId}&is_active=true&limit=500`
      );
      fillSelect(f.subgroup, rows, {
        idKey: 'product_subgroup_id',
        textKeys: ['name'],
        placeholder: rows.length ? 'Selecione...' : 'Nenhum subgrupo',
      });
      f.subgroup.disabled = !rows.length;
    } catch (error) {
      fillSelect(f.subgroup, [], { placeholder: 'Erro ao carregar subgrupos' });
      console.warn('[INBOUND][QUICK_PRODUCT][SUBGROUPS]', error);
    }
  }

  function closeModal() {
    modal.classList.remove('is-open');
    current = null;
  }

  async function openQuickProductModal(index) {
    const item = state.currentItems?.[index];
    if (!item || state.inboundInvoiceReadOnly) return;

    current = { index, item };
    form.reset();

    const issuer = onlyDigits(refs.fldIssuer?.value);
    const invoiceNumber = textOrNull(refs.fldNum?.value);

    f.subtitle.textContent = [
      `Item ${index + 1}`,
      invoiceNumber && `NF-e ${invoiceNumber}`,
      item.nf_product_code && `Cód. fornecedor ${item.nf_product_code}`,
    ].filter(Boolean).join(' · ');

    f.description.value = item.description || '';
    f.barcode.value = item.barcode || '';
    f.manufacturerRef.value = item.manufacturer_ref || item.nf_product_code || '';
    f.costPrice.value = item.unit_price != null ? Number(item.unit_price).toFixed(2) : '';
    f.ncm.value = item.ncm || '';
    f.unit.value = item.unit || '';
    f.supplier.value = issuer || '';

    const withLot = !isSimpleStockMode(state);
    f.lotSection.hidden = !withLot;
    f.lotCode.value = item.lot_code || item.nLote || '';
    f.expiresAt.value = String(item.expires_at || item.dVal || '').slice(0, 10);

    fillSelect(f.subgroup, [], { placeholder: 'Selecione um grupo primeiro...' });
    f.subgroup.disabled = true;

    modal.classList.add('is-open');
    f.description.focus();
    f.description.select();

    await loadCombos();
  }

  async function submitQuickProduct(event) {
    event?.preventDefault();
    if (!current) return;

    const { index, item } = current;
    const description = textOrNull(f.description.value);
    if (!description) {
      core.toast.error('Descrição obrigatória', 'Informe a descrição do produto.');
      f.description.focus();
      return;
    }

    const withLot = !isSimpleStockMode(state);
    const payload = {
      description,
      barcode: textOrNull(f.barcode.value),
      manufacturer_ref: textOrNull(f.manufacturerRef.value),
      cost_price: textOrNull(f.costPrice.value),
      product_group_id: positiveIntOrNull(f.group.value),
      product_subgroup_id: positiveIntOrNull(f.subgroup.value),
      manufacturer_id: positiveIntOrNull(f.manufacturer.value),
      issuer_tax_id: onlyDigits(refs.fldIssuer?.value) || null,
      nf_product_code: textOrNull(item.nf_product_code),
      create_lot: withLot,
      lot_code: withLot ? textOrNull(f.lotCode.value) : null,
      expires_at: withLot ? textOrNull(f.expiresAt.value) : null,
      nfe_key: onlyDigits(refs.fldKey?.value) || null,
      nfe_item_seq: positiveIntOrNull(item.nfe_item_seq) ?? index + 1,
    };

    f.btnSave.disabled = true;
    f.btnSave.textContent = 'Salvando…';

    try {
      const response = await fetch(ROUTES.quickProduct(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || `Erro HTTP ${response.status}.`);
      }

      const product = json.data;
      closeModal();

      // Mesmo fluxo da lupa: atualiza o item, recarrega e seleciona o lote.
      await state.actions.linkProductToItem?.(index, item, product);

      if (String(item.product_code ?? '').trim() === String(product.product_code)) {
        core.toast.success(
          'Produto cadastrado',
          `SKU ${product.product_code} — ${product.description} vinculado ao item ${index + 1}.`
        );
      }
    } catch (error) {
      console.error('[INBOUND][QUICK_PRODUCT][SAVE]', error);
      core.toast.error(
        'Erro ao cadastrar produto',
        error?.message || 'Não foi possível cadastrar o produto.'
      );
    } finally {
      f.btnSave.disabled = false;
      f.btnSave.textContent = 'Salvar e vincular';
    }
  }

  refs.itemsTbody?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="create-product"]');
    if (!button || button.disabled) return;
    void openQuickProductModal(Number(button.dataset.index));
  });

  form.addEventListener('submit', submitQuickProduct);
  f.group?.addEventListener('change', loadSubgroups);
  core.qs('#btnCloseQuickProduct')?.addEventListener('click', closeModal);
  core.qs('#btnCancelQuickProduct')?.addEventListener('click', closeModal);
  core.qs('#quickProductBackdrop')?.addEventListener('click', closeModal);

  // Captura antes do Esc do modal da NF-e: fecha só o cadastro rápido,
  // sem descartar a nota importada que está por baixo.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !modal.classList.contains('is-open')) return;
    event.preventDefault();
    event.stopPropagation();
    closeModal();
  }, true);

  state.actions.openQuickProductModal = openQuickProductModal;
}
