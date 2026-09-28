// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfesCustomerEmails.repository.js — attachCustomerEmails              ║
// ║ Tabela: public."customers" (enrich em lote por CPF/CNPJ)             ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_CUSTOMERS, LIST_DEBUG } from './nfes.constants.js';
import { digitsOnly } from './nfes.utils.js';

/* =====================================================================
 * ✅ Enrich: adiciona customer_email a partir do Postgres (1 query em lote)
 * ===================================================================== */
export async function attachCustomerEmails(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const docs = Array.from(
    new Set(rows.map((r) => digitsOnly(r?.customer_tax_id)).filter(Boolean)),
  );
  if (!docs.length) return rows;

  const sql = `
    SELECT
      regexp_replace(COALESCE(tax_id, ''), '\\D+', '', 'g') AS doc,
      email
    FROM ${TB_CUSTOMERS}
    WHERE tax_id IS NOT NULL
      AND length(regexp_replace(COALESCE(tax_id, ''), '\\D+', '', 'g')) > 0
      AND regexp_replace(COALESCE(tax_id, ''), '\\D+', '', 'g') = ANY($1)
  `;

  let rs;
  try {
    rs = await pool.query(sql, [docs]);
  } catch (err) {
    if (LIST_DEBUG) console.error('[NFES] attachCustomerEmails SQL erro:', err?.message || err);
    return rows;
  }

  const map = new Map();
  for (const r of rs.rows || []) {
    if (!r?.doc) continue;
    map.set(String(r.doc), r.email || null);
  }

  for (const row of rows) {
    if (row?.customer_email) continue;
    const doc = digitsOnly(row?.customer_tax_id);
    if (doc && map.has(doc)) row.customer_email = map.get(doc);
  }

  return rows;
}
