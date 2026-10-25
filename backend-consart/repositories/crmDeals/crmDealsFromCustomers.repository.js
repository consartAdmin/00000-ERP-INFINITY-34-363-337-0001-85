// ╔════════════════════════════════════════════════════════════════════╗
// ║ crmDealsFromCustomers.repository.js — clientes marcados → cards    ║
// ║ Tela Clientes Consart: "Enviar ao CRM" cria 1 card por cliente     ║
// ║ na etapa escolhida (padrão: 1ª etapa ativa, a Triagem).            ║
// ║ Cliente que já tem card aberto no mesmo CRM é pulado (sem duplicar)║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { erpTable } from '../../utils/erpCompanyContext.js';
import { normalizeCrmCompany, toPositiveNumOrNull } from './crmDeals.utils.js';
import { createDeal } from './crmDealsCreate.repository.js';

export const MAX_CUSTOMERS_PER_SEND = 500;

function uniqueIds(values = []) {
  const ids = (Array.isArray(values) ? values : [])
    .map(toPositiveNumOrNull)
    .filter(Boolean);
  return Array.from(new Set(ids));
}

async function resolveStage(stageId) {
  const id = toPositiveNumOrNull(stageId);

  const { rows } = await pool.query(
    `
      SELECT s.id, COALESCE(s.code, s.stage_code) AS code, s.stage_name AS name
      FROM public."crmDealsStages" s
      WHERE COALESCE(s.is_active, TRUE) = TRUE
        AND ($1::int IS NULL OR s.id = $1)
      ORDER BY s.sort_order ASC, s.id ASC
      LIMIT 1
    `,
    [id]
  );

  return rows[0] || null;
}

async function loadCustomers(ids) {
  const { rows } = await pool.query(
    `
      SELECT
        c.customer_id,
        COALESCE(NULLIF(TRIM(c.trade_name), ''), c.legal_name) AS customer_name,
        -- Só vendedor/status que existem nos cadastros da Consart (FKs do crmDeals);
        -- vínculo antigo apontando para id inexistente vira card sem vendedor/status
        s.id   AS seller_id,
        cst.id AS status_type_id
      FROM ${erpTable('public."customers"')} c
      LEFT JOIN LATERAL (
        SELECT sfc1.seller_id
        FROM ${erpTable('public."SellerForCustomer"')} sfc1
        WHERE sfc1.customer_id = c.customer_id
          AND (sfc1.active IS NULL OR sfc1.active = TRUE)
        ORDER BY sfc1.created_at DESC
        LIMIT 1
      ) sfc ON TRUE
      LEFT JOIN ${erpTable('public."sellers"')} s
        ON s.id = sfc.seller_id
      LEFT JOIN ${erpTable('public."customerStatus"')} cs
        ON cs.customer_id = c.customer_id
      LEFT JOIN ${erpTable('public."customerStatusTypes"')} cst
        ON cst.id = cs.status_type_id
      WHERE c.customer_id = ANY($1::int[])
    `,
    [ids]
  );

  return new Map(rows.map((r) => [Number(r.customer_id), r]));
}

async function loadOpenDealCustomerIds(ids, crmCompany) {
  const { rows } = await pool.query(
    `
      SELECT DISTINCT d.customer_id
      FROM public."crmDeals" d
      WHERE d.crm_company = $1
        AND COALESCE(d.is_closed, FALSE) = FALSE
        AND d.customer_id = ANY($2::int[])
    `,
    [crmCompany, ids]
  );

  return new Set(rows.map((r) => Number(r.customer_id)));
}

/**
 * @param {object} p
 * @param {number[]} p.customerIds  clientes marcados na lista
 * @param {number}  [p.stageId]     etapa do CRM (padrão: 1ª etapa ativa)
 * @param {string}  [p.crmCompany]  CRM de destino ('CONSART')
 * @param {(sellerId:number|null)=>number|null} [p.pickSellerId] escopo do usuário (não admin)
 * @param {number}  [p.updatedBy]
 */
export async function createDealsFromCustomers({
  customerIds = [],
  stageId = null,
  crmCompany = null,
  pickSellerId = null,
  updatedBy = null,
} = {}) {
  const ids = uniqueIds(customerIds);
  if (!ids.length) return { ok: false, error: 'CUSTOMERS_REQUIRED' };
  if (ids.length > MAX_CUSTOMERS_PER_SEND) return { ok: false, error: 'TOO_MANY_CUSTOMERS' };

  const company = normalizeCrmCompany(crmCompany);

  const stage = await resolveStage(stageId);
  if (!stage) return { ok: false, error: 'STAGE_REQUIRED' };

  const [customers, openDeals] = await Promise.all([
    loadCustomers(ids),
    loadOpenDealCustomerIds(ids, company),
  ]);

  const results = [];
  const summary = { total: ids.length, created: 0, skipped: 0, failed: 0 };

  for (const id of ids) {
    const customer = customers.get(id);

    if (!customer) {
      summary.failed += 1;
      results.push({ ok: false, customer_id: id, error: 'CUSTOMER_NOT_FOUND' });
      continue;
    }

    if (openDeals.has(id)) {
      summary.skipped += 1;
      results.push({ ok: true, skipped: true, customer_id: id, customer_name: customer.customer_name, reason: 'ALREADY_IN_CRM' });
      continue;
    }

    const sellerId = toPositiveNumOrNull(customer.seller_id);

    const created = await createDeal({
      stage_id: stage.id,
      customer_id: id,
      customer_name: customer.customer_name,
      seller_id: pickSellerId ? pickSellerId(sellerId) : sellerId,
      status_type_id: toPositiveNumOrNull(customer.status_type_id),
      crm_company: company,
      updated_by: updatedBy,
    });

    if (created.ok) {
      summary.created += 1;
      openDeals.add(id);
      results.push({ ok: true, id: created.data?.id ?? null, customer_id: id, customer_name: customer.customer_name });
    } else {
      summary.failed += 1;
      results.push({ ok: false, customer_id: id, customer_name: customer.customer_name, error: created.error || 'CREATE_DEAL_ERROR' });
    }
  }

  return {
    ok: true,
    data: {
      stage: { id: stage.id, code: stage.code, name: stage.name },
      summary,
      results,
    },
  };
}
