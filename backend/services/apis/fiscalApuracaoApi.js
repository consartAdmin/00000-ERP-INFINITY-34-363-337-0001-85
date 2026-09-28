// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: fiscalApuracaoApi.js                                           ║
// ║ MODULE: FISCAL APURACAO                                              ║
// ║ CONSART ERP                                                          ║
// ║ API / DATA ACCESS LAYER                                              ║
// ║ UPDATE: listagem sem filtro rígido por date_from/date_to             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';


/* ======================================================================
   TABLES
   ====================================================================== */

const TABLE_FISCAL_APURACAO = 'fiscalApuracao';
const ALIAS_FISCAL_APURACAO = 'fa';

const TABLE_FISCAL_APURACAO_DOCUMENTS = 'fiscalApuracaoDocuments';
const ALIAS_FISCAL_APURACAO_DOCUMENTS = 'fad';

const TABLE_FISCAL_APURACAO_ITEMS = 'fiscalApuracaoItems';
const ALIAS_FISCAL_APURACAO_ITEMS = 'fai';

const TABLE_FISCAL_APURACAO_SUMMARY = 'fiscalApuracaoSummary';
const ALIAS_FISCAL_APURACAO_SUMMARY = 'fas';

const TABLE_FISCAL_APURACAO_RECON = 'fiscalApuracaoReconciliation';
const ALIAS_FISCAL_APURACAO_RECON = 'far';


/* ======================================================================
   HELPERS
   ====================================================================== */

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value, fallback = null) {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  return text || null;
}


/* ======================================================================
   HEADER
   ====================================================================== */

export async function insertFiscalApuracao(data, client = pool) {
  const sql = `
    INSERT INTO "${TABLE_FISCAL_APURACAO}" (
      reference_month,
      reference_year,
      date_from,
      date_to,
      regime_type,
      status,
      notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;

  const params = [
    data.reference_month,
    data.reference_year,
    data.date_from,
    data.date_to,
    data.regime_type || 'LUCRO_REAL',
    data.status || 'OPEN',
    data.notes || null
  ];

  const { rows } = await client.query(sql, params);
  return rows[0];
}

export async function updateFiscalApuracaoStatus(
  fiscalApuracaoId,
  status,
  client = pool
) {
  const sql = `
    UPDATE "${TABLE_FISCAL_APURACAO}"
    SET
      status = $2,
      updated_at = now()
    WHERE fiscal_apuracao_id = $1
    RETURNING *
  `;

  const { rows } = await client.query(sql, [fiscalApuracaoId, status]);
  return rows[0] || null;
}

export async function getFiscalApuracaoByPeriod(
  referenceYear,
  referenceMonth,
  regimeType = 'LUCRO_REAL',
  client = pool
) {
  const sql = `
    SELECT *
    FROM "${TABLE_FISCAL_APURACAO}" ${ALIAS_FISCAL_APURACAO}
    WHERE ${ALIAS_FISCAL_APURACAO}.reference_year = $1
      AND ${ALIAS_FISCAL_APURACAO}.reference_month = $2
      AND ${ALIAS_FISCAL_APURACAO}.regime_type = $3
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [
    referenceYear,
    referenceMonth,
    regimeType
  ]);

  return rows[0] || null;
}

export async function getFiscalApuracaoHeaderById(
  fiscalApuracaoId,
  client = pool
) {
  const sql = `
    SELECT *
    FROM "${TABLE_FISCAL_APURACAO}" ${ALIAS_FISCAL_APURACAO}
    WHERE ${ALIAS_FISCAL_APURACAO}.fiscal_apuracao_id = $1
  `;

  const { rows } = await client.query(sql, [fiscalApuracaoId]);
  return rows[0] || null;
}

export async function listFiscalApuracoes(filters = {}, client = pool) {
  const where = [];
  const params = [];
  let idx = 1;

  if (filters.reference_year) {
    where.push(`${ALIAS_FISCAL_APURACAO}.reference_year = $${idx++}`);
    params.push(Number(filters.reference_year));
  }

  if (filters.reference_month) {
    where.push(`${ALIAS_FISCAL_APURACAO}.reference_month = $${idx++}`);
    params.push(Number(filters.reference_month));
  }

  if (filters.status) {
    where.push(`${ALIAS_FISCAL_APURACAO}.status = $${idx++}`);
    params.push(String(filters.status).trim().toUpperCase());
  }

  if (filters.regime_type) {
    where.push(`${ALIAS_FISCAL_APURACAO}.regime_type = $${idx++}`);
    params.push(String(filters.regime_type).trim());
  }

  /*
    IMPORTANTE:
    Não aplicamos mais filtro rígido por date_from/date_to na listagem principal,
    porque a tela de "Apurações Criadas" estava escondendo apurações existentes
    quando o usuário mudava o filtro para outro mês.

    Se no futuro quiser filtro por período na listagem, o ideal é usar interseção:
      fa.date_from <= filtro_date_to
      fa.date_to   >= filtro_date_from
    e apenas quando isso for explicitamente desejado.
  */

  const limit = Math.max(1, Math.min(Number(filters.limit) || 100, 500));
  params.push(limit);

  const sql = `
    SELECT
      ${ALIAS_FISCAL_APURACAO}.fiscal_apuracao_id,
      ${ALIAS_FISCAL_APURACAO}.reference_month,
      ${ALIAS_FISCAL_APURACAO}.reference_year,
      ${ALIAS_FISCAL_APURACAO}.date_from,
      ${ALIAS_FISCAL_APURACAO}.date_to,
      ${ALIAS_FISCAL_APURACAO}.regime_type,
      ${ALIAS_FISCAL_APURACAO}.status,
      ${ALIAS_FISCAL_APURACAO}.notes,
      ${ALIAS_FISCAL_APURACAO}.created_at,
      ${ALIAS_FISCAL_APURACAO}.updated_at
    FROM "${TABLE_FISCAL_APURACAO}" ${ALIAS_FISCAL_APURACAO}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      ${ALIAS_FISCAL_APURACAO}.reference_year DESC,
      ${ALIAS_FISCAL_APURACAO}.reference_month DESC,
      ${ALIAS_FISCAL_APURACAO}.fiscal_apuracao_id DESC
    LIMIT $${idx}
  `;

  const { rows } = await client.query(sql, params);
  return rows;
}


/* ======================================================================
   DOCUMENTS
   ====================================================================== */

export async function insertFiscalApuracaoDocument(data, client = pool) {
  const sql = `
    INSERT INTO "${TABLE_FISCAL_APURACAO_DOCUMENTS}" (
      fiscal_apuracao_id,
      document_type,
      model,
      serie,
      number,
      nfe_key,
      protocol,
      issue_date,
      issue_datetime,
      emit_tax_id,
      emit_name,
      dest_tax_id,
      dest_name,
      partner_tax_id,
      partner_name,
      total_products_value,
      total_nfe_value,
      total_icms_value,
      total_icms_st_value,
      total_fcp_value,
      total_ipi_value,
      total_pis_value,
      total_cofins_value,
      total_freight_value,
      total_discount_value,
      total_other_value,
      xml_source,
      xml_file_name,
      xml_file_path,
      xml_hash,
      order_id,
      inbound_invoice_id,
      status,
      import_errors,
      raw_payload
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35
    )
    RETURNING *
  `;

  const params = [
    data.fiscal_apuracao_id,
    normalizeText(data.document_type),
    normalizeText(data.model),
    normalizeText(data.serie),
    normalizeText(data.number),
    normalizeText(data.nfe_key),
    normalizeText(data.protocol),
    data.issue_date || null,
    data.issue_datetime || null,
    normalizeText(data.emit_tax_id),
    normalizeText(data.emit_name),
    normalizeText(data.dest_tax_id),
    normalizeText(data.dest_name),
    normalizeText(data.partner_tax_id),
    normalizeText(data.partner_name),
    toNumber(data.total_products_value),
    toNumber(data.total_nfe_value),
    toNumber(data.total_icms_value),
    toNumber(data.total_icms_st_value),
    toNumber(data.total_fcp_value),
    toNumber(data.total_ipi_value),
    toNumber(data.total_pis_value),
    toNumber(data.total_cofins_value),
    toNumber(data.total_freight_value),
    toNumber(data.total_discount_value),
    toNumber(data.total_other_value),
    normalizeText(data.xml_source, 'UPLOAD'),
    normalizeText(data.xml_file_name),
    normalizeText(data.xml_file_path),
    normalizeText(data.xml_hash),
    data.order_id || null,
    data.inbound_invoice_id || null,
    normalizeText(data.status, 'IMPORTED'),
    data.import_errors || null,
    data.raw_payload || null
  ];

  const { rows } = await client.query(sql, params);
  return rows[0];
}

export async function listFiscalApuracaoDocuments(
  fiscalApuracaoId,
  client = pool
) {
  const sql = `
    SELECT *
    FROM "${TABLE_FISCAL_APURACAO_DOCUMENTS}" ${ALIAS_FISCAL_APURACAO_DOCUMENTS}
    WHERE ${ALIAS_FISCAL_APURACAO_DOCUMENTS}.fiscal_apuracao_id = $1
    ORDER BY
      ${ALIAS_FISCAL_APURACAO_DOCUMENTS}.issue_date ASC,
      ${ALIAS_FISCAL_APURACAO_DOCUMENTS}.fiscal_apuracao_document_id ASC
  `;

  const { rows } = await client.query(sql, [fiscalApuracaoId]);
  return rows;
}


/* ======================================================================
   ITEMS
   ====================================================================== */

export async function insertFiscalApuracaoItem(data, client = pool) {
  const sql = `
    INSERT INTO "${TABLE_FISCAL_APURACAO_ITEMS}" (
      fiscal_apuracao_id,
      fiscal_apuracao_document_id,
      item_number,
      product_code,
      sku,
      ean,
      description,
      ncm_code,
      cest_code,
      cfop,
      unit,
      quantity,
      unit_value,
      gross_value,
      discount_value,
      freight_value,
      other_value,
      insurance_value,
      net_value,
      origin_code,
      icms_cst,
      icms_csosn,
      icms_rate,
      icms_base,
      icms_value,
      icms_st_rate,
      icms_st_base,
      icms_st_value,
      fcp_rate,
      fcp_base,
      fcp_value,
      pis_cst,
      pis_rate,
      pis_base,
      pis_value,
      cofins_cst,
      cofins_rate,
      cofins_base,
      cofins_value,
      ipi_cst,
      ipi_rate,
      ipi_base,
      ipi_value,
      tax_role,
      source_type,
      products_fiscal_id,
      fiscal_profile_id,
      fiscal_classification_id,
      raw_payload
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
      $41,$42,$43,$44,$45,$46,$47,$48,$49
    )
    RETURNING *
  `;

  const params = [
    data.fiscal_apuracao_id,
    data.fiscal_apuracao_document_id,
    data.item_number || null,
    normalizeText(data.product_code),
    normalizeText(data.sku),
    normalizeText(data.ean),
    normalizeText(data.description),
    normalizeText(data.ncm_code),
    normalizeText(data.cest_code),
    normalizeText(data.cfop),
    normalizeText(data.unit),
    toNumber(data.quantity),
    toNumber(data.unit_value),
    toNumber(data.gross_value),
    toNumber(data.discount_value),
    toNumber(data.freight_value),
    toNumber(data.other_value),
    toNumber(data.insurance_value),
    toNumber(data.net_value),
    normalizeText(data.origin_code),
    normalizeText(data.icms_cst),
    normalizeText(data.icms_csosn),
    toNumber(data.icms_rate),
    toNumber(data.icms_base),
    toNumber(data.icms_value),
    toNumber(data.icms_st_rate),
    toNumber(data.icms_st_base),
    toNumber(data.icms_st_value),
    toNumber(data.fcp_rate),
    toNumber(data.fcp_base),
    toNumber(data.fcp_value),
    normalizeText(data.pis_cst),
    toNumber(data.pis_rate),
    toNumber(data.pis_base),
    toNumber(data.pis_value),
    normalizeText(data.cofins_cst),
    toNumber(data.cofins_rate),
    toNumber(data.cofins_base),
    toNumber(data.cofins_value),
    normalizeText(data.ipi_cst),
    toNumber(data.ipi_rate),
    toNumber(data.ipi_base),
    toNumber(data.ipi_value),
    normalizeText(data.tax_role),
    normalizeText(data.source_type),
    data.products_fiscal_id || null,
    data.fiscal_profile_id || null,
    data.fiscal_classification_id || null,
    data.raw_payload || null
  ];

  const { rows } = await client.query(sql, params);
  return rows[0];
}

export async function listFiscalApuracaoItems(
  fiscalApuracaoId,
  client = pool
) {
  const sql = `
    SELECT *
    FROM "${TABLE_FISCAL_APURACAO_ITEMS}" ${ALIAS_FISCAL_APURACAO_ITEMS}
    WHERE ${ALIAS_FISCAL_APURACAO_ITEMS}.fiscal_apuracao_id = $1
    ORDER BY
      ${ALIAS_FISCAL_APURACAO_ITEMS}.fiscal_apuracao_document_id ASC,
      ${ALIAS_FISCAL_APURACAO_ITEMS}.item_number ASC,
      ${ALIAS_FISCAL_APURACAO_ITEMS}.fiscal_apuracao_item_id ASC
  `;

  const { rows } = await client.query(sql, [fiscalApuracaoId]);
  return rows;
}


/* ======================================================================
   SUMMARY
   ====================================================================== */

export async function upsertFiscalApuracaoSummary(data, client = pool) {
  const sql = `
    INSERT INTO "${TABLE_FISCAL_APURACAO_SUMMARY}" (
      fiscal_apuracao_id,
      icms_debit_total,
      icms_credit_total,
      icms_st_total,
      icms_payable_total,
      pis_debit_total,
      pis_credit_total,
      pis_payable_total,
      cofins_debit_total,
      cofins_credit_total,
      cofins_payable_total,
      ipi_debit_total,
      ipi_credit_total,
      ipi_payable_total,
      fcp_total,
      gross_documents_total,
      outgoing_documents_total,
      incoming_documents_total,
      icms_debit_base,
      icms_credit_base,
      icms_st_base,
      pis_debit_base,
      pis_credit_base,
      cofins_debit_base,
      cofins_credit_base,
      ipi_debit_base,
      ipi_credit_base,
      fcp_base
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,$24,$25,$26,$27,$28
    )
    ON CONFLICT (fiscal_apuracao_id)
    DO UPDATE SET
      icms_debit_total = EXCLUDED.icms_debit_total,
      icms_credit_total = EXCLUDED.icms_credit_total,
      icms_st_total = EXCLUDED.icms_st_total,
      icms_payable_total = EXCLUDED.icms_payable_total,
      pis_debit_total = EXCLUDED.pis_debit_total,
      pis_credit_total = EXCLUDED.pis_credit_total,
      pis_payable_total = EXCLUDED.pis_payable_total,
      cofins_debit_total = EXCLUDED.cofins_debit_total,
      cofins_credit_total = EXCLUDED.cofins_credit_total,
      cofins_payable_total = EXCLUDED.cofins_payable_total,
      ipi_debit_total = EXCLUDED.ipi_debit_total,
      ipi_credit_total = EXCLUDED.ipi_credit_total,
      ipi_payable_total = EXCLUDED.ipi_payable_total,
      fcp_total = EXCLUDED.fcp_total,
      gross_documents_total = EXCLUDED.gross_documents_total,
      outgoing_documents_total = EXCLUDED.outgoing_documents_total,
      incoming_documents_total = EXCLUDED.incoming_documents_total,
      icms_debit_base = EXCLUDED.icms_debit_base,
      icms_credit_base = EXCLUDED.icms_credit_base,
      icms_st_base = EXCLUDED.icms_st_base,
      pis_debit_base = EXCLUDED.pis_debit_base,
      pis_credit_base = EXCLUDED.pis_credit_base,
      cofins_debit_base = EXCLUDED.cofins_debit_base,
      cofins_credit_base = EXCLUDED.cofins_credit_base,
      ipi_debit_base = EXCLUDED.ipi_debit_base,
      ipi_credit_base = EXCLUDED.ipi_credit_base,
      fcp_base = EXCLUDED.fcp_base,
      updated_at = now()
    RETURNING *
  `;

  const params = [
    data.fiscal_apuracao_id,
    toNumber(data.icms_debit_total),
    toNumber(data.icms_credit_total),
    toNumber(data.icms_st_total),
    toNumber(data.icms_payable_total),
    toNumber(data.pis_debit_total),
    toNumber(data.pis_credit_total),
    toNumber(data.pis_payable_total),
    toNumber(data.cofins_debit_total),
    toNumber(data.cofins_credit_total),
    toNumber(data.cofins_payable_total),
    toNumber(data.ipi_debit_total),
    toNumber(data.ipi_credit_total),
    toNumber(data.ipi_payable_total),
    toNumber(data.fcp_total),
    toNumber(data.gross_documents_total),
    toNumber(data.outgoing_documents_total),
    toNumber(data.incoming_documents_total),
    toNumber(data.icms_debit_base),
    toNumber(data.icms_credit_base),
    toNumber(data.icms_st_base),
    toNumber(data.pis_debit_base),
    toNumber(data.pis_credit_base),
    toNumber(data.cofins_debit_base),
    toNumber(data.cofins_credit_base),
    toNumber(data.ipi_debit_base),
    toNumber(data.ipi_credit_base),
    toNumber(data.fcp_base)
  ];

  const { rows } = await client.query(sql, params);
  return rows[0];
}

export async function getFiscalApuracaoSummaryByApuracaoId(
  fiscalApuracaoId,
  client = pool
) {
  const sql = `
    SELECT *
    FROM "${TABLE_FISCAL_APURACAO_SUMMARY}" ${ALIAS_FISCAL_APURACAO_SUMMARY}
    WHERE ${ALIAS_FISCAL_APURACAO_SUMMARY}.fiscal_apuracao_id = $1
  `;

  const { rows } = await client.query(sql, [fiscalApuracaoId]);
  return rows[0] || null;
}


/* ======================================================================
   RECONCILIATION
   ====================================================================== */

export async function insertFiscalApuracaoReconciliation(data, client = pool) {
  const sql = `
    INSERT INTO "${TABLE_FISCAL_APURACAO_RECON}" (
      fiscal_apuracao_id,
      fiscal_apuracao_document_id,
      fiscal_apuracao_item_id,
      divergence_type,
      severity,
      document_key,
      product_code,
      sku,
      expected_value,
      actual_value,
      difference_value,
      details,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `;

  const params = [
    data.fiscal_apuracao_id,
    data.fiscal_apuracao_document_id || null,
    data.fiscal_apuracao_item_id || null,
    normalizeText(data.divergence_type),
    normalizeText(data.severity, 'MEDIUM'),
    normalizeText(data.document_key),
    normalizeText(data.product_code),
    normalizeText(data.sku),
    data.expected_value ?? null,
    data.actual_value ?? null,
    data.difference_value ?? null,
    data.details || null,
    normalizeText(data.status, 'OPEN')
  ];

  const { rows } = await client.query(sql, params);
  return rows[0];
}

export async function listFiscalApuracaoReconciliation(
  fiscalApuracaoId,
  client = pool
) {
  const sql = `
    SELECT *
    FROM "${TABLE_FISCAL_APURACAO_RECON}" ${ALIAS_FISCAL_APURACAO_RECON}
    WHERE ${ALIAS_FISCAL_APURACAO_RECON}.fiscal_apuracao_id = $1
    ORDER BY
      ${ALIAS_FISCAL_APURACAO_RECON}.created_at DESC,
      ${ALIAS_FISCAL_APURACAO_RECON}.fiscal_apuracao_reconciliation_id DESC
  `;

  const { rows } = await client.query(sql, [fiscalApuracaoId]);
  return rows;
}


/* ======================================================================
   DELETE
   ====================================================================== */

export async function deleteFiscalApuracaoById(
  fiscalApuracaoId,
  client = pool
) {
  const sql = `
    DELETE FROM "${TABLE_FISCAL_APURACAO}"
    WHERE fiscal_apuracao_id = $1
    RETURNING *
  `;

  const { rows } = await client.query(sql, [fiscalApuracaoId]);
  return rows[0] || null;
}