// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesTaxCalculationCreate.repository.js — insertSalesTaxCalculation║
// ║ Tabela: "salesTaxCalculations"                                     ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TABLE_TAX_CALC } from './salesTaxCalculation.constants.js';

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
