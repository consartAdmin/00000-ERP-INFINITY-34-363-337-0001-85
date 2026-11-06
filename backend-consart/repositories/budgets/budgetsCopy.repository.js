// ╔══════════════════════════════════════════════════════════════════════╗
// ║ budgetsCopy.repository.js — copyFromBudget                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { getById } from './budgetsGetById.repository.js';
import { create } from './budgetsCreate.repository.js';
import pool from '../../config/db.js';
import productsStockManager from '../productsStock/productsStock.manager.js';
import { getActiveUnitsByProductCode } from '../productsBarCode/productsBarCodeQuery.repository.js';

// ----------------------------------------------------------------------
// Lots: the copy gets fresh lots from current stock (FEFO, same order as
// the lot select in the editor), not the lots of the source budget.
// The copy modal can pick the lot of each item; when it does not, the
// first lot whose free balance covers the quantity is used, then the
// first lot with any balance; items sharing a lot consume its balance.
// Blocked / inactive / deleted lots are never offered (to_jsonb keeps the
// query valid on databases that do not have those columns yet).
// ----------------------------------------------------------------------
async function resolveWithLot(ctx = {}) {
  try {
    const mode = await productsStockManager.resolveProductsStockMode(ctx);
    return !!mode?.isWithLot;
  } catch (err) {
    console.warn('[budgetsApi.copyFromBudget] stock mode:', err?.message || err);
    return false;
  }
}

async function fetchLotsByProductCode(code) {
  const { rows } = await pool.query(
    `
      SELECT
        psl.lot_id,
        psl.product_grade_id,
        pg.grade_id,
        psl.lot_code,
        psl.expires_at,
        (COALESCE(psl.qty_on_hand, 0) - COALESCE(psl.qty_reserved, 0)) AS qty_available
      FROM public.products p
      JOIN public."productsStockLots" psl
        ON psl.product_stock_id = p.product_stock_id
      LEFT JOIN public."productsGrades" pg
        ON pg.product_grade_id = psl.product_grade_id
      WHERE p.product_code = $1
        AND NULLIF(to_jsonb(psl)->>'blocked_at', '') IS NULL
        AND NULLIF(to_jsonb(psl)->>'deleted_at', '') IS NULL
        AND COALESCE(to_jsonb(psl)->>'is_active', 'true') <> 'false'
      ORDER BY
        psl.expires_at NULLS LAST,
        psl.lot_code ASC,
        psl.lot_id ASC
    `,
    [code]
  );

  return rows.map((r) => ({
    lot_id: Number(r.lot_id),
    product_grade_id: r.product_grade_id != null ? Number(r.product_grade_id) : null,
    grade_id: r.grade_id != null ? Number(r.grade_id) : null,
    lot_code: r.lot_code ?? '',
    expires_at: r.expires_at ?? null,
    qty_available: Number(r.qty_available || 0),
  }));
}

async function loadLotsForItems(items) {
  const lotsByCode = new Map();

  for (const it of items) {
    const code = String(it.product_code || '').trim();
    if (!code || lotsByCode.has(code)) continue;

    try {
      lotsByCode.set(code, await fetchLotsByProductCode(code));
    } catch (err) {
      console.warn(`[budgetsApi.copyFromBudget] lots ${code}:`, err?.message || err);
      lotsByCode.set(code, []);
    }
  }

  return lotsByCode;
}

function lotsForItem(it, lotsByCode) {
  const code = String(it.product_code || '').trim();
  const gradeId = it.grade_id != null && it.grade_id !== '' ? Number(it.grade_id) : null;

  return (lotsByCode.get(code) || []).filter(
    (lot) =>
      gradeId == null ||
      lot.grade_id === gradeId ||
      lot.product_grade_id === gradeId
  );
}

// ----------------------------------------------------------------------
// Units (U.M.): active barcodes of the product, same source as the unit
// select in the editor (/api/barcodes/active-units). Price follows the
// editor rule: base price x unit factor.
// ----------------------------------------------------------------------
function normalizeUnitCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

async function loadUnitsForItems(items) {
  const unitsByCode = new Map();

  for (const it of items) {
    const code = String(it.product_code || '').trim();
    if (!code || unitsByCode.has(code)) continue;

    try {
      const rows = await getActiveUnitsByProductCode(pool, code);
      const seen = new Set();
      const units = [];

      for (const r of rows || []) {
        const unit = normalizeUnitCode(r.unit);
        if (!unit || seen.has(unit)) continue;
        seen.add(unit);

        units.push({
          unit,
          fator: Number(r.fator ?? r.factor ?? 1) || 1,
          barcode_id: r.barcode_id != null ? Number(r.barcode_id) : null,
          standard: !!r.standard,
        });
      }

      unitsByCode.set(code, units);
    } catch (err) {
      console.warn(`[budgetsApi.copyFromBudget] units ${code}:`, err?.message || err);
      unitsByCode.set(code, []);
    }
  }

  return unitsByCode;
}

function unitsForItem(it, unitsByCode) {
  const code = String(it.product_code || '').trim();
  const list = [...(unitsByCode.get(code) || [])];
  const current = normalizeUnitCode(it.unit_code ?? it.unit ?? 'UN') || 'UN';

  // The unit of the source item is always offered, even if it was deactivated.
  if (!list.some((u) => u.unit === current)) {
    list.unshift({
      unit: current,
      fator: Number(it.conversion_factor || 1) || 1,
      barcode_id: it.barcode_id != null ? Number(it.barcode_id) : null,
      standard: false,
    });
  }

  return list;
}

function pickFefoLot(lots, qty, usedByLot) {
  const candidates = lots
    .map((lot) => ({
      lot_id: lot.lot_id,
      free: lot.qty_available - (usedByLot.get(lot.lot_id) || 0),
    }))
    .filter((lot) => lot.free > 0);

  return (
    candidates.find((lot) => lot.free >= qty) ||
    candidates[0] ||
    null
  );
}

function consumeLot(usedByLot, lotId, qty) {
  usedByLot.set(lotId, (usedByLot.get(lotId) || 0) + Math.max(0, qty));
}

// it.requested_lot_id (from the modal) wins when it is a valid lot of the
// product; otherwise FEFO.
async function assignLotsForCopy(items, ctx = {}) {
  if (!(await resolveWithLot(ctx))) return;

  const lotsByCode = await loadLotsForItems(items);
  const usedByLot = new Map();

  for (const it of items) {
    const lots = lotsForItem(it, lotsByCode);
    // Lot balance is in the base unit.
    const qty = Number(it.quantity || 0) * (Number(it.conversion_factor || 1) || 1);
    const requested = Number(it.requested_lot_id);

    const manual = Number.isFinite(requested) && requested > 0
      ? lots.find((lot) => lot.lot_id === requested)
      : null;

    if (manual) {
      it.lot_id = manual.lot_id;
      consumeLot(usedByLot, manual.lot_id, qty);
      continue;
    }

    const chosen = pickFefoLot(lots, qty, usedByLot);
    if (!chosen) continue;

    it.lot_id = chosen.lot_id;
    consumeLot(usedByLot, chosen.lot_id, Math.min(qty, chosen.free));
  }
}

// ----------------------------------------------------------------------
// Copy modal data: items of the source budget + available lots (FEFO)
// and the suggested lot of each item.
// ----------------------------------------------------------------------
export async function getCopyOptions(sourceBudgetId, ctx = {}) {
  const bid = Number(sourceBudgetId);
  if (!Number.isFinite(bid) || bid <= 0) {
    return { ok: false, error: 'BAD_REQUEST' };
  }

  const source = await getById(bid);
  if (!source?.ok || !source?.header) {
    return { ok: false, error: source?.error || 'NOT_FOUND' };
  }

  const items = (Array.isArray(source.items) ? source.items : [])
    .filter((it) => Number(it?.budget_item_id) > 0);

  const withLot = await resolveWithLot(ctx);
  const lotsByCode = withLot ? await loadLotsForItems(items) : new Map();
  const unitsByCode = await loadUnitsForItems(items);
  const usedByLot = new Map();

  return {
    ok: true,
    budget_id: bid,
    with_lot: withLot,
    items: items.map((it) => {
      const qty = Number(it.quantity || 0);
      const factor = Number(it.conversion_factor || 1) || 1;
      const baseQty = qty * factor;
      const lots = withLot ? lotsForItem(it, lotsByCode) : [];
      const suggested = withLot ? pickFefoLot(lots, baseQty, usedByLot) : null;
      if (suggested) consumeLot(usedByLot, suggested.lot_id, Math.min(baseQty, suggested.free));

      return {
        budget_item_id: Number(it.budget_item_id),
        product_code: it.product_code ?? it.sku ?? '',
        description: it.description ?? '',
        grade_id: it.grade_id ?? null,
        unit_code: normalizeUnitCode(it.unit_code ?? it.unit ?? 'UN') || 'UN',
        conversion_factor: factor,
        units: unitsForItem(it, unitsByCode),
        quantity: qty,
        unit_price: Number(it.unit_price || 0),
        discount_value: Number(it.discount_value || 0),
        lots,
        suggested_lot_id: suggested ? suggested.lot_id : null,
      };
    }),
  };
}

// options.itemIds: budget_item_id list chosen in the copy modal. When it is
// provided only those items are copied and the header totals are recomputed.
// ----------------------------------------------------------------------
function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// options.items: [{ budget_item_id, quantity, unit_code, lot_id }] edited in the copy
// modal. Returns Map(budget_item_id -> { quantity, lot_id, unit_code }).
function normalizeItemOverrides(raw) {
  if (!Array.isArray(raw)) return null;

  const map = new Map();
  for (const row of raw) {
    const id = Number(row?.budget_item_id);
    if (!Number.isFinite(id) || id <= 0) continue;

    const qty = Number(String(row?.quantity ?? '').replace(',', '.'));
    const lotId = Number(row?.lot_id);

    map.set(id, {
      quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
      lot_id: Number.isFinite(lotId) && lotId > 0 ? lotId : null,
      unit_code: normalizeUnitCode(row?.unit_code) || null,
    });
  }

  return map.size ? map : null;
}

function normalizeItemIds(raw) {
  if (!Array.isArray(raw)) return null;

  return new Set(
    raw
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0)
  );
}

export async function copyFromBudget(sourceBudgetId, ctx = {}, options = {}) {
  const bid = Number(sourceBudgetId);

  if (!Number.isFinite(bid) || bid <= 0) {
    return {
      ok: false,
      error: 'BAD_REQUEST',
    };
  }

  try {
    const source = await getById(bid);

    if (!source?.ok || !source?.header) {
      return {
        ok: false,
        error: source?.error || 'NOT_FOUND',
      };
    }

    const srcHeader = source.header;
    const allSrcItems = Array.isArray(source.items)
      ? source.items
      : [];

    const overrides = normalizeItemOverrides(options?.items);
    const selectedIds = overrides
      ? new Set(overrides.keys())
      : normalizeItemIds(options?.itemIds);
    const srcItems = selectedIds
      ? allSrcItems.filter((it) => selectedIds.has(Number(it.budget_item_id)))
      : allSrcItems;

    if (selectedIds && !srcItems.length) {
      return {
        ok: false,
        error: 'BAD_REQUEST',
        message: 'Selecione ao menos um produto para copiar.',
      };
    }

    // ================================================================
    // HEADER
    // ================================================================
    const newHeader = {
      issue_date: new Date().toISOString().slice(0, 10),
      status: 'ABERTO',

      // --------------------------------------------------------------
      // Customer
      // --------------------------------------------------------------
      customer_id:
        srcHeader.customer_id ??
        null,

      customer_name:
        srcHeader.customer_name ?? null,

      customer_tax_id:
        srcHeader.customer_tax_id ?? null,

      customer_email: srcHeader.customer_email ?? srcHeader.email ?? null,
      customer_phone: srcHeader.customer_phone ?? srcHeader.phone ?? null,

      // --------------------------------------------------------------
      // Commercial / fiscal operation
      // --------------------------------------------------------------
      operation_type_id:
        srcHeader.operation_type_id ??
        null,

      payment_form_id:
        srcHeader.payment_form_id ??
        null,

      payment_term_id:
        srcHeader.payment_term_id ??
        null,

      // --------------------------------------------------------------
      // Notes. Shipping is not shared because budgets.budget_shipping_id is unique.
      // --------------------------------------------------------------
      notes:
        srcHeader.notes ??
        null,

      budget_shipping_id: null,

      // --------------------------------------------------------------
      // Totals / discounts
      // --------------------------------------------------------------
      subtotal:
        Number(srcHeader.subtotal || 0),

      items_discount_total:
        Number(srcHeader.items_discount_total || 0),

      total_discount:
        Number(srcHeader.total_discount || 0),

      global_discount_type:
        srcHeader.global_discount_type ||
        'value',

      global_discount_value:
        Number(srcHeader.global_discount_value || 0),

      global_discount_amount:
        Number(srcHeader.global_discount_amount || 0),

      total_amount:
        Number(srcHeader.total_amount || 0),

      // --------------------------------------------------------------
      // A copy should not inherit the original seller automatically
      // --------------------------------------------------------------
      seller_id: null,
    };

    // ================================================================
    // ITEMS
    // ================================================================
    let quantityChanged = false;

    // Units are only looked up when the modal changed one.
    const unitChangeItems = overrides
      ? srcItems.filter((it) => {
        const o = overrides.get(Number(it.budget_item_id));
        return o?.unit_code &&
          o.unit_code !== normalizeUnitCode(it.unit_code ?? it.unit ?? 'UN');
      })
      : [];
    const unitsByCode = unitChangeItems.length
      ? await loadUnitsForItems(unitChangeItems)
      : new Map();

    const newItems = srcItems.map((it) => {
      const override = overrides?.get(Number(it.budget_item_id)) || null;
      const srcQty = Number(it.quantity || 0);
      const qty = override?.quantity ?? srcQty;
      const srcPrice = Number(it.unit_price || 0);
      const srcFactor = Number(it.conversion_factor || 1) || 1;
      const srcUnit = normalizeUnitCode(it.unit_code ?? it.unit ?? 'UN') || 'UN';

      // U.M. chosen in the modal: factor/barcode from the product's active
      // units; price = source base price x new factor (editor rule).
      let unitCode = srcUnit;
      let factor = srcFactor;
      let barcodeId = it.barcode_id ?? null;
      let unitPrice = srcPrice;

      if (override?.unit_code && override.unit_code !== srcUnit) {
        const unit = unitsForItem(it, unitsByCode)
          .find((u) => u.unit === override.unit_code);

        if (unit) {
          unitCode = unit.unit;
          factor = unit.fator;
          barcodeId = unit.barcode_id ?? null;
          unitPrice = Math.round((srcPrice / srcFactor) * factor * 10000) / 10000;
        }
      }

      // Item discount is a value: keep it proportional to the new line value.
      const srcGross = srcQty * srcPrice;
      const gross = qty * unitPrice;
      const srcDiscount = Number(it.discount_value || 0);
      const discount = gross !== srcGross
        ? (srcGross > 0 ? roundMoney(srcDiscount * (gross / srcGross)) : 0)
        : srcDiscount;

      if (gross !== srcGross) quantityChanged = true;

      return {
        product_code: it.product_code ?? null,
        barcode_id: barcodeId,

        manufacturer_ref:
          it.manufacturer_ref ??
          null,

        description:
          it.description ??
          '',

        grade_id:
          it.grade_id ??
          null,

        unit_code: unitCode,
        conversion_factor: factor,

        quantity: qty,

        unit_price: unitPrice,

        discount_value: discount,

        price_id:
          it.price_id ??
          null,

        // Do not inherit commission from original budget
        commission_id: null,

        // Lot is not inherited; assignLotsForCopy() picks one from stock
        lot_id: null,
        requested_lot_id: override?.lot_id ?? null,

        override_stock: false,
        override_token: null,
      };
    });

    // ================================================================
    // TOTALS — part of the items was copied or quantities changed, so recompute
    // (same rule as recalcTotals() in public/budgets/js/budgets.items.js;
    // freight is not copied).
    // ================================================================
    if (quantityChanged || (selectedIds && srcItems.length !== allSrcItems.length)) {
      const subtotal = newItems.reduce(
        (sum, it) => sum + Math.max(0, it.quantity) * Math.max(0, it.unit_price),
        0
      );
      const itemsDiscount = newItems.reduce(
        (sum, it) => sum + Math.max(0, it.discount_value),
        0
      );
      const base = Math.max(0, subtotal - itemsDiscount);

      const globalType =
        String(newHeader.global_discount_type || 'value').trim().toLowerCase() === 'percent'
          ? 'percent'
          : 'value';
      const globalValue = Math.max(0, newHeader.global_discount_value);
      const globalAmount = globalType === 'percent'
        ? Math.min(base, base * (globalValue / 100))
        : Math.min(base, globalValue);

      newHeader.global_discount_type = globalType;
      newHeader.subtotal = roundMoney(subtotal);
      newHeader.items_discount_total = roundMoney(itemsDiscount);
      newHeader.global_discount_amount = roundMoney(globalAmount);
      newHeader.total_discount = roundMoney(itemsDiscount + globalAmount);
      newHeader.total_amount = roundMoney(Math.max(0, base - globalAmount));
    }

    await assignLotsForCopy(newItems, ctx);
    newItems.forEach((it) => { delete it.requested_lot_id; });

    // ================================================================
    // VALIDATION
    // ================================================================
    if (!newHeader.operation_type_id) {
      return {
        ok: false,
        error: 'SOURCE_BUDGET_WITHOUT_OPERATION_TYPE',
        message:
          `O orçamento ${bid} não possui operation_type_id definido.`,
      };
    }

    // ================================================================
    // CREATE COPY
    // ================================================================
    return await create(
      {
        header: newHeader,
        items: newItems,
      },
      {
        ...ctx,

        // Copying should not reserve/check the original stock lots.
        skipStockValidation: true,
      }
    );
  } catch (err) {
    console.error(
      `[budgetsApi.copyFromBudget] Erro ao copiar orçamento ${bid}:`,
      err
    );

    return {
      ok: false,
      error: String(err?.message || err),
    };
  }
}
