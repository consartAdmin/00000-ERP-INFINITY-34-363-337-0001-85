// ╔══════════════════════════════════════════════════════════════════════╗
// ║ budgetsCopy.repository.js — copyFromBudget                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { getById } from './budgetsGetById.repository.js';
import { create } from './budgetsCreate.repository.js';

// ----------------------------------------------------------------------
// Copy
// ----------------------------------------------------------------------
export async function copyFromBudget(sourceBudgetId, ctx = {}) {
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
    const srcItems = Array.isArray(source.items)
      ? source.items
      : [];

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
    const newItems = srcItems.map((it) => ({
      product_code: it.product_code ?? null,
      barcode_id: it.barcode_id ?? null,

      manufacturer_ref:
        it.manufacturer_ref ??
        null,

      description:
        it.description ??
        '',

      grade_id:
        it.grade_id ??
        null,

      unit_code: it.unit_code ?? it.unit ?? 'UN',
      conversion_factor: Number(it.conversion_factor || 1),

      quantity:
        Number(it.quantity || 0),

      unit_price:
        Number(it.unit_price || 0),

      discount_value:
        Number(it.discount_value || 0),

      price_id:
        it.price_id ??
        null,

      // Do not inherit commission from original budget
      commission_id: null,

      // Do not inherit stock allocation / lot
      lot_id: null,

      override_stock: false,
      override_token: null,
    }));

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
