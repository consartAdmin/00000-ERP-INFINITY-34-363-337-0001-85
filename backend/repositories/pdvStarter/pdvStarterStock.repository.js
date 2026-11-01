// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarterStock.repository.js — Baixa de estoque da venda do caixa  ║
// ║ Respeita o modo do ERP (simples ou por lote, lotes em ordem FEFO)   ║
// ╚════════════════════════════════════════════════════════════════════╝

import * as productsStockManager from '../productsStock/productsStock.manager.js';

async function loadStockRow(client, productCode) {
  const { rows } = await client.query(
    `SELECT p.product_stock_id, COALESCE(ps.stock_qty, 0)::float AS stock_qty
       FROM public.products p
       LEFT JOIN public."productsStock" ps ON ps.product_stock_id = p.product_stock_id
      WHERE p.product_code = $1
      LIMIT 1`,
    [productCode],
  );
  return rows[0] || null;
}

async function currentQty(client, productStockId) {
  const { rows } = await client.query(
    `SELECT COALESCE(stock_qty, 0)::float AS stock_qty FROM public."productsStock" WHERE product_stock_id = $1`,
    [productStockId],
  );
  return Number(rows[0]?.stock_qty || 0);
}

/*
 * Lotes com saldo em ordem FEFO. O que faltar não é baixado (os lotes têm
 * CHECK qty_on_hand >= 0): a venda fica com stock_status = 'PARCIAL' e a
 * quantidade sem lote em stock_details, para conferência no ERP.
 */
async function consumeFromLots(client, productStockId, qty, options) {
  const lots = await productsStockManager.listLotsFefo(productStockId, null, options);
  const used = [];
  let remaining = qty;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(lot.qty_available || 0));
    if (take <= 0) continue;
    await productsStockManager.consumeLot({ lot_id: lot.lot_id, qty: take }, { ...options, client });
    used.push({ lot_id: lot.lot_id, lot_code: lot.lot_code, qty: take });
    remaining = Math.round((remaining - take) * 1000) / 1000;
  }

  return { used, missing: remaining };
}

async function recordMovement(client, { sale, item, quantity, previous, next, lotCode }) {
  await client.query(
    `INSERT INTO public."productMovements" (
       product_code, movement_type, origin_module, origin_table, origin_id,
       quantity, previous_stock, new_stock, unit, lot_code, notes, metadata
     ) VALUES ($1, 'SAIDA', 'pdvStarter', 'pdvSales', $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      item.product_code,
      String(sale.sale_id),
      quantity,
      previous,
      next,
      item.unit || 'UN',
      lotCode,
      `Venda PDV ${sale.terminal || ''} nº ${sale.sale_id}`.trim(),
      JSON.stringify({ source: 'pdvStarter', pdv_uuid: sale.pdv_uuid, session_id: sale.session_id }),
    ],
  );
}

/** Debita o estoque de todos os itens dentro da transação da venda. */
export async function debitSaleStock(client, sale, items) {
  const options = { scopeType: 'GLOBAL', scopeId: 1 };
  const mode = await productsStockManager.resolveProductsStockMode(options);
  const details = [];

  for (const saleItem of items) {
    // Código de barras de caixa/fardo: baixa quantidade × fator da unidade
    const factor = saleItem.unit_factor || 1;
    const item = {
      ...saleItem,
      unit: factor === 1 ? saleItem.unit : 'UN',
      quantity: Math.round(saleItem.quantity * factor * 1000) / 1000,
    };
    const stock = await loadStockRow(client, item.product_code);
    if (!stock?.product_stock_id) {
      details.push({ product_code: item.product_code, status: 'SEM_ESTOQUE_CADASTRADO' });
      continue;
    }

    const previous = await currentQty(client, stock.product_stock_id);

    if (mode.isSimple) {
      await productsStockManager.adjust(stock.product_stock_id, -item.quantity, { ...options, client });
      const next = await currentQty(client, stock.product_stock_id);
      await recordMovement(client, { sale, item, quantity: item.quantity, previous, next, lotCode: null });
      details.push({ product_code: item.product_code, status: 'OK', mode: 'SIMPLE' });
      continue;
    }

    const { used, missing } = await consumeFromLots(client, stock.product_stock_id, item.quantity, options);
    const next = await currentQty(client, stock.product_stock_id);
    const consumed = Math.round((item.quantity - missing) * 1000) / 1000;
    if (consumed > 0) {
      await recordMovement(client, {
        sale,
        item,
        quantity: consumed,
        previous,
        next,
        lotCode: used.map((u) => u.lot_code).filter(Boolean).join(',') || null,
      });
    }
    details.push({
      product_code: item.product_code,
      status: missing > 0 ? 'SEM_LOTE' : 'OK',
      mode: 'WITH_LOT',
      lots: used,
      missing,
    });
  }

  const pending = details.some((d) => d.status !== 'OK');
  return { status: pending ? 'PARCIAL' : 'OK', details };
}
