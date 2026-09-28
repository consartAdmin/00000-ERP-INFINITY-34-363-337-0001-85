// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: salesTaxCalculationApi.js                                      ║
// ║ MODULE: SALES TAX CALCULATION                                        ║
// ║ CONSART ERP                                                          ║
// ║ DATA ACCESS + TAX CALCULATION ENGINE                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';


/* ======================================================================
   TABLE DEFINITIONS
   ====================================================================== */

const TABLE_ORDERS = 'orders';
const ALIAS_ORDERS = 'o';

const TABLE_ORDER_ITEMS = 'order_items';
const ALIAS_ORDER_ITEMS = 'oi';

const TABLE_PRODUCTS = 'products';
const ALIAS_PRODUCTS = 'p';

const TABLE_PRODUCTS_FISCAL = 'productsFiscal';
const ALIAS_PRODUCTS_FISCAL = 'pf';

const TABLE_FISCAL_CLASSIFICATION = 'fiscalClassification';
const ALIAS_FISCAL_CLASSIFICATION = 'fc';

const TABLE_FISCAL_PROFILE = 'fiscalProfile';
const ALIAS_FISCAL_PROFILE = 'fp';

const TABLE_TAX_CALC = 'salesTaxCalculations';
const TABLE_TAX_CALC_ITEMS = 'salesTaxCalculationItems';
const TABLE_TAX_RECON = 'salesTaxReconciliation';



/* ======================================================================
   FETCH ORDER DATA
   ====================================================================== */

export async function fetchOrderFiscalData(orderId) {

  const sql = `

    SELECT

      /* =========================
         ORDERS
      ========================= */

      ${ALIAS_ORDERS}.order_id,
      ${ALIAS_ORDERS}.number,
      ${ALIAS_ORDERS}.issue_date,
      ${ALIAS_ORDERS}.customer_id,
      ${ALIAS_ORDERS}.customer_name,
      ${ALIAS_ORDERS}.freight_value,


      /* =========================
         ORDER ITEMS
      ========================= */

      ${ALIAS_ORDER_ITEMS}.order_item_id,
      ${ALIAS_ORDER_ITEMS}.sku,
      ${ALIAS_ORDER_ITEMS}.description,
      ${ALIAS_ORDER_ITEMS}.quantity,
      ${ALIAS_ORDER_ITEMS}.unit,
      ${ALIAS_ORDER_ITEMS}.unit_price,
      ${ALIAS_ORDER_ITEMS}.discount_value,
      ${ALIAS_ORDER_ITEMS}.cost_price_at_sale,


      /* =========================
         PRODUCTS
      ========================= */

      ${ALIAS_PRODUCTS}.product_id,
      ${ALIAS_PRODUCTS}.product_code,
      ${ALIAS_PRODUCTS}.cost_price,
      ${ALIAS_PRODUCTS}.products_fiscal_id,


      /* =========================
         PRODUCTS FISCAL
      ========================= */

      ${ALIAS_PRODUCTS_FISCAL}.fiscal_profile_id,
      ${ALIAS_PRODUCTS_FISCAL}.fiscal_classification_id,

      ${ALIAS_PRODUCTS_FISCAL}.ncm_code,
      ${ALIAS_PRODUCTS_FISCAL}.cest_code,
      ${ALIAS_PRODUCTS_FISCAL}.cfop_exit,

      ${ALIAS_PRODUCTS_FISCAL}.icms_cst,
      ${ALIAS_PRODUCTS_FISCAL}.aliquota_icms,
      ${ALIAS_PRODUCTS_FISCAL}.reducao_bc,

      ${ALIAS_PRODUCTS_FISCAL}.pis_cst,
      ${ALIAS_PRODUCTS_FISCAL}.pis_aliquota,

      ${ALIAS_PRODUCTS_FISCAL}.cofins_cst,
      ${ALIAS_PRODUCTS_FISCAL}.cofins_aliquota,

      ${ALIAS_PRODUCTS_FISCAL}.ipi_cst,
      ${ALIAS_PRODUCTS_FISCAL}.ipi_aliquota,

      ${ALIAS_PRODUCTS_FISCAL}.aliquota_fcp,

      ${ALIAS_PRODUCTS_FISCAL}.ibpt_nacional,
      ${ALIAS_PRODUCTS_FISCAL}.ibpt_importado,
      ${ALIAS_PRODUCTS_FISCAL}.ibpt_estadual,
      ${ALIAS_PRODUCTS_FISCAL}.ibpt_municipal,


      /* =========================
         CLASSIFICATION
      ========================= */

      ${ALIAS_FISCAL_CLASSIFICATION}.classification_name,
      ${ALIAS_FISCAL_CLASSIFICATION}.ncm_description,
      ${ALIAS_FISCAL_CLASSIFICATION}.cest_description,


      /* =========================
         PROFILE
      ========================= */

      ${ALIAS_FISCAL_PROFILE}.profile_name,
      ${ALIAS_FISCAL_PROFILE}.description_profile

    FROM
      "${TABLE_ORDERS}" ${ALIAS_ORDERS}

    JOIN
      "${TABLE_ORDER_ITEMS}" ${ALIAS_ORDER_ITEMS}
        ON ${ALIAS_ORDER_ITEMS}.order_id = ${ALIAS_ORDERS}.order_id

    LEFT JOIN
      "${TABLE_PRODUCTS}" ${ALIAS_PRODUCTS}
        ON ${ALIAS_PRODUCTS}.product_code = ${ALIAS_ORDER_ITEMS}.sku

    LEFT JOIN
      "${TABLE_PRODUCTS_FISCAL}" ${ALIAS_PRODUCTS_FISCAL}
        ON ${ALIAS_PRODUCTS_FISCAL}.products_fiscal_id = ${ALIAS_PRODUCTS}.products_fiscal_id

    LEFT JOIN
      "${TABLE_FISCAL_CLASSIFICATION}" ${ALIAS_FISCAL_CLASSIFICATION}
        ON ${ALIAS_FISCAL_CLASSIFICATION}.fiscal_classification_id =
           ${ALIAS_PRODUCTS_FISCAL}.fiscal_classification_id

    LEFT JOIN
      "${TABLE_FISCAL_PROFILE}" ${ALIAS_FISCAL_PROFILE}
        ON ${ALIAS_FISCAL_PROFILE}.fiscal_profile_id =
           ${ALIAS_PRODUCTS_FISCAL}.fiscal_profile_id

    WHERE
      ${ALIAS_ORDERS}.order_id = $1
  `;

  const { rows } = await pool.query(sql, [orderId]);

  return rows;
}



/* ======================================================================
   SAVE TAX CALCULATION HEADER
   ====================================================================== */

export async function insertSalesTaxCalculation(data) {

  const sql = `
    INSERT INTO "${TABLE_TAX_CALC}" (

      order_id,
      order_number,
      issue_date,
      customer_id,
      customer_name,

      gross_total,
      discount_total,
      net_total,

      freight_total,

      icms_total,
      pis_total,
      cofins_total,
      ipi_total,
      fcp_total,

      tax_burden_total,

      cost_total,
      gross_profit_total,
      margin_percent

    )
    VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,$8,
      $9,
      $10,$11,$12,$13,$14,
      $15,
      $16,$17,$18
    )
    RETURNING sales_tax_calc_id
  `;

  const { rows } = await pool.query(sql, [
    data.order_id,
    data.order_number,
    data.issue_date,
    data.customer_id,
    data.customer_name,

    data.gross_total,
    data.discount_total,
    data.net_total,

    data.freight_total,

    data.icms_total,
    data.pis_total,
    data.cofins_total,
    data.ipi_total,
    data.fcp_total,

    data.tax_burden_total,

    data.cost_total,
    data.gross_profit_total,
    data.margin_percent
  ]);

  return rows[0];
}