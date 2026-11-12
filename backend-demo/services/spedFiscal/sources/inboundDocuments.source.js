// ╔══════════════════════════════════════════════════════════════════════╗
// ║ inboundDocuments.source.js                                          ║
// ║ Documentos de entrada para o SPED Fiscal — inboundInvoices          ║
// ║ CONSART ERP                                                         ║
// ║ ✅ Schema real inboundInvoices / inboundInvoiceItems                 ║
// ║ ✅ Chaves reais: inbound_id / inbound_item_id                       ║
// ║ ✅ Valores fiscais do XML (icms_value, pis_value, ...) por item     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../../config/db.js';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sumBy(list = [], field) {
  return list.reduce((acc, item) => acc + toNumber(item?.[field]), 0);
}

function normalizeFiscalProductCode(value) {
  const code = String(value ?? '').trim();
  if (!/^\d+$/.test(code)) return code;

  const significant = code.replace(/^0+/, '') || '0';
  return significant.padStart(6, '0');
}

/*
 * CFOP de saída do fornecedor (5/6/7xxx) → CFOP de entrada (1/2/3xxx).
 * Alguns códigos não têm "espelho" direto na tabela de CFOP e o PVA recusa
 * (ex.: 5405 → 1405 não existe). Esses são trocados pelo equivalente de entrada.
 */
const INBOUND_CFOP_EQUIVALENT = Object.freeze({
  // Venda de mercadoria com ST (substituído) → compra p/ comercialização com ST.
  '405': '403',
  '404': '403',
  // Lançamento de cupom fiscal / outras saídas sem espelho → outras entradas.
  '929': '949',
  // Remessa/venda de combustível com ST sem espelho → compra de combustível p/ comercialização.
  '656': '652',
  '667': '652',
});

function normalizeInboundCfop(value) {
  const cfop = String(value ?? '').replace(/\D+/g, '');
  if (!/^\d{4}$/.test(cfop)) return cfop;

  const firstDigitMap = { 5: '1', 6: '2', 7: '3' };
  if (!firstDigitMap[cfop[0]]) return cfop;

  const suffix = cfop.slice(1);
  return `${firstDigitMap[cfop[0]]}${INBOUND_CFOP_EQUIVALENT[suffix] || suffix}`;
}

/*
 * CST do IPI no XML é o do fornecedor (saída: 50–99). Na entrada o PVA exige
 * a tabela de entrada (00–49): 50→00, 51→01 ... 55→05 e 99→49.
 */
function normalizeInboundIpiCst(value) {
  const cst = String(value ?? '').replace(/\D+/g, '');
  if (!cst) return '';

  const n = Number(cst);
  if (n < 50) return cst.padStart(2, '0');
  if (n >= 50 && n <= 55) return String(n - 50).padStart(2, '0');
  return '49';
}

async function getInboundItems(inboundId) {
  if (!inboundId) return [];

  try {
    const { rows } = await pool.query(
      `
        WITH item_fiscal AS (
          SELECT
            ii.*,

            -- Produto do ERP: primeiro pelo vínculo (product_id), depois pelo código.
            COALESCE(
              linked_product.product_code::text,
              NULLIF(ii.product_code::text, ''),
              NULLIF(ii.nf_product_code::text, '')
            ) AS resolved_product_code,
            linked_product.description AS product_description,

            NULLIF(
              regexp_replace(
                COALESCE(ii.icms_cst, fp.icms_cst, ''),
                '\\D+',
                '',
                'g'
              ),
              ''
            ) AS normalized_icms_code,

            COALESCE(
              NULLIF(regexp_replace(COALESCE(ii.icms_origin::text, ''), '\\D+', '', 'g'), ''),
              NULLIF(regexp_replace(COALESCE(fp.origin_code, ''), '\\D+', '', 'g'), ''),
              '0'
            ) AS normalized_origin_code,

            fp.cfop_entry,
            fp.icms_rate AS profile_icms_rate,
            fp.pis_cst AS profile_pis_cst,
            fp.cofins_cst AS profile_cofins_cst

          FROM public."inboundInvoiceItems" ii

          LEFT JOIN LATERAL (
            SELECT p.product_code, p.description
            FROM public.products p
            WHERE (ii.product_id IS NOT NULL AND p.product_id = ii.product_id)
               OR (
                 ii.product_id IS NULL
                 AND NULLIF(ltrim(p.product_code::text, '0'), '')
                   = NULLIF(ltrim(ii.product_code::text, '0'), '')
               )
            ORDER BY p.product_id
            LIMIT 1
          ) linked_product ON true

          LEFT JOIN LATERAL (
            SELECT
              pf.fiscal_classification_id
            FROM public."productsFiscalV2" pf
            WHERE NULLIF(ltrim(pf.product_code::text, '0'), '')
                = NULLIF(ltrim(COALESCE(linked_product.product_code::text, ii.product_code::text), '0'), '')
              AND pf.is_current = true
              AND pf.is_active = true
            ORDER BY
              pf.version DESC,
              pf.products_fiscal_id DESC
            LIMIT 1
          ) current_pf ON true

          LEFT JOIN public."fiscalClassificationV2" fc
            ON fc.fiscal_classification_id = current_pf.fiscal_classification_id

          LEFT JOIN public."fiscalProfileV2" fp
            ON fp.fiscal_profile_id = fc.fiscal_profile_id

          WHERE ii.inbound_id = $1
        )

        SELECT
          item_fiscal.resolved_product_code AS codigo_produto,
          COALESCE(
            NULLIF(item_fiscal.description, ''),
            item_fiscal.product_description,
            ''
          ) AS descricao,
          COALESCE(item_fiscal.quantity, 0) AS quantidade,
          COALESCE(NULLIF(item_fiscal.unit, ''), 'UN') AS unidade,
          COALESCE(item_fiscal.conversion_factor, 1) AS fator_conversao,

          -- VL_ITEM = valor bruto do item (qtd x unitário), como no XML (vProd).
          COALESCE(item_fiscal.gross_total, item_fiscal.total_price, 0) AS valor_item,
          COALESCE(item_fiscal.discount_value, 0) AS valor_desconto,
          COALESCE(item_fiscal.freight_value, 0) AS valor_frete,
          COALESCE(item_fiscal.insurance_value, 0) AS valor_seguro,
          COALESCE(item_fiscal.other_expenses, 0) AS outras_despesas,

          '0'::text AS movimenta_estoque,

          CASE
            WHEN item_fiscal.normalized_icms_code IN (
              '101', '102', '103', '201', '202', '203',
              '300', '400', '500', '900'
            ) THEN ''
            WHEN length(item_fiscal.normalized_icms_code) = 2
              THEN LEFT(item_fiscal.normalized_origin_code, 1)
                   || item_fiscal.normalized_icms_code
            ELSE COALESCE(item_fiscal.normalized_icms_code, '')
          END::text AS cst_icms,

          CASE
            WHEN item_fiscal.normalized_icms_code IN (
              '101', '102', '103', '201', '202', '203',
              '300', '400', '500', '900'
            ) THEN item_fiscal.normalized_icms_code
            ELSE ''
          END::text AS csosn,

          COALESCE(
            NULLIF(item_fiscal.cfop::text, ''),
            item_fiscal.cfop_entry,
            ''
          )::text AS cfop,

          ''::text AS codigo_natureza,

          -- Valores fiscais vêm do XML da nota (gravados no item).
          COALESCE(item_fiscal.icms_value, item_fiscal.icms, 0) AS valor_icms,
          COALESCE(
            item_fiscal.icms_base,
            CASE
              WHEN COALESCE(item_fiscal.icms_value, item_fiscal.icms, 0) > 0
                THEN COALESCE(item_fiscal.total_price, 0)
              ELSE 0
            END
          ) AS valor_bc_icms,
          COALESCE(
            item_fiscal.icms_rate,
            CASE
              WHEN COALESCE(item_fiscal.icms_base, 0) > 0
                THEN ROUND(
                  COALESCE(item_fiscal.icms_value, item_fiscal.icms, 0)
                    / item_fiscal.icms_base * 100,
                  2
                )
              ELSE 0
            END
          ) AS aliq_icms,

          COALESCE(item_fiscal.icms_st_base, 0) AS valor_bc_icms_st,
          COALESCE(item_fiscal.icms_st_rate, 0) AS aliq_st,
          COALESCE(item_fiscal.icms_st_value, 0) AS valor_icms_st,

          ''::text AS apuracao_ipi,
          COALESCE(item_fiscal.ipi_cst, '')::text AS cst_ipi,
          ''::text AS cod_enq,
          COALESCE(
            item_fiscal.ipi_base,
            CASE
              WHEN COALESCE(item_fiscal.ipi_value, item_fiscal.ipi, 0) > 0
                THEN COALESCE(item_fiscal.total_price, 0)
              ELSE 0
            END
          ) AS valor_bc_ipi,
          COALESCE(item_fiscal.ipi_rate, 0) AS aliq_ipi,
          COALESCE(item_fiscal.ipi_value, item_fiscal.ipi, 0) AS valor_ipi,

          COALESCE(NULLIF(item_fiscal.pis_cst, ''), item_fiscal.profile_pis_cst, '')::text AS cst_pis,
          COALESCE(item_fiscal.pis_base, 0) AS valor_bc_pis,
          COALESCE(item_fiscal.pis_rate, 0) AS aliq_pis,
          0::numeric AS quant_bc_pis,
          0::numeric AS aliq_pis_reais,
          COALESCE(item_fiscal.pis_value, 0) AS valor_pis,

          COALESCE(NULLIF(item_fiscal.cofins_cst, ''), item_fiscal.profile_cofins_cst, '')::text AS cst_cofins,
          COALESCE(item_fiscal.cofins_base, 0) AS valor_bc_cofins,
          COALESCE(item_fiscal.cofins_rate, 0) AS aliq_cofins,
          0::numeric AS quant_bc_cofins,
          0::numeric AS aliq_cofins_reais,
          COALESCE(item_fiscal.cofins_value, 0) AS valor_cofins,

          ''::text AS cod_cta,
          0::numeric AS valor_reducao_bc

        FROM item_fiscal

        ORDER BY
          COALESCE(item_fiscal.nfe_item_seq, item_fiscal.inbound_item_id),
          item_fiscal.inbound_item_id
      `,
      [inboundId],
    );

    return rows.map(item => ({
      ...item,
      codigo_produto: normalizeFiscalProductCode(item.codigo_produto),
      cfop: normalizeInboundCfop(item.cfop),
      cst_ipi: normalizeInboundIpiCst(item.cst_ipi),
      fator_conversao: toNumber(item.fator_conversao, 1) || 1,
      quantidade: toNumber(item.quantidade),
      valor_item: toNumber(item.valor_item),
      valor_desconto: toNumber(item.valor_desconto),
      valor_frete: toNumber(item.valor_frete),
      valor_seguro: toNumber(item.valor_seguro),
      outras_despesas: toNumber(item.outras_despesas),

      valor_bc_icms: toNumber(item.valor_bc_icms),
      aliq_icms: toNumber(item.aliq_icms),
      valor_icms: toNumber(item.valor_icms),

      valor_bc_icms_st: toNumber(item.valor_bc_icms_st),
      aliq_st: toNumber(item.aliq_st),
      valor_icms_st: toNumber(item.valor_icms_st),

      valor_bc_ipi: toNumber(item.valor_bc_ipi),
      aliq_ipi: toNumber(item.aliq_ipi),
      valor_ipi: toNumber(item.valor_ipi),

      valor_bc_pis: toNumber(item.valor_bc_pis),
      aliq_pis: toNumber(item.aliq_pis),
      valor_pis: toNumber(item.valor_pis),

      valor_bc_cofins: toNumber(item.valor_bc_cofins),
      aliq_cofins: toNumber(item.aliq_cofins),
      valor_cofins: toNumber(item.valor_cofins),

      // CST x20/x70 (base reduzida): VL_RED_BC = parte da operação fora da base.
      valor_reducao_bc: /^(\d)?(20|70)$/.test(String(item.cst_icms || ''))
        ? Math.max(
          toNumber(item.valor_item) - toNumber(item.valor_desconto) - toNumber(item.valor_bc_icms),
          0,
        )
        : toNumber(item.valor_reducao_bc),
    }));
  } catch (error) {
    console.error('[SPED Fiscal] getInboundItems V2 error.', {
      inbound_id: inboundId,
      message: error.message,
      code: error.code || null,
      detail: error.detail || null,
      table: error.table || null,
      column: error.column || null,
      constraint: error.constraint || null,
      stack: error.stack || null,
    });

    // Não esconder o erro: um SPED sem as notas de entrada sai errado.
    throw error;
  }
}

export async function getInboundDocumentsSource({ period }) {
  try {
    /*
     * Período das entradas = data de criação (lançamento) da nota no ERP,
     * o mesmo filtro da tela de NF-e de entrada. DT_DOC = data de emissão
     * do XML (issue_date); DT_E_S = data do lançamento, que cai sempre
     * dentro do período do arquivo.
     */
    const { rows } = await pool.query(
      `
        SELECT
          n.inbound_id AS id,
          n.invoice_number::text AS numero,
          COALESCE(NULLIF(n.series::text, ''), '1') AS serie,
          COALESCE(n.access_key::text, '') AS chave,

          COALESCE(n.issue_date::date, n.created_at::date) AS data_emissao,
          n.created_at::date AS data_entrada_saida,

          COALESCE(n.total_amount, 0) AS valor_total,

          '55'::text AS cod_mod,
          '00'::text AS cod_sit,
          '0'::text AS ind_oper,
          '1'::text AS ind_emit,

          CASE
            WHEN supplier.supplier_id IS NULL THEN ''
            ELSE 'F' || supplier.supplier_id::text
          END AS participante_codigo,
          '0'::text AS ind_pgto,
          '9'::text AS ind_frt,

          n.issuer::text AS issuer_document,
          n.recipient::text AS recipient_document,
          n.status::text AS status

        FROM public."inboundInvoices" n

        LEFT JOIN LATERAL (
          SELECT s.supplier_id
          FROM public.suppliers s
          WHERE regexp_replace(COALESCE(s.tax_id, ''), '\\D+', '', 'g')
              = regexp_replace(COALESCE(n.issuer, ''), '\\D+', '', 'g')
            AND regexp_replace(COALESCE(n.issuer, ''), '\\D+', '', 'g') <> ''
          ORDER BY s.supplier_id
          LIMIT 1
        ) supplier ON true

        WHERE n.created_at::date >= $1::date
          AND n.created_at::date <= $2::date
          AND UPPER(COALESCE(n.status, '')) NOT IN (
            'CANCELADA',
            'CANCELADO',
            'CANCELLED',
            'CANCELED',
            'DENEGADA',
            'DENEGADO',
            'REJEITADA',
            'REJECTED'
          )

        ORDER BY n.created_at ASC, n.inbound_id ASC
      `,
      [period.dateStart, period.dateEnd],
    );

    const normalized = [];

    for (const doc of rows) {
      const items = await getInboundItems(doc.id);

      normalized.push({
        ...doc,
        valor_total: toNumber(doc.valor_total),
        valor_mercadorias: sumBy(items, 'valor_item') || toNumber(doc.valor_total),
        valor_frete: sumBy(items, 'valor_frete'),
        valor_seguro: sumBy(items, 'valor_seguro'),
        outras_despesas: sumBy(items, 'outras_despesas'),
        valor_desconto: sumBy(items, 'valor_desconto'),
        valor_bc_icms: sumBy(items, 'valor_bc_icms'),
        valor_icms: sumBy(items, 'valor_icms'),
        valor_bc_icms_st: sumBy(items, 'valor_bc_icms_st'),
        valor_icms_st: sumBy(items, 'valor_icms_st'),
        valor_ipi: sumBy(items, 'valor_ipi'),
        valor_pis: sumBy(items, 'valor_pis'),
        valor_cofins: sumBy(items, 'valor_cofins'),
        source_type: 'inbound',
        items,
      });
    }

    console.info('[SPED Fiscal] inbound documents V2 loaded.', {
      document_count: normalized.length,
      item_count: normalized.reduce((acc, doc) => acc + doc.items.length, 0),
      documents_without_participant: normalized.filter(
        doc => !doc.participante_codigo,
      ).length,
    });

    return normalized;
  } catch (error) {
    console.error('[SPED Fiscal] getInboundDocumentsSource V2 error.', {
      message: error.message,
      code: error.code || null,
      detail: error.detail || null,
      table: error.table || null,
      column: error.column || null,
      constraint: error.constraint || null,
      stack: error.stack || null,
    });

    // Antes devolvia [] e a prévia mostrava "Entradas 0" sem nenhum aviso.
    throw new Error(`SPED Fiscal: falha ao ler as notas de entrada (${error.message}).`);
  }
}

export default {
  getInboundDocumentsSource,
};
