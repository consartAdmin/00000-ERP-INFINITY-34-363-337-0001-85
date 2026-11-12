// ╔════════════════════════════════════════════════════════════════════╗
// ║ usoConsumoDirect.repository.js — Uso e Consumo sem orçamento       ║
// ║ ✔ productInfo: custo, estoque, U.M, grades e lotes (FEFO)          ║
// ║ ✔ saveDraft: cria/edita rascunho com itens                         ║
// ║ ✔ finish: baixa estoque (lote ou simples) + productMovements       ║
// ║ ✔ remove: exclui rascunho, ou estorna estoque de um finalizado     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_USO, TB_USO_ITEMS } from './usoConsumo.constants.js';
import { safeText, safeNumber } from './usoConsumo.sanitizers.js';
import { getById } from './usoConsumoQuery.repository.js';
import { ensureUsoConsumoSchema } from './usoConsumoSchema.repository.js';
import { resolveProductsStockMode } from '../productsStock/productsStock.manager.js';
import { getFactorsByProductCodes } from '../productsBarCode/productsBarCodeQuery.repository.js';

const TB_PRODUCTS = 'public.products';
const TB_STOCK = 'public."productsStock"';
const TB_LOTS = 'public."productsStockLots"';
const TB_GRADES = 'public."productsGrades"';
const TB_GRADES_CATALOG = 'public.grades';
const TB_MOVEMENTS = 'public."productMovements"';

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const round4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;
const positiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  if (code) error.code = code;
  return error;
}

function normalizeDate(value) {
  const text = safeText(value);
  if (!text) return null;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function nfeIsActive(header) {
  const status = String(header?.nfe_status || '').toUpperCase();
  if (!header?.invoice_id) return false;
  return !['REJEITADA', 'CANCELADA', 'CANCELADO', 'DENEGADA'].includes(status);
}

// ======================================================================
// PRODUTO (custo, estoque, U.M, grades e lotes)
// ======================================================================

async function loadProduct(productCode, db = pool) {
  const { rows } = await db.query(
    `
      SELECT
        p.product_id,
        p.product_code,
        p.description,
        p.product_stock_id,
        COALESCE(p.cost_price, 0)::numeric AS cost_price,
        COALESCE(ps.stock_qty, 0)::numeric AS stock_qty
      FROM ${TB_PRODUCTS} p
      LEFT JOIN ${TB_STOCK} ps
        ON ps.product_stock_id = p.product_stock_id
      WHERE p.product_code::text = $1
      LIMIT 1
    `,
    [productCode],
  );
  return rows[0] || null;
}

async function loadLots(productStockId, productGradeId = null, db = pool) {
  if (!productStockId) return [];
  const params = [productStockId];
  let gradeFilter = '';
  if (productGradeId) {
    params.push(productGradeId);
    gradeFilter = `AND COALESCE(l.product_grade_id, 0) = COALESCE($2::bigint, 0)`;
  }

  const { rows } = await db.query(
    `
      SELECT
        l.lot_id,
        l.lot_code,
        l.product_grade_id,
        l.expires_at,
        COALESCE(l.qty_on_hand, 0)::numeric AS qty_on_hand,
        COALESCE(l.qty_reserved, 0)::numeric AS qty_reserved,
        (COALESCE(l.qty_on_hand, 0) - COALESCE(l.qty_reserved, 0))::numeric AS qty_available
      FROM ${TB_LOTS} l
      WHERE l.product_stock_id = $1
        AND COALESCE(l.is_active, TRUE) = TRUE
        AND l.deleted_at IS NULL
        AND NULLIF(to_jsonb(l) ->> 'blocked_at', '') IS NULL
        AND (COALESCE(l.qty_on_hand, 0) - COALESCE(l.qty_reserved, 0)) > 0
        ${gradeFilter}
      ORDER BY l.expires_at NULLS LAST, l.lot_code ASC, l.lot_id ASC
    `,
    params,
  );
  return rows;
}

export async function productInfo(productCode, { productGradeId = null } = {}) {
  await ensureUsoConsumoSchema();

  const code = safeText(productCode);
  if (!code) throw httpError(400, 'Produto inválido.');

  const product = await loadProduct(code);
  if (!product) throw httpError(404, `Produto ${code} não encontrado.`);

  const [stockMode, units, gradesResult] = await Promise.all([
    resolveProductsStockMode(),
    // U.M. e fatores por produto ficam em productsBarCode (mesma fonte do Orçamento).
    getFactorsByProductCodes(pool, [product.product_code]).catch(() => []),
    pool.query(
      `
        SELECT pg.product_grade_id, g.grade, g.description
        FROM ${TB_GRADES} pg
        JOIN ${TB_GRADES_CATALOG} g ON g.grade_id = pg.grade_id
        WHERE pg.product_id = $1
          AND pg.is_active IS DISTINCT FROM FALSE
        ORDER BY g.grade ASC
      `,
      [product.product_id],
    ).catch(() => ({ rows: [] })),
  ]);

  const lots = stockMode.requireLot
    ? await loadLots(product.product_stock_id, positiveInt(productGradeId))
    : [];

  const unitList = (units || [])
    .filter((u) => String(u.unit || '').trim())
    .map((u) => ({
      unit: String(u.unit).trim().toUpperCase(),
      factor: Number(u.factor ?? u.fator ?? 1) || 1,
      standard: Boolean(u.standard),
    }))
    .sort((a, b) => Number(b.standard) - Number(a.standard) || a.factor - b.factor);

  return {
    product_code: product.product_code,
    product_id: product.product_id,
    description: product.description,
    cost_price: Number(product.cost_price || 0),
    stock_qty: Number(product.stock_qty || 0),
    stock_mode: stockMode.mode,
    require_lot: Boolean(stockMode.requireLot),
    units: unitList.length ? unitList : [{ unit: 'UN', factor: 1, standard: true }],
    grades: gradesResult.rows.map((g) => ({
      product_grade_id: g.product_grade_id,
      label: safeText(g.description || g.grade) || String(g.grade || ''),
    })),
    lots: lots.map((l) => ({
      lot_id: l.lot_id,
      lot_code: l.lot_code,
      product_grade_id: l.product_grade_id,
      expires_at: l.expires_at,
      qty_available: Number(l.qty_available || 0),
    })),
  };
}

// ======================================================================
// RASCUNHO (criar / editar)
// ======================================================================

async function normalizeItems(rawItems, db) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  if (!list.length) throw httpError(400, 'Adicione pelo menos um item.');

  const items = [];
  for (const raw of list) {
    const productCode = safeText(raw.product_code);
    const quantity = safeNumber(raw.quantity);
    if (!productCode) throw httpError(400, 'Item sem produto.');
    if (!(quantity > 0)) throw httpError(400, `Quantidade inválida no produto ${productCode}.`);

    const product = await loadProduct(productCode, db);
    if (!product) throw httpError(404, `Produto ${productCode} não encontrado.`);

    const factor = safeNumber(raw.unit_factor) > 0 ? safeNumber(raw.unit_factor) : 1;
    // Custo sempre do cadastro do produto (não confia no navegador).
    const costPrice = round4(Number(product.cost_price || 0) * factor);

    items.push({
      product_code: product.product_code,
      description: safeText(raw.description) || product.description,
      product_grade_id: positiveInt(raw.product_grade_id),
      grade_label: safeText(raw.grade_label) || null,
      lot_id: positiveInt(raw.lot_id),
      lot_code: safeText(raw.lot_code) || null,
      expires_at: normalizeDate(raw.expires_at),
      unit: safeText(raw.unit).toUpperCase() || 'UN',
      unit_factor: factor,
      quantity,
      cost_price: costPrice,
      total_cost: round2(costPrice * quantity),
    });
  }
  return items;
}

async function loadFiscalBySku(skus, db) {
  if (!skus.length) return {};
  const { rows } = await db.query(
    `
      SELECT pf.product_code::text AS sku, fc.ncm_code AS ncm, fp.icms_cst AS cst_icms
      FROM public."productsFiscalV2" pf
      LEFT JOIN public."fiscalClassificationV2" fc
        ON fc.fiscal_classification_id = pf.fiscal_classification_id AND fc.is_active = TRUE
      LEFT JOIN public."fiscalProfileV2" fp
        ON fp.fiscal_profile_id = fc.fiscal_profile_id AND fp.is_active = TRUE
      WHERE pf.product_code::text = ANY($1::text[])
        AND pf.is_current = TRUE
        AND pf.is_active = TRUE
    `,
    [skus],
  ).catch(() => ({ rows: [] }));
  return Object.fromEntries(rows.map((r) => [String(r.sku), r]));
}

function normalizeHeader(payload = {}) {
  const header = {
    movement_date: normalizeDate(payload.movement_date) || new Date().toISOString().slice(0, 10),
    cfop: safeText(payload.cfop) || '5.949',
    department: safeText(payload.department),
    employee_department_id: positiveInt(payload.employee_department_id),
    responsible: safeText(payload.responsible),
    employee_id: positiveInt(payload.employee_id),
    reason: safeText(payload.reason),
  };
  if (!header.department) throw httpError(400, 'Departamento é obrigatório.');
  if (!header.responsible) throw httpError(400, 'Responsável é obrigatório.');
  if (!header.reason) throw httpError(400, 'Motivo é obrigatório.');
  return header;
}

export async function saveDraft(id, payload = {}) {
  await ensureUsoConsumoSchema();

  const header = normalizeHeader(payload);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const items = await normalizeItems(payload.items, client);
    const fiscal = await loadFiscalBySku(items.map((i) => i.product_code), client);
    const totalAmount = round2(items.reduce((acc, i) => acc + i.total_cost, 0));

    let usoId = positiveInt(id);

    if (usoId) {
      const { rows } = await client.query(
        `SELECT uso_consumo_id, status FROM ${TB_USO} WHERE uso_consumo_id = $1 FOR UPDATE`,
        [usoId],
      );
      if (!rows[0]) throw httpError(404, `Registro ${usoId} não encontrado.`);
      if (String(rows[0].status || '').toUpperCase() !== 'RASCUNHO') {
        throw httpError(409, 'Somente rascunhos podem ser editados.');
      }

      await client.query(
        `
          UPDATE ${TB_USO}
          SET movement_date = $2, cfop = $3, department = $4, employee_department_id = $5,
              responsible = $6, employee_id = $7, reason = $8, total_amount = $9, updated_at = NOW()
          WHERE uso_consumo_id = $1
        `,
        [usoId, header.movement_date, header.cfop, header.department, header.employee_department_id,
          header.responsible, header.employee_id, header.reason, totalAmount],
      );
      await client.query(`DELETE FROM ${TB_USO_ITEMS} WHERE uso_consumo_id = $1`, [usoId]);
    } else {
      const number = `UC-${String(Date.now()).slice(-8)}`;
      const { rows } = await client.query(
        `
          INSERT INTO ${TB_USO} (
            budget_id, number, movement_date, cfop, department, employee_department_id,
            responsible, employee_id, reason, status, total_amount, origin, updated_at
          )
          VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, 'RASCUNHO', $9, 'DIRETO', NOW())
          RETURNING uso_consumo_id
        `,
        [number, header.movement_date, header.cfop, header.department, header.employee_department_id,
          header.responsible, header.employee_id, header.reason, totalAmount],
      );
      usoId = rows[0].uso_consumo_id;
    }

    for (const item of items) {
      const f = fiscal[item.product_code] || {};
      await client.query(
        `
          INSERT INTO ${TB_USO_ITEMS} (
            uso_consumo_id, budget_item_id, product_code, description, product_grade_id, grade_label,
            lot_id, lot_code, expires_at, unit, unit_factor, quantity, cost_price, total_cost,
            cfop, ncm, cst_icms
          )
          VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `,
        [usoId, item.product_code, item.description, item.product_grade_id, item.grade_label,
          item.lot_id, item.lot_code, item.expires_at, item.unit, item.unit_factor, item.quantity,
          item.cost_price, item.total_cost, header.cfop, f.ncm || null, f.cst_icms || null],
      );
    }

    await client.query('COMMIT');
    return getById(usoId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ======================================================================
// ESTOQUE (baixa e estorno)
// ======================================================================

async function currentStock(client, productStockId) {
  const { rows } = await client.query(
    `SELECT COALESCE(stock_qty, 0)::numeric AS stock_qty FROM ${TB_STOCK} WHERE product_stock_id = $1`,
    [productStockId],
  );
  return Number(rows[0]?.stock_qty || 0);
}

/**
 * delta < 0 baixa, delta > 0 estorna.
 * Com lote: mexe só em qty_on_hand (o trigger recalcula productsStock);
 * não toca em qty_reserved, para não liberar reservas de pedidos.
 */
async function moveItemStock(client, { item, product, delta, useLot }) {
  const previousStock = await currentStock(client, product.product_stock_id);

  if (useLot) {
    const { rows } = await client.query(
      `
        SELECT lot_id, lot_code,
               (COALESCE(qty_on_hand, 0) - COALESCE(qty_reserved, 0))::numeric AS qty_available
        FROM ${TB_LOTS}
        WHERE lot_id = $1 AND product_stock_id = $2
          AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL
        FOR UPDATE
      `,
      [item.lot_id, product.product_stock_id],
    );
    const lot = rows[0];
    if (!lot) throw httpError(404, `Lote ${item.lot_code || item.lot_id} não encontrado para o produto ${item.product_code}.`);
    // O lote não pode ficar negativo (CHECK qty_on_hand >= 0): baixa só o
    // saldo que existe e o restante fica registrado como "sem saldo".
    const applied = delta < 0
      ? -Math.min(Math.abs(delta), Math.max(0, Number(lot.qty_available) || 0))
      : delta;
    if (applied !== 0) {
      await client.query(
        `UPDATE ${TB_LOTS} SET qty_on_hand = COALESCE(qty_on_hand, 0) + $2, updated_at = NOW() WHERE lot_id = $1`,
        [item.lot_id, applied],
      );
    }
    const newStock = await currentStock(client, product.product_stock_id);
    return { previousStock, newStock, applied: round4(applied) };
  }

  // Sem lote: o estoque pode ficar zerado ou negativo (uso e consumo não trava).
  await client.query(
    `UPDATE ${TB_STOCK} SET stock_qty = COALESCE(stock_qty, 0) + $2 WHERE product_stock_id = $1`,
    [product.product_stock_id, delta],
  );

  const newStock = await currentStock(client, product.product_stock_id);
  return { previousStock, newStock, applied: round4(delta) };
}

/** Estorno das baixas antigas (vindas do orçamento): só productsStock. */
async function moveLegacyStock(client, { item, product, delta }) {
  const previousStock = await currentStock(client, product.product_stock_id);
  await client.query(
    `UPDATE ${TB_STOCK} SET stock_qty = COALESCE(stock_qty, 0) + $2 WHERE product_stock_id = $1`,
    [product.product_stock_id, delta],
  );
  return { previousStock, newStock: await currentStock(client, product.product_stock_id) };
}

async function recordMovement(client, { uso, item, delta, previousStock, newStock, type, notes }) {
  await client.query(
    `
      INSERT INTO ${TB_MOVEMENTS} (
        product_code, movement_type, origin_module, origin_table, origin_id,
        quantity, previous_stock, new_stock, unit, lot_code, notes, metadata, created_at
      )
      VALUES ($1, $2, 'usoConsumo', 'usoConsumo', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
    `,
    [
      item.product_code,
      type,
      uso.uso_consumo_id,
      delta,
      previousStock,
      newStock,
      item.unit || 'UN',
      item.lot_code || null,
      notes,
      JSON.stringify({
        uso_consumo_id: uso.uso_consumo_id,
        uso_consumo_item_id: item.uso_consumo_item_id,
        lot_id: item.lot_id || null,
        unit_factor: Number(item.unit_factor || 1),
        department: uso.department,
        responsible: uso.responsible,
        cfop: uso.cfop,
      }),
    ],
  );
}

// ======================================================================
// FINALIZAR (baixa o estoque)
// ======================================================================

export async function finish(id) {
  await ensureUsoConsumoSchema();

  const usoId = positiveInt(id);
  if (!usoId) throw httpError(400, 'uso_consumo_id inválido.');

  const stockMode = await resolveProductsStockMode();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`SELECT * FROM ${TB_USO} WHERE uso_consumo_id = $1 FOR UPDATE`, [usoId]);
    const uso = rows[0];
    if (!uso) throw httpError(404, `Registro ${usoId} não encontrado.`);
    if (String(uso.status || '').toUpperCase() !== 'RASCUNHO') {
      throw httpError(409, 'Este registro já foi finalizado.');
    }

    const { rows: items } = await client.query(
      `SELECT * FROM ${TB_USO_ITEMS} WHERE uso_consumo_id = $1 ORDER BY uso_consumo_item_id`,
      [usoId],
    );
    if (!items.length) throw httpError(400, 'Este registro não possui itens.');

    // Estoque zerado ou negativo não bloqueia o uso e consumo nem a NF-e.
    // Modo por lote: item sem lote (nenhum lote com saldo) não baixa lote, e o
    // que passar do saldo do lote fica como "sem saldo" no item.
    for (const item of items) {
      const product = await loadProduct(item.product_code, client);
      const qtyBase = round4(Number(item.quantity) * (Number(item.unit_factor) || 1));
      let debited = 0;

      if (product?.product_stock_id && qtyBase > 0) {
        const hasLot = Boolean(positiveInt(item.lot_id));
        if (!stockMode.requireLot || hasLot) {
          const moved = await moveItemStock(client, {
            item, product, delta: -qtyBase, useLot: stockMode.requireLot,
          });
          debited = round4(Math.abs(moved.applied));
          const missing = round4(qtyBase - debited);
          if (debited > 0) {
            await recordMovement(client, {
              uso, item, delta: -debited, previousStock: moved.previousStock, newStock: moved.newStock,
              type: 'USO_CONSUMO',
              notes: `Uso e consumo ${uso.number} (${uso.department}). CFOP ${uso.cfop}.${missing > 0 ? ` Sem saldo no lote: ${missing} não baixado.` : ''}`,
            });
          }
        }
      }

      await client.query(
        `UPDATE ${TB_USO_ITEMS} SET stock_debited_qty = $2 WHERE uso_consumo_item_id = $1`,
        [item.uso_consumo_item_id, debited],
      );
    }

    await client.query(
      `UPDATE ${TB_USO} SET status = 'FINALIZADO', finished_at = NOW(), updated_at = NOW() WHERE uso_consumo_id = $1`,
      [usoId],
    );

    await client.query('COMMIT');
    return getById(usoId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ======================================================================
// EXCLUIR (rascunho) / ESTORNAR (finalizado sem NF-e válida)
// ======================================================================

export async function remove(id) {
  await ensureUsoConsumoSchema();

  const usoId = positiveInt(id);
  if (!usoId) throw httpError(400, 'uso_consumo_id inválido.');

  const current = await getById(usoId);
  if (!current.header) throw httpError(404, `Registro ${usoId} não encontrado.`);
  if (nfeIsActive(current.header)) {
    throw httpError(
      409,
      `Este registro tem NF-e ${current.header.nfe_number || ''} ${String(current.header.nfe_status || 'em processamento').toLowerCase()}. Cancele a NF-e antes de excluir.`.replace(/\s+/g, ' '),
    );
  }

  const stockMode = await resolveProductsStockMode();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`SELECT * FROM ${TB_USO} WHERE uso_consumo_id = $1 FOR UPDATE`, [usoId]);
    const uso = rows[0];
    if (!uso) throw httpError(404, `Registro ${usoId} não encontrado.`);

    const finished = String(uso.status || '').toUpperCase() === 'FINALIZADO';
    let restored = 0;

    if (finished) {
      const { rows: items } = await client.query(
        `SELECT * FROM ${TB_USO_ITEMS} WHERE uso_consumo_id = $1 ORDER BY uso_consumo_item_id`,
        [usoId],
      );

      for (const item of items) {
        const product = await loadProduct(item.product_code, client);
        if (!product?.product_stock_id) continue;
        // Devolve só o que foi baixado de fato (stock_debited_qty); registros
        // antigos não têm a coluna preenchida e baixaram a quantidade inteira.
        const qtyBase = item.stock_debited_qty === null || item.stock_debited_qty === undefined
          ? round4(Number(item.quantity) * (Number(item.unit_factor) || 1))
          : round4(Number(item.stock_debited_qty));
        if (!(qtyBase > 0)) continue;

        // Registros antigos (do orçamento) baixaram só productsStock, sem lote.
        const useLot = stockMode.requireLot && positiveInt(item.lot_id);
        const moved = useLot
          ? await moveItemStock(client, { item, product, delta: qtyBase, useLot: true })
          : await moveLegacyStock(client, { item, product, delta: qtyBase });

        await recordMovement(client, {
          uso, item, delta: qtyBase, previousStock: moved.previousStock, newStock: moved.newStock,
          type: 'ESTORNO_USO_CONSUMO',
          notes: `Estorno do uso e consumo ${uso.number} (excluído).`,
        });
        restored += 1;
      }

      if (uso.budget_id) {
        await client.query(
          `UPDATE public.budgets SET status = 'ABERTO', updated_at = NOW() WHERE budget_id = $1 AND status = 'USO_CONSUMO'`,
          [uso.budget_id],
        );
      }
    }

    await client.query(`DELETE FROM ${TB_USO_ITEMS} WHERE uso_consumo_id = $1`, [usoId]);
    await client.query(`DELETE FROM ${TB_USO} WHERE uso_consumo_id = $1`, [usoId]);

    await client.query('COMMIT');
    return { uso_consumo_id: usoId, number: uso.number, restored_items: restored, finished };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
