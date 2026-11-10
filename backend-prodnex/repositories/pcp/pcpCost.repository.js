// ╔════════════════════════════════════════════════════════════════════╗
// ║ pcpCost.repository.js — Custo do produto pelos ingredientes        ║
// ║ products.cost_price = Σ fração ideal × (1 + perda %) × custo do    ║
// ║ ingrediente, pela ficha técnica ativa. Recalcula em cascata quem   ║
// ║ usa o produto como ingrediente (massa → pão → kit).                ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_BOM, TB_BOM_ITEMS, TB_PRODUCTS } from './pcp.constants.js';
import { badRequest } from './pcp.sanitizers.js';

/** Se a perda % da linha entra no custo (false = só a fração ideal). */
export const COST_INCLUDES_LOSS = true;

// products.cost_price é NUMERIC(14,2): grava e propaga com 2 casas, igual ao banco.
const DECIMALS = 2;

function round(n, d = DECIMALS) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Fração ideal: quanto do ingrediente vai em 1 unidade do produto. */
export function idealFraction(quantity, baseQty) {
  const base = Number(baseQty) || 1;
  return (Number(quantity) || 0) / base;
}

/** Custo do ingrediente em 1 unidade do produto. */
export function itemUnitCost({ quantity, loss_percent }, baseQty, componentCost) {
  const loss = COST_INCLUDES_LOSS ? (Number(loss_percent) || 0) / 100 : 0;
  return idealFraction(quantity, baseQty) * (1 + loss) * (Number(componentCost) || 0);
}

// ── Grafo das fichas ativas ───────────────────────────────────

/** Fichas ativas: produto → { base_qty, items } e o inverso (ingrediente → produtos). */
async function loadGraph(client) {
  const { rows } = await client.query(
    `SELECT b.product_code, b.base_qty, i.component_code, i.quantity, i.loss_percent
       FROM ${TB_BOM} b
       LEFT JOIN ${TB_BOM_ITEMS} i ON i.bom_id = b.bom_id
      WHERE b.is_active = TRUE`
  );
  const boms = new Map();
  const usedBy = new Map();
  for (const r of rows) {
    if (!boms.has(r.product_code)) boms.set(r.product_code, { base_qty: r.base_qty, items: [] });
    if (!r.component_code) continue;
    boms.get(r.product_code).items.push(r);
    if (!usedBy.has(r.component_code)) usedBy.set(r.component_code, new Set());
    usedBy.get(r.component_code).add(r.product_code);
  }
  return { boms, usedBy };
}

/** Produtos afetados: os informados + todos que os usam, em qualquer nível. */
function upwardClosure(codes, { boms, usedBy }) {
  const out = new Set();
  const stack = [...codes];
  while (stack.length) {
    const code = stack.pop();
    if (out.has(code)) continue;
    out.add(code);
    for (const parent of usedBy.get(code) || []) stack.push(parent);
  }
  return [...out].filter((c) => boms.has(c));
}

/** Ordem de cálculo: ingredientes com ficha própria antes de quem os usa. */
function dependencyOrder(codes, { boms }) {
  const wanted = new Set(codes);
  const done = new Set();
  const visiting = new Set();
  const order = [];
  const visit = (code) => {
    if (done.has(code) || visiting.has(code)) return; // ciclo: ignora a aresta
    visiting.add(code);
    for (const it of boms.get(code)?.items || []) {
      if (wanted.has(it.component_code)) visit(it.component_code);
    }
    visiting.delete(code);
    done.add(code);
    order.push(code);
  };
  codes.forEach(visit);
  return order;
}

/** Verdadeiro se o produto aparece na própria estrutura (direta ou indiretamente). */
function hasCycle(productCode, { boms }) {
  const seen = new Set();
  const stack = (boms.get(productCode)?.items || []).map((i) => i.component_code);
  while (stack.length) {
    const code = stack.pop();
    if (code === productCode) return true;
    if (seen.has(code)) continue;
    seen.add(code);
    for (const it of boms.get(code)?.items || []) stack.push(it.component_code);
  }
  return false;
}

/** Barra a ficha que usa o próprio produto em algum nível (ex.: A → B → A). */
export async function assertNoCycle(productCode, client = pool) {
  if (hasCycle(productCode, await loadGraph(client))) {
    throw badRequest(`A estrutura de ${productCode} usa o próprio produto em algum nível (ciclo entre fichas).`);
  }
}

// ── Recalcular e gravar products.cost_price ───────────────────

async function recalc(codes, client) {
  const graph = await loadGraph(client);
  const targets = codes === null ? [...graph.boms.keys()] : upwardClosure(codes, graph);
  if (!targets.length) return { updated: [], unchanged: 0 };

  const order = dependencyOrder(targets, graph);
  const needed = new Set(order);
  for (const code of order) for (const it of graph.boms.get(code).items) needed.add(it.component_code);

  const { rows } = await client.query(
    `SELECT product_code, COALESCE(cost_price, 0) AS cost_price
       FROM ${TB_PRODUCTS} WHERE product_code = ANY($1::varchar[])`,
    [[...needed]]
  );
  const cost = new Map(rows.map((r) => [r.product_code, Number(r.cost_price)]));

  const updated = [];
  let unchanged = 0;
  for (const code of order) {
    const bom = graph.boms.get(code);
    if (!bom.items.length || !cost.has(code)) continue; // ficha vazia não zera o custo
    const next = round(bom.items.reduce(
      (sum, it) => sum + itemUnitCost(it, bom.base_qty, cost.get(it.component_code)), 0));
    const prev = cost.get(code);
    cost.set(code, next);
    if (round(prev) === next) { unchanged += 1; continue; }
    await client.query(
      `UPDATE ${TB_PRODUCTS} SET cost_price = $2, updated_at = NOW() WHERE product_code = $1`,
      [code, next]
    );
    updated.push({ product_code: code, old_cost: prev, new_cost: next });
  }
  return { updated, unchanged };
}

/** Recalcula os produtos informados e, em cascata, os que os usam como ingrediente. */
export function recalcFrom(productCodes, client = pool) {
  const codes = (Array.isArray(productCodes) ? productCodes : [productCodes]).filter(Boolean);
  return codes.length ? recalc(codes, client) : { updated: [], unchanged: 0 };
}

/** Recalcula todos os produtos com ficha técnica ativa (botão "Recalcular custos"). */
export async function recalcAll() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await recalc(null, client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
