// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/services/apis/betterDateToBuyApi.js                        ║
// ║ Database access for "betterDateToBuy"                              ║
// ║ CONSART ERP                                                        ║
// ║ Monthly customer repurchase reminder system                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';


// ──────────────────────────────────────────────────────────────────────
// GET ALL ALERTS
// ──────────────────────────────────────────────────────────────────────
export async function getAllBetterDates() {
  const sql = `
    SELECT
      b.better_date_to_buy_id,
      b.customer_id,
      b.alert_day,
      b.notes,
      b.status,
      b.last_alert_sent,
      b.created_at,
      b.updated_at,
      c.trade_name,
      c.legal_name,
      c.mobile_number
    FROM "betterDateToBuy" b
    LEFT JOIN customers c
      ON c.customer_id = b.customer_id
    ORDER BY
      b.alert_day ASC,
      c.trade_name ASC
  `;

  const { rows } = await pool.query(sql);

  return rows;
}


// ──────────────────────────────────────────────────────────────────────
// GET ONE ALERT
// ──────────────────────────────────────────────────────────────────────
export async function getBetterDateById(id) {
  const sql = `
    SELECT
      b.*,
      c.trade_name,
      c.legal_name,
      c.mobile_number
    FROM "betterDateToBuy" b
    LEFT JOIN customers c
      ON c.customer_id = b.customer_id
    WHERE
      b.better_date_to_buy_id = $1
  `;

  const { rows } = await pool.query(sql, [id]);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// CREATE ALERT
// ──────────────────────────────────────────────────────────────────────
export async function createBetterDate(data) {
  const sql = `
    INSERT INTO "betterDateToBuy" (
      customer_id,
      alert_day,
      notes,
      status
    )
    VALUES (
      $1,
      $2,
      $3,
      'active'
    )
    RETURNING *
  `;

  const params = [
    data.customer_id,
    data.alert_day,
    data.notes || null
  ];

  const { rows } = await pool.query(sql, params);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// UPDATE ALERT
// ──────────────────────────────────────────────────────────────────────
export async function updateBetterDate(id, data) {
  const sql = `
    UPDATE "betterDateToBuy"
    SET
      customer_id = $1,
      alert_day = $2,
      notes = $3,
      status = $4,
      updated_at = NOW()
    WHERE
      better_date_to_buy_id = $5
    RETURNING *
  `;

  const params = [
    data.customer_id,
    data.alert_day,
    data.notes || null,
    data.status || 'active',
    id
  ];

  const { rows } = await pool.query(sql, params);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// DELETE ALERT
// ──────────────────────────────────────────────────────────────────────
export async function deleteBetterDate(id) {
  const sql = `
    DELETE FROM "betterDateToBuy"
    WHERE better_date_to_buy_id = $1
  `;

  await pool.query(sql, [id]);
}


// ──────────────────────────────────────────────────────────────────────
// MARK ALERT AS SENT
// Prevent duplicate alerts in same month
// ──────────────────────────────────────────────────────────────────────
export async function markAlertSent(id) {
  const sql = `
    UPDATE "betterDateToBuy"
    SET
      last_alert_sent = CURRENT_DATE,
      updated_at = NOW()
    WHERE
      better_date_to_buy_id = $1
    RETURNING *
  `;

  const { rows } = await pool.query(sql, [id]);

  return rows[0];
}


// ──────────────────────────────────────────────────────────────────────
// GET TODAY ALERTS
//
// Rules:
// 1. alert_day must match today's day
// 2. status must be active
// 3. must not have been sent this month
// ──────────────────────────────────────────────────────────────────────
export async function getTodayAlerts() {
  const sql = `
    SELECT
      b.better_date_to_buy_id,
      b.customer_id,
      b.alert_day,
      b.notes,
      b.status,
      b.last_alert_sent,
      c.trade_name,
      c.legal_name,
      c.mobile_number
    FROM "betterDateToBuy" b
    INNER JOIN customers c
      ON c.customer_id = b.customer_id
    WHERE
      b.status = 'active'

      AND b.alert_day =
        EXTRACT(DAY FROM CURRENT_DATE)

      AND (
        b.last_alert_sent IS NULL
        OR DATE_TRUNC('month', b.last_alert_sent)
           < DATE_TRUNC('month', CURRENT_DATE)
      )

    ORDER BY
      c.trade_name ASC
  `;

  const { rows } = await pool.query(sql);

  return rows;
}