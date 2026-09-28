// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesTaxCalculationQuery.repository.js — fetchOrderFiscalData      ║
// ║ orders + order_items + products + productsFiscal + classificação   ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import {
  TABLE_ORDERS, ALIAS_ORDERS,
  TABLE_ORDER_ITEMS, ALIAS_ORDER_ITEMS,
  TABLE_PRODUCTS, ALIAS_PRODUCTS,
  TABLE_PRODUCTS_FISCAL, ALIAS_PRODUCTS_FISCAL,
  TABLE_FISCAL_CLASSIFICATION, ALIAS_FISCAL_CLASSIFICATION,
  TABLE_FISCAL_PROFILE, ALIAS_FISCAL_PROFILE,
} from './salesTaxCalculation.constants.js';

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

