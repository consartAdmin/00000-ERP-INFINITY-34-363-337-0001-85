// ╔════════════════════════════════════════════════════════════════════╗
// ║ cashCategoryLink.repository.js — Categoria/Subcategoria do Caixa   ║
// ║ por ID em outras tabelas do Financeiro (Despesas, Compromissos)    ║
// ║ Colunas: cash_category_id / cash_subcategory_id (integer, null)    ║
// ║ → "cashCategories".id / "cashSubcategories".id                     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const ready = new Map();

/** Cria as colunas (uma vez por processo) — ADD COLUMN IF NOT EXISTS */
export function ensureCashCategoryColumns(table) {
  if (!ready.has(table)) {
    const p = pool.query(`
      ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS cash_category_id integer,
        ADD COLUMN IF NOT EXISTS cash_subcategory_id integer
    `).catch((error) => {
      ready.delete(table);
      throw error;
    });
    ready.set(table, p);
  }
  return ready.get(table);
}

function toIdOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** true quando o corpo traz algum dos campos (para não apagar sem querer) */
export function hasCashCategoryFields(body = {}) {
  return ['cash_category_id', 'cash_subcategory_id']
    .some((k) => Object.prototype.hasOwnProperty.call(body || {}, k));
}

/**
 * Grava os IDs de categoria/subcategoria do Caixa no registro.
 * Só altera o que veio no corpo. Subcategoria sem categoria é ignorada.
 */
export async function setCashCategoryLink(table, id, body = {}, client = pool) {
  if (!hasCashCategoryFields(body)) return;
  await ensureCashCategoryColumns(table);

  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const set = [];
  const params = [];

  if (has('cash_category_id')) {
    const cat = toIdOrNull(body.cash_category_id);
    params.push(cat);
    set.push(`cash_category_id = $${params.length}`);
    // trocar/limpar a categoria sem mandar subcategoria → limpa a subcategoria
    if (!has('cash_subcategory_id')) {
      params.push(null);
      set.push(`cash_subcategory_id = $${params.length}`);
    }
  }
  if (has('cash_subcategory_id')) {
    params.push(toIdOrNull(body.cash_subcategory_id));
    set.push(`cash_subcategory_id = $${params.length}`);
  }

  params.push(id);
  await client.query(
    `UPDATE ${table} SET ${set.join(', ')} WHERE id = $${params.length}`,
    params
  );
}

/** Mesmo que setCashCategoryLink, para vários ids (Alterar em lote) */
export async function setCashCategoryLinkBatch(table, ids = [], body = {}) {
  if (!hasCashCategoryFields(body) || !ids.length) return;
  await ensureCashCategoryColumns(table);

  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const set = [];
  const params = [];
  if (has('cash_category_id')) {
    params.push(toIdOrNull(body.cash_category_id));
    set.push(`cash_category_id = $${params.length}`);
    if (!has('cash_subcategory_id')) set.push('cash_subcategory_id = NULL');
  }
  if (has('cash_subcategory_id')) {
    params.push(toIdOrNull(body.cash_subcategory_id));
    set.push(`cash_subcategory_id = $${params.length}`);
  }
  params.push(ids);
  await pool.query(
    `UPDATE ${table} SET ${set.join(', ')} WHERE id = ANY($${params.length}::int[])`,
    params
  );
}
