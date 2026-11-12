// ╔════════════════════════════════════════════════════════════════════╗
// ║ usoConsumoQuery.repository.js — list / getById (cabeçalho + itens) ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_USO, TB_USO_ITEMS } from './usoConsumo.constants.js';
import { ensureUsoConsumoSchema } from './usoConsumoSchema.repository.js';

export async function list({ q = '', status = '', limit = 50, offset = 0 } = {}) {
  await ensureUsoConsumoSchema();
  const params = [];
  let where = 'WHERE 1=1';

  if (q) {
    params.push(`%${q}%`);

    where += ` AND (
      uc.number ILIKE $${params.length}
      OR uc.department ILIKE $${params.length}
      OR uc.responsible ILIKE $${params.length}
      OR uc.reason ILIKE $${params.length}
      OR COALESCE(uc.budget_id::text, '') ILIKE $${params.length}
      OR COALESCE(ii.nfe_number::text, '') ILIKE $${params.length}
      OR COALESCE(ii.nfe_key, '') ILIKE $${params.length}
    )`;
  }

  const statusFilter = String(status || '').trim().toUpperCase();
  if (statusFilter) {
    params.push(statusFilter);
    where += ` AND UPPER(COALESCE(uc.status, '')) = $${params.length}`;
  }

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM ${TB_USO} uc
    LEFT JOIN public."invoicesIssued" ii
      ON ii.invoice_id = uc.invoice_id
    ${where}
  `;
  const countParams = [...params];

  params.push(limit);
  const limitParam = params.length;

  params.push(offset);
  const offsetParam = params.length;

  const sql = `
    SELECT
      uc.*,
      ii.nfe_number,
      ii.nfe_key,
      ii.nfe_status,
      ii.nfe_protocol,
      ii.nfe_provider_id,
      ii.nfe_environment,
      ii.xml_url,
      ii.danfe_url,
      ii.issued_at,
      ii.issued_date,
      (SELECT COUNT(*)::int FROM ${TB_USO_ITEMS} x WHERE x.uso_consumo_id = uc.uso_consumo_id) AS items_count
    FROM ${TB_USO} uc
    LEFT JOIN public."invoicesIssued" ii
      ON ii.invoice_id = uc.invoice_id
    ${where}
    ORDER BY uc.created_at DESC, uc.uso_consumo_id DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const [{ rows }, countResult] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, countParams),
  ]);

  return { rows, total: countResult.rows[0]?.total ?? rows.length };
}

export async function getById(id) {
  await ensureUsoConsumoSchema();
  const usoId = Number(id);

  if (!usoId) {
    throw new Error('uso_consumo_id inválido.');
  }

  const headerSql = `
    SELECT
      uc.*,
      ii.nfe_number,
      ii.nfe_key,
      ii.nfe_status,
      ii.nfe_protocol,
      ii.nfe_provider_id,
      ii.nfe_environment,
      ii.xml_url,
      ii.danfe_url,
      ii.issued_at,
      ii.issued_date
    FROM ${TB_USO} uc
    LEFT JOIN public."invoicesIssued" ii
      ON ii.invoice_id = uc.invoice_id
    WHERE uc.uso_consumo_id = $1
  `;

  const itemsSql = `
    SELECT *
    FROM ${TB_USO_ITEMS}
    WHERE uso_consumo_id = $1
    ORDER BY uso_consumo_item_id ASC
  `;

  const [headerResult, itemsResult] = await Promise.all([
    pool.query(headerSql, [usoId]),
    pool.query(itemsSql, [usoId]),
  ]);

  return {
    header: headerResult.rows[0] || null,
    items: itemsResult.rows,
  };
}
