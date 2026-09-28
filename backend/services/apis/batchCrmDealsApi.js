// ╔══════════════════════════════════════════════════════════════╗
// ║ batchCrmDealsApi.js — Backend API CRM Deals em Lote         ║
// ║ CONSART ERP | ESM                                           ║
// ╚══════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import crmDealsApi from './crmDealsApi.js';

function text(value) {
  return String(value ?? '').trim();
}

function numberOrNull(value) {
  const raw = text(value).replace(',', '.');
  if (!raw) return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function buildCustomerName(row = {}) {
  return (
    row.customer_name ||
    row.trade_name ||
    row.legal_name ||
    row.nome_fantasia ||
    row.razao_social ||
    row.name ||
    'Cliente não informado'
  );
}

export async function searchCustomers({ q, limit = 100 } = {}) {
  const search = text(q);

  if (search.length < 3) {
    return { ok: true, data: [] };
  }

  const sql = `
    SELECT
      c.customer_id,
      c.trade_name,
      c.legal_name,
      c.tax_id,
      c.mobile_number,
      c.phone
    FROM public.customers c
    WHERE
      UPPER(COALESCE(c.trade_name, '')) LIKE UPPER($1)
      OR UPPER(COALESCE(c.legal_name, '')) LIKE UPPER($1)
      OR UPPER(COALESCE(c.tax_id, '')) LIKE UPPER($1)
      OR CAST(c.customer_id AS TEXT) LIKE $1
    ORDER BY
      COALESCE(c.trade_name, c.legal_name, CAST(c.customer_id AS TEXT)) ASC
    LIMIT $2
  `;

  const { rows } = await pool.query(sql, [`%${search}%`, Number(limit) || 100]);

  return {
    ok: true,
    data: rows,
  };
}

export async function createBatchDeals({ customers = [], defaults = {} } = {}) {
  if (!Array.isArray(customers) || !customers.length) {
    return {
      ok: false,
      error: 'CUSTOMERS_REQUIRED',
    };
  }

  const results = [];
  let created = 0;
  let failed = 0;

  for (const customer of customers) {
    const customerId = numberOrNull(customer.customer_id);
    const customerName = buildCustomerName(customer);

    if (!customerId) {
      failed += 1;
      results.push({
        ok: false,
        customer_id: customer.customer_id ?? null,
        customer_name: customerName,
        error: 'INVALID_CUSTOMER_ID',
      });
      continue;
    }

    const payload = {
      customer_id: customerId,
      customer_name: customerName,

      stage_code: text(defaults.stage_code) || 'NOVO',
      seller_id: numberOrNull(defaults.seller_id),
      estimated_value: numberOrNull(defaults.estimated_value),

      lead_source_id: numberOrNull(defaults.lead_source_id),
      status_type_id: numberOrNull(defaults.status_type_id),

      tag: text(defaults.tag) || null,
      next_step: text(defaults.next_step) || null,
      notes: text(defaults.notes) || null,
    };

    try {
      const result = await crmDealsApi.createDeal(payload);

      if (result.ok) {
        created += 1;

        results.push({
          ok: true,
          id: result.data?.id ?? null,
          customer_id: customerId,
          customer_name: result.data?.customer_name ?? customerName,
          stage_id: result.data?.stage_id ?? null,
          stage_code: result.data?.stage_code ?? payload.stage_code,
        });
      } else {
        failed += 1;

        results.push({
          ok: false,
          customer_id: customerId,
          customer_name: customerName,
          error: result.error || 'CREATE_DEAL_ERROR',
        });
      }
    } catch (err) {
      failed += 1;

      results.push({
        ok: false,
        customer_id: customerId,
        customer_name: customerName,
        error: err?.message || 'CREATE_DEAL_EXCEPTION',
      });
    }
  }

  return {
    ok: true,
    summary: {
      total: customers.length,
      created,
      failed,
    },
    results,
  };
}

export default {
  searchCustomers,
  createBatchDeals,
};