// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inventory.quickCreate.js — Cadastro rápido no lançamento de item     ║
// ║ CONSART ERP | Inventário                                              ║
// ║                                                                      ║
// ║ Ícones "+" ao lado de Unidade, Localização e Lote / Validade:        ║
// ║  - Nova unidade     → POST /api/barcodes (mesma aba Unidades do      ║
// ║                       cadastro; código de barras automático)         ║
// ║  - Nova localização → POST /api/locations/product-locations          ║
// ║                       (+ PATCH .../primary se marcado)               ║
// ║  - Novo lote        → POST /api/productsStockLots (saldo 0)          ║
// ║ O registro criado já fica selecionado no item. Avisos: centerAlert.  ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { Modal } from '/public/includes/js/modal.js';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';
import { getAuthHeaders } from './inventory.auth.js';
import { API_BASE, PRODUCTS_STOCK_LOTS_API_BASE } from './inventory.config.js';
import { state } from './inventory.state.js';
import {
  loadAndPopulateUnitsForProduct,
  loadAndPopulateLocationsForProduct,
  loadAndPopulateLotsForSku,
  resolveProductStockIdBySku,
} from './inventory.items.js';

const LOC_API = `${API_BASE}/api/locations`;

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function positiveIntOrNull(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function asRows(data) {
  // GET /api/units responde { ok, data: { rows, total } }
  if (data?.data && !Array.isArray(data.data) && Array.isArray(data.data.rows)) return data.data.rows;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  return [];
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

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false || json?.success === false) {
    const err = new Error(json?.message || json?.error || `Erro HTTP ${res.status}.`);
    err.code = json?.code || json?.error;
    throw err;
  }
  return json;
}

function fillSelect(select, rows, { label = (r) => r.name, value = (r) => r.id } = {}) {
  if (!select) return;
  select.innerHTML = '<option value="">Selecione...</option>';
  rows.forEach((row) => {
    const v = value(row);
    if (v == null || v === '') return;
    select.appendChild(new Option(label(row), String(v)));
  });
}

function selectedText(select) {
  if (!select?.value) return null;
  return textOrNull(select.options[select.selectedIndex]?.textContent);
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  const span = button.querySelector('span');
  if (span) span.textContent = busy ? 'Salvando…' : label;
}

/** Produto do lançamento: { sku, label } ou aviso e null. */
function requireProduct(els) {
  if (String(state.currentInventory?.status || '').toUpperCase() === 'FINALIZED') {
    showCenterModal({
      variant: 'warning',
      title: 'Inventário finalizado',
      message: 'Não é possível cadastrar unidade, localização ou lote em um inventário finalizado.',
    });
    return null;
  }

  const sku = String(els.itemProductCodeValue?.value || '').trim();
  if (!sku) {
    showCenterModal({
      variant: 'warning',
      title: 'Selecione o produto',
      message: 'Busque o produto primeiro: a unidade, a localização e o lote são cadastrados para ele.',
    });
    return null;
  }

  return { sku, label: String(els.itemProductCode?.value || sku).trim() };
}

/* ──────────────────────────────────────────────────────────────
   Nova unidade
────────────────────────────────────────────────────────────── */
let unitsCatalog = null; // [{ unit_id, unit, description, fator }]

async function loadUnitsCatalog() {
  if (unitsCatalog) return unitsCatalog;
  const data = await request('GET', `${API_BASE}/api/units?onlyActive=1&limit=1000`);
  unitsCatalog = asRows(data)
    .map((u) => ({
      unit_id: positiveIntOrNull(u.unit_id ?? u.id),
      unit: String(u.unit ?? u.unit_code ?? u.sigla ?? '').trim().toUpperCase(),
      description: u.description ?? u.descricao ?? '',
      fator: positiveOr(u.fator, 1),
    }))
    .filter((u) => u.unit_id && u.unit)
    .sort((a, b) => a.unit.localeCompare(b.unit));
  return unitsCatalog;
}

function setupQuickUnit(els) {
  const f = {
    subtitle: $('quickUnitModalSubtitle'),
    unit: $('quickUnitUnit'),
    factor: $('quickUnitFactor'),
    barcode: $('quickUnitBarcode'),
    standard: $('quickUnitStandard'),
    save: $('btnSaveQuickUnit'),
  };
  let current = null;

  const selectedUnit = () => (unitsCatalog || []).find((u) => String(u.unit_id) === f.unit.value) || null;
  const syncFactor = () => {
    const u = selectedUnit();
    f.factor.value = u ? u.fator.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '';
  };

  $('btnQuickUnit')?.addEventListener('click', async () => {
    const product = requireProduct(els);
    if (!product) return;

    try {
      await loadUnitsCatalog();
    } catch (error) {
      showCenterModal({ variant: 'error', title: 'Erro ao carregar unidades', message: error.message });
      return;
    }

    const taken = new Set(
      Array.from(els.itemUnit?.options || []).map((o) => String(o.dataset?.unit || '').toUpperCase()).filter(Boolean)
    );

    fillSelect(f.unit, unitsCatalog, {
      value: (u) => u.unit_id,
      label: (u) => {
        const text = u.description ? `${u.unit} — ${u.description}` : u.unit;
        return taken.has(u.unit) ? `${text} (já cadastrada)` : text;
      },
    });

    current = product;
    f.subtitle.textContent = product.label;
    f.factor.value = '';
    f.barcode.value = '';
    f.standard.checked = taken.size === 0;
    Modal.open('quickUnitModal', { focusSelector: '#quickUnitUnit' });
  });

  f.unit?.addEventListener('change', syncFactor);

  f.save?.addEventListener('click', async () => {
    if (!current) return;
    const unit = selectedUnit();
    if (!unit) {
      showCenterModal({ variant: 'warning', title: 'Unidade obrigatória', message: 'Selecione a unidade.' });
      return;
    }

    const alreadyLinked = Array.from(els.itemUnit?.options || [])
      .some((o) => String(o.dataset?.unit || '').toUpperCase() === unit.unit);
    if (alreadyLinked) {
      showCenterModal({
        variant: 'warning',
        title: 'Unidade já cadastrada',
        message: `O produto já tem a unidade ${unit.unit}. Selecione-a na lista de unidades do item.`,
      });
      return;
    }

    const { sku } = current;
    const barcode = onlyDigits(f.barcode.value) || buildAutoBarcode({ sku, unitId: unit.unit_id, fator: unit.fator });

    setBusy(f.save, true, 'Salvar unidade');
    try {
      await request('POST', `${API_BASE}/api/barcodes`, {
        product_code: sku,
        product_unit_id: unit.unit_id,
        unit_id: unit.unit_id,
        unit: unit.unit,
        fator: unit.fator,
        description: unit.description,
        barcode,
        standard: f.standard.checked,
        is_active: true,
      });

      Modal.close('quickUnitModal');
      current = null;

      await loadAndPopulateUnitsForProduct(els, sku);
      const opt = Array.from(els.itemUnit?.options || [])
        .find((o) => String(o.dataset?.unit || '').toUpperCase() === unit.unit);
      if (opt) {
        els.itemUnit.value = opt.value;
        els.itemUnit.dispatchEvent(new Event('change', { bubbles: true }));
      }

      showCenterModal({
        variant: 'success',
        title: 'Unidade cadastrada',
        message: `${unit.unit} adicionada ao produto ${sku} e selecionada no item.`,
      });
    } catch (error) {
      showCenterModal({
        variant: 'error',
        title: 'Erro ao cadastrar unidade',
        message: error.code === 'BARCODE_ALREADY_LINKED'
          ? `O código de barras ${barcode} já pertence a outro produto ou unidade.`
          : error.message,
      });
    } finally {
      setBusy(f.save, false, 'Salvar unidade');
    }
  });
}

/* ──────────────────────────────────────────────────────────────
   Nova localização
────────────────────────────────────────────────────────────── */
function setupQuickLocation(els) {
  const f = {
    subtitle: $('quickLocationModalSubtitle'),
    local: $('quickLocLocal'),
    corridor: $('quickLocCorridor'),
    shelf: $('quickLocShelf'),
    bin: $('quickLocBin'),
    position: $('quickLocPosition'),
    notes: $('quickLocNotes'),
    primary: $('quickLocPrimary'),
    save: $('btnSaveQuickLocation'),
  };
  let current = null;

  // Cascata dos cadastros mestres (mesma tela de Localizações).
  const cascade = [
    { select: f.local, url: () => `${LOC_API}/locals?activeOnly=true` },
    { select: f.corridor, url: (id) => `${LOC_API}/corridors?localId=${encodeURIComponent(id)}&activeOnly=true` },
    { select: f.shelf, url: (id) => `${LOC_API}/shelves?corridorId=${encodeURIComponent(id)}&activeOnly=true` },
    { select: f.bin, url: (id) => `${LOC_API}/bins?shelfId=${encodeURIComponent(id)}&activeOnly=true` },
    { select: f.position, url: (id) => `${LOC_API}/positions?binId=${encodeURIComponent(id)}&activeOnly=true` },
  ];

  async function loadLevel(index, parentId) {
    for (let i = index; i < cascade.length; i += 1) fillSelect(cascade[i].select, []);
    if (index > 0 && !parentId) return;
    try {
      const data = await request('GET', cascade[index].url(parentId));
      fillSelect(cascade[index].select, asRows(data));
    } catch (error) {
      console.error('[INVENTORY][QUICK_LOCATION] load level', index, error);
    }
  }

  cascade.forEach((level, index) => {
    const next = cascade[index + 1];
    if (!next) return;
    level.select?.addEventListener('change', () => loadLevel(index + 1, level.select.value));
  });

  $('btnQuickLocation')?.addEventListener('click', async () => {
    const product = requireProduct(els);
    if (!product) return;

    current = product;
    f.subtitle.textContent = product.label;
    f.notes.value = '';
    const hasLocations = Array.from(els.itemLocation?.options || []).some((o) => String(o.value || '').trim());
    f.primary.checked = !hasLocations;

    await loadLevel(0);
    const locals = Array.from(f.local.options).filter((o) => o.value);
    if (locals.length === 1) {
      f.local.value = locals[0].value;
      await loadLevel(1, f.local.value);
    }

    Modal.open('quickLocationModal', { focusSelector: f.local.value ? '#quickLocCorridor' : '#quickLocLocal' });
  });

  f.save?.addEventListener('click', async () => {
    if (!current) return;

    const missing = [
      [f.local, 'Local'],
      [f.corridor, 'Corredor'],
      [f.shelf, 'Prateleira'],
    ].filter(([select]) => !select.value).map(([, label]) => label);
    if (missing.length) {
      showCenterModal({
        variant: 'warning',
        title: 'Campos obrigatórios',
        message: `Selecione: ${missing.join(', ')}.`,
      });
      return;
    }

    const { sku } = current;
    setBusy(f.save, true, 'Salvar localização');
    try {
      const row = await request('POST', `${LOC_API}/product-locations`, {
        product_code: sku,
        store_id: Number(f.local.value),
        corredor: selectedText(f.corridor),
        prateleira: selectedText(f.shelf),
        bandeja: selectedText(f.bin),
        box: selectedText(f.position),
        observacao: textOrNull(f.notes.value),
        is_active: true,
      });
      const locId = positiveIntOrNull(row?.id ?? row?.product_location_id ?? row?.row?.id);

      if (locId && f.primary.checked) {
        try {
          await request('PATCH', `${LOC_API}/product-locations/${locId}/primary`);
        } catch (error) {
          console.warn('[INVENTORY][QUICK_LOCATION] primary', error);
        }
      }

      Modal.close('quickLocationModal');
      current = null;

      state.__locBySkuCache.delete(sku);
      state.__locRowsLastLoaded.delete(sku);
      await loadAndPopulateLocationsForProduct(els, sku);
      if (locId && els.itemLocation) {
        els.itemLocation.value = String(locId);
        els.itemLocation.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const text = [selectedText(f.corridor), selectedText(f.shelf), selectedText(f.bin), selectedText(f.position)]
        .filter(Boolean).join(' / ');
      showCenterModal({
        variant: 'success',
        title: 'Localização cadastrada',
        message: `${text} adicionada ao produto ${sku} e selecionada no item.`,
      });
    } catch (error) {
      showCenterModal({ variant: 'error', title: 'Erro ao cadastrar localização', message: error.message });
    } finally {
      setBusy(f.save, false, 'Salvar localização');
    }
  });
}

/* ──────────────────────────────────────────────────────────────
   Novo lote / validade
────────────────────────────────────────────────────────────── */
function setupQuickLot(els) {
  const f = {
    subtitle: $('quickLotModalSubtitle'),
    code: $('quickLotCode'),
    expires: $('quickLotExpires'),
    save: $('btnSaveQuickLot'),
  };
  let current = null;

  $('btnQuickLot')?.addEventListener('click', () => {
    const product = requireProduct(els);
    if (!product) return;

    current = product;
    f.subtitle.textContent = product.label;
    f.code.value = '';
    f.expires.value = '';
    Modal.open('quickLotModal', { focusSelector: '#quickLotCode' });
  });

  f.save?.addEventListener('click', async () => {
    if (!current) return;

    const lotCode = textOrNull(f.code.value);
    if (!lotCode) {
      showCenterModal({ variant: 'warning', title: 'Código obrigatório', message: 'Informe o código do lote.' });
      return;
    }

    const { sku } = current;
    setBusy(f.save, true, 'Salvar lote');
    try {
      state.__productStockIdBySkuCache.delete(sku);
      const productStockId = await resolveProductStockIdBySku(sku);
      if (!productStockId) {
        throw new Error(`O produto ${sku} não tem estoque cadastrado. Abra o cadastro do produto para criar o estoque.`);
      }

      const json = await request('POST', `${PRODUCTS_STOCK_LOTS_API_BASE}`, {
        product_stock_id: productStockId,
        lot_code: lotCode,
        expires_at: textOrNull(f.expires.value),
        qty_on_hand: 0,
      });
      const lot = json?.row ?? json?.data ?? null;
      const lotId = positiveIntOrNull(lot?.lot_id ?? lot?.id);

      Modal.close('quickLotModal');
      current = null;

      state.__lotsBySkuCache.delete(sku);
      state.__lotsByStockIdCache.delete(productStockId);
      await loadAndPopulateLotsForSku(els, sku);
      if (lotId && els.lotSelect) {
        els.lotSelect.value = String(lotId);
        els.lotSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }

      showCenterModal({
        variant: 'success',
        title: 'Lote cadastrado',
        message: `Lote ${lot?.lot_code || lotCode} criado para o produto ${sku} e selecionado no item.`,
      });
    } catch (error) {
      showCenterModal({ variant: 'error', title: 'Erro ao cadastrar lote', message: error.message });
    } finally {
      setBusy(f.save, false, 'Salvar lote');
    }
  });

  f.code?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); f.save?.click(); }
  });
}

export function bindQuickCreate(els) {
  setupQuickUnit(els);
  setupQuickLocation(els);
  setupQuickLot(els);
}
