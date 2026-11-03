// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvStarterSales.repository.js — Gravação das vendas do caixa        ║
// ║ Idempotente por pdv_uuid: o caixa reenvia a fila offline sem duplicar║
// ╚════════════════════════════════════════════════════════════════════╝

import crypto from 'node:crypto';
import pool from '../../config/db.js';
import { TB_SALES, TB_SALES_ITEMS, ORIGIN, PAYMENT_CODES } from './pdvStarter.constants.js';
import { resolveSaleIdStrategy } from './pdvStarterSchema.repository.js';
import { debitSaleStock } from './pdvStarterStock.repository.js';
import { getSession } from './pdvStarterCash.repository.js';
import { toMoney, toQty, cleanText, onlyDigits, pdvError } from './pdvStarter.utils.js';

function normalizeSale(payload) {
  const pdvUuid = cleanText(payload?.pdv_uuid, 64);
  if (!pdvUuid) throw pdvError('Venda sem identificador (pdv_uuid).', 'PDV_UUID_REQUIRED', 400);

  const items = (Array.isArray(payload?.items) ? payload.items : []).map((it, idx) => {
    const quantity = toQty(it.quantity);
    const unitPrice = toMoney(it.unit_price);
    const discount = toMoney(it.discount);
    return {
      item_number: idx + 1,
      product_code: cleanText(it.product_code, 50),
      description: cleanText(it.description, 500),
      barcode: cleanText(it.barcode, 100),
      unit: cleanText(it.unit, 10) || 'UN',
      unit_factor: Number(it.unit_factor) > 0 ? toQty(it.unit_factor) : 1,
      quantity,
      unit_price: unitPrice,
      discount,
      total: toMoney(quantity * unitPrice - discount),
    };
  });

  if (!items.length) throw pdvError('Venda sem itens.', 'SALE_WITHOUT_ITEMS', 400);
  const bad = items.find((it) => !it.product_code || !(it.quantity > 0) || it.total < 0);
  if (bad) throw pdvError(`Item ${bad.item_number} inválido.`, 'INVALID_ITEM', 400, { item: bad });

  const payments = (Array.isArray(payload?.payments) ? payload.payments : [])
    .map((p) => ({
      method: PAYMENT_CODES.has(String(p.method).toUpperCase()) ? String(p.method).toUpperCase() : 'OUTROS',
      amount: toMoney(p.amount),
      details: cleanText(p.details, 200),
    }))
    .filter((p) => p.amount > 0);

  const subtotal = toMoney(items.reduce((s, it) => s + it.quantity * it.unit_price, 0));
  const itemDiscounts = toMoney(items.reduce((s, it) => s + it.discount, 0));
  const saleDiscount = toMoney(payload?.discount);
  const total = toMoney(subtotal - itemDiscounts - saleDiscount);
  const received = toMoney(payments.reduce((s, p) => s + p.amount, 0));

  if (total < 0) throw pdvError('Desconto maior que o valor da venda.', 'INVALID_DISCOUNT', 400);
  if (received + 0.009 < total) {
    throw pdvError('Pagamento menor que o total da venda.', 'PAYMENT_INSUFFICIENT', 400, { total, received });
  }

  // Troco só pode sair do dinheiro recebido
  const cashReceived = payments.filter((p) => p.method === 'DINHEIRO').reduce((s, p) => s + p.amount, 0);
  const change = toMoney(Math.min(received - total, cashReceived));

  return {
    pdv_uuid: pdvUuid,
    session_id: Number(payload?.session_id) || null,
    terminal: cleanText(payload?.terminal, 40),
    customer_name: cleanText(payload?.customer_name, 200) || 'CONSUMIDOR FINAL',
    customer_doc: onlyDigits(payload?.customer_doc),
    sold_at: payload?.sold_at ? new Date(payload.sold_at) : new Date(),
    subtotal,
    discount: toMoney(itemDiscounts + saleDiscount),
    total,
    recebido: received,
    troco: change,
    payments,
    items,
  };
}

async function findByUuid(db, pdvUuid) {
  const { rows } = await db.query(`SELECT * FROM ${TB_SALES} WHERE pdv_uuid = $1 LIMIT 1`, [pdvUuid]);
  return rows[0] || null;
}

export async function findSaleByUuid(pdvUuid) {
  return findByUuid(pool, cleanText(pdvUuid, 64));
}

async function insertSaleRow(client, sale, user) {
  const strategy = await resolveSaleIdStrategy();
  const cols = [
    'created_at', 'sold_at', 'synced_at', 'customer_name', 'customer_doc', 'recebido', 'troco', 'status',
    'nfce_status', 'pdv_uuid', 'pdv_origin', 'session_id', 'terminal', 'operator_id', 'operator_name',
    'subtotal', 'discount', 'total', 'payments',
  ];
  const values = [
    sale.sold_at, sale.sold_at, new Date(), sale.customer_name, sale.customer_doc, sale.recebido, sale.troco,
    'FECHADA', 'PENDENTE', sale.pdv_uuid, ORIGIN, sale.session_id, sale.terminal, user.pdv_user_id,
    user.full_name, sale.subtotal, sale.discount, sale.total, JSON.stringify(sale.payments),
  ];

  if (strategy === 'MAX_PLUS_ONE') {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('pdvSales.sale_id'))`);
    const { rows } = await client.query(`SELECT COALESCE(MAX(sale_id), 0) + 1 AS next_id FROM ${TB_SALES}`);
    cols.unshift('sale_id');
    values.unshift(rows[0].next_id);
  } else if (strategy === 'UUID') {
    cols.unshift('sale_id');
    values.unshift(crypto.randomUUID());
  }

  const placeholders = cols.map((c, i) => (c === 'payments' ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const { rows } = await client.query(
    `INSERT INTO ${TB_SALES} (${cols.map((c) => `"${c}"`).join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return rows[0];
}

export async function createSale(payload, user) {
  const sale = normalizeSale(payload);

  const existing = await findByUuid(pool, sale.pdv_uuid);
  if (existing) return { sale: existing, duplicated: true };

  if (sale.session_id) {
    const session = await getSession(sale.session_id);
    if (!session) throw pdvError('Caixa da venda não encontrado.', 'SESSION_NOT_FOUND', 404);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await insertSaleRow(client, sale, user);

    for (const it of sale.items) {
      await client.query(
        `INSERT INTO ${TB_SALES_ITEMS}
           (sale_id, item_number, product_code, description, barcode, unit, unit_factor, quantity, unit_price, discount, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [row.sale_id, it.item_number, it.product_code, it.description, it.barcode, it.unit,
          it.unit_factor, it.quantity, it.unit_price, it.discount, it.total],
      );
    }

    const stock = await debitSaleStock(client, { ...row, pdv_uuid: sale.pdv_uuid }, sale.items);
    const { rows } = await client.query(
      `UPDATE ${TB_SALES} SET stock_status = $2, stock_details = $3::jsonb WHERE sale_id = $1 RETURNING *`,
      [row.sale_id, stock.status, JSON.stringify(stock.details)],
    );

    await client.query('COMMIT');
    return { sale: rows[0], duplicated: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      const again = await findByUuid(pool, sale.pdv_uuid);
      if (again) return { sale: again, duplicated: true };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listSales({ sessionId, limit = 50 } = {}) {
  const params = [];
  const where = [`pdv_origin = '${ORIGIN}'`];
  if (sessionId) {
    params.push(Number(sessionId));
    where.push(`session_id = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 50, 500));
  const { rows } = await pool.query(
    `SELECT sale_id, pdv_uuid, sold_at, created_at, customer_name, total, recebido, troco, status,
            nfce_status, nfce_number, nfce_message, stock_status, operator_name, terminal
       FROM ${TB_SALES}
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}
