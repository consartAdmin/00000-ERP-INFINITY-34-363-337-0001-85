// ╔════════════════════════════════════════════════════════════════════╗
// ║ pcpCost.repository.js — Custo do produto pelos ingredientes        ║
// ║ products.cost_price = Σ fração ideal × (1 + perda %) × custo do    ║
// ║ ingrediente, pela ficha técnica ativa. Recalcula em cascata quem   ║
// ║ usa o produto como ingrediente (massa → pão → kit).                ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_BOM, TB_BOM_ITEMS, TB_PRODUCTS, TB_BAR_CODES } from './pcp.constants.js';
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
export function itemUnitCost({ quantity, loss_percent, unit_factor = 1 }, baseQty, componentCost) {
  const loss = COST_INCLUDES_LOSS ? (Number(loss_percent) || 0) / 100 : 0;
  return idealFraction(quantity, baseQty) * (Number(unit_factor) || 1) * (1 + loss) * (Number(componentCost) || 0);
}

// ── Unidades do ingrediente ───────────────────────────────────
// A quantidade da linha pode estar em outra unidade (ex.: receita em G,
// ingrediente com custo por KG). Converte para a unidade base do ingrediente
// (a de fator 1 no productsBarCode), que é a unidade do cost_price.

const METRIC = {
  KG: ['MASSA', 1], G: ['MASSA', 0.001], MG: ['MASSA', 0.000001], T: ['MASSA', 1000],
  L: ['VOLUME', 1], ML: ['VOLUME', 0.001],
};
const ALIASES = { KGS: 'KG', KILO: 'KG', QUILO: 'KG', GR: 'G', GRS: 'G', GRAMA: 'G', LT: 'L', LTS: 'L', LITRO: 'L', TON: 'T' };

export function normUnit(u) {
  const k = String(u ?? '').trim().toUpperCase();
  return ALIASES[k] || k;
}

/** Unidades de cada ingrediente: { base, packs: Map(unidade → fator) }. */
export async function loadUnits(codes, client = pool) {
  const out = new Map(codes.map((c) => [c, { base: '', packs: new Map() }]));
  if (!codes.length) return out;
  const { rows } = await client.query(
    `SELECT product_code, unit, COALESCE(fator, 1)::float AS fator, COALESCE(standard, FALSE) AS standard
       FROM ${TB_BAR_CODES}
      WHERE product_code = ANY($1::varchar[]) AND COALESCE(is_active, TRUE)
        AND COALESCE(TRIM(unit), '') <> ''
      ORDER BY (COALESCE(fator, 1) = 1) DESC, COALESCE(standard, FALSE) DESC, barcode_id`,
    [codes]
  );
  for (const r of rows) {
    const u = out.get(r.product_code);
    const unit = normUnit(r.unit);
    if (!u.base && Number(r.fator) === 1) u.base = unit;
    if (Number(r.fator) > 0 && !u.packs.has(unit)) u.packs.set(unit, Number(r.fator));
  }
  for (const u of out.values()) if (!u.base && u.packs.size) u.base = [...u.packs.keys()][0];
  return out;
}

/** Fator para converter 1 unidade da linha na unidade base do ingrediente (null = não converte). */
export function unitFactor(unit, units) {
  const u = normUnit(unit);
  const base = units?.base || '';
  if (!u || u === base) return 1;
  const a = METRIC[u];
  const b = METRIC[base];
  if (a && b && a[0] === b[0]) return a[1] / b[1];
  if (units?.packs?.has(u)) return units.packs.get(u) / (units.packs.get(base) || 1);
  return null;
}

/** Unidades que a linha do ingrediente pode usar (para o select da tela). */
export function unitOptions(units) {
  const base = units?.base || '';
  const list = [];
  const add = (unit) => {
    const factor = unitFactor(unit, units);
    if (unit && factor != null && !list.some((o) => o.unit === unit)) list.push({ unit, factor });
  };
  add(base);
  const fam = METRIC[base]?.[0];
  if (fam) Object.keys(METRIC).filter((k) => METRIC[k][0] === fam).forEach(add);
  for (const unit of units?.packs?.keys() || []) add(unit);
  return list;
}

export async function componentUnits(code) {
  const units = (await loadUnits([code])).get(code);
  const { rows: [p] } = await pool.query(
    `SELECT COALESCE(cost_price, 0)::float AS cost_price FROM ${TB_PRODUCTS} WHERE product_code = $1`, [code]);
  return { base_unit: units.base, units: unitOptions(units), cost_price: p?.cost_price ?? 0 };
}

// ── Grafo das fichas ativas ───────────────────────────────────

/** Fichas ativas: produto → { base_qty, items } e o inverso (ingrediente → produtos). */
async function loadGraph(client) {
  const { rows } = await client.query(
    `SELECT b.product_code, b.base_qty, i.component_code, i.quantity, i.loss_percent, i.unit
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

  const units = await loadUnits([...needed], client);
  for (const code of order) {
    for (const it of graph.boms.get(code).items) {
      it.unit_factor = unitFactor(it.unit, units.get(it.component_code)) ?? 1;
    }
  }

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
